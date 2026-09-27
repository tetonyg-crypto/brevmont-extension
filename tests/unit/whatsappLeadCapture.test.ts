import { describe, expect, it } from 'vitest';
import { whatsappAdapter } from '../../entrypoints/lib/platforms/whatsapp';

function renderPhoneOnlyChat(): void {
  document.body.innerHTML = `
    <div id="main">
      <div data-testid="conversation-header">
        <div><span dir="auto">+1 (424) 264-1055</span></div>
      </div>
      <div class="message-in"><div class="copyable-text">Cheka este</div></div>
      <div class="composer-wrap">
        <div contenteditable="true" role="textbox" aria-label="Type a message"></div>
      </div>
    </div>`;
}

describe('WhatsApp phone-only lead capture', () => {
  it('recognizes a phone header and composer without a semantic header/footer', async () => {
    renderPhoneOnlyChat();

    const customer = whatsappAdapter.extractCustomer();
    const thread = whatsappAdapter.scrapeThread();

    expect(customer.name).toBeNull();
    expect(customer.phone).toBe('+14242641055');
    expect(thread.header_text).toBe('+1 (424) 264-1055');
    expect(thread.raw_text).toContain('Cheka este');
    expect(thread.messages[0]?.direction).toBe('inbound');
    await expect(whatsappAdapter.inject('Follow up', 'text')).resolves.toMatchObject({ ok: true });
  });
});
