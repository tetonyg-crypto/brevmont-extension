import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-crm-note-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/crmNote.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=CrmNoteTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

test('trims VinSolutions CRM notes to the compatibility limit', async ({ page }) => {
  await page.setContent('<main></main>');
  await page.addScriptTag({ path: bundlePath });
  const result = await page.evaluate(() => {
    const longNote = 'A'.repeat(2100);
    return (window as any).CrmNoteTest.trimCrmNoteForCompatibility(longNote, 'vinsolutions');
  });

  expect(result.trimmed).toBe(true);
  expect(result.limit).toBe(2000);
  expect(result.text.length).toBeLessThanOrEqual(2000);
  expect(result.text.endsWith('…')).toBe(true);
});

test('leaves short CRM notes unchanged', async ({ page }) => {
  await page.setContent('<main></main>');
  await page.addScriptTag({ path: bundlePath });
  const result = await page.evaluate(() =>
    (window as any).CrmNoteTest.trimCrmNoteForCompatibility('Short note', 'vinsolutions')
  );

  expect(result).toEqual({ text: 'Short note', limit: 2000, trimmed: false });
});
