import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-gmail-adapter-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/platforms/gmail.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=GmailAdapterTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

async function scan(page: any, body: string) {
  await page.setContent(`<!doctype html><html><body>
    <header>
      <a aria-label="Google Account: Yancy Garcia (rep@example.com)" href="#account">Account</a>
    </header>
    <h2>Vehicle follow-up</h2>
    <main>${body}</main>
  </body></html>`);
  await page.addScriptTag({ path: bundlePath });
  return page.evaluate(() => (window as any).GmailAdapterTest.gmailAdapter.scrapeThread());
}

test('single customer reply is inbound from sender email mismatch', async ({ page }) => {
  const result = await scan(page, `
    <div class="adn">
      <span class="gD" name="Customer Alpha" email="customer@example.com">Customer Alpha</span>
      <div class="a3s">Is the 2024 Tahoe still available?</div>
    </div>
  `);

  expect(result.messages).toEqual([
    { text: 'Is the 2024 Tahoe still available?', direction: 'inbound' },
  ]);
  expect(result.last_inbound_text).toBe('Is the 2024 Tahoe still available?');
  expect(result.raw_text).toContain('[inbound] Is the 2024 Tahoe still available?');
});

test('rep-authored reply is outbound when sender email matches logged-in Gmail account', async ({ page }) => {
  const result = await scan(page, `
    <div class="adn">
      <span class="gD" name="Yancy Garcia" email="rep@example.com">Yancy Garcia</span>
      <div class="a3s">Yes, it is still here. Want to come by?</div>
    </div>
  `);

  expect(result.messages).toEqual([
    { text: 'Yes, it is still here. Want to come by?', direction: 'outbound' },
  ]);
  expect(result.last_inbound_text).toBe('');
});

test('long back-and-forth preserves deterministic directions and last inbound', async ({ page }) => {
  const result = await scan(page, `
    <div class="adn">
      <span class="gD" name="Customer Alpha" email="customer@example.com">Customer Alpha</span>
      <div class="a3s">Can I see numbers on the Silverado?</div>
    </div>
    <div class="adn">
      <span class="gD" name="Yancy Garcia" email="rep@example.com">Yancy Garcia</span>
      <div class="a3s">Absolutely, I can help with that.</div>
    </div>
    <div class="adn">
      <span class="gD" name="Customer Alpha" email="customer@example.com">Customer Alpha</span>
      <div class="a3s">Great. What is the payment with 2000 down?</div>
    </div>
  `);

  expect(result.messages.map((message: any) => message.direction)).toEqual(['inbound', 'outbound', 'inbound']);
  expect(result.last_inbound_text).toBe('Great. What is the payment with 2000 down?');
});

test('forwarded or quoted Gmail history is removed from included message text', async ({ page }) => {
  const result = await scan(page, `
    <div class="adn">
      <span class="gD" name="Customer Alpha" email="customer@example.com">Customer Alpha</span>
      <div class="a3s">
        Can you send a fresh quote?
        <div class="gmail_quote">
          On Jan 1, Yancy Garcia wrote:
          Old copied history that must not be treated as a new customer message.
        </div>
      </div>
    </div>
    <div class="adn">
      <span class="gD" name="Customer Beta" email="customer2@example.com">Customer Beta</span>
      <div class="a3s">
        Please forward the window sticker.
        ---------- Forwarded message ---------
        From: Someone Else &lt;else@example.com&gt;
        Hidden forwarded body.
      </div>
    </div>
  `);

  expect(result.messages[0].text).toBe('Can you send a fresh quote?');
  expect(result.messages[1].text).toBe('Please forward the window sticker.');
  expect(result.raw_text).not.toContain('Old copied history');
  expect(result.raw_text).not.toContain('Hidden forwarded body');
});

test('ambiguous collapsed message without sender identity is excluded instead of guessed', async ({ page }) => {
  const result = await scan(page, `
    <div class="adn">
      <span class="gD">Unknown Sender</span>
      <div class="a3s">This visible line has no deterministic sender identity.</div>
    </div>
    <div class="adn">
      <span class="gD" name="Customer Alpha" email="customer@example.com">Customer Alpha</span>
      <div class="a3s">This line is safe to include.</div>
    </div>
  `);

  expect(result.messages).toEqual([
    { text: 'This line is safe to include.', direction: 'inbound' },
  ]);
  expect(result.raw_text).not.toContain('no deterministic sender identity');
});

test('Gmail me sender marker is outbound even when the email attribute is absent', async ({ page }) => {
  const result = await scan(page, `
    <div class="adn">
      <span class="gD" name="me">me</span>
      <div class="a3s">Following up from my side.</div>
    </div>
  `);

  expect(result.messages).toEqual([
    { text: 'Following up from my side.', direction: 'outbound' },
  ]);
  expect(result.last_inbound_text).toBe('');
});
