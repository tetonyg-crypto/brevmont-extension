import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    build: {
      minify: 'terser',
      terserOptions: {
        mangle: {
          reserved: ['detectPlatform', 'gatherAllText', 'getDashboardScopedText', 'extractVehicle', 'scanText', 'attemptScan', 'updateSidebar', 'openSidebar', 'closeSidebar', 'pushContent', 'updatePillPosition', 'extractContactName', 'extractContactNameLite']
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
    name: 'Brevmont — AI Sales Assistant',
    short_name: 'Brevmont',
    version: '1.11.0',
    version_name: '1.11.0',
    description: 'AI writes the text, email, and CRM note inside your CRM. Every rep performs like your best one.',
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
    permissions: ['activeTab', 'storage', 'alarms', 'cookies', 'tabs'],
    web_accessible_resources: [
      {
        resources: ['voice.html', 'brevmont-intercept.js'],
        matches: [
          '*://*.vinsolutions.com/*',
          '*://vinsolutions.app.coxautoinc.com/*',
          '*://mail.google.com/*',
          '*://www.facebook.com/*',
          '*://www.messenger.com/*',
          '*://www.linkedin.com/*',
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
      '*://*.vinsolutions.com/*',
      '*://vinsolutions.app.coxautoinc.com/*',
      '*://mail.google.com/*',
      '*://www.facebook.com/*',
      '*://www.instagram.com/*',
      '*://www.messenger.com/*',
      '*://www.linkedin.com/*',
      '*://web.whatsapp.com/*',
      '*://*.brevmont.com/*',
      'https://api.brevmont.com/*'
    ],
  },
});
