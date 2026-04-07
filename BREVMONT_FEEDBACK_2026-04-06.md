# Brevmont Extension Feedback — April 6, 2026 (Monday)
## Source: Live customer use at the dealership

### BUG-004 (P1) — Pill animation lag
Pill jumps left/right on interaction after rebrand commit.
Suspect: CSS transition on left/right properties instead of transform.
Fix: use transform + will-change, audit position reflow.
File: entrypoints/content.ts, getCSS() pill section

### FEAT-001 (P0) — VinSolutions email popup injection
Email button opens new Chrome window at /CarDashboard/Pages/LeadManagement/sendemail.aspx
Currently requires copy-paste from sidebar into popup.
Apollo extension solves this.
Fix: verify host_permissions covers popup URL, scope duplicate guard to window,
inject "Generate with Brevmont" button directly into email compose toolbar,
auto-populate To/Subject/Body fields.
File: manifest.json, entrypoints/content.ts

### FEAT-002 (P0) — CRM note exceeds character limit
Generated notes are too long for VinSolutions CRM note field (cutoff visible).
Fix 1: Tighten proxy prompt — max 240 chars, format "ACTION | OUTCOME | NEXT STEP"
Fix 2: Add character counter under generated CRM note in sidebar
Files: proxy prompt config, entrypoints/content.ts sidebar

### FEAT-003 (P1) — Log Call popup injection
Call log button opens new Chrome window at /CarDashboard/Pages/LeadManagement/LogCallV2/LogCallV2.aspx
Same pattern as email popup.
Fix: shared popup injection logic with email fix. Generate call note, auto-fill textarea.
File: entrypoints/content.ts

### What works well
- Lead detection and name extraction
- Message (SMS) generation quality
- CRM note injection on main dashboard
- Context tab (after BUG-002 fix)
- Voice mic (after BUG-003 fix)

### Strategic note
FEAT-001 (email popup injection) is the deal-closer for the Friday demo.
Current pitch: "faster messages." With popup injection: "your reps never
touch the keyboard for email or call notes." That's 10x more valuable.
Apollo charges $49-$99/rep/month partly because of this pattern.
Ship this before Friday.

## Changelog
- 2026-04-06: Initial feedback from live dealership use
