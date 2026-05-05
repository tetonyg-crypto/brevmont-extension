/**
 * Reps may use VinSolutions, Elead, DealerSocket, Gmail, etc.
 * Do not navigate to a single CRM host after install — open Brevmont options (instructions / CRM field) instead.
 */
export function openRepPostInstallDestination(): void {
  const closeSelf = () => {
    try {
      window.close();
    } catch {
      /* noop */
    }
  };

  try {
    chrome.runtime.openOptionsPage(() => {
      closeSelf();
    });
  } catch {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('install-screen.html') });
      closeSelf();
    } catch {
      closeSelf();
    }
  }
}
