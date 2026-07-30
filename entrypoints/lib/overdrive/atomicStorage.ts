/**
 * Serialized read-modify-write against a single chrome.storage.local key.
 *
 * chrome.storage.local.get + set is not atomic: two concurrent read-modify-write
 * cycles on the same key can both read the same snapshot and the second write
 * clobbers the first (a lost update). The Overdrive pipeline hits this in real
 * conditions — two conversations completing within milliseconds of each other
 * both bump the daily-reply counter, or both stash a pending-confirm entry, and
 * one update silently vanishes.
 *
 * This module keeps a per-key promise chain so updates to the same key run one
 * after another within a single service-worker lifetime. That's the exact scope
 * of the real race (concurrent async work in ONE SW instance) — it does not, and
 * does not need to, coordinate across SW restarts.
 */

const chains = new Map<string, Promise<void>>();

export async function atomicStorageUpdate<T>(
  key: string,
  updateFn: (current: T | undefined) => T,
): Promise<void> {
  const prior = chains.get(key) || Promise.resolve();
  // A failed update must not permanently jam the queue for this key.
  const next = prior
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.local.get([key]);
      const updated = updateFn(stored[key] as T | undefined);
      await chrome.storage.local.set({ [key]: updated });
    });
  chains.set(key, next);
  return next;
}
