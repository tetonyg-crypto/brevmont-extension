import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-lead-context-test.js');

test.beforeAll(() => {
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'entrypoints/lib/leadContextScan.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=LeadContextTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

test('Gmail empty compose mode does not reuse the customer from the thread behind it', async ({ page }) => {
  await page.setContent(`
    <main>
      <span class="gD" name="Customer Alpha" email="alpha@example.com">Customer Alpha</span>
      <div role="dialog" aria-label="New Message">
        <input name="to" value="" />
      </div>
    </main>
  `);
  await page.addScriptTag({ path: bundlePath });

  const result = await page.evaluate(() => ({
    composeActive: (window as any).LeadContextTest.hasActiveComposeSurface('gmail'),
    name: (window as any).LeadContextTest.extractContactName('gmail'),
  }));

  expect(result.composeActive).toBe(true);
  expect(result.name).toBeNull();
});
