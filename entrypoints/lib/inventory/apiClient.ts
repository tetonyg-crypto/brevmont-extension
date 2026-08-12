/**
 * Rep-side inventory API client. Uses the SIGNED rep auth path
 * (lib/authSigning.ts signedFetch/signedGet) exactly like overdrive/apiClient.
 * The scan is REP-authed and dealership-scoped server-side; the manager-only
 * /api/v1/inventory/upload path is intentionally NOT used here.
 */

import { signedDelete, signedFetch, signedGet } from '../../../lib/authSigning';
import type { ScrapedVehicle } from './types';

async function getApiBase(): Promise<string> {
  try {
    const cfg = await chrome.storage.local.get(['api_base_url']);
    return (cfg?.api_base_url as string) || 'https://api.brevmont.com';
  } catch {
    return 'https://api.brevmont.com';
  }
}

function extHeaders(): Record<string, string> {
  let version = 'unknown';
  try {
    version = chrome.runtime.getManifest().version || 'unknown';
  } catch { /* noop */ }
  return { 'X-Extension-Version': version };
}

async function readBody(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  return isJson ? await res.json().catch(() => ({})) : await res.text();
}

function throwForStatus(res: Response, body: any): never {
  const err = new Error(
    typeof body === 'object' && body?.error ? String(body.error) : `inventory_api_${res.status}`,
  );
  (err as any).status = res.status;
  (err as any).body = body;
  throw err;
}

export interface InventoryScanResponse {
  ok: boolean;
  seen: number;
  gone: number;
  ingested_at: string;
}

/** POST scanned vehicles to the rep's dealership inventory snapshot. */
export async function postInventoryScan(
  vehicles: ScrapedVehicle[],
  sourceUrl: string,
): Promise<InventoryScanResponse> {
  const base = await getApiBase();
  const res = await signedFetch(
    `${base}/api/v1/rep/inventory/scan`,
    { vehicles, source_url: sourceUrl },
    extHeaders(),
  );
  const body = await readBody(res);
  if (!res.ok) throwForStatus(res, body);
  return body as InventoryScanResponse;
}

export interface InventoryVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  vin: string | null;
  stock_number: string | null;
  photos: string[] | null;
  description: string | null;
  posted_status: string | null;
  posted_at?: string | null;
  vdp_url: string | null;
}

export interface InventoryListResponse {
  vehicles: InventoryVehicle[];
  governor?: { posted_today: number; daily_cap: number; next_allowed_at?: string | null } | null;
}

export async function getInventory(): Promise<InventoryListResponse> {
  const base = await getApiBase();
  const res = await signedGet(`${base}/api/v1/rep/inventory`, extHeaders());
  const body = await readBody(res);
  if (!res.ok) throwForStatus(res, body);
  return body as InventoryListResponse;
}

export async function setInventoryStatus(
  id: string,
  status: string,
  opts?: { listingUrl?: string; idempotencyKey?: string },
): Promise<{ ok: boolean; posted_status: string }> {
  if (!id || id.startsWith('seed-')) {
    const err = new Error('This seed record is not in the live lot yet. Scan inventory to save status.');
    (err as any).status = 400;
    throw err;
  }
  const base = await getApiBase();
  const res = await signedFetch(
    `${base}/api/v1/rep/inventory/${encodeURIComponent(id)}/status`,
    {
      status,
      listing_url: opts?.listingUrl,
      idempotency_key: opts?.idempotencyKey || `status:${id}:${status}:${Date.now()}`,
    },
    extHeaders(),
  );
  const body = await readBody(res);
  if (!res.ok) throwForStatus(res, body);
  try { await chrome.storage.local.set({ brevmont_inventory_rev: Date.now() }); } catch { /* noop */ }
  return { ok: true, posted_status: String(body?.posted_status || status) };
}

export async function deleteInventoryVehicle(id: string): Promise<{ ok: boolean }> {
  const base = await getApiBase();
  const res = await signedDelete(
    `${base}/api/v1/rep/inventory/${encodeURIComponent(id)}`,
    extHeaders(),
  );
  const body = await readBody(res);
  if (!res.ok) throwForStatus(res, body);
  return body as { ok: boolean };
}
