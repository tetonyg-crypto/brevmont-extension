/**
 * Tool: lib/storage.ts
 * Purpose: Typed, versioned chrome.storage.local wrapper with debounced writes,
 *          schema migrations, and onChanged watchers. Eliminates lossy
 *          chrome.storage.sync.set fire-and-forget patterns scattered across
 *          onboarding, popup, options, and content scripts.
 * Inputs:  Application code reading/writing storage keys
 * Outputs: Strongly-typed get/set/patch/watch operations
 * Dependencies: chrome.storage.local + onChanged
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-29: Initial creation. Single source of truth for extension storage.
 *
 * WHY chrome.storage.local INSTEAD OF .sync:
 *   * .sync has a 100KB per-extension quota and 8KB per-key. Profile JSON
 *     blobs already brush 4KB and we need room to grow without quota errors.
 *   * .sync replicates through Chrome sync servers — onboarding writes can
 *     take 5-30s to land. Reps were hitting "I just signed in but the popup
 *     says no license" because validateLicense wrote sync first, the popup
 *     then read sync, lost the race, and showed empty state.
 *   * .local is 10MB, instant, and survives browser restarts. The only thing
 *     .sync gives you is multi-device — and the rep auth model already
 *     re-cookies a new device via /api/session/to-license, so we never
 *     actually relied on cross-device storage replication.
 *
 * VERSIONED MIGRATIONS:
 *   storage._schema_version is bumped each time the schema changes. On extension
 *   start, runMigrations() walks every version > current and applies a forward
 *   migration. We never write code that reads "v1 shape" — every consumer
 *   sees the latest shape, period.
 */

const SCHEMA_VERSION_KEY = '__brevmont_schema_version__';
const CURRENT_SCHEMA_VERSION = 2;
export const AUTH_SYNC_KEYS = [
  'license_secret',
  'brevmont_license_secret',
  'rep_auth_token',
  'brevmont_rep_auth_token',
  'dealer_token',
] as const;

// =============================================================================
// Schema definition. Add new keys here. The compiler enforces every set/get
// against this shape.
// =============================================================================
export interface BrevmontStorage {
  // Auth credentials (validated by /v1/license/validate or /v1/install-tokens/validate).
  license_key: string | null;
  license_secret: string | null;
  brevmont_license_secret: string | null; // Legacy mirror — keep in sync.
  dealer_token: string | null;
  rep_auth_token: string | null;
  brevmont_rep_auth_token: string | null; // Legacy mirror — keep in sync.

  // Identity (set by validate-token or session bridge).
  rep_id: string | null;
  rep_email: string | null;
  rep_name: string | null;
  dealership_id: string | null;
  dealership: string | null; // Display name.

  // Onboarding state.
  profile_onboarded: boolean;
  profile_onboarding: string | null; // JSON string of in-progress wizard state.
  profile: string | null; // JSON string of finished profile.
  activated_at: number | null; // ms epoch.

  // Revocation flags (server pushes these via heartbeat 401 → background sets).
  license_revoked: boolean;
  license_revoked_at: number | null;
  license_revoked_message: string | null;
  license_access_state: 'revoked' | 'trial_ended' | null;

  // Install token (single-use, server-validated). Cleared after consumption.
  install_token: string | null;

  // UI/UX preferences (sticky between sessions; never cleared on logout).
  ui_last_active_step: number | null;
  ui_dismissed_announcements: string[];

  // Schema metadata.
  __brevmont_schema_version__: number;
  brevmont_auth_storage_hardened: boolean;
}

const DEFAULTS: BrevmontStorage = {
  license_key: null,
  license_secret: null,
  brevmont_license_secret: null,
  dealer_token: null,
  rep_auth_token: null,
  brevmont_rep_auth_token: null,
  rep_id: null,
  rep_email: null,
  rep_name: null,
  dealership_id: null,
  dealership: null,
  profile_onboarded: false,
  profile_onboarding: null,
  profile: null,
  activated_at: null,
  license_revoked: false,
  license_revoked_at: null,
  license_revoked_message: null,
  license_access_state: null,
  install_token: null,
  ui_last_active_step: null,
  ui_dismissed_announcements: [],
  __brevmont_schema_version__: CURRENT_SCHEMA_VERSION,
  brevmont_auth_storage_hardened: false,
};

type StorageKey = keyof BrevmontStorage;
type AnyRecord = Record<string, unknown>;

export function sanitizeSyncPayload<T extends AnyRecord>(payload: T): Partial<T> {
  const clean: Partial<T> = { ...payload };
  for (const key of AUTH_SYNC_KEYS) delete clean[key as keyof T];
  return clean;
}

// =============================================================================
// Core read/write primitives.
// =============================================================================

/**
 * Read a single key. Returns the typed value or the default if unset.
 */
export async function get<K extends StorageKey>(key: K): Promise<BrevmontStorage[K]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key as string], (result) => {
      const v = result[key as string];
      resolve((v === undefined ? DEFAULTS[key] : v) as BrevmontStorage[K]);
    });
  });
}

/**
 * Read many keys at once. Missing keys are filled with their defaults.
 */
export async function getMany<K extends StorageKey>(keys: K[]): Promise<Pick<BrevmontStorage, K>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys as string[], (result) => {
      const out: Partial<BrevmontStorage> = {};
      for (const k of keys) {
        out[k] = (result[k as string] === undefined ? DEFAULTS[k] : result[k as string]) as BrevmontStorage[K];
      }
      resolve(out as Pick<BrevmontStorage, K>);
    });
  });
}

/**
 * Set one key. Throws on quota errors so callers can fall back gracefully
 * (instead of silent data loss like raw chrome.storage.local.set).
 */
export async function set<K extends StorageKey>(key: K, value: BrevmontStorage[K]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

/**
 * Merge a partial update — only writes the keys you supply, leaves others
 * untouched. The natural way to update credentials atomically.
 */
export async function patch(updates: Partial<BrevmontStorage>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(updates as Record<string, unknown>, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

/**
 * Remove keys (revert to defaults). Called from logout / revoke flows.
 */
export async function clearKeys(keys: StorageKey[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys as string[], () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

// =============================================================================
// Watchers — invoke a callback when one of the keys you care about changes.
// Used by background.ts to react to license revocation, popup to react to
// dealership name changes, etc.
// =============================================================================

type WatchHandler<K extends StorageKey> = (newValue: BrevmontStorage[K] | undefined, oldValue: BrevmontStorage[K] | undefined) => void;

const watchers: Array<{ key: StorageKey; handler: WatchHandler<StorageKey> }> = [];
let listenerInstalled = false;

function ensureListener() {
  if (listenerInstalled) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const [k, change] of Object.entries(changes)) {
      for (const w of watchers) {
        if (w.key === k) {
          try {
            w.handler(change.newValue as BrevmontStorage[StorageKey] | undefined, change.oldValue as BrevmontStorage[StorageKey] | undefined);
          } catch (err) {
            console.error('[Brevmont storage] watcher threw:', err);
          }
        }
      }
    }
  });
  listenerInstalled = true;
}

/**
 * Subscribe to changes on a key. Returns an unsubscribe function.
 */
export function watch<K extends StorageKey>(key: K, handler: WatchHandler<K>): () => void {
  ensureListener();
  watchers.push({ key, handler: handler as WatchHandler<StorageKey> });
  return () => {
    const idx = watchers.findIndex((w) => w.key === key && w.handler === (handler as WatchHandler<StorageKey>));
    if (idx >= 0) watchers.splice(idx, 1);
  };
}

// =============================================================================
// Debounced writer — for input forms, where you want to persist progress
// every keystroke without burning IPC. Default 250ms debounce.
// =============================================================================

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedPatch(updates: Partial<BrevmontStorage>, debounceMs = 250, bucket = '__default__'): void {
  const existing = debounceTimers.get(bucket);
  if (existing) clearTimeout(existing);
  debounceTimers.set(bucket, setTimeout(() => {
    debounceTimers.delete(bucket);
    void patch(updates).catch((err) => {
      console.error('[Brevmont storage] debouncedPatch failed:', err);
    });
  }, debounceMs));
}

// =============================================================================
// Migrations. Bump CURRENT_SCHEMA_VERSION when schema changes; add a new
// case to the switch.
// =============================================================================

async function runMigrations(): Promise<void> {
  const stored = await new Promise<{ [k: string]: unknown }>((resolve) => {
    chrome.storage.local.get([SCHEMA_VERSION_KEY], (r) => resolve(r));
  });
  const current = (stored[SCHEMA_VERSION_KEY] as number | undefined) ?? 0;
  if (current === CURRENT_SCHEMA_VERSION) return;

  for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    switch (v) {
      case 1: {
        // Initial schema. Backfill DEFAULTS for any keys that weren't written
        // before this wrapper existed. We don't overwrite real values — only
        // populate the schema sentinel so future migrations have a baseline.
        await new Promise<void>((resolve, reject) => {
          chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: 1 }, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message || String(err)));
            else resolve();
          });
        });
        break;
      }
      case 2: {
        await migrateAuthTokensOutOfSync();
        await new Promise<void>((resolve, reject) => {
          chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: 2 }, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message || String(err)));
            else resolve();
          });
        });
        break;
      }
      default:
        // Unknown future version — log but don't break.
        console.warn('[Brevmont storage] unknown migration version:', v);
    }
  }
}

export async function migrateAuthTokensOutOfSync(): Promise<void> {
  const local = await new Promise<AnyRecord>((resolve) => {
    chrome.storage.local.get([...AUTH_SYNC_KEYS, 'brevmont_auth_storage_hardened'], (r) => resolve(r));
  });

  const sync = await new Promise<AnyRecord>((resolve) => {
    chrome.storage.sync.get([...AUTH_SYNC_KEYS], (r) => resolve(r));
  });
  const hasSyncAuth = AUTH_SYNC_KEYS.some((key) => sync[key]);
  if (local.brevmont_auth_storage_hardened && !hasSyncAuth && !local.license_secret && !local.brevmont_license_secret) return;

  const localPatch: AnyRecord = {};
  for (const key of ['rep_auth_token', 'brevmont_rep_auth_token', 'dealer_token']) {
    if (!local[key] && sync[key]) localPatch[key] = sync[key];
  }
  if (localPatch.rep_auth_token && !localPatch.brevmont_rep_auth_token && !local.brevmont_rep_auth_token) {
    localPatch.brevmont_rep_auth_token = localPatch.rep_auth_token;
  }

  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set({ ...localPatch, brevmont_auth_storage_hardened: true }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.remove(['license_secret', 'brevmont_license_secret'], () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    chrome.storage.sync.remove([...AUTH_SYNC_KEYS], () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || String(err)));
      else resolve();
    });
  });
}

let initPromise: Promise<void> | null = null;

/**
 * Idempotent init. Call once at extension startup AND at the top of any
 * entrypoint that might be cold-started (background, popup, options,
 * onboarding). Safe to call repeatedly — the migration runs at most once.
 */
export function init(): Promise<void> {
  if (!initPromise) {
    initPromise = runMigrations().catch((err) => {
      console.error('[Brevmont storage] init failed:', err);
      // Don't reject — extension keeps working with default values.
    });
  }
  return initPromise;
}

// =============================================================================
// Convenience helpers that pull the right combination of keys for a use case.
// Saves callers from memorising every key name.
// =============================================================================

export async function getCredentials() {
  return getMany(['license_key', 'license_secret', 'brevmont_license_secret', 'dealer_token', 'rep_auth_token', 'brevmont_rep_auth_token']);
}

export async function setCredentialsFromInstallToken(payload: {
  license_key: string;
  license_secret?: string;
  dealer_token: string;
  dealership_id: string;
  dealership_name: string;
  rep_id?: string | null;
  rep_email?: string | null;
  rep_name?: string | null;
  rep_auth_token?: string | null;
}) {
  // Atomic patch: write all credentials together so a partial read between
  // writes never sees half-state.
  const updates: Partial<BrevmontStorage> = {
    license_key: payload.license_key,
    license_secret: null,
    brevmont_license_secret: null,
    dealer_token: payload.dealer_token,
    dealership_id: payload.dealership_id || null,
    dealership: payload.dealership_name || null,
    rep_id: payload.rep_id ?? null,
    rep_email: payload.rep_email ?? null,
    rep_name: payload.rep_name ?? null,
    rep_auth_token: payload.rep_auth_token ?? null,
    brevmont_rep_auth_token: payload.rep_auth_token ?? null,
    activated_at: Date.now(),
    license_revoked: false,
    license_revoked_at: null,
    license_revoked_message: null,
    license_access_state: null,
  };
  await patch(updates);
}

export async function clearAuth() {
  // Used on revocation / logout. Leaves UI prefs intact.
  await clearKeys([
    'license_key',
    'license_secret',
    'brevmont_license_secret',
    'dealer_token',
    'rep_auth_token',
    'brevmont_rep_auth_token',
    'rep_id',
    'rep_email',
    'rep_name',
    'dealership_id',
    'dealership',
    'activated_at',
    'profile_onboarded',
    'profile',
    'install_token',
  ]);
}
