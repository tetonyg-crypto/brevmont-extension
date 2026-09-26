/**
 * 2026-09-26 founder directive: a capture off a static profile page
 * (Instagram/X/Facebook/LinkedIn "About") should relabel as a Prospect,
 * not a "Buyer" mid-conversation. isProfilePageRawSource is the gate the
 * sidepanel uses to decide this from each adapter's raw_source tag.
 */
import { describe, expect, it } from 'vitest';
import { isProfilePageRawSource, safeSocialProfileUrl } from '../../entrypoints/lib/platforms/shared';

describe('isProfilePageRawSource', () => {
  it('matches every platform profile-capture raw_source tag', () => {
    expect(isProfilePageRawSource('ig_profile_heading')).toBe(true);
    expect(isProfilePageRawSource('ig_profile_username')).toBe(true);
    expect(isProfilePageRawSource('ig_profile_display_name')).toBe(true);
    expect(isProfilePageRawSource('x_profile_username_block')).toBe(true);
    expect(isProfilePageRawSource('x_profile_handle')).toBe(true);
    expect(isProfilePageRawSource('fb_profile_heading')).toBe(true);
    expect(isProfilePageRawSource('linkedin_profile_person')).toBe(true);
  });

  it('does not match a real thread/DM capture', () => {
    expect(isProfilePageRawSource('linkedin_person')).toBe(false);
    expect(isProfilePageRawSource('ig_thread_header')).toBe(false);
    expect(isProfilePageRawSource('x_thread_header')).toBe(false);
    expect(isProfilePageRawSource('fb_conversation')).toBe(false);
  });

  it('does not match a header fallback that merely failed to find a name inside a real thread', () => {
    expect(isProfilePageRawSource('ig_header_profile_link_only')).toBe(false);
    expect(isProfilePageRawSource('x_header_profile_link_only')).toBe(false);
  });

  it('handles null/undefined/empty safely', () => {
    expect(isProfilePageRawSource(null)).toBe(false);
    expect(isProfilePageRawSource(undefined)).toBe(false);
    expect(isProfilePageRawSource('')).toBe(false);
  });
});

describe('safeSocialProfileUrl', () => {
  it('keeps supported canonical profile links', () => {
    expect(safeSocialProfileUrl('https://www.instagram.com/cardogvlogs/')).toBe('https://www.instagram.com/cardogvlogs/');
    expect(safeSocialProfileUrl('https://www.linkedin.com/in/yancy-garcia/')).toBe('https://www.linkedin.com/in/yancy-garcia/');
  });

  it('rejects unsafe protocols and unrelated hosts', () => {
    expect(safeSocialProfileUrl('javascript:alert(1)')).toBeNull();
    expect(safeSocialProfileUrl('https://instagram.com.example.com/cardogvlogs')).toBeNull();
  });
});
