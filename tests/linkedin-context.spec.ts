import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-linkedin-adapter-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/platforms/linkedin.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=LinkedInAdapterTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

async function scan(page: any, html: string) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  await page.addScriptTag({ path: bundlePath });
  return page.evaluate(() => (window as any).LinkedInAdapterTest.linkedinAdapter.scrapeThread());
}

test('reads the active LinkedIn customer message instead of quick-reply UI', async ({ page }) => {
  const result = await scan(page, `
    <ul class="msg-conversations-container__conversations-list">
      <li class="msg-conversation-listitem"><div class="msg-conversations-container__convo-item-link--active">Chris Hogan Chris: Thanks for connecting but I am not interested</div></li>
    </ul>
    <div class="scaffold-layout__detail">
      <div class="msg-convo-wrapper msg-thread">
        <a class="msg-thread__link-to-profile" href="/in/chris">Chris Hogan Status is reachable Mobile • 17h ago</a>
        <ul class="msg-s-message-list-content">
          <li class="msg-s-message-list__event">
            <div class="msg-s-event-listitem msg-s-event-listitem--self">
              <a class="msg-s-message-group__name">Yancy Garcia</a>
              <p class="msg-s-event-listitem__body">How is your store using AI?</p>
            </div>
          </li>
          <li class="msg-s-message-list__event">
            <div class="msg-s-event-listitem msg-s-event-listitem--other">
              <a class="msg-s-message-group__name">Chris Hogan</a>
              <p class="msg-s-event-listitem__body">Thanks for connecting but I am not interested</p>
            </div>
          </li>
        </ul>
        <div class="msg-s-message-list__quick-replies-container">Reply to conversation with No problem</div>
      </div>
    </div>
  `);

  expect(result.header_text).toBe('Chris Hogan');
  expect(result.last_inbound_text).toBe('Thanks for connecting but I am not interested');
  expect(result.messages).toEqual([
    { text: 'How is your store using AI?', direction: 'outbound' },
    { text: 'Thanks for connecting but I am not interested', direction: 'inbound' },
  ]);
  expect(result.raw_text).not.toContain('Reply to conversation');
});

test('refuses the active Sponsored LinkedIn thread', async ({ page }) => {
  const result = await scan(page, `
    <ul><li class="msg-conversation-listitem"><div class="msg-conversations-container__convo-item-link--active">Mily W Hoi Sponsored Quick intro</div></li></ul>
    <div class="scaffold-layout__detail">
      <div class="msg-convo-wrapper msg-thread">
        <div class="msg-spinmail-thread-presenter"><p>Sponsored</p><h3>Quick intro</h3></div>
      </div>
    </div>
  `);

  expect(result.is_blocked_context).toBe(true);
  expect(result.blocked_reason).toBe('This is an ad - open a customer conversation.');
  expect(result.messages).toEqual([]);
});
