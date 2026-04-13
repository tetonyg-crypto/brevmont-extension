/**
 * Tool: resilience.ts
 * Purpose: Offline queue + replay for extension generation requests
 * Inputs: Generation payloads when network is down
 * Outputs: Queued items in chrome.storage.local, replay results
 * Dependencies: browser.storage.local
 * Last Updated: 2026-04-12
 */

const QUEUE_KEY = 'brevmont_offline_queue';
const MAX_QUEUE_SIZE = 50;

interface QueuedGeneration {
  id: string;
  payload: any;
  timestamp: number;
  retries: number;
}

export async function queueOffline(payload: any): Promise<string> {
  const queue = await getQueue();
  const id = crypto.randomUUID();
  queue.push({ id, payload, timestamp: Date.now(), retries: 0 });
  // Keep only last MAX_QUEUE_SIZE items
  while (queue.length > MAX_QUEUE_SIZE) queue.shift();
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
  return id;
}

export async function getQueue(): Promise<QueuedGeneration[]> {
  const result = await browser.storage.local.get(QUEUE_KEY);
  return result[QUEUE_KEY] || [];
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter(q => q.id !== id);
  await browser.storage.local.set({ [QUEUE_KEY]: filtered });
}

export async function getQueueSize(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

export async function replayQueue(sendFn: (payload: any) => Promise<any>): Promise<{ success: number; failed: number }> {
  const queue = await getQueue();
  let success = 0;
  let failed = 0;

  for (const item of queue) {
    if (item.retries >= 3) {
      await removeFromQueue(item.id);
      failed++;
      continue;
    }
    try {
      await sendFn(item.payload);
      await removeFromQueue(item.id);
      success++;
    } catch {
      // Update retry count
      item.retries++;
      const updated = await getQueue();
      const idx = updated.findIndex(q => q.id === item.id);
      if (idx >= 0) updated[idx] = item;
      await browser.storage.local.set({ [QUEUE_KEY]: updated });
      failed++;
    }
  }

  return { success, failed };
}
