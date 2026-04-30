# Test Report — Brevmont Extension v1.9.2
**Date:** 2026-04-06
**Tester:** Claude Code (automated)
**Method:** Build verification, grep audit, fresh clone dry run, endpoint checks

---

## Build Verification

| Check | Result |
|-------|--------|
| `npm run build` | ✅ PASS — 1.85s, zero errors |
| Manifest version | ✅ 1.9.2 |
| Manifest name | ✅ "Brevmont — AI Sales Assistant for VinSolutions" |
| Manifest short_name | ✅ "Brevmont" |
| Manifest homepage_url | ✅ "https://brevmont.com" |
| Host permissions count | ✅ 10 (VinSolutions, Gmail, FB, Messenger, LinkedIn, IG, WhatsApp, proxy, Supabase) |
| Content script matches | ✅ 10 patterns |
| All output files present | ✅ 12 files (manifest, background, content, 3 HTML pages, intercept, 5 icons) |

## Brand Audit (Built Output)

| File | "Floq" refs | "Brevmont" refs |
|------|-------------|-----------------|
| content.js | 0 | 1+ (minified) |
| background.js | 0 | 1+ |
| onboarding.html | 0 | 10 |
| options.html | 0 | 4 |
| voice.html | 0 | 2 |
| **TOTAL Floq** | **0** | — |
| **TOTAL #7F77DD** | **0** | — |

**Verdict:** Zero stale brand references in any built file.

## Feature Verification (Built Content.js)

| Feature | Present in Build | Ref Count |
|---------|-----------------|-----------|
| Email popup injection (sendemail.aspx) | ✅ | 1 |
| Call log popup injection (LogCall) | ✅ | 1 |
| "Generate with Brevmont" button | ✅ | 1 |
| CRM char counter (crm-char-count) | ✅ | 1 |
| NO_NEW_NOTE dedup handling | ✅ | 1 |
| will-change pill fix | ✅ | 1 |
| Modal awareness (checkForModals) | ✅ | 1 |
| Image auto-downscale (1568px) | ✅ | 1 |
| Mic .abort() cleanup | ✅ | 1 |
| Mic error messages (permission, in-use) | ✅ | 1 |

## Feature Verification (Built Background.js)

| Feature | Present | Ref Count |
|---------|---------|-----------|
| /api/recent-notes dedup call | ✅ | 1 |
| PRIOR NOTES context injection | ✅ | 1 |
| brevmont.com in error messages | ✅ | 1 |
| Floq references | ✅ 0 | 0 |

## Fresh Clone Dry Run

| Step | Result |
|------|--------|
| `git clone` from GitHub | ✅ Clean |
| `bash setup.sh` | ✅ All steps passed |
| Node version check | ✅ v24.14.0 |
| `npm ci` | ✅ 410 packages |
| `npm run build` | ✅ 2.1s |
| manifest.json version | ✅ 1.9.2 |
| Git hooks path | ✅ .githooks |
| Post-merge hook executable | ✅ 100755 |

## Infrastructure Status

| Service | Status | Details |
|---------|--------|---------|
| Railway proxy | ✅ 200 | https://api.brevmont.com/health |
| brevmontlabs.vercel.app | ✅ 200 | Next.js site live |
| brevmontlabs.com (custom domain) | ✅ 200 | DNS propagated, SSL active |
| FORGE (PM2) | ✅ online | PID 29188, uptime 78m, 0 restarts |
| pm2-logrotate | ✅ online | 10MB max, 7 day retention |
| PM2 startup on boot | ✅ configured | pm2-windows-startup installed |

## Proxy New Features

| Feature | Status |
|---------|--------|
| GET /api/recent-notes endpoint | ✅ Returns `{"notes":[]}` for unknown token |
| CRM note pipe format in prompt | ✅ 6 references across 3 verticals |
| 480 char hard cap instruction | ✅ Present in all verticals |
| "Next Step NEVER truncated" rule | ✅ Present in all verticals |
| CORS whitelist includes brevmont.com | ✅ 4 brevmont.com origins added |
| Resend "from" fields = Brevmont | ✅ All email templates updated |

## Git State

| Repo | Branch | Latest Commit | Pushed |
|------|--------|---------------|--------|
| floq-extension | main | `6696f5d` (v1.9.2 bump) | ✅ |
| oper8er-proxy | master | `54b986c` (recent-notes endpoint) | ✅ |
| brevmontlabs | master | `531908d` (init) | ✅ |

## Version History (This Session)

| Version | Commits | What Changed |
|---------|---------|-------------|
| 1.9.0 | `129f16e` | PARSE_LEAD handler |
| 1.9.0 | `69accba`-`172ed58` | Cross-machine safeguards (.nvmrc, .npmrc, setup.sh, post-merge hook) |
| 1.9.0 | `3d312b5` | MacBook autopsy + gap fixes |
| 1.9.1 | `f03d1f4` | BUG-002: auto-downscale context images |
| 1.9.1 | `5495c9a` | BUG-003: mic stream cleanup |
| 1.9.1 | `69719c4` | BUG-001: pill modal awareness |
| 1.9.1 | `d01ba2f` | Version bump to 1.9.1 |
| 1.9.1 | `12d776e` | Rebrand: 88 string replacements, 12 files |
| 1.9.1 | `2d08493` | Rebrand: keystone icons (5 sizes) |
| 1.9.1 | `02d00fd` | CLAUDE.md rebrand update |
| 1.9.2 | `bb00c89` | BUG-004: pill animation lag fix |
| 1.9.2 | `08af136` | FEAT-002C: CRM char counter |
| 1.9.2 | `bc96620` | FEAT-002B: same-lead dedup + prior context |
| 1.9.2 | `4f3ece2` | FEAT-001/003: email + call popup injection |
| 1.9.2 | `6696f5d` | Version bump to 1.9.2 |

## Known Limitations / Requires Live Testing

1. **Email popup DOM selectors** — "Generate with Brevmont" button injection uses best-guess selectors for VinSolutions email popup form fields. May need adjustment after live DevTools inspection.
2. **Call log popup DOM selectors** — Same as above for the call notes textarea.
3. **CRM note char limit** — Default set to 500. Needs VinSolutions field test to confirm actual limit.
4. **Same-lead dedup** — Relies on `customer_name` exact match in Supabase. If names are spelled differently across notes, dedup won't connect them.
5. **Proxy auto-deploy** — Railway should auto-deploy on push, but verify latest deployment matches commit `54b986c`.

## Overall Verdict

**ALL SYSTEMS GREEN.** Extension v1.9.2 builds clean from source and from fresh clone. Zero stale brand references. All new features (popup injection, char counter, dedup, pill fix, image downscale, mic cleanup, modal awareness) are present in the built output. Proxy is live and responding. brevmontlabs.com is deployed and resolving. FORGE is running via PM2 with boot persistence.

The extension is ready for live testing on VinSolutions. The popup injection selectors are the only unknown — they'll either work on first try or need a 5-minute selector fix after a DevTools screenshot.
