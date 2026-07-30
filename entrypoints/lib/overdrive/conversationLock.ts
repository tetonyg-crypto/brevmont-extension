/**
 * Per-conversation in-flight lock for the Overdrive send pipeline.
 *
 * The pipeline can sit in a 15-60s pending-send window before it ever injects
 * or sends. The 3s per-thread debounce is far shorter than that, and routine
 * Messenger DOM churn (a "Seen" receipt, a timestamp re-render) can re-trigger
 * the same inbound hash during the wait — before the first run has recorded the
 * reply — starting a second concurrent pipeline that sends the same reply twice.
 *
 * This lock closes that window. Acquire before orchestrating a conversation,
 * release when done. The synchronous in-memory Set guarantees two concurrent
 * calls in the SAME service-worker instance can't both pass (no await between
 * check and insert). The storage-backed timestamp additionally guards against a
 * run that was orphaned by an SW restart mid-pipeline: the slot stays held until
 * the TTL expires, so a restart can't immediately re-fire the same conversation.
 */

const LOCK_KEY = 'overdrive_conversation_locks';
// Longer than the max realistic pipeline latency (~80s) so a genuinely dead run
// eventually frees the slot, but short enough that a real new inbound isn't
// blocked for long after a crash.
const LOCK_TTL_MS = 90_000;

const inFlight = new Set<string>();

export async function acquireConversationLock(conversationKey: string): Promise<boolean> {
  if (!conversationKey) return true; // nothing to key on — don't block
  // Synchronous guard: closes the within-lifetime race with no await gap.
  if (inFlight.has(conversationKey)) return false;
  inFlight.add(conversationKey);

  try {
    const stored = await chrome.storage.local.get([LOCK_KEY]);
    const locks = (stored[LOCK_KEY] as Record<string, number>) || {};
    const now = Date.now();
    const held = locks[conversationKey];
    if (held && now - held < LOCK_TTL_MS) {
      // A prior run (possibly from before an SW restart) is still within TTL.
      inFlight.delete(conversationKey);
      return false;
    }
    locks[conversationKey] = now;
    // Opportunistically drop expired entries so the map can't grow unbounded.
    for (const key of Object.keys(locks)) {
      if (now - locks[key] >= LOCK_TTL_MS) delete locks[key];
    }
    await chrome.storage.local.set({ [LOCK_KEY]: locks });
    return true;
  } catch {
    // Fail closed — skip rather than risk a double-send on a storage error.
    inFlight.delete(conversationKey);
    return false;
  }
}

export async function releaseConversationLock(conversationKey: string): Promise<void> {
  if (!conversationKey) return;
  inFlight.delete(conversationKey);
  try {
    const stored = await chrome.storage.local.get([LOCK_KEY]);
    const locks = (stored[LOCK_KEY] as Record<string, number>) || {};
    delete locks[conversationKey];
    await chrome.storage.local.set({ [LOCK_KEY]: locks });
  } catch { /* non-fatal — the TTL will expire it either way */ }
}
