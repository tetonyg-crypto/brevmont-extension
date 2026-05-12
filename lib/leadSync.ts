/**
 * Tool: leadSync.ts
 * Purpose: Background sync manager for locally captured leads.
 *          Pushes pending Dexie rows to /api/v1/leads/sync in batches.
 *          Called after PARSE_LEAD saves and on a periodic timer.
 * Inputs: Dexie leadDb, signedFetch for auth
 * Outputs: Updates sync_status on each local lead
 * Dependencies: leadDb.ts, authSigning.ts
 * Last Updated: 2026-05-09
 */

import { leadDb } from './leadDb';
import { signedFetch } from './authSigning';
import type { LocalLead } from './types/lead';

const PROXY_URL = 'https://api.brevmont.com';
const BATCH_SIZE = 20;
let syncing = false;

/**
 * Push all pending leads to the API. Idempotent — safe to call multiple times.
 * Uses upsert on the API side, so re-syncing an already-synced lead is a no-op.
 */
export async function syncPendingLeads(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  syncing = true;

  let totalSynced = 0;
  let totalFailed = 0;

  try {
    const pending = await leadDb.captured_leads
      .where('sync_status')
      .equals('pending')
      .limit(BATCH_SIZE)
      .toArray();

    if (pending.length === 0) return { synced: 0, failed: 0 };

    // Strip local-only fields before sending
    const payload = pending.map((lead) => ({
      id: lead.id,
      customer_name: lead.customer_name,
      phone: lead.phone,
      email: lead.email,
      vehicle_interest: lead.vehicle_interest,
      source_platform: lead.source_platform,
      source_raw_text: lead.source_raw_text,
      status: lead.status,
      captured_at: typeof lead.captured_at === 'number' ? new Date(lead.captured_at).toISOString() : lead.captured_at,
      has_trade_in: lead.has_trade_in || false,
      finance_intent: lead.finance_intent || false,
      extracted_trade_in: lead.extracted_trade_in || null,
      extracted_urgency: lead.extracted_urgency || null,
      metadata: lead.metadata || {},
    }));

    const resp = await signedFetch(`${PROXY_URL}/api/v1/leads/sync`, { leads: payload });

    if (resp.ok) {
      const result = await resp.json();
      // Mark all as synced
      const ids = pending.map((l) => l.id);
      await leadDb.captured_leads
        .where('id')
        .anyOf(ids)
        .modify({ sync_status: 'synced', updated_at: Date.now() });
      totalSynced = result.synced_count || ids.length;
    } else {
      // Mark as error so they don't block future syncs forever
      const ids = pending.map((l) => l.id);
      await leadDb.captured_leads
        .where('id')
        .anyOf(ids)
        .modify({ sync_status: 'error', updated_at: Date.now() });
      totalFailed = ids.length;
      console.warn('[leadSync] Sync failed:', resp.status, await resp.text().catch(() => ''));
    }
  } catch (err) {
    console.error('[leadSync] Sync exception:', err);
    totalFailed = 1;
  } finally {
    syncing = false;
  }

  return { synced: totalSynced, failed: totalFailed };
}

/**
 * Retry leads that previously failed sync.
 * Resets error → pending so the next syncPendingLeads() picks them up.
 */
export async function retryFailedLeads(): Promise<number> {
  const count = await leadDb.captured_leads
    .where('sync_status')
    .equals('error')
    .modify({ sync_status: 'pending', updated_at: Date.now() });
  return count;
}

/**
 * Get counts by sync_status for UI display.
 */
export async function getSyncStats(): Promise<{ pending: number; synced: number; error: number }> {
  const [pending, synced, error] = await Promise.all([
    leadDb.captured_leads.where('sync_status').equals('pending').count(),
    leadDb.captured_leads.where('sync_status').equals('synced').count(),
    leadDb.captured_leads.where('sync_status').equals('error').count(),
  ]);
  return { pending, synced, error };
}
