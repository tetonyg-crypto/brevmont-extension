import { beforeEach, describe, expect, test } from 'vitest';
import { linkedinAdapter } from '../../entrypoints/lib/platforms/linkedin';

// 2026-09-26 audit: LinkedIn shows the sender header only on the FIRST bubble
// of a group; a day divider ("MONDAY", "TODAY") sits on its own line above
// that header. Follow-on bubbles fell through to inbound, the divider line
// hid the header, self-matching used a loose first-name prefix (and any
// mention of "Brevmont"), and each bubble was read twice (li + inner div).

const NAV = `<header class="global-nav"><img class="global-nav__me-photo" alt="Yancy Garcia"></header>`;
const HEADER = `<div class="msg-conversations-container__thread-view">
  <h2 class="msg-entity-lockup__entity-title">Tony Valladolid</h2>
  <ul class="msg-s-message-list-content">`;
const FOOTER = `</ul><div class="msg-form__contenteditable" contenteditable="true"></div></div>`;

function groupStart(day: string | null, name: string, body: string): string {
  return `<li class="msg-s-message-list__event">
    ${day ? `<time class="msg-s-message-list__time-heading">${day}</time>` : ''}
    <div class="msg-s-event-listitem">
      <span class="msg-s-event-listitem--group-a11y-heading">${name} sent the following messages at 4:40 PM</span>
      <a>View ${name.split(' ')[0]}’s profile</a>
      <span class="msg-s-message-group__name">${name}</span> <time>4:40 PM</time>
      <p class="msg-s-event-listitem__body">${body}</p>
    </div></li>`;
}
function followOn(body: string): string {
  return `<li class="msg-s-message-list__event"><div class="msg-s-event-listitem">
    <p class="msg-s-event-listitem__body">${body}</p></div></li>`;
}

describe('LinkedIn bubble grouping and direction', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('day-divider group of the rep, follow-on bubbles inherit direction, each bubble read once', () => {
    document.body.innerHTML = NAV + HEADER
      + groupStart('MONDAY', 'Tony Valladolid', 'Can you send me the proposal?')
      + followOn('Want to see numbers first.')
      + groupStart('TODAY', 'Yancy Garcia', 'Hey Tony, just sent the proposal over.')
      + followOn('Let me know once you have read it through.')
      + FOOTER;
    const thread = linkedinAdapter.scrapeThread();
    expect(thread.messages).toHaveLength(4);
    expect(thread.messages.map((m) => m.direction)).toEqual(['inbound', 'inbound', 'outbound', 'outbound']);
    expect(thread.last_inbound_text).toContain('Want to see numbers first.');
    expect(thread.last_inbound_text).not.toContain('proposal over');
    expect(thread.last_inbound_text).not.toContain('read it through');
  });

  test("a customer bubble starting with the rep's first name or mentioning Brevmont stays the customer's", () => {
    document.body.innerHTML = NAV + HEADER
      + groupStart('TODAY', 'Yancy Garcia', 'Hey Tony, following up.')
      + groupStart(null, 'Tony Valladolid', 'Thanks for reaching out.')
      + followOn('Yancy, what does Brevmont cost?')
      + FOOTER;
    const thread = linkedinAdapter.scrapeThread();
    expect(thread.messages.map((m) => m.direction)).toEqual(['outbound', 'inbound', 'inbound']);
    expect(thread.last_inbound_text).toBe('Yancy, what does Brevmont cost?');
  });

  test('an unattributable sender is unknown and never becomes the last inbound', () => {
    document.body.innerHTML = HEADER
      + groupStart('TODAY', 'Someone Else', 'Random note in a group chat.')
      + followOn('Another random note.')
      + FOOTER;
    const thread = linkedinAdapter.scrapeThread();
    expect(thread.messages.every((m) => m.direction === 'unknown')).toBe(true);
    expect(thread.last_inbound_text).toBe('');
  });
});

describe('LinkedIn sender label with the divider on its own line', () => {
  test('skips a divider-only first line', async () => {
    const { linkedInSenderLabelFromBubbleText } = await import('../../entrypoints/lib/leadContextScan');
    expect(linkedInSenderLabelFromBubbleText('MONDAY\nYancy Garcia sent the following message at 4:35 PM\nHey Tony!')).toBe('Yancy Garcia');
  });
});
