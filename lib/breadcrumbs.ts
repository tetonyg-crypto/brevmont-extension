/**
 * Tool: lib/breadcrumbs.ts
 * Purpose: Ring-buffer of recent client-side events. Attached to support
 *          tickets so the founder can see what the rep was doing in the
 *          minutes before they hit the issue. Eliminates "what were you on
 *          when this happened" ping-pong.
 * Inputs:  Application code calling addBreadcrumb at instrumentation points
 * Outputs: Last 50 breadcrumbs read by support modal at submit time
 * Dependencies: chrome.storage.local
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation. Sentry-style breadcrumb buffer.
 *
 * STORAGE STRATEGY:
 *   * Stored under chrome.storage.local key `error_breadcrumbs.breadcrumbs`
 *     (matches the schema in lib/storage.ts).
 *   * Ring buffer: when length > MAX_BREADCRUMBS, oldest is dropped.
 *   * Writes are debounced (100ms) to avoid IPC storms — 50 events in a
 *     row from VinSolutions DOM mutations would otherwise hammer storage.
 *   * Reads are NOT debounced — getBreadcrumbs returns the latest snapshot.
 *
 * INSTRUMENTATION:
 *   Wired by callers at the natural seams:
 *     - signedFetch in lib/authSigning.ts → 'api' breadcrumb (path, status, ms)
 *     - window.onerror in entrypoints/* → 'error' breadcrumb (msg, file:line)
 *     - chrome.runtime.onMessage handlers → 'state' breadcrumb (type, ok)
 *     - chrome.tabs.onUpdated → 'navigation' breadcrumb (url shadow)
 *   See entrypoints/background.ts and entrypoints/content.ts for the wiring.
 *
 * PII NOTE:
 *   Breadcrumbs may include URLs from VinSolutions which can contain customer
 *   names in paths. lib/redact.ts is applied before submission, NOT at
 *   storage time, because we want the local breadcrumbs to retain enough
 *   information for the rep's own debugging.
 */

export type BreadcrumbCategory = 'navigation' | 'click' | 'api' | 'error' | 'state';

export interface Breadcrumb {
  timestamp: number;
  category: BreadcrumbCategory;
  message: string;
  data?: Record<string, unknown>;
}

const STORAGE_KEY = 'error_breadcrumbs';
const MAX_BREADCRUMBS = 50;

// In-memory mirror of the persisted ring buffer. Reads hit memory, writes
// debounce to storage. Initialised lazily on first add/get.
let cachedBuffer: Breadcrumb[] | null = null;
let writePending = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

async function loadFromStorage(): Promise<Breadcrumb[]> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const wrapper = result[STORAGE_KEY];
        const arr = wrapper && Array.isArray(wrapper.breadcrumbs) ? wrapper.breadcrumbs : [];
        resolve(arr);
      });
    } catch {
      resolve([]);
    }
  });
}

async function ensureLoaded(): Promise<void> {
  if (cachedBuffer) return;
  cachedBuffer = await loadFromStorage();
}

function scheduleFlush() {
  if (writeTimer) return;
  writePending = true;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    if (!writePending || !cachedBuffer) return;
    writePending = false;
    try {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set(
          { [STORAGE_KEY]: { version: 1, breadcrumbs: cachedBuffer } },
          () => {
            // chrome.runtime.lastError swallowed — caller code never blocks
            // on breadcrumb persistence
            resolve();
          }
        );
      });
    } catch {
      // ignore — breadcrumbs are best-effort
    }
  }, 100);
}

// Persist the current buffer immediately, cancelling any pending debounce.
// Used for high-value crumbs that must survive an imminent SW suspension.
async function flushNow(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writePending = false;
  if (!cachedBuffer) return;
  try {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: { version: 1, breadcrumbs: cachedBuffer } }, () => resolve());
    });
  } catch {
    // ignore — breadcrumbs are best-effort
  }
}

/**
 * Record a breadcrumb. Non-error crumbs write on the next debounce tick (keeps
 * hot DOM-mutation paths from storming storage). 'error' crumbs — the ones most
 * likely to immediately precede an SW teardown or a support ticket — flush
 * synchronously, since a bare setTimeout debounce doesn't survive suspension.
 */
export async function addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'>): Promise<void> {
  await ensureLoaded();
  if (!cachedBuffer) cachedBuffer = [];
  cachedBuffer.push({ timestamp: Date.now(), ...crumb });
  if (cachedBuffer.length > MAX_BREADCRUMBS) {
    cachedBuffer = cachedBuffer.slice(-MAX_BREADCRUMBS);
  }
  if (crumb.category === 'error') {
    await flushNow();
  } else {
    scheduleFlush();
  }
}

/**
 * Snapshot the current breadcrumbs. Used by the support modal at submit
 * time. Returns a defensive copy.
 */
export async function getBreadcrumbs(): Promise<Breadcrumb[]> {
  await ensureLoaded();
  return cachedBuffer ? cachedBuffer.slice() : [];
}

/**
 * Clear all breadcrumbs. Called after a ticket submits successfully so the
 * next ticket starts with a clean buffer (avoids re-sending the same context
 * twice).
 */
export async function clearBreadcrumbs(): Promise<void> {
  cachedBuffer = [];
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writePending = false;
  await new Promise<void>((resolve) => {
    try {
      chrome.storage.local.remove([STORAGE_KEY], () => resolve());
    } catch {
      resolve();
    }
  });
}
