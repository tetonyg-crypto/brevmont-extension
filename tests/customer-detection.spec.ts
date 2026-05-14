import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(tmpdir(), 'brevmont-customer-detection-test.js');

test.beforeAll(() => {
  execFileSync(process.execPath, [
    path.join(root, 'node_modules/esbuild/bin/esbuild'),
    path.join(root, 'entrypoints/lib/customerDetection.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=CustomerDetectionTest',
    `--outfile=${bundlePath}`,
  ]);
});

test.afterAll(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

test('detects a Facebook Messenger customer and vehicle from visible conversation context', async ({ page }) => {
  await page.route('https://www.messenger.com/e2ee/t/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Danny Estrella | Messenger</title></head><body>
        <div role="main">
          <header><h1>Danny Estrella</h1></header>
          <section>
            <h2>Danny Estrella</h2>
            <p>Danny Estrella created this group</p>
            <div>Yancy como estas, estoy vendiendo mi Subaru Impreza 2022, con 56000 millas soy el unico dueño, por si te interesa</div>
            <div>Mandame el vin</div>
          </section>
        </div>
      </body></html>`,
    });
  });

  await page.goto('https://www.messenger.com/e2ee/t/993811733304984?locale=en_US');
  await page.addScriptTag({ path: bundlePath });
  const detected = await page.evaluate(async () => (window as any).CustomerDetectionTest.detectCustomerFromPage());

  expect(detected?.name).toBe('Danny Estrella');
  expect(detected?.vehicle).toMatch(/2022 Subaru Impreza/i);
  expect(detected?.source).toBe('facebook');
  expect(detected?.confidence).toBeGreaterThanOrEqual(0.8);
});

test('detects a Facebook Marketplace buyer from the real middle-dot title pattern', async ({ page }) => {
  await page.route('https://www.facebook.com/marketplace/t/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Robert · 2021 Jeep Grand</title></head><body>
        <div role="main">
          <header><h1>Robert · 2021 Jeep Grand</h1></header>
          <p>What engine</p>
        </div>
      </body></html>`,
    });
  });

  await page.goto('https://www.facebook.com/marketplace/t/1747249079917759?locale=en_US');
  await page.addScriptTag({ path: bundlePath });
  const detected = await page.evaluate(async () => (window as any).CustomerDetectionTest.detectCustomerFromPage());

  expect(detected?.name).toBe('Robert');
  expect(detected?.vehicle).toMatch(/2021 Jeep Grand/i);
  expect(detected?.source).toBe('facebook');
});
