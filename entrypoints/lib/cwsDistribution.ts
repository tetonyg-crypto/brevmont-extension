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

// 2026-09-25 founder-reported defect: three near-identical browser tabs
// opened around a single install/onboarding flow. Root cause: two
// independent, uncoordinated call sites each did a raw chrome.tabs.create
// to this exact welcome URL with no check for one already being open --
// background.ts's onInstalled handler (when cookie auto-config doesn't
// land) and the side panel's own "Get started" button, neither aware the
// other exists. Both contexts now route through this shared helper instead
// of calling tabs.create directly for this URL. Takes the tabs/windows APIs
// as parameters (rather than importing `browser`/`chrome` here) so this
// stays a plain, testable function that works from either the background
// script (wxt's `browser` polyfill) or the side panel (raw `chrome` global).
export interface WelcomeTabQueryResult {
  id?: number;
  windowId?: number;
}
export interface WelcomeTabTabsApi {
  query: (queryInfo: { url?: string | string[] }) => Promise<WelcomeTabQueryResult[]>;
  create: (props: { url: string; active?: boolean }) => Promise<unknown>;
  update: (tabId: number, props: { active: boolean }) => Promise<unknown>;
}
export interface WelcomeTabWindowsApi {
  update: (windowId: number, props: { focused: boolean }) => Promise<unknown>;
}

export async function openOrFocusWelcomeTab(
  tabsApi: WelcomeTabTabsApi,
  windowsApi?: WelcomeTabWindowsApi,
): Promise<void> {
  try {
    const origin = BREVMONT_WELCOME_URL.split('?')[0];
    const existing = await tabsApi.query({ url: `${origin}*` });
    const match = existing.find((tab) => tab.id != null);
    if (match?.id != null) {
      await tabsApi.update(match.id, { active: true });
      if (windowsApi && match.windowId != null) {
        try { await windowsApi.update(match.windowId, { focused: true }); } catch { /* best effort */ }
      }
      return;
    }
  } catch {
    // tabs.query unsupported/failed -- fall through to opening a new tab
    // rather than silently doing nothing.
  }
  await tabsApi.create({ url: BREVMONT_WELCOME_URL, active: true });
}
