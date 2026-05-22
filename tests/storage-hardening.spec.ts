import { test, expect } from '@playwright/test';
import { migrateAuthTokensOutOfSync, sanitizeSyncPayload } from '../lib/storage';

function makeArea(initial: Record<string, unknown>) {
  const data = { ...initial };
  return {
    data,
    get(keys: string[] | string, cb?: (result: Record<string, unknown>) => void) {
      const list = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of list) if (key in data) result[key] = data[key];
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set(patch: Record<string, unknown>, cb?: () => void) {
      Object.assign(data, patch);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys: string[] | string, cb?: () => void) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      if (cb) cb();
      return Promise.resolve();
    },
  };
}

function installChrome(localData: Record<string, unknown>, syncData: Record<string, unknown>) {
  (globalThis as any).chrome = {
    runtime: { lastError: null },
    storage: {
      local: makeArea(localData),
      sync: makeArea(syncData),
    },
  };
}

test('auth storage migration removes auth tokens from sync', async () => {
  installChrome({}, {
    dealer_token: 'dtk_123',
    rep_auth_token: 'BRVMT-REP-123',
    brevmont_rep_auth_token: 'BRVMT-REP-123',
    license_secret: 'legacy-secret',
    brevmont_license_secret: 'legacy-secret',
  });

  await migrateAuthTokensOutOfSync();

  const sync = (globalThis as any).chrome.storage.sync.data;
  expect(sync.dealer_token).toBeUndefined();
  expect(sync.rep_auth_token).toBeUndefined();
  expect(sync.brevmont_rep_auth_token).toBeUndefined();
  expect(sync.license_secret).toBeUndefined();
  expect(sync.brevmont_license_secret).toBeUndefined();
});

test('auth storage migration preserves usable tokens in local storage', async () => {
  installChrome({}, {
    dealer_token: 'dtk_123',
    rep_auth_token: 'BRVMT-REP-123',
  });

  await migrateAuthTokensOutOfSync();

  const local = (globalThis as any).chrome.storage.local.data;
  expect(local.dealer_token).toBe('dtk_123');
  expect(local.rep_auth_token).toBe('BRVMT-REP-123');
  expect(local.brevmont_rep_auth_token).toBe('BRVMT-REP-123');
  expect(local.brevmont_auth_storage_hardened).toBe(true);
});

test('new sync payloads strip auth tokens before write', () => {
  const payload = sanitizeSyncPayload({
    dealer_token: 'dtk_123',
    rep_auth_token: 'BRVMT-REP-123',
    brevmont_rep_auth_token: 'BRVMT-REP-123',
    license_secret: 'legacy-secret',
    rep_name: 'Sam',
    dealership: 'Ridgeline',
  });

  expect(payload).toEqual({ rep_name: 'Sam', dealership: 'Ridgeline' });
});

test('auth storage migration retries cleanup if hardening flag already exists', async () => {
  installChrome(
    {
      brevmont_auth_storage_hardened: true,
      dealer_token: 'dtk_local',
    },
    {
      dealer_token: 'dtk_sync',
      rep_auth_token: 'BRVMT-REP-SYNC',
      license_secret: 'legacy-secret',
    },
  );

  await migrateAuthTokensOutOfSync();

  const local = (globalThis as any).chrome.storage.local.data;
  const sync = (globalThis as any).chrome.storage.sync.data;
  expect(local.dealer_token).toBe('dtk_local');
  expect(local.rep_auth_token).toBe('BRVMT-REP-SYNC');
  expect(sync.dealer_token).toBeUndefined();
  expect(sync.rep_auth_token).toBeUndefined();
  expect(sync.license_secret).toBeUndefined();
});
