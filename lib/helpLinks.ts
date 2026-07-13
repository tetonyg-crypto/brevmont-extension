import { getConfig } from './remoteConfig';

export const DEFAULT_MANUAL_BASE_URL = 'https://app.brevmont.com/help';
export const DEFAULT_CHANGELOG_URL = 'https://app.brevmont.com/changelog';

export type ManualTopic =
  | 'rep-tool'
  | 'install-login'
  | 'generate'
  | 'coach'
  | 'ask'
  | 'my-leads'
  | 'my-stats'
  | 'save-lead'
  | 'overdrive'
  | 'settings';

function safeAppUrl(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string' || !candidate.trim()) return fallback;
  try {
    const url = new URL(candidate.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'app.brevmont.com' ||
      url.username ||
      url.password
    ) {
      return fallback;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return fallback;
  }
}

export function buildManualUrl(baseUrl: unknown, topic?: ManualTopic): string {
  const url = new URL(safeAppUrl(baseUrl, DEFAULT_MANUAL_BASE_URL));
  url.searchParams.set('source', 'extension');
  if (topic) url.searchParams.set('topic', topic);
  return url.toString();
}

export function buildChangelogUrl(configuredUrl: unknown): string {
  return safeAppUrl(configuredUrl, DEFAULT_CHANGELOG_URL);
}

export async function resolveManualUrl(topic?: ManualTopic): Promise<string> {
  const config = await getConfig().catch(() => null);
  return buildManualUrl(config?.manual_base_url, topic);
}

export async function resolveChangelogUrl(): Promise<string> {
  const config = await getConfig().catch(() => null);
  return buildChangelogUrl(config?.changelog_url);
}
