import { describe, expect, it } from 'vitest';
import { whatsappConversationKey } from '../../entrypoints/lib/platforms/whatsapp';

function render(name: string, subtitle: string | null): void {
  document.body.innerHTML = `
    <div id="main">
      <header>
        <span dir="auto" title="${name}">${name}</span>
        ${subtitle === null ? '' : `<span title="${subtitle}">${subtitle}</span>`}
      </header>
      <footer><div contenteditable="true" role="textbox"></div></footer>
    </div>`;
}

describe('WhatsApp conversation key', () => {
  it('stays the same while the presence line flips for one contact', () => {
    render('Maria Lopez', null);
    const a = whatsappConversationKey();
    render('Maria Lopez', 'online');
    const b = whatsappConversationKey();
    render('Maria Lopez', 'typing…');
    const c = whatsappConversationKey();
    render('Maria Lopez', 'last seen today at 9:14 AM');
    const d = whatsappConversationKey();
    expect(a).toMatch(/^wa_header:/);
    expect(new Set([a, b, c, d]).size).toBe(1);
  });

  it('still changes when a different contact is opened', () => {
    render('Maria Lopez', 'online');
    const a = whatsappConversationKey();
    render('+1 555 123 4567', 'online');
    expect(whatsappConversationKey()).not.toBe(a);
  });
});
