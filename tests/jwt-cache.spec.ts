import { expect, test } from '@playwright/test';
import { clearJwtCache, getJWT } from '../lib/jwtCache';

function makeJwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

function installBrowserStorage(initial: Record<string, any>) {
  const data = { ...initial };
  (globalThis as any).browser = {
    storage: {
      local: {
        data,
        async get(keys: string[] | string) {
          const result: Record<string, any> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) result[key] = data[key];
          return result;
        },
        async set(patch: Record<string, any>) {
          Object.assign(data, patch);
        },
        async remove(keys: string[] | string) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
        },
      },
    },
  };
  return data;
}

test.afterEach(async () => {
  await clearJwtCache();
  delete (globalThis as any).browser;
  delete (globalThis as any).fetch;
});

test('getJWT exchanges a local rep token and caches the bearer token', async () => {
  const storage = installBrowserStorage({ rep_auth_token: 'BRVMT-REP-123' });
  const jwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  let calls = 0;
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    calls += 1;
    expect(url).toBe('https://api.brevmont.test/api/v1/auth/token');
    expect((init.headers as Record<string, string>)['X-Rep-Token']).toBe('BRVMT-REP-123');
    return new Response(JSON.stringify({ token: jwt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await expect(getJWT('https://api.brevmont.test')).resolves.toBe(jwt);
  await expect(getJWT('https://api.brevmont.test')).resolves.toBe(jwt);
  expect(calls).toBe(1);
  expect(storage.brevmont_jwt_cache).toMatchObject({ token: jwt });
});

test('getJWT marks rep access ended when token mint rejects a revoked rep token', async () => {
  const storage = installBrowserStorage({ brevmont_rep_auth_token: 'BRVMT-REP-REVOKED' });
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ error: 'rep_token_revoked' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  await expect(getJWT('https://api.brevmont.test')).resolves.toBeNull();
  expect(storage.license_revoked).toBe(true);
  expect(storage.brevmont_last_error).toBe('rep_token_revoked');
  expect(storage.brevmont_jwt_cache).toBeUndefined();
});

test('getJWT marks trial ended when token mint returns error_code trial_ended', async () => {
  const storage = installBrowserStorage({ brevmont_rep_auth_token: 'BRVMT-REP-TRIAL' });
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ error_code: 'trial_ended' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });

  await expect(getJWT('https://api.brevmont.test')).resolves.toBeNull();
  expect(storage.license_revoked).toBe(true);
  expect(storage.license_access_state).toBe('trial_ended');
  expect(storage.license_revoked_message).toBe('Your GM can activate the pilot to reopen access.');
  expect(storage.brevmont_last_error).toBe('trial_ended');
  expect(storage.brevmont_jwt_cache).toBeUndefined();
});

test('getJWT marks trial ended when token mint returns legacy error trial_ended', async () => {
  const storage = installBrowserStorage({ rep_auth_token: 'BRVMT-REP-TRIAL' });
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ error: 'trial_ended' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  await expect(getJWT('https://api.brevmont.test')).resolves.toBeNull();
  expect(storage.license_revoked).toBe(true);
  expect(storage.license_access_state).toBe('trial_ended');
  expect(storage.brevmont_last_error).toBe('trial_ended');
});
