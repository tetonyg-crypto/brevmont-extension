/**
 * Tool: jwtCache.ts
 * Purpose: Exchange rep_auth_token for a short-lived JWT and cache it
 *          across the SW lifecycle. Refreshes when within 60s of exp.
 * Inputs: rep_auth_token from chrome.storage.local
 * Outputs: getJWT() → string | null (null = no rep_auth_token)
 * Dependencies: browser.storage, fetch
 * Last Updated: 2026-05-06
 * Changelog:
 *   - 2026-05-06: Initial creation — Phase 3 JWT auth client
 */

const REFRESH_BUFFER_SECONDS = 60;
const STORAGE_KEY = 'brevmont_jwt_cache';

interface JwtCacheEntry {
  token: string;
  exp: number; // unix seconds
}

let memoryCache: JwtCacheEntry | null = null;
let inflight: Promise<string | null> | null = null;

async function markRepAccessEnded(errorCode: string): Promise<void> {
  memoryCache = null;
  try {
    await browser.storage.local.remove(STORAGE_KEY);
    await browser.storage.local.set({
      license_revoked: true,
      license_revoked_at: Date.now(),
      license_revoked_message:
        'Your access at this dealership has ended. Been invited to a new store? Reconnect below.',
      brevmont_last_error: errorCode,
      brevmont_last_error_at: new Date().toISOString(),
    });
  } catch {
    // Non-blocking; callers still get null and fall back to local handling.
  }
}

function decodeExp(jwt: string): number | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

async function getRepToken(): Promise<string | null> {
  try {
    const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
    const fromLocal =
      (local.rep_auth_token as string | undefined) ||
      (local.brevmont_rep_auth_token as string | undefined);
    if (fromLocal) return fromLocal;
    const sync = await browser.storage.sync.get(['rep_auth_token']);
    return (sync.rep_auth_token as string | undefined) || null;
  } catch {
    return null;
  }
}

async function loadFromStorage(): Promise<JwtCacheEntry | null> {
  try {
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    const entry = stored[STORAGE_KEY] as JwtCacheEntry | undefined;
    if (entry?.token && entry.exp) return entry;
    return null;
  } catch {
    return null;
  }
}

async function persist(entry: JwtCacheEntry): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: entry });
  } catch {
    // Non-blocking — memory cache is authoritative for the active SW.
  }
}

async function fetchFreshJwt(repToken: string, apiBase: string): Promise<JwtCacheEntry | null> {
  try {
    const resp = await fetch(`${apiBase}/api/v1/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rep-Token': repToken,
      },
      body: '{}',
    });
    if (!resp.ok) {
      let body: { error?: string } = {};
      try {
        body = await resp.json();
      } catch {
        body = {};
      }
      if (
        resp.status === 401 &&
        ['rep_token_revoked', 'rep_token_expired', 'invalid_rep_token'].includes(String(body.error || ''))
      ) {
        await markRepAccessEnded(String(body.error));
      }
      return null;
    }
    const data = (await resp.json()) as { token?: string };
    if (!data?.token) return null;
    const exp = decodeExp(data.token);
    if (!exp) return null;
    return { token: data.token, exp };
  } catch {
    return null;
  }
}

export async function getJWT(apiBase: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);

  if (memoryCache && memoryCache.exp - now > REFRESH_BUFFER_SECONDS) {
    return memoryCache.token;
  }

  if (!memoryCache) {
    const stored = await loadFromStorage();
    if (stored && stored.exp - now > REFRESH_BUFFER_SECONDS) {
      memoryCache = stored;
      return stored.token;
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const repToken = await getRepToken();
      if (!repToken) return null;
      const fresh = await fetchFreshJwt(repToken, apiBase);
      if (!fresh) return null;
      memoryCache = fresh;
      await persist(fresh);
      return fresh.token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function clearJwtCache(): Promise<void> {
  memoryCache = null;
  try {
    await browser.storage.local.remove(STORAGE_KEY);
  } catch {
    // ignore
  }
}
