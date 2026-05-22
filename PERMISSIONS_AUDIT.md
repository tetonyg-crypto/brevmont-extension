# Brevmont Chrome Extension — Permissions Audit

**Audience:** Dealership IT / security review.
**Extension version covered:** 1.10.1.
**Last updated:** 2026-04-29.

This document explains every Chrome permission and host the Brevmont extension requests, why it requests it, what data it touches, and what data it does *not* touch. It is intended to be defensible to a dealership IT director, a CISO, or a Cox Automotive vendor-review team.

---

## Summary

Brevmont reads what the rep is already looking at inside their CRM and helps them write the next message. It does not exfiltrate customer data, does not read other browser tabs, does not access saved passwords, and does not phone home with anything other than telemetry that has been PII-scrubbed before it leaves the browser.

All credentials Brevmont needs (license key, rep token) are issued by Brevmont through a signed-in browser session at `app.brevmont.com`. The extension never sees a password.

---

## API permissions

### `activeTab`
**What it grants:** read access to the DOM of the currently-focused tab, only after the user explicitly invokes Brevmont (clicks the sidebar pill, opens the popup, etc.).

**Why we need it:** Brevmont reads the customer name, vehicle, and conversation context from the CRM page the rep is actively working in, then generates a message that goes back into the same form they just left. There is no background tab scraping.

**What it does not grant:** access to other open tabs, browser history, bookmarks, downloads, or any tab the user has not focused.

### `storage`
**What it grants:** local key-value storage scoped to the extension.

**Why we need it:** persist the dealership's license key, the rep's auth token, the GM's onboarding selections (dealership name, doc fee, sales tax), and a small queue of unsent telemetry events for offline replay.

**What it does not grant:** access to website cookies, localStorage, or sessionStorage outside the extension's own bucket.

### `alarms`
**What it grants:** schedule periodic background tasks.

**Why we need it:** Manifest V3 service workers idle out within seconds. Brevmont needs `alarms` to fire a 5-minute heartbeat that keeps the dealership marked "live" in the admin dashboard and to flush the telemetry queue every 30 seconds.

**What it does not grant:** any data access. It is a timer primitive.

### `cookies`
**What it grants:** read and write cookies on hosts listed in `host_permissions`. In practice Brevmont only ever **reads** the `brevmont_rep_session` cookie from `*://*.brevmont.com/*` and only during the first install after the rep clicks `/join/<dealership_id>`.

**Why we need it:** the rep arrives at the install page from a Brevmont-issued OAuth flow. The cookie they got there is what tells the extension which dealership and which rep this install belongs to. Reading the cookie once at install lets the rep skip the legacy 4-step setup wizard. Without this permission a rep would have to copy-paste a long token by hand.

**What it does not grant:** cookies from any host outside `host_permissions`. Brevmont does not read CRM cookies, Google cookies, or any third-party site cookies. The extension cannot exfiltrate auth state from VinSolutions, Gmail, or any other site the rep uses.

---

## Host permissions

Each entry below explains why the host is in the list and what Brevmont does on that host. If a host is not listed, the extension cannot read or modify any page on it.

### `*://*.vinsolutions.com/*` and `*://vinsolutions.app.coxautoinc.com/*`
**Purpose:** core product surface. Brevmont injects a sidebar that reads the customer record the rep is on and writes generated messages back into the CRM's email/text/note compose fields.
**Reads:** customer name, vehicle of interest, conversation history visible on screen.
**Writes:** the message body, subject line, and call note the rep just generated.
**Does not touch:** other reps' customer records, billing data, F&I data, finance reserve numbers, or anything outside the active customer detail page.

### `*://mail.google.com/*`
**Purpose:** email compose generation when reps follow up customers from their Gmail.
**Reads:** the email thread the rep is replying to (subject, last message body).
**Writes:** the draft body of the reply.
**Does not touch:** other emails, contacts, attachments, drive files, or any non-active thread.

### `*://www.facebook.com/*`, `*://www.messenger.com/*`, `*://www.instagram.com/direct/*`, `*://www.instagram.com/direct/t/*`, `*://www.linkedin.com/*`, `*://web.whatsapp.com/*`
**Purpose:** DM-channel generation for dealerships whose reps work leads in messaging apps in addition to or instead of CRM.
**Reads:** the active conversation thread the rep is replying in.
**Writes:** the message draft.
**Pilot-phase note:** these surfaces are scoped behind a feature flag. If a dealership's IT policy prohibits extension access to social/messaging sites, the dealership-level feature flag turns the channel off and the extension stops reading those hosts entirely. The host permission stays declared in the manifest because Chrome cannot ask for it later without triggering a re-review prompt for users who already installed.

### `*://*.brevmont.com/*`
**Purpose:** read the `brevmont_rep_session` cookie from `app.brevmont.com` once at install (see `cookies` above) and call the install-handoff endpoint.
**Does not touch:** any other Brevmont domain content. The rep does not need to be signed in to any Brevmont property other than the cookie that was already set at /join.

### `https://api.brevmont.com/*`
**Purpose:** the only outbound endpoint Brevmont talks to. All AI generation, telemetry, heartbeat, and license validation route through this proxy. The Anthropic API key and system prompt live on this proxy, not in the extension.
**What goes outbound:** generated message metadata (workflow type, platform, success boolean, timestamp), error events with PII-scrubbed messages, and heartbeat pings carrying license key + extension version + Chrome version.
**What does NOT go outbound:** customer names, customer emails, customer phone numbers, VINs, dealership financial data, or any free-text the rep typed. PII is scrubbed at the boundary by `entrypoints/lib/pii.ts` before any telemetry payload is queued.

---

## What the extension never has access to

- Other reps' customer records (the rep can only see what their CRM session lets them see).
- Browser-saved passwords.
- Banking, credit, or F&I data fields (no host permission for credit-bureau or financing portals).
- The rep's personal email, social, or messaging accounts when not on a Brevmont-active page.
- Any tab the rep is not currently focused on.
- Network traffic from other extensions or other browser windows.

---

## Data handling at the proxy

Every payload that leaves the extension hits `api.brevmont.com`. That proxy:

1. Verifies the dealer token signature using HMAC-SHA256.
2. Applies per-dealership rate limits.
3. Forwards to Anthropic for generation.
4. Logs metadata (timestamp, workflow type, platform, dealership_id, success/error) to Supabase Postgres in the dealership's tenant scope.
5. **Does not store** raw customer text, generated message bodies, or any free-form payload longer than 90 days. Generation logs are purged on a rolling window.

Telemetry events written to Supabase are filtered by the same PII scrubber documented in `entrypoints/lib/pii.ts`: emails, phone numbers, SSNs, credit-card-shaped digits, VINs, bearer tokens, and 32+ character hex blobs are replaced with `[EMAIL]`, `[PHONE]`, etc. before insert.

---

## Chrome Web Store status

Brevmont is published on the Chrome Web Store under extension ID `onbnhkpggamfbnjdaelgimgimcchamah`. Customer installs should use the official listing. The signed bundle path remains only for support diagnostics and legacy fallback.

---

## Contact

Permissions or security questions: `founder@brevmont.com`. The founder reads every reply and responds within one business day.
