/**
 * Best-effort: after the rep publishes, Marketplace lands on /marketplace/item/.
 * If a Brevmont draft is still in storage (under 2h), flip that vehicle to Posted.
 * Does not click Publish. The rep published.
 */
export default defineContentScript({
  matches: [
    '*://www.facebook.com/marketplace/item/*',
    '*://facebook.com/marketplace/item/*',
  ],
  allFrames: false,
  runAt: 'document_idle',
  async main() {
    try {
      await chrome.runtime.sendMessage({
        type: 'BREVMONT_MARKETPLACE_ITEM_PUBLISHED',
        url: window.location.href,
      });
    } catch {
      /* background may be asleep */
    }
  },
});