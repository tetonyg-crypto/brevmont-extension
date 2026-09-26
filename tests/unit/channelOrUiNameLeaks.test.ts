/**
 * Regression lock, 2026-09-26: two live UI-text-leak bugs reported during
 * profile-page scanning testing.
 *
 * 1. LinkedIn: "This for LinkedIn Follow Compa...?" -- a promoted-card
 *    sidebar's "Follow Company"-style label got flattened together with
 *    the tab title ("(14) LinkedIn") into one string with no separator,
 *    and reached the chip as though it were the customer's name.
 * 2. Facebook: "Personal details" -- the About-tab's own section header
 *    reached the chip as though it were the customer's name when profile
 *    scanning was added this release.
 */
import { describe, expect, it } from 'vitest';
import { isChannelOrUiName } from '../../entrypoints/lib/leadContextScan';

describe('isChannelOrUiName', () => {
  it('rejects text starting with the platform name as a prefix (LinkedIn case)', () => {
    expect(isChannelOrUiName('LinkedIn Follow Company')).toBe(true);
    expect(isChannelOrUiName('linkedin follow compa')).toBe(true);
  });

  it('still rejects the equivalent facebook/messenger/marketplace/instagram/whatsapp prefixes', () => {
    expect(isChannelOrUiName('Facebook Marketplace')).toBe(true);
    expect(isChannelOrUiName('Messenger Requests')).toBe(true);
    expect(isChannelOrUiName('Marketplace Buyer')).toBe(true);
    expect(isChannelOrUiName('Instagram Direct')).toBe(true);
    expect(isChannelOrUiName('WhatsApp Web')).toBe(true);
  });

  it('rejects Facebook About-tab section headers as customer names', () => {
    expect(isChannelOrUiName('Personal details')).toBe(true);
    expect(isChannelOrUiName('Overview')).toBe(true);
    expect(isChannelOrUiName('Contact info')).toBe(true);
    expect(isChannelOrUiName('Places lived')).toBe(true);
  });

  it('still accepts an ordinary human name', () => {
    expect(isChannelOrUiName('Oleg Melnikov')).toBe(false);
    expect(isChannelOrUiName('Kamran Khan')).toBe(false);
  });

  // 2026-09-26 regression: a Facebook profile's own nav tab bar (All /
  // About / Friends / Photos / Reels / More) sits directly below the name
  // heading. When the profile header reader missed the real name element,
  // it fell through to a tab label instead -- confirmed live: "This for
  // Reels?" reached the chip on a real Facebook profile page.
  it('rejects Facebook profile nav tab labels as customer names', () => {
    for (const label of ['All', 'Friends', 'Photos', 'Videos', 'Reels', 'Reviews', 'Check-ins', 'Likes', 'Events', 'Groups', 'More']) {
      expect(isChannelOrUiName(label)).toBe(true);
    }
  });
});
