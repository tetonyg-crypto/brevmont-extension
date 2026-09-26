import { describe, expect, it } from 'vitest';
import { gmailAdapter } from '../../entrypoints/lib/platforms/gmail';
import { findGmailThreadSender } from '../../entrypoints/lib/customerDetection';

// Rep is signed in as jane.rep@gmail.com but sends from the dealership alias
// sales@dealer.com (Gmail "Send mail as"). Sender name is still her own.
function render(): void {
  document.body.innerHTML = `
    <a aria-label="Google Account: Jane Rep
(jane.rep@gmail.com)" href="#"></a>
    <div role="main">
      <h2 class="hP">2022 Tahoe LT</h2>
      <div class="adn">
        <span class="gD" email="sales@dealer.com" name="Jane Rep">Jane Rep</span>
        <div class="a3s">Hi Maria, the Tahoe is still here. Want to come by Saturday?</div>
      </div>
      <div class="adn">
        <span class="gD" email="maria.lopez@example.com" name="Maria Lopez">Maria Lopez</span>
        <div class="a3s">Saturday works, what time are you open?</div>
      </div>
      <div class="adn">
        <span class="gD" email="sales@dealer.com" name="Jane Rep">Jane Rep</span>
        <div class="a3s">We open at 9. See you then!</div>
      </div>
    </div>`;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    Object.defineProperty(el, 'innerText', { configurable: true, get() { return el.textContent; } });
  }
}

describe('Gmail send-as alias', () => {
  it("classifies the rep's alias messages as outbound", () => {
    render();
    const thread = gmailAdapter.scrapeThread();
    expect(thread.messages.map((m) => m.direction)).toEqual(['outbound', 'inbound', 'outbound']);
    expect(thread.last_inbound_text).toBe('Saturday works, what time are you open?');
  });

  it('never picks the alias as the customer', () => {
    render();
    expect(findGmailThreadSender()).toEqual({ name: 'Maria Lopez', email: 'maria.lopez@example.com' });
  });
});
