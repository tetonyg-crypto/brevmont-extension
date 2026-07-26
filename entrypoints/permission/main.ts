/**
 * Mic Permission Bootstrap — entrypoints/permission/main.ts
 *
 * Opens in its own tab (chrome-extension:// origin).
 * Three possible paths:
 *
 * 1. Happy path: getUserMedia() triggers Chrome's "Allow" prompt → granted → done.
 * 2. Managed browser: prompt is suppressed → fallback to manual setup instructions
 *    that walk the user through extension settings.
 * 3. Skip: user doesn't want voice → setup_complete set without mic.
 *
 * On success (any path), sets brevmont_setup_complete so the toolbar icon
 * opens the side panel on subsequent clicks.
 */

const btn = document.getElementById('enable-btn') as HTMLButtonElement;
const errorEl = document.getElementById('error-msg') as HTMLElement;
const promptState = document.getElementById('prompt-state') as HTMLElement;
const successState = document.getElementById('success-state') as HTMLElement;
const manualState = document.getElementById('manual-state') as HTMLElement;
const skipBtn = document.getElementById('skip-btn') as HTMLButtonElement;
const manualSkipBtn = document.getElementById('manual-skip-btn') as HTMLButtonElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
const openSettingsBtn = document.getElementById('open-settings-btn') as HTMLButtonElement;
const verifyBtn = document.getElementById('verify-btn') as HTMLButtonElement;

const MIC_PERM_KEY = 'brevmont_mic_granted';
const SETUP_KEY = 'brevmont_setup_complete';

/** Check if mic is already granted (e.g. user came back after manual enable) */
async function checkMicPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'prompt'; // API not available — assume promptable
  }
}

/** Transition to success state */
async function showSuccess(micGranted: boolean) {
  const flags: Record<string, boolean> = { [SETUP_KEY]: true };
  if (micGranted) flags[MIC_PERM_KEY] = true;

  await chrome.storage.local.set(flags);

  try {
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' });
  } catch {
    // Background may not have a handler yet — non-blocking
  }

  promptState.style.display = 'none';
  manualState.style.display = 'none';
  successState.style.display = 'flex';
}

/** Transition to manual setup state */
function showManualSetup() {
  promptState.style.display = 'none';
  manualState.style.display = 'flex';
}

// ── On page load: check if mic is already granted ──
(async () => {
  const state = await checkMicPermission();
  if (state === 'granted') {
    // Already granted (user returned after manual enable, or previously granted)
    await showSuccess(true);
  }
})();

// ── Enable Microphone button ──
btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Requesting access…';
  errorEl.style.display = 'none';

  // Race getUserMedia against a timeout. Managed browsers sometimes
  // silently swallow the prompt — it never resolves OR rejects.
  const TIMEOUT_MS = 6000;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('PROMPT_TIMEOUT'));
    }, TIMEOUT_MS);
  });

  try {
    // Attach the teardown to the getUserMedia promise itself so a stream that
    // resolves AFTER the timeout still gets stopped — otherwise Promise.race
    // discards the late stream and its mic track stays live (persistent
    // recording indicator = store-pull risk).
    const micPromise = navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => { if (timedOut) { s.getTracks().forEach((t) => t.stop()); } return s; });
    const stream = await Promise.race([micPromise, timeoutPromise]);

    // Permission granted — stop the stream immediately
    stream.getTracks().forEach(track => track.stop());
    await showSuccess(true);
  } catch (err: any) {
    if (timedOut || err?.message === 'PROMPT_TIMEOUT') {
      // Prompt was suppressed — show manual setup
      showManualSetup();
      return;
    }

    btn.disabled = false;
    btn.textContent = 'Enable Microphone';

    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      // User clicked "Block" or browser auto-denied
      // Check if prompt actually appeared by querying permission state
      const state = await checkMicPermission();
      if (state === 'prompt') {
        // Prompt never showed — managed browser suppressed it
        showManualSetup();
      } else {
        // User explicitly denied — show manual fallback with different messaging
        errorEl.textContent = 'Microphone was blocked. You can enable it manually in your extension settings.';
        errorEl.style.display = 'block';

        // After a brief delay, transition to manual setup
        setTimeout(showManualSetup, 2000);
      }
    } else if (err.name === 'NotFoundError') {
      errorEl.textContent = 'No microphone detected. Connect a mic and try again.';
      errorEl.style.display = 'block';
    } else {
      errorEl.textContent = 'Mic error: ' + (err.message || err.name);
      errorEl.style.display = 'block';
    }
  }
});

// ── Open Extension Settings button ──
openSettingsBtn.addEventListener('click', () => {
  // Open the extension's site-details page in Chrome settings.
  // This is the page where Microphone can be toggled to "Allow".
  const extId = chrome.runtime.id;
  const settingsUrl = `chrome://settings/content/siteDetails?site=chrome-extension://${extId}`;

  // Try opening via background (chrome.tabs.create can open chrome:// from background)
  chrome.runtime.sendMessage(
    { type: 'OPEN_EXTENSION_SETTINGS', url: settingsUrl },
    (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        // Fallback: show the URL for manual copy
        const fallbackEl = document.createElement('p');
        fallbackEl.style.cssText = 'font-size:12px;color:#5EEAD4;margin-top:8px;word-break:break-all;';
        fallbackEl.textContent = `Copy this URL into your address bar: ${settingsUrl}`;
        openSettingsBtn.parentElement?.appendChild(fallbackEl);
      }
    }
  );
});

// ── "Done — I allowed it" verification button ──
verifyBtn.addEventListener('click', async () => {
  verifyBtn.textContent = 'Checking…';

  const state = await checkMicPermission();
  if (state === 'granted') {
    await showSuccess(true);
  } else {
    // Try getUserMedia one more time now that they say they allowed it
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      await showSuccess(true);
    } catch {
      verifyBtn.textContent = 'Done — I allowed it';
      // Show inline hint
      const hint = document.createElement('p');
      hint.style.cssText = 'font-size:12px;color:#fca5a5;margin-top:8px;';
      hint.textContent = 'Microphone is still not enabled. Make sure you set it to "Allow" in the settings.';
      // Only add once
      if (!verifyBtn.parentElement?.querySelector('.verify-hint')) {
        hint.className = 'verify-hint';
        verifyBtn.parentElement?.appendChild(hint);
      }
    }
  }
});

// ── Skip buttons ──
const handleSkip = async () => {
  await chrome.storage.local.set({ [SETUP_KEY]: true });
  promptState.style.display = 'none';
  manualState.style.display = 'none';
  successState.style.display = 'flex';
};
skipBtn.addEventListener('click', handleSkip);
manualSkipBtn.addEventListener('click', handleSkip);

// ── Close tab ──
closeBtn.addEventListener('click', () => window.close());
