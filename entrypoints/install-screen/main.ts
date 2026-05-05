/**
 * Install screen — first-run "find Brevmont in your toolbar" walkthrough.
 *
 * Triggered by entrypoints/background.ts onInstalled.addListener at install
 * time. Single-screen flow (NOT carousel — synthesis confirmed carousels
 * lose dealership audiences).
 *
 * Platform detection picks the right screenshot set. After "I pinned it"
 * we route to the next step in the install chain:
 *   * If credentials already in storage (cookie auto-config or install_token
 *     redemption already happened) → success state, close tab
 *   * Else → open the legacy onboarding wizard so the rep enters credentials
 *
 * Image strategy:
 *   * Bundled PNGs in public/onboarding/{mac|win}-{1..3}.png (founder hand-off
 *     to capture; spec lists 6 files)
 *   * If the file is missing (founder hasn't shipped them yet), we fall back
 *     to text-only step descriptions so the screen is never broken
 */

import { hasCompleteActivation } from '../lib/activationState';
import { openRepPostInstallDestination } from '../lib/repAfterInstall';

type Platform = 'mac' | 'windows' | 'other';

const STEPS: Record<Platform, Array<{ caption: string; img: string }>> = {
  mac: [
    { caption: 'Click the puzzle piece icon in your Chrome toolbar (top right).', img: 'onboarding/mac-1.png' },
    { caption: 'Find Brevmont in the list, click the pin icon next to it.', img: 'onboarding/mac-2.png' },
    { caption: 'Brevmont stays visible in your toolbar from now on.', img: 'onboarding/mac-3.png' },
  ],
  windows: [
    { caption: 'Click the puzzle piece icon in your Chrome toolbar (top right).', img: 'onboarding/win-1.png' },
    { caption: 'Find Brevmont in the list, click the pin icon next to it.', img: 'onboarding/win-2.png' },
    { caption: 'Brevmont stays visible in your toolbar from now on.', img: 'onboarding/win-3.png' },
  ],
  other: [
    { caption: 'Click the puzzle piece icon in your Chrome toolbar (top right).', img: 'onboarding/mac-1.png' },
    { caption: 'Find Brevmont in the list, click the pin icon next to it.', img: 'onboarding/mac-2.png' },
    { caption: 'Brevmont stays visible in your toolbar from now on.', img: 'onboarding/mac-3.png' },
  ],
};

async function detectPlatform(): Promise<Platform> {
  try {
    const info = await new Promise<chrome.runtime.PlatformInfo>((resolve) => {
      chrome.runtime.getPlatformInfo((i) => resolve(i));
    });
    if (info.os === 'mac') return 'mac';
    if (info.os === 'win') return 'windows';
    return 'other';
  } catch {
    return 'other';
  }
}

function imgOrFallback(srcRel: string, alt: string): HTMLElement {
  // Try to load the image; if it 404s, replace with text fallback. This
  // keeps the screen usable before the founder hand-off ships.
  const img = document.createElement('img');
  img.className = 'step-img';
  img.alt = alt;
  img.src = chrome.runtime.getURL(srcRel);
  img.onerror = () => {
    const fb = document.createElement('div');
    fb.className = 'step-img-fallback';
    fb.textContent = alt;
    img.replaceWith(fb);
  };
  return img;
}

async function isAlreadyActivated(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['license_key', 'dealer_token', 'profile_onboarded'], (d) => {
        resolve(Boolean(d.license_key || d.dealer_token || d.profile_onboarded));
      });
    } catch {
      resolve(false);
    }
  });
}

async function markFirstRunComplete() {
  return new Promise<void>((resolve) => {
    try {
      chrome.storage.local.set({ first_run_completed: true, first_run_completed_at: Date.now() }, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function bootstrap() {
  const platform = await detectPlatform();
  const steps = STEPS[platform];
  const subhead = document.getElementById('subhead');
  if (subhead) {
    subhead.textContent = platform === 'mac'
      ? 'Pinning Brevmont takes about 15 seconds on macOS.'
      : platform === 'windows'
        ? 'Pinning Brevmont takes about 15 seconds on Windows.'
        : 'One quick step before you use Brevmont in your CRM.';
  }

  const stepsRoot = document.getElementById('steps');
  if (stepsRoot) {
    steps.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'step';

      const num = document.createElement('div');
      num.className = 'step-num';
      num.textContent = String(i + 1);
      row.appendChild(num);

      const body = document.createElement('div');
      body.className = 'step-body';
      const cap = document.createElement('div');
      cap.className = 'step-caption';
      cap.textContent = s.caption;
      body.appendChild(cap);
      body.appendChild(imgOrFallback(s.img, s.caption));
      row.appendChild(body);

      stepsRoot.appendChild(row);
    });
  }

  document.getElementById('btn-pinned')?.addEventListener('click', async () => {
    await markFirstRunComplete();
    if (await hasCompleteActivation()) {
      try {
        window.close();
      } catch {
        /* noop */
      }
      return;
    }
    const activated = await isAlreadyActivated();
    if (activated) {
      const stored = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['brevmont_extension_role', 'dealer_token'], resolve);
      });

      const role = stored.brevmont_extension_role || 'rep';
      const repRoles = ['rep', 'sales_rep'];

      if (repRoles.includes(role)) {
        await openRepPostInstallDestination();
      } else {
        try {
          chrome.tabs.create({ url: 'https://app.brevmont.com/dashboard' });
          window.close();
        } catch {
          window.location.href = 'https://app.brevmont.com/dashboard';
        }
      }
      return;
    }
    // Not activated — open the legacy wizard so the rep pastes their license.
    try {
      const url = chrome.runtime.getURL('onboarding.html');
      window.location.href = url;
    } catch {
      window.close();
    }
  });

  document.getElementById('btn-skip')?.addEventListener('click', async () => {
    await markFirstRunComplete();
    window.close();
  });
}

bootstrap().catch(() => {
  // Failsafe — never leave the user staring at a blank tab.
  document.body.textContent = 'Brevmont is installed. Pin the puzzle-piece icon in your Chrome toolbar to keep it visible.';
});
