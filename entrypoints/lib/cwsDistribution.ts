export const BREVMONT_CWS_BASE =
  'https://chromewebstore.google.com/detail/brevmont-ai-sales-co-pilo/onbnhkpggamfbnjdaelgimgimcchamah';
export const BREVMONT_CWS_REVIEWS = `${BREVMONT_CWS_BASE}/reviews`;
export const BREVMONT_WELCOME_URL = 'https://app.brevmont.com/welcome?utm_source=cws&utm_medium=extension&utm_campaign=post_install';
export const BREVMONT_UNINSTALL_URL = 'https://app.brevmont.com/uninstall-survey?utm_source=cws&utm_medium=extension&utm_campaign=uninstall';

export const REVIEW_PROMPT_STATE_KEY = 'brevmont_review_prompt_state';
export const LOCAL_GENERATION_COUNT_KEY = 'brevmont_local_generation_count';
export const REFERRAL_CODE_KEY = 'brevmont_referral_code';
export const REFERRAL_CLAIMED_KEY = 'brevmont_referral_claimed_first_generation';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type ReviewPromptState = {
  clicked?: boolean;
  dismissed_until?: number;
  shown_at?: number;
};

export function shouldShowReviewPrompt(count: number, state: ReviewPromptState | null | undefined, now = Date.now()): boolean {
  if (count < 1) return false;
  if (state?.clicked) return false;
  if (Number(state?.dismissed_until || 0) > now) return false;
  return true;
}

export function dismissedReviewState(now = Date.now()): ReviewPromptState {
  return { dismissed_until: now + THIRTY_DAYS_MS };
}

export function reviewClickedState(now = Date.now()): ReviewPromptState {
  return { clicked: true, shown_at: now };
}

export function cwsLinkFor(channel: string, campaign: string, medium = 'extension'): string {
  const params = new URLSearchParams({
    utm_source: channel,
    utm_medium: medium,
    utm_campaign: campaign,
  });
  return `${BREVMONT_CWS_BASE}?${params.toString()}`;
}
