/**
 * Regression lock: public website platform claims must not drift from
 * registry host matching. LinkedIn detection broke in past releases when
 * URL routing and adapter hosts diverged; TikTok/X logos on /reps are
 * marketing signals today, not adapters.
 */
import { describe, expect, it } from 'vitest';
import { platformIdFromUrl } from '../../entrypoints/lib/platforms/registry';

describe('platformIdFromUrl', () => {
  it('routes LinkedIn messaging and profile URLs to the linkedin adapter', () => {
    expect(platformIdFromUrl('https://www.linkedin.com/messaging/thread/2-abc/')).toBe('linkedin');
    expect(platformIdFromUrl('https://www.linkedin.com/in/someone/')).toBe('linkedin');
  });

  it('routes core claimed surfaces that have adapters', () => {
    expect(platformIdFromUrl('https://www.facebook.com/messages/t/123')).toBe('facebook');
    expect(platformIdFromUrl('https://www.instagram.com/direct/t/123')).toBe('instagram');
    expect(platformIdFromUrl('https://mail.google.com/mail/u/0/#inbox')).toBe('gmail');
    expect(platformIdFromUrl('https://app.vinsolutions.com/VinManager/')).toBe('vinsolutions');
    expect(platformIdFromUrl('https://login.eleadcrm.com/desk/')).toBe('elead');
  });

  it('routes the Instagram inbox root to the instagram adapter too (thread-open gating is the adapter\'s job, not the router\'s)', () => {
    expect(platformIdFromUrl('https://www.instagram.com/direct/inbox/')).toBe('instagram');
  });

  it('does not route bare instagram.com (feed/profile pages, no DM surface) to the instagram adapter', () => {
    expect(platformIdFromUrl('https://www.instagram.com/some_account/')).toBeNull();
  });

  it('does not invent adapters for website logo-only surfaces (TikTok, X)', () => {
    expect(platformIdFromUrl('https://www.tiktok.com/@dealer/messages')).toBeNull();
    expect(platformIdFromUrl('https://www.tiktok.com/messages')).toBeNull();
    expect(platformIdFromUrl('https://x.com/messages/compose')).toBeNull();
    expect(platformIdFromUrl('https://twitter.com/messages')).toBeNull();
  });

  it('does not treat generic CDK marketing domains as adapters (elead hosts only)', () => {
    expect(platformIdFromUrl('https://www.cdkglobal.com/')).toBeNull();
    expect(platformIdFromUrl('https://www.elead-crm.com/desk')).toBe('elead');
  });
});
