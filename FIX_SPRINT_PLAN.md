# Fix Sprint Plan — April 7, 2026

**Priority order. Execute top to bottom. Don't skip.**

---

## 1. BUG-004 — Pill animation lag (15 min)

**Root cause:** CSS transition on `left`/`right` properties causes layout reflow on hover. The rebrand commit changed pill text from "FQ"→"BM" and "Floq"→"Brevmont" (different string lengths), which changes pill width on hover, triggering a position recalculation while the transition is still animating.

**Fix:**
- In `content.ts` pill creation (~line 478), add `will-change: transform` to pill style
- Remove any `transition` that includes `left`, `right`, `width`, or `all`
- Replace with `transition: 'opacity 0.15s, background 0.15s'` — only animate cosmetic properties
- On hover text change ("BM" → "Brevmont"), the pill should NOT reposition — keep it anchored at its current transform position
- Add `white-space: nowrap` to prevent text wrapping during expansion
- Test: hover pill 10 times rapidly on VinSolutions. Zero jank.

**Files:** `entrypoints/content.ts` (pill styles + hover handler)

---

## 2. FEAT-002 — CRM note character limit (30 min)

**Blocked on:** VinSolutions char limit test (Yancy does this tomorrow). Assume 500 chars until confirmed.

### Part A — Proxy prompt rewrite (10 min)

**File:** `C:\inventory_pipeline\oper8er-proxy\server.js` — find the CRM note generation instruction in the system prompt or the user prompt template.

**Current template order:** Contact Type → Summary → Vehicle → Intent → Action → Next Step

**New template order:** Next Step → Action → Summary (truncate-safe zone: Vehicle → Intent → Contact Type)

**New prompt instruction:**
```
CRM NOTE RULES:
- Maximum 480 characters (hard limit, no exceptions)
- Format: three sections separated by pipes
- Section 1: Next step (what the rep does tomorrow — specific time, specific action)
- Section 2: What happened in this interaction (one sentence)
- Section 3: Current deal status (one phrase)
- Example: "Follow up 2 PM tomorrow with updated numbers | Sent purchase proposal, customer approved for financing | Credit app submitted, waiting on lender stip sheet"
- If you cannot fit all three sections in 480 chars, drop Section 3 first
- NEVER truncate Section 1 (Next Step)
- No field labels ("Contact Type:", "Summary:" etc) — waste of characters
- No greeting, no signoff, no narrative
```

### Part B — Same-lead deduplication (20 min)

**File:** `entrypoints/content.ts` — in the generation metadata block and `entrypoints/background.ts` — in `handleGenerate()`

**Current:** Every generation creates a note with zero awareness of prior notes on the same lead.

**Fix:**
1. Before generating, query Supabase `generation_events` for the last 3 entries matching `customer_name + dealership` from the past 2 hours
2. Pass those prior notes into the generation prompt as context:
   ```
   PRIOR NOTES ON THIS CUSTOMER (last 2 hours):
   [9:44 AM] Follow up 2 PM with numbers | Sent proposal | Credit pending
   [10:22 AM] ...

   DO NOT repeat information from prior notes. Only generate a new note
   if there is new information. If nothing changed, respond with "NO_NEW_NOTE".
   ```
3. In `content.ts`, if the response is "NO_NEW_NOTE", show a toast: "Nothing new to log — last note covers this."
4. This also fixes the intent level problem — the AI sees prior "Hot" tags and can adjust based on what actually happened

**Proxy change:** Add a `/api/recent-notes` endpoint that returns the last 3 notes for a customer+dealership pair within the last 2 hours. The extension calls this before generation.

### Part C — Character counter in sidebar (15 min)

**File:** `entrypoints/content.ts` — in the `addOutput()` function where CRM NOTE cards render

**Fix:**
1. After rendering a CRM NOTE output card, append a character counter element:
   ```html
   <span class="crm-char-count" style="font-size:11px; color:#6B6B6B; font-family:'JetBrains Mono',monospace;">
     243 / 500
   </span>
   ```
2. Color logic: green if under 80% of limit, amber if 80-95%, brick red if over 95%
3. The limit value comes from a constant `CRM_NOTE_CHAR_LIMIT` — set to 500 default, update once Yancy confirms the real number

---

## 3. FEAT-001 — VinSolutions email popup injection (2-3 hours)

**The deal-closer feature. This is what sells Brevmont Command.**

### Step 1 — Verify URL matching (10 min)

The email popup opens at a URL like:
`https://vinsolutions.app.coxautoinc.com/CarDashboard/Pages/LeadManagement/sendemail.aspx`

**Check:** `wxt.config.ts` manifest matches include `*://vinsolutions.app.coxautoinc.com/*` — this SHOULD match the popup URL. If not, add the specific pattern.

**Check:** `host_permissions` in wxt.config.ts — same wildcard should cover it.

### Step 2 — Fix duplicate guard scoping (15 min)

**Current guard:** `document.getElementById('brevmont-pill')` and `document.getElementById('brevmont-host')` — these check the current document's DOM. In a popup window, the document is fresh — the guard should NOT block injection.

**Potential bug:** If the popup inherits the parent window's DOM state somehow (unlikely but possible in VinSolutions' iframe architecture), the guard fires and blocks.

**Fix:** Add a `window.name` or `window.location.pathname` check. If the URL contains `sendemail.aspx` or `LogCallV2.aspx`, SKIP the pill entirely and inject a different UI (the toolbar button described below).

### Step 3 — Detect popup type and inject toolbar button (1-2 hours)

**Email compose popup (`sendemail.aspx`):**

1. Detect: `if (window.location.href.includes('sendemail.aspx'))`
2. Find the email form elements:
   - To field (likely an input or contenteditable)
   - Subject field (input)
   - Body field (iframe with contenteditable OR textarea)
   - Send button
3. Inject a "Generate with Brevmont" button into the toolbar area above the body field
4. Style: teal background (#0D6E6E), white text, Inter font, 8px border-radius, sits next to existing toolbar buttons
5. On click:
   a. Read customer name from the popup's DOM (it should be in the header or a hidden field)
   b. Read vehicle info if visible
   c. Call the proxy `/v1/generate` with output_type: 'email'
   d. Auto-populate Subject field with generated subject
   e. Auto-populate Body field with generated email body using `safeInjectText()` (the existing native setter pattern)
   f. Do NOT auto-click Send — leave the rep to review and send
6. Show a small toast in the popup: "Email generated. Review and send."

**Call log popup (`LogCallV2.aspx`):**

1. Detect: `if (window.location.href.includes('LogCallV2'))`
2. Find the Call Notes textarea
3. Inject a "Generate Call Note" button next to the textarea
4. On click:
   a. Read customer context from the popup DOM
   b. Generate a call note via proxy
   c. Auto-populate the textarea using `safeInjectText()`
   d. Toast: "Call note generated."

### Step 4 — Shared popup injection module (30 min)

Extract the popup detection + injection into a reusable function:

```typescript
function handleVinSolutionsPopup() {
  const url = window.location.href;

  if (url.includes('sendemail.aspx')) {
    injectEmailCompose();
    return true; // Signal: don't inject normal pill/sidebar
  }

  if (url.includes('LogCallV2')) {
    injectCallLog();
    return true;
  }

  return false; // Normal page, proceed with pill/sidebar
}
```

Call this at the top of `main()` in content.ts, before the pill creation. If it returns true, skip the rest of the content script (no pill, no sidebar, no scanning — just the popup button).

### Step 5 — Test matrix (15 min)

| Scenario | Expected |
|----------|----------|
| Open VinSolutions dashboard | Normal pill + sidebar |
| Open email popup from customer record | "Generate with Brevmont" button in toolbar, no pill |
| Click Generate in email popup | Subject + body auto-populated |
| Open call log popup | "Generate Call Note" button, no pill |
| Click Generate in call log popup | Call notes textarea auto-populated |
| Open email popup while sidebar is open in main window | Both work independently |
| Close popup, return to main window | Pill still there, sidebar still works |

---

## 4. FEAT-003 — Log Call popup injection (0 min — included in FEAT-001)

Same code path as FEAT-001 Step 3. The `handleVinSolutionsPopup()` function handles both popup types. No additional work needed.

---

## Execution Order

| # | Item | Time | Dependency |
|---|------|------|------------|
| 1 | BUG-004 pill lag | 15 min | None |
| 2 | FEAT-002 Part A (prompt rewrite) | 10 min | Char limit test from Yancy (use 500 default) |
| 3 | FEAT-002 Part C (char counter) | 15 min | None |
| 4 | FEAT-002 Part B (dedup + prior context) | 20 min | None |
| 5 | FEAT-001 Steps 1-2 (URL matching + guard) | 25 min | None |
| 6 | FEAT-001 Steps 3-4 (popup injection) | 2 hours | VinSolutions access for testing |
| 7 | FEAT-001 Step 5 (test matrix) | 15 min | Steps 1-6 complete |
| **Total** | | **~3.5 hours** | |

## Commits

1. `fix: resolve pill animation lag from rebrand (BUG-004)`
2. `feat: CRM note prompt rewrite + character counter (FEAT-002)`
3. `feat: same-lead dedup window for note generation (FEAT-002b)`
4. `feat: VinSolutions email + call popup injection (FEAT-001/003)`

Version bump to 1.9.2 after all four.

## Data needed from Yancy before execution

1. **VinSolutions CRM note character limit** — paste 2000 chars, find cutoff
2. **Screenshot of a truncated note** — see what VinSolutions does at the cap
3. **Email popup DOM inspection** — open DevTools in the email popup, screenshot the form elements (To, Subject, Body selectors)
4. **Call log popup DOM inspection** — same, screenshot the Call Notes textarea and its parent structure

Items 1-2 take 5 min at a VinSolutions terminal. Items 3-4 take 5 min with DevTools open. All four can be done during one customer interaction tomorrow.

---

## Changelog
- 2026-04-06: Initial fix sprint plan from live dealership feedback
