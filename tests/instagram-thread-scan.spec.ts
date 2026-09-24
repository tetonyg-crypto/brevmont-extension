import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-instagram-adapter-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/platforms/instagram.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=InstagramAdapterTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

/**
 * Builds a minimal Instagram DM thread fixture. Message rows are given
 * explicit inline widths/margins so the adapter's geometry-based
 * direction heuristic (documented in instagram.ts) has real layout to
 * read, the same way it would against Instagram's actual right/left
 * aligned bubbles. `threadUrl` defaults to a real thread id path;
 * pass an inbox-root path to exercise the "no conversation selected"
 * case.
 */
/**
 * Real navigation to the given instagram.com URL, with the response
 * body intercepted and replaced by the fixture HTML. This gives
 * `window.location` genuine values (no location-spoofing hacks needed)
 * the same way a real Instagram page load would.
 */
async function loadThread(
  page: any,
  {
    threadUrl = 'https://www.instagram.com/direct/t/1234567890/',
    headerHtml = '<header><h1><a href="/cardog_official/" role="link">Cardog</a></h1></header>',
    rows = '',
    withComposer = true,
  }: { threadUrl?: string; headerHtml?: string; rows?: string; withComposer?: boolean },
) {
  const html = `<!doctype html><html><body>
    <div role="main" style="width:400px">
      ${headerHtml}
      <div id="thread">${rows}</div>
      ${withComposer ? '<div role="textbox" contenteditable="true" aria-label="Message"></div>' : ''}
    </div>
  </body></html>`;
  await page.route(threadUrl, (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(threadUrl);
  await page.addScriptTag({ path: bundlePath });
}

function row(text: string, opts: { align: 'left' | 'right'; extra?: string } = { align: 'left' }) {
  const alignStyle = opts.align === 'right' ? 'margin-left:auto' : 'margin-right:auto';
  return `<div role="row" style="width:150px;${alignStyle}">${text}${opts.extra || ''}</div>`;
}

test.describe('Instagram adapter — thread detection + gating', () => {
  test('inbox root with no thread id is not treated as an open conversation', async ({ page }) => {
    await loadThread(page, {
      threadUrl: 'https://www.instagram.com/direct/inbox/',
      rows: row('Hey is this still available'),
      withComposer: false,
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
    expect(result.messages).toEqual([]);
    const customer = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.extractCustomer());
    expect(customer).toEqual({ name: null });
  });

  test('thread URL without a rendered composer is also treated as not-open (DOM not recognized)', async ({ page }) => {
    await loadThread(page, {
      rows: row('Hey is this still available'),
      withComposer: false,
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
  });

  test('empty/new conversation (thread open, no messages yet) returns zero messages, not an error', async ({ page }) => {
    await loadThread(page, { rows: '' });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
    expect(result.last_inbound_text).toBe('');
  });
});

test.describe('Instagram adapter — message extraction', () => {
  test('normal 1:1 text conversation: order, text, and sender attribution', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('Is the 2021 Tahoe still available?', { align: 'left' }),
        row('Yes it is! Want to come take a look?', { align: 'right' }),
        row('What financing options do you have?', { align: 'left' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['inbound', 'outbound', 'inbound']);
    expect(result.messages.map((m: any) => m.text)).toEqual([
      'Is the 2021 Tahoe still available?',
      'Yes it is! Want to come take a look?',
      'What financing options do you have?',
    ]);
    expect(result.last_inbound_text).toBe('What financing options do you have?');
    expect(result.message_count).toBe(3);
  });

  test('multiple consecutive messages from the same participant preserve order', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('Hey', { align: 'left' }),
        row('are you still around', { align: 'left' }),
        row('I have cash in hand', { align: 'left' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['inbound', 'inbound', 'inbound']);
    expect(result.messages.map((m: any) => m.text)).toEqual(['Hey', 'are you still around', 'I have cash in hand']);
    expect(result.last_inbound_text).toBe('I have cash in hand');
  });

  test('alternating messages keep chronological order across many turns', async ({ page }) => {
    const script = [
      ['Hi, saw your post', 'left'],
      ['Hey! yes still here', 'right'],
      ['Can you do 18k', 'left'],
      ['Closest I can do is 19,500', 'right'],
      ['deal, when can I come by', 'left'],
    ] as const;
    await loadThread(page, { rows: script.map(([t, a]) => row(t, { align: a as 'left' | 'right' })).join('') });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual([
      'inbound', 'outbound', 'inbound', 'outbound', 'inbound',
    ]);
    expect(result.last_inbound_text).toBe('deal, when can I come by');
  });

  test('emoji-only and emoji-inclusive messages are preserved verbatim', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('🔥🔥🔥', { align: 'left' }),
        row('haha yes it slaps 😂', { align: 'right' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.text)).toEqual(['🔥🔥🔥', 'haha yes it slaps 😂']);
  });

  test('a message containing a link is preserved as normal text', async ({ page }) => {
    await loadThread(page, {
      rows: row('check the carfax https://example.com/carfax/123', { align: 'left' }),
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages[0].text).toContain('https://example.com/carfax/123');
    expect(result.messages[0].direction).toBe('inbound');
  });

  test('a shared post is represented as a typed placeholder, not hallucinated text', async ({ page }) => {
    await loadThread(page, {
      rows: row('', { align: 'left', extra: '<a href="/p/Cabc123XY/" aria-label="Post"></a>' }),
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: '[shared a post]', direction: 'inbound' }]);
  });

  test('presence, receipt, and reaction rows never appear as messages', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('Active now', { align: 'left' }),
        row('Is it still up for grabs', { align: 'left' }),
        row('Seen', { align: 'left' }),
        row('Reacted 🔥 to your message', { align: 'left' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'Is it still up for grabs', direction: 'inbound' }]);
  });
});

test.describe('Instagram adapter — participant identity', () => {
  test('captures display name, username, and profile URL from the thread header', async ({ page }) => {
    await loadThread(page, {
      headerHtml: '<header><h1><a href="/cardog_official/" role="link">Cardog Motors</a></h1></header>',
      rows: row('hello', { align: 'left' }),
    });
    const customer = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.extractCustomer());
    expect(customer.name).toBe('Cardog Motors');
    expect(customer.username).toBe('cardog_official');
    expect(customer.profile_url).toBe('https://www.instagram.com/cardog_official/');
  });

  test('falls back to generic identity (name null) when no header signal is legible', async ({ page }) => {
    await loadThread(page, {
      headerHtml: '<header></header>',
      rows: row('hello', { align: 'left' }),
    });
    const customer = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.extractCustomer());
    expect(customer.name).toBeNull();
  });
});

test.describe('Instagram adapter — cross-conversation isolation', () => {
  test('switching thread URLs changes conversation_key and does not leak the prior thread', async ({ page }) => {
    await loadThread(page, {
      threadUrl: 'https://www.instagram.com/direct/t/AAA111/',
      headerHtml: '<header><h1><a href="/buyer_one/" role="link">Buyer One</a></h1></header>',
      rows: row('I want the Tahoe', { align: 'left' }),
    });
    const first = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(first.conversation_key).toBe('t:AAA111');
    expect(first.last_inbound_text).toBe('I want the Tahoe');

    await loadThread(page, {
      threadUrl: 'https://www.instagram.com/direct/t/BBB222/',
      headerHtml: '<header><h1><a href="/buyer_two/" role="link">Buyer Two</a></h1></header>',
      rows: row('I want the Silverado', { align: 'left' }),
    });
    const second = await page.evaluate(() => (window as any).InstagramAdapterTest.instagramAdapter.scrapeThread());
    expect(second.conversation_key).toBe('t:BBB222');
    expect(second.last_inbound_text).toBe('I want the Silverado');
    expect(second.raw_text).not.toContain('Buyer One');
    expect(second.raw_text).not.toContain('Tahoe');
  });
});
