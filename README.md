# Brevmont Chrome Extension

The rep-execution layer for relationship sales. Injects into VinSolutions and other dealership CRMs to draft text messages, emails, and CRM notes in three seconds, keyed to the rep's voice and the lead's history.

## Repos

- **Extension** (this repo): `tetonyg-crypto/brevmont-extension`. WXT framework, Manifest V3, built to `.output/chrome-mv3/`.
- **Backend**: `tetonyg-crypto/brevmont-api` (Express on Railway). Generation jobs, webhook saga, license + token issuance.
- **Admin app**: `tetonyg-crypto/brevmont-app` (deployed at `app.brevmont.com`). Founder dashboard, /join, /install, /welcome, /support.
- **Marketing**: `tetonyg-crypto/brevmont-landing` (deployed at `brevmont.com`).

## Local development

```bash
npm install
npm run dev          # WXT dev server with live reload
npm run build        # Production build into .output/chrome-mv3/
npm run build:release # build + zip into .output/brevmont-extension-<version>-chrome.zip
npm test             # Playwright extension tests
```

Load `.output/chrome-mv3/` as an unpacked extension at `chrome://extensions` (Developer mode on).

## Architecture

- **Onboarding** (`entrypoints/onboarding/`): four-step wizard for license-key path. Cookie-share auto-config (manifest 1.10.0+) auto-populates credentials from `app.brevmont.com` for reps invited via `/join`.
- **Popup** (`entrypoints/popup/`): activation status + Support modal (Atlas-Approved Copy V1).
- **Content script** (`entrypoints/content.ts`): injects into VinSolutions, listens for lead detail panes, displays the Brevmont sidebar.
- **Background** (`entrypoints/background.ts`): heartbeat, telemetry, message routing.

## Brand

Charcoal `#0F1419`, Deep Teal `#0D6E6E`, Bone `#F8F6F1`. Inter for body, Instrument Serif for editorial. No emojis, no em-dashes in interface copy, no SaaS gradients. Source of truth: `brevmont-vault/brand/BRAND.md`.

## Distribution

Sideloaded via the served zip at `https://api.brevmont.com/api/extension-download`. Chrome Web Store submission deferred until customer 5 (Constitution ADR-15).

## Environment

The extension talks to the API through the proxy URL configured in source constants and packaged at build time. Reps should use invited setup whenever possible so `rep_auth_token` and `dealership_id` are stored by onboarding instead of typed manually.

## Versioning

Version lives in `wxt.config.ts` and `package.json`. Bump together. Build, then replace `brevmont-api/public/brevmont-extension-latest.zip` with the new bundle so the served download matches.

Current build: see `wxt.config.ts` `manifest.version`.

## Constitution

Build prompts and architectural decisions cite `brevmont-vault/constitution/BUILD-IT-RIGHT.md` by section. ADR-9 (opaque tokens), ADR-11 (brand-locked UI), ADR-12 (Playwright visual regression), ADR-15 (CWS deferral) all touch this repo.
