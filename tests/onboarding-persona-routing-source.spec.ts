import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

// Founder runtime defect (Blocker 2, 2026-09-25): a brand-new extension
// install's toolbar "Get started" click landed directly on
// app.brevmont.com/auth/extension's generic "Create your account" screen,
// with the workspace choice ("Continue - all sales" vs "I sell cars -
// automotive workspace") buried near the bottom -- rather than the clearer
// /welcome choice screen that already exists for exactly this case and
// already forwards to /auth/extension?plan=... once chosen. Fixed by
// pointing the FIRST-TIME-ONLY branch of action.onClicked at /welcome.
// Returning-user re-auth (AUTH_APP_URL with ?force=1 in sidepanel/main.ts,
// and the trial-recovery/manual-setup paths in popup/main.tsx and
// onboarding/main.ts) is untouched -- those users already have a persisted
// persona and must go straight to /auth/extension, not back through the
// workspace-choice screen.
test('a brand-new install (no setup, no tokens) lands on /welcome, not /auth/extension directly', () => {
  const background = read('entrypoints/background.ts');
  const clickedStart = background.indexOf('chrome.action.onClicked.addListener');
  const clickedEnd = background.indexOf('});', background.indexOf('} catch (e) {', clickedStart)) + 3;
  const body = background.slice(clickedStart, clickedEnd);

  // The zero-state ("First time") branch must open /welcome.
  const firstTimeStart = body.indexOf('First time');
  const firstTimeBranch = body.slice(firstTimeStart, body.indexOf('}', firstTimeStart));
  expect(firstTimeBranch).toContain("url: 'https://app.brevmont.com/welcome'");
  expect(firstTimeBranch).not.toContain("url: 'https://app.brevmont.com/auth/extension'");

  // The catch-block fallback for that same first-time path must match.
  const catchStart = body.indexOf('} catch (e) {');
  const catchBranch = body.slice(catchStart);
  expect(catchBranch).toContain("url: 'https://app.brevmont.com/welcome'");

  // A returning, already-onboarded user must still go straight to the side
  // panel, and a partially-set-up user (has a token) must still go to
  // onboarding.html -- neither should be routed through /welcome.
  expect(body).toContain("chrome.sidePanel as any).open");
  expect(body).toContain("chrome.runtime.getURL('onboarding.html')");
});

test('returning-user re-auth (force=1) still goes straight to /auth/extension, not /welcome', () => {
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  expect(sidepanel).toContain("const AUTH_APP_URL = 'https://app.brevmont.com/auth/extension';");
  expect(sidepanel).toMatch(/AUTH_APP_URL\}\?force=1/);
});

test('/auth/extension already supports ?plan= and ?signin=1, confirming /welcome can reuse it without new onboarding', () => {
  const authExtension = read('../brevmont-app/src/pages/AuthExtension.tsx');
  expect(authExtension).toMatch(/params\.get\("plan"\)/);
  expect(authExtension).toMatch(/signin"\)\s*===\s*"1"/);
});
