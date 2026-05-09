/**
 * Mic Permission Bootstrap — entrypoints/permission/main.ts
 *
 * Opens in its own tab (chrome-extension:// origin).
 * Requests getUserMedia({ audio: true }), stores the grant flag,
 * notifies the background service worker so the side panel can
 * update immediately, then auto-closes.
 *
 * Every error path surfaces a human-readable message — nothing silent.
 */

const btn = document.getElementById('enable-btn') as HTMLButtonElement;
const errorEl = document.getElementById('error-msg') as HTMLElement;
const promptState = document.getElementById('prompt-state') as HTMLElement;
const successState = document.getElementById('success-state') as HTMLElement;
const MIC_PERM_KEY = 'brevmont_mic_granted';

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Requesting access…';
  errorEl.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted — stop the stream immediately, we just needed the grant
    stream.getTracks().forEach(track => track.stop());

    // Persist the grant so the side panel knows permission exists
    await chrome.storage.local.set({ [MIC_PERM_KEY]: true });

    // Notify background → side panel that mic permission was just granted
    try {
      chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' });
    } catch {
      // Background may not have a handler yet — non-blocking
    }

    // Show success
    promptState.style.display = 'none';
    successState.style.display = 'flex';

    // Auto-close after 2 seconds
    setTimeout(() => window.close(), 2000);
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
