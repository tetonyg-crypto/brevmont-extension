# FULL FORENSIC AUDIT — Floq (Oper8er v2) Chrome Extension

**Date:** 2026-04-04
**Extension version:** 1.8.1
**Framework:** WXT (Manifest V3)
**Proxy:** https://api.brevmont.com
**Supabase:** https://mqnmemnogbotgmsmqfie.supabase.co

---

## STEP 1: File Inventory

### Core Extension Files

| # | File | What It Does | State |
|---|------|-------------|-------|
| 1 | `wxt.config.ts` | WXT build config — defines manifest (name, version, permissions, match patterns, commands, web_accessible_resources). | Working |
| 2 | `entrypoints/content.ts` | Content script — the entire frontend. Injects pill, sidebar (Shadow DOM), scans VinSolutions for customer data, handles generation, CRM paste, tools (coach/alerts/context/command), SPA observers. 1216 lines. | Partially working — see Step 3 |
| 3 | `entrypoints/content/styles.css` | Empty placeholder — all sidebar styles live inside `getCSS()` in content.ts via Shadow DOM. 2 lines (comment only). | Working (intentionally empty) |
| 4 | `entrypoints/background.ts` | Background service worker — handles all message types (GENERATE_OUTPUT, CHECK_FEATURES, COACH_ME, EXECUTE_COMMAND, CONTEXT_REPLY, VOICE_REPLY, LOG_ACTION, LOG_COPY, alerts, pending notes). Routes generation through Railway proxy. Heartbeat every 5 min. 713 lines. | Working |
| 5 | `public/oper8er-intercept.js` | Web-accessible resource — monkey-patches `window.fetch` on VinSolutions pages to intercept customer/lead/contact API responses and postMessage extracted data to content script. | Working (supplementary scanner) |
| 6 | `entrypoints/onboarding/index.html` | Onboarding UI — 4-step wizard (identity, dealership, voice, customers) + completion screen. 323 lines. | Working |
| 7 | `entrypoints/onboarding/main.ts` | Onboarding logic — collects profile data, validates license key against Supabase `dealerships` table, saves to chrome.storage.sync, syncs to Supabase `reps` table. 254 lines. | Working |
| 8 | `entrypoints/options/index.html` | Options page HTML — profile settings with collapsible sections, context preview. | Working |
| 9 | `entrypoints/options/options.js` | Options page logic — loads/saves profile sections to chrome.storage.sync, renders context preview. | Working |
| 10 | `entrypoints/voice.html` | Standalone voice dictation popup — SpeechRecognition API, writes transcript to `oper8er_voice` in storage. Not currently launched from sidebar (sidebar uses inline mic instead). | Working but unused |
| 11 | `package.json` | NPM config — dependencies: wxt, react, react-dom, lucide-react, tailwindcss, clsx. | Working |
| 12 | `tsconfig.json` | Extends `.wxt/tsconfig.json`. | Working |
| 13 | `postcss.config.js` | PostCSS with Tailwind and autoprefixer. | Working |
| 14 | `tailwind.config.js` | Tailwind config — custom colors (accent, success), Inter font. | Working (but Tailwind is NOT used in content.ts — all styles are inline/getCSS()) |

### Test / Utility Files

| # | File | What It Does | State |
|---|------|-------------|-------|
| 15 | `test-vehicle-detection.js` | Node.js test — 20 test cases for `extractVehicle()` + `scanText()` against realistic VinSolutions page text. Includes the real equity-line-poisoning bug. | Working (standalone test) |
| 16 | `test-supabase-logging.js` | Node.js test — POSTs a test generation_event to Supabase and verifies it reads back correctly. | Working (standalone test) |
| 17 | `vin-dom-discovery.js` | Console-paste diagnostic — scans all frames for textareas, contenteditable elements, and note-related UI to discover CRM injection targets. | Working (manual diagnostic tool) |

### Mockups / Static Files

| # | File | What It Does | State |
|---|------|-------------|-------|
| 18 | `mockups/concept-a.html` | Static HTML mockup — deal recap in left panel concept. | N/A (design artifact) |
| 19 | `mockups/concept-b.html` | Static HTML mockup — deal recap inside sidebar concept. | N/A (design artifact) |
| 20 | `public/icons/icon-16.png` | Extension icon 16px. | Working |
| 21 | `public/icons/icon-32.png` | Extension icon 32px. | Working |
| 22 | `public/icons/icon-48.png` | Extension icon 48px. | Working |
| 23 | `public/icons/icon-128.png` | Extension icon 128px. | Working |
| 24 | `public/icons/icon-512.png` | Extension icon 512px. | Working |
| 25 | `.gitignore` | Ignores node_modules, .output, .wxt, *.zip, .DS_Store. | Working |

### Previous Audit Reports (not part of extension)

| # | File | State |
|---|------|-------|
| 26 | `FLOQ_DIAGNOSTIC_REPORT.md` | Previous diagnostic report |
| 27 | `MACBOOK_DIAGNOSTIC_REPORT.md` | Previous diagnostic report |
| 28 | `PC_FORENSIC_AUDIT.md` | Previous forensic audit |

---

## STEP 2: Complete Extension Flow Map

### 1. INJECTION

**Match patterns** (from `defineContentScript` in content.ts, lines 32-44):
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

**allFrames: true** (line 45) — The content script loads in EVERY frame including iframes.

**runAt: 'document_idle'** (line 46)

**What happens in iframes vs top frame:**

1. `detectPlatform()` runs at module scope (line 29) — reads `window.location.href`.
2. If platform is `'unknown'`, the script returns immediately (line 50) — nothing happens.
3. **Lines 195-223 — IFRAME GUARD**: If `window !== window.top`:
   - For VinSolutions iframes only: scans iframe body text for "Customer Dashboard" or "(Individual)/(Business)" patterns.
   - If a customer name is found, writes `oper8er_lead` + `oper8er_lead_time` to `browser.storage.local` (line 201).
   - Sets up a MutationObserver inside the iframe for dynamic updates (lines 206-220).
   - **Then returns** (line 223) — no pill, no sidebar injected in iframes.

4. **Top frame only** (line 224+): Double-injection guard checks for `#floq-sidebar` and `#oper8er-host` (lines 227-228).
5. VinSolutions gets a `waitForReady()` delay (lines 231-248).
6. Facebook/Instagram get stale marker cleanup (lines 251-257).
7. Pill is created and appended to `document.body` (lines 334-350).

### 2. CUSTOMER DETECTION (VinSolutions Only)

**Three scanning layers work in parallel:**

**Layer A — Iframe Scanner (lines 195-223):**
- Runs inside each VinSolutions iframe (before the `return` at line 223).
- Scans `document.body.innerText` for "Customer Dashboard" or "(Individual)/(Business)" patterns.
- Calls `scanText()` which extracts: customerName, phone, email, vehicle, source, status, lastContact.
- Writes results to `browser.storage.local` as `oper8er_lead`.
- Sets up a MutationObserver to re-scan on DOM changes.

**Layer B — Top Frame Scanner (lines 262-323):**
- `gatherAllText()` (line 264): reads `document.body.innerText` from top frame + all accessible same-origin iframes.
- `getDashboardScopedText()` (line 278): finds "Customer Dashboard" in gathered text and returns only text AFTER that marker (to avoid picking up names from the left lead-list panel).
- `attemptScan()` (line 285): calls `scanText()` on dashboard-scoped text. Falls back to full text for vehicle if dashboard text has none.
- `MutationObserver` on `#mainAreaPanel || document.body` (lines 302-313): debounced 500ms, re-scans when DOM changes and customer name differs from last.
- **Storage polling** (lines 316-323): Every 3 seconds, reads `oper8er_lead` from storage. If lead data has changed, updates `leadData` variable and calls `updateSidebar()`.

**Layer C — Network Interceptor (lines 1209-1213):**
- Injects `oper8er-intercept.js` as a page-level script (bypasses CSP).
- Monkey-patches `window.fetch` to intercept responses containing "customer", "lead", or "contact" in URL.
- Extracts firstName, lastName, vehicle, phone, email via regex on JSON response string.
- Posts extracted data via `window.postMessage({ type: 'OPER8ER_LEAD_DATA', data })`.
- Content script listens for this message (line 1212) and directly sets `leadData` + calls `updateSidebar()`.

**Text pattern matching (`scanText()`, lines 155-191):**
- Customer name: `Customer Dashboard\n(FirstName LastName)` OR `(Name)\n(Individual|Business)`.
- Phone: `[CHW]: (xxx) xxx-xxxx` pattern.
- Email: standard email regex, then falls back to `mailto:` links, then searches iframe content.
- Vehicle: 5-strategy `extractVehicle()` function (lines 144-153):
  1. "Vehicle Info" section header
  2. "Active" tab row in sales status table
  3. "YYYY Make Model..." with poison-context filtering (excludes equity/payoff/trade-in lines)
  4. "YYYY Make" only (with poison filtering)
  5. Near "Stock #" or "Vehicle:" label

### 3. DATA FLOW TO SIDEBAR

**Exact chain:**

```
scanText() [lines 155-191]
  → returns { customerName, phone, email, vehicle, source, status, lastContact }
  → browser.storage.local.set({ oper8er_lead: parsed }) [line 201 in iframe, line 295 in top frame]

Storage polling interval [lines 316-323] (every 3000ms):
  → browser.storage.local.get(['oper8er_lead', ...])
  → Compares customerName/vehicle against current leadData
  → If changed: leadData = lead; updateSidebar();

OR

Network interceptor [line 1212]:
  → window.postMessage OPER8ER_LEAD_DATA
  → leadData = event.data.data; updateSidebar();

updateSidebar() [lines 833-876]:
  → Gets shadow root from sidebarRoot
  → Gets #o8-card element
  → If leadData.customerName exists:
    → Sets #o8-name textContent to customerName (line 840)
    → Sets #o8-vehicle textContent to vehicle or "No vehicle selected" (lines 842-844)
    → Builds meta string from phone + email + source → sets #o8-meta (lines 845-849)
    → Checks for matching pending note (lines 852-867)
  → If no customerName:
    → Shows "Open a customer record" in italic gray (lines 868-875)
```

### 4. GENERATE BUTTON

**Exact chain:**

```
User clicks "Generate" button (#o8-generate)
  → o8-generate onclick [line 644] → doGenerate(s)

doGenerate(s: ShadowRoot) [lines 879-908]:
  → Guards: isGenerating check, requires input text or leadData.customerName
  → Reads active chips (.chip.on) for type selection (text/email/crm/all)
  → Reads floq_tone + floq_goal from storage [lines 893-894]
  → Calls safeSend({ type: 'GENERATE_OUTPUT', payload: { type, leadContext: leadData, repInput, platform, tone, goal, metadata } })

safeSend(msg) [lines 112-121]:
  → First sends PING to check service worker is alive
  → If PING fails: throws "Floq lost connection. Reload this page to reconnect."
  → Otherwise: browser.runtime.sendMessage(msg)

background.ts onMessage handler [line 19]:
  → msg.type === 'GENERATE_OUTPUT'
  → handleGenerate(msg.payload) [lines 362-403]

handleGenerate(payload) [lines 362-403]:
  → Gets dealer_token from storage
  → buildRepContext() [lines 308-360] — reads profile from storage, builds context block
  → buildUserMessage(payload, repName, dealership, contextBlock) [lines 648-699]
    → Injects rep context block
    → Adds LEAD CONTEXT from leadContext fields
    → Adds generation instructions based on type (all/text/email/crm)
  → generateViaProxy(dealerToken, userMessage, platform, metadata) [lines 407-437]

generateViaProxy() [lines 407-437]:
  → POST to https://api.brevmont.com/v1/generate
  → Body: { dealer_token, messages: [{role:'user', content: userMessage}], max_tokens:800, model:'claude-sonnet-4-20250514', platform, rep_name, workflow_type, customer_name, vehicle }
  → Handles 401 (license), 429 (rate limit), other errors
  → Returns { text, usage }

Back in handleGenerate():
  → parseSections(text) [lines 701-712]
    → Regex matches TEXT, EMAIL, CRM NOTE sections
    → Returns { text, email, crm, raw }
  → Returns { text, sections } to content script

Back in doGenerate():
  → If error: addOutput(s, 'Error', response.error)
  → If success: addOutput() for each selected chip type that has content [line 903]
    → e.g., addOutput(s, 'TEXT MESSAGE', sec.text)

addOutput(s, label, content, containerId) [lines 1002-1051]:
  → Creates .out-card div
  → For CRM on VinSolutions: "Paste to CRM" button → pasteIntoCRM()
  → For Email on VinSolutions: "Send to Email" button → pasteIntoEmail()
  → For everything else: "Copy + Log" button → clipboard + LOG_COPY message
  → Appends card to #o8-outputs container
```

### 5. SIDEBAR UI

**getHTML() [lines 1099-1148] builds:**

```
#o8 (root container)
  .header
    .logo ("FLOQ")
    .badge (platform-specific: "VinSolutions", "Gmail", etc.)
    #o8-close (X button)

  #o8-quick (.quick-mode) — main view
    #o8-card (.card) — VinSolutions only
      #o8-name — customer name
      #o8-vehicle — vehicle interest
      #o8-meta — phone / email / source
    .input-section
      .chips — Message, Email, CRM Note toggle buttons
      .input-wrap
        #o8-input (textarea) — main prompt input
        #o8-mic (inline mic button)
      #o8-generate (Generate button)
      .inline-links — "Tools | Settings" links
    #o8-outputs — generated output cards go here

  #o8-tools-panel (hidden by default)
    Tool tabs: Coach | Alerts | Context | Command
    #tool-coach — situation input + coach chips + Coach Me button + output
    #tool-alerts — alert input + Set Alert button + alert list
    #tool-context — screenshot drop zone + direction input + Generate Reply
    #tool-command — command input + Execute button + status

  #o8-settings-panel (hidden by default)
    Tone radios: Professional / Friendly / Casual / Direct
    Goal radios: Close the deal / Book appointment / Gather info / Nurture

  .sidebar-footer (sticky bottom, dark background)
    "Tools" button
    "Settings" button
    TCPA disclaimer
```

**Shadow DOM:** The sidebar is inside a Shadow DOM attached to `#oper8er-host` (line 624). All styles are injected via `getCSS()` [lines 1151-1206].

**Positioning:**
- VinSolutions: fixed left:0, top:0, width:320px, height:100vh (line 615-621)
- Gmail: fixed bottom:0, left:0, width:280px, maxHeight:calc(100vh - 200px) (line 609)
- All others: fixed top:0, right:0, width:300px (line 612)

### 6. PILL

**Creation:** Lines 334-349.
- `position: fixed`
- `left: 0` (flush to left edge)
- `top: 50%`, `transform: translateY(-50%)` (vertically centered)
- `borderRadius: 0 8px 8px 0` (rounded on right side only — tab shape)
- Text: "FQ" (expands to "Floq" on hover)
- `zIndex: 2147483646`

**No saved position restore.** The pill always starts at `left:0, top:50%`.

**SPA re-injection for Facebook/Instagram (lines 353-380):**
- MutationObserver watches for pill removal.
- Re-created pill uses `right: 16px` (NOT left:0) and `borderRadius: 8px` (full rounded, not tab shape).
- This is inconsistent with the initial pill.

**VinSolutions SPA observer (lines 383-403):**
- Watches for URL changes via MutationObserver.
- On change: removes host + marker, resets state, auto-opens sidebar after 1500ms.
- Auto-opens sidebar on initial load after 2000ms (lines 400-402).

---

## STEP 3: Finding the Broken Links

### ISSUE 1: Iframe scanning works correctly BEFORE the guard

**Lines 195-223.** The iframe guard at line 195 (`if (window !== window.top)`) does NOT prevent scanning. The scanning code runs at lines 196-221 BEFORE the `return` at line 223. This is correct behavior:

1. Content script loads in iframe (allFrames: true).
2. detectPlatform() returns 'vinsolutions' for iframe (iframe URL is also vinsolutions.com).
3. Lines 69-89: AddNote popup receiver runs (for CRM note paste).
4. Lines 195-221: Iframe scanner runs — scans text, writes to storage, sets up MutationObserver.
5. Line 223: `return;` — no pill/sidebar injected in iframe.

**Verdict: Working as designed.** Iframes scan and write to storage; top frame reads from storage via polling.

### ISSUE 2: Pill position — left:0, not right:16px

**Line 339:** Initial pill is `left: '0'`. This is correct for VinSolutions (pill is a left-edge tab).

**Lines 362-370:** SPA re-injection pill (Facebook/Instagram) uses `right: '16px'` and `borderRadius: '8px'`. This is intentionally different — non-VinSolutions platforms get a right-side pill.

**However:** The initial pill at line 339 always uses `left: 0` regardless of platform. For Gmail, Facebook, LinkedIn, Instagram, WhatsApp, the pill should arguably be on the right side since the sidebar opens on the right for those platforms. This is a minor UX inconsistency but not a functional break — the pill works, it's just on the wrong side for non-VinSolutions platforms on first load.

### ISSUE 3: Customer card (#o8-card) — does updateSidebar() get called with actual lead data?

**updateSidebar() [line 833]** is called from three places:
1. **Storage polling** (line 321): `if (lead.customerName !== leadData?.customerName || lead.vehicle !== leadData?.vehicle) { leadData = lead; updateSidebar(); }` — Runs every 3 seconds.
2. **Network interceptor** (line 1212): `leadData = event.data.data; updateSidebar();`
3. **Initial sidebar open** (line 814): `if (isVinSolutions) updateSidebar();`

For updateSidebar() to populate the card, `leadData` must have a `customerName`. This requires:
- The iframe scanner to find "Customer Dashboard\nFirstName LastName" in iframe text and write to storage, OR
- The top-frame scanner to find the same pattern in gathered text (including iframe content), OR
- The network interceptor to capture a fetch response with firstName/lastName fields.

**Potential failure point:** If VinSolutions loads customer data in a cross-origin iframe, the iframe scanner at line 269 will catch a `try/catch` and silently fail. The `gatherAllText()` function at line 264 also wraps iframe access in try/catch. If ALL iframes are cross-origin, no customer data gets extracted, `oper8er_lead` never gets set, storage polling finds nothing, and the card stays at "Open a customer record".

The network interceptor (Layer C) is the backup — it runs at page level and captures fetch responses regardless of iframe origin. But it only fires when VinSolutions makes a fetch call containing "customer", "lead", or "contact" in the URL, which may not happen on every page navigation.

**Verdict: The chain is architecturally sound but depends on at least one of the three layers succeeding.** The most likely failure is: customer data is in cross-origin iframes AND no matching fetch calls fire.

### ISSUE 4: Storage polling — does the 3-second interval actually read oper8er_lead?

**Lines 316-323:**
```typescript
setInterval(async () => {
  try {
    const r = await browser.storage.local.get(['oper8er_lead', 'oper8er_lead_time', 'oper8er_vehicle_info', 'oper8er_vehicle_info_time']);
    const lead = r.oper8er_lead; if (!lead?.customerName) return;
    if (!lead.vehicle && r.oper8er_vehicle_info && r.oper8er_vehicle_info_time > Date.now() - 15000) { lead.vehicle = r.oper8er_vehicle_info; await browser.storage.local.set({ oper8er_lead: lead, oper8er_lead_time: Date.now() }); }
    if (lead.customerName !== leadData?.customerName || lead.vehicle !== leadData?.vehicle) { leadData = lead; updateSidebar(); }
  } catch(e) {}
}, 3000);
```

This runs ONLY inside the `if (isVinSolutions)` block (line 262). It correctly reads `oper8er_lead` every 3 seconds and updates if changed.

**Verdict: Working.** The polling interval reads from storage and triggers updateSidebar() when data changes.

### ISSUE 5: Pill inconsistency across platforms on first load

The pill at line 334-349 always uses `left: 0` with a right-side-only border radius (tab shape on left edge). But:
- VinSolutions sidebar opens on the LEFT — pill on left makes sense.
- All other platforms (Gmail, Facebook, LinkedIn, Instagram, WhatsApp) open sidebar on the RIGHT — pill should logically be on the right side.

The SPA re-injection code (line 365) correctly uses `right: 16px` for Facebook/Instagram, but the INITIAL pill at line 339 does not branch by platform.

### ISSUE 6: voice.html is orphaned

The voice.html popup at `entrypoints/voice.html` writes to `oper8er_voice` storage key, but nothing in the content script reads `oper8er_voice`. The sidebar uses inline SpeechRecognition instead. This file is declared in `web_accessible_resources` (wxt.config.ts line 27) but never launched.

### ISSUE 7: Supabase key exposed in client code

`onboarding/main.ts` lines 131-132 and 199 contain the Supabase publishable key (`sb_publishable_-sD_RSqo9SNizbhQ0kqWSA_tJbsWD_m`). While publishable keys are designed for client use, this key appears to have write access to `reps` table (line 195-213) and read access to `dealerships` and `dealer_tokens` tables. This is a security consideration — Row Level Security (RLS) should be confirmed on these tables.

### ISSUE 8: React/Lucide dependencies unused

`package.json` includes `react`, `react-dom`, `lucide-react`, and `clsx` as dependencies, but the content script and all other files use vanilla DOM manipulation. No JSX or React components exist in the codebase. These are dead dependencies.

### ISSUE 9: Tailwind configured but unused in content script

`tailwind.config.js` and `postcss.config.js` are configured, but `content/styles.css` is empty (just a comment). All sidebar styles are inline in `getCSS()`. Tailwind classes are not used anywhere in the extension's runtime code.

---

## SUMMARY: What Works

1. **Injection chain** — Content script correctly loads in all frames, scans in iframes, renders UI only in top frame.
2. **VinSolutions scanning** — Three parallel detection layers (iframe DOM scanning, top-frame DOM scanning, network interception) with poison-context filtering for equity/payoff/trade-in lines.
3. **Storage-based cross-frame sync** — Iframe scanner writes to storage, top-frame polls every 3 seconds.
4. **Generation pipeline** — safeSend() → PING check → background GENERATE_OUTPUT → handleGenerate() → buildRepContext() + buildUserMessage() → generateViaProxy() to Railway → parseSections() → addOutput().
5. **CRM paste** — Finds AddNote textarea across iframe hierarchy, falls back to pending notes in Supabase.
6. **Email paste** — Searches iframes for email compose forms, falls back to clipboard.
7. **Onboarding** — 4-step wizard with license validation against Supabase, profile sync.
8. **Tools** — Coach, Alerts (with chrome.alarms), Context Reply (vision/screenshot), Command Mode all route through Railway proxy.
9. **Feature gating** — Tier system (floor/command/group) checked via heartbeat response.
10. **Error handling** — safeSend PING check, reconnect banner, service worker revival.

## SUMMARY: What Is Broken or Suspicious

1. **Pill on wrong side for non-VinSolutions platforms on first load** — Always starts at left:0, should be right:16px for right-sidebar platforms.
2. **Cross-origin iframe failure mode** — If VinSolutions loads customer data exclusively in cross-origin iframes and no matching fetch calls happen, the customer card will never populate. No warning is shown to the user.
3. **voice.html orphaned** — Declared in web_accessible_resources but never used.
4. **React/Lucide/clsx dependencies unused** — Dead weight in node_modules.
5. **Tailwind configured but unused** — postcss + tailwind setup exists but content script uses only inline styles.
6. **Supabase publishable key in client** — Should verify RLS policies on dealerships, dealer_tokens, and reps tables.
7. **No draggable pill** — Despite the v1.8.1 header claiming "Draggable pill", there is no drag logic. The pill is click-only.
