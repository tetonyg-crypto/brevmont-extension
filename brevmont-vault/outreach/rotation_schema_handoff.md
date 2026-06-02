# Outreach Tool — Variant Rotation + Schema Handoff (for Serena)

**Date:** 2026-06-02
**From:** Yancy / Brevmont outreach
**Context:** The LinkedIn outreach tool in the admin dashboard currently stores one locked message. We're moving to 5 rotating openers (see `dm_variants_v2.md`) so we can A/B/C/D/E test reply rates and kill the losers.

---

## What changes for the user (Yancy's flow)

1. Yancy types a prospect's **first name** into the tool.
2. He hits **Copy**.
3. The tool fills `[first]` into the **current variant in the rotation**, copies the full message to clipboard, and logs the send.
4. The rotation pointer **advances to the next variant** (A → B → C → D → E → A …) so each copy serves a different opener.
5. Yancy pastes into LinkedIn and attaches the product video manually.

This keeps the 5 messages evenly distributed and stops LinkedIn from flagging identical-template blasts.

---

## Rotation logic

- **Even round-robin** across the 5 active variants. Pointer is global per outreach campaign, persisted server-side (not per-browser-session) so it survives reloads.
- Only variants flagged `active = true` are in the rotation. Killing a loser = set `active = false`; the pointer skips it.
- Each **Copy** writes one `outreach_sends` row and stamps `variant_used` with the variant served.

---

## Schema

Extend the existing `outreach_sends` table from the outreach tool prompt with the three new columns called out below.

```sql
-- existing outreach tool schema (from original prompt) + NEW variant tracking
CREATE TABLE outreach_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_name text NOT NULL,           -- first name typed by Yancy
  platform      text DEFAULT 'linkedin',
  sent_at       timestamp DEFAULT now(),

  -- NEW: variant tracking for A/B/C/D/E testing
  variant_used  text NOT NULL,           -- 'A' | 'B' | 'C' | 'D' | 'E'
  replied       boolean NOT NULL DEFAULT false,
  replied_at    timestamp                -- nullable; set when a reply lands
);

-- supporting table so a variant can be killed without code changes
CREATE TABLE outreach_variants (
  variant     text PRIMARY KEY,          -- 'A'..'E'
  body        text NOT NULL,             -- full message with [first] token
  active      boolean NOT NULL DEFAULT true
);
```

New columns being added to `outreach_sends`, per the task:

| Column | Type | Notes |
|--------|------|-------|
| `variant_used` | text | Which opener was served — `A`/`B`/`C`/`D`/`E`. |
| `replied` | boolean | Default `false`. Flip to `true` when the prospect replies. |
| `replied_at` | timestamp | Nullable. Timestamp of the reply. |

---

## Marking replies

Replies are logged manually for now (Yancy or whoever works the inbox flips the flag in the dashboard):

```sql
UPDATE outreach_sends
SET replied = true, replied_at = now()
WHERE id = $1;
```

(Later we can auto-detect via LinkedIn inbox, but manual is fine to start.)

---

## Reporting: reply rate per variant

After **50 sends (≈10 per variant)**, run the report so Yancy can kill low performers:

```sql
SELECT
  variant_used,
  count(*)                                            AS sends,
  count(*) FILTER (WHERE replied)                     AS replies,
  round(100.0 * count(*) FILTER (WHERE replied)
        / nullif(count(*), 0), 1)                     AS reply_rate_pct
FROM outreach_sends
GROUP BY variant_used
ORDER BY reply_rate_pct DESC NULLS LAST;
```

**Decision rule:** at 50 sends, kill the bottom 2 variants (`active = false`), keep the top 3 in rotation, and let it keep running. Re-check at the next 50.

---

## Acceptance checklist for Serena

- [ ] `outreach_sends` has `variant_used`, `replied` (default false), `replied_at` (nullable).
- [ ] `outreach_variants` seeded with the 5 bodies from `dm_variants_v2.md`, all `active = true`.
- [ ] Copy action: fills `[first]`, copies to clipboard, inserts a send row with `variant_used`, advances the round-robin pointer.
- [ ] Pointer persists server-side and skips `active = false` variants.
- [ ] Dashboard control to flip `replied` / set `replied_at`.
- [ ] Reply-rate-per-variant report wired to the query above.

---

## Variant bodies to seed (`outreach_variants.body`)

> Full text in `dm_variants_v2.md`. Tokens use `[first]`.

- **A (industry insight) — June batch:** "Hey [first], wth happened to May. Everybody blames the market, but it's really a follow-up problem. So I built a tool for it. Your rep says one line about a customer and it writes the follow-up text, the email, and the CRM note. Quick video below. Worth a look?"
  - _Time-boxed: swap "May" → "this month" once May's close isn't fresh anymore so the seed never reads dated._
- **B (shared pain):** "Hey [first], how many leads did your guys let go cold last month cause nobody followed up? I built a tool for that. Rep says one sentence about a customer and it writes the follow-up text, the email, and the CRM note. Made a video, free to use. Curious what you think?"
- **C (question):** "Hey [first], real question, what's killing your close rate right now, the traffic or the follow-up? I built a tool for the follow-up part. Rep says one line and it writes the text, the email, and the CRM note. Got a quick video. Thoughts?"
- **D (controversy):** "Hey [first], hot take, most CRMs are just expensive note-takers. None of them write the follow-up for your guys. So I built one that does. Rep says one sentence and it writes the text, the email, and the CRM note. Short video below. Tell me I'm wrong?"
- **E (compliment):** "Hey [first], been watching how your store moves units, your floor can clearly sell. Bet the follow-up is the leaky part. I built a tool for it. Rep says one line and it writes the text, the email, and the CRM note. Quick video here. Worth a peek?"

**Default launch variant: A.** Seed the rotation pointer to start at A.
