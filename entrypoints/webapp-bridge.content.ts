/**
 * Stamps app.brevmont.com / admin so the web app can detect this Brevmont build
 * without chrome-extension:// IDs (Store vs unpacked).
 */
export default defineContentScript({
  matches: [
    'https://app.brevmont.com/*',
    'https://admin.brevmont.com/*',
    'https://*.brevmont.com/*',
    'http://localhost:5173/*',
    'http://127.0.0.1:5173/*',
    'http://localhost:4173/*',
    'http://127.0.0.1:4173/*',
    'http://localhost:3000/*',
    'http://127.0.0.1:3000/*',
  ],
  allFrames: false,
  runAt: 'document_start',
  main() {
    try {
      document.documentElement.setAttribute('data-brevmont-extension', '1');
      const manifest = browser.runtime.getManifest();
      if (manifest?.version) {
        document.documentElement.setAttribute('data-brevmont-extension-version', manifest.version);
      }
    } catch {
      /* noop */
    }
    try {
      const manifest = browser.runtime.getManifest();
      document.dispatchEvent(
        new CustomEvent('brevmont-extension-ready', {
          bubbles: true,
          detail: { version: manifest?.version ?? '' },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('brevmont-extension-ready', {
          bubbles: true,
          detail: { version: manifest?.version ?? '' },
        }),
      );
    } catch {
      /* noop */
    }
  },
});
