/**
 * Tool: authSigning.ts
 * Purpose: JWT-based request authentication. Phase 3 (2026-05-06) replaced
 *          HMAC-SHA256 signing with short-lived bearer JWTs minted by
 *          POST /api/v1/auth/token. Function names preserved (signedFetch,
 *          signedGet) so all ~50 call sites continue to work unchanged.
 * Inputs: rep_auth_token (storage), API base URL
 * Outputs: signedFetch(url, body, extraHeaders), signedGet(url, extraHeaders)
 * Dependencies: jwtCache.ts, fetch
 * Last Updated: 2026-05-06
 * Changelog:
 *   - 2026-04-12: Initial creation — Phase 1 HMAC signing client
 *   - 2026-05-06: Phase 3 — switched to JWT bearer auth, removed HMAC
 */

import { getJWT } from './jwtCache';

const PROXY_URL = 'https://api.brevmont.com';

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const jwt = await getJWT(PROXY_URL);
  if (jwt) return { Authorization: `Bearer ${jwt}` };

  // Fallback: legacy rep_auth_token UUID via X-Rep-Token. The dual-validation
  // middleware in the API (Phase 3 requireExtensionAuth) accepts this path
  // for any extension that hasn't yet acquired a JWT. Used only on the very
  // first call after install; getJWT() succeeds on subsequent calls.
  try {
    const local = await browser.storage.local.get(['rep_auth_token', 'brevmont_rep_auth_token']);
    const token =
      (local.rep_auth_token as string | undefined) ||
      (local.brevmont_rep_auth_token as string | undefined);
    if (token) return { 'X-Rep-Token': token };
  } catch {
    // ignore
  }
  return {};
}

export async function signedFetch(
  url: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const auth = await buildAuthHeaders();
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export async function signedPatch(
  url: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const auth = await buildAuthHeaders();
  return fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export async function signedGet(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const auth = await buildAuthHeaders();
  return fetch(url, {
    method: 'GET',
    headers: {
      ...auth,
      ...extraHeaders,
    },
  });
}

// Legacy: kept exported for any in-flight call sites that pull credentials
// directly. Returns null in v1.16.0+ since license_secret is no longer issued.
export async function getLicenseCredentials(): Promise<null> {
  return null;
}

// Legacy: kept exported so the type surface doesn't break callers that
// imported buildSignedHeaders. Always returns an empty object — Phase 3
// auth is bearer-JWT, not HMAC. Remove after grep shows zero callers.
export async function buildSignedHeaders(
  _licenseKey: string,
  _licenseSecret: string,
  _method: string,
  _path: string,
  _bodyString: string,
): Promise<Record<string, string>> {
  return {};
}
