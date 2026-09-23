/**
 * PROFILE-SYNC-404 fix helpers.
 *
 * The onboarding wizard used to POST to `/api/rep-profile`, a route that
 * doesn't exist on the live API — silently swallowed by a try/catch, so
 * job title, years experience, tone, languages, and market-type answers
 * were never persisted server-side (see entrypoints/onboarding/main.ts,
 * syncProfileToSupabase).
 *
 * The real route is `PATCH /api/v1/rep/profile` (brevmont-api
 * routes/rep-profile.js), which only accepts `name`/`display_name`,
 * `phone`, and `preferred_language` (one of "en" | "es" | "auto"). It has
 * no columns for job title, years experience, tone, or market type — those
 * stay local-only (chrome.storage.local), same as before. This persists
 * the subset the server actually has a home for, instead of 404ing on all
 * of it.
 */

export type OnboardingIdentity = {
  firstName?: string;
  lastName?: string;
};

export type OnboardingVoice = {
  languages?: string[];
};

/** Maps the onboarding wizard's language chip selections to the server's enum. */
export function repProfileLanguageFromOnboarding(languages: string[] | undefined): 'en' | 'es' | 'auto' {
  const set = new Set((languages || []).map((l) => String(l || '').toLowerCase()));
  const hasEnglish = set.has('english') || set.has('en');
  const hasSpanish = set.has('spanish') || set.has('es');
  if (hasEnglish && hasSpanish) return 'auto';
  if (hasSpanish) return 'es';
  return 'en';
}

/** Builds the PATCH /api/v1/rep/profile request body from onboarding answers. */
export function buildRepProfileSyncBody(profile: {
  identity: OnboardingIdentity;
  voice: OnboardingVoice;
}): Record<string, unknown> {
  const name = [profile.identity.firstName, profile.identity.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  const body: Record<string, unknown> = {
    preferred_language: repProfileLanguageFromOnboarding(profile.voice.languages),
  };
  if (name) body.name = name;
  return body;
}
