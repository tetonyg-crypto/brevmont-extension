import { describe, expect, it } from 'vitest';
import { profileUsernameFromUrl } from '../../entrypoints/lib/platforms/instagram';

// 2026-09-26 confirmed live: "+Lead > Scan This Page" on a real Instagram
// profile (instagram.com/cardogvlogs/) failed with "no_adapter_for_url"
// because only /direct thread routes were ever recognized as Instagram.
describe('Instagram profile URL -> username', () => {
  it('reads the username off a bare profile URL', () => {
    expect(profileUsernameFromUrl('https://www.instagram.com/cardogvlogs/')).toBe('cardogvlogs');
    expect(profileUsernameFromUrl('https://www.instagram.com/cardogvlogs/?hl=en')).toBe('cardogvlogs');
    expect(profileUsernameFromUrl('https://www.instagram.com/cardogvlogs')).toBe('cardogvlogs');
  });

  it('rejects Instagram-reserved top-level routes', () => {
    expect(profileUsernameFromUrl('https://www.instagram.com/direct/inbox/')).toBeNull();
    expect(profileUsernameFromUrl('https://www.instagram.com/explore/')).toBeNull();
    expect(profileUsernameFromUrl('https://www.instagram.com/reels/')).toBeNull();
    expect(profileUsernameFromUrl('https://www.instagram.com/p/AbC123xyz/')).toBeNull();
  });

  it('rejects a thread route', () => {
    expect(profileUsernameFromUrl('https://www.instagram.com/direct/t/1234567890/')).toBeNull();
  });

  it('returns null for the bare host', () => {
    expect(profileUsernameFromUrl('https://www.instagram.com/')).toBeNull();
  });
});
