# Yancy Garcia — Personal-Brand SEO Playbook

**Goal:** Make *you* (Yancy Garcia — founder of Brevmont Labs, creator of @cardogvlogs) the dominant Google result for the search **"Yancy Garcia,"** displacing the Dominican-American musician (stage name "Yancyabril") who currently owns the name.

**Date:** June 2026 · **Status:** Strategy / research-backed playbook (no code changes)

---

## TL;DR — read this first

You don't have a "post more clips" problem. You have an **entity problem**. Right now Google sees a musician as the one true "Yancy Garcia" entity (she has streaming-platform profiles, likely Wikidata, years of consistent press). Google sees *you* as a scatter of disconnected handles — @cardogvlogs here, a LinkedIn there, Brevmont over there — that it has never stitched into a single recognized person.

The whole game is: **get Google to recognize "Yancy Garcia, founder of Brevmont, automotive creator" as one distinct, corroborated entity** — then feed that entity enough durable, consistent signal that it out-accumulates the musician.

Three hard truths from the research:

1. **Your 5–7 daily clips are nearly worthless for this goal as currently used.** Short-form clips peak in 24–72 hours and Google does not durably index them. Volume on TikTok/Reels/Shorts creates *reach*, not *search authority*. You're sprinting on a treadmill.
2. **You will not win bare "Yancy Garcia" quickly.** Realistic timeline to contest a famous namesake is **12 months+**. But you can win **"Yancy Garcia Brevmont"** and **"Yancy Garcia Cardogvlogs"** in *months*, and those seed the entity that eventually contests the bare name.
3. **The single highest-leverage move is consistency + a Wikidata item** — not more content. Google rewards the same name + same title + same photo + same handle repeated across many trusted sources. Inconsistency is the #1 thing blocking you right now.

**The 5 things that matter most, in order:**
1. Build/claim a real **entity home** (an About page you control) with Person schema.
2. **Standardize your identity everywhere** — exact same name, title, photo, bio, handle. (Free. Do this week.)
3. Build the **durable content layer** you're skipping: a name-optimized **YouTube channel** + transcript **blog posts** on your own domain.
4. Create a **Wikidata item** (the lever into Google's Knowledge Graph + AI answers).
5. Earn **3–5 pieces of genuine third-party press** so the Wikidata item and entity hold up.

---

## Part 1 — Why the musician wins right now (the diagnosis)

Google has to answer "which Yancy Garcia does the searcher mean?" before it ranks anything. It picks the **dominant entity** based on three things:

- **Understanding** — does Google have clear, consistent facts about this person?
- **Credibility** — do trusted *third parties* corroborate those facts?
- **Probability** — how likely is it that a searcher means this person?

The musician wins all three: streaming platforms (Spotify/Apple Music are strong entity sources), reality-TV press coverage (The Voice Dominicana), Carnegie Hall / Apollo / Purchase College mentions, and almost certainly a Wikidata/Wikipedia footprint. She is an *entity*. You are currently a *collection of profiles*.

The canonical proof this is winnable: the **"two Danny Goodwins"** case — Google conflated an SEO editor with a same-name Hall-of-Fame baseball player for over a decade, then resolved it by systematically feeding Google consistent, corroborated, unambiguous facts. Slow, but it worked. That's exactly your path.

---

## Part 2 — The naming & positioning decision (do this before anything else)

**Stop publishing as bare "Yancy Garcia." Always pair the name with a descriptor.** This is the single most-repeated disambiguation tactic in the research.

Pick ONE canonical descriptor and use it *everywhere*, identically:

> **Yancy Garcia — Founder of Brevmont · Automotive Creator (@cardogvlogs)**

- **Two-word/branded combos are far easier to own than a bare common name.** A single common name is "nearly impossible to own" against a famous holder; a distinctive combination gives a "much stronger starting position." So your **primary, winnable targets are:**
  - `Yancy Garcia Brevmont`
  - `Yancy Garcia Cardogvlogs`
  - `Yancy Garcia car sales` / `Yancy Garcia Jackson Hole`
  - Bare `Yancy Garcia` = the long-term stretch goal, not the first objective.
- **Do NOT invent a stage name.** You'd forfeit the brand equity you've already built under "Yancy Garcia." Full real name + topic descriptor is the correct route for a founder.
- **Consider a consistent middle initial/name** if you have one (e.g., "Yancy N. Garcia") as a disambiguation tiebreaker — but only if you'll use it *everywhere* consistently. Inconsistent use is worse than not using it.

**Entity hierarchy to keep straight (this matters for schema later):**
- **Yancy Garcia** = the *Person* (parent entity). This is what must rank for your name.
- **Brevmont / Brevmont Labs** = an *Organization* you `founded` / `worksFor`.
- **@cardogvlogs, Brevmont Clips, @yancygarcia_3** = channels/handles. Link them from your hub, but the Person node is the anchor — don't dilute it.

---

## Part 3 — The owned foundation (your hub)

Everything else points back here. Without this, you're permanently renting authority on platforms you don't control.

### 3.1 The domain & hub
- **Register and use `yancygarcia.com`** as the canonical personal hub. An exact-match domain is *not* a direct ranking factor, but for a name query it aligns relevance + brand + click-through, and you own it forever. (Keep `brevmont.com` as the company site — separate entity.)
- If you'd rather not run a second site yet, you can host the entity home at `brevmont.com/about/yancy-garcia` — but a dedicated `yancygarcia.com` is cleaner for ranking *your name*.

### 3.2 Pages the hub needs
| Page | URL | Purpose | Schema |
|---|---|---|---|
| **About / Bio** | `/` or `/about` | THE page meant to rank #1 for your name. Your "entity home." | `ProfilePage` + `Person` |
| **Links** | `/links` | Your link-in-bio, on your own domain (replaces Linktree) | — |
| **Press / Featured** | `/press` | Logos + links to every mention/interview | — |
| **FAQ "Who is Yancy Garcia"** | `/about` block | Feeds AI answers + disambiguation | `FAQPage` |
| **Contact** | `/contact` | Trust + completeness | `ContactPage` |

### 3.3 The About/bio page — make it the richest result for your name
This page must be **more detailed and useful than any social profile currently outranking you.** Include:
- Full name + canonical descriptor in the **title tag** (50–60 chars) and **single H1**: e.g. `Yancy Garcia — Founder of Brevmont | Automotive Creator`.
- A real photo (same one you use everywhere), first-person story, credentials, what Brevmont is, the @cardogvlogs story, location (Jackson Hole, WY).
- Outbound links to every profile where you're active/verified.
- An explicit **"Who is Yancy Garcia?"** FAQ block (this is what AI engines lift to answer the question — and it disambiguates you from the musician).
- Embedded video (your channel trailer / "who I am" video).

### 3.4 Person schema (JSON-LD) — the technical bridge
Put this in a `<script type="application/ld+json">` block on the About page. `sameAs` is the highest-leverage field — it tells Google "all these profiles are the same person." Keep the array **tight and verified** (a bloated list of low-trust links *dilutes* entity confidence).

```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": "https://yancygarcia.com/#yancy-garcia",
  "name": "Yancy Garcia",
  "alternateName": "cardogvlogs",
  "url": "https://yancygarcia.com",
  "image": "https://yancygarcia.com/yancy-garcia.jpg",
  "jobTitle": "Founder",
  "worksFor": {
    "@type": "Organization",
    "name": "Brevmont",
    "url": "https://brevmont.com"
  },
  "founder": {
    "@type": "Organization",
    "name": "Brevmont"
  },
  "description": "Yancy Garcia is the founder of Brevmont, an AI sales assistant for car dealerships, and the automotive content creator behind @cardogvlogs. Based in Jackson Hole, Wyoming.",
  "knowsAbout": ["automotive sales", "car dealerships", "AI sales tools", "content creation"],
  "homeLocation": { "@type": "Place", "name": "Jackson Hole, Wyoming" },
  "sameAs": [
    "https://www.linkedin.com/in/yancygarcia",
    "https://www.youtube.com/@cardogvlogs",
    "https://www.instagram.com/yancygarcia_3",
    "https://www.instagram.com/cardogvlogs",
    "https://www.crunchbase.com/person/yancy-garcia",
    "https://www.wikidata.org/wiki/QXXXXXXX"
  ]
}
```
- Add `<link rel="me" href="...">` tags pointing to each profile too.
- **Reality check:** Schema does **NOT** force a Knowledge Panel (Google deprecated social-profile-markup-for-panels back in 2019 and now auto-discovers). Schema's job is **entity resolution** — helping Google merge your scattered identity into one person and become *eligible* for a panel. Don't over-expect from markup alone.
- Validate with **Google's Rich Results Test** before and after deploying.

### 3.5 Kill the Linktree
- Linktree/Beacons on a shared domain **don't rank for you and feed their domain authority, not yours.** Every click and backlink leaks away.
- Build your link-in-bio **as `yancygarcia.com/links`** and put *that* URL in every social bio. You keep all the traffic, backlinks, and entity signal on your own domain.

---

## Part 4 — Identity standardization (free, do this WEEK ONE)

This is the cheapest, highest-ROI work in the whole plan. Inconsistency across your profiles is *actively preventing* Google from recognizing you. Make every one of these identical:

- **Name field:** literally `Yancy Garcia` in the *Name* field of every platform (IG, TikTok, YouTube, LinkedIn) — not just the @handle. The name field is separately searchable.
- **Handle:** standardize on `@cardogvlogs` (and/or `@yancygarcia`) — as consistent as possible across platforms for entity consolidation.
- **Photo:** the same headshot everywhere (Google uses image consistency as an entity signal).
- **Bio:** same one-liner everywhere → `Yancy Garcia · Founder of Brevmont · Automotive creator · Jackson Hole, WY`.
- **Title:** "Founder, Brevmont" everywhere — never "CEO" on one and "founder" on another.
- **Public:** every profile must be **public** so Google can index it. A private/unoptimized LinkedIn is a wasted #1-ranking asset.

**Checklist of profiles to fix or claim:**
- [ ] LinkedIn — custom URL `/in/yancygarcia`, keyword-front headline, full About, public
- [ ] Instagram @cardogvlogs + @yancygarcia_3 — name field, bio, public
- [ ] TikTok — name field, bio
- [ ] YouTube @cardogvlogs — channel name, About section, website link
- [ ] Crunchbase — personal profile + Brevmont org page, linked together
- [ ] GitHub, Gravatar, about.me, Wellfound, F6S — claim + complete (high-authority `sameAs` targets)

---

## Part 5 — The durable content engine (fix the treadmill)

**The core fix:** keep posting daily clips for reach, but build a *durable layer underneath them* that Google actually indexes and ranks. Short-form = top-of-funnel discovery. Owned web + YouTube long-form = the searchable archive that compounds for years.

### 5.1 YouTube is your search weapon
- YouTube is the **#2 search engine**, videos rank *in Google* (25%+ of Google results show video), and it's the **#1 most-cited domain in Google AI Overviews (~23%)**. A name-optimized video can rank as its own Google result for "Yancy Garcia."
- Set up the channel for your name: custom handle, **full name in channel name + About**, link to `yancygarcia.com`, tight automotive focus.
- Make a flagship **"Who is Yancy Garcia"** / channel-trailer video stating who you are.
- **Long-form (5–10 min) is the durable asset** — it's searchable, recommended, and compounds for years. Shorts decay (YouTube deprioritizes Shorts after ~28–30 days). Channels doing *both* grow faster — use Shorts as discovery that points to long-form.

### 5.2 The weekly flywheel (this is the system)
You already produce raw material daily. Reorganize it so it compounds:

```
Daily: 5–7 clips → TikTok / Reels / Shorts          (reach — keep doing this)
            │
Weekly: bundle the best clips/topics
            ▼
        1 long-form YouTube video (5–10 min)         (durable, searchable hero)
            │  auto-transcribe (Descript / ChatGPT / TranscribeTube)
            ▼
        Clean transcript → blog post on yancygarcia.com   (THE indexable asset)
        • embed the video       • full name in title/H1
        • transcript below it   • VideoObject + Clip/SeekToAction schema
            │
            ▼
        Request Indexing in Google Search Console
            │
            ▼
        Interlink: post ↔ channel ↔ social profiles
```

- One ~30-min video ≈ ~4,500 words of indexable, keyword-rich text. That's the durable authority you're currently throwing away.
- **Video SEO on each blog post:** VideoObject JSON-LD requires `name`, `description`, `thumbnailUrl`, `uploadDate`, and one of `contentUrl`/`embedUrl`. Add `Clip` markup for chapters and `SeekToAction` so Google can deep-link to moments **on your domain**. Validate in Rich Results Test.
- **Force indexing:** don't wait for the crawler — submit each new URL via **Google Search Console → URL Inspection → Request Indexing.**
- **Tools to systematize:** Descript (transcribe + edit), Taja.AI / videotoblog.ai / Wayin.ai (clip→blog fan-out), VidSEO (WordPress transcript embeds).

### 5.3 Topical discipline
High volume only builds authority if it's **tightly themed.** Keep everything in the automotive / car-sales / dealership lane. "Long but shallow" and scattered topics earn nothing. Consistent topic + consistent identity = an eventual Knowledge Graph entity.

---

## Part 6 — Get into the Knowledge Graph (Wikidata) + AI answers

This is the lever that flips Google from "musician" to "two distinct people" — and it's how ChatGPT/Perplexity/AI Overviews learn who you are.

### 6.1 Wikidata (do this — it's attainable)
- **Wikidata feeds Google's Knowledge Graph directly** and is heavily used by ChatGPT. It's *far* more attainable than Wikipedia because eligibility is **verifiability-based, not fame-based.** You qualify if there are *serious, independent, publicly available references* that identify and distinguish you (criterion: "clearly identifiable entity describable with serious references").
- **How:** create a Wikimedia account → "Create new item" → label `Yancy Garcia`, description `American entrepreneur and automotive content creator` → add statements: `instance of (P31) → human (Q5)`, `occupation`, `employer`/founder-of → Brevmont, `country`, `official website`, social handles → **and attach a reference (source URL + retrieved date) to every statement.**
- **Critical caveat:** an item built only on your *own* profiles is weak and can be deleted. You need independent references (press, interviews, registries) for it to hold — which is why Part 7 (press) must happen alongside this. Get **2–3 genuine press pieces first**, then create the item citing them + Crunchbase.

### 6.2 Skip Wikipedia (for now)
- Entrepreneur notability is strict and tightening — requires *significant coverage in independent secondary sources*. Press releases, awards, reviews don't count. A premature article gets deleted. Revisit only after substantial real press accumulates. Wikidata first.

### 6.3 GEO — how AI engines pick you (since you found this via Google AI Mode)
Each AI engine cites different sources — target accordingly:
- **ChatGPT → skews heavily to Wikipedia/Wikidata.** → Your Wikidata item is the #1 ChatGPT play.
- **Perplexity → Reddit-dominant.** → Seed authentic Reddit presence (automotive/sales subreddits, founder communities).
- **Google AI Overviews → YouTube (~23%), Wikipedia (~18%), Reddit, LinkedIn.** → Your YouTube channel + Wikidata + LinkedIn cover this.
- **On-page, to get cited by AI:** write self-contained answer passages (~130–170 words that fully answer a question), high entity density, embedded video. The "Who is Yancy Garcia" FAQ block is built for exactly this.
- AI-referred traffic is exploding (500%+ YoY) — this channel is no longer optional.

### 6.4 Track progress
Use the **Kalicube Knowledge Graph Explorer** to check whether Google has registered "Yancy Garcia (founder)" as an entity (it shows the KGMID + confidence). Self-search "Yancy Garcia" regularly. Once a panel appears, **claim it** (Google lets you verify by logging into a profile you control, or via manual ID verification).

---

## Part 7 — Authority & digital PR (the corroboration the entity needs)

The entity and Wikidata item only hold up if *third parties* corroborate them. This is the slow, compounding work — budget 6–12 months.

### 7.1 LinkedIn (fastest, free, indexes in days)
- Custom URL `/in/yancygarcia`. Keyword-front **headline** (most-weighted field): `Founder, Brevmont | AI CRM for Car Dealerships`.
- Optimize the first 300 chars of About.
- **Publish LinkedIn articles/newsletters** — separately indexed by Google (often 24–48h), builds author-entity recognition over ~4–8 weeks of consistency.

### 7.2 Be a quoted source (earned links)
HARO is back as **Featured.com** (acquired the brand 2025); run it in parallel with **Qwoted, SOS (Source of Sources), Help a B2B Writer**. No single platform delivers volume — run 4–5.
- Realistic yield: ~20–40 pitches/month → 3–5 links, some from high-authority publications.

### 7.3 Founder interviews & podcasts
- 1–2 founder-interview podcasts/columns per month in automotive-tech / SaaS / sales niches. Each one: links to `yancygarcia.com` + cites you as "founder of Brevmont." The **recurring byline pattern** (site + LinkedIn + publications + podcasts) is itself an entity signal.

### 7.4 Automotive niche press (your unfair advantage)
- Guest columns in dealership/automotive trade media (high trust, doubles as backlink + entity source).
- **Publish original data from Brevmont's usage** — benchmark/data studies earn the most links and PR. ("How dealership reps' follow-up speed affects close rate," etc.)
- Get into niche listicles: "best AI tools for car dealers 2026."
- Realistic pace: 5–15 quality links/month, closing the authority gap in ~6–12 months.

### 7.5 Reviews & directories (helps Brevmont AND your name)
- **G2 is the AI-visibility standout** — between a third and three-quarters of review-site citations in AI answers come from G2 (4th-most-cited on ChatGPT). Get Brevmont on **G2 + Capterra + GetApp** and cultivate real, detailed reviews.
- Launch cadence: Week 1 Product Hunt → G2 + Crunchbase → Week 2 Capterra/GetApp, building review momentum.

---

## Part 8 — The roadmap (sequenced)

### Phase 0 — This week (free, foundational)
- [ ] Lock the canonical descriptor: "Yancy Garcia — Founder of Brevmont · Automotive Creator."
- [ ] Standardize name/photo/bio/handle across **every** profile; make all public (Part 4 checklist).
- [ ] LinkedIn: custom URL + keyword headline + full About.
- [ ] Register `yancygarcia.com`.

### Phase 1 — Weeks 2–6 (build the hub + durable engine)
- [ ] Launch `yancygarcia.com` with About/bio (entity home), `/links`, `/press`, FAQ, Contact.
- [ ] Add Person + ProfilePage + FAQPage schema; validate; move bio link off Linktree onto `/links`.
- [ ] YouTube channel cleanup + flagship "Who is Yancy Garcia" video.
- [ ] Stand up the weekly flywheel: 1 long-form video → transcript blog post → GSC Request Indexing.
- [ ] Claim Crunchbase (personal + Brevmont), GitHub, Gravatar, about.me, Wellfound, F6S.

### Phase 2 — Months 2–4 (corroboration + entity)
- [ ] Run Featured/Qwoted/SOS/Help-a-B2B-Writer (~20–40 pitches/mo).
- [ ] Land 2–3 founder interviews / automotive guest columns.
- [ ] Publish a Brevmont data study for PR.
- [ ] **Create the Wikidata item** (once you have ≥2–3 independent references), cite press + Crunchbase.
- [ ] Brevmont on G2 + Capterra + Product Hunt; cultivate reviews.
- [ ] **Target metric:** rank top-3 for "Yancy Garcia Brevmont" and "Yancy Garcia Cardogvlogs."

### Phase 3 — Months 4–12+ (contest the bare name)
- [ ] Keep the flywheel + PR running (consistency is the whole game).
- [ ] Monitor entity status in Kalicube Explorer; claim a Knowledge Panel when it appears.
- [ ] Seed Reddit presence for Perplexity/AIO citations.
- [ ] Reassess Wikipedia only if real press has accumulated.
- [ ] **Target metric:** appear on page 1 for bare "Yancy Garcia"; own the "founder/automotive" interpretation of the SERP and AI answers.

---

## What to measure

| Metric | Tool | Target |
|---|---|---|
| Rank for "Yancy Garcia Brevmont" / "...Cardogvlogs" | manual search / Search Console | Top 3 by month 4 |
| Rank for bare "Yancy Garcia" | manual / Search Console | Page 1 by month 12 |
| Entity recognized in Knowledge Graph | Kalicube KG Explorer | KGMID exists |
| Pages indexed | Google Search Console | All hub + blog URLs |
| Referring domains | Ahrefs / Search Console | +5–15/month |
| "Who is Yancy Garcia?" in ChatGPT/Perplexity/AI Mode | manual | Returns *you* (founder), not only the musician |

---

## Honest expectations & risk flags

- **Beating a famous namesake for a bare name is a 12-month+ effort**, and #1 is not guaranteed — the musician has strong streaming-platform and likely Wikipedia/Wikidata entities. The *realistic, high-probability* wins are the branded combos and owning the "founder/automotive" interpretation. Treat bare-name #1 as the stretch goal.
- **Wikidata items on thin sourcing get deleted.** Don't create it until you have genuine independent references. Self-published profiles alone won't hold.
- **Schema does not summon a Knowledge Panel** — it aids entity resolution and eligibility only. Don't expect markup alone to do it.
- **Consistency beats volume, every time.** One more inconsistent profile hurts you; one more *consistent* corroborating source helps. The musician's edge is years of consistent signal — your job is to out-consistency her, not out-post her.
- Several stats in the underlying research (CTR lifts, "Xx faster growth," AI-citation percentages) are vendor/case-study sourced — directionally reliable, not guarantees. The *mechanics* (entity resolution, Wikidata→Knowledge Graph, transcripts/schema, identity consistency, short-form ephemerality) are well-corroborated across multiple independent sources.

---

*Compiled from multi-source web research (Search Engine Land, Search Engine Journal, Ahrefs/Moz syntheses, Google Search Central, schema.org, Wikidata, Kalicube, Backlinko, G2, and others), June 2026. This is strategy guidance, not a guarantee of ranking outcomes.*
