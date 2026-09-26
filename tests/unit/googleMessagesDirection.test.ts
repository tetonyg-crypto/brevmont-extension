import { describe, expect, test } from 'vitest';

describe('Google Messages scan', () => {
  test('rep bubbles are read once, as outbound', async () => {
    document.body.innerHTML = `
      <mws-message-wrapper class="incoming"><mws-message-part-content>Is the truck still there?</mws-message-part-content></mws-message-wrapper>
      <mws-message-wrapper class="outgoing"><mws-message-part-content>Yes! Want to come see it at 3?</mws-message-part-content></mws-message-wrapper>`;
    for (const el of Array.from(document.querySelectorAll('mws-message-wrapper, mws-message-part-content'))) {
      Object.defineProperty(el, 'innerText', { get() { return el.textContent; } });
    }
    const mod: any = await import('../../entrypoints/lib/platforms/google-messages');
    const adapter = mod.default || mod.googleMessagesAdapter || Object.values(mod).find((v: any) => v && typeof v.scrapeThread === 'function');
    const thread = adapter.scrapeThread();
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1].direction).toBe('outbound');
    expect(thread.last_inbound_text).toBe('Is the truck still there?');
  });
});
