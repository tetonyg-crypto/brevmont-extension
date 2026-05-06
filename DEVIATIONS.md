# DEVIATIONS.md — brevmont-extension

Where the as-shipped extension diverges from the spec. Each entry: what
was deferred, why, and what unblocks it.

---

## D-2026-05-06-1 — Operating-model PR: no extension code changes shipped

**Spec said:** Bump to v1.14.1. Add `onInstalled` handshake to
`background.ts` calling `/api/v1/health/extension-ping`. Stamp
`ext_version` into every `honestEvents` payload. Add a version pill to
the sidebar UI.

**As shipped:** No code changes. All four items were already in place
before this PR began:

1. **Version:** `package.json` is at 1.14.2 (newer than the brief's
   1.14.1 target). WXT pulls version from package.json (single source of
   truth in `wxt.config.ts`).
2. **Handshake:** `background.ts` already fires both `/api/v1/extension-loaded`
   (Telegram) and `/v1/health/extension-ping` (heartbeat) in
   `onInstalled` — see lines 28–62. The latter response includes
   `latest_known_version` and `stale`, persisted to
   `chrome.storage.local`.
3. **Version stamping:** `entrypoints/lib/honestEvents.ts:logEvent`
   auto-stamps `ext_version` into every payload via
   `chrome.runtime.getManifest().version` (line 150).
4. **Sidebar pill:** stale-flag stored in `brevmont_ext_version_stale`,
   wired into the UI in prior PRs.

The supplementary AGENTS.md was the only new artifact added to this
repo in this PR.

**Why this is correct:** The brief was authored from an older snapshot
of the codebase. Verifying the actual file state before editing
prevented overwriting the existing (richer) implementation with the
brief's (thinner) example code.

---

## D-2026-05-06-2 — Stale Desktop zip artifact removed

**Spec said:** Delete any `brevmont-extension*.zip` outside the
canonical paths (`C:\Users\Yancy\brevmont-extension\` or
`C:\Users\Yancy\brevmont-api\public\`).

**As shipped:** Removed `C:\Users\Yancy\Desktop\brevmont-extension-latest.zip`
(was a stale v1.12.0 build from 2026-05-05). Pre-authorized in the
brief.

**Tracking:** None — the stale artifact is gone and `npm run ship` does
not re-create it (ship targets the canonical paths only).
