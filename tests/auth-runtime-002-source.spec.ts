import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

test('captured_leads Dexie table is cleared when a new identity is adopted (AUTH-RUNTIME-002)', () => {
  const background = read('entrypoints/background.ts');
  const sessionReadyStart = background.indexOf("'BREVMONT_REP_SESSION_READY'");
  const sessionReadyBody = background.slice(sessionReadyStart, background.indexOf('session_ready_purge_complete', sessionReadyStart));
  expect(sessionReadyBody).toContain('leadDb.captured_leads.clear()');
  // Must run alongside (not after) the identity storage purge, in the same
  // Promise.allSettled batch, so a signed-in reader never sees a moment
  // where storage says the new rep but Dexie still has the old rep's leads.
  const purgeCallStart = sessionReadyBody.indexOf('Promise.allSettled([');
  const purgeCallEnd = sessionReadyBody.indexOf(']);', purgeCallStart);
  const purgeCall = sessionReadyBody.slice(purgeCallStart, purgeCallEnd);
  expect(purgeCall).toContain('IDENTITY_LOCAL_KEYS');
  expect(purgeCall).toContain('leadDb.captured_leads.clear()');
});

test('captured_leads Dexie table is cleared on explicit sign-out (AUTH-RUNTIME-002)', () => {
  const background = read('entrypoints/background.ts');
  const signOutStart = background.indexOf("'BREVMONT_REP_SIGN_OUT'");
  const signOutBody = background.slice(signOutStart, background.indexOf('SIGNED_OUT_SENTINEL_KEY', signOutStart) + 200);
  expect(signOutBody).toContain('leadDb.captured_leads.clear()');
});

test('a successful generation refreshes the account chip so the free-replies counter is live (AUTH-RUNTIME-002)', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const start = source.indexOf('async function recordSuccessfulGeneration');
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  expect(body).toContain('renderAccountChip()');
});
