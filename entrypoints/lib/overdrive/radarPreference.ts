/**
 * Facebook Lead Radar preference — the single client-side gate for
 * background (automatic) lead capture.
 *
 * 2026-09-27 launch change: Lead Radar is OPT-IN. Before this, radar ran for
 * every rep with Facebook linked + disclosure acknowledged, with no on/off
 * control, and reps accumulated leads just by having Facebook open.
 *
 * Source of truth is the server (GET /api/v1/radar/status → opt_in), so the
 * preference follows the account across Chrome restarts, extension reloads
 * and devices. The last known answer is cached in chrome.storage.local so a
 * cold service worker can decide without a network hop; anything unknown or
 * unreadable is OFF. Manual "+ Lead / Scan This Page" never consults this.
 */

export const RADAR_PREF_KEY = 'lead_radar_pref';
export const RADAR_BASELINE_KEY = 'lead_radar_sweep_baseline';
const PREF_TTL_MS = 60_000;

export interface RadarPreference {
  opt_in: boolean;
  enabled_at: string | null;
  count_today: number;
  fetchedAt: number;
}

export interface RadarStatusLike {
  enabled?: boolean;
  opt_in?: boolean;
  enabled_at?: string | null;
  count_today?: number;
}

const OFF: RadarPreference = { opt_in: false, enabled_at: null, count_today: 0, fetchedAt: 0 };

/** OFF unless the server explicitly reports an opt-in that is enabled. An
 *  older server that omits opt_in reads as OFF. */
export function preferenceFromStatus(status: RadarStatusLike | null | undefined, now = Date.now()): RadarPreference {
  if (!status) return { ...OFF, fetchedAt: now };
  return {
    opt_in: status.opt_in === true && status.enabled === true,
    enabled_at: status.enabled_at || null,
    count_today: Number(status.count_today) || 0,
    fetchedAt: now,
  };
}

let memo: RadarPreference | null = null;

export function currentRadarPreference(): RadarPreference {
  return memo || OFF;
}

export async function readStoredRadarPreference(): Promise<RadarPreference> {
  try {
    const stored = await chrome.storage.local.get([RADAR_PREF_KEY]);
    const pref = stored?.[RADAR_PREF_KEY] as RadarPreference | undefined;
    memo = pref && typeof pref.opt_in === 'boolean' ? pref : OFF;
  } catch {
    memo = OFF;
  }
  return memo;
}

export async function storeRadarPreference(pref: RadarPreference): Promise<void> {
  memo = pref;
  try { await chrome.storage.local.set({ [RADAR_PREF_KEY]: pref }); } catch { /* noop */ }
}

/**
 * Resolve the preference: fresh in-memory value, else the server, else the
 * persisted cache, else OFF. `fetchStatus` returns null on network failure.
 */
export async function loadRadarPreference(
  fetchStatus: () => Promise<RadarStatusLike | null>,
  opts: { force?: boolean } = {},
): Promise<RadarPreference> {
  if (!opts.force && memo && Date.now() - memo.fetchedAt < PREF_TTL_MS) return memo;
  const status = await fetchStatus().catch(() => null);
  if (status) {
    const pref = preferenceFromStatus(status);
    await storeRadarPreference(pref);
    return pref;
  }
  return readStoredRadarPreference();
}

export interface SweepItemLike {
  conversation_key: string;
  last_inbound_hash?: string | null;
}

export interface SweepBaseline {
  enabled_at: string | null;
  keys: Record<string, string>;
}

/**
 * Turning Radar ON must not bulk-ingest the conversations already sitting in
 * the rep's inbox. The first catch-up sweep after an enable records what is
 * already there (captures nothing); later sweeps capture only conversations
 * that are new, or whose latest inbound changed, since that baseline.
 */
export function planSweepAgainstBaseline<T extends SweepItemLike>(
  items: T[],
  baseline: SweepBaseline | null,
  enabledAt: string | null,
): { toCapture: T[]; nextBaseline: SweepBaseline } {
  const keyOf = (item: T) => String(item.conversation_key || '');
  const hashOf = (item: T) => String(item.last_inbound_hash || '');
  if (!baseline || baseline.enabled_at !== enabledAt) {
    const keys: Record<string, string> = {};
    for (const item of items) if (keyOf(item)) keys[keyOf(item)] = hashOf(item);
    return { toCapture: [], nextBaseline: { enabled_at: enabledAt, keys } };
  }
  const keys = { ...baseline.keys };
  const toCapture: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (!(key in keys) || keys[key] !== hashOf(item)) toCapture.push(item);
    keys[key] = hashOf(item);
  }
  return { toCapture, nextBaseline: { enabled_at: enabledAt, keys } };
}

export async function readSweepBaseline(): Promise<SweepBaseline | null> {
  try {
    const stored = await chrome.storage.local.get([RADAR_BASELINE_KEY]);
    return (stored?.[RADAR_BASELINE_KEY] as SweepBaseline | undefined) || null;
  } catch {
    return null;
  }
}

export async function writeSweepBaseline(baseline: SweepBaseline): Promise<void> {
  try { await chrome.storage.local.set({ [RADAR_BASELINE_KEY]: baseline }); } catch { /* noop */ }
}
