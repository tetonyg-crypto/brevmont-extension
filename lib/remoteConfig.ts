/**
 * Remote extension config from proxy — cached in chrome.storage.local.
 */

export interface RemoteConfig {
  feature_flags: Record<string, boolean>;
  dom_selectors: {
    vinsolutions: Record<string, string>;
  };
  api_endpoints: {
    primary: string;
    fallback: string | null;
  };
  min_extension_version: string;
  kill_switch: boolean;
  kill_switch_message: string;
  heartbeat_interval_minutes: number;
  queue_flush_interval_minutes: number;
  config_refresh_interval_minutes: number;
  manual_base_url?: string;
  changelog_url?: string;
}

const CONFIG_STORAGE_KEY = 'brevmont_remote_config';
const CONFIG_VERSION_KEY = 'brevmont_config_version';

const DEFAULT_PROXY = 'https://api.brevmont.com';

export async function fetchRemoteConfig(apiUrl: string): Promise<RemoteConfig | null> {
  const base = apiUrl.replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/extension-config`);
    if (!response.ok) return null;
    const { config_version, config } = await response.json();
    await browser.storage.local.set({
      [CONFIG_STORAGE_KEY]: config,
      [CONFIG_VERSION_KEY]: config_version,
    });
    return config as RemoteConfig;
  } catch {
    const cached = await browser.storage.local.get([CONFIG_STORAGE_KEY]);
    return (cached[CONFIG_STORAGE_KEY] as RemoteConfig) || null;
  }
}

export async function getConfig(): Promise<RemoteConfig | null> {
  const cached = await browser.storage.local.get([CONFIG_STORAGE_KEY]);
  return (cached[CONFIG_STORAGE_KEY] as RemoteConfig) || null;
}

export async function getResolvedApiUrl(): Promise<string> {
  const c = await getConfig();
  const fromConfig = c?.api_endpoints?.primary;
  if (fromConfig && typeof fromConfig === 'string' && fromConfig.startsWith('http')) {
    return fromConfig.replace(/\/$/, '');
  }
  return DEFAULT_PROXY;
}

function isVersionLessThan(current: string, minimum: string): boolean {
  const c = current.split('.').map((n) => parseInt(n, 10) || 0);
  const m = minimum.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((c[i] || 0) < (m[i] || 0)) return true;
    if ((c[i] || 0) > (m[i] || 0)) return false;
  }
  return false;
}

export function applyConfig(config: RemoteConfig): void {
  if (config.kill_switch) {
    void browser.storage.local.set({
      brevmont_killed: true,
      kill_message: config.kill_switch_message || '',
    });
    return;
  }
  void browser.storage.local.set({ brevmont_killed: false });

  try {
    const manifest = browser.runtime.getManifest();
    const currentVersion = manifest.version || '0.0.0';
    if (isVersionLessThan(currentVersion, config.min_extension_version || '0.0.0')) {
      void browser.storage.local.set({
        brevmont_update_required: true,
        brevmont_min_version: config.min_extension_version,
      });
      try {
        browser.runtime.requestUpdateCheck(() => {});
      } catch {
        /* noop */
      }
    } else {
      void browser.storage.local.set({ brevmont_update_required: false });
    }
  } catch {
    /* noop */
  }

  void browser.storage.local.set({
    brevmont_feature_flags: config.feature_flags,
    brevmont_dom_selectors: config.dom_selectors,
    brevmont_api_endpoints: config.api_endpoints,
  });

  const hb = Math.max(1, Math.floor(config.heartbeat_interval_minutes || 5));
  const qf = Math.max(1, Math.floor(config.queue_flush_interval_minutes || 1));
  const cr = Math.max(5, Math.floor(config.config_refresh_interval_minutes || 60));
  try {
    browser.alarms.create('brevmont-heartbeat', { periodInMinutes: hb });
    browser.alarms.create('brevmont-queue-flush', { periodInMinutes: qf });
    browser.alarms.create('brevmont-config-refresh', { periodInMinutes: cr });
  } catch {
    /* noop */
  }
}
