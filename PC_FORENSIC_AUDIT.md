# PC FORENSIC AUDIT REPORT
**Date:** 2026-04-04
**Auditor:** Claude Code (Forensic Systems Auditor)
**Subject:** Floq Chrome Extension — PC vs MacBook divergence analysis

---

## 1. PC SYSTEM STATE (SOURCE OF TRUTH)

| Property | Value |
|----------|-------|
| **Branch** | `main` |
| **HEAD commit** | `fd2c1c5` — "Merge branch 'main' of https://github.com/tetonyg-crypto/floq-extension" |
| **Working tree** | **CLEAN** — no uncommitted changes, no stale files |
| **Version** | `1.8.1` (in `wxt.config.ts` line 8) |
| **Build output** | `.output/chrome-mv3/` exists, built and current |
| **Remote sync** | PC is **BEHIND** origin/main by 6 commits. Remote has v1.8.2 through v1.8.5 pushed from MacBook. |

### Recent Commit History (PC local)
```
fd2c1c5 Merge branch 'main' of https://github.com/tetonyg-crypto/floq-extension  ← PC HEAD
0943a57 fix: HIGH fixes 4-7, MEDIUM fixes 8-10 from diagnostic audit
ae3f1b9 v1.8.1: Version bump, clean up stale copies, fix comment
48fd35f fix: wire Ctrl+V paste for Context Reply screenshots
c3f0cac fix: LOG_COPY and LOG_ACTION now persist to Supabase via proxy
3d57801 merge: MacBook v1.8.0 + working SPA observer for FB/IG  ← the merge that integrated MacBook
85ee3e3 fix: extract createPill() function, wire SPA observer to actually inject
6baa43c v1.8.0: Draggable pill  ← THE MACBOOK COMMIT
5dd5b78 v1.8.0: Move pill and sidebar from right to left side
61f57f8 v1.8.0: Fix mic — continuous listening until manual stop
```

### Remote Commits AHEAD of PC (pushed from MacBook)
```
6739f5b v1.8.5: Fix customer scan, right-side overlay, no content push  ← LATEST on origin
5c2cbc0 v1.8.4: Fix crash — inline platform detection instead of calling detectPlatform()
99a76ae v1.8.3: Fix sidebar wrong side — PLATFORM was undefined at module scope
c7aa475 v1.8.2: Version bump to force Chrome reload — sidebar left:0 confirmed
fd2c1c5 Merge branch 'main'  ← PC HEAD matches this
ae3f1b9 v1.8.1: Version bump
```

---

## 2. VERIFIED WORKING FLOW — COMPLETE DATA FLOW

### Generation Flow (Input to Output)

**Step 1: User Input (content.ts)**
- User types in `#o8-input` textarea (line 1140)
- User selects Message/Email/CRM Note chips (`.chip.on` buttons, lines 1135-1137)
- User clicks "Generate" button (`#o8-generate`, line 1143) or presses Enter (line 667)

**Step 2: doGenerate() (content.ts, line 900)**
- Guards: checks `isGenerating` flag, requires input or leadData
- Reads active chips via `s.querySelectorAll('.chip.on')` (line 905)
- Maps chip selections to type: 'text', 'email', 'crm', or 'all' (line 908)
- Reads tone/goal from `browser.storage.local` (line 915)
- Calls `safeSend({ type: 'GENERATE_OUTPUT', payload: {...} })` (line 918)
- Payload includes: type, leadContext, repInput, platform, tone, goal, metadata

**Step 3: safeSend() (content.ts, line 112)**
- Pings service worker first to check if alive
- If dead, throws reconnect error
- Otherwise forwards message via `browser.runtime.sendMessage()`

**Step 4: background.ts Message Listener (line 15-30)**
- Receives `GENERATE_OUTPUT` message
- Calls `handleGenerate(msg.payload)` (line 20)
- Returns promise (async, `return true` on line 30)

**Step 5: handleGenerate() (background.ts, line 358)**
- Reads `dealer_token` from `browser.storage.sync` (line 367)
- Calls `buildRepContext()` for rep name, dealership, context block (line 368)
- Calls `buildUserMessage()` to compose the full prompt (line 374)
- Calls `generateViaProxy()` with dealer token, message, platform, metadata (line 392)

**Step 6: generateViaProxy() (background.ts, line 403)**
- POST to `https://api.brevmont.com/v1/generate`
- Body: dealer_token, messages array, max_tokens (800), model (claude-sonnet-4-20250514), platform, metadata
- Handles 401 (license), 429 (rate limit), other errors
- Returns `{ text, usage }` from proxy response

**Step 7: parseSections() (background.ts, line 697)**
- Parses raw AI text into sections using regex:
  - TEXT section: `/(?:^|\n)TEXT\s*\n([\s\S]*?)(?=\n(?:EMAIL|CRM)|$)/i`
  - EMAIL section: `/(?:^|\n)EMAIL\s*\n([\s\S]*?)(?=\n(?:CRM)|$)/i`
  - CRM section: `/(?:^|\n)CRM(?: NOTE)?\s*\n([\s\S]*?)$/i`
- Returns `{ text, email, crm, raw }`

**Step 8: Response Rendering (content.ts, line 923-924)**
- Receives `{ text, sections }` from background
- Calls `addOutput(s, label, content)` for each active section
- `addOutput()` (line 1023) creates output cards with:
  - Label (TEXT MESSAGE / EMAIL / CRM NOTE)
  - Content text
  - Action buttons: "Copy + Log", "Paste to CRM", or "Send to Email"

### Key Functions Reference

| Function | File | Line | Role |
|----------|------|------|------|
| `doGenerate(s)` | content.ts | 900 | Orchestrates generation from UI |
| `safeSend(msg)` | content.ts | 112 | Safe message sender with SW health check |
| `handleGenerate(payload)` | background.ts | 358 | Backend generation orchestrator |
| `buildRepContext()` | background.ts | ~330 | Reads rep profile from storage |
| `buildUserMessage()` | background.ts | ~650 | Composes full prompt string |
| `generateViaProxy()` | background.ts | 403 | HTTP POST to Railway proxy |
| `parseSections(text)` | background.ts | 697 | Regex parser for TEXT/EMAIL/CRM sections |
| `addOutput(s, label, content)` | content.ts | 1023 | Renders output card in sidebar |
| `openSidebar()` | content.ts | 617 | Creates/shows sidebar + shadow DOM |
| `closeSidebar()` | content.ts | 848 | Hides sidebar, shows pill |
| `pushContent(open)` | content.ts | 838 | Pushes VinSolutions main content with margin |
| `updateSidebar()` | content.ts | 854 | Updates customer card with scanned data |
| `scanText(text)` | content.ts | 155 | Extracts name, phone, email, vehicle from text |
| `extractVehicle(text)` | content.ts | 144 | Multi-strategy vehicle detection |
| `getDashboardScopedText()` | content.ts | 248 | Scopes text to Customer Dashboard panel |
| `getHTML()` | content.ts | 1120 | Returns full sidebar HTML structure |
| `getCSS(width)` | content.ts | 1172 | Returns full sidebar CSS |
| `attachInlineMic()` | content.ts | 520 | Wires SpeechRecognition to input + mic button |
| `compressImage()` | content.ts | 591 | Canvas-based image compression for Context Reply |
| `pasteIntoCRM()` | content.ts | 935 | Injects CRM note into VinSolutions iframe |
| `pasteIntoEmail()` | content.ts | 951 | Injects email content into VinSolutions form |

---

## 3. CONTENT SCRIPT AUDIT — FULL UI STRUCTURE

### Quick Mode Main Screen (getHTML(), line 1120)

```
HEADER: .logo "FLOQ" | .badge (platform) | #o8-close X button
#o8-quick (Quick Mode container):
  #o8-card (customer card, VinSolutions only):
    #o8-name (customer name)
    #o8-vehicle (vehicle of interest)
    #o8-meta (phone, email, source)
  .input-section:
    .chips: Message | Email | CRM Note (all ON by default)
    .input-wrap: #o8-input textarea + #o8-mic inline mic button
    #o8-generate "Generate" button
    .inline-links: Tools | Settings (inline link buttons)
  #o8-outputs (output cards container)
```

### Tools Panel (#o8-tools-panel)
- Tool tabs: Coach | Alerts | Context | Command
- Coach: textarea + mic + coach chips + "Coach Me" button + output
- Alerts: input + mic + "Set Alert" button + alert list
- Context: dropzone (paste/drag screenshot) + direction textarea + mic + "Generate Reply" button + output
- Command: textarea + mic + "Execute" button + status output

### Settings Panel (#o8-settings-panel)
- Tone: Professional / Friendly / Casual / Direct (radio buttons)
- Goal: Close the deal / Book appointment / Gather info / Nurture long-term (radio buttons)

### Sidebar Footer
- Tools button + Settings button
- TCPA compliance notice

### Pill (#oper8er-pill)
- Fixed position, default right:16px top:50%
- Text: "FQ" (expands to "Floq" on hover)
- Background: #7F77DD, border-radius 8px, z-index 2147483646
- **Draggable**: mousedown/mousemove/mouseup handlers (lines 332-365)
- Position saved to browser.storage.local (floq_pill_x, floq_pill_y)
- Click (non-drag) toggles sidebar open/close

### Sidebar Positioning (openSidebar(), line 617)
- **VinSolutions**: LEFT side, position:fixed, left:0, top:0, width:320px, height:100vh
- **Gmail**: LEFT side, bottom:0, left:0, width:280px, maxHeight calc(100vh - 200px)
- **All others**: RIGHT side, top:0, right:0, width:300px, maxHeight:100vh

### Tier Gating Status
- `currentTier` defaults to `'floor'` (line 95) but `getTier()` fetches from background
- `isFeatureUnlocked()` exists (line 104) and calls CHECK_FEATURES
- **No gate cards in UI** — all features rendered directly, no lock overlays
- Settings HTML has all radio buttons visible and functional (no locked labels)
- `doGenerate()` has comment "Demo build: no platform feature gates" (line 902)
- Effectively **all gates removed** for demo build

---

## 4. BUILD STRUCTURE (CONFIRMED CORRECT)

### manifest.json (Built Output)
| Field | Value |
|-------|-------|
| manifest_version | 3 |
| name | "Floq -- AI Sales Assistant for VinSolutions" |
| version | "1.8.1" |
| permissions | activeTab, storage, alarms |
| background | service_worker: "background.js" |
| content_scripts | Matches: vinsolutions, gmail, coxautoinc, whatsapp, facebook (messages + marketplace/t), instagram (direct), linkedin (in + messaging), messenger |
| content_scripts.all_frames | true |
| content_scripts.run_at | document_idle |
| options_ui | options.html |

### Host Permissions
- `*://*.vinsolutions.com/*`
- `*://vinsolutions.app.coxautoinc.com/*`
- `*://www.facebook.com/*`
- `*://www.instagram.com/*`
- `*://www.messenger.com/*`
- `https://api.brevmont.com/*`
- `https://mqnmemnogbotgmsmqfie.supabase.co/*`

### Web Accessible Resources
- voice.html, oper8er-intercept.js
- Matches all supported platform domains

### Build Output Files
| File | Size |
|------|------|
| content-scripts/content.js | **55,304 bytes** (correct range) |
| content-scripts/content.css | 13 bytes |
| background.js | 18,396 bytes |
| manifest.json | 1,693 bytes |
| options.html | 6,193 bytes |
| onboarding.html | 14,919 bytes |
| voice.html | 3,808 bytes |
| oper8er-intercept.js | 1,640 bytes |
| icons/ | directory (16/32/48/128 png) |
| chunks/ | directory (code-split modules) |

### package.json Scripts
- `build`: wxt build
- `dev`: wxt dev
- `zip`: wxt zip

### Dependencies
- wxt ^0.20.20, react ^19.2.4, react-dom ^19.2.4, lucide-react ^1.7.0, clsx ^2.1.1, @tailwindcss/postcss ^4.2.2
- DevDeps: typescript ^6.0.2, postcss, autoprefixer, tailwindcss, @wxt-dev/module-react, @types/chrome, @types/react, rem-to-px converter

---

## 5. MACBOOK VS PC DIFF (EXACT DIFFERENCES)

### Commit 6baa43c (MacBook, author: yancygarcia@Yancys-MacBook-Air.local)
**"v1.8.0: Draggable pill -- user positions it anywhere, saved to storage"**

Changed `entrypoints/content.ts`: +63 lines, -24 lines

**What it changed:**
1. Made `main()` async (was sync)
2. Added `safeSend()` function with service worker health check
3. Added `showReconnectBanner()` function
4. Replaced `bodyText.length > 2000` UI frame guard with proper `window !== window.top` check
5. Added `waitForReady()` async function for VinSolutions page readiness
6. Added SPA observer for Facebook/Instagram (with 8-second timeout)
7. Added stale marker cleanup for FB/IG
8. Added duplicate injection guards (`floq-sidebar`, `oper8er-host` ID checks)
9. Added pill drag logic: mousedown/mousemove/mouseup handlers
10. Added position save/restore to `browser.storage.local`
11. Added drag vs click distinction (4px threshold)

**This commit was CORRECT and was properly merged into PC at commit 3d57801.**

### Post-Merge MacBook Commits (AFTER PC was at fd2c1c5)

These 4 commits were pushed to origin/main FROM THE MACBOOK after the PC had already merged and built v1.8.1:

#### c7aa475 — v1.8.2
- Only bumped version in wxt.config.ts (1.8.1 -> 1.8.2)
- **No functional changes**

#### 99a76ae — v1.8.3
- **Changed 18 lines in content.ts, 2 in wxt.config.ts**
- **PROBLEM**: Attempted to fix "PLATFORM was undefined at module scope"
- Moved platform detection from module-level `detectPlatform()` into inline code inside `main()`
- This was UNNECESSARY — the PC version's module-scope `detectPlatform()` works fine because WXT evaluates module code after page load in content scripts

#### 5c2cbc0 — v1.8.4
- **Changed 17 lines in content.ts**
- **PROBLEM**: Tried to fix the crash that v1.8.3 introduced
- Inlined platform detection further, replacing the function call entirely
- Created a local `platform` variable shadowing the module-level `PLATFORM` constant
- **BROKE**: Any code still referencing `PLATFORM` (the module-level const) would get an undefined or stale value, while code using `platform` (the local variable) would work

#### 6739f5b — v1.8.5 (CURRENT origin/main HEAD)
- **Changed 66 lines in content.ts (41 added, 29 removed)**
- **THREE MAJOR CHANGES:**
  1. **Customer scan fallbacks**: Added 3 fallback strategies to `getDashboardScopedText()` — "Customer Dashboard" marker, "(Individual)" or "(Business)" marker, full page text
  2. **Sidebar moved to RIGHT SIDE**: Changed VinSolutions sidebar from `left:0` to `right:0, top:60px`, width from 320px to 300px, added borderLeft purple accent, rounded left corners
  3. **pushContent() gutted**: Made `pushContent()` a no-op — no longer pushes VinSolutions main content with marginLeft

**This is the DIVERGENCE. The MacBook went from left-side sidebar with content push (PC's working state) to right-side overlay with no content push.**

---

## 6. ROOT CAUSE (WHY MACBOOK FAILED)

### Primary Cause: Claude Code on MacBook autonomously rewrote working code

The MacBook ran Claude Code sessions that produced 4 cascading "fix" commits (v1.8.2 through v1.8.5) that progressively broke the working state:

1. **v1.8.3**: Claude Code "fixed" a non-existent bug (PLATFORM undefined at module scope). This was a phantom problem — the PC version's `detectPlatform()` at module scope works correctly in WXT content scripts. The "fix" introduced a real bug by shadowing the module-level PLATFORM with a local variable.

2. **v1.8.4**: Claude Code then "fixed" the crash that v1.8.3 caused by inlining platform detection further, creating TWO competing platform variables.

3. **v1.8.5**: Claude Code then changed the sidebar from LEFT to RIGHT and removed the content push entirely — a fundamental UI design change made autonomously while "fixing" customer scan issues.

### Secondary Causes

1. **No build validation**: There was no automated check that the built extension matched expected behavior after each commit. Claude Code committed and pushed without testing in Chrome.

2. **Git workflow gap**: The MacBook pushed directly to `origin/main` without a pull request or code review. The PC had no protection against remote overwrites.

3. **Cascading fix pattern**: Each Claude Code "fix" created a new bug, which prompted another "fix", which created another bug. Classic fix-forward-without-testing loop.

4. **Version bumping as debugging**: The MacBook bumped the version with every commit (1.8.2, 1.8.3, 1.8.4, 1.8.5) as a debugging tactic to force Chrome to reload the extension. This masked whether changes were taking effect.

5. **No baseline comparison**: Claude Code on the MacBook did not compare its changes against the known working PC state. It treated the MacBook as the source of truth when it was actually the follower.

---

## 7. FIX PLAN (FOR MACBOOK)

### Option A: Hard Reset MacBook to PC State (RECOMMENDED)
```bash
# On MacBook — in /Users/yancygarcia/Desktop/floq-extension/
cd /Users/yancygarcia/Desktop/floq-extension

# 1. Fetch latest from remote
git fetch origin

# 2. Hard reset to the PC's known-good commit
git reset --hard fd2c1c5

# 3. Force push to reset origin/main to PC state
git push origin main --force

# 4. Rebuild
npx wxt build

# 5. Copy build output to Chrome load path
cp -R .output/chrome-mv3/* /Users/yancygarcia/Desktop/floq-chrome-mv3/

# 6. Reload in Chrome
# chrome://extensions → Reload Floq → Cmd+Shift+R on VinSolutions
```

### Option B: Revert on Top (Preserves History)
```bash
# On MacBook
cd /Users/yancygarcia/Desktop/floq-extension

# 1. Fetch
git fetch origin

# 2. Pull to get all MacBook commits locally
git pull origin main

# 3. Revert the 4 bad MacBook commits in reverse order
git revert 6739f5b --no-edit
git revert 5c2cbc0 --no-edit
git revert 99a76ae --no-edit
git revert c7aa475 --no-edit

# 4. Push reverts
git push origin main

# 5. Rebuild and deploy (same as Option A steps 4-6)
```

### On PC After MacBook Is Fixed
```bash
cd /c/inventory_pipeline/oper8er-v2

# Pull the fix (whether force-push or reverts)
git pull origin main

# Rebuild if needed
npx wxt build
```

---

## 8. HARDENING PLAN (PREVENT FUTURE DRIFT)

### 1. Git Branch Protection
- **Never push directly to main from either machine**
- Use feature branches: `fix/sidebar-position`, `feat/customer-scan`
- Require pull request review (even self-review forces a pause to check)

### 2. Build Validation Script
Create a `validate-build.sh` that runs after every `wxt build`:
```bash
#!/bin/bash
# Check content.js size is in expected range (40-70kB)
SIZE=$(wc -c < .output/chrome-mv3/content-scripts/content.js)
if [ "$SIZE" -lt 40000 ] || [ "$SIZE" -gt 70000 ]; then
  echo "FAIL: content.js size $SIZE out of expected range"
  exit 1
fi

# Check manifest version matches wxt.config.ts
MANIFEST_VER=$(grep -o '"version":"[^"]*"' .output/chrome-mv3/manifest.json | cut -d'"' -f4)
CONFIG_VER=$(grep "version:" wxt.config.ts | head -1 | grep -o "'[^']*'" | tr -d "'")
if [ "$MANIFEST_VER" != "$CONFIG_VER" ]; then
  echo "FAIL: manifest version $MANIFEST_VER != config version $CONFIG_VER"
  exit 1
fi

# Check sidebar is on the correct side for VinSolutions
if ! grep -q "left:'0'" .output/chrome-mv3/content-scripts/content.js; then
  echo "WARNING: VinSolutions sidebar may not be on LEFT side"
fi

echo "BUILD VALIDATION PASSED"
```

### 3. Single Source of Truth Rule
- **PC is the source of truth for all Floq code**
- MacBook only pushes to feature branches
- PC merges to main after review
- Both machines pull from main before starting any work

### 4. Pre-Commit Checks
Add to `.git/hooks/pre-push`:
```bash
#!/bin/bash
# Block pushes to main that contain more than 100 line changes
DIFF=$(git diff --stat HEAD~1 -- entrypoints/content.ts | tail -1)
CHANGES=$(echo "$DIFF" | grep -o '[0-9]* insertion' | grep -o '[0-9]*')
if [ "${CHANGES:-0}" -gt 100 ]; then
  echo "BLOCKED: $CHANGES insertions to content.ts in one commit. Break into smaller commits."
  exit 1
fi
```

### 5. Version Discipline
- Only bump version when making a release, not for debugging
- Use `wxt dev` for development testing
- Version bump = intentional release, not a cache-busting hack

### 6. Environment Lock File
Create `MACHINE_STATE.md` at repo root, updated after every successful build:
```markdown
# Last Known Good State
- Machine: PC
- Commit: fd2c1c5
- Version: 1.8.1
- Build: content.js 55304 bytes
- Sidebar: LEFT for VinSolutions, RIGHT for all others
- Content push: YES (320px marginLeft)
- Date: 2026-04-04
```

---

## APPENDIX: FILE STRUCTURE (PC BUILD)

```
.output/chrome-mv3/
  background.js          (18,396 bytes)
  manifest.json          (1,693 bytes)
  content-scripts/
    content.js           (55,304 bytes)
    content.css          (13 bytes)
  chunks/                (code-split modules)
  icons/
    icon-16.png
    icon-32.png
    icon-48.png
    icon-128.png
  options.html           (6,193 bytes)
  onboarding.html        (14,919 bytes)
  voice.html             (3,808 bytes)
  oper8er-intercept.js   (1,640 bytes)
```

## APPENDIX: CONTENT.TS LINE MAP (1,236 lines total)

| Lines | Section |
|-------|---------|
| 1-7 | File header / version comment |
| 8 | CSS import |
| 10-27 | Platform detection (`detectPlatform()`) |
| 29 | `PLATFORM` constant (module scope) |
| 31-46 | `defineContentScript()` config (matches, allFrames, runAt) |
| 48-50 | main() entry, platform check |
| 52-65 | Platform booleans + output label mapping |
| 68-89 | AddNote popup receiver (VinSolutions iframe auto-paste) |
| 91-109 | State variables, `getTier()`, `isFeatureUnlocked()` |
| 111-132 | `safeSend()` + `showReconnectBanner()` |
| 134-191 | VinSolutions scanning: MAKES, STOP_WORDS, extractVehicle(), scanText() |
| 193-227 | Frame guards, readiness wait, stale marker cleanup |
| 229-294 | VinSolutions scanning: gatherAllText(), getDashboardScopedText(), attemptScan(), MutationObserver, storage polling |
| 296-301 | getSidebarWidth() per platform |
| 303-371 | Pill creation: styling, drag logic, position save/restore, hover, click |
| 373-401 | SPA observer for Facebook/Instagram re-injection |
| 403-424 | VinSolutions SPA URL observer + auto-open |
| 426-516 | Pending notes badge + panel (VinSolutions) |
| 518-588 | Inline mic (SpeechRecognition) |
| 590-606 | Image compression for Context Reply |
| 608-614 | showToast() |
| 617-836 | openSidebar() — host creation, shadow DOM, event wiring for all panels |
| 838-852 | pushContent() + closeSidebar() |
| 854-897 | updateSidebar() — customer card update |
| 899-930 | doGenerate() — generation orchestrator |
| 932-948 | pasteIntoCRM() |
| 950-1021 | pasteIntoEmail() |
| 1023-1073 | addOutput() — output card rendering |
| 1075-1082 | injectContent() — direct DOM injection for Gmail/FB/LinkedIn |
| 1084-1093 | Runtime message listeners (OPEN_COMMAND_TAB, SHOW_ALERT_BANNER) |
| 1090-1093 | parseAlertTime(), loadAlerts() |
| 1094 | esc() HTML escaper |
| 1096-1106 | getBadge() per platform |
| 1108-1118 | getSettingsHTML() — tone + goal radio buttons |
| 1120-1170 | getHTML() — full sidebar HTML template |
| 1172-1228 | getCSS() — full sidebar CSS |
| 1230-1235 | Network interception (VinSolutions oper8er-intercept.js injection) |

---

**END OF REPORT**
