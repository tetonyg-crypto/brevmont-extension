import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

test('background session-ready bridge emits receiver and result traces', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/background.ts'), 'utf8');
  expect(source).toContain("'session_ready_received'");
  expect(source).toContain("'session_ready_purge_complete'");
  expect(source).toContain("'session_ready_config_result'");
  expect(source).toContain("'session_ready_config_error'");
  expect(source).toContain("'session_ready_signed_out_blocked'");
  expect(source).toContain('auth_intent: authIntent ||');
  expect(source).toContain("step: 'try_cookie_share_identity_compare'");
  expect(source).toContain("step: 'try_cookie_share_identity_mismatch'");
  expect(source).toContain('expected_dealership_id: payload.expected_dealership_id');
  expect(source).toContain("dealership_id: (local.dealership_id || sync.dealership_id || '') as string");
  expect(source).toContain('signed_out: !!local[SIGNED_OUT_SENTINEL_KEY]');
});

test('identity guard rejects missing or mismatched selected-store identity', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/background.ts'), 'utf8');
  const compare = source.indexOf('const identityComparePayload = {');
  const mismatch = source.indexOf('const dealershipIdMismatch = expectedDealershipId && expectedDealershipId !== actualDealershipId;', compare);
  const reject = source.indexOf("step: 'try_cookie_share_identity_mismatch'", mismatch);
  expect(compare).toBeGreaterThan(-1);
  expect(mismatch).toBeGreaterThan(compare);
  expect(reject).toBeGreaterThan(mismatch);
  expect(source).not.toContain('expectedDealershipId && actualDealershipId && expectedDealershipId !== actualDealershipId');
});

test('auth trace payloads stamp runtime extension version', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/lib/authFlowTrace.ts'), 'utf8');
  expect(source).toContain('function extensionVersion()');
  expect(source).toContain('ext_version: extensionVersion()');
});

test('extension never surfaces versions to a user: no update banner, no version gate', () => {
  // Founder standing order (2026-07-23): the extension must never mention a
  // version, prompt for an update, or block on a version mismatch. These
  // assertions keep every known banner/gate path from coming back.
  const sidepanel = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');
  const content = readFileSync(resolve(process.cwd(), 'entrypoints/content.ts'), 'utf8');
  const background = readFileSync(resolve(process.cwd(), 'entrypoints/background.ts'), 'utf8');
  for (const source of [sidepanel, content, background]) {
    expect(source).not.toContain('brevmont_version_status');
    expect(source).not.toContain('Update available');
    expect(source).not.toContain('update-available');
  }
  expect(sidepanel).not.toContain('/api/extension/version');
  expect(sidepanel).not.toContain('refreshVersionStatusFromApi');
  expect(sidepanel).not.toContain('ensureGenerationAllowed');
  expect(content).not.toContain('brevmont-version-lock');
  expect(background).not.toContain('checkVersionStatus');
  expect(background).not.toContain('brevmont-version-check');
  expect(background).not.toContain('/v1/heartbeat/version');
});
