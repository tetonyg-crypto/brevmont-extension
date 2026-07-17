/**
 * Spike B — Image injection into Messenger composer.
 *
 * For the AI-question interactive response: when a customer asks "is
 * this a bot / AI / automated / real person?", Overdrive sends the
 * rep's stored thumbs-up selfie into the thread + a one-liner. The
 * gag lands without flatly stating "not an AI."
 *
 * Messenger's Lexical composer accepts images through three surfaces:
 *   1. Paste (clipboard) — user copies an image, pastes into composer,
 *      Lexical intercepts the paste event and uploads via its own
 *      internal handler
 *   2. Hidden file input in the attachment button — clicking the
 *      paperclip triggers an <input type="file">
 *   3. Drop event on the composer — drag-drop from OS
 *
 * We attempt in order: paste → file_input → drop. First success wins.
 *
 * Fallback: if all three methods fail (Messenger UI change, sandboxed
 * clipboard, etc.), the caller sends text-only and logs the failure.
 */

import type { OverdriveAttachResult } from './types';

const ATTACH_VERIFY_TIMEOUT_MS = 4000;
const ATTACH_VERIFY_POLL_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function findComposer(): HTMLElement | null {
  return (
    document.querySelector('div[role="textbox"][contenteditable="true"][aria-label*="Message" i]') as HTMLElement | null
  ) ||
    (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement | null);
}

/**
 * Look for an attachment/thumbnail preview element that appears
 * between the composer and the send button once an image is queued.
 * Messenger renders these as image tiles with role="img" or as
 * <img> elements inside a scroller div near the composer.
 */
async function verifyAttachment(): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ATTACH_VERIFY_TIMEOUT_MS) {
    const composer = findComposer();
    if (composer) {
      const composerRow = composer.closest('div[role="region"], div[role="form"], footer, form') || composer.parentElement;
      const container = composerRow || document;
      // Look for any freshly-added <img> in the same region as the
      // composer that isn't the rep's own avatar (aria-label check).
      const attachedImgs = Array.from(container.querySelectorAll('img'))
        .filter((img) => img instanceof HTMLImageElement)
        .filter((img) => !((img.getAttribute('aria-label') || '') as string).toLowerCase().includes('profile'));
      if (attachedImgs.length > 0) return true;
      // Some Messenger variants use canvas/svg placeholders while
      // upload is pending. Look for those too.
      const pendingUpload = container.querySelector('[data-visualcompletion="loading-state"], [role="progressbar"]');
      if (pendingUpload) return true;
    }
    await sleep(ATTACH_VERIFY_POLL_MS);
  }
  return false;
}

/**
 * Convert a data URL to a Blob. Async because atob is sync but this
 * pattern is future-proof if we swap to Response.blob().
 */
async function dataUrlToBlob(dataUrl: string): Promise<{ blob: Blob; mime: string; ext: string }> {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('invalid_data_url');
  const mime = match[1] || 'image/jpeg';
  const b64 = match[2];
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return { blob, mime, ext };
}

/**
 * Method 1 — synthesize a paste event with clipboardData.files
 * populated by our image blob. This mirrors what happens when a user
 * copies an image from their OS and pastes into the composer.
 * Messenger's Lexical editor listens for `paste` and reads
 * `event.clipboardData.files` to trigger its upload pipeline.
 */
async function attemptClipboardPaste(composer: HTMLElement, blob: Blob, mime: string, ext: string): Promise<boolean> {
  composer.focus();
  const file = new File([blob], `overdrive-selfie.${ext}`, { type: mime });
  const dt = new DataTransfer();
  dt.items.add(file);
  // ClipboardEvent constructor takes a ClipboardEventInit; the
  // clipboardData property is typed as DataTransfer.
  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  } as ClipboardEventInit);
  // Some browsers don't populate clipboardData from the init dict —
  // patch it if empty.
  if (!(pasteEvent as any).clipboardData || ((pasteEvent as any).clipboardData?.files?.length ?? 0) === 0) {
    Object.defineProperty(pasteEvent, 'clipboardData', { value: dt, writable: false });
  }
  composer.dispatchEvent(pasteEvent);
  return verifyAttachment();
}

/**
 * Method 2 — find the hidden file input Messenger uses for attachments
 * (`input[type="file"]` inside the composer container) and inject the
 * file via a synthetic `change` event. FileList is read-only so we
 * use `Object.defineProperty` to swap the files getter.
 */
async function attemptFileInput(composer: HTMLElement, blob: Blob, mime: string, ext: string): Promise<boolean> {
  // Messenger's file input is usually the closest `input[type="file"]`
  // sibling of the attachment/photo icon button.
  const region = composer.closest('div[role="region"], div[role="form"], footer, form') || document;
  const input = region.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) return false;
  const file = new File([blob], `overdrive-selfie.${ext}`, { type: mime });
  const dt = new DataTransfer();
  dt.items.add(file);
  // Try direct assignment first — in modern Chrome, HTMLInputElement.files
  // has a setter for FileList that accepts DataTransfer.files.
  try {
    input.files = dt.files;
  } catch {
    // Fall back to defineProperty for older UAs.
    try {
      Object.defineProperty(input, 'files', {
        value: dt.files,
        configurable: true,
      });
    } catch {
      return false;
    }
  }
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  return verifyAttachment();
}

/**
 * Method 3 — dispatch a drop event on the composer with a DataTransfer
 * containing the file. This mirrors OS drag-drop and Messenger's
 * composer registers a `drop` handler for the drag-and-drop upload
 * path.
 */
async function attemptDropEvent(composer: HTMLElement, blob: Blob, mime: string, ext: string): Promise<boolean> {
  const file = new File([blob], `overdrive-selfie.${ext}`, { type: mime });
  const dt = new DataTransfer();
  dt.items.add(file);
  const rect = composer.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    dataTransfer: dt,
  } as DragEventInit;
  // Full drag sequence to satisfy React's drop handler chain.
  composer.dispatchEvent(new DragEvent('dragenter', eventInit));
  composer.dispatchEvent(new DragEvent('dragover', eventInit));
  composer.dispatchEvent(new DragEvent('drop', eventInit));
  return verifyAttachment();
}

/**
 * Public API — attach a data-URL image to the Messenger composer.
 * `photoDataUrl` is optional media returned by the API. Current
 * bot-question disclosure replies are text-only by default.
 */
export async function overdriveAttachPhoto(photoDataUrl: string): Promise<OverdriveAttachResult> {
  const startedAt = Date.now();
  const attempts: OverdriveAttachResult['attempts'] = [];
  const composer = findComposer();

  if (!composer) {
    return {
      ok: false,
      method: 'not_attempted',
      latency_ms: Date.now() - startedAt,
      error: 'composer_not_found',
      attempts,
    };
  }

  let blobData: { blob: Blob; mime: string; ext: string };
  try {
    blobData = await dataUrlToBlob(photoDataUrl);
  } catch (err: any) {
    return {
      ok: false,
      method: 'not_attempted',
      latency_ms: Date.now() - startedAt,
      error: err?.message || 'data_url_decode_failed',
      attempts,
    };
  }

  const { blob, mime, ext } = blobData;

  // Method 1: clipboard paste
  try {
    const ok = await attemptClipboardPaste(composer, blob, mime, ext);
    attempts.push({ method: 'clipboard_paste', ok });
    if (ok) {
      return { ok: true, method: 'clipboard_paste', latency_ms: Date.now() - startedAt, attempts };
    }
  } catch (err: any) {
    attempts.push({ method: 'clipboard_paste', ok: false, error: err?.message || 'threw' });
  }

  // Method 2: file input
  try {
    const ok = await attemptFileInput(composer, blob, mime, ext);
    attempts.push({ method: 'file_input', ok });
    if (ok) {
      return { ok: true, method: 'file_input', latency_ms: Date.now() - startedAt, attempts };
    }
  } catch (err: any) {
    attempts.push({ method: 'file_input', ok: false, error: err?.message || 'threw' });
  }

  // Method 3: drop event
  try {
    const ok = await attemptDropEvent(composer, blob, mime, ext);
    attempts.push({ method: 'drop_event', ok });
    if (ok) {
      return { ok: true, method: 'drop_event', latency_ms: Date.now() - startedAt, attempts };
    }
  } catch (err: any) {
    attempts.push({ method: 'drop_event', ok: false, error: err?.message || 'threw' });
  }

  return {
    ok: false,
    method: 'not_attempted',
    latency_ms: Date.now() - startedAt,
    error: 'all_methods_failed',
    attempts,
  };
}
