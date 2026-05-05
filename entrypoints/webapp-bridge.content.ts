/**
 * Minimal content script for app.brevmont.com (and local dev).
 * Stamps the DOM so the web app can detect "this Brevmont build is installed"
 * without knowing chrome-extension:// ID (Web Store vs unpacked vs Edge all differ).
 *
 * RepLanding reads `document.documentElement[data-brevmont-extension="1"]`.
 */
export default defineContentScript({
  matches: [
    'https://app.brevmont.com/*',
    'https://*.brevmont.com/*',
    'http://localhost:5173/*',
    'http://127.0.0.1:5173/*',
    'http://localhost:4173/*',
    'http://127.0.0.1:4173/*',
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
      window.dispatchEvent(
        new CustomEvent('brevmont-extension-ready', {
          detail: { version: manifest?.version ?? '' },
        })
      );
    } catch {
      /* noop */
    }
  },
});
