import { describe, expect, it } from 'vitest';
import { profileHandleFromUrl } from '../../entrypoints/lib/platforms/x';

// 2026-09-26 confirmed live: the "This for <name>?" chip already detects an
// X profile (generic title fallback found "Kamran Khan"), but
// "+Lead > Scan This Page" failed with "Couldn't read this page" because
// only DM thread routes were ever recognized as X.
describe('X profile URL -> handle', () => {
  it('reads the handle off a bare profile URL', () => {
    expect(profileHandleFromUrl('https://x.com/itskamrankhan')).toBe('itskamrankhan');
    expect(profileHandleFromUrl('https://x.com/itskamrankhan/')).toBe('itskamrankhan');
  });

  it('rejects X-reserved top-level routes', () => {
    expect(profileHandleFromUrl('https://x.com/home')).toBeNull();
    expect(profileHandleFromUrl('https://x.com/messages')).toBeNull();
    expect(profileHandleFromUrl('https://x.com/i/chat/123')).toBeNull();
    expect(profileHandleFromUrl('https://x.com/notifications')).toBeNull();
  });

  it('rejects a status/post permalink (a post, not a profile)', () => {
    expect(profileHandleFromUrl('https://x.com/itskamrankhan/status/1234567890')).toBeNull();
  });

  it('returns null for the bare host', () => {
    expect(profileHandleFromUrl('https://x.com/')).toBeNull();
    expect(profileHandleFromUrl('https://x.com')).toBeNull();
  });
});
