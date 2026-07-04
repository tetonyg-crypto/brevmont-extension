import { test, expect } from '@playwright/test';
import { isChannelOrUiName, stripConversationWrapper } from '../entrypoints/lib/leadContextScan';

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
});
