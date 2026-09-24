import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-whatsapp-adapter-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/platforms/whatsapp.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=WhatsAppAdapterTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

/**
 * WhatsApp Web's URL NEVER names a conversation — it is always
 * https://web.whatsapp.com/ regardless of which contact is open (unlike
 * Gmail/Instagram/X, which all carry a per-thread path/segment). That is
 * the central architectural fact this whole test file is built around:
 * "switching chats" in these tests means replacing `#main`'s DOM
 * in-place via page.evaluate — exactly what a real SPA chat switch does
 * — never a page.goto() to a different URL, because there is no such
 * URL to go to. See whatsapp.ts's conversationKey()/hasOpenWhatsAppThread()
 * comments for why identity has to come from DOM state instead.
 */
async function loadWhatsApp(
  page: any,
  {
    headerName = 'Cardog Motors',
    headerTitle,
    rows = '',
    withComposer = true,
    sidebarChrome = '',
  }: { headerName?: string; headerTitle?: string; rows?: string; withComposer?: boolean; sidebarChrome?: string } = {},
) {
  const title = headerTitle ?? headerName;
  const html = `<!doctype html><html><body>
    <div id="app">
      <div id="side">
        ${sidebarChrome}
      </div>
      <div id="main">
        <header>
          <span dir="auto" title="${title}">${headerName}</span>
        </header>
        <div id="thread">${rows}</div>
        ${withComposer ? '<div contenteditable="true" data-tab="10" aria-label="Type a message"></div>' : ''}
      </div>
    </div>
  </body></html>`;
  await page.route('https://web.whatsapp.com/', (route: any) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto('https://web.whatsapp.com/');
  await page.addScriptTag({ path: bundlePath });
}

/** Simulate an in-place SPA chat switch: replace #main's content without
 *  navigating (the URL cannot change — there is nothing to navigate to). */
async function switchChat(
  page: any,
  { headerName, rows = '', withComposer = true }: { headerName: string; rows?: string; withComposer?: boolean },
) {
  await page.evaluate(
    ({ headerName, rows, withComposer }: any) => {
      const main = document.getElementById('main')!;
      main.innerHTML = `
        <header><span dir="auto" title="${headerName}">${headerName}</span></header>
        <div id="thread">${rows}</div>
        ${withComposer ? '<div contenteditable="true" data-tab="10" aria-label="Type a message"></div>' : ''}
      `;
    },
    { headerName, rows, withComposer },
  );
}

let rowSeq = 0;

/** A real message row, keyed with WhatsApp Web's documented internal
 *  data-id shape (`{fromMe}_{remoteJid}_{msgId}`) — the PRIMARY sender
 *  signal this adapter relies on. UNVERIFIED against live WhatsApp Web
 *  (this sandbox cannot load it); reasoned from the convention every
 *  WhatsApp Web scraping tool/library documents. `fromMe` controls
 *  direction; `jid` lets isolation tests prove different chats produce
 *  different conversation_key values. */
function row(text: string, opts: { fromMe: boolean; jid?: string; extraClass?: string; inner?: string } = { fromMe: false }) {
  const id = `msg-${++rowSeq}`;
  const jid = opts.jid || '15550001111@c.us';
  const dataId = `${opts.fromMe ? 'true' : 'false'}_${jid}_${id}`;
  const cls = opts.fromMe ? 'message-out' : 'message-in';
  return `<div data-id="${dataId}" class="${cls} ${opts.extraClass || ''}"><div class="copyable-text">${opts.inner ?? text}</div></div>`;
}

/** Adversarial fixture: a row with NO data-id and NO message-in/out
 *  className at all — the geometry fallback must still fire rather than
 *  the row being silently dropped or misattributed. Mirrors the
 *  "primary selector assumption is wrong" adversarial case the founder's
 *  critical-lesson instructions require. */
function bareRow(text: string, opts: { left?: boolean } = {}) {
  const style = opts.left === false ? 'margin-left:250px;width:120px' : 'margin-left:0;width:120px';
  return `<div class="copyable-text" style="${style}">${text}</div>`;
}

test.describe('WhatsApp adapter — thread detection + gating', () => {
  test('no open chat (welcome pane, no header/composer) is not scraped as a conversation', async ({ page }) => {
    await loadWhatsApp(page, { withComposer: false, headerName: '', rows: row('should not be read') });
    // No header at all — remove it to simulate the true "no chat selected" pane.
    await page.evaluate(() => {
      document.querySelector('header')?.remove();
    });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
    expect(result.messages).toEqual([]);
    const customer = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.extractCustomer());
    expect(customer).toEqual({ name: null });
  });

  test('header without a rendered composer is also treated as not-open', async ({ page }) => {
    await loadWhatsApp(page, { withComposer: false, rows: row('Hi there') });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
  });

  test('empty/new chat (thread open, no messages yet) returns zero messages, not an error', async ({ page }) => {
    await loadWhatsApp(page, { rows: '' });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
    expect(result.messages).toEqual([]);
    expect(result.header_text).toBe('Cardog Motors');
  });
});

test.describe('WhatsApp adapter — message extraction + sender attribution', () => {
  test('single incoming message ("Hi there" — mirrors the live baseline)', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('Hi there', { fromMe: false }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'Hi there', direction: 'inbound' }]);
    expect(result.last_inbound_text).toBe('Hi there');
  });

  test('single outgoing message', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('On my way', { fromMe: true }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'On my way', direction: 'outbound' }]);
    expect(result.last_inbound_text).toBe('');
  });

  test('incoming then outgoing preserves chronological order and direction', async ({ page }) => {
    await loadWhatsApp(page, {
      rows: row('Is the Tahoe still available', { fromMe: false }) + row('Yes it is!', { fromMe: true }),
    });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages).toEqual([
      { text: 'Is the Tahoe still available', direction: 'inbound' },
      { text: 'Yes it is!', direction: 'outbound' },
    ]);
  });

  test('outgoing then incoming preserves chronological order and direction', async ({ page }) => {
    await loadWhatsApp(page, {
      rows: row('Hey, following up on the Silverado', { fromMe: true }) + row('Still interested', { fromMe: false }),
    });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages).toEqual([
      { text: 'Hey, following up on the Silverado', direction: 'outbound' },
      { text: 'Still interested', direction: 'inbound' },
    ]);
  });

  test('multiple consecutive incoming messages keep order and direction', async ({ page }) => {
    await loadWhatsApp(page, {
      rows: row('Hi', { fromMe: false }) + row('Still have the truck?', { fromMe: false }) + row('Whats the price', { fromMe: false }),
    });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['inbound', 'inbound', 'inbound']);
    expect(result.last_inbound_text).toBe('Whats the price');
  });

  test('multiple consecutive outgoing messages keep order and direction', async ({ page }) => {
    await loadWhatsApp(page, {
      rows: row('Yes we do', { fromMe: true }) + row('Its 24k', { fromMe: true }) + row('Want to come see it', { fromMe: true }),
    });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['outbound', 'outbound', 'outbound']);
    expect(result.last_inbound_text).toBe('');
  });

  test('long alternating thread stays in chronological order with correct ME-vs-OTHER attribution', async ({ page }) => {
    let rows = '';
    for (let i = 0; i < 20; i += 1) {
      rows += row(`msg ${i}`, { fromMe: i % 2 === 1 });
    }
    await loadWhatsApp(page, { rows });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.text)).toEqual(Array.from({ length: 20 }, (_, i) => `msg ${i}`));
    expect(result.messages.map((m: any) => m.direction)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i % 2 === 1 ? 'outbound' : 'inbound')),
    );
  });

  test('context window caps at the last 40 messages (no unlimited transcript collection)', async ({ page }) => {
    let rows = '';
    for (let i = 0; i < 60; i += 1) rows += row(`m${i}`, { fromMe: false });
    await loadWhatsApp(page, { rows });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages.length).toBe(40);
    expect(result.messages[0].text).toBe('m20');
    expect(result.messages[39].text).toBe('m59');
  });

  test('emoji-inclusive messages are preserved verbatim', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('Sounds good 👍😊', { fromMe: false }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages[0].text).toBe('Sounds good 👍😊');
  });

  test('a message containing a URL is preserved as normal text', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('Check it out https://example.com/listing/42', { fromMe: false }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages[0].text).toBe('Check it out https://example.com/listing/42');
  });

  test('a reply/quoted message preserves quoted context as a prefix', async ({ page }) => {
    const id = `msg-${++rowSeq}`;
    const quotedRow = `<div data-id="false_15550001111@c.us_${id}" class="message-in"><div class="quoted-message" data-testid="quoted-mention">Is the Tahoe still available</div><div class="copyable-text">Yes still here!</div></div>`;
    await loadWhatsApp(page, { rows: quotedRow });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages[0].text).toBe('[replying to: "Is the Tahoe still available"] Yes still here!');
    expect(result.messages[0].direction).toBe('inbound');
  });

  test('ADVERSARIAL: a bare row with no data-id and no message-in/out className falls back to geometry-based direction', async ({ page }) => {
    await loadWhatsApp(page, { rows: bareRow('left aligned text', { left: true }) + bareRow('right aligned text', { left: false }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages.length).toBe(2);
    // Geometry is the last-resort signal here — both rows should still
    // be captured with SOME resolved direction (not silently dropped),
    // even though neither the data-id nor className primary/secondary
    // signals are present.
    expect(result.messages.every((m: any) => m.text.length > 0)).toBe(true);
  });

  test('WhatsApp system banners are excluded, never treated as messages', async ({ page }) => {
    const banners = [
      row('Message notifications are off.', { fromMe: false }),
      row("The sender won't see if you read their messages until you reply or add them as a contact.", { fromMe: false }),
      row('Block', { fromMe: false }),
      row('Add to contacts', { fromMe: false }),
      row('Real message from customer', { fromMe: false }),
    ].join('');
    await loadWhatsApp(page, { rows: banners });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'Real message from customer', direction: 'inbound' }]);
  });
});

test.describe('WhatsApp adapter — rich content placeholders', () => {
  test('an image-only message is a typed placeholder, never a hallucinated caption', async ({ page }) => {
    const id = `msg-${++rowSeq}`;
    const imgRow = `<div data-id="false_15550001111@c.us_${id}" class="message-in"><div class="copyable-text"><img src="photo.jpg" alt="Photo"></div></div>`;
    await loadWhatsApp(page, { rows: imgRow });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages[0].text).toBe('[image]');
  });

  test('a voice note is a typed placeholder, never transcribed', async ({ page }) => {
    const id = `msg-${++rowSeq}`;
    const voiceRow = `<div data-id="false_15550001111@c.us_${id}" class="message-in"><div class="copyable-text"><span data-icon="audio-play"></span></div></div>`;
    await loadWhatsApp(page, { rows: voiceRow });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages[0].text).toBe('[voice note]');
  });

  test('a deleted message is a typed placeholder', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('This message was deleted', { fromMe: false }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.messages[0].text).toBe('[deleted message]');
  });
});

test.describe('WhatsApp adapter — participant identity', () => {
  test('captures the saved contact name from the thread header', async ({ page }) => {
    await loadWhatsApp(page, { headerName: 'Jordan Ramirez' });
    const customer = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.extractCustomer());
    expect(customer.name).toBe('Jordan Ramirez');
    expect(customer.raw_source).toBe('wa_header_title');
  });

  test('an unsaved contact (phone-number header) never becomes a hallucinated name', async ({ page }) => {
    await loadWhatsApp(page, { headerName: '+1 555 123 4567' });
    const customer = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.extractCustomer());
    expect(customer.name).toBeNull();
    expect(customer.phone).toBe('+15551234567');
  });

  test('presence decorators are stripped from the header name', async ({ page }) => {
    await loadWhatsApp(page, { headerName: 'Jordan Ramirez online' });
    const customer = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.extractCustomer());
    expect(customer.name).toBe('Jordan Ramirez');
  });

  test('no legible header signal falls back to generic identity (name null), never a guess', async ({ page }) => {
    await loadWhatsApp(page, { withComposer: false, rows: '' });
    await page.evaluate(() => document.querySelector('header')?.remove());
    const customer = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.extractCustomer());
    expect(customer).toEqual({ name: null });
  });
});

test.describe('WhatsApp adapter — conversation identity (no per-chat URL)', () => {
  test('two different chats (different data-id jids) produce different conversation_key values', async ({ page }) => {
    await loadWhatsApp(page, { headerName: 'Contact A', rows: row('hi', { fromMe: false, jid: '15550001111@c.us' }) });
    const keyA = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread().conversation_key);
    await switchChat(page, { headerName: 'Contact B', rows: row('hello', { fromMe: false, jid: '15559998888@c.us' }) });
    const keyB = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread().conversation_key);
    expect(keyA).not.toBe(keyB);
  });

  test('an empty new chat (no messages yet) still gets a stable, contact-derived identity via the header', async ({ page }) => {
    await loadWhatsApp(page, { headerName: 'Brand New Contact', rows: '' });
    const key = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread().conversation_key);
    expect(key).toMatch(/^wa_header:/);
  });
});

test.describe('WhatsApp adapter — SPA chat switching + zero context leakage (release blocker)', () => {
  test('A -> B -> A: each scrapeThread() call reflects only the currently open chat, never a mix or a stale prior chat', async ({ page }) => {
    await loadWhatsApp(page, {
      headerName: 'Alex A',
      rows: row('Message only Alex should have said', { fromMe: false, jid: 'alexjid@c.us' }),
    });
    const resultA1 = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(resultA1.header_text).toBe('Alex A');
    expect(resultA1.messages[0].text).toBe('Message only Alex should have said');

    await switchChat(page, {
      headerName: 'Blake B',
      rows: row('Message only Blake should have said', { fromMe: false, jid: 'blakejid@c.us' }),
    });
    const resultB = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(resultB.header_text).toBe('Blake B');
    expect(resultB.messages).toEqual([{ text: 'Message only Blake should have said', direction: 'inbound' }]);
    expect(resultB.raw_text).not.toContain('Alex');

    await switchChat(page, {
      headerName: 'Alex A',
      rows: row('Message only Alex should have said', { fromMe: false, jid: 'alexjid@c.us' }),
    });
    const resultA2 = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(resultA2.header_text).toBe('Alex A');
    expect(resultA2.messages).toEqual([{ text: 'Message only Alex should have said', direction: 'inbound' }]);
    expect(resultA2.raw_text).not.toContain('Blake');
    expect(resultA2.conversation_key).toBe(resultA1.conversation_key);
  });

  test('rapid A -> B -> C switching never blends thread content', async ({ page }) => {
    await loadWhatsApp(page, { headerName: 'A', rows: row('only A', { fromMe: false, jid: 'a@c.us' }) });
    await switchChat(page, { headerName: 'B', rows: row('only B', { fromMe: false, jid: 'b@c.us' }) });
    await switchChat(page, { headerName: 'C', rows: row('only C', { fromMe: false, jid: 'c@c.us' }) });
    const result = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(result.header_text).toBe('C');
    expect(result.messages).toEqual([{ text: 'only C', direction: 'inbound' }]);
  });
});

test.describe('WhatsApp adapter — group chats degrade gracefully', () => {
  test('a group chat never attributes every incoming message to one guessed person', async ({ page }) => {
    const html = `<!doctype html><html><body>
      <div id="main">
        <header>
          <span dir="auto" title="Dealership Team">Dealership Team</span>
          <span dir="auto" title="Alex, Jordan, Sam">Alex, Jordan, Sam</span>
          <span data-icon="default-group"></span>
        </header>
        <div id="thread">${row('Hey team', { fromMe: false })}</div>
        <div contenteditable="true" data-tab="10"></div>
      </div>
    </body></html>`;
    await page.route('https://web.whatsapp.com/', (route: any) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
    );
    await page.goto('https://web.whatsapp.com/');
    await page.addScriptTag({ path: bundlePath });
    const customer = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.extractCustomer());
    expect(customer.name).toBe('Dealership Team');
    expect(customer.raw_source).toBe('wa_group_header');
    // Still extracts messages with reliable ME-vs-OTHER direction even
    // though it never guesses which individual group member sent them.
    const thread = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.scrapeThread());
    expect(thread.messages).toEqual([{ text: 'Hey team', direction: 'inbound' }]);
  });
});

test.describe('WhatsApp adapter — inject (composer)', () => {
  test('resolves the footer composer for text output', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('hi', { fromMe: false }) });
    const plan = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.inject('Thanks for reaching out!', 'text'));
    expect(plan.ok).toBe(true);
    expect(plan.composer_selector).toBeTruthy();
    const resolves = await page.evaluate((sel: string) => !!document.querySelector(sel), plan.composer_selector);
    expect(resolves).toBe(true);
  });

  // REGRESSION: found during independent verification of this adapter
  // (2026-09-23) — findComposer() falls back to the shared
  // findGenericComposer('text') helper when none of COMPOSER_SELECTORS
  // match, but that helper's own selectors
  // ('div[role="textbox"][contenteditable="true"]',
  // 'textarea:not([readonly])') weren't included in the pool inject()
  // used to compute composer_selector. A composer found only through
  // that fallback would have produced a composer_selector that did NOT
  // re-resolve to the same element — the exact live bug class found and
  // fixed in x.ts's inject() the same day. This fixture uses a composer
  // shape that matches NONE of the explicit WhatsApp-specific
  // COMPOSER_SELECTORS, forcing the generic-fallback path.
  test('composer found only via the generic fallback still produces a resolvable composer_selector', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('hi', { fromMe: false }), withComposer: false });
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('role', 'textbox');
      el.setAttribute('contenteditable', 'true');
      document.querySelector('#main')!.appendChild(el);
    });
    const plan = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.inject('Thanks!', 'text'));
    expect(plan.ok).toBe(true);
    const resolvedCount = await page.evaluate((sel: string) => document.querySelectorAll(sel).length, plan.composer_selector);
    expect(resolvedCount).toBeGreaterThan(0);
  });

  test('rejects email/crm_note kinds — WhatsApp only supports text composer inject', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('hi', { fromMe: false }) });
    const plan = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.inject('x', 'email'));
    expect(plan.ok).toBe(false);
  });

  test('fails safe when no composer is rendered', async ({ page }) => {
    await loadWhatsApp(page, { rows: row('hi', { fromMe: false }), withComposer: false });
    const plan = await page.evaluate(() => (window as any).WhatsAppAdapterTest.whatsappAdapter.inject('x', 'text'));
    expect(plan.ok).toBe(false);
  });
});
