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

// 2026-09-28: the session could land correctly in storage (bridge succeeded)
// while this screen sat stale on "Still waiting on sign-in" indefinitely --
// confirmed live: pinging the extension showed a fully signed-in session for
// the account the rep had just created, while the panel still showed the
// stuck screen. Root cause: reps spend the whole sign-in tab flow (Google
// picker, or the new-account industry/what-you-sell form) with this panel
// out of focus, and an unfocused/hidden panel's setInterval can be throttled
// or paused by Chrome, so the 3s poll may simply not fire again until
// something wakes it. Fix: re-check the instant the panel regains
// visibility/focus, not just on the timer.
test('re-checks sign-in status immediately when the panel regains focus/visibility, not just on the timer', () => {
  const listenerIdx = panel.indexOf('const recheckOnFocus');
  expect(listenerIdx).toBeGreaterThan(-1);
  const listenerBody = panel.slice(listenerIdx, panel.indexOf('__brevmontSignInFocusListener = recheckOnFocus') + 50);
  expect(listenerBody).toContain("document.visibilityState !== 'visible'");
  expect(listenerBody).toContain('hasStoredSession()');
  expect(listenerBody).toContain("document.addEventListener('visibilitychange', recheckOnFocus)");
  expect(listenerBody).toContain("window.addEventListener('focus', recheckOnFocus)");
});

test('the focus/visibility listener is cleaned up on re-mount so retries do not stack duplicate listeners', () => {
  const cleanupIdx = panel.indexOf('__brevmontSignInFocusListener');
  const cleanupBody = panel.slice(cleanupIdx, cleanupIdx + 300);
  expect(cleanupBody).toContain("removeEventListener('visibilitychange'");
  expect(cleanupBody).toContain("removeEventListener('focus'");
});

test('first-click signed-out screen offers new-user onboarding and existing-user sign-in', () => {
  expect(panel).toContain("BREVMONT_WELCOME_URL");
  expect(panel).toContain("function openNewUserOnboardingTab()");
  expect(panel).toContain("id=\"sp-get-started\"");
  expect(panel).toContain("Brevmont Lead Responder");
  expect(panel).toContain("Sales tools that help you reply, follow up, organize lead context, and know the next move.");
  expect(panel).toContain("Get started");
  expect(panel).toContain("Sign in with Google");
  expect(panel).toContain("getStartedBtn.onclick = () => openNewUserOnboardingTab()");
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

// 2026-09-28: a brand-new all-sales/personal-rep account must clear the
// vertical picker, Google consent, and the industry + "what you sell" form
// before the session cookie is written -- comfortably longer than the old
// 3-minute window for a real person filling in a new account. If the window
// closed before that cookie landed (with a stale signed-out sentinel from
// earlier same-profile testing still set), the cookie-poll fallback refused
// to adopt the freshly-written session and the panel stalled on "Still
// waiting on sign-in" even though app.brevmont.com showed an authenticated
// /rep/home. Guard the window against regressing back down.
test('the sign-in window comfortably covers a new-account signup form, not just a quick re-auth', () => {
  const constIdx = bg.indexOf('const SIGN_IN_WINDOW_MS');
  const declaration = bg.slice(constIdx, bg.indexOf(';', constIdx) + 1);
  const match = declaration.match(/(\d+)\s*\*\s*60\s*\*\s*1000/);
  expect(match).not.toBeNull();
  const minutes = Number(match?.[1] || 0);
  expect(minutes).toBeGreaterThanOrEqual(10);
});
