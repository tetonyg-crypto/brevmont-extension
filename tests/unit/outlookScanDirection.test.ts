import { beforeEach, describe, expect, test } from 'vitest';
import { outlookAdapter } from '../../entrypoints/lib/platforms/outlook';

// 2026-09-26 audit: Outlook's "Message body" selector also matched the reply
// editor, every message was 'unknown', last_inbound_text was just the last
// element (often the rep's own draft), and extractCustomer took the first
// sender anywhere in the document (e.g. the folder list preview).

const ME = `<button id="mectrl_main_trigger" aria-label="Account manager for Yancy Garcia"></button>
  <div id="mectrl_currentAccount_secondary">founder@brevmont.com</div>`;
const LIST = `<div role="navigation"><div data-testid="senderName" title="newsletter@deals.example.com">Deals Weekly</div></div>`;

function msg(senderName: string, email: string, body: string): string {
  return `<div role="listitem">
    <span data-testid="senderName" title="${email}">${senderName}</span>
    <div aria-label="Message body">${body}</div>
  </div>`;
}
const REPLY = `<div data-app-section="ComposeReply"><div aria-label="Message body" contenteditable="true" role="textbox">Hi Jennifer, draft reply in progress</div></div>`;

describe('Outlook scan', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('reply editor is excluded, directions come from sender vs signed-in account', () => {
    document.body.innerHTML = ME + LIST + `<div data-app-section="ConversationReadingPane">
      ${msg('Jennifer Ramirez', 'jen.ramirez@example.com', 'Is the 2022 Tahoe still available?')}
      ${msg('Yancy Garcia', 'founder@brevmont.com', 'Yes it is, want to come see it?')}
      ${REPLY}
    </div>`;
    const thread = outlookAdapter.scrapeThread();
    expect(thread.messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
    expect(thread.messages.some((m) => /draft reply/.test(m.text))).toBe(false);
    expect(thread.last_inbound_text).toBe('Is the 2022 Tahoe still available?');
  });

  test('undeterminable sender never becomes last_inbound_text', () => {
    document.body.innerHTML = `<div data-app-section="ConversationReadingPane">
      <div aria-label="Message body">Some message with no sender lockup</div>
      ${REPLY}
    </div>`;
    const thread = outlookAdapter.scrapeThread();
    expect(thread.messages.every((m) => m.direction === 'unknown')).toBe(true);
    expect(thread.last_inbound_text).toBe('');
  });

  test('extractCustomer reads the reading pane, not the first sender in the document', () => {
    document.body.innerHTML = ME + LIST + `<div data-app-section="ConversationReadingPane">
      ${msg('Jennifer Ramirez', 'jen.ramirez@example.com', 'Is the 2022 Tahoe still available?')}
      ${msg('Yancy Garcia', 'founder@brevmont.com', 'Yes it is, want to come see it?')}
    </div>`;
    const customer = outlookAdapter.extractCustomer();
    expect(customer.name).toBe('Jennifer Ramirez');
    expect(customer.email).toBe('jen.ramirez@example.com');
  });
});
