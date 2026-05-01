/**
 * Playwright config — Brevmont Extension E2E Tests
 *
 * Tests run against static mock-vinsolutions HTML pages via file:// protocol.
 * No web server needed — the mock pages are self-contained static HTML/CSS/JS.
 *
 * Covers:
 *   - Mock DOM structure validation (all extension selectors exist)
 *   - Mock page behavior (tabs, save-note, activity log)
 *   - Extension injection surface tests (textarea writable, inject point present)
 *
 * Extension-loaded tests (require --load-extension) are marked with
 * [extension-required] in test title and skipped in CI unless
 *   BREVMONT_EXTENSION_PATH env var is set to the built extension dir.
 *
 * Usage:
 *   npx playwright test                   (DOM structure + behavior tests)
 *   npx playwright test --update-snapshots (regenerate visual baselines)
 *
 * Install:
 *   npm install --save-dev @playwright/test
 *   npx playwright install chromium
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'off',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer — file:// protocol, no server needed
});
