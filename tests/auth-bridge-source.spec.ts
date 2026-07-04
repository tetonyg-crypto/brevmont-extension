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

test('sidepanel checks public extension version endpoint for stale-build banner', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');
  expect(source).toContain('https://api.brevmont.com/api/extension/version?current_version=');
  expect(source).toContain('Update available: reload the extension');
  expect(source).toContain('refreshVersionStatusFromApi');
});
