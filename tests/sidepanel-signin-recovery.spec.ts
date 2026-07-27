import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

// Guards the P0 fix (2026-07-26): the side panel stalled forever on
// "Sign in to keep going" when the one-shot externally_connectable
// SESSION_READY message was dropped, because the signed-out poll loop only
// re-read storage and had no cookie fallback, and the ?force=1 signed-out
// sentinel blocked the cookie path. The fix: poll pulls the cookie every
// cycle, and an explicit in-panel sign-in gesture opens a short window that
// lets the cookie path adopt the fresh session past the sentinel.

const panel = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');
const bg = readFileSync(resolve(process.cwd(), 'entrypoints/background.ts'), 'utf8');

test('signed-out poll actively pulls the cookie, not just storage', () => {
  // The wait-loop must ask the background to sync from the cookie each cycle.
  const pollIdx = panel.indexOf('__brevmontSignInPollId = pollId');
  const loopStart = panel.lastIndexOf('window.setInterval', pollIdx);
  const loopBody = panel.slice(loopStart, pollIdx);
  expect(loopBody).toContain("type: 'SYNC_AUTH_FROM_COOKIE'");
  expect(loopBody).toContain('hasStoredSession()');
});

test('explicit sign-in buttons signal the sign-in gesture to the background', () => {
  expect(panel).toContain("type: 'BREVMONT_PANEL_SIGN_IN_STARTED'");
  // Both the primary "Sign in with Google" and "Start over" gestures fire it.
  const occurrences = panel.split("type: 'BREVMONT_PANEL_SIGN_IN_STARTED'").length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(2);
});

test('background opens a sign-in window: clears the stale cookie FIRST, then marks the window', () => {
  expect(bg).toContain("msg.type === 'BREVMONT_PANEL_SIGN_IN_STARTED'");
  const handlerIdx = bg.indexOf("msg.type === 'BREVMONT_PANEL_SIGN_IN_STARTED'");
  const handler = bg.slice(handlerIdx, handlerIdx + 1400);
  const removeIdx = handler.indexOf('cookies.remove');
  // match the actual set-operation, not the identifier in the comment above it.
  const setWindowIdx = handler.indexOf('storage.local.set({ [SIGN_IN_WINDOW_KEY]');
  expect(removeIdx).toBeGreaterThan(-1);
  expect(setWindowIdx).toBeGreaterThan(-1);
  // cookie cleared BEFORE the window opens (no stale cookie in the window).
  expect(removeIdx).toBeLessThan(setWindowIdx);
});

test('cookie adoption is allowed past the sentinel ONLY while the sign-in window is fresh', () => {
  expect(bg).toContain('const SIGN_IN_WINDOW_KEY');
  expect(bg).toContain('SIGN_IN_WINDOW_MS');
  expect(bg).toContain('const signInWindowFresh');
  // The sentinel block only fires when NOT in a fresh sign-in window.
  expect(bg).toContain('guardState[SIGNED_OUT_SENTINEL_KEY] && !signInWindowFresh');
});

test('the sign-in window is closed once a session is adopted (guard resumes)', () => {
  const clearIdx = bg.indexOf('remove(SIGNED_OUT_SENTINEL_KEY)');
  const after = bg.slice(clearIdx, clearIdx + 300);
  expect(after).toContain('remove(SIGN_IN_WINDOW_KEY)');
});
