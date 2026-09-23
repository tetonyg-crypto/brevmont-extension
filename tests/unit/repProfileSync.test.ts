import { describe, expect, it } from 'vitest';
import { buildRepProfileSyncBody, repProfileLanguageFromOnboarding } from '../../lib/repProfileSync';

// PROFILE-SYNC-404: locks in the real PATCH /api/v1/rep/profile contract
// (name/display_name + preferred_language) so onboarding-profile sync never
// silently regresses back to the dead /api/rep-profile route or invented
// field names the server doesn't accept.
describe('repProfileLanguageFromOnboarding', () => {
  it('maps english-only to en', () => {
    expect(repProfileLanguageFromOnboarding(['english'])).toBe('en');
  });

  it('maps spanish-only to es', () => {
    expect(repProfileLanguageFromOnboarding(['spanish'])).toBe('es');
  });

  it('maps bilingual selection to auto', () => {
    expect(repProfileLanguageFromOnboarding(['english', 'spanish'])).toBe('auto');
  });

  it('defaults to en when nothing is selected', () => {
    expect(repProfileLanguageFromOnboarding(undefined)).toBe('en');
    expect(repProfileLanguageFromOnboarding([])).toBe('en');
  });
});

describe('buildRepProfileSyncBody', () => {
  it('sends only the fields the real endpoint accepts', () => {
    const body = buildRepProfileSyncBody({
      identity: { firstName: 'Alex', lastName: 'Morgan' },
      voice: { languages: ['english', 'spanish'] },
    });
    expect(body).toEqual({ name: 'Alex Morgan', preferred_language: 'auto' });
    // Must never resurrect the dead/invented fields the old POST sent.
    expect(body).not.toHaveProperty('first_name');
    expect(body).not.toHaveProperty('job_title');
    expect(body).not.toHaveProperty('years_experience');
    expect(body).not.toHaveProperty('tone');
    expect(body).not.toHaveProperty('market_type');
    expect(body).not.toHaveProperty('dealership');
  });

  it('omits name when identity is empty', () => {
    const body = buildRepProfileSyncBody({ identity: {}, voice: { languages: [] } });
    expect(body).toEqual({ preferred_language: 'en' });
  });
});
