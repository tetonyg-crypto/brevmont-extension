# Email Reply System — Research & Brainstorm

**Date:** 2026-06-12  
**Author:** BREZ (research only — no code written, nothing deployed)  
**Status:** Pre-build. Yancy reviews, decides scope, gives go-ahead before any work starts.

---

## URGENT FLAG — Act Before Reading the Rest

**Supabase "Oper8er" org payment failure.** Card ending 8479 was declined for invoice
LNSCVD-00005 ($25.00 due). Supabase is warning of pending shutdown. This kills the
entire Brevmont backend if not resolved.

Email arrived: 2026-06-12 at 13:08 UTC. Subject: "[Supabase] Action Required: Payment
Failure And Pending Shutdown"

Direct pay link (from the email): `https://invoices.withorb.com/view?token=IkhlZnhWWXlHY0V3U2lTNmUi.rm4iQO1T8fv2z6TIoULXilJS3og`

Fix it at: `https://supabase.com/dashboard/org/bhbdsovmcqewzqsyuork/invoices`

This email is sitting unread in `founder@brevmont.com`. The email reply system would have
caught this immediately and flagged it with no draft (billing = suppressed sender). This
is exactly the kind of thing the system prevents.

---

## Section 1: What Already Exists

### What BREZ found in the codebase and the live inbox

**1. Gmail MCP connection is already live.**

The `mcp__16fae5ca-3bdf-4fc9-b24a-ff8f732bf99f` tools in this session are a fully
functional Gmail API integration pointed at `founder@brevmont.com`. OAuth tokens are
already provisioned and working — this session searched threads, read full email bodies,
and listed drafts using live data. This is the single biggest shortcut in this document.
The authentication layer for reading Gmail already exists.

What this means for build: Phase 1 does not need a new OAuth setup for the read side.
It needs only a `gmail.send` scope addition to the existing credentials to enable
sending.

**2. `pending-emails` endpoints exist on the proxy.**

`background.ts` references three live proxy endpoints:
- `POST /api/pending-emails` — saves an email draft (body: dealer_token, rep_name,
  customer_name, subject, body)
- `GET /api/pending-emails` — fetches saved drafts by dealer_token
- `PATCH /api/pending-emails/{id}` — marks a draft as applied

These are currently used by the Chrome extension to stage emails written during CRM
sessions. They share the same Supabase persistence pattern needed for inbox drafts. The
schema may need a few columns added (sender, thread_id, status), but the endpoint
skeleton exists.

**3. Sender noise filter already written.**

`background.ts:153` and `sidepanel/main.ts:278` both carry a blocklist regex:

```
/(?:brevmont\.com|onboarding@|no-?reply|donotreply|mailer-daemon|
mailchimp|sendgrid|twilio|stripe|google calendar|calendly|resend|
postmark|mailgun)/i
```

This is reusable as the first-pass noise filter for inbound mail. Copy it into the email
worker, add Uber/LinkedIn/Reddit to the list, done.

**4. Telegram founder-ping infrastructure exists.**

`background.ts:389-407` pings the proxy at `/api/v1/extension-loaded` on install/update,
which sends a Telegram notification to Yancy. The proxy already knows how to post to
Telegram. The missing piece is a bidirectional bot (callbacks for APPROVE/EDIT/SKIP),
which does not exist yet.

**5. JWT auth infrastructure is solid.**

`lib/authSigning.ts` implements `signedFetch()` with JWT bearer token refresh and a 45s
timeout. Any new email worker on the proxy uses the same auth pattern — no new
authentication layer needed.

**6. The draft-staging workflow already exists manually.**

The four podcast pitch drafts sitting in Gmail (found during research) use a
`[STAGED DRAFT — before sending: ...]` convention. Yancy already thinks in
draft-and-review. This system formalizes that pattern and moves the staging surface to
Telegram instead of Gmail's compose window.

**7. Prior attempt: "Serena inbox" task (2026-05-18)**

An email from `support@brevmont.com` was found in the inbox titled "Task for Serena —
wire up support@brevmont.com inbox before MX." It was sent on 2026-05-18 with urgency
("leaving for Mexico City in 2 days"). Unknown whether this shipped. The `brevmont-api`
repo was not accessible from this environment. Before building Phase 1, check whether
any email polling worker already exists in `brevmont-api/src/` or `brevmont-api/scripts/`.

**8. Live inbox volume: 201 threads in 7 days.**

Breakdown from today's scan:
- ~80% automated noise (Uber, LinkedIn, newsletters, Reddit, TikTok)
- ~5% billing/SaaS alerts (Supabase, 1Password, Loom, Atlassian)
- ~10% Brevmont platform emails (onboarding confirmations, pilot activations)
- ~5% actual business email requiring a reply (dealer outreach responses)

At this ratio, a noise filter reduces the draft queue to roughly 3-10 emails per day
that actually need Yancy's attention. That's a manageable Telegram drip.

**What does NOT exist:**
- No IMAP/Gmail polling worker in the proxy
- No inbound email webhook
- No Telegram bot with callback buttons (APPROVE/EDIT/SKIP)
- No `gmail.send` scope in current OAuth credentials
- No per-sender relationship memory

---

## Section 2: Inbound Architecture Options

### Comparison table

| Option | Setup complexity (1-5) | Reliability | Monthly cost | What Yancy must do | Risk to existing flows |
|--------|----------------------|-------------|-------------|-------------------|----------------------|
| **A. Gmail API polling** | 2 | High | $0 (free tier) | Re-authorize OAuth with send scope | None |
| **B. Gmail API push (PubSub)** | 4 | Very high | ~$0-2 (PubSub) | GCP project + PubSub topic setup | Low |
| **C. Resend inbound webhook** | 2 | High | $0 (included) | DNS MX for subdomain only | None to existing |
| **D. IMAP polling** | 3 | Low | $0 | App-specific password per account | Medium (deprecated) |
| **E. Cloudflare Email Workers** | 4 | High | ~$5/mo | MX change for brevmont.com | High (breaks Gmail routing) |

### Detail on each option

**A. Gmail API polling** — preferred for Phase 1

Polls `GET /gmail/v1/users/me/messages?q=is:unread in:inbox` every 2 minutes via a
Railway cron job. Uses the same OAuth credentials already connected in this session.
Each new message is fetched in full, run through the noise filter, then queued for draft
generation if it passes.

Pros: zero new infrastructure, auth already proven, works for `founder@brevmont.com`
today.  
Cons: 2-minute latency before Yancy sees a notification. Not a problem for email — nobody
expects sub-minute email response times.

OAuth requirement: add `https://www.googleapis.com/auth/gmail.send` to the existing
scopes. Yancy re-authorizes once, refresh token stored in Railway env vars.

**B. Gmail API push notifications** — Phase 2 upgrade

Gmail can push change notifications to a Google Cloud PubSub topic the moment a new
message arrives. The PubSub subscription forwards to a Railway webhook endpoint.
Zero-latency. Requires GCP project with PubSub enabled.

Pros: real-time, no polling, more efficient.  
Cons: requires GCP project setup (15-minute task but Yancy has to do it), and PubSub
watch expires every 7 days requiring a renewal call.

Not needed for Phase 1. Polling at 2 minutes is fine.

**C. Resend inbound webhook** — complementary, Phase 2

Resend routes emails sent to `@reply.brevmont.com` (or similar subdomain) to a webhook
endpoint. Cold email campaigns (run via Instantly on `yancy@brevmontlabs.com`) can set
`Reply-To: replies@reply.brevmont.com`. When a dealer replies to a cold email, it lands
in the webhook instead of Instantly's inbox.

Requires: one DNS TXT record + one MX record for the subdomain only. Does not touch
`brevmont.com` main MX records. Does not affect `founder@brevmont.com` Gmail routing.

This is the clean path for Instantly campaign replies. Keep Instantly's inbox for its
own analytics; route real human replies to the approval system.

**D. IMAP polling** — skip

Google deprecated password-based IMAP for new OAuth apps. Requires app-specific
passwords (another credential surface). Strictly worse than the Gmail API. Not worth it.

**E. Cloudflare Email Workers** — skip

Would require routing `brevmont.com` MX records through Cloudflare instead of Google
Workspace. This breaks Gmail for `founder@brevmont.com`. Not worth the disruption.

### Recommended architecture

**Phase 1**: Gmail API polling on `founder@brevmont.com` only, every 2 minutes.  
**Phase 2**: Add Resend inbound webhook for `reply.brevmont.com` (cold email replies).  
**Phase 3**: Optionally upgrade to Gmail PubSub push notifications.

`yancy@brevmontlabs.com` (Instantly) — leave in Instantly. Instantly handles reply
detection and sequence stopping. Routing those replies through this system before
Instantly processes them creates race conditions.

`007yancygarcia@gmail.com` — personal. Phase 2 or Phase 3 at earliest. Significant
noise. Yancy decides.

`tetonyg@gmail.com` — Railway/dev alerts. Noise only. Skip.

---

## Section 3: Draft Generation

### Model choice

| Email type | Model | Reason |
|-----------|-------|--------|
| Noise classification (is this worth drafting?) | Haiku 4.5 | Fast, cheap, binary output |
| Business draft (dealer, partner, press) | Sonnet 4.6 | Quality/cost balance |
| High-stakes (investor, legal-adjacent, first contact with paying customer) | Sonnet 4.6 with longer context | Same model, more context budget |
| Manual only (legal threats, contracts, pricing negotiations) | None — pause and flag | No draft generated |

Sonnet 4.6 is the right call here. Opus is overkill for email drafts and the cost
difference is real at volume. Haiku for the noise gate keeps costs near zero.

Token cost estimate at current volume (5-10 real emails/day):
- Noise filter: 10 emails/day × ~300 tokens = 3,000 tokens/day (Haiku: negligible)
- Draft generation: 5 emails/day × ~1,500 tokens in + ~300 tokens out = ~9,000 tokens/day (Sonnet 4.6: ~$0.03/day)

Total at current scale: well under $1/month. Scales linearly with email volume.

### Voice encoding

**Dependency flag**: the locked-copy registry task must be complete before this goes
live. The voice rules must come from the registry, not from CLAUDE.md or this doc —
both drift. Once the registry exists, the proxy reads voice rules from
`vertical_config` or a dedicated `voice_registry` table at call time.

Until the registry exists, the system prompt encodes these rules directly:
- No em-dashes
- No exclamation points
- No banned words (list TBD in registry)
- Founder-floor voice: direct, brief, no corporate softening, no AI smell
- Sentences ≤ 20 words where possible
- First line is never a compliment or greeting formality

These rules are stored in the proxy's DB, not in the worker code. One SQL update changes
Yancy's voice across all future drafts without a code deploy.

### Context windowing strategy

What gets fed to Claude per draft:

```
System: [voice rules] + [relationship tag for sender if known]
User context:
  - Email subject
  - Thread: last 3 messages (stripped of HTML, quoted text collapsed)
  - Sender info: display name, email, last 5 exchanges if any
  - Yancy's profile: founder of Brevmont, 26.8M in car sales, building vertical AI
    for dealerships
```

Max context budget: ~2,000 tokens per call. Thread rarely exceeds this for real
business emails.

For threads longer than 10 messages: summarize the first N messages with Haiku
before sending to Sonnet. Store the summary in `email_contacts.thread_summary`.

### Per-sender relationship memory

A lightweight `email_contacts` table in Supabase:

```
sender_email TEXT PRIMARY KEY
display_name TEXT
relationship_tag TEXT  -- e.g. "dealer", "investor", "press", "cold"
last_exchanges JSONB   -- last 5 [{ date, direction, snippet }]
do_not_auto_draft BOOL -- manual override per sender
```

Populated automatically when emails pass the noise filter. After 3 exchanges with the
same sender, the last 2 are included in Claude's context for all future drafts.

This is the one feature that makes the system feel like Yancy has been paying attention.

### Sensitive content gate (no auto-draft)

Pause auto-draft and send a raw-forward to Telegram with no generated reply:

- Subject contains: pricing, contract, NDA, legal, lawsuit, cease, refund, cancel,
  unauthorized, attorney, liability
- Body contains: dollar amounts ($X,XXX or $XX,XXX), threats, "I'm going to", "we intend
  to"
- Sender is new (no prior exchange history) AND email is longer than 400 words
- Any attachment (do not process attachments in Phase 1)

For flagged emails, Telegram message reads:

```
🚨 [founder@brevmont.com]
From: [sender]
Subject: [subject]
Flagged — no draft generated.

Reason: [sensitive keyword match]

Snippet: "[first 3 lines]"

[VIEW FULL] [SKIP]
```

Yancy handles these manually.

---

## Section 4: Approval UX

### Telegram message format

```
📧 founder@brevmont.com
From: Janell Keller <janell@infinitiofbellevue.com>
Re: spoke with Isaac
Received: 18:25 today

---
THEIR MESSAGE:
"Hi

Not at this time thank you"

---
DRAFT REPLY:

Janell, fair enough. If anything changes on your end, I'd be happy to
reconnect. The reps find it most useful for follow-up texts after a test
drive — happy to send a short clip if that's ever useful.

Yancy
brevmont.com

---
[✅ APPROVE]  [✏️ EDIT]  [⏭️ SKIP]
```

Notes on format:
- Their full message shown (stripped of HTML and previous quoted text)
- Draft shown in plain text, no markdown formatting in the email body
- Signature always included in draft (Yancy, brevmont.com)
- No Telegram message for noise-filtered emails

### Button flows

**APPROVE:**
1. Proxy calls Gmail API send endpoint with the draft
2. Email marked as replied in `email_inbox` table
3. Thread in Gmail gets `brevmont-replied` label applied
4. Confirmation to Telegram: "Sent to Janell at 18:31."

**EDIT:**
1. Bot responds: "What should I change?"
2. Yancy types or voice-notes a plain instruction: "make it shorter, skip the clip offer"
3. Proxy calls Claude with: original draft + Yancy's instruction + "rewrite accordingly"
4. New draft posted to Telegram, same APPROVE/EDIT/SKIP buttons
5. Edit loop can repeat up to 3 times before BREZ flags: "Still working on this one —
   want to write it manually?"

**SKIP:**
1. Thread marked `skipped` in `email_inbox`
2. Optionally archives the thread in Gmail (adds ARCHIVED label, removes INBOX)
3. Optional skip reason logged (just for pattern detection later)
4. No confirmation message to Telegram unless Yancy has requested summaries

### Multi-email queue handling

Emails are queued in arrival order, processed one at a time via Telegram. If 3+ emails
are waiting while Yancy is away:

Digest message sent first:
```
📬 3 emails waiting for review:
1. Janell Keller — "Re: spoke with Isaac" (dealer)
2. Sean Bradley — "Re: Dealer Synergy guest" (press)
3. billing-support@supabase.com — "[Supabase] Action Required" (FLAGGED)

Reply "1", "2", or "3" to jump to that one, or "start" to go in order.
```

Supabase billing alert and similar flagged items always surface at the top regardless of
arrival order.

### Priority sender list

Configurable via Telegram command: `/priority add sean@dealersynergy.com`

Priority senders jump the queue. All others process in FIFO order.

Pre-populated priority list (Yancy confirms before Phase 1):
- Any `@dealership.com` / dealer domain that has replied before
- `sean@dealersynergy.com` (first paying customer reference)
- Any thread with `support@brevmont.com` in the chain

### Sender suppression

`/suppress noreply@uber.com` — adds to blocklist, never generates draft again.

The existing filter regex in `background.ts` seeds the suppression list. Additions
persist to `email_suppression` table in Supabase.

---

## Section 5: Security + Sent Folder Sync

### The sent-folder question

When the system sends a reply, Yancy needs a record in his Gmail Sent folder. Two paths:

| Path | Appears in Sent? | Complexity | SPF/DKIM |
|------|-----------------|-----------|---------|
| **Send via Gmail API** (`users.messages.send`) | Yes, automatically | Low | Google handles it |
| Send via Resend, IMAP-append to Sent | Yes, but fragile | High | Resend's DKIM |
| Send via Resend only | No | Low | Resend's DKIM |

**Recommendation: Gmail API send scope.** Add `https://www.googleapis.com/auth/gmail.send`
to the existing OAuth credentials. One re-authorization. Emails sent through the system
appear in Sent automatically. SPF/DKIM is handled by Google Workspace, same as when
Yancy sends manually. No deliverability risk.

This is the only path worth taking. Resend-only sending creates a parallel sent folder
problem. IMAP append is a maintenance nightmare.

### OAuth scope inventory

Current (proven working): `gmail.readonly` (implicit — read access used in this session)  
Needed for Phase 1: `gmail.send`  
No other scopes needed.

The refresh token must be stored securely in Railway environment variables, not in code
or Supabase. A leaked refresh token gives full read/send access to Yancy's inbox.

### PII handling

- `email_inbox` table stores: thread_id, sender_email, sender_name, subject, body_text,
  received_at, status, draft_id
- `email_drafts` table stores: draft_body, generated_at, model_used, prompt_tokens,
  approved_at, sent_message_id
- No email bodies in Railway logs (mask before logging)
- Retention: email_inbox rows deleted after 90 days; email_audit rows kept 1 year
- RLS on both tables: dealer_token scoped (Yancy's personal token)

### Audit log

`email_audit` table:
```
id UUID PRIMARY KEY
thread_id TEXT
sender_email TEXT
action TEXT  -- 'drafted' | 'approved' | 'edited' | 'skipped' | 'flagged'
instruction TEXT  -- Yancy's edit instructions if action = 'edited'
sent_message_id TEXT  -- Gmail message ID after send
approved_at TIMESTAMPTZ
model TEXT
prompt_tokens INT
completion_tokens INT
```

Every approve/edit/skip writes a row. This is the record if a draft ever needs to be
traced.

### Kill switch

Telegram command: `/pause-email`  
Sets `email_worker_paused = true` in `system_config` Supabase table.  
Worker checks this flag at the start of every polling cycle and exits early if paused.  
Resume: `/resume-email`  
No code deploy, no Railway restart needed.

---

## Section 6: Phased Build Plan

### Phase 1 — Minimum viable (estimated: 4-6 days for BREZ)

**Goal:** One inbox, one approval flow, send on approval, everything logged.

**Scope:** `founder@brevmont.com` only. No Resend inbound. No per-sender memory.

**Components:**
1. Railway cron worker (`email-poller`) — polls Gmail every 2 minutes, runs noise
   filter, queues new emails in `email_inbox`
2. Draft generator — picks up `status='new'` rows, runs Haiku noise gate, then Sonnet
   draft, writes to `email_drafts`
3. Telegram bot with callback buttons (APPROVE/EDIT/SKIP) — new bot or extended FORGE
4. Gmail API send on APPROVE — writes sent_message_id back to `email_audit`
5. Supabase tables: `email_inbox`, `email_drafts`, `email_audit`, `system_config`
   (kill switch)

**Infra changes:**
- Gmail OAuth re-authorization with `gmail.send` scope (5 minutes, Yancy does this)
- New Railway service for the poller (BREZ handles deployment)
- 3 new Supabase tables (BREZ handles migrations)
- Telegram bot token (Yancy creates bot via BotFather, pastes token to BREZ)

**What Yancy must do himself:**
- Re-authorize Gmail OAuth (one link, one click)
- Create Telegram bot via BotFather, share token
- Confirm priority sender list before go-live
- Review and approve first 10 drafts manually before enabling APPROVE (trust calibration)

**What BREZ handles:**
- All code, Railway deploy, Supabase migrations
- Seeding noise filter from existing `background.ts` regex
- Voice rules as interim hardcoded system prompt (until registry exists)

**Dependency:** Voice registry task must exist OR Yancy approves hardcoded interim rules.

---

### Phase 2 — Multi-inbox + sender memory (estimated: 2-3 days for BREZ)

**Goal:** Add cold-email reply routing and per-sender context.

**Additions:**
- Resend inbound webhook for `reply.brevmont.com` (Yancy adds one DNS record)
- `email_contacts` table with last 5 exchanges per sender
- Priority sender override: `/priority add [email]` Telegram command
- Sender suppression: `/suppress [email]` Telegram command
- Digest message for queued email batches

**What Yancy must do:**
- Add MX record for `reply.brevmont.com` subdomain (DNS change, ~5 min)
- Update Instantly campaign `Reply-To` to `replies@reply.brevmont.com`
- Set `007yancygarcia@gmail.com` monitoring preference (in or out)

---

### Phase 3 — Sensitive content guards + audit hardening (estimated: 2 days for BREZ)

**Additions:**
- Full sensitive content classifier (keyword + length + sender-age heuristics)
- `email_audit` table complete with token counts and model tracking
- Reply SLA alert: if an email sits unactioned for 4+ hours, Telegram re-pings
- Gmail PubSub push notifications (replaces 2-minute poller — optional upgrade)
- `/pause-email` and `/resume-email` kill switch

**No Yancy input required** other than confirming SLA threshold (default: 4 hours).

---

## Section 7: Open Questions for Yancy

**Q1: Which inboxes to monitor in Phase 1?**

Options:
- A. `founder@brevmont.com` only (recommended — already proven, lowest risk)
- B. `founder@brevmont.com` + `007yancygarcia@gmail.com` (adds personal inbox, high noise)
- C. All four inboxes from day one

Recommendation: A. Start with `founder@brevmont.com`. The other inboxes can be added in
Phase 2 after trust in the system is established. The personal Gmail noise ratio is very
high and would flood the Telegram queue before filters are tuned.

---

**Q2: New Telegram bot or extend the existing FORGE bot?**

Options:
- A. New dedicated bot (`@BrevmontMailBot`) — clean separation, approval flow doesn't
  mix with FORGE alerts
- B. Extend FORGE bot — everything in one place, fewer bots to manage

Recommendation: A. The approval flow requires interactive callback buttons and a
conversation state machine (waiting for edit instructions, looping on revision). Mixing
that state into the FORGE bot creates collision risk. A dedicated bot is cleaner to build
and easier to pause without affecting FORGE.

---

**Q3: Is the locked-copy voice registry complete?**

Phase 1 can ship with an interim hardcoded voice prompt (the rules from CLAUDE.md, fixed
for the first month). But Yancy needs to decide: accept interim rules, or block Phase 1
on the registry task?

Recommendation: Accept interim rules. The rules won't drift in 30 days. Add a TODO
comment in the proxy code and swap in the registry call when it's ready.

---

**Q4: What is the acceptable draft quality bar before APPROVE goes live?**

Recommendation: BREZ runs the system in "shadow mode" for 3 days first — it generates
drafts and posts them to Telegram but APPROVE doesn't send. Yancy reviews 20-30 drafts
and gives a thumbs up/down rating. Once pass rate hits ~80%, APPROVE goes live. This
catches voice rule misses before anything goes to a real dealer.

---

**Q5: Should the system auto-skip Brevmont platform emails?**

The inbox currently receives its own onboarding confirmation emails (e.g., "Your Brevmont
pilot is active for AXIO Auto"). These come from `onboarding@brevmont.com`. They should
be auto-suppressed — no draft needed.

Confirmation: yes or no to adding `onboarding@brevmont.com`, `support@brevmont.com`, and
`noreply@brevmont.com` to the suppression list by default?

Recommendation: yes.

---

## Section 8: Risks and Failure Modes

### Risk 1: OAuth token expiry — silent failure

The Gmail OAuth refresh token can expire if it is revoked, if Google detects suspicious
activity, or if the OAuth app's verification status changes. When it expires, the worker
stops pulling email with no visible error to Yancy.

Mitigation: The worker writes a heartbeat timestamp to `system_config` after every
successful poll. A separate health-check (or the existing Brevmont heartbeat system)
alerts Yancy if the poller has not run in >10 minutes.

### Risk 2: Claude drafts something wrong to a real dealer

The entire system requires Yancy's explicit APPROVE. Nothing sends without his tap.
This is the primary safety mechanism. The system cannot draft-and-auto-send.

However: Yancy is human. He approves things quickly when he's in the flow. A bad draft
that looks good at a glance gets approved.

Mitigation: the shadow mode period (Q4 above) catches systematic voice rule failures
before the system goes live. After go-live, the edit loop catches individual bad drafts.
Sending a mediocre reply is not a catastrophic failure — it's the cost of every reply
system. The bar is "better than no reply" not "better than Yancy at his best."

### Risk 3: Supabase shutdown (already happening)

The Oper8er org payment failure is live right now. If Supabase shuts down that
organization, the `pending-emails`, `pending-notes`, and other tables go offline. This
breaks not just the future email system but the existing extension.

Mitigation: fix the payment today. Separate from this research task.

### Risk 4: Railway outage

The poller goes offline. Emails arrive, none are processed. They pile up in Gmail unread.

Mitigation: when the worker restarts, it processes the backlog in FIFO order. The queue
simply drains. No emails are lost. Yancy gets a burst of Telegram notifications but
nothing is skipped.

The SKIP button prevents the queue from growing indefinitely — if Yancy skips the
backlog, they're archived and gone.

### Risk 5: Telegram throttling or bot blocked

Telegram rate-limits bots to 30 messages/second, 20 unique chats/minute. Not a concern
at this volume (5-10 emails/day). However, if Telegram blocks the bot (rare but possible
if the bot is reported as spam), the approval surface goes dark.

Mitigation: all drafts are also saved to `email_drafts` in Supabase. A fallback web UI
(single-page, locked behind Yancy's auth) shows pending drafts if Telegram is unavailable.
This is Phase 3 scope.

### Risk 6: Gmail send rate limit

Google Workspace free tier: 500 emails/day outbound. At 5-10 approved emails/day, this
is not a constraint. If Brevmont scales to a team, the limit scales with the Workspace
plan.

### Risk 7: Dealer replies to the system-sent email and the reply goes to a different address

When the system sends via Gmail API, replies come back to `founder@brevmont.com`. That's
the right behavior — it keeps threads consolidated. No risk here.

---

## Summary

**The shortest path to Phase 1:** Gmail OAuth re-auth (add send scope) + Railway
poller + Telegram bot with callback buttons + Gmail API send. All the scaffolding exists.
Estimated build time: 4-6 days for BREZ once Yancy gives the go-ahead and provides the
Telegram bot token.

**The one thing that can delay everything:** the Supabase payment failure (see top of
document). Fix it before any infrastructure work starts.

**The one dependency that should not be worked around:** the locked-copy voice registry.
Use interim rules for Phase 1 with a clear swap-in plan. Do not ship Phase 2 without the
registry.

No code was written. No infrastructure was changed. This document is the input to a
decision — build scope, phase order, and the five open questions above.
