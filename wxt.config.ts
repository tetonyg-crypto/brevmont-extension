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

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (_, manifest) => {
      // WXT auto-discovers entrypoints/popup and wires it as default_popup.
      // Brevmont uses the Chrome side panel as the toolbar click surface, so
      // remove the popup binding from the generated manifest.
      if (manifest.action) {
        delete (manifest.action as Record<string, unknown>).default_popup;
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
    name: 'Brevmont - AI Sales Co-Pilot',
    short_name: 'Brevmont',
    version: pkgVersion,
    version_name: pkgVersion,
    description: "AI co-pilot in your reps' sidebar. Writes the text, email, and CRM note beside every page they work in.",
    homepage_url: 'https://brevmont.com',
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
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage', 'alarms', 'tabs', 'notifications', 'cookies'],
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
          '*://*.facebook.com/*',
          '*://www.facebook.com/*',
          '*://*.messenger.com/*',
          '*://www.messenger.com/*',
          '*://*.linkedin.com/*',
          '*://www.linkedin.com/*',
          '*://*.instagram.com/*',
          '*://www.instagram.com/*',
          '*://web.whatsapp.com/*',
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
      '<all_urls>',
      '*://*.vinsolutions.com/*',
      '*://vinsolutions.app.coxautoinc.com/*',
      '*://mail.google.com/*',
      '*://*.facebook.com/*',
      '*://www.facebook.com/*',
      '*://www.instagram.com/*',
      '*://*.instagram.com/*',
      '*://*.messenger.com/*',
      '*://www.messenger.com/*',
      '*://*.linkedin.com/*',
      '*://www.linkedin.com/*',
      '*://web.whatsapp.com/*',
      '*://*.brevmont.com/*',
      'https://api.brevmont.com/*'
    ],
  },
});
