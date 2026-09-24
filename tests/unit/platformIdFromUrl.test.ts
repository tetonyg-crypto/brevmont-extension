/**
 * Regression lock: public website platform claims must not drift from
 * registry host matching. LinkedIn detection broke in past releases when
 * URL routing and adapter hosts diverged; TikTok logos on /reps are a
 * marketing signal only, not an adapter. X (x.com) DID get a real native
 * adapter on 2026-09-23 — see entrypoints/lib/platforms/x.ts — so its
 * routing is asserted precisely below instead of blanket-excluded.
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

  it('does not invent adapters for website logo-only surfaces (TikTok)', () => {
    expect(platformIdFromUrl('https://www.tiktok.com/@dealer/messages')).toBeNull();
    expect(platformIdFromUrl('https://www.tiktok.com/messages')).toBeNull();
  });

  // 2026-09-23: X/XChat native adapter added (see entrypoints/lib/platforms/x.ts).
  // Prior to this, x.com/twitter.com were treated as logo-only surfaces with no
  // adapter at all — that changed today, so the old blanket "never route X"
  // assertion above was replaced with the precise routing rules below.
  it('routes active X DM/XChat threads to the x adapter', () => {
    expect(platformIdFromUrl('https://x.com/i/chat/1234567890123456789')).toBe('x');
    expect(platformIdFromUrl('https://x.com/messages/1234567890-9876543210')).toBe('x');
  });

  it('routes the X DM inbox root to the x adapter too (thread-open gating is the adapter\'s job, not the router\'s)', () => {
    expect(platformIdFromUrl('https://x.com/messages')).toBe('x');
    expect(platformIdFromUrl('https://x.com/messages/')).toBe('x');
  });

  // REGRESSION (found via live automated testing, 2026-09-23): clicking
  // into Messages on real X actually lands on the BARE route
  // `x.com/i/chat` — no id, no `/messages` anywhere in the URL at all.
  // The original routing only checked `/i/chat/` (trailing slash
  // required) and `/messages` shapes, so this exact real URL fell
  // through to null — X silently NOT recognized as a platform on its
  // own real inbox-root page.
  it('routes the real X inbox-root redirect target (bare x.com/i/chat, no trailing slash) to the x adapter', () => {
    expect(platformIdFromUrl('https://x.com/i/chat')).toBe('x');
    expect(platformIdFromUrl('https://x.com/i/chat/')).toBe('x');
  });

  it('does not treat X compose-new-message as an existing thread', () => {
    expect(platformIdFromUrl('https://x.com/messages/compose')).toBeNull();
  });

  it('does not route bare x.com feed/profile/post pages to the x adapter', () => {
    expect(platformIdFromUrl('https://x.com/home')).toBeNull();
    expect(platformIdFromUrl('https://x.com/some_account')).toBeNull();
    expect(platformIdFromUrl('https://x.com/some_account/status/1234567890')).toBeNull();
  });

  it('does not invent an adapter for bare twitter.com (no content-script/host-permission coverage added for it)', () => {
    expect(platformIdFromUrl('https://twitter.com/messages')).toBeNull();
  });

  it('does not treat generic CDK marketing domains as adapters (elead hosts only)', () => {
    expect(platformIdFromUrl('https://www.cdkglobal.com/')).toBeNull();
    expect(platformIdFromUrl('https://www.elead-crm.com/desk')).toBe('elead');
  });
});
