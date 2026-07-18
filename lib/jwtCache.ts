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

import { TRIAL_ENDED_BODY, classifyAccessError, getAccessErrorCode } from './accessState';

const REFRESH_BUFFER_SECONDS = 60;
const STORAGE_KEY = 'brevmont_jwt_cache';
const JWT_FETCH_TIMEOUT_MS = 8_000;

interface JwtCacheEntry {
  token: string;
  exp: number; // unix seconds
  rep_auth_token?: string;
}

let memoryCache: JwtCacheEntry | null = null;
let inflight: Promise<string | null> | null = null;
let inflightRepToken: string | null = null;

async function markRepAccessEnded(errorCode: string, accessState: 'revoked' | 'trial_ended' = 'revoked'): Promise<void> {
  memoryCache = null;
  try {
    await browser.storage.local.remove(STORAGE_KEY);
    await browser.storage.local.set({
      license_revoked: true,
      license_revoked_at: Date.now(),
      license_revoked_message: accessState === 'trial_ended'
        ? TRIAL_ENDED_BODY
        : 'Your access at this dealership has ended. Been invited to a new store? Reconnect below.',
      license_access_state: accessState,
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
    return null;
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

async function persist(entry: JwtCacheEntry, repToken: string): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: { ...entry, rep_auth_token: repToken } });
  } catch {
    // Non-blocking — memory cache is authoritative for the active SW.
  }
}

async function fetchFreshJwt(repToken: string, apiBase: string): Promise<JwtCacheEntry | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JWT_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${apiBase}/api/v1/auth/token`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Rep-Token': repToken,
      },
      body: '{}',
    });
    if (!resp.ok) {
      let body: any = {};
      try {
        body = await resp.json();
      } catch {
        body = {};
      }
      const accessState = classifyAccessError(resp.status, body);
      if (accessState) {
        const errorCode = getAccessErrorCode(body) || 'invalid_rep_token';
        await markRepAccessEnded(errorCode, accessState);
        throw new Error(errorCode);
      }
      return null;
    }
    const data = (await resp.json()) as { token?: string };
    if (!data?.token) return null;
    const exp = decodeExp(data.token);
    if (!exp) return null;
    return { token: data.token, exp };
  } catch (error) {
    if (/^(?:invalid_rep_token|rep_token_revoked|rep_token_expired|license_revoked)$/i.test(String((error as Error)?.message || error))) {
      throw error;
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getJWT(apiBase: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const repToken = await getRepToken();
  if (!repToken) {
    memoryCache = null;
    return null;
  }

  if (
    memoryCache &&
    memoryCache.rep_auth_token === repToken &&
    memoryCache.exp - now > REFRESH_BUFFER_SECONDS
  ) {
    return memoryCache.token;
  }

  const stored = await loadFromStorage();
  if (
    stored &&
    stored.rep_auth_token === repToken &&
    stored.exp - now > REFRESH_BUFFER_SECONDS
  ) {
    memoryCache = stored;
    return stored.token;
  }

  if (inflight && inflightRepToken === repToken) return inflight;

  inflightRepToken = repToken;
  inflight = (async () => {
    try {
      const fresh = await fetchFreshJwt(repToken, apiBase);
      if (!fresh) return null;
      memoryCache = { ...fresh, rep_auth_token: repToken };
      await persist(fresh, repToken);
      return memoryCache.token;
    } finally {
      inflight = null;
      inflightRepToken = null;
    }
  })();

  return inflight;
}

export async function clearJwtCache(): Promise<void> {
  memoryCache = null;
  inflightRepToken = null;
  try {
    await browser.storage.local.remove(STORAGE_KEY);
  } catch {
    // ignore
  }
}
