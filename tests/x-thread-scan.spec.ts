import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-x-adapter-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/platforms/x.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=XAdapterTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

/**
 * Real navigation to the given x.com URL, with the response body
 * intercepted and replaced by the fixture HTML — same technique
 * instagram-thread-scan.spec.ts uses, so `window.location` is genuine.
 *
 * `headerHtml` defaults to the CONFIRMED real markup (live DevTools
 * evidence, 2026-09-23): `data-testid="dm-conversation-header"` wrapping
 * `data-testid="dm-conversation-username"`, which holds the display name
 * text directly (not a link). A profile link is included separately near
 * it, matching how readHeaderProfileLink() scans the container for any
 * "/username"-shaped href — its exact placement in real X markup is NOT
 * confirmed, so this part stays a reasonable-fixture guess, called out
 * inline. Tests that pass `headerHtml: OLD_GUESSED_HEADER_FIXTURE` or
 * `NO_HEADER_WRAPPER_FIXTURE` exercise the fallback chain explicitly —
 * this is the adversarial-coverage discipline required by the founder's
 * "critical lesson" instructions: Instagram's own adapter assumed a
 * `<header>` element that didn't exist live, so every structural
 * assumption here must be proven correct against confirmed reality AND
 * proven to degrade safely when a guess doesn't hold.
 */
async function loadThread(
  page: any,
  {
    threadUrl = 'https://x.com/i/chat/1234567890123456789',
    headerHtml = '<div data-testid="dm-conversation-header"><div data-testid="dm-conversation-username">Cardog Motors</div></div><a href="/cardog_official" aria-label="Cardog Motors"></a>',
    rows = '',
    withComposer = true,
  }: { threadUrl?: string; headerHtml?: string; rows?: string; withComposer?: boolean },
) {
  const html = `<!doctype html><html><body>
    <nav>
      <a href="/home">Home</a>
      <a href="/explore">Explore</a>
      <a href="/notifications">Notifications</a>
      <a href="/messages">Messages</a>
    </nav>
    <div role="main" style="width:400px">
      <div data-testid="dm-message-scroller" style="width:400px">
        ${headerHtml}
        <div id="thread">${rows}</div>
        ${withComposer ? '<textarea data-testid="dm-composer-textarea" aria-label="Message"></textarea>' : ''}
      </div>
    </div>
  </body></html>`;
  await page.route(threadUrl, (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(threadUrl);
  await page.addScriptTag({ path: bundlePath });
}

/** Fallback-path fixture: the ORIGINAL guessed data-testid header shape
 *  (before live evidence corrected the primary selector) — proves the
 *  adapter still resolves identity through its secondary/tertiary
 *  strategies, not just the confirmed-real primary one. */
const OLD_GUESSED_HEADER_FIXTURE = '<div data-testid="DmHeader"><div role="heading"><a href="/cardog_official">Cardog Motors</a></div></div>';

/** Adversarial fixture: the counterpart's name/link sit directly in the
 *  scroller with NO dedicated header wrapper and NO data-testid at all —
 *  proving the structural readHeadingNearProfileLink() fallback, not
 *  just a guessed data-testid path. */
const NO_HEADER_WRAPPER_FIXTURE = '<h1><a href="/cardog_official">Cardog Motors</a></h1>';

let rowSeq = 0;

/** CONFIRMED real message-wrapper shape (live DevTools evidence,
 *  2026-09-23): `data-testid="message-<uuid>"` with className carrying
 *  `justify-end` (sent by the rep) or `justify-start` (received from the
 *  counterpart) as the actual direction signal, wrapping a
 *  `data-testid="message-text-<uuid>"` `dir="auto"` text child. Real
 *  wrappers are full-width regardless of direction (confirmed: identical
 *  bounding rects for both classes live), so this fixture does NOT use
 *  alignment styling/margins the way a geometry-based test would — the
 *  className is the only signal that should determine direction here. */
function row(text: string, opts: { align: 'left' | 'right'; extra?: string } = { align: 'left' }) {
  const id = `test-${++rowSeq}`;
  const justify = opts.align === 'right' ? 'justify-end' : 'justify-start';
  return `<div data-testid="message-${id}" class="relative flex w-full px-4 py-1 ${justify}" data-send-status="sent"><div data-testid="message-text-${id}" dir="auto">${text}${opts.extra || ''}</div></div>`;
}

test.describe('X adapter — thread detection + gating', () => {
  test('inbox root with no thread id is not treated as an open conversation', async ({ page }) => {
    await loadThread(page, {
      threadUrl: 'https://x.com/messages',
      rows: row('Hey is this still available'),
      withComposer: false,
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
    expect(result.messages).toEqual([]);
    const customer = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.extractCustomer());
    expect(customer).toEqual({ name: null });
  });

  test('compose-new-message is not treated as an existing thread', async ({ page }) => {
    await loadThread(page, {
      threadUrl: 'https://x.com/messages/compose',
      rows: row('draft text'),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
  });

  test('thread URL without a rendered composer is also treated as not-open (DOM not recognized)', async ({ page }) => {
    await loadThread(page, {
      rows: row('Hey is this still available'),
      withComposer: false,
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
  });

  test('empty/new conversation (thread open, no messages yet) returns zero messages, not an error', async ({ page }) => {
    await loadThread(page, { rows: '' });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.message_count).toBe(0);
    expect(result.last_inbound_text).toBe('');
  });

  test('legacy numeric-id DM route (x.com/messages/<id>-<id>) is also recognized as an open thread', async ({ page }) => {
    await loadThread(page, {
      threadUrl: 'https://x.com/messages/1111111111-2222222222',
      rows: row('is this still up'),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.conversation_key).toBe('dm:1111111111-2222222222');
    expect(result.message_count).toBe(1);
  });
});

test.describe('X adapter — message extraction + sender attribution', () => {
  test('single incoming message', async ({ page }) => {
    await loadThread(page, { rows: row('Is the 2021 Tahoe still available?', { align: 'left' }) });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'Is the 2021 Tahoe still available?', direction: 'inbound' }]);
    expect(result.last_inbound_text).toBe('Is the 2021 Tahoe still available?');
  });

  test('single outgoing message', async ({ page }) => {
    await loadThread(page, { rows: row('Yes it is! Want to come take a look?', { align: 'right' }) });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'Yes it is! Want to come take a look?', direction: 'outbound' }]);
    expect(result.last_inbound_text).toBe('');
  });

  test('multiple consecutive incoming messages preserve order and direction', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('Hey', { align: 'left' }),
        row('are you still around', { align: 'left' }),
        row('I have cash in hand', { align: 'left' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['inbound', 'inbound', 'inbound']);
    expect(result.messages.map((m: any) => m.text)).toEqual(['Hey', 'are you still around', 'I have cash in hand']);
    expect(result.last_inbound_text).toBe('I have cash in hand');
  });

  test('multiple consecutive outgoing messages preserve order and direction', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('Hey there', { align: 'right' }),
        row('still available', { align: 'right' }),
        row('want to swing by?', { align: 'right' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['outbound', 'outbound', 'outbound']);
    expect(result.last_inbound_text).toBe('');
  });

  test('alternating messages keep chronological order and correct ME-vs-OTHER attribution across many turns', async ({ page }) => {
    const script = [
      ['Hi, saw your post', 'left'],
      ['Hey! yes still here', 'right'],
      ['Can you do 18k', 'left'],
      ['Closest I can do is 19,500', 'right'],
      ['deal, when can I come by', 'left'],
    ] as const;
    await loadThread(page, { rows: script.map(([t, a]) => row(t, { align: a as 'left' | 'right' })).join('') });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual([
      'inbound', 'outbound', 'inbound', 'outbound', 'inbound',
    ]);
    expect(result.last_inbound_text).toBe('deal, when can I come by');
  });

  test('long conversation (many turns) stays in chronological order', async ({ page }) => {
    const turns = Array.from({ length: 20 }, (_, i) => [`turn ${i}`, i % 2 === 0 ? 'left' : 'right'] as const);
    await loadThread(page, { rows: turns.map(([t, a]) => row(t, { align: a })).join('') });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.text)).toEqual(turns.map(([t]) => t));
  });

  test('emoji-only and emoji-inclusive messages are preserved verbatim', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('🔥🔥🔥', { align: 'left' }),
        row('haha yes it slaps 😂', { align: 'right' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.text)).toEqual(['🔥🔥🔥', 'haha yes it slaps 😂']);
  });

  test('a message containing a link is preserved as normal text', async ({ page }) => {
    await loadThread(page, {
      rows: row('check the carfax https://example.com/carfax/123', { align: 'left' }),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages[0].text).toContain('https://example.com/carfax/123');
    expect(result.messages[0].direction).toBe('inbound');
  });

  // FALLBACK-PATH COVERAGE: a candidate with no X data-testid/className
  // convention at all (a bare `role="row"`) must still resolve direction
  // via the geometry fallback — proves that branch isn't dead code now
  // that the className check is primary.
  test('a bare role="row" candidate with no justify-end/start className falls back to geometry-based direction', async ({ page }) => {
    await loadThread(page, {
      rows: [
        '<div role="row" style="width:150px;margin-right:auto">plain row, left-aligned</div>',
        '<div role="row" style="width:150px;margin-left:auto">plain row, right-aligned</div>',
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages.map((m: any) => m.direction)).toEqual(['inbound', 'outbound']);
  });

  test('presence, receipt, and reaction rows never appear as messages', async ({ page }) => {
    await loadThread(page, {
      rows: [
        row('is typing...', { align: 'left' }),
        row('Is it still up for grabs', { align: 'left' }),
        row('Seen', { align: 'left' }),
        row('Reacted 🔥 to this', { align: 'left' }),
      ].join(''),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: 'Is it still up for grabs', direction: 'inbound' }]);
  });
});

test.describe('X adapter — rich / unsupported content', () => {
  test('a shared post/tweet is represented as a typed placeholder, not hallucinated text', async ({ page }) => {
    await loadThread(page, {
      rows: row('', { align: 'left', extra: '<a href="/cardog_official/status/1234567890123456789" aria-label="Post"></a>' }),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: '[shared a post]', direction: 'inbound' }]);
  });

  test('an image-only message is a typed placeholder, never a hallucinated caption', async ({ page }) => {
    await loadThread(page, {
      rows: row('', { align: 'left', extra: '<img src="https://example.com/photo.jpg" alt="photo" />' }),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: '[shared a photo]', direction: 'inbound' }]);
  });

  test('a voice message is a typed placeholder, never transcribed', async ({ page }) => {
    await loadThread(page, {
      rows: row('', { align: 'left', extra: '<audio src="https://example.com/voice.mp3"></audio>' }),
    });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(result.messages).toEqual([{ text: '[voice message]', direction: 'inbound' }]);
  });
});

test.describe('X adapter — participant identity', () => {
  test('captures display name, username, and profile URL from the CONFIRMED real dm-conversation-username testid', async ({ page }) => {
    await loadThread(page, { rows: row('hello', { align: 'left' }) });
    const customer = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.extractCustomer());
    expect(customer.name).toBe('Cardog Motors');
    expect(customer.username).toBe('cardog_official');
    expect(customer.profile_url).toBe('https://x.com/cardog_official');
  });

  // FALLBACK-PATH COVERAGE: the ORIGINAL guessed data-testid shape
  // (before live evidence corrected the primary selector) must still
  // resolve correctly through readHeaderAnchor's secondary strategies —
  // proves this isn't a case of "old tests happened to still pass
  // because the fixture never changed," the same trap that hid
  // Instagram's live bug.
  test('still resolves identity through the original guessed data-testid shape (fallback path)', async ({ page }) => {
    await loadThread(page, {
      headerHtml: OLD_GUESSED_HEADER_FIXTURE,
      rows: row('hello', { align: 'left' }),
    });
    const customer = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.extractCustomer());
    expect(customer.name).toBe('Cardog Motors');
    expect(customer.username).toBe('cardog_official');
  });

  // ADVERSARIAL FIXTURE (required by the founder's critical-lesson
  // instructions): Instagram's adapter assumed a <header> element that
  // does not exist on real Instagram. This fixture proves the X adapter
  // still resolves the counterpart's identity when NEITHER a <header>
  // element NOR the guessed data-testid wrapper is present at all —
  // only a bare heading + profile link sitting in the thread container.
  test('falls back to the structural (no-header-wrapper) path when the guessed data-testid header is entirely absent', async ({ page }) => {
    await loadThread(page, {
      headerHtml: NO_HEADER_WRAPPER_FIXTURE,
      rows: row('hello', { align: 'left' }),
    });
    const customer = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.extractCustomer());
    expect(customer.name).toBe('Cardog Motors');
    expect(customer.username).toBe('cardog_official');
  });

  test('does not mistake left-nav links (Home, Explore, Messages) for the counterpart\'s profile link', async ({ page }) => {
    await loadThread(page, {
      headerHtml: '<div data-testid="DmHeader"></div>',
      rows: row('hello', { align: 'left' }),
    });
    const customer = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.extractCustomer());
    // No legible name/username signal in this fixture (empty header, and
    // the only links on the page are nav chrome) — must fail safe, never
    // fabricate "Home" or "Messages" as a person's name.
    expect(customer.name).toBeNull();
    expect(customer.username).toBeFalsy();
  });

  test('falls back to generic identity (name null) when no header signal is legible', async ({ page }) => {
    await loadThread(page, {
      headerHtml: '<div data-testid="DmHeader"></div>',
      rows: row('hello', { align: 'left' }),
    });
    const customer = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.extractCustomer());
    expect(customer.name).toBeNull();
  });
});

test.describe('X adapter — cross-conversation isolation (release blocker)', () => {
  test('switching thread URLs changes conversation_key and does not leak the prior thread, then restores correctly switching back', async ({ page }) => {
    await loadThread(page, {
      threadUrl: 'https://x.com/i/chat/AAA111',
      headerHtml: '<div data-testid="DmHeader"><div role="heading"><a href="/buyer_one">Buyer One</a></div></div>',
      rows: row('I want the Tahoe', { align: 'left' }),
    });
    const first = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(first.conversation_key).toBe('chat:AAA111');
    expect(first.last_inbound_text).toBe('I want the Tahoe');

    await loadThread(page, {
      threadUrl: 'https://x.com/i/chat/BBB222',
      headerHtml: '<div data-testid="DmHeader"><div role="heading"><a href="/buyer_two">Buyer Two</a></div></div>',
      rows: row('I want the Silverado', { align: 'left' }),
    });
    const second = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(second.conversation_key).toBe('chat:BBB222');
    expect(second.last_inbound_text).toBe('I want the Silverado');
    expect(second.raw_text).not.toContain('Buyer One');
    expect(second.raw_text).not.toContain('Tahoe');

    // Switch back to A — must restore A's own content, not stay stuck on B's.
    await loadThread(page, {
      threadUrl: 'https://x.com/i/chat/AAA111',
      headerHtml: '<div data-testid="DmHeader"><div role="heading"><a href="/buyer_one">Buyer One</a></div></div>',
      rows: row('I want the Tahoe', { align: 'left' }),
    });
    const third = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.scrapeThread());
    expect(third.conversation_key).toBe('chat:AAA111');
    expect(third.last_inbound_text).toBe('I want the Tahoe');
    expect(third.raw_text).not.toContain('Buyer Two');
    expect(third.raw_text).not.toContain('Silverado');
  });
});

test.describe('X adapter — inject (composer)', () => {
  test('resolves the DM composer for text output (CONFIRMED real textarea)', async ({ page }) => {
    await loadThread(page, { rows: row('hello', { align: 'left' }) });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.inject('Sounds good, want to swing by?', 'text'));
    expect(result.ok).toBe(true);
    expect(result.method).toBe('x_dm_composer');
  });

  // REGRESSION (live bug, 2026-09-23): inject() used to always return
  // the hardcoded OLD contenteditable-div guess as composer_selector
  // regardless of which selector actually matched — content.ts's real
  // inject handler re-queries the DOM fresh by this exact string
  // rather than reusing the element inject() found internally, so on
  // real X (a <textarea>) that stale string resolved to null and
  // Inject failed with "composer_selector_resolved_null" even though
  // Generate worked correctly moments earlier. This proves the
  // returned selector string itself is queryable and resolves to a
  // real element — not just that inject() returns ok:true internally.
  test('composer_selector in the result actually resolves via a fresh document.querySelector (regression)', async ({ page }) => {
    await loadThread(page, { rows: row('hello', { align: 'left' }) });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.inject('Sounds good, want to swing by?', 'text'));
    expect(result.ok).toBe(true);
    const resolvedCount = await page.evaluate(
      (selector: string) => document.querySelectorAll(selector).length,
      result.composer_selector,
    );
    expect(resolvedCount).toBeGreaterThan(0);
  });

  // FALLBACK-PATH COVERAGE: the original guessed contenteditable-div
  // composer shape (not the confirmed real <textarea>) must still
  // resolve — proves findComposer()'s secondary strategies are live
  // code, not dead fallbacks nothing ever exercises.
  test('still resolves the original guessed contenteditable composer shape (fallback path)', async ({ page }) => {
    await loadThread(page, { rows: row('hello', { align: 'left' }), withComposer: false });
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('role', 'textbox');
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('aria-label', 'Message');
      document.getElementById('thread')!.after(el);
    });
    const hasOpen = await page.evaluate(() => (window as any).XAdapterTest.hasOpenXThread());
    expect(hasOpen).toBe(true);
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.inject('hi', 'text'));
    expect(result.ok).toBe(true);
  });

  test('rejects email/crm_note kinds — X only supports text composer inject', async ({ page }) => {
    await loadThread(page, { rows: row('hello', { align: 'left' }) });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.inject('note', 'crm_note'));
    expect(result.ok).toBe(false);
  });

  test('fails safe when no composer is rendered (thread not actually open)', async ({ page }) => {
    await loadThread(page, { rows: row('hello', { align: 'left' }), withComposer: false });
    const result = await page.evaluate(() => (window as any).XAdapterTest.xAdapter.inject('hi', 'text'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_x_compose_found');
  });
});
