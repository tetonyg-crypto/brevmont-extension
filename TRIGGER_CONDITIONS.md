# Brevmont Extension — UI Trigger Conditions

Code archaeology output (Phase 8 WS11, 2026-05-07). Source-of-truth for
when each interactive surface becomes visible. Reference for writing
synthetic UI tests against the extension.

## PLATFORM detection (entrypoints/content.ts:38)

`PLATFORM` derives from `window.location.href` substring match:

| URL contains | PLATFORM | Notes |
|---|---|---|
| `vinsolutions` OR `coxautoinc` | `vinsolutions` | Primary surface |
| `mail.google.com` | `gmail` | Secondary |
| `messenger.com`, `facebook.com/messages`, `marketplace/t/` | `facebook` | |
| `linkedin.com` | `linkedin` | |
| `instagram.com/direct` | `instagram` | |
| `web.whatsapp.com` | `whatsapp` | |
| anything else | `unknown` (script returns early) | |

If `PLATFORM === 'unknown'` the script returns at line 49 — no DOM injection.

## `#brevmont-pill` (the floating BM badge)

Created at content.ts:1080. Style includes
`visibility:'hidden', opacity:'0'` initially (`// Hidden until positioned`).

Becomes visible only when `updatePillPosition()` (line 1200) finds an
anchor element via `findPanelSeamX()` (line 1100). Called:
- Once on script load (line 1256)
- ResizeObserver on body (line 1259)
- `resize`/`fullscreenchange` window events (1261-1262)
- Every 1000 ms via `addInterval` (line 1263)

`findPanelSeamX()` strategies (matches ANY one):
1. `#customerListScrollBarHolder`, `#scrollBarHolder`, `.scrollBarDiv`,
   or `[id*="ScrollBar"]`/`[class*="scrollBar"]` with width <20px and
   height >100px
2. Any `div` with width 4-12px AND height >300px AND `left` between
   200-900
3. `#cardashboardframe` iframe with `#leftpaneframe` inside
4. `#mainAreaPanel` with width 100-70%vw
5. `h1`-`h6` text starting with `Customer Dashboard`, walking up 5
   parents until finding one >200×200
6. `#cardashboardframe` (any width >100)

If none match, `findPanelSeamX()` returns `null` and the pill stays
hidden. The mock fixture at `tests/mock-vinsolutions/customer-detail.html`
has none of these — explains why the previous WS11 attempt couldn't
get the pill visible.

**Easiest mock-side fix:** add a `<div id="mainAreaPanel" style="width:600px;height:400px"></div>`
to the fixture. Strategy 4 matches.

## Generate buttons — popup-window only

The pill+sidebar surface is for the MAIN customer page. Generate
buttons live on SEPARATE popup windows that VinSolutions opens for
each composition surface. Content script branches on URL substring
(content.ts:882-903):

| URL contains | Button injected | Anchor element | Selector ID |
|---|---|---|---|
| `sendemail.aspx` OR (`communication` AND `email`) | Email | CKEditor `iframe.cke_wysiwyg_frame` (or fallback iframe selectors) | `#brevmont-email-generate` |
| `logcallv2` OR `logcall` | Call note | Largest `<textarea>` on page | `#brevmont-callnote-generate` |
| `rims2` AND (`texting` OR `vinwfetexting` OR `textmessage`) | Text message | Textarea | `#brevmont-text-generate` |

After injecting the button, the script `return`s — no pill/sidebar is
mounted on popup pages.

### Email generate button (line 469)
- Waits 2.5s after script load for CKEditor to mount
- Searches for an iframe via several CKEditor selectors
- Falls back to any blank-src iframe with `contentEditable=true` body
- If no editor iframe found, button is **not** injected

### Call-note generate button (line 695, full impl 716)
- `findNotesField()` returns the largest `<textarea>` on the page
- If no textarea, error logged and `return` (no button)
- Button inserted as previous sibling of the textarea
- Click handler reads customer name from
  `[id*="customer"], [id*="CustomerName"], [id*="name"], .customer-name, h1, h2`
- Sends `GENERATE_OUTPUT` SW message with `type: 'crm'`
- Writes response into the textarea + dispatches `input`/`change`/`blur`

### Text-message generate button (line 789)
Similar to call-note: textarea-anchored, click → SW message → output
back into textarea.

## What this means for synthetic testing

**Path 1 (no extension code change required):** modify the mock
fixture to include the right anchor elements per surface.

For pill on the main customer page:
```html
<div id="mainAreaPanel" style="width:600px;height:400px;
     position:relative;left:300px"></div>
```

For call-note generate button — minimal mock (URL must contain `logcall`):
```html
<h1 id="customer-name">Test Customer Alpha</h1>
<div>Vehicle: 2024 Ford F-150</div>
<textarea id="call-notes" rows="20" cols="100"></textarea>
```

For email generate — much harder (requires CKEditor iframe stub).
Skip for now; call-note path is the simpler signal.

## What synthetic input WORKS

The button click handlers do NOT check `event.isTrusted`. Standard
Playwright `.click()` works on the buttons once they're injected.

The internal `notesField.dispatchEvent(new Event('input', {bubbles:true}))`
calls in the handler are fired BY the extension on the textarea after
generation — not consumed FROM the textarea. So the test doesn't need
to fake trusted user input.

## What synthetic input WOULD FAIL (CDP-required)

None of the trigger conditions for pill/buttons require trusted events.
Testing the pill+sidebar interaction (open sidebar → see customer
data) likewise doesn't gate on `isTrusted`. Path 2 (CDP) not needed.

## What WOULD require Path 3 (test hatch)

If a future feature adds an `event.isTrusted` check to the pill click
or generate button click, OR if the seam-detection changes to require
Cox-native iframe.contentWindow access (cross-origin), then a
`?brevmont_test=1` URL param hatch would be the cleanest fix. Today
this is not needed.

## Closing note

This document was reverse-engineered from `entrypoints/content.ts` in
2026-05-07. Update it whenever the trigger logic changes — the test
suite depends on these invariants.
