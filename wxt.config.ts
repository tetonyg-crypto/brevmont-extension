import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Single source of truth for the extension version: package.json.
// Anything else (manifest hardcode, .env override, etc.) gets one place to break.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
).version as string;
const chromeWebStoreBuild =
  process.env.CWS_BUILD === '1' || process.env.CHROME_WEB_STORE_BUILD === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // WXT auto-discovers entrypoints/popup and wires it as default_popup.
      // Brevmont uses the Chrome side panel as the toolbar click surface, so
      // remove the popup binding from the generated manifest.
      if (manifest.action) {
        delete (manifest.action as Record<string, unknown>).default_popup;
      }
      const cs = (manifest as Record<string, unknown>).content_scripts as Array<{ matches?: string[]; js?: string[]; world?: string }> | undefined;
      if (Array.isArray(cs)) {
        const broad = new Set(['http://*/*', 'https://*/*', '<all_urls>']);
        (manifest as Record<string, unknown>).content_scripts = cs.filter((entry) => {
          // Audit 100-4: drop the MAIN-world verification/QA harness from CWS
          // builds only. Self-hosted sideload ships keep it so ship.mjs can
          // verify live capture tooling is present.
          if (chromeWebStoreBuild && entry.js?.some((j) => /verification-bridge/.test(j))) return false;
          // Store-only: drop broad-match content scripts (lead-form-autofill) so a
          // CWS build passes review; the sideload build intentionally keeps them.
          if (chromeWebStoreBuild && entry.matches?.some((m) => broad.has(m))) return false;
          return true;
        });
      }
      if (chromeWebStoreBuild) {
        delete (manifest as Record<string, unknown>).key;
      }
    },
  },
  vite: () => ({
    build: {
      minify: 'terser',
      terserOptions: {
        mangle: {
          reserved: ['detectPlatform', 'gatherAllText', 'getDashboardScopedText', 'extractVehicle', 'scanText', 'attemptScan', 'updateSidebar', 'openSidebar', 'closeSidebar', 'pushContent', 'updatePillPosition', 'extractContactName', 'extractContactNameLite', 'safeExtractContactName']
        }
      }
    }
  }),
  manifest: {
    // Wave 2.8: stable extension ID for developer (sideloaded) installs.
    // Without this field every `Load unpacked` gets a new random CRX ID,
    // breaking any code that hard-codes the extension ID.
    // Private key stored in brevmont-vault/secrets/extension-keypair.pem
    // (never commit private key to source; this public key is safe to publish).
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkMsS75L94HSdLb6I5gYOWkaP7JwtWdeRtVTmBRjkVR8tbvnsvYBE54CPY4jrHGKR8+CUO8NSd62MRCabJZMaJ5N1QpwgttOY2XCD78wCggmRGbKlGsZOtZjwkvX93NHAgcNFc/1RKu1mq0ireFqtidDLp8tM6WKPD/maWZ83xPPeYWD5Ahmwx0qjLMyAsj4e3uBIegtyT05IrPBtpYOT30GRuoi2+kTDU/McaY6yS9VtVZXomsLH5kUlA8+RD7vzxToGitogc6g0pJdEluXtdIkSN+ulcPzOfWzmBBdbViiJlmOUr/m/OFF482E0eSy6Ek4V/Z1KAJGheOAKh0wOvwIDAQAB',
    name: 'Brevmont Chrome Extension',
    short_name: 'Brevmont',
    version: pkgVersion,
    version_name: pkgVersion,
    description: "Brevmont opens beside your inbox and CRM so you can write the next follow-up, email, and note.",
    homepage_url: 'https://brevmont.com/extension',
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    commands: {
      'open_command_mode': {
        suggested_key: { default: 'Alt+K' },
        description: 'Open Brevmont Command Mode'
      }
    },
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage', 'alarms', 'tabs', 'cookies', 'notifications'],
    // Options page: rep-only preferences (name, tone, goal).
    // Opens as a full tab via chrome.runtime.openOptionsPage().
    options_ui: {
      page: 'options-legacy.html',
      open_in_tab: true,
    },
    // Side Panel: clicking the toolbar icon opens the side panel instead of the popup.
    // The popup entrypoint is retained for fallback / Phase 6 migration but is NOT
    // wired as default_popup so chrome.action.onClicked fires.
    action: {},
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    web_accessible_resources: [
      {
        resources: ['voice.html', 'brevmont-intercept.js'],
        matches: [
          '*://*.vinsolutions.com/*',
          '*://vinsolutions.app.coxautoinc.com/*',
          '*://mail.google.com/*',
          '*://outlook.live.com/*',
          '*://outlook.office.com/*',
          '*://outlook.office365.com/*',
          '*://*.facebook.com/*',
          '*://*.messenger.com/*',
          '*://*.linkedin.com/*',
          '*://*.instagram.com/*',
          '*://web.whatsapp.com/*',
      '*://messages.google.com/*',
      '*://*.cargurus.com/*',
      '*://*.cars.com/*',
      '*://*.autotrader.com/*',
      '*://*.dealersocket.com/*',
      '*://*.elead-crm.com/*',
      '*://*.eleadcrm.com/*',
        ],
      },
      {
        resources: ['icons/icon-128.png', 'icons/icon-48.png'],
        matches: ['https://app.brevmont.com/*', 'https://*.brevmont.com/*'],
      },
    ],
    externally_connectable: {
      matches: [
        'https://app.brevmont.com/*',
        'https://*.brevmont.com/*',
        'http://localhost:*/*',
        'http://127.0.0.1:*/*',
      ],
    },
    host_permissions: [
      '*://*.vinsolutions.com/*',
      '*://vinsolutions.app.coxautoinc.com/*',
      '*://mail.google.com/*',
      '*://outlook.live.com/*',
      '*://outlook.office.com/*',
      '*://outlook.office365.com/*',
      '*://*.facebook.com/*',
      '*://*.instagram.com/*',
      '*://*.messenger.com/*',
      '*://*.linkedin.com/*',
      '*://web.whatsapp.com/*',
      '*://messages.google.com/*',
      '*://*.cargurus.com/*',
      '*://*.cars.com/*',
      '*://*.autotrader.com/*',
      '*://*.dealersocket.com/*',
      '*://*.elead-crm.com/*',
      '*://*.eleadcrm.com/*',
      '*://*.brevmont.com/*',
      // FLAG: photo inject fetches dealer CDN images in the service worker.
      // Without this, jazelc photo blobs fail from facebook.com's origin.
      '*://*.jazelc.com/*',
    ],
  },
});
