/**
 * Mic Permission Bootstrap — entrypoints/permission/main.ts
 *
 * Opens in its own tab (chrome-extension:// origin).
 * Requests getUserMedia({ audio: true }), stores the grant flag,
 * notifies the background service worker so the side panel can
 * update immediately. User clicks "Got it" to close.
 *
 * Skip path: sets setup_complete without mic — side panel opens
 * on next toolbar click but voice features stay disabled.
 */

const btn = document.getElementById('enable-btn') as HTMLButtonElement;
const errorEl = document.getElementById('error-msg') as HTMLElement;
const promptState = document.getElementById('prompt-state') as HTMLElement;
const successState = document.getElementById('success-state') as HTMLElement;
const skipBtn = document.getElementById('skip-btn') as HTMLButtonElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

const MIC_PERM_KEY = 'brevmont_mic_granted';
const SETUP_KEY = 'brevmont_setup_complete';

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Requesting access…';
  errorEl.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted — stop the stream immediately, we just needed the grant
    stream.getTracks().forEach(track => track.stop());

    // Persist both flags: mic granted + setup complete
    await chrome.storage.local.set({
      [MIC_PERM_KEY]: true,
      [SETUP_KEY]: true,
    });

    // Notify background → side panel that mic permission was just granted
    try {
      chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' });
    } catch {
      // Background may not have a handler yet — non-blocking
    }

    // Show success — user closes manually
    promptState.style.display = 'none';
    successState.style.display = 'flex';
  } catch (err: any) {
    btn.disabled = false;
    btn.textContent = 'Enable Microphone';

    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      errorEl.textContent = 'Microphone access was denied. Click to try again, or check Chrome site settings.';
    } else if (err.name === 'NotFoundError') {
      errorEl.textContent = 'No microphone detected. Connect a mic and try again.';
    } else {
      errorEl.textContent = 'Mic error: ' + (err.message || err.name);
    }
    errorEl.style.display = 'block';
  }
});

// Skip: mark setup complete without mic — voice features stay disabled
skipBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ [SETUP_KEY]: true });
  promptState.style.display = 'none';
  successState.style.display = 'flex';
});

// Close tab after success/skip
closeBtn.addEventListener('click', () => {
  window.close();
});
