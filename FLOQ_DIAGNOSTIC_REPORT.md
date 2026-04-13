# Floq Chrome Extension — Full Diagnostic Audit Report

**Date:** 2026-04-04
**Extension Version:** 1.7.2
**Framework:** WXT (Manifest V3)
**Auditor:** Claude Code

---

## STEP 1 — Extension Files Found

### Extension 1: Floq (Primary — WXT-based)

- **Location:** `C:\inventory_pipeline\oper8er-v2\`
- **Source manifest:** Generated via `wxt.config.ts`
- **Built manifest:** `C:\inventory_pipeline\oper8er-v2\.output\chrome-mv3\manifest.json`
- **Extension Name:** Floq — AI Sales Assistant for VinSolutions
- **Version:** 1.7.2
- **Manifest Version:** 3

**Permissions:**
- `activeTab`
- `storage`

**Host Permissions:**
- `*://*.vinsolutions.com/*`
- `*://vinsolutions.app.coxautoinc.com/*`
- `https://oper8er-proxy-production.up.railway.app/*`
- `https://mqnmemnogbotgmsmqfie.supabase.co/*`

**Content Script Matches (from built manifest.json):**
- `*://*.vinsolutions.com/*`
- `*://mail.google.com/*`
- `*://vinsolutions.app.coxautoinc.com/*`
- `*://web.whatsapp.com/*`
- `*://www.facebook.com/marketplace/t/*`
- `*://www.facebook.com/messages/*`
- `*://www.instagram.com/direct/*`
- `*://www.instagram.com/direct/t/*`
- `*://www.linkedin.com/in/*`
- `*://www.linkedin.com/messaging/*`
- `*://www.messenger.com/*`

**Background Script:** `background.js` (service worker)

**Web Accessible Resources:** `voice.html`, `oper8er-intercept.js`
- Matches: vinsolutions, coxautoinc, mail.google.com, facebook.com, messenger.com, linkedin.com, instagram.com, web.whatsapp.com

### Extension 2: Teton Inventory Poster (Separate, unrelated)

- **Location:** `C:\inventory_pipeline\fb-extension\`
- **Name:** Teton Inventory Poster
- **Version:** 1.0.0
- **Purpose:** Vehicle listing assistant for beta dealership (Facebook Marketplace posting)
- **Not related to Floq — separate extension**

---

## STEP 2 — Manifest URL Audit

### Required URLs vs. What Exists

| Platform | Required Pattern | In wxt.config.ts host_permissions | In built manifest content_scripts |
|---|---|---|---|
| VinSolutions | `*://*.vinsolutions.com/*` | YES | YES |
| VinSolutions (Cox) | `*://vinsolutions.app.coxautoinc.com/*` | YES | YES |
| Facebook | `*://*.facebook.com/*` (broad) | NO | PARTIAL — only `messages/*` and `marketplace/t/*` |
| Instagram | `*://*.instagram.com/*` (broad) | NO | PARTIAL — only `direct/*` and `direct/t/*` |

### CRITICAL FINDING: Missing host_permissions for Facebook and Instagram

The `host_permissions` array in `wxt.config.ts` does NOT include:
- `*://www.facebook.com/*`
- `*://www.instagram.com/*`

It only includes VinSolutions domains and the Railway/Supabase API endpoints. This means the extension **cannot make cross-origin requests from Facebook or Instagram pages** to the proxy API. The content script can inject (via content_scripts matches), but any `fetch()` call from the background service worker on behalf of FB/IG content will work because background has its own permissions. However, the `web_accessible_resources` matches DO include facebook and instagram, which is correct for resource injection.

### Content Script Match Analysis

The content script matches are **intentionally narrow** (not broad wildcards):
- Facebook: Only `messages/*` and `marketplace/t/*` — will NOT match `/marketplace/item/`, general FB pages, or FB Marketplace browse pages
- Instagram: Only `direct/*` and `direct/t/*` — will NOT match profile pages, posts, reels, or stories
- This is by design per the code comments (messaging-only scope)

### wxt.config.ts vs Built Manifest Discrepancy

**wxt.config.ts does NOT define content_scripts** — it only defines `manifest` metadata (name, permissions, host_permissions, web_accessible_resources). The content script matches come from `defineContentScript()` inside `entrypoints/content.ts` itself. The built manifest correctly reflects what's in content.ts. **No discrepancy between source and build.**

---

## STEP 3 — Content Script Audit (`entrypoints/content.ts`)

### Platform Detection

```
detectPlatform() checks window.location.href:
- vinsolutions OR coxautoinc → 'vinsolutions'
- mail.google.com → 'gmail'
- messenger.com → 'facebook'
- facebook.com/messages → 'facebook'
- facebook.com/marketplace/t/ → 'facebook'
- facebook.com (anything else) → 'unknown' ← BUG
- linkedin.com/messaging → 'linkedin'
- linkedin.com/in/ → 'linkedin'
- linkedin.com (anything else) → 'unknown'
- instagram.com/direct → 'instagram'
- instagram.com (anything else) → 'unknown' ← BUG
- web.whatsapp.com → 'whatsapp'
- default → 'unknown'
```

**BUG: Order-dependent matching causes false 'unknown' returns.** If the manifest injects on `facebook.com/messages/*`, the URL will always contain `facebook.com`, and the check for `facebook.com/messages` comes BEFORE the broad `facebook.com` check. This is actually correct due to the order. However, the broad `facebook.com` fallback returns `'unknown'`, which means: if the content script somehow runs on a Facebook page that doesn't match `/messages` or `/marketplace/t/`, the pill will not inject (line 50: `if (PLATFORM === 'unknown') return;`).

### Sidebar Injection

1. `PLATFORM` is detected at module load time (before `main()` runs)
2. If `PLATFORM === 'unknown'`, `main()` returns immediately — no injection
3. For non-VinSolutions: only injects in top frame (`window !== window.top`)
4. For VinSolutions: scanning runs in all frames (allFrames: true), but pill only in top frame
5. Injection guard checks for existing `#floq-sidebar`, `#oper8er-pill`, or `#oper8er-host` elements

### Sidebar Trigger

- The pill button (`#oper8er-pill`) appears on the page
- Clicking the pill calls `openSidebar()`
- Before opening, checks if user has completed onboarding (`profile_onboarded` in sync storage)
- If not onboarded, redirects to onboarding page instead

### Platform-Specific Logic

| Feature | VinSolutions | Facebook | Instagram | Gmail | LinkedIn |
|---|---|---|---|---|---|
| Lead scanning | YES (DOM + iframe + storage polling) | NO | NO | NO | NO |
| Customer card | YES | NO | NO | NO | NO |
| CRM paste | YES | NO | NO | NO | NO |
| Email paste | YES (iframe injection) | NO | NO | NO | NO |
| Pending notes | YES | NO | NO | NO | NO |
| Network intercept | YES (fetch monkey-patch) | NO | NO | NO | NO |
| Content push (margin) | YES (marginRight on mainAreaPanel) | NO | NO | NO | NO |
| Sidebar position | RIGHT, full height | RIGHT, 300px, 480px tall | RIGHT, 280px, 480px tall | LEFT, 280px, auto height | RIGHT, 300px, 480px tall |

### Sidebar Positioning

- **Gmail:** LEFT side, bottom:0, width 280px, max-height calc(100vh - 200px)
- **VinSolutions:** RIGHT side, top:0, width 300px, height 100vh
- **All others (FB, IG, LinkedIn, WhatsApp):** RIGHT side, top:0, width 300px (280px for IG), height auto, max-height 100vh

### Pill Positioning

- **Gmail:** LEFT side (`left: 0`)
- **All others:** RIGHT side (`right: 0`)

### Lead Scanning Logic (VinSolutions Only)

**Customer Name extraction (`scanText()`):**
1. Regex: `Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)` — matches "Customer Dashboard" header followed by a capitalized two-word name
2. Fallback: `([A-Z]... name...)\s*\n\s*\((?:Individual|Business)\)` — matches name above "(Individual)" or "(Business)" label

**Vehicle extraction (`extractVehicle()`):**
1. `Vehicle Info\s\n+(20\d{2}\s+MAKE\s+...)` — VinSolutions "Vehicle Info" section
2. `Active\t...(20\d{2}\s+MAKE...)` — Tab-separated active deals
3. Generic year+make scan with poison word filtering (Equity, Payoff, Trade-in exclusions)
4. `Stock\s*#|Vehicle\s*:?\s*...` — Stock number format fallback

**Phone:** Regex `[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}` (C/H/W prefix for Cell/Home/Work)

**Email:** Regex for standard email pattern, then falls back to `a[href^="mailto:"]` links, then searches iframes for mailto links or email patterns.

**DOM Selectors used:**
- `document.body.innerText` (bulk text scanning)
- `document.querySelectorAll('iframe')` + `iframe.contentDocument`
- `document.querySelectorAll('a[href^="mailto:"]')`
- `#mainAreaPanel`, `.main-content`, `#page-content` (VinSolutions main container)
- `iframe[src*="AddNote"]` (CRM note textarea)

**Polling:** `setInterval` every 2000ms checks if customer name changed, re-scans if so. Separate 2000ms interval merges vehicle info from storage into lead data.

### Supabase Logging

**There is NO direct Supabase logging from the content script.** All logging goes through `browser.runtime.sendMessage()` to the background script, which calls the Railway proxy endpoints. The Supabase host permission (`https://mqnmemnogbotgmsmqfie.supabase.co/*`) exists in host_permissions but is **never used directly** — all data flows through the proxy.

Content script sends these messages that could result in logging:
- `LOG_COPY` — sent when user clicks "Copy + Log" button
- `SAVE_PENDING_NOTE` — sent when CRM paste fails and note is saved
- `MARK_NOTE_LOGGED` — sent when pending note is logged or dismissed

### Dead Code / Unreachable Paths

1. **SPA observer for FB/IG (lines 206-219):** Sets up a MutationObserver to wait for `[role="main"]` container, but when the container is detected, the observer disconnects and... does nothing. The comment says "Will fall through to pill injection below on next line" but there is no re-invocation of the pill creation code. The `if (!document.getElementById('oper8er-pill'))` block only logs a message and never actually triggers re-injection. **This is a dead code path — the SPA observer detects the container but cannot re-run injection.**

2. **Stale marker cleanup (lines 223-228):** Removes `#floq-sidebar` if `#oper8er-host` is missing, but immediately after, the guard at line 229 checks for `#floq-sidebar` again. If the stale marker was cleaned up, execution continues. If it wasn't (because host exists), execution stops. This logic is functional but fragile.

3. **`isFeatureUnlocked()` function (lines 101-102):** Always returns true (demo build). Never called in the content script.

4. **`getTier()` function (lines 97-99):** Always returns 'group'. Called in `openSidebar()` but result is never used for gating.

### Guards That Could Prevent Injection

1. **`PLATFORM === 'unknown'` guard (line 50):** If platform detection fails, entire main() returns. This is the primary blocker for FB/IG injection on unexpected URL patterns.
2. **Non-VinSolutions frame guard (line 198):** `if (!isVinSolutions && window !== window.top) return;` — prevents injection in iframes on non-VinSolutions pages.
3. **VinSolutions frame guard (line 200):** `if (isVinSolutions && window !== window.top) return;` — prevents pill in VinSolutions iframes (scanning still runs).
4. **Duplicate injection guards (lines 229-231):** Checks for `#floq-sidebar`, `#oper8er-pill`, `#oper8er-host`.
5. **REMOVED guard:** Comment on line 201 says "Removed bodyText.length < 500 guard" — this was a previous blocker that has been fixed.

---

## STEP 4 — Background Script Audit (`entrypoints/background.ts`)

### API Architecture

- **No direct Claude API calls.** All generation goes through `PROXY_URL` (Railway): `https://oper8er-proxy-production.up.railway.app`
- **No API key stored in extension.** The proxy owns the Anthropic key and system prompt.
- **Dealer token** stored in `chrome.storage.sync` as `dealer_token` — used as authentication to the proxy.

### Proxy Endpoints Called

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/generate` | POST | Main AI generation (text/email/CRM) |
| `/api/coach` | POST | Sales coaching |
| `/api/command` | POST | Command mode execution |
| `/api/context-reply` | POST | Screenshot-based context reply |
| `/api/heartbeat` | POST | Extension heartbeat (every 5 min) |
| `/api/error` | POST | Error reporting |
| `/api/pending-notes` | POST/GET | Save/retrieve pending CRM notes |
| `/api/pending-notes/:id` | PATCH | Mark note as logged/dismissed |

### Supabase Logging

**The extension does NOT write directly to Supabase.** All logging is delegated to the Railway proxy. The Supabase host permission in the manifest is unused. The proxy presumably writes to Supabase tables on the server side.

**Fields sent to proxy for generation_events logging (via `/v1/generate`):**
- `dealer_token`
- `platform` (vinsolutions, facebook, instagram, etc.)
- `rep_name`
- `workflow_type` (all, text, email, crm, voice_reply)
- `customer_name`
- `vehicle`
- `model` (hardcoded to `claude-sonnet-4-20250514`)
- `max_tokens` (800)

**LOG_COPY message handler (line 42-46):** Only does `console.log()`. **Does NOT send to proxy or Supabase.** This means copy/paste actions are logged only to the browser console and are lost when the service worker shuts down.

### Heartbeat

- Fires every 5 minutes via `setInterval`
- Initial heartbeat fires 10 seconds after install
- Sends: `license_key`, `rep_name`, `dealership`, `extension_version`, `platform` (active tab hostname), `timestamp`
- On success: stores `floq_tier: 'group'` locally regardless of server response (demo build override)
- On failure: reports error silently via `/api/error`

### CHECK_FEATURES Response

Always returns `{ tier: 'group', features: getTierFeatures('group') }` — all features unlocked. The `getTierFeatures('group')` function returns all features as `true` including: `facebook`, `gmail`, `linkedin`, `voice_coach`, `command_mode`, `context_reply`, `voice_dictation`, `campaigns`, `multi_location`, `owner_dashboard`, etc.

### Missing Message Handlers

- `LOG_COPY` — only logs to console, does not persist anywhere
- `LOG_ACTION` — same, only `console.log()`

---

## STEP 5 — Bug Analysis

### PROBLEM 1: Extension Does Not Load on Facebook

**Root Cause: Multiple issues compound.**

1. **Content script matches are too narrow.** The manifest matches `*://www.facebook.com/messages/*` and `*://www.facebook.com/marketplace/t/*`. Facebook Messenger conversations are at URLs like `https://www.facebook.com/messages/t/123456789` which DOES match `messages/*`. However, the Marketplace pattern `marketplace/t/*` is very specific — it only matches active conversations within Marketplace, not Marketplace listings, browse pages, or item detail pages.

2. **Facebook SPA navigation breaks injection.** Facebook is a single-page application. The content script runs at `document_idle` on initial page load. If a user navigates from `facebook.com` (no match) to `facebook.com/messages/t/123` (matches), the content script does NOT re-run because it was never injected on the initial page. Chrome only injects content scripts on initial navigation to matching URLs, not on SPA pushState transitions.

3. **SPA observer is broken (dead code).** Lines 206-219 attempt to handle this with a MutationObserver, but the observer only logs a message when the container appears — it never re-runs the pill injection code. The pill creation code is below the observer setup and runs once synchronously.

4. **Facebook's aggressive DOM manipulation.** Facebook uses React with frequent DOM rebuilds. Even if the pill is injected, Facebook may remove or hide foreign DOM elements. The `z-index: 2147483646` may conflict with Facebook's own overlays.

5. **Missing host_permissions.** `*://www.facebook.com/*` is not in host_permissions. While the content script can still inject via content_scripts matches, and the background service worker makes the API calls (not the content script), the lack of host_permissions means the extension cannot programmatically access Facebook tabs for things like `tabs.sendMessage` without prior user interaction (activeTab only grants temporary permission).

### PROBLEM 2: Extension Does Not Load on Instagram

**Root Causes (same pattern as Facebook):**

1. **Content script matches are narrow.** Only `*://www.instagram.com/direct/*` and `direct/t/*`. Instagram DMs are at URLs like `https://www.instagram.com/direct/t/123456789` which does match.

2. **Instagram is also a SPA.** Same issue as Facebook — navigating from `instagram.com` to `instagram.com/direct/t/...` via in-app navigation will not trigger content script injection.

3. **SPA observer same dead code bug.** The MutationObserver for Instagram suffers the same issue as Facebook — detection without re-injection.

4. **Instagram CSP.** Instagram has strict Content Security Policy headers. While Chrome extensions can bypass CSP for content scripts, the Shadow DOM approach used here should work. However, injected `<script>` tags (like oper8er-intercept.js) may be blocked by CSP on Instagram pages.

5. **Missing host_permissions.** `*://www.instagram.com/*` is not in host_permissions.

### PROBLEM 3: Sidebar Placement Wrong on VinSolutions

**Analysis:**

The sidebar is positioned as:
```
position: fixed; top: 0; right: 0; width: 300px; height: 100vh; z-index: 2147483647
```

Content push is handled by `pushContent()`:
```
getVinMainContainer() returns:
  #mainAreaPanel || .main-content || #page-content || body (fallback)
main.style.marginRight = '300px' (when open)
```

**Potential Issues:**

1. **VinSolutions uses iframes heavily.** The main content area is often inside iframes. Setting `marginRight` on the top-level `#mainAreaPanel` may not affect content inside iframes, causing overlap.

2. **Selector priority.** If `#mainAreaPanel` doesn't exist, it falls back to `.main-content`, then `#page-content`, then `body`. If the wrong element is selected, the margin push won't work correctly. The `body` fallback is problematic — pushing margin on body with a fixed-position sidebar can cause layout issues.

3. **VinSolutions may use different page structures** for different views (customer dashboard, desking, inventory, etc.). The selectors may work on one view but fail on another.

4. **Fixed positioning in iframed context.** Since `allFrames: true` is set, the content script runs in iframes too. The pill injection is guarded against iframes (line 200), but `position: fixed` in the top frame may still overlap VinSolutions toolbars or navigation that are in separate iframes.

### PROBLEM 4: Lead Scan Does Not Work

**Analysis of scanning failures:**

1. **Customer name regex is fragile.** The pattern `Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)` requires:
   - Exact text "Customer Dashboard" followed by a newline
   - A name with exactly two or three capitalized words
   - Names with suffixes (Jr., III), single-word names, or hyphenated names with multiple parts may fail
   - `innerText` may not preserve the exact whitespace/newline pattern depending on CSS layout

2. **Vehicle extraction depends on text layout.** The regex `Vehicle Info[\s\n]+...` requires "Vehicle Info" to appear in the innerText with specific spacing. VinSolutions DOM changes or style changes can alter innerText output.

3. **Tab character matching.** The pattern `Active\t...` assumes tab characters in innerText. Browser innerText output may use spaces instead of tabs depending on the CSS `display` properties of the elements.

4. **Iframe access may fail silently.** Lines 143-155 try to access iframe contentDocument for email extraction. Cross-origin iframes will throw errors caught by the try/catch, silently failing. VinSolutions iframes on the same origin should work, but any third-party iframes (payment forms, etc.) will fail.

5. **MutationObserver is NOT used for VinSolutions scanning.** Instead, a `setInterval` every 2000ms polls `document.body.innerText`. This means:
   - 2-second delay before detecting new customer data
   - Heavy performance cost of reading entire page innerText every 2 seconds
   - If VinSolutions loads customer data via AJAX after the interval fires, the next poll picks it up — but there's a race condition

6. **Network intercept (oper8er-intercept.js) is a secondary scanning mechanism** that patches `window.fetch`. It only captures API responses containing "customer", "lead", or "contact" in the URL. VinSolutions may use XHR instead of fetch, or may use different URL patterns.

7. **Storage-based cross-frame communication.** Scanning in iframes writes to `browser.storage.local`, and the top frame reads it on a 2000ms interval. This introduces up to 4 seconds of latency (2s write poll + 2s read poll). The vehicle info has a 15-second staleness check (`oper8er_vehicle_info_time > Date.now() - 15000`).

### PROBLEM 5: Outputs Not Tracked to Supabase

**Root Cause: Logging is incomplete/missing.**

1. **`LOG_COPY` handler (background.ts line 42-46) only does `console.log()`.** It does NOT call any proxy endpoint or write to Supabase. Every time a user clicks "Copy + Log", the action is lost when the service worker restarts.

2. **`LOG_ACTION` handler (same area) also only does `console.log()`.** Same issue.

3. **Generation events ARE logged** — the `/v1/generate` proxy endpoint presumably logs to Supabase server-side (the extension sends metadata fields: rep_name, workflow_type, customer_name, vehicle).

4. **Copy/paste events are NOT logged** to any persistent storage. The "Copy + Log" button name is misleading — it copies but does not log.

5. **Email paste events** call `LOG_COPY` with label `EMAIL_SENT` — but this goes to the same console.log-only handler.

6. **CRM paste events** are not explicitly logged at all (no message sent on successful paste).

7. **Coach, Command, Context Reply** — no explicit logging from the extension. The proxy may log these server-side, but the extension doesn't send any acknowledgment.

### PROBLEM 6: Screenshot Drag and Drop Not Working

**Analysis:**

The Context Reply (screenshot) feature is in the Tools > Context tab:

1. **Drop zone exists** (`#o8-ctx-dropzone`) with `dragover`, `dragleave`, and `drop` event listeners.
2. **Drop handler reads the file** via `FileReader.readAsDataURL()` and stores it as a base64 string in `contextImage`.
3. **Generate sends to proxy** via `CONTEXT_REPLY` message → `/api/context-reply` endpoint with the base64 image.

**Potential Issues:**

1. **Shadow DOM drag events.** The drop zone is inside a Shadow DOM. Drag and drop events may not propagate correctly across Shadow DOM boundaries in all browsers. The `dragover` and `drop` events need `e.preventDefault()` on the Shadow DOM host as well, not just inside the shadow.

2. **No paste support despite UI text.** The drop zone says "Drop screenshot or paste (Ctrl+V)" but there is NO `paste` event listener anywhere in the code. Ctrl+V paste is not wired up.

3. **File type check is minimal.** Only checks `f?.type.startsWith('image/')`. No size limit — large screenshots could create massive base64 strings that exceed request size limits on the proxy.

4. **No drag-from-browser support.** If users try to drag an image from another browser tab or from the desktop, the DataTransfer may not contain a File object — it might be a URL or HTML instead. The code only checks `e.dataTransfer?.files?.[0]` and ignores URL drops.

5. **The proxy endpoint `/api/context-reply` must handle base64 images.** If the proxy has a request body size limit (common in Express/Railway), large screenshots will fail silently.

---

## STEP 6 — PC vs MacBook Compatibility

### Node Version

- **Current PC:** Node v24.14.0, npm 11.9.0
- **No `.nvmrc` or `.node-version` file** exists in the project
- **No `engines` field** in package.json
- If the MacBook has a different Node version, `npm install` could produce different `node_modules` contents, especially for native modules

### Package.json Issues

- `"type": "commonjs"` — this is fine for WXT
- No `scripts` defined except `test` (which just echoes an error). Missing: `build`, `dev`, `zip` scripts. The developer must know to run `npx wxt build` or `npx wxt dev` manually
- `@anthropic-ai/sdk` is listed as a dependency but is **never imported** in any source file. The extension uses the Railway proxy for all API calls. This is a wasted dependency (adds to install time but not to the built extension)

### File Path Issues

- **No hardcoded file paths** found in the source code
- All paths are relative or use `browser.runtime.getURL()` for web-accessible resources
- The `PROXY_URL` is hardcoded to the Railway production URL — no environment switching for dev vs prod

### Build Output

- `.output/` directory is in `.gitignore` — correct, builds are not committed
- `.wxt/` directory is also gitignored — correct
- The MacBook would need to run `npx wxt build` after cloning to generate `.output/chrome-mv3/`

### Potential Cross-Platform Issues

1. **No build scripts in package.json.** A developer switching between machines has no standardized way to build. Should have `"build": "wxt build"` and `"dev": "wxt dev"` scripts.

2. **Node v24 is bleeding edge.** If MacBook has an older LTS version (v20 or v22), some dependencies might behave differently. WXT 0.20.x should work on Node 18+.

3. **`.DS_Store` in gitignore** — Mac-specific file. No equivalent Windows exclusion needed (Thumbs.db is not generated in this context).

4. **No `package-lock.json` audit.** The lockfile exists (213KB) and should ensure consistent installs across platforms, but only if both machines use the same npm version. npm 11.x lockfile format may differ from earlier versions.

5. **TypeScript version `^6.0.2`** in devDependencies — this is a very new version. If one machine has cached older types, there could be type-checking differences (though this doesn't affect the built output).

---

## STEP 7 — Complete Bug Summary

### Critical Bugs (Extension Non-Functional)

| # | Bug | Severity | Location |
|---|---|---|---|
| C1 | SPA observer dead code — detects FB/IG container but never re-runs pill injection | CRITICAL | content.ts:206-219 |
| C2 | LOG_COPY and LOG_ACTION only console.log — no persistent logging | CRITICAL | background.ts:42-46 |
| C3 | Ctrl+V paste not wired for Context Reply despite UI promising it | HIGH | content.ts:539-543 |

### High Bugs (Feature Broken)

| # | Bug | Severity | Location |
|---|---|---|---|
| H1 | Facebook SPA navigation prevents content script injection on in-app route changes | HIGH | Manifest + Chrome limitation |
| H2 | Instagram SPA navigation same issue as H1 | HIGH | Manifest + Chrome limitation |
| H3 | Missing host_permissions for facebook.com and instagram.com | HIGH | wxt.config.ts:38-43 |
| H4 | VinSolutions lead scanning uses 2s setInterval polling instead of MutationObserver — slow and CPU-heavy | HIGH | content.ts:178-183 |
| H5 | Customer name regex only matches 2-3 word capitalized names — misses suffixes, single names, non-Latin chars | HIGH | content.ts:128-130 |
| H6 | Network intercept only patches fetch, not XHR — misses VinSolutions XHR-based API calls | HIGH | oper8er-intercept.js |
| H7 | CRM paste success is never logged to Supabase or proxy | HIGH | content.ts:642-655 |

### Medium Bugs (Degraded Experience)

| # | Bug | Severity | Location |
|---|---|---|---|
| M1 | Shadow DOM may block drag events from propagating correctly | MEDIUM | content.ts:539-543 |
| M2 | No image size limit on Context Reply — large screenshots may exceed proxy body limit | MEDIUM | content.ts:542 |
| M3 | Tab character in vehicle regex may not match browser innerText output | MEDIUM | content.ts:119 |
| M4 | VinSolutions sidebar marginRight push may not affect content inside iframes | MEDIUM | content.ts:558-565 |
| M5 | getVinMainContainer() body fallback is too broad — causes whole page shift | MEDIUM | content.ts:378-384 |
| M6 | 15-second staleness window for vehicle info could show outdated vehicle | MEDIUM | content.ts:191 |
| M7 | `@anthropic-ai/sdk` in dependencies but never used — unnecessary bloat | LOW | package.json |
| M8 | No build scripts in package.json — manual `npx wxt build` required | LOW | package.json |
| M9 | No .nvmrc or engines field — no Node version pinning across machines | LOW | package.json |

### Design Concerns (Not Bugs, But Risky)

1. **Demo build hardcoding.** `getTier()` always returns 'group', `isFeatureUnlocked()` always returns true. The heartbeat stores 'group' tier locally regardless of server response. When this ships to real customers, all feature gating code is bypassed.

2. **No retry logic.** API calls to the proxy have no retry on failure. A single network hiccup causes a user-facing error.

3. **Service worker lifecycle.** Chrome MV3 service workers can be terminated after 5 minutes of inactivity. The `setInterval` for heartbeat (5 min) and alerts (30s) may not survive service worker restarts. Chrome will re-fire alarms but not setIntervals.

4. **allFrames: true on all platforms.** The content script runs in every iframe on matching pages. On VinSolutions (which has many iframes), this means multiple instances of the content script running simultaneously, all doing platform detection and potentially conflicting.

---

## Summary

The extension is architecturally sound for VinSolutions but has significant gaps for Facebook and Instagram due to SPA handling, and logging is fundamentally broken for copy/paste events. The most impactful fixes would be:

1. Fix the SPA observer to actually re-trigger pill injection
2. Add persistent logging for LOG_COPY and LOG_ACTION via the proxy
3. Wire up Ctrl+V paste for Context Reply
4. Add host_permissions for Facebook and Instagram
5. Consider using `chrome.alarms` instead of `setInterval` in the background script for MV3 compliance
