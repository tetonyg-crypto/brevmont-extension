// Auth-Final Phase 1 — extension-side trace pipeline.
//
// Mirrors brevmont-app/src/rep/lib/auth-flow-trace.ts. Runs in the
// service worker + sidepanel + content-script contexts. Buffers events
// and posts to /api/v1/auth/trace on a short interval.
//
// The extension has no sessionStorage in the SW context, so the trace_id
// persists in chrome.storage.session. Each install gets one id per SW
// lifetime — good enough for correlating background events with the
// sidepanel boot and the web app's own trace stream.
//
// Zero secrets. Booleans + emails + short reason strings only.

const PROXY_URL = 'https://api.brevmont.com';
const TRACE_ID_KEY = 'brevmont_auth_trace_id';

export type AuthTraceSurface = 'auth_extension' | 'sidepanel' | 'background' | 'rep_web_app' | 'dual_login';

export interface AuthTraceEvent {
  surface: AuthTraceSurface;
  step: string;
  event_type: 'decision' | 'wipe' | 'auto_bridge' | 'redirect' | 'oauth_callback' | 'session_read' | 'identity_render' | 'error';
  payload?: Record<string, unknown>;
  storage_state?: Record<string, unknown>;
  url_flags?: Record<string, unknown>;
  observed_email?: string | null;
  reason?: string;
  call_stack_tag?: string;
}

interface TraceEnvelope extends AuthTraceEvent {
  trace_id: string;
  client_ts: string;
}

const buffer: TraceEnvelope[] = [];
let flushTimer: number | null = null;
let cachedTraceId: string | null = null;

function uuid(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function loadTraceId(): Promise<string> {
  if (cachedTraceId) return cachedTraceId;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const stored = await chrome.storage.session.get([TRACE_ID_KEY]);
      const existing = String(stored?.[TRACE_ID_KEY] || '');
      if (existing) { cachedTraceId = existing; return existing; }
      const fresh = uuid();
      await chrome.storage.session.set({ [TRACE_ID_KEY]: fresh });
      cachedTraceId = fresh;
      return fresh;
    }
  } catch { /* noop */ }
  cachedTraceId = uuid();
  return cachedTraceId;
}

export async function authTrace(event: AuthTraceEvent): Promise<void> {
  try {
    const trace_id = await loadTraceId();
    buffer.push({
      trace_id,
      client_ts: new Date().toISOString(),
      ...event,
    });
    scheduleFlush();
  } catch { /* trace pipeline never breaks the extension */ }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  try {
    // globalThis.setTimeout works in both SW and window contexts.
    flushTimer = (globalThis as any).setTimeout(async () => {
      flushTimer = null;
      await flush();
    }, 800) as unknown as number;
  } catch { /* noop */ }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const events = buffer.splice(0, 100);
  try {
    await fetch(`${PROXY_URL}/api/v1/auth/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    if (buffer.length < 500) buffer.unshift(...events.slice(0, 100));
  }
}

// Snapshot chrome.storage identity keys. Booleans + email + dealership
// name only. Never returns token values.
export async function snapshotExtensionStorage(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) return out;
    const local = await chrome.storage.local.get([
      'rep_email', 'rep_name', 'rep_id', 'dealership', 'dealership_id',
      'dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token',
      'brevmont_tier', 'license_key', 'brevmont_extension_role',
      'brevmont_jwt_cache',
    ]);
    const sync = await chrome.storage.sync.get([
      'rep_email', 'rep_name', 'rep_id', 'dealership', 'dealership_id',
      'dealer_token', 'rep_auth_token', 'brevmont_tier',
      'brevmont_extension_role',
    ]);
    out.local_rep_email = String(local.rep_email || '');
    out.local_rep_name = String(local.rep_name || '');
    out.local_dealership = String(local.dealership || '');
    out.local_rep_id_present = !!local.rep_id;
    out.local_dealership_id_present = !!local.dealership_id;
    out.local_dealer_token_present = !!local.dealer_token;
    out.local_rep_auth_token_present = !!local.rep_auth_token;
    out.local_brevmont_rep_auth_token_present = !!local.brevmont_rep_auth_token;
    out.local_license_key_present = !!local.license_key;
    out.local_tier = String(local.brevmont_tier || '');
    out.local_role = String(local.brevmont_extension_role || '');
    out.local_jwt_cache_present = !!local.brevmont_jwt_cache;
    out.sync_rep_email = String(sync.rep_email || '');
    out.sync_rep_name = String(sync.rep_name || '');
    out.sync_dealership = String(sync.dealership || '');
    out.sync_rep_id_present = !!sync.rep_id;
    out.sync_dealership_id_present = !!sync.dealership_id;
    out.sync_dealer_token_present = !!sync.dealer_token;
    out.sync_rep_auth_token_present = !!sync.rep_auth_token;
    out.sync_tier = String(sync.brevmont_tier || '');
  } catch { out.storage_read_failed = true; }
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies?.get) {
      const cookie = await chrome.cookies.get({ url: 'https://app.brevmont.com', name: 'brevmont_rep_session' });
      out.cookie_brevmont_rep_session_present = !!cookie?.value;
    }
  } catch { /* noop */ }
  return out;
}
