/**
 * Offline retry queue for /v1/generate — Dexie IndexedDB + exponential backoff.
 */

import Dexie, { type Table } from 'dexie';
import { signedFetch } from './authSigning';

export interface QueuedRequest {
  id: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number;
  createdAt: number;
  lastError: string | null;
  status: 'pending' | 'in_flight' | 'failed' | 'dead';
}

class RetryQueueDB extends Dexie {
  requests!: Table<QueuedRequest, string>;

  constructor() {
    super('brevmont-retry-queue');
    this.version(1).stores({
      requests: 'id, status, nextRetryAt, endpoint',
    });
  }
}

export const retryDB = new RetryQueueDB();

export async function enqueue(
  endpoint: string,
  method: string,
  headers: Record<string, string>,
  body: object
): Promise<string> {
  const id = crypto.randomUUID();
  await retryDB.requests.add({
    id,
    endpoint,
    method,
    headers,
    body: JSON.stringify(body),
    attempts: 0,
    maxAttempts: 8,
    nextRetryAt: Date.now(),
    createdAt: Date.now(),
    lastError: null,
    status: 'pending',
  });
  return id;
}

async function scheduleRetry(req: QueuedRequest): Promise<void> {
  const nextAttempt = req.attempts + 1;
  if (nextAttempt >= req.maxAttempts) {
    await retryDB.requests.update(req.id, {
      status: 'dead',
      attempts: nextAttempt,
      lastError: 'Max retries exceeded',
    });
    return;
  }
  const backoffMs = Math.min(Math.pow(2, nextAttempt) * 1000, 300000);
  await retryDB.requests.update(req.id, {
    status: 'pending',
    attempts: nextAttempt,
    nextRetryAt: Date.now() + backoffMs,
    lastError: 'Network or server failure',
  });
}

export async function processQueue(baseUrl: string): Promise<void> {
  const now = Date.now();
  const pending = await retryDB.requests
    .where('status')
    .equals('pending')
    .filter((r) => r.nextRetryAt <= now)
    .toArray();

  const base = baseUrl.replace(/\/$/, '');

  for (const req of pending) {
    await retryDB.requests.update(req.id, { status: 'in_flight' });

    try {
      const extraHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': req.id,
        ...req.headers,
      };
      const bodyObj = JSON.parse(req.body) as object;
      const response = await signedFetch(`${base}${req.endpoint}`, bodyObj, extraHeaders);

      if (response.ok) {
        await retryDB.requests.delete(req.id);
      } else if (response.status >= 500) {
        await scheduleRetry(req);
      } else {
        await retryDB.requests.update(req.id, {
          status: 'dead',
          lastError: `HTTP ${response.status}`,
        });
      }
    } catch {
      await scheduleRetry(req);
    }
  }
}

export async function getQueueCount(): Promise<number> {
  return retryDB.requests.where('status').equals('pending').count();
}

export async function clearDeadLetters(): Promise<void> {
  await retryDB.requests.where('status').equals('dead').delete();
}
