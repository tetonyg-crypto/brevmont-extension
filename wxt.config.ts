import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    build: {
      minify: 'terser',
      terserOptions: {
        mangle: {
          reserved: ['detectPlatform', 'gatherAllText', 'getDashboardScopedText', 'extractVehicle', 'scanText', 'attemptScan', 'updateSidebar', 'openSidebar', 'closeSidebar', 'pushContent', 'updatePillPosition', 'extractContactName']
        }
      }
    }
  }),
  manifest: {
    name: 'Brevmont — AI Sales Assistant',
    short_name: 'Brevmont',
    version: '1.9.4',
    version_name: '1.9.4',
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
    permissions: ['activeTab', 'storage', 'alarms'],
    web_accessible_resources: [{
      resources: ['voice.html', 'brevmont-intercept.js'],
      matches: [
        '*://*.vinsolutions.com/*',
        '*://vinsolutions.app.coxautoinc.com/*',
        '*://mail.google.com/*',
        '*://www.facebook.com/*',
        '*://www.messenger.com/*',
        '*://www.linkedin.com/*',
        '*://www.instagram.com/*',
        '*://web.whatsapp.com/*'
      ]
    }],
    host_permissions: [
      '*://*.vinsolutions.com/*',
      '*://vinsolutions.app.coxautoinc.com/*',
      '*://mail.google.com/*',
      '*://www.facebook.com/*',
      '*://www.instagram.com/*',
      '*://www.messenger.com/*',
      '*://www.linkedin.com/*',
      '*://web.whatsapp.com/*',
      'https://oper8er-proxy-production.up.railway.app/*'
    ],
  },
});
