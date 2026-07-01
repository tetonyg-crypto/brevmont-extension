export type LicenseAccessState = 'revoked' | 'trial_ended';

export const TRIAL_ENDED_TITLE = '7-day trial ended';
export const TRIAL_ENDED_BODY = 'Your GM can activate the pilot to reopen access.';
export const TRIAL_ENDED_CTA = 'Notify GM';

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
