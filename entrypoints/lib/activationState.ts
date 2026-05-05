/**
 * Single gate for "user has finished onboarding and has a server token".
 * chrome.storage.local is the runtime source of truth; sync mirrors cross-device.
 * After a reload / sideload / timing race, local can be empty while sync still
 * holds profile_onboarded + dealer_token — repair local so we never force a
 * second onboarding or spam Profile Settings.
 */

function tokenLooksValid(t: unknown): boolean {
  return typeof t === 'string' && t.length > 0;
}

export async function hasCompleteActivation(): Promise<boolean> {
  const browserApi = typeof chrome !== 'undefined' ? chrome : (globalThis as { browser?: typeof chrome }).browser;
  if (!browserApi?.storage?.local?.get || !browserApi.storage.sync?.get) return false;

  const local = await new Promise<Record<string, unknown>>((resolve) => {
    try {
      browserApi.storage.local.get(
        [
          'profile_onboarded',
          'dealer_token',
          'profile',
          'rep_name',
          'dealership',
          'brevmont_extension_role',
          'rep_auth_token',
          'brevmont_rep_auth_token',
        ],
        resolve,
      );
    } catch {
      resolve({});
    }
  });

  if (local.profile_onboarded && tokenLooksValid(local.dealer_token)) {
    return true;
  }

  const sync = await new Promise<Record<string, unknown>>((resolve) => {
    try {
      browserApi.storage.sync.get(
        [
          'profile_onboarded',
          'dealer_token',
          'profile',
          'rep_name',
          'dealership',
          'brevmont_extension_role',
          'rep_auth_token',
        ],
        resolve,
      );
    } catch {
      resolve({});
    }
  });

  if (!sync.profile_onboarded || !tokenLooksValid(sync.dealer_token)) {
    return false;
  }

  try {
    const patch: Record<string, unknown> = {
      profile_onboarded: true,
      dealer_token: sync.dealer_token,
    };
    if (typeof sync.profile === 'string') patch.profile = sync.profile;
    if (typeof sync.rep_name === 'string') patch.rep_name = sync.rep_name;
    if (typeof sync.dealership === 'string') patch.dealership = sync.dealership;
    if (typeof sync.brevmont_extension_role === 'string') patch.brevmont_extension_role = sync.brevmont_extension_role;
    if (typeof sync.rep_auth_token === 'string') {
      patch.rep_auth_token = sync.rep_auth_token;
      patch.brevmont_rep_auth_token = sync.rep_auth_token;
    }
    await new Promise<void>((resolve) => {
      try {
        browserApi.storage.local.set(patch, () => {
          void browserApi.runtime?.lastError;
          resolve();
        });
      } catch {
        resolve();
      }
    });
  } catch {
    /* still consider activated — sync had the gate keys */
  }

  return true;
}
