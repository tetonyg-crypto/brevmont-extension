/**
 * Tool: authSigning.ts
 * Purpose: HMAC-SHA256 request signing for Brevmont proxy authentication
 * Inputs: License key, license secret, request details
 * Outputs: Signed headers object
 * Dependencies: Web Crypto API (built into Chrome extensions)
 * Last Updated: 2026-04-12
 * Changelog:
 *   - 2026-04-12: Initial creation — Phase 1 signing client
 */

const encoder = new TextEncoder();

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function buildSignedHeaders(
  licenseKey: string,
  licenseSecret: string,
  method: string,
  path: string,
  bodyString: string
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const bodyHash = await sha256Hex(bodyString);
  const canonical = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  const signature = await hmacSha256Hex(licenseSecret, canonical);

  return {
    'X-Brevmont-License-Key': licenseKey,
    'X-Brevmont-Timestamp': timestamp,
    'X-Brevmont-Nonce': nonce,
    'X-Brevmont-Signature': signature,
  };
}

// Get license credentials from storage
export async function getLicenseCredentials(): Promise<{ key: string; secret: string } | null> {
  try {
    const result = await browser.storage.local.get(['brevmont_license_secret']);
    const syncResult = await browser.storage.sync.get(['dealer_token']);
    const key = syncResult.dealer_token;
    const secret = result.brevmont_license_secret;
    if (!key || !secret) return null;
    return { key, secret };
  } catch {
    return null;
  }
}

// Signed fetch wrapper — adds HMAC headers to any proxy POST request
export async function signedFetch(
  url: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const creds = await getLicenseCredentials();
  const bodyString = JSON.stringify(body);
  const urlObj = new URL(url);

  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  // If we have credentials, sign the request
  if (creds) {
    const signedHeaders = await buildSignedHeaders(
      creds.key,
      creds.secret,
      'POST',
      urlObj.pathname,
      bodyString
    );
    headers = { ...headers, ...signedHeaders };
  }
  // If no credentials, request goes unsigned — Phase 1 allows this

  return fetch(url, {
    method: 'POST',
    headers,
    body: bodyString,
  });
}

// Signed GET wrapper — adds HMAC headers to proxy GET requests (status polls etc.).
// Body hash is computed over the empty string so the canonical matches what the
// server would compute for a no-body GET. Server-side enforcement on GET routes
// is not yet active, but signing now keeps the auth surface consistent and
// lets us flip the enforcement flag later without a coordinated client rev.
export async function signedGet(
  url: string,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const creds = await getLicenseCredentials();
  const urlObj = new URL(url);

  let headers: Record<string, string> = {
    ...extraHeaders,
  };

  if (creds) {
    const signedHeaders = await buildSignedHeaders(
      creds.key,
      creds.secret,
      'GET',
      urlObj.pathname,
      ''
    );
    headers = { ...headers, ...signedHeaders };
  }

  return fetch(url, {
    method: 'GET',
    headers,
  });
}
