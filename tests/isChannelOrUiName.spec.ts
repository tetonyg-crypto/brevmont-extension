import { test, expect } from '@playwright/test';
import { cleanCustomerNameCandidate, isChannelOrUiName, isUiActionPromptLabel, stripConversationWrapper } from '../entrypoints/lib/leadContextScan';

/**
 * Regression tests for the customer-name UI-label gate.
 *
 * 2026-07-03: live prod bug — Facebook Marketplace thread for Cardog
 * (a real Marketplace buyer whose Facebook account has no friendly
 * display name) generated a follow-up starting "Hi Conversation Titled
 * Cardog, this is Yancy Garcia..." The blocklist was missing:
 *   - "Conversation titled X" (h1 fallback pattern)
 *   - "Actions" (aria-label of the sidebar action strip)
 *   - "Chat with X" (aria-label variant)
 *   - "X started this chat" (system message in thread body)
 *
 * The tests below assert both directions: known bad UI strings return
 * true (blocked), known good names return false (accepted).
 */

test.describe('isChannelOrUiName — regression coverage', () => {
  test('blocks the 2026-07-03 Cardog regression inputs', () => {
    expect(isChannelOrUiName('Conversation titled Cardog')).toBe(true);
    expect(isChannelOrUiName('conversation titled cardog')).toBe(true);
    expect(isChannelOrUiName('Conversation details Seth')).toBe(true);
    expect(isChannelOrUiName('Actions')).toBe(true);
    expect(isChannelOrUiName('actions')).toBe(true);
    expect(isChannelOrUiName('Chat with Cardog')).toBe(true);
    expect(isChannelOrUiName('chat with someone')).toBe(true);
    expect(isChannelOrUiName('Cardog started this chat')).toBe(true);
    expect(isChannelOrUiName('John Smith started this chat')).toBe(true);
  });

  test('blocks the pre-existing UI/channel labels', () => {
    // From the June 26 policy
    expect(isChannelOrUiName('Messenger')).toBe(true);
    expect(isChannelOrUiName('Marketplace')).toBe(true);
    expect(isChannelOrUiName('Facebook Marketplace')).toBe(true);
    expect(isChannelOrUiName('Buyer')).toBe(true);
    expect(isChannelOrUiName('Seller')).toBe(true);
    expect(isChannelOrUiName('Customer')).toBe(true);
    expect(isChannelOrUiName('Contact')).toBe(true);
    expect(isChannelOrUiName('Lead')).toBe(true);
    expect(isChannelOrUiName('Chats')).toBe(true);
    expect(isChannelOrUiName('Chat')).toBe(true);
    expect(isChannelOrUiName('Conversation')).toBe(true);
    expect(isChannelOrUiName('Profile')).toBe(true);
    expect(isChannelOrUiName('Notifications')).toBe(true);
    expect(isChannelOrUiName('Search')).toBe(true);
    expect(isChannelOrUiName('Inbox')).toBe(true);
    expect(isChannelOrUiName('Gmail')).toBe(true);
    expect(isChannelOrUiName('LinkedIn')).toBe(true);
    expect(isChannelOrUiName('Instagram')).toBe(true);
    expect(isChannelOrUiName('WhatsApp')).toBe(true);
    expect(isChannelOrUiName('VinSolutions')).toBe(true);
    expect(isChannelOrUiName('Brevmont')).toBe(true);
    expect(isChannelOrUiName('Brevmont Labs')).toBe(true);
    expect(isChannelOrUiName('Brevmont Labs LLC')).toBe(true);
    expect(isChannelOrUiName('Save Lead')).toBe(true);
    expect(isChannelOrUiName('Scan This Page')).toBe(true);
    expect(isChannelOrUiName('Options')).toBe(true);
    expect(isChannelOrUiName('Menu')).toBe(true);
    expect(isChannelOrUiName('Archive')).toBe(true);
    expect(isChannelOrUiName('Archived')).toBe(true);
    expect(isChannelOrUiName('Reply')).toBe(true);
    expect(isChannelOrUiName('Settings')).toBe(true);
  });

  test('blocks multi-word listing-header prefixes', () => {
    expect(isChannelOrUiName('SOLD - 2015 Subaru Outback')).toBe(true);
    expect(isChannelOrUiName('Sold 2015 Subaru Outback')).toBe(true);
    expect(isChannelOrUiName('Active listing')).toBe(true);
    expect(isChannelOrUiName('Available now')).toBe(true);
    expect(isChannelOrUiName('New arrival')).toBe(true);
    expect(isChannelOrUiName('Facebook Messages')).toBe(true);
    expect(isChannelOrUiName('Marketplace Buyer')).toBe(true);
    expect(isChannelOrUiName('Instagram Direct')).toBe(true);
  });

  test('blocks empty / whitespace / null-y', () => {
    expect(isChannelOrUiName('')).toBe(true);
    expect(isChannelOrUiName('   ')).toBe(true);
    expect(isChannelOrUiName(null)).toBe(true);
    expect(isChannelOrUiName(undefined)).toBe(true);
    expect(isChannelOrUiName(0)).toBe(true);
  });

  test('ACCEPTS real customer names', () => {
    expect(isChannelOrUiName('Cardog')).toBe(false);
    expect(isChannelOrUiName('John Smith')).toBe(false);
    expect(isChannelOrUiName('Maria Rodriguez')).toBe(false);
    expect(isChannelOrUiName("O'Brien")).toBe(false);
    expect(isChannelOrUiName('Jean-Luc')).toBe(false);
    expect(isChannelOrUiName('Yancy Garcia')).toBe(false);
    expect(isChannelOrUiName('T.J. Miller')).toBe(false);
    expect(isChannelOrUiName('李明')).toBe(false); // non-latin real names
    expect(isChannelOrUiName('José')).toBe(false);
  });

  test('ACCEPTS single-word real names that are NOT UI labels', () => {
    expect(isChannelOrUiName('Cardog')).toBe(false);
    expect(isChannelOrUiName('Sarah')).toBe(false);
    expect(isChannelOrUiName('Mike')).toBe(false);
    // Case sensitivity check — 'CARDOG' should also pass (it's a name, not a label)
    expect(isChannelOrUiName('CARDOG')).toBe(false);
  });

  test('peels Facebook conversation wrapper families before name picking', () => {
    expect(stripConversationWrapper('Conversation titled Cardog')).toBe('Cardog');
    expect(stripConversationWrapper('Conversation details Seth')).toBe('Seth');
    expect(stripConversationWrapper('Conversation info Nora T.')).toBe('Nora T.');
    expect(stripConversationWrapper('Chat with Yancy Garcia')).toBe('Yancy Garcia');
    expect(stripConversationWrapper('Cardog')).toBe('Cardog');
  });

  test('normalizes listing-header names without keeping vehicle suffixes', () => {
    expect(cleanCustomerNameCandidate('Cardog · 2025 Subaru Ascent')).toBe('Cardog');
    expect(cleanCustomerNameCandidate('Archive · 2021 GMC sierra 1500 denali')).toBe('');
    expect(cleanCustomerNameCandidate('Brevmont Labs · 2025 Subaru Ascent')).toBe('');
  });

  /**
   * 2026-09-23 live founder-testing bug: LinkedIn lead capture produced a
   * captured "buyer" literally named "Add section" (LinkedIn profile/detail
   * UI chrome, not a person). Root cause was a generic h1/h2/h3/[role=
   * "heading"] DOM-proximity fallback in extractLinkedInPersonName scoped
   * too broadly (document.querySelector('main, [role="main"]')), which
   * could pick up an "Add section" / "Edit profile" style prompt heading
   * from a details/profile side-panel next to the open thread. Fix is
   * structural (isUiActionPromptLabel: verb + noun shape), not a blacklist
   * of the one literal string, so it also covers every sibling prompt
   * LinkedIn (or any other platform's generic chrome) could produce.
   */
  test('blocks the 2026-09-23 "Add section" LinkedIn false-prospect regression, structurally', () => {
    expect(isChannelOrUiName('Add section')).toBe(true);
    expect(isChannelOrUiName('add section')).toBe(true);
    expect(isUiActionPromptLabel('Add section')).toBe(true);
    // Siblings of the same UI-action-prompt shape - none of these are names,
    // and a literal blacklist of "Add section" alone would have let every
    // one of these through under a different label.
    expect(isChannelOrUiName('Edit profile')).toBe(true);
    expect(isChannelOrUiName('View full profile')).toBe(true);
    expect(isChannelOrUiName('Add profile photo')).toBe(true);
    expect(isChannelOrUiName('Open to work')).toBe(true);
    expect(isChannelOrUiName('Complete your profile')).toBe(true);
    expect(isChannelOrUiName('Manage your network')).toBe(true);
    expect(isChannelOrUiName('Follow this page')).toBe(true);
    expect(isChannelOrUiName('Report this profile')).toBe(true);
    // Structural check must never reject a real name that happens to start
    // with a common first name that is also an English word elsewhere in
    // the blocklist (e.g. "Add" is not a real first name, but guard the
    // shape requirement: verb immediately followed by a noun, not verb
    // alone or a two-word proper name).
    expect(isChannelOrUiName('Grace Johnson')).toBe(false);
    expect(isChannelOrUiName('Connor Reyes')).toBe(false);
    expect(isChannelOrUiName('Sharon Add')).toBe(false);
  });

  test('blocks the 2026-09-23 "0 notifications" regression and sibling nav-badge counts', () => {
    // Live founder repro: same root cause as the "Add section" bug above
    // (extractLinkedInPersonName scanning page chrome when no thread root
    // was found), a different symptom - a global-nav notification-count
    // badge instead of a details-panel prompt. LINKEDIN_UI_NAME_RE already
    // blocked the bare word "notifications"; it did not block a numeric
    // count prefixed onto it or onto its nav-chrome siblings.
    expect(isChannelOrUiName('0 notifications')).toBe(true);
    expect(isChannelOrUiName('3 notifications')).toBe(true);
    expect(isChannelOrUiName('12 messages')).toBe(true);
    expect(isChannelOrUiName('1 job')).toBe(true);
    expect(isChannelOrUiName('5 invitations')).toBe(true);
    expect(isChannelOrUiName('2 requests')).toBe(true);
    expect(isChannelOrUiName('7 updates')).toBe(true);
    // A real name is never "<digit> <word>" - shape check must not rot into
    // rejecting anything with a leading number, only the known nav nouns.
    expect(isChannelOrUiName('3M Company')).toBe(false);
  });

  test('blocks the 2026-09-23 "Zoom Join" meeting-widget regression, structurally', () => {
    // Live founder repro: Darrin's real conversation contains a Zoom
    // meeting-widget card. LinkedIn reuses the same generic component
    // styling for that card as for the person-name header, so
    // extractLinkedInPersonName's fallback selectors matched the widget's
    // title ("Zoom Join") instead of Darrin's actual name. "Zoom Join" is
    // two capitalized words - it reads structurally like a real name, so
    // neither the verb+noun nor the numeric-badge shape catches it. Reject
    // the whole class of meeting-widget brand/action labels.
    expect(isChannelOrUiName('Zoom Join')).toBe(true);
    expect(isChannelOrUiName('Zoom')).toBe(true);
    expect(isChannelOrUiName('Join Zoom Meeting')).toBe(true);
    expect(isChannelOrUiName('Google Meet')).toBe(true);
    expect(isChannelOrUiName('Microsoft Teams')).toBe(true);
    expect(isChannelOrUiName('Webex')).toBe(true);
    expect(isChannelOrUiName('Join video meeting')).toBe(true);
    expect(isChannelOrUiName('Join call')).toBe(true);
    // A real name is never a meeting-brand or join-action phrase - must not
    // reject unrelated real names in the same two-capitalized-word shape.
    expect(isChannelOrUiName('Darrin Guttman')).toBe(false);
    expect(isChannelOrUiName('Gerardo Flores')).toBe(false);
  });

  test('blocks X (x.com) left-nav chrome labels, structurally (2026-09-23 X adapter)', () => {
    // X's own left-nav renders as a stack of link labels directly beside
    // the DM thread pane (Home, Explore, Notifications, Messages, Grok,
    // Bookmarks, Communities, Premium, Verified Orgs, Profile, More). If
    // x.ts's structural header fallback ever climbs too far it could
    // surface one of these instead of the counterpart's real name - block
    // the whole nav-label set up front rather than waiting for a live
    // regression to name each one individually.
    expect(isChannelOrUiName('Home')).toBe(true);
    expect(isChannelOrUiName('Explore')).toBe(true);
    expect(isChannelOrUiName('Grok')).toBe(true);
    expect(isChannelOrUiName('Bookmarks')).toBe(true);
    expect(isChannelOrUiName('Communities')).toBe(true);
    expect(isChannelOrUiName('Premium')).toBe(true);
    expect(isChannelOrUiName('Verified Orgs')).toBe(true);
    expect(isChannelOrUiName('More')).toBe(true);
    expect(isChannelOrUiName('For you')).toBe(true);
    expect(isChannelOrUiName('Following')).toBe(true);
    // 'x' and 'twitter' were already blocked pre-existing (CHANNEL_OR_UI_NAMES).
    expect(isChannelOrUiName('X')).toBe(true);
    expect(isChannelOrUiName('Twitter')).toBe(true);
    // A real name is never one of these bare nav words - must not reject
    // unrelated real names that happen to share a word structurally.
    expect(isChannelOrUiName('Homer Simpson')).toBe(false);
    expect(isChannelOrUiName('Grant Explorer')).toBe(false);
  });
});
