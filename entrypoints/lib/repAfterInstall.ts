/**
 * Reps may use VinSolutions, Elead, DealerSocket, Gmail, etc.
 * After install we used to always open Profile Settings — that duplicates onboarding
 * when sync still has credentials but local was cleared (sideload/reinstall race).
 */
import { hasCompleteActivation } from './activationState';

async function getCurrentWindowId(): Promise<number | null> {
  try {
    const tab = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
      chrome.tabs.getCurrent((currentTab) => resolve(currentTab));
    });
    if (typeof tab?.windowId === 'number') return tab.windowId;
  } catch {
    /* fall through */
  }

  try {
    return await new Promise<number | null>((resolve) => {
      chrome.windows.getCurrent((currentWindow) => {
        resolve(typeof currentWindow?.id === 'number' ? currentWindow.id : null);
      });
    });
  } catch {
    return null;
  }
}

async function openSidePanel(): Promise<boolean> {
  const sidePanel = (chrome as any).sidePanel;
  const windowId = await getCurrentWindowId();
  if (!sidePanel?.open || typeof windowId !== 'number') return false;

  try {
    await new Promise<void>((resolve, reject) => {
      sidePanel.open({ windowId }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
    return true;
  } catch {
    return false;
  }
}

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
      if (await openSidePanel()) {
        closeSelf();
        return;
      }
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
