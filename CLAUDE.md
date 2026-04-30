# Brevmont Chrome Extension — Complete Context

Read this file fully before touching anything. Do not ask what the project is. Do not make assumptions. Confirm you understand the current state, then wait for instructions.

## Product

Brevmont is a Chrome extension (MV3) that acts as an AI sales assistant for automotive dealership reps. It injects into VinSolutions CRM (vinsolutions.app.coxautoinc.com) and also supports Gmail, Facebook Messenger, LinkedIn messaging, Instagram DMs, and WhatsApp Web. It scans the CRM page for customer data (name, phone, email, vehicle), then generates personalized text messages, emails, and CRM notes using AI via a Railway proxy server. The proxy owns the Anthropic API key — no keys in the extension.

- **Brand name:** Brevmont (formerly Floq, originally Oper8er)
- **Brand color:** #0D6E6E (deep teal)
- **Version:** 1.10.0
- **Extension ID:** odianhkmfpbcnggigamhjbpkkcbkcckh
- **Proxy:** https://api.brevmont.com
- **Supabase:** https://mqnmemnogbotgmsmqfie.supabase.co (publishable key: `sb_publishable_-sD_RSqo9SNizbhQ0kqWSA_tJbsWD_m`)
- **Repo:** https://github.com/tetonyg-crypto/brevmont-extension.git (branch: main)
- **Proxy repo:** https://github.com/tetonyg-crypto/brevmont-api.git (branch: master)
- **Tier system:** `floor` (base generation only), `command` (all tools + multi-platform), `group` (campaigns, multi-location, owner dashboard)
- **homepage_url:** brevmont.com

## Stack

- **Framework:** WXT v0.20.20 with @wxt-dev/module-react
- **Language:** TypeScript 6.0.2
- **Minifier:** Terser (configured in wxt.config.ts with reserved function names)
- **Styling:** Shadow DOM for sidebar (all CSS in getCSS() function), Tailwind 4.2.2 + PostCSS 8.5.8 + autoprefixer for extension pages
- **AI model:** Claude Sonnet 4 via proxy (`claude-sonnet-4-20250514`), Haiku 4.5 for Coach
- **Backend:** Supabase (REST API with publishable key for onboarding validation, rep sync). Proxy handles all authenticated operations.
- **Build:** `npx wxt build` or `npm run build`. Output: `.output/chrome-mv3/`. Dev: `npm run dev`. Zip: `npm run zip`.
- **Chrome loads from:** `C:\inventory_pipeline\brevmont-extension\.output\chrome-mv3`
- **Node:** v24.14.0, npm 11.9.0 (Windows 11)
- **Dependencies:** wxt, react 19.2.4, react-dom 19.2.4, clsx, lucide-react, terser, @types/chrome, tailwindcss, postcss

## Current Working Features (be specific)

1. **Platform detection** — inline ternary in `main()` at content.ts:32-42. Detects VinSolutions, Gmail, Facebook/Messenger, LinkedIn, Instagram, WhatsApp. Returns `'unknown'` and exits for non-matching URLs. This pattern survives Vite bundling and Terser minification.

2. **Customer scanning (VinSolutions)** — `scanText()` at content.ts:211-253 extracts customerName, phone, email, vehicle, source, status, lastContact from page text. Uses `getDashboardScopedText()` at content.ts:312-317 to scope to text after "Customer Dashboard" marker (avoids left panel noise). `gatherAllText()` at content.ts:298-308 reads top frame + all same-origin iframe innerText. Debounced MutationObserver at content.ts:337-347 rescans on DOM changes, triggered by name change detection.

3. **Vehicle extraction** — `extractVehicle()` at content.ts:137-166 has 10 regex strategies with poison word filtering (POISON_BEFORE/POISON_AFTER patterns at content.ts:130-131). Strategies in order: "Vehicle Info" label, "Active" tab, generic year+make pattern (non-poisoned), year+make only, Stock#/Vehicle label, Sales History rows (Sold/Active/Lost), "Vehicle(s) of Interest" section, "Sale Info" section, near-customer-name search, last-resort any year+make. Also tries `extractVehicleFromTable()` at content.ts:179-187 (table row traversal) and `extractByLabel()` at content.ts:168-177 (XPath).

4. **Pill** — fixed-position "BM" button at content.ts:371-388, appended to `document.documentElement`. Teal (#0D6E6E), z-index 2147483647. Expands to "Brevmont" on hover. Guard at content.ts:368 prevents duplicate pills. `updatePillPosition()` at content.ts:390-421 positions at VinSolutions panel divider (tries #customerListScrollBarHolder, .scrollBarDiv, #mainAreaPanel, then scans for thin vertical elements). Other platforms: pinned to left edge. ResizeObserver + window resize + fullscreenchange listeners at content.ts:426-429.

5. **Sidebar** — `openSidebar()` at content.ts:670-902. Uses Shadow DOM (`host.attachShadow({ mode: 'open' })`). VinSolutions: right side at `seamX - 340px`, 340px wide, **content-driven height** (see 5a). Gmail: left side, 280px, below header. All others: right side, 300px, 480px max height. Marker div `#brevmont-sidebar` prevents double-injection. `pushContent()` is a no-op — pure overlay. Sidebar header shows "BREVMONT" wordmark + teal "B" badge.

5a. **Panel height is content-driven** (v1.9.9). VinSolutions host is `height:'auto'` with `maxHeight: min(calc(100vh - 200px), panelHeightPx)` as the expansion ceiling. Idle state = tight fit ending at the TCPA footer (no reserved whitespace). Outputs streaming in grows the panel up to the ceiling, at which point `.outputs { overflow-y:auto }` scrolls internally. Source of truth: `openSidebar()` VinSolutions branch in content.ts around line 1650-1680, mirrored in `updateSidebarPosition()` at content.ts:2508-2525. Inner #o8 flex-column layout + `.outputs:not(:empty) { flex:1 1 auto }` at content.ts:2994-2995 does the actual growth. Do NOT reintroduce a fixed `height` on the host — that's what caused the ~378px dead whitespace below the TCPA line in 1.9.7. If a future report says "the fix didn't land", FIRST open VinSolutions DevTools and run `document.getElementById('brevmont-host').style.height` — if it shows `"Nnn.nnnpx"` (not `"auto"`), Chrome is caching an old bundle. A page reload does NOT refresh an unpacked extension's JS; only a chrome://extensions reload (or dropping a fresh ZIP) does. Use `scripts/debug-panel-height.js` for ground truth before touching CSS.

6. **Generate flow** — `doGenerate()` at content.ts:958-988. Reads input + chip selection (Message/Email/CRM Note) + tone/goal from storage. Sends GENERATE_OUTPUT to background. Background `handleGenerate()` at background.ts:362-403 builds user message with rep context via `buildRepContext()` at background.ts:308-360. `parseSections()` at background.ts:701-712 splits response into TEXT/EMAIL/CRM sections via regex. `addOutput()` at content.ts:1081-1131 renders output cards with Copy+Log / Paste to CRM / Send to Email buttons.

6a. **Outputs render as tabs, not a stack** (v1.10.0). Chips (`.chip[data-type="text|email|crm"]`) play a dual role: pre-generation they toggle selection (`.on` class = will be generated); post-generation they switch the visible card (`.tab-active` class = currently viewed). Each generated card is stamped with `card.dataset.outputType = 'text'|'email'|'crm'` inside `addOutput()`. CSS rule `.out-card[data-output-type]:not(.tab-visible) { display:none; }` hides inactive cards entirely (not just visually) so the panel height stays content-driven on a single card. `setActiveOutputTab(s, type)` is the ONLY state mutator — it toggles `.tab-active` on the chip and `.tab-visible` on the matching card. `doGenerate()` clears all `.tab-active` state before streaming and auto-activates the first ready tab in preference order `text → email → crm` after outputs arrive. DO NOT regress to a stacked vertical render — the panel was visibly broken with 3 simultaneous cards + reserved whitespace. If you need to show multiple outputs side by side, add a new layout mode; do not remove `[data-output-type]:not(.tab-visible){display:none}`.

7. **Copy+Log** — copies to clipboard, logs to Supabase via LOG_COPY message at background.ts:71-92 which calls `/api/log-action` on the proxy.

8. **Paste to CRM** — `pasteIntoCRM()` at content.ts:993-1006. Finds AddNote iframe textarea via `findNoteTextarea()` at content.ts:991, uses `safeInjectText()` at content.ts:189-209 (native setter pattern to bypass React/Angular). Falls back to clicking Note icon via `clickNoteIcon()` at content.ts:992. If no form found, saves to pending notes via Supabase.

9. **AddNote auto-paste** — content.ts:63-81. When VinSolutions opens AddNote popup, checks `oper8er_paste_note` in storage and auto-injects within 30s window.

10. **Send to Email** — `pasteIntoEmail()` at content.ts:1009-1079. Searches all iframes for email compose forms (subject input + contenteditable/textarea), handles nested iframes (TinyMCE), handles rims2.aspx Communication frames. Falls back to clipboard copy.

11. **Coach tool** — sends situation to `/api/coach` (Haiku 4.5) at background.ts:441-457. Pre-loaded objection chips: "Need to think about it", "Price too high", "Bad credit", "Spouse not here". Returns coaching response rendered in tool-result card.

12. **Alerts tool** — natural language time parsing via `parseAlertTime()` at content.ts:1148-1177. Handles "in X minutes", "in X hours", "noon", "eod", "at X:XX am/pm", "tomorrow". Stored in `chrome.storage.local`, checked every 30s via `chrome.alarms` at background.ts:275. Fires banner notification on active tabs.

13. **Context Reply tool** — drag/drop or Ctrl+V screenshot at content.ts:821-898. Compressed via `compressImage()` at content.ts:644-659 (canvas JPEG, 800px max, 0.7 quality). 4MB size limit. Sent to `/api/context-reply` at background.ts:484-544, falls back to `/v1/generate` with vision content blocks.

14. **Command tool** — sends to `/api/command` at background.ts:460-481. `injectContent()` at content.ts:1133-1140 can inject into platform-specific textboxes (Gmail compose, Facebook/LinkedIn textbox, CRM note).

15. **Voice dictation** — Web Speech API at content.ts:574-641. Uses `e.resultIndex` to avoid 5x duplication bug. Each mic instance gets own `isListening` + `recognition` state. Auto-restarts on silence. Mic buttons on every input field.

16. **Pending notes** — badge at content.ts:481-504 appears bottom-right showing count. Panel at content.ts:507-564 shows notes with "Log It" (pastes to CRM) and "Dismiss" buttons. Persisted to Supabase via `/api/pending-notes` at background.ts:175-215. Polled every 30s at content.ts:567-570. Customer-matched pending notes shown in sidebar customer card at content.ts:931-945.

17. **Heartbeat** — every 5 minutes via `chrome.alarms` (MV3 compliant) at background.ts:274. Reports license key, rep name, platform, extension version at background.ts:219-250. Response sets tier + features in local storage.

18. **Feature gating** — `getTierFeatures()` at background.ts:595-646. Three tiers with legacy name normalization (core->floor, pro->command, elite->group). Stale heartbeat (>30 min) defaults to `floor`.

19. **Onboarding wizard** — 4-step profile setup in `entrypoints/onboarding/main.ts` + `entrypoints/onboarding/index.html`. Validates license key against Supabase `dealerships` table (or legacy `dealer_tokens`). Auto-fills dealership name from DB. Syncs profile to `reps` table.

20. **Settings page** — CSP-compliant options page at `entrypoints/options/options.js` + `entrypoints/options/index.html`. Sections for identity, dealership, voice, market. Shows context preview of what gets injected into every prompt.

21. **Rep profile injection** — `buildRepContext()` at background.ts:308-360 builds detailed context block from stored profile. Injected into every generation prompt.

22. **Network interceptor** — `public/oper8er-intercept.js` monkey-patches `window.fetch` to capture customer/lead/contact API responses from VinSolutions, posts extracted data via `postMessage`. Received at content.ts:1320.

23. **Service worker health check** — `safeSend()` at content.ts:105-114 pings background before every message. Shows reconnect banner if service worker is dead.

24. **SPA navigation observers** — VinSolutions URL change detection at content.ts:463-478. Facebook/Instagram SPA pill re-injection at content.ts:432-460.

25. **Alt+K keyboard shortcut** — opens Command tool tab directly at background.ts:296-304.

26. **Error reporting** — `reportError()` at background.ts:568-592 sends errors to `/api/error` with license key, platform, version.

27. **Supabase SMTP** — working via Resend (noreply@brevmont.com; floqsales.com still active during transition). Magic link auth on app.brevmont.com (floqsales.com still active during transition) and founder.brevmont.com (floqsales.com still active during transition).

28. **Lead Capture** — Command-tier feature. "+ Lead" button in header opens Lead Capture panel with Scan/Voice/Paste tabs. Scan extracts page context (platform-aware selectors), sends to proxy PARSE_LEAD handler, returns JSON with first_name/last_name/phone/email/vehicle_interest/notes/confidence. Parsed card shows editable fields (null = yellow background). Floor tier sees parsed card but inject button is locked with upgrade CTA. Command tier injects into VinSolutions Add Customer form via safeInjectText(). Fallback: if Add Customer button not found, copies formatted data to clipboard. If not on VinSolutions, saves to `floq_pending_lead` in chrome.storage.local; VinSolutions shows banner "You have an uninjected lead" on next load.

29. **Universal Contact Name Extraction** — `extractContactName()` auto-captures customer names from Gmail (`.gD` sender), Facebook/Messenger (conversation header), LinkedIn (`msg-entity-lockup`), Instagram (header `h2`). 3-second watcher on non-VinSolutions platforms. All generation metadata, LOG_COPY, and SAVE_PENDING_NOTE calls use `extractContactName()` as fallback.

30. **Proxy Rate Limiting** — `express-rate-limit`: 30/min on `/v1/generate`, 10/15min on auth endpoints. `helmet` security headers.

31. **Weekly GM Digest Email** — `node-cron` Monday 7AM MT. Queries `generation_events`, calculates ROI, sends branded HTML email to dealership GM via Resend.

32. **Ghost Lead Alerts** — 6-hour cron checks for 48h+ inactive leads, emails GM, tracks in `ghost_alerts` Supabase table to avoid re-alerting.

33. **Seat Limit Enforcement** — `checkSeatLimit()` validates active rep count against tier limits (Floor:3, Command:6, Group:9) before generation.

34. **Brevmont Rebrand** — All UI strings, element IDs, class names, colors, and icons updated from Floq purple (#7F77DD) to Brevmont teal (#0D6E6E). Pill shows 'BM' collapsed, 'Brevmont' on hover. Sidebar header shows 'BREVMONT'. Onboarding, options, and voice pages all rebranded. Extension icons replaced with keystone trapezoid.

## Current Broken Features (be specific)

1. ~~**Customer data shows wrong person**~~ — **FIXED 2026-04-05.** SPA navigation observer now immediately clears `leadData`, `lastScannedName`, and storage keys (`oper8er_lead`, `oper8er_lead_time`, `oper8er_vehicle_info`, `oper8er_vehicle_info_time`). Calls `updateSidebar()` to show "Open a customer record" immediately. After 1500ms delay, runs `validatedScan()` which checks that the detected customerName appears in `document.body.innerText` before writing to storage. Retries up to 5 times at 500ms intervals if validation fails.

2. ~~**Vehicle detection returning null**~~ — **FIXED 2026-04-05.** Added `deepTableVehicleSearch()` as FIRST vehicle extraction attempt before any regex. Searches: (1) all `<tr>` elements in document for cells matching `/^vehicle$/i` and returns the next cell, (2) all accessible iframes + nested iframes using same table traversal, (3) column-header-indexed table search (finds "Vehicle" `<th>`, reads `<td>` at same column index from data rows). All results validated to contain a year (20XX). Falls back to `extractByLabel()` then `extractVehicle()` regex only when table search returns nothing. `attemptScan()` also uses `deepTableVehicleSearch()` as secondary fallback before regex.

3. ~~**Pill overlaps task list content**~~ — **FIXED 2026-04-05.** `findPanelSeamX()` now dynamically finds the right panel boundary by locating the "Customer Dashboard" heading and walking up to its container, or falling back to `#cardashboardframe`'s left edge. Works in both views (main dashboard seam ~x=827, customer card seam ~x=507). `updatePillPosition()` places pill at `seamX - pillWidth - 24` horizontally, `panelTop + panelHeight * 0.45` vertically. Pill padding reduced to `5px 8px`. Pill starts `visibility:hidden` until positioned. These values are confirmed pixel-perfect — do not change.

4. **host_permissions missing Gmail, LinkedIn, WhatsApp** — wxt.config.ts:48-57 includes `host_permissions` for VinSolutions, Facebook, Instagram, Messenger, and the proxy/Supabase, but does NOT include `mail.google.com`, `linkedin.com`, or `web.whatsapp.com`. These ARE in the content script matches and web_accessible_resources, but without host_permissions the extension cannot access cross-origin iframe content on these platforms.

5. **No Chrome Web Store submission** — extension is sideloaded. Distribution is manual.

## Every File and What It Does

### Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `entrypoints/content.ts` | ~1390 | THE content script. Everything: platform detection, customer scanning, vehicle extraction, pill, sidebar (Shadow DOM), generation flow, all 5 tools (Coach, Alerts, Context Reply, Command, Voice), settings panel, pending notes badge/panel, CRM paste, email paste, SPA observers, network interception listener. All sidebar HTML in `getHTML()`, all CSS in `getCSS()`. |
| `entrypoints/background.ts` | 713 | Service worker. Message router for all content script requests. Proxy calls (`generateViaProxy`, `handleCoach`, `handleCommand`, `handleContextReply`, `handleVoiceReply`). `buildRepContext()` for profile injection. `parseSections()` for TEXT/EMAIL/CRM splitting. Heartbeat via chrome.alarms. Alert checking. Feature gating (`getTierFeatures()`). Error reporting. Pending notes CRUD. |
| `entrypoints/content/styles.css` | 3 | Minimal — just a comment. All sidebar styles are in Shadow DOM via `getCSS()`. |
| `entrypoints/onboarding/index.html` | 323 | Onboarding wizard HTML. 4-step + completion screen. Steps: identity, dealership, voice/tone, customer types. Teal (#0D6E6E) accent. Loads `main.ts` as module. |
| `entrypoints/onboarding/main.ts` | 254 | Onboarding logic. Profile data collection, step navigation, license key validation against Supabase, profile sync to `reps` table, progress persistence to chrome.storage.sync. |
| `entrypoints/options/index.html` | 122 | Settings page HTML. Collapsible sections for identity, dealership, voice, market. Context preview block showing what gets injected into prompts. |
| `entrypoints/options/options.js` | 131 | Settings page logic. Loads profile from chrome.storage.sync, populates fields, saves per-section, renders context preview. CSP-compliant (no inline scripts). |
| `entrypoints/voice.html` | 87 | Standalone voice input popup (legacy). SpeechRecognition with start/stop, transcript display, "Done" button saves to `oper8er_voice` in storage. Mostly replaced by inline mic buttons in sidebar. |
| `public/oper8er-intercept.js` | 35 | Network interceptor. Monkey-patches `window.fetch` to capture customer/lead/contact API responses from VinSolutions. Extracts firstName, lastName, vehicle, phone, email via regex on JSON response body. Posts via `window.postMessage`. Loaded as web_accessible_resource. |

### Config Files

| File | Purpose |
|------|---------|
| `wxt.config.ts` | WXT config. Manifest definition (name, version, icons, permissions, commands, host_permissions, web_accessible_resources). Vite build config with Terser minifier and reserved function names. |
| `package.json` | Dependencies and scripts. `npm run build`, `npm run dev`, `npm run zip`. No test framework. |
| `tsconfig.json` | Extends `.wxt/tsconfig.json`. |
| `tailwind.config.js` | Custom colors (accent, success), Inter font. Content paths for entrypoints. |
| `postcss.config.js` | @tailwindcss/postcss + autoprefixer. |
| `.gitignore` | node_modules/, .output/, .wxt/, *.zip, .DS_Store |

### Non-Source Files

| File | Purpose |
|------|---------|
| `public/icons/icon-{16,32,48,128,512}.png` | Extension icons at standard sizes. |
| `mockups/concept-a.html`, `mockups/concept-b.html` | Static HTML mockups (not part of build). |
| `FLOQ_DIAGNOSTIC_REPORT.md` | Diagnostic report from earlier session. |
| `FULL_FORENSIC_AUDIT.md` | Full forensic audit (untracked). |
| `PC_FORENSIC_AUDIT.md` | PC-specific forensic audit (untracked). |
| `test-supabase-logging.js` | Test script for Supabase logging (standalone, not part of build). |
| `test-vehicle-detection.js` | Test script for vehicle detection regex (standalone, not part of build). |
| `vin-dom-discovery.js` | VinSolutions DOM discovery script (standalone, for DevTools testing). |
| `{entrypoints/` | Stale directory (appears to be leftover from a botched rename — contains no useful files). |

## LOCKED ARCHITECTURAL PATTERNS

These decisions are load-bearing for the workflow. Changing them has a real cost and requires an explicit reason.

### Build/Deploy Workflow (Locked April 19, 2026)

Two build modes. **Default is DEV**, never RELEASE.

**DEV BUILD (default, used for active iteration):**
- Command: `npx wxt build` (or `npm run build:dev`)
- No ZIP. No Telegram file upload.
- Telegram message only: brief text notification that build is ready to reload.
- Exact message format: `[EXTENSION DEV BUILD] v<X.X.X> complete. Reload extension at chrome://extensions and hard-refresh VinSolutions.`
- Yancy's Chrome is loaded directly from `C:\inventory_pipeline\brevmont-extension\.output\chrome-mv3\` as an Unpacked extension. Every build overwrites that folder in place.
- Yancy reloads via chrome://extensions → reload icon (one click) → then hard-refresh VinSolutions (Ctrl+Shift+R).

**RELEASE BUILD (explicit only):**
- Command: `npx wxt build && npx wxt zip` (or `npm run build:release`)
- ZIP produced at `.output/brevmont-extension-<X.X.X>-chrome.zip`
- ZIP uploaded to Telegram with version number and changelog notes in caption.
- Exact message format: `[EXTENSION RELEASE] v<X.X.X> packaged for distribution. ZIP attached. Notes: <what changed>`

**When to use which:**
- DEV is the default. Bug fixes, experiments, refactors, tabbed-output changes — all DEV.
- RELEASE only when Yancy explicitly asks ("ship me a ZIP", "package this", "release build"), for major version bumps that mark milestones (1.10.0, 2.0.0 — NOT patches like 1.10.1), for dealer/external distribution, or for backup snapshots before risky refactors.
- **If unsure, default to DEV.** Wasted ZIPs can't be unwasted.

**Why this is locked:**
Yancy's prior workflow had 7 manual steps per extension update (BREZ build → zip → Telegram upload → download → extract → remove old → Load Unpacked → hard refresh). With Chrome pointed at the build output directly, every build updates the extension in place and the cycle drops to 2 manual steps (reload + hard refresh). For 5–15 iterations per dev day, reverting to ZIP-on-every-build costs ~5 minutes per iteration = 25–75 minutes/day of pure overhead.

**Enforcement:**
- `package.json` scripts: `build` runs wxt build only (no zip). `zip` is separate. Never chain them in `build`.
- No git hooks auto-zip. `.githooks/post-merge` runs `npx wxt build` only.
- Helper scripts:
  - `.scripts/tg.sh` — text-only Telegram ping (use for DEV builds)
  - `.scripts/tg-doc.sh` — Telegram document upload with caption (use for RELEASE builds ONLY)
- If an agent finds itself running `npx wxt zip` without Yancy having asked for a ZIP, STOP and ask first.

## Architecture Decisions and Why

### Shadow DOM for sidebar
The sidebar uses `host.attachShadow({ mode: 'open' })` for complete style isolation. VinSolutions has aggressive CSS (Bootstrap, custom stylesheets) that would destroy an injected UI. Without Shadow DOM, VinSolutions styles cascade into the sidebar, breaking fonts, padding, colors, and layout.

### Inline platform detection ternary (DO NOT REFACTOR)
Platform detection is an inline ternary at content.ts:32-42 inside `main()`. Three prior approaches failed:
1. `detectPlatform()` as IIFE at module scope — Vite evaluates at bundle time when `window.location.href` is unavailable.
2. `const PLATFORM = detectPlatform()` at module scope — Terser minifies function name to `n`, collides with Vite internal variable, causes "n is not a function".
3. Arrow function — same Terser collision.
The inline ternary avoids all these by never creating a named function reference.

### Terser reserved names (wxt.config.ts:10)
`detectPlatform`, `gatherAllText`, `getDashboardScopedText`, `extractVehicle`, `scanText`, `attemptScan`, `updateSidebar`, `openSidebar`, `closeSidebar`, `pushContent`, `updatePillPosition` — all protected from Terser minification. Without this, these functions get minified to single letters that collide with Vite bundler internals, causing "n is not a function" runtime errors.

### No iframe scanner (DO NOT ADD)
`allFrames: true` means the content script runs in every iframe. Line content.ts:258 (`if (window !== window.top) return;`) prevents pill/sidebar in iframes. Customer scanning happens ONLY in the top frame via `gatherAllText()` which reads `iframe.contentDocument`. A separate iframe scanner was tried and FAILED — the iframe instance would write `vehicle:null` to storage, overwriting the top-frame scanner's valid vehicle data. This caused a race condition where vehicle was always null.

### Proxy architecture (no API keys in extension)
All AI generation routes through the Railway proxy at `PROXY_URL`. The proxy owns the Anthropic API key and resolves system prompts from `vertical_config` in Supabase. This means: (1) no API key leakage risk from extension source, (2) centralized model management — can switch AI providers without pushing extension update, (3) rate limiting and cost control at proxy level, (4) audit logging of all generations.

### safeInjectText() native setter pattern
`Object.getOwnPropertyDescriptor(proto, 'value').set.call()` at content.ts:189-209 bypasses React/Angular value setters that ignore programmatic `.value = ` assignments. Without this, VinSolutions form fields appear to change but the framework doesn't register the change, so submissions send empty values.

### Pill on document.documentElement (not document.body)
Pill at content.ts:387 is appended to `document.documentElement` instead of `document.body` because VinSolutions dynamically replaces body content during SPA navigation. Attaching to `documentElement` survives body replacements.

### chrome.alarms for periodic tasks (MV3 compliant)
`setInterval` does not survive MV3 service worker restarts. `chrome.alarms` at background.ts:274-275 creates two alarms: `brevmont-heartbeat` (5 min) and `brevmont-check-alerts` (30s). These persist across service worker restarts.

### pushContent() is a no-op
At content.ts:904. The sidebar is pure overlay. Earlier versions tried to push VinSolutions page content to the right when sidebar opened, but this broke VinSolutions layout calculations and caused iframe rendering bugs. Overlay is the correct approach.

### MutationObserver for scanning (not setInterval)
At content.ts:337-347. Debounced MutationObserver replaces the earlier setInterval-based scanning. More responsive to actual DOM changes, doesn't waste CPU polling unchanged content.

## Known Bugs and What Was Already Tried

### Stale customer data + scanner not reading — FIXED 2026-04-05 (v3)
- **Symptom:** Sidebar shows "Open a customer record" or previous customer after clicking a different customer.
- **Root cause (REAL — confirmed via DevTools):** VinSolutions nests iframes 3 levels deep: `document` → `#cardashboardframe` → `#rightpaneframe` (customer name, 283 chars) → `#salesHistoryViewFrame` (vehicle table, 1748 chars). `document.body.innerText` is only 246 chars with NO customer data. The old `gatherAllText()` only read depth-0 iframes (`document.querySelectorAll('iframe')` finds `#cardashboardframe` with 1 char of text), never recursing into nested iframes where all customer data lives.
- **Fix applied (3 parts):**
  1. `gatherAllText()` now recursively reads ALL nested iframes using `readIframes(doc)` that recurses into each iframe's document.
  2. `deepTableVehicleSearch()` now recursively searches nested iframe documents for vehicle table data.
  3. Active periodic rescan every 2 seconds detects customer changes and clears stale data.

### Vehicle detection misses in some layouts — FIXED 2026-04-05 (v2)
- **Symptom:** "No vehicle selected" despite vehicle visible in Sales History table.
- **Root cause:** Vehicle data is in `#salesHistoryViewFrame` at iframe depth 3. Both `gatherAllText()` and `deepTableVehicleSearch()` only searched depth-0 iframes.
- **Fix applied:** Both functions now recurse into all nested iframe depths. `deepTableVehicleSearch()` uses recursive `searchDoc()` that checks each document + recurses into child iframes.

### Pill covers task list content on dashboard (FIXED)
- **Symptom:** "BM" pill overlaps "Updated" column header on My Tasks view; hardcoded seam position wrong when customer card opens.
- **Root cause:** `findPanelSeamX()` strategies returned wrong values; VinSolutions layout is dynamic (seam ~827 on dashboard, ~507 on customer card).
- **Fix applied:** `findPanelSeamX()` now dynamically finds the right panel by locating "Customer Dashboard" heading and walking up, or falls back to `#cardashboardframe` left edge. Pill positioned at `seamX - pillWidth - 24` horizontally, `panelTop + panelHeight * 0.45` vertically. Padding `5px 8px`. Confirmed pixel-perfect 2026-04-05.

### Voice dictation 5x duplication (FIXED)
- **Symptom:** Same text appeared 5x in the input.
- **Root cause:** Processing ALL results on every `onresult` event instead of only new results.
- **Fix applied:** Loop starts at `e.resultIndex` instead of 0 at content.ts:602. Each mic instance gets own state at content.ts:577-578.

### "n is not a function" runtime crash (FIXED)
- **Symptom:** Extension crashes immediately on load.
- **Root cause:** Terser minifies function names to single letters, colliding with Vite internals.
- **Fix applied:** Reserved function names in wxt.config.ts:10. Inline ternary for platform detection.

## Do Not Touch (things that are working — do not break these)

1. **Platform detection inline ternary** at content.ts:32-42 — see Architecture Decisions. Three refactor attempts failed. Leave it as-is.
2. **Terser reserved names** in wxt.config.ts:10 — removing any name causes runtime crashes.
3. **`if (window !== window.top) return;`** at content.ts:258 — prevents iframe pill/sidebar injection. Removing this creates duplicate pills and sidebar race conditions.
4. **`allFrames: true`** in content script config at content.ts:27 — needed for AddNote auto-paste receiver at content.ts:63-81 to work in iframe popups.
5. **safeInjectText() native setter pattern** at content.ts:189-209 — the ONLY way to programmatically set values in VinSolutions React/Angular-wrapped form fields.
6. **Shadow DOM for sidebar** — removing this breaks sidebar styling on every platform.
7. **safeSend() with PING** at content.ts:105-114 — handles MV3 service worker lifecycle. Without it, all messages silently fail after service worker restarts.
8. **chrome.alarms for heartbeat/alerts** at background.ts:274-275 — `setInterval` does not survive MV3 service worker restarts.
9. **Pill on document.documentElement** at content.ts:387 — survives VinSolutions body replacements.
10. **pushContent() as no-op** at content.ts:904 — sidebar is pure overlay. Pushing content breaks VinSolutions layout.
11. **Voice dictation e.resultIndex fix** at content.ts:602 — prevents 5x paste duplication.
12. **getDashboardScopedText()** at content.ts:312-317 — scoping to text after "Customer Dashboard" prevents picking up names from the left lead list panel.
13. **Duplicate pill guard** at content.ts:368 — `document.getElementById('oper8er-pill')` check prevents multiple pills.
14. **Duplicate sidebar guard** at content.ts:261-262 — checks both `#floq-sidebar` marker and `#oper8er-host`.
15. **SPA observer for Facebook/Instagram** at content.ts:432-460 — re-injects pill when SPA navigation destroys it.
16. **Active periodic rescan (2-second interval)** in VinSolutions scanning block — the ONLY reliable way to detect customer changes because VinSolutions loads customer data in iframes without changing the URL. MutationObserver can't see iframe changes. Do not replace this with MutationObserver-only or URL-watching approaches — they were tried and failed.
17. **deepTableVehicleSearch()** — searches document + all iframes for vehicle in table rows before falling back to regex. Do not move this after regex strategies — table search must run first.
18. **VinSolutions pill position values** — `seamX - pillWidth - 24` horizontal, `panelHeight * 0.45` vertical, padding `5px 8px`. Pixel-perfect confirmed 2026-04-05. Do not change.
19. **findPanelSeamX() dynamic heading walk** — Strategy 5 finds "Customer Dashboard" heading and walks up to panel container for `seamX`. Strategy 6 falls back to `#cardashboardframe` left edge. Do not replace with hardcoded values — layout is dynamic.
20. **Gmail pill position** — `left:20px`, `top:435px`, `borderRadius:16px`, `padding:6px 14px`. Sits just below Gmail's "Labels" section in the left nav. Pixel-perfect confirmed 2026-04-05. Do not change.
21. **Gmail sidebar** — `left:0`, `bottom:0`, `width:200px`, `maxHeight:calc(100vh - 450px)`, `overflow:hidden`. Compact CSS overrides for all elements. Looks native to Gmail's left nav. Do not change dimensions or position.
22. **Messenger pill position** — `left:72px`, `top:50%`, `translateY(-50%)`. Clears Messenger's left nav column. Confirmed 2026-04-05. Do not change.
23. **extractContactName() DOM selectors** — platform-specific, tested across Gmail/FB/LinkedIn/IG. Do not simplify.
24. **Non-VinSolutions name watcher interval (3 seconds)** — balances responsiveness vs DOM query cost.
25. **Tabbed output rendering** — `.out-card[data-output-type]:not(.tab-visible){display:none}` + `setActiveOutputTab()` + chip dual-role click handler + `doGenerate()` clearing `.tab-active` on new runs. Removing any one piece breaks either idle height, auto-selection of the first output, or tab switching. See item 6a for full architectural reasoning.

## Next Task

Priority order:

1. ~~**Fix stale customer data**~~ — DONE 2026-04-05.
2. ~~**Fix vehicle detection**~~ — DONE 2026-04-05.
3. ~~**Fix pill position on dashboard**~~ — DONE 2026-04-05.
4. **Add missing host_permissions** — Add `*://mail.google.com/*`, `*://www.linkedin.com/*`, `*://web.whatsapp.com/*` to host_permissions in wxt.config.ts.
5. **Git commit all uncommitted changes and push.**
6. **Submit to Chrome Web Store.**

## Git State

- **Last commit:** `fd2c1c5` — Merge branch 'main'
- **Uncommitted changes:** background.ts, content.ts, package.json, package-lock.json, wxt.config.ts
- **Untracked:** CLAUDE.md, FULL_FORENSIC_AUDIT.md, PC_FORENSIC_AUDIT.md

## Environment

- **PC:** Windows 11, Node v24.14.0, npm 11.9.0
- **MacBook:** Separate environment — must `git pull && npm install && npm run build` after PC pushes
- **Dev mode:** `npm run dev` (hot reload)

## Storage Keys

### chrome.storage.sync (persists across sessions)
`profile` (JSON), `profile_onboarded` (bool), `rep_name` (string), `dealership` (string), `dealer_token` (string)

### chrome.storage.local (session/device)
`oper8er_lead` (object), `oper8er_lead_time` (timestamp), `oper8er_vehicle_info` (string), `oper8er_vehicle_info_time` (timestamp), `oper8er_paste_note` (string), `oper8er_paste_note_time` (timestamp), `oper8er_paste_email_subject` (string), `oper8er_paste_email_body` (string), `floq_tier` (string), `floq_features` (object), `floq_last_heartbeat` (timestamp), `floq_tone` (string), `floq_goal` (string), `floq_alerts` (array)

### Supabase Tables (proxy-managed)
`ghost_alerts` — columns: `dealership` (text), `customer_name` (text), `alerted_at` (timestamp), `followed_up` (boolean)

## Proxy Endpoints (server.js at brevmont-api repo)

| Method | Endpoint | Purpose | Model |
|--------|----------|---------|-------|
| POST | `/v1/generate` | Main AI generation | Sonnet 4 |
| POST | `/api/coach` | Objection coaching | Haiku 4.5 |
| POST | `/api/command` | Command mode execution | — |
| POST | `/api/context-reply` | Screenshot vision analysis | — |
| POST | `/api/heartbeat` | Session tracking, tier resolution | — |
| POST | `/api/log-action` | Copy/paste event logging to Supabase | — |
| POST | `/api/error` | Error reporting | — |
| POST | `/api/pending-notes` | Save unfiled CRM note | — |
| GET | `/api/pending-notes` | Fetch pending notes by dealer_token | — |
| PATCH | `/api/pending-notes/:id` | Mark note as logged/dismissed | — |

All endpoints require `dealer_token` in the request body (or query for GET).

## Content Script Match Patterns

```
*://*.vinsolutions.com/*
*://vinsolutions.app.coxautoinc.com/*
*://mail.google.com/*
*://www.facebook.com/messages/*
*://www.facebook.com/marketplace/t/*
*://www.messenger.com/*
*://www.linkedin.com/messaging/*
*://www.linkedin.com/in/*
*://www.instagram.com/direct/*
*://www.instagram.com/direct/t/*
*://web.whatsapp.com/*
```
