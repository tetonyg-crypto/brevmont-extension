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
      // Stamp the runtime id so AuthExtension can probe/message THIS
      // build even when it's unpacked (Chrome assigns a random id that
      // isn't in the app's hardcoded BREVMONT_EXTENSION_IDS list).
      if (browser.runtime.id) {
        document.documentElement.setAttribute('data-brevmont-extension-id', browser.runtime.id);
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

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.brevmont_inventory_rev) return;
        window.dispatchEvent(new CustomEvent('brevmont-inventory-changed', {
          detail: { rev: changes.brevmont_inventory_rev.newValue },
        }));
      });
    } catch {
      /* storage may be unavailable */
    }

    window.addEventListener('brevmont-lead-form-autofill', (event) => {
      void (async () => {
        const customEvent = event as CustomEvent<Record<string, unknown>>;
        const detail = customEvent.detail || {};
        const requestId = typeof detail.requestId === 'string' ? detail.requestId : `${Date.now()}`;
        try {
          await browser.storage.local.set({
            brevmont_lead_form_autofill: {
              ...detail,
              requestId,
              queuedAt: Date.now(),
              source: 'admin-cold-call-center',
            },
          });
          window.dispatchEvent(
            new CustomEvent('brevmont-lead-form-autofill-ready', {
              detail: { ok: true, requestId },
            }),
          );
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent('brevmont-lead-form-autofill-ready', {
              detail: { ok: false, requestId, error: error instanceof Error ? error.message : 'autofill_queue_failed' },
            }),
          );
        }
      })();
    });
  },
});
