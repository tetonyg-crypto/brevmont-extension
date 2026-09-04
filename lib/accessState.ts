export type LicenseAccessState = 'revoked' | 'trial_ended';

export const TRIAL_ENDED_TITLE = '7-day trial ended';
export const TRIAL_ENDED_BODY = 'Keep Brevmont for $24.99/mo to reopen follow-ups.';
export const TRIAL_ENDED_CTA = 'Subscribe $24.99';
export const TRIAL_ENDED_BILLING_URL = 'https://app.brevmont.com/rep/billing';

// chrome.storage.local key holding a server-provided billing URL for the
// trial-ended CTA. Falls back to TRIAL_ENDED_BILLING_URL when absent/invalid.
export const TRIAL_ENDED_BILLING_STORAGE_KEY = 'trial_ended_billing_url';

// Validate a stored billing URL before opening it: must be https and on a
// brevmont.com host, otherwise fall back to the canonical billing URL. Never
// open an attacker-controlled or off-domain link from stored state.
export function trialEndedBillingUrl(stored?: string | null): string {
  const raw = String(stored || '').trim();
  if (!raw) return TRIAL_ENDED_BILLING_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return TRIAL_ENDED_BILLING_URL;
    const host = parsed.hostname;
    if (host !== 'app.brevmont.com' && !host.endsWith('.brevmont.com')) return TRIAL_ENDED_BILLING_URL;
    return parsed.toString();
  } catch {
    return TRIAL_ENDED_BILLING_URL;
  }
}

const REVOKED_ERROR_CODES = new Set([
  'license_revoked',
  'rep_token_revoked',
  'rep_token_expired',
  'invalid_rep_token',
]);

export function getAccessErrorCode(body: any): string {
  const candidates = [
    body?.error_code,
    body?.error,
    body?.code,
    body?.error?.code,
    body?.error?.error_code,
  ];
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '')
    .trim()
    .toLowerCase();
}

export function classifyAccessError(status: number, body: any): LicenseAccessState | null {
  if (status !== 401 && status !== 403) return null;
  const code = getAccessErrorCode(body);
  if (code === 'trial_ended') return 'trial_ended';
  if (REVOKED_ERROR_CODES.has(code)) return 'revoked';
  return null;
}

export function accessEndedTitle(state?: string | null): string {
  return state === 'trial_ended' ? TRIAL_ENDED_TITLE : 'Access ended';
}

export function accessEndedBody(state?: string | null, message?: string | null): string {
  if (state === 'trial_ended') return TRIAL_ENDED_BODY;
  return message || 'Your access at this dealership has ended. Been invited to a new store? Reconnect below.';
}

export function accessBlockedMessage(state?: string | null, message?: string | null): string {
  if (state === 'trial_ended') return `${TRIAL_ENDED_TITLE}. ${TRIAL_ENDED_BODY}`;
  return accessEndedBody(state, message);
}
