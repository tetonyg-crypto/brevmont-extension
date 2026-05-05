/**
 * Reps may use VinSolutions, Elead, DealerSocket, Gmail, etc.
 * After install we used to always open Profile Settings — that duplicates onboarding
 * when sync still has credentials but local was cleared (sideload/reinstall race).
 */
import { hasCompleteActivation } from './activationState';

export async function openRepPostInstallDestination(): Promise<void> {
  const closeSelf = () => {
    try {
      window.close();
    } catch {
      /* noop */
    }
  };

  try {
    if (await hasCompleteActivation()) {
      closeSelf();
      return;
    }
  } catch {
    /* fall through to options */
  }

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
