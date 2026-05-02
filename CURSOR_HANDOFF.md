# CURSOR HANDOFF — Self-Healing Extension Layer

## State as of 2026-05-02

The self-healing extension layer specified in the BREZ brief was already 90% built before this session. This handoff documents what shipped, what's wired, and what Cursor needs to do next.

## Modules — already in place at `lib/`

| Module | Purpose | Status |
|---|---|---|
| `lib/retryQueue.ts` | Dexie IndexedDB offline queue, exponential backoff, idempotency keys | shipped |
| `lib/remoteConfig.ts` | Server-driven config + kill switch + version gate | shipped |
| `lib/sentry.ts` | Sentry init, breadcrumbs, captureError, PII scrub | shipped |
| `lib/breadcrumbs.ts` | Ring buffer in chrome.storage.local — read by SupportModal at submit | shipped |
| `lib/redact.ts` | PII redaction for support payloads | shipped |
| `lib/screenshot.ts` | Active-tab capture for support tickets | shipped |
| `lib/authSigning.ts` | signedFetch / signedGet with HMAC | shipped |
| `lib/storage.ts` | Schema for chrome.storage.local | shipped |

The brief asked for separate `supportReport.ts`, `factoryReset.ts`, and `heartbeat.ts` modules. The functionality already lives inline in `entrypoints/background.ts` and `entrypoints/popup/main.tsx` — no separate module needed:

- **Heartbeat:** `sendHeartbeatV2` in `entrypoints/background.ts` (full payload, pending_heartbeats flush on offline retry)
- **Support report:** `SUPPORT_REPORT` message handler in `entrypoints/background.ts` + `entrypoints/popup/SupportModal.tsx`
- **Factory reset:** 5-tap version trigger in `entrypoints/popup/main.tsx`

## Wiring — already in place

`entrypoints/background.ts`:
- `initSentry()` at module top
- Alarms: `brevmont-heartbeat` (5min), `brevmont-queue-flush` (1min), `brevmont-config-refresh` (60min), `brevmont-check-alerts` (30s)
- `online` event listener calls `processQueue`
- `unhandledrejection` and `error` handlers call `captureError`
- `setSentryContext(dealershipId, repName)` after settings load
- Generation handler wraps `signedFetch` with retry queue (network errors + 5xx requeue, 4xx throws)
- `X-Idempotency-Key` header sent on every `/v1/generate` call
- `pending_heartbeats` flushed on next successful ping (offline retry)

`entrypoints/popup/main.tsx`:
- Factory reset (5-tap on version, 3s window) — clears all storage + retryDB.delete() + reload
- Queue indicator amber banner ("Syncing X items...")
- "Get help" → SupportModal compose flow with screenshot + breadcrumb capture
- "Report issue" quick button → sends `SUPPORT_REPORT` with diagnostics

`entrypoints/content.ts` (added this session):
- `addBreadcrumb('content_script_loaded')` after platform detect
- `addBreadcrumb('pill_mounted')` after pill DOM append

## Proxy endpoints — committed + deployed to Railway in commit `b4d253e`

| Endpoint | File | Status |
|---|---|---|
| `POST /api/heartbeat/v2` | `routes/telemetry.js` | live |
| `GET /api/extension-config` | `routes/extensionSelfHeal.js` | live |
| `POST /api/support-report` | `routes/extensionSelfHeal.js` | live (Telegram alert to FORGE) |
| `/v1/generate` idempotency | `routes/generation.js` | live (X-Idempotency-Key replay) |
| `staleHeartbeats` cron | `crons/staleHeartbeats.js` | scheduled daily 8:00 UTC |

## Database — migration `104_heartbeats_extension_self_healing.sql`

Creates / alters:
- `heartbeats` table (RLS: founder-read + manager-read by dealership_id)
- `extension_config` table + seed of v1.0.0 default config
- `support_reports` table (RLS: founder-read + manager-read)
- `generation_events.idempotency_key` + `idempotency_response` columns
- `idx_generation_events_idempotency_key_unique` partial unique index
- `heartbeats_stale_alert_candidates()` SQL function for staleHeartbeats cron

**The migration is committed but must be applied to production Supabase manually** if it hasn't been already. Verify by hitting `https://api.brevmont.com/api/extension-config` — if it returns `config_version: "1.0.0"` and a populated config object, migration 104 ran. If 502/404, run migration 104 in the Supabase SQL editor.

## What Cursor should do next

1. Verify migration 104 is applied in Supabase: `curl https://api.brevmont.com/api/extension-config` should return `config_version` and a `config.dom_selectors.vinsolutions` block. If 502, paste `migrations/104_heartbeats_extension_self_healing.sql` into Supabase SQL Editor.
2. Set `WXT_SENTRY_DSN` in the extension's `.env` (or `.env.production`) — without it `lib/sentry.ts` is a silent no-op. Get a DSN from sentry.io.
3. Test the extension v1.10.5 build at `.output/chrome-mv3/`: load unpacked in Chrome, complete onboarding, watch the SW console for `addBreadcrumb` activity and verify a heartbeat row lands in `public.heartbeats` after 5 min.

## File locations

- Extension repo: `C:/Users/Yancy/brevmont-extension/` (main, v1.10.5)
- Proxy repo: `C:/Users/Yancy/brevmont-api/` (master, commit b4d253e)
- Migration SQL: `C:/Users/Yancy/brevmont-api/migrations/104_heartbeats_extension_self_healing.sql`
- Build output: `C:/Users/Yancy/brevmont-extension/.output/chrome-mv3/`

## Out of scope (not BREZ work — left uncommitted in proxy repo)

- `migrations/098_founder_admin_separation.sql` (admin separation work, conflicting numbering with already-committed `098_dealership_users_invitations.sql`)
- `migrations/100_orphaned_profiles_cleanup.sql` (profile soft-delete)
- `scripts/seed-test-tenants.js`, `scripts/verify-rls-isolation.js` (RLS testing)

These look like separate work in flight and were intentionally NOT bundled with this commit.
