# Worker 4 — Extension — Handoff

**Date:** 2026-04-17
**Branch:** `onboarding-20260417-extension`
**Scope:** Verify version parity between local extension build and live-served zip at `/api/extension-download`.

## Phase 1 — Version Comparison

| Source | Version |
|--------|---------|
| Local build (`/.output/chrome-mv3/manifest.json`) | **1.9.4** |
| Live served (`https://oper8er-proxy-production.up.railway.app/api/extension-download`) | **1.9.2** |
| Match | **NO — drift of 2 patch versions** |

The proxy is serving an older zip (1.9.2). Local repo has 1.9.4 already built.

## Phase 2 — Rebuild Decision

**Skipped rebuild.** Local `.output/chrome-mv3/` is already at v1.9.4 and `.output/` also contains pre-zipped artifacts:
- `brevmont-extension-1.9.2-chrome.zip`
- `brevmont-extension-1.9.3-chrome.zip`
- `brevmont-extension-1.9.4-chrome.zip`

The build is current. Rebuilding would not have changed the served version.

## Phase 3 — Upload Path

**No upload/publish script exists in this repo.**

Searched:
- `/scripts/` — directory does not exist
- `package.json` scripts — only `build`, `dev`, `zip`, `clean`, `fresh`, `setup`, `prepare` (no upload/publish)
- repo root — no upload-related files

## Blocker / Gap

The `/api/extension-download` endpoint on the Railway proxy is serving stale content. The mechanism by which a zip lands at that endpoint is not visible from this repo. Likely candidates:

1. **Proxy filesystem** — zip is committed/copied into `oper8er-proxy` repo and deployed via Railway. Would need to update there.
2. **Supabase Storage bucket** — proxy reads from a bucket; updating means uploading the new zip via Supabase dashboard or storage API.
3. **Manual SCP/upload** — historically dropped onto Railway volume by hand.

**Action required from Yancy (out of scope for this worker):** Determine which of the above is the source-of-truth and push `brevmont-extension-1.9.4-chrome.zip` (already built and present in `.output/`) to that location. After replacement, hit `/api/extension-download` and confirm the returned zip's manifest.json reports `1.9.4`.

## Files Changed This Sprint

- (none — added only `.handoff/extension.md`, plus the pre-existing `CLAUDE_PARALLEL_RULES.md` and `.scripts/tg.sh` are now committed to this branch)

## Telegram

`tg.sh` requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars. They were not present in this session's env, so phase pings were skipped. Not a blocker for verification work.

## Next Worker

Whoever owns the proxy repo (`oper8er-proxy`) needs to:
1. Identify the storage mechanism for the served zip
2. Replace it with `C:/inventory_pipeline/oper8er-v2/.output/brevmont-extension-1.9.4-chrome.zip`
3. Re-verify `/api/extension-download` returns v1.9.4
