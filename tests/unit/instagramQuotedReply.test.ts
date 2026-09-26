import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instagramBubbleSide, isInstagramReplyContextText } from '../../entrypoints/lib/instagramMessageText';

// Layout: [role="main"] = inbox list (x 0-480) + thread (x 480-1080) +
// details panel (x 1080-1400). Rects come from data-l / data-w.
const origRect = HTMLElement.prototype.getBoundingClientRect;

function fixture(body: string): void {
  document.body.innerHTML = `
    <div role="main">
      <div data-l="0" data-w="1400">
        <div dir="auto" data-l="20" data-w="400">Gaaabby · You: see you at 3</div>
        <div data-l="480" data-w="600">
          <div dir="auto" data-l="500" data-w="300">Is the Tahoe still available?</div>
          <div dir="auto" data-l="760" data-w="300">Yes! Want to come see it at 3?</div>
          ${body}
          <div data-l="480" data-w="600"><div role="textbox" contenteditable="true" data-l="520" data-w="520"></div></div>
        </div>
        <div data-l="1100" data-w="280"><div dir="auto" data-l="1110" data-w="260">Gaaabby Rivera</div></div>
      </div>
    </div>`;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    Object.defineProperty(el, 'innerText', { configurable: true, get() { return el.textContent; } });
  }
}

beforeEach(() => {
  window.history.pushState({}, '', '/direct/t/1234567890/');
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    let el: HTMLElement | null = this;
    while (el && !el.dataset.l) el = el.parentElement;
    const left = Number(el?.dataset.l || 0);
    const width = Number(el?.dataset.w || 0);
    return { left, width, right: left + width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON() {} } as DOMRect;
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  document.body.innerHTML = '';
});

async function scan() {
  const { instagramAdapter } = await import('../../entrypoints/lib/platforms/instagram');
  return instagramAdapter.scrapeThread();
}

describe('Instagram quoted replies', () => {
  it('recognizes reply labels but not ordinary speech', () => {
    expect(isInstagramReplyContextText('Gaaabby replied to you')).toBe(true);
    expect(isInstagramReplyContextText('Replied to you')).toBe(true);
    expect(isInstagramReplyContextText('You replied to Gaaabby')).toBe(true);
    expect(isInstagramReplyContextText('I already replied to you')).toBe(false);
    expect(isInstagramReplyContextText('you replied to my email')).toBe(false);
    expect(isInstagramReplyContextText('Is the Tahoe still available?')).toBe(false);
  });

  it("a customer's photo reply quoting the rep never makes the rep's words the last inbound", async () => {
    fixture(`
      <div data-l="500" data-w="300">
        <span>Gaaabby replied to you</span>
        <div dir="auto" data-l="500" data-w="280">Yes! Want to come see it at 3?</div>
        <div data-l="500" data-w="200"><img src="x.jpg" alt="" /></div>
      </div>`);
    const thread = await scan();
    const texts = thread.messages.map((m) => `${m.direction}:${m.text}`);
    expect(texts).not.toContain('inbound:Yes! Want to come see it at 3?');
    expect(thread.last_inbound_text).toBe('Is the Tahoe still available?');
  });

  it('keeps the customer text reply that follows the quote', async () => {
    fixture(`
      <div data-l="500" data-w="300">
        <div dir="auto" data-l="500" data-w="200">Gaaabby replied to you</div>
        <div dir="auto" data-l="500" data-w="280">Yes! Want to come see it at 3?</div>
        <div dir="auto" data-l="500" data-w="150">make it 4</div>
      </div>`);
    const thread = await scan();
    expect(thread.last_inbound_text).toBe('make it 4');
    expect(thread.messages.filter((m) => m.text.includes('replied to you'))).toHaveLength(0);
  });
});

describe('Instagram rows outside the thread pane', () => {
  it('drops rows right of the pane (details panel), not just left', async () => {
    const pane = { left: 480, width: 600 };
    expect(instagramBubbleSide({ left: 1110, width: 260 }, pane)).toBe('outside');
    fixture('');
    const thread = await scan();
    expect(thread.messages.map((m) => m.text)).toEqual([
      'Is the Tahoe still available?',
      'Yes! Want to come see it at 3?',
    ]);
    expect(thread.messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
  });
});
