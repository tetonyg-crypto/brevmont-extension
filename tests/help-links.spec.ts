import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildChangelogUrl,
  buildManualUrl,
  DEFAULT_CHANGELOG_URL,
  DEFAULT_MANUAL_BASE_URL,
  resolveChangelogUrl,
  resolveManualUrl,
} from '../lib/helpLinks';
import { getPanelHTML } from '../entrypoints/lib/panelUI';

test('manual links use the stable app bridge and identify extension context', () => {
  expect(buildManualUrl(undefined)).toBe(`${DEFAULT_MANUAL_BASE_URL}?source=extension`);
  expect(buildManualUrl(DEFAULT_MANUAL_BASE_URL, 'coach')).toBe(
    `${DEFAULT_MANUAL_BASE_URL}?source=extension&topic=coach`,
  );
});

test('manual and changelog overrides stay on the secure Brevmont app origin', () => {
  expect(buildManualUrl('https://app.brevmont.com/guide', 'ask')).toBe(
    'https://app.brevmont.com/guide?source=extension&topic=ask',
  );
  expect(buildManualUrl('https://example.com/help', 'ask')).toBe(
    `${DEFAULT_MANUAL_BASE_URL}?source=extension&topic=ask`,
  );
  expect(buildManualUrl('http://app.brevmont.com/help', 'ask')).toBe(
    `${DEFAULT_MANUAL_BASE_URL}?source=extension&topic=ask`,
  );
  expect(buildChangelogUrl('https://example.com/changelog')).toBe(DEFAULT_CHANGELOG_URL);
});

test('resolved links fall back when extension storage is unavailable', async () => {
  (globalThis as any).browser = {
    storage: { local: { get: () => Promise.reject(new Error('storage unavailable')) } },
  };
  await expect(resolveManualUrl('settings')).resolves.toBe(
    `${DEFAULT_MANUAL_BASE_URL}?source=extension&topic=settings`,
  );
  await expect(resolveChangelogUrl()).resolves.toBe(DEFAULT_CHANGELOG_URL);
  delete (globalThis as any).browser;
});

test('sidepanel renders manual, changelog, support, and issue entry points', () => {
  const html = getPanelHTML('gmail');
  expect(html).toContain('id="o8-manual-btn"');
  expect(html).toContain('id="sp-link-help"');
  expect(html).toContain("Owner's manual");
  expect(html).toContain('id="sp-link-overdrive-manual"');
  expect(html).toContain('id="sp-link-changelog"');
  expect(html).toContain('id="sp-link-support"');
  expect(html).toContain('id="sp-link-report"');
  expect(html).not.toContain('href="https://app.brevmont.com/changelog"');
});

test('popup keeps manual reading separate from support reporting', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/popup/main.tsx'), 'utf8');
  expect(source).toContain("openManual('install-login')");
  expect(source).toContain("openManual('rep-tool')");
  expect(source).toContain("Owner's manual");
  expect(source).toContain('Contact support');
  expect(source).toContain('Report issue');
  expect(source).not.toContain('href="https://app.brevmont.com/changelog"');
});
