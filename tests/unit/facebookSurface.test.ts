import { describe, expect, it } from 'vitest';
import { classifyFacebookSurface } from '../../entrypoints/lib/platforms/facebookSurface';

describe('Facebook surface classifier', () => {
  it.each([
    ['https://www.facebook.com/alex.hormozi', 'profile_direct', true],
    ['https://www.facebook.com/profile.php?id=12345', 'profile_numeric', true],
    ['https://www.facebook.com/groups/467706240992641/user/612948509/', 'profile_group_member', true],
    ['https://www.facebook.com/people/Jane-Doe/12345/', 'profile_people', true],
    ['https://www.facebook.com/messages/t/9988', 'messenger_thread', true],
    ['https://www.facebook.com/marketplace/t/9988', 'marketplace_thread', true],
    ['https://www.facebook.com/', 'home_feed', false],
    ['https://www.facebook.com/groups/467706240992641', 'group_feed', false],
    ['https://www.facebook.com/notifications', 'unsupported', false],
    ['https://www.facebook.com/search/top?q=alex', 'unsupported', false],
  ])('%s → %s', (url, surface, supported) => {
    expect(classifyFacebookSurface(url)).toMatchObject({ surface, supported });
  });

  it('canonicalizes a group-member profile to its stable numeric identity', () => {
    expect(classifyFacebookSurface('https://www.facebook.com/groups/44/user/612948509/')).toMatchObject({
      profile_id: '612948509',
      username: null,
      route_key: 'fb_profile:id:612948509',
      canonical_profile_url: 'https://www.facebook.com/profile.php?id=612948509',
    });
  });
});
