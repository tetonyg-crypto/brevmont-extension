# Agent-to-Agent Commerce & What It Means for Brevmont

**Author:** BREZ (research + strategic analysis)
**Date:** 2026-06-05
**Status:** Intelligence memo. No build proposed. Truth over reassurance.

**Sourcing caveat (read first):** Several primary pages — `dmc-12.ai`, the Car Dealership Guy (CDG) article, Google's own UCP pages, and most vendor sites — returned **HTTP 403** to automated fetching. The DMC-12 *spec* was read directly from raw GitHub files (the authoritative source for the protocol). Everything else attributed to those 403'd pages comes from search-engine extractions cross-checked across 2+ independent renderings. Claims that rest on a single source, or on an interested party's estimate, are flagged inline. Treat exact quotes as "as rendered by search," not as a full-page read.

---

## 1. Executive Summary (the "so what" for Yancy)

1. **It's real, it's small, and it's early.** The first publicly-known AI-agent-to-AI-agent car deal happened at Mark Miller Subaru (Salt Lake City) and was reported by CDG on 2026-05-22. The operator's own estimate: ~0.5% of auto volume, "like internet deals in the late 1990s." That number is a credible-party guess, not a measured stat.
2. **DMC-12 is a genuinely well-built open spec but has near-zero traction** — 2 GitHub stars, 3 dead forks, one dealership running it, and even *that* dealership keeps the negotiation tools turned **off**. It's one sharp GM's proof-of-concept, not an adopted standard (yet).
3. **The buyer-side agent wave is more real than the seller-side protocol.** CarEdge has logged 100k+ AI-to-dealer negotiations and DIY open-source agents (OpenClaw) are getting consumers $4k under sticker. This is the part that actually moves.
4. **The biggest near-term threat to Brevmont is NOT agent commerce. It's the CRM you ride on.** VinSolutions (Jan 2026) and DealerSocket/Solera (Feb 2026) now natively auto-draft follow-ups *and* auto-capture activity — the exact "capture every touch for the GM" job Brevmont does. That's a 12–24 month threat; agent-to-agent is a 3–7 year one.
5. **The macro winds favor our thesis** ("Year of the Human," salespeople measurably improving, 90%+ still visit the showroom, single-store relationship deals rising) — **but the venture and incumbent money is betting the other way** ("AI handles 80%, human closes").
6. **Recommendation: MONITOR + SHARPEN NARRATIVE. Do not reposition, do not build toward agents yet.** The trend gives us a sharper story ("agents are coming for the easy deals — your reps have to win the rest"). The thing to actually defend against is CRM-native capture, not DMC-12.

---

## 2. What DMC-12 / Agent Commerce Actually Is (plain English)

### The deal that started this
Chris Hudson, GM of Mark Miller Subaru, was "tinkering with AI tools" and used a **CarEdge buyer-side AI agent to negotiate against his own sales team without telling them.** His staff spent ~4 hours working a deal with a machine; neither salesperson realized it. He then ran an **agent-to-agent** sale (a buyer agent transacting against his dealership's agent surface) and, after checking with CarEdge that nobody had seen one before, CDG ran it as the "first publicly known" agent-to-agent car deal on 2026-05-22.
- https://news.dealershipguy.com/p/first-publicly-known-agent-to-agent-car-deal-goes-down-in-salt-lake-city-2026-05-22
- https://www.threads.com/@cardealershipguy/post/DYxjXVsEgrs/

### DMC-12 the protocol
Out of that, Hudson and a colleague (Ben Reuling) published **DMC-12** — "Automotive extensions to the Universal Commerce Protocol." It's the car-dealership-specific vocabulary that generic agent-commerce protocols lack: VIN-level inventory, 30-minute price quotes, soft reservations/holds, itemized pricing disclosure, negotiation policy, and live hand-off to a human sales manager. MIT-licensed, repo `mm-open/dmc-12`, current **v0.5 (2026-05-29)**. The name is the DeLorean from *Back to the Future*.
- https://raw.githubusercontent.com/mm-open/dmc-12/main/README.md
- https://raw.githubusercontent.com/mm-open/dmc-12/main/SPEC.md

**The tools.** The spec names **11 methods**; the homepage markets a "**14**-tool canonical surface" (the difference is read-tools vs. partner-tools vs. negotiation-tools counted across trust tiers):
`search_inventory`, `list_inventory`, `request_quote`, `get_negotiation_policy`, `submit_offer`, `submit_counter_offer`, `accept_offer`, `reject_offer`, `create_reservation`, `deal_handoff`, `get_pricing_disclosure`.

**The negotiation capability** (`submit_offer` / `submit_counter_offer` / `accept_offer` / `reject_offer`) lets a buyer agent make a priced offer on a VIN; the dealer sets a per-VIN policy — `fixed` (no haggling), `stepwise` (bounded counter rounds), or `bestoffer` (single shot, accept iff ≥ reserve). A hard rule in the spec: negotiation rounds **must be evaluated deterministically, with no LLM in the loop.**
- https://raw.githubusercontent.com/mm-open/dmc-12/main/capabilities/negotiation.md

**Important reality check:** On Mark Miller's own live deployment, the four negotiation tools are **not registered** and the negotiation capability is **not advertised**. So in the only known production instance, the most provocative part of DMC-12 (price haggling) is **switched off**. (dmc-12.ai homepage, via search extraction.)

### MCP vs A2A vs UCP — and where DMC-12 sits
- **MCP (Model Context Protocol, Anthropic):** how an agent connects to a server and learns "what tools exist here." The plumbing between an agent and a set of tools/data. https://www.anthropic.com/news/model-context-protocol
- **A2A (Agent2Agent, Google → Linux Foundation):** how one agent identifies and talks to *another* agent (signed "Agent Cards"). Agent-to-agent, not agent-to-tool. https://developers.googleblog.com/en/google-cloud-donates-a2a-to-linux-foundation/
- **UCP (Universal Commerce Protocol, Google):** the *commerce* layer — a shared language for discovery, cart, checkout, payment across retailers. https://ucp.dev/

**DMC-12 is a UCP extension, delivered over MCP and A2A transports.** It serves `.well-known` discovery docs (`/.well-known/mcp`, `/.well-known/agent-card.json`, `/.well-known/ucp`), uses OAuth 2.1, and a user can paste its MCP URL into Claude, ChatGPT Connectors, Cursor, or Gemini and have the tools auto-discovered. It explicitly *is* a UCP extension (not merely "aligned").

### "Keeping CRM stats clean" — what that means operationally
Dealership KPIs — lead counts, response times, close rates, comp — are computed off CRM lead records. If thousands of automated agent inquiries land as "leads," they distort every metric and misroute human follow-up labor. DMC-12's **two-rail trust model** (consumer agents get 5 read-only tools; named partners can transact) lets the dealer **route agent traffic into a separate "agent relationship management" lane** instead of the human CRM pipeline. Hudson calls the roadmap a "frictionless middle." This is the single most strategically relevant idea in DMC-12 for us (see §6) — it's a *lane-separation* concept, and Brevmont owns the human lane.

---

## 3. Landscape Map (players, traction, timeline)

### Seller-side protocol (the dealer's agent surface)
| Thing | What it is | Traction (June 2026) |
|---|---|---|
| **DMC-12** | Open auto extension to UCP | **Thin.** 2 stars, 3 forks (no push activity), 1 live dealer, negotiation disabled, 1 press hit (CDG). One GM's PoC. |

### Buyer-side agents (the part that's actually moving)
- **CarEdge AI Negotiator** — founded by Ray & Zach Shefska (2020), ~$10M revenue, ~$4M raised. The agent creates a **protected alias email/phone**, contacts dealers directly, and negotiates price + fights add-on fees. Its public report shows **103,937 negotiations / 900,337 dealer touches as of 2026-05-23**, ~$1,000 average savings, ~$40/mo. Described (by Hudson) as the only third-party *buyer-side* AI agent. **Caveat: a "negotiation" is an engagement thread, not a completed sale.**
  - https://caredge.com/reports/ai-negotiation-impact
  - https://fortune.com/2025/09/10/this-30-year-old-ceo-says-his-ai-negotiator-can-successfully-haggle-down-the-price-of-a-car-by-thousands-of-dollars/
- **OpenClaw (was Clawdbot → Moltbot)** — open-source, self-hosted persistent agent; reportedly 60k+ GitHub stars. Aaron Stuyvenberg documented it negotiating **~$4,200 under sticker** across 8–10 dealers while he was in a meeting. The DIY path that needs no CarEdge subscription.
  - https://aaronstuyvenberg.com/posts/clawd-bought-a-car
  - https://mikemason.ca/writing/ai-negotiation-agents-jan-2026/
- **General LLMs (ChatGPT ~68% of AI car-shoppers, then Gemini/Perplexity)** — mostly used for *research and negotiation prep*, not autonomous deal-making. https://ekho.com/blog/2026-ai-vehicle-research-study-how-buyers-are-using-chatgpt-and-other-ai-tools-to-find-their-next-vehicle/

### The horizontal protocol stack (context, not auto-specific yet)
- **UCP (Google)** — launched at NRF 2026 (Jan 11), co-developed with Shopify; **Walmart, Home Depot, Visa, and Amex** are among 20+ endorsers (verified across secondary sources; Google's own page 403'd, so exact "co-dev vs endorse" tier per company is not primary-verified). Partially live in Google AI Mode / Gemini. https://fourweekmba.com/google-launches-universal-commerce-protocol-at-nrf-2026-the-new-standard-for-ai-shopping/
- **ACP (OpenAI + Stripe)** — the rival commerce standard; powers ChatGPT "Instant Checkout." https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- **AP2 (Google), Visa Intelligent Commerce / Trusted Agent Protocol, Mastercard Agent Pay** — the payment/identity rails underneath. Card networks completing first live agentic transactions in late 2025.
- **No horizontal protocol names automotive as a launch vertical.** Auto agentic commerce is being driven by vertical vendors (Cox/Tekion), advancing in *parallel* to UCP/ACP, not yet formally wired to them.

### Timeline (analyst-grounded)
- **2026** = infrastructure-laying year (every protocol launched 2025–26; checkout going live in ChatGPT/Gemini).
- **Gartner:** by **2028**, 60% of brands using agentic AI for 1:1 interactions; AI agents outnumber sellers 10×. **McKinsey:** $3–5T global consumer commerce via agentic payments **by 2030.**
- **Auto specifically lags** the curve — high-ticket, locally-fulfilled, negotiation- and financing-heavy, trade-in-laden. Even bullish horizontal numbers imply "still early innings for cars."

### Pressure-testing "0.5%, like the late-90s internet"
**Verdict: directionally plausible, substantively soft.** It's one dealer-evangelist's estimate (he's promoting both his protocol and CarEdge's tool) with no published methodology. The *direction* is defensible — CarEdge engagements grew ~10k → 104k in ~8 months. The *level* is almost certainly tiny in actual closed sales (the SLC deal was news *because* it was a first). Counter-signals: dealers are blacklisting automated negotiators, broker-detection is easy, and 86–90% of buyers still want to see/buy the car in person. Most "AI car buying" today is **ChatGPT research, not autonomous purchase.**

---

## 4. Hudson / Mark Miller Subaru — Operator Profile

- **Who:** **Chris (Christopher) Hudson**, General Manager of **Mark Miller Subaru Midtown + South Towne** (Salt Lake City / Sandy, UT). 20+ years in auto retail; came from Austin Subaru / Subaru of Georgetown (TX); NCM GM Executive Program credential. Co-built DMC-12 with **Ben Reuling** (credited "AI Systems Engineer"; listed elsewhere as the dealership's *Staff Accountant* — i.e., an existing internal employee, not an outside AI hire).
  - https://www.abc4.com/gtu/mark-miller-subaru-welcomes-new-general-manager-of-midtown-and-south-towne-locations/
  - https://www.linkedin.com/in/chris-hudson-5b5937102/
- **The store:** Mark Miller Auto Group — family-operated Utah dealer since 1919 (Subaru since 1971), **3 rooftops** (2 Subaru + 1 Toyota). Nationally known in dealer circles for **one-price / "Promise Pricing" transparency selling**; already a CDG-featured exemplar (reps average 14–16 units/mo, 30–45 min deals). CEO is **Jeff Miller** (the group's public/podcast face — *not* Hudson).
  - https://news.dealershipguy.com/p/mark-miller-subaru-s-three-strict-rules-for-successful-one-price-selling-2025-09-18
- **His footprint:** thin personally — a standard LinkedIn, no talks, no other published tools. His influence is **project-driven** (DMC-12) and amplified by landing on CDG (the most influential independent voice in US auto retail). The dealership has also **posted a dedicated "AI Agent Engineer" job**, signaling it's institutionalizing in-house building.
  - https://www.tealhq.com/job/ai-agent-engineer_7ea1ae9e1b49dcf963ce62ac4e7aae421669f

**Assessment (labeled analysis, not fact): one-off genius or signal?** A **leading indicator, not yet a trend.** The signal that matters isn't the deal — it's that **a non-engineer GM + an internal accountant shipped production agent infrastructure in ~a month using off-the-shelf LLM tooling and open protocols.** That's the buy-vs-build cost curve shifting. The most forward-leaning slice of our ICP may start assembling thin layers on MCP/UCP rather than buying closed point tools. *But* the population of GMs willing and able to do this today is very small, and even this exemplar leaned on two vendors' rails (CarEdge + Google/UCP). Weight it as an early warning, not a present danger.

---

## 5. Threats to Brevmont (ranked, honest, with timelines)

**#1 — CRM-native capture + auto-drafting absorbs our core job. (Timeline: 12–24 months. Severity: HIGH. This is the real one.)**
This is the threat that actually hurts us, and it has nothing to do with agent commerce. **VinSolutions (Cox) shipped an agentic "Virtual Assistant" in Jan 2026** that autonomously texts/emails leads *and* **"creates tasks, appointments and updates notes autonomously"** — the exact "capture every touch for the GM" value prop, done by the system of record with no rep in the loop. **DealerSocket/Solera announced the same at NADA Feb 2026.** VinSolutions is *Brevmont's primary host platform.* The system of record doesn't need a Chrome extension to capture activity — it owns the database.
- https://www.coxautoinc.com/insights/cox-automotive-advances-dealer-workflows-with-unified-inventory-sourcing-and-ai-automation/
- https://www.solera.com/blog/2026/02/03/solera-announces-landmark-ai-investment-and-major-dealersocket-crm-upgrade-ahead-of-nada-show-2026/
*Our defenses:* cross-platform reach the CRM AI can't touch (Gmail, Messenger, LinkedIn, IG, WhatsApp); rep-as-author (human voice) vs. the CRM's autonomous-replacement framing; CRM-agnostic overlay (works on Elead/CDK too). But the gap narrows every NADA cycle.

**#2 — Autonomous AI-BDC vendors shrink the manual-follow-up population. (Timeline: 1–3 years. Severity: MEDIUM-HIGH.)**
Impel ("full customer engagement agent — handles the first 80%"), Conversica, **Toma** (a16z-backed, "replacing phone staff"), Numa. The market consensus is "**AI handles 80%, human closes.**" Every rep whose follow-up is handled by an autonomous BDC is a rep who doesn't need Brevmont to type. Note the venture money is concentrated here.
- https://impel.ai/blog/a-new-era-for-automotive-dealerships-and-oems-through-agentic-ai/
- https://techcrunch.com/2025/06/05/tomas-ai-voice-agents-have-taken-off-at-car-dealerships-and-attracted-funding-from-a16z/

**#3 — Buyer-side agents erode the human-negotiation surface. (Timeline: 3–7 years. Severity: MEDIUM, rising.)**
If buyers increasingly let CarEdge/OpenClaw negotiate, the commodity, price-shopping deal needs less human selling. That deal type is exactly the *easy* one. Today it's ~0.5% and friction-laden (in-person preference, dealer blacklisting). The slope, not the level, is the concern.

**#4 — A protocol/CRM absorbs the "lane separation" idea. (Timeline: 2–5 years. Severity: MEDIUM.)**
DMC-12's "route non-human contacts to a separate lane" is conceptually adjacent to "capture every human touch." If a CRM vendor builds both an agent lane *and* a human-activity lane natively, the structural room for an overlay shrinks. Today DMC-12 itself is too small to be this threat; a Cox/Tekion productization would be.

**Realistic worst case:** 3–5 years out, VinSolutions/DealerSocket make rep-side capture+drafting a native checkbox, autonomous BDCs own the nurture, and the human rep is reserved for the high-touch close where they type less and talk more — collapsing the daily-typing pain Brevmont removes. **Most-likely case is softer and slower:** native CRM AI stays single-platform and replacement-flavored, leaving the cross-platform, human-author, CRM-agnostic wedge intact for years — *if* we move up-market from "types faster" toward "the system of execution for the human lane."

---

## 6. Opportunities for Brevmont (ranked, realistic)

**#1 — Sharper narrative: "Agents are coming for the easy deals. Your reps have to win the rest." (Timeline: now. Confidence: HIGH.)**
This trend hands us a content/sales story that is *true and well-supported*: as commodity/price-shopper deals peel toward agents and digital retail (online-only NPS has cratered toward ~0 while dealership-buyer satisfaction holds; single-store relationship visits rose 32%→44% 2023→Feb 2026; salespeople measurably improving per CDK), **the deals left for humans are higher-touch — making rep execution matter MORE, not less.** ASOTU CON 2026's theme was literally "Year of the Human." This is a narrative we can own immediately without building anything.
- https://www.cdkglobal.com/insights/cdk-releases-2026-friction-points-study
- https://www.automotivemastermind.com/blog/uncategorized/year-of-the-human-at-asotu-con-2026-how-dealers-use-ai-to-win-without-losing-the-human-touch/

**#2 — Reframe Brevmont as "the system of execution for the human lane." (Timeline: now, positioning only. Confidence: HIGH.)**
DMC-12 gives us a *borrowed frame*: dealers will increasingly think in two lanes — an **agent lane** (machine inquiries) and a **human lane** (relationship selling). Brevmont is the execution + capture layer for the human lane, the way DMC-12 is the routing layer for the agent lane. This is a positioning upgrade from "drafts texts fast" to "the operating layer that makes every human touch happen and shows the GM the floor in real time." It future-proofs us against the "you just save typing" critique.

**#3 — The human lane stays the majority for years — defensible runway. (Timeline: multi-year. Confidence: MEDIUM-HIGH.)**
~90% of buyers still visit the showroom; ~49% explicitly want in-person dealership contact; complex deals (financing, trade-in, high consideration) keep a human attached. The other 99.5% (Hudson's own framing) protects the rep-execution layer for the foreseeable future. We don't need agent commerce to fail — we need the human lane to stay large, and the data says it will.

**#4 — Future integration angle: sit next to the agent lane. (Timeline: 2–4 years. Confidence: LOW-MEDIUM — assess, don't chase.)**
If lane-separation becomes standard (DMC-12 or a CRM productizes it), there *could* be a real play: Brevmont as the human-execution layer that a dealer runs alongside its agent surface, capturing the human follow-up while the agent lane handles machines. This is plausible but speculative and dependent on the agent lane actually scaling. **Do not build toward it now; watch for the trigger** (a second/third dealer adopting DMC-12, or Cox/Tekion shipping a human/agent lane split).

**#5 — "Capture every touch" becomes more valuable as channels fragment. (Timeline: now. Confidence: MEDIUM.)**
As reps work leads across more surfaces (and as some channels go agent), the GM's need for a *unified, cross-platform* view of human activity grows. The CRM's native capture is single-platform; ours isn't. Lean into the cross-platform capture story.

---

## 7. Positioning Implications (what to change, what to hold)

**HOLD (do not touch the locked positioning):**
- **Human rep as the asset.** The data backs it (Year of the Human, rising salesperson satisfaction, showroom-visit majority). Don't blink.
- **Rep-execution layer, not autonomous agent.** Our contrarian bet (humans handle the relationship, AI handles the typing) is differentiated precisely *because* the market is piling into autonomous replacement. Hold the line.

**SHARPEN (evolve the language, same thesis):**
- Add the **two-lane frame**: "agent lane vs. human lane; Brevmont is the system of execution for the human lane." It absorbs the trend instead of being threatened by it.
- Add the **"agents take the easy deals, reps win the hard ones"** narrative to content/sales. It's true, sourced, and timely.
- Move the emphasis from "drafts messages fast" (commoditizing — VinSolutions now does it) toward **"every human touch captured, the whole floor visible to the GM in real time, on any platform."** The capture + visibility + cross-platform story is harder for a single-CRM vendor to copy than the drafting story.

**DO NOT:**
- **Do not reposition as an agent-commerce company.** The seller-side protocol (DMC-12) has no traction and the space is being defined by Google/OpenAI/Cox — not a lane for us.
- **Do not build a DMC-12 implementation or a buyer/seller negotiation agent.** Premature; off-thesis; would confuse the brand.
- **Do not lean the core pitch on "we draft your texts."** That's the commoditized layer. Lead with capture + GM visibility + cross-platform.
- **Do not dismiss the CRM-native threat as far-off.** It's the closest one. Plan product depth (cross-platform capture, GM real-time floor view) that a single-CRM AI can't match.

---

## 8. Recommended Stance

**MONITOR + SHARPEN NARRATIVE. Do not act on agent commerce as a build; do act on the CRM-native threat as product strategy.**

Why:
- **Agent-to-agent commerce is real but 3–7 years from materially touching our customers**, and even its best exemplar (Mark Miller) runs negotiation *off* and represents <1% of volume. Chasing it now would be repositioning toward hype against a thin, Google/OpenAI-defined field.
- **The trend's true value to us is narrative, not product** — it sharpens "humans win the hard deals" and gives us the two-lane frame. Capture that immediately in content and sales.
- **The threat that deserves engineering and roadmap attention is CRM-native capture + drafting (VinSolutions/DealerSocket), 12–24 months out.** Defend with the things a single-CRM AI structurally can't do: cross-platform capture, rep-as-author, CRM-agnostic GM visibility.

**Concrete monitoring triggers** (revisit stance if any fire):
1. A **second or third dealership** adopts/forks DMC-12 into production, or any CRM/OEM (Cox, Tekion) ships a productized human/agent **lane split**.
2. CarEdge-style buyer-agent volume moves from "engagements" to a credible share of **closed sales**, or a major platform (ChatGPT/Gemini) ships native car-buying checkout.
3. **VinSolutions** extends its Virtual Assistant from autonomous BDC into **rep-side, human-authored capture** (i.e., directly into our wedge).

Until a trigger fires: watch CDG / ASOTU / NADA, keep the locked positioning, and run the "Year of the Human / agents take the easy deals" narrative hard.

---

## 9. Sources

**DMC-12 / Hudson / Mark Miller / the deal**
- https://news.dealershipguy.com/p/first-publicly-known-agent-to-agent-car-deal-goes-down-in-salt-lake-city-2026-05-22
- https://www.threads.com/@cardealershipguy/post/DYxjXVsEgrs/
- https://x.com/GuyDealership/status/2059001557090226629
- https://dmc-12.ai/
- https://github.com/mm-open/dmc-12
- https://raw.githubusercontent.com/mm-open/dmc-12/main/README.md
- https://raw.githubusercontent.com/mm-open/dmc-12/main/SPEC.md
- https://raw.githubusercontent.com/mm-open/dmc-12/main/capabilities/negotiation.md
- https://github.com/mm-open/dmc-12/forks
- https://www.linkedin.com/in/chris-hudson-5b5937102/
- https://www.zoominfo.com/p/Christopher-Hudson/1747275884
- https://www.abc4.com/gtu/mark-miller-subaru-welcomes-new-general-manager-of-midtown-and-south-towne-locations/
- https://theorg.com/org/mark-miller-subaru/org-chart/ben-reuling-1
- https://www.tealhq.com/job/ai-agent-engineer_7ea1ae9e1b49dcf963ce62ac4e7aae421669f
- https://www.markmiller.com/
- https://news.dealershipguy.com/p/mark-miller-subaru-s-three-strict-rules-for-successful-one-price-selling-2025-09-18
- https://www.smalllakepod.com/episodes/jeff-miller-mark-miller-subaru
- https://caredge.com/dealer/mark-miller-subaru
- https://autoagentprotocol.org/

**CarEdge / buyer-side agents**
- https://caredge.com/reports/ai-negotiation-impact
- https://caredge.com/company
- https://fortune.com/2025/09/10/this-30-year-old-ceo-says-his-ai-negotiator-can-successfully-haggle-down-the-price-of-a-car-by-thousands-of-dollars/
- https://getcoai.com/news/caredges-ai-negotiator-saves-car-buyers-1k-by-handling-dealership-talks/
- https://mikemason.ca/writing/ai-negotiation-agents-jan-2026/
- https://aaronstuyvenberg.com/posts/clawd-bought-a-car
- https://www.linkedin.com/posts/aaron-stuyvenberg_clawdbot-bought-me-a-car-activity-7420840226731737088-Ma1k
- https://virtualuncle.com/openclaw-complete-guide-2026/
- https://ekho.com/blog/2026-ai-vehicle-research-study-how-buyers-are-using-chatgpt-and-other-ai-tools-to-find-their-next-vehicle/
- https://investors.cargurus.com/news-releases/news-release-details/cargurus-study-reveals-how-ai-and-omnichannel-shopping-are
- https://www.autonews.com/retail/an-ai-produces-new-kind-of-car-customer-0319/

**UCP / protocol stack / analysts**
- https://ucp.dev/
- https://developers.google.com/merchant/ucp
- https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/
- https://fourweekmba.com/google-launches-universal-commerce-protocol-at-nrf-2026-the-new-standard-for-ai-shopping/
- https://www.checkout.com/blog/openai-acp-google-ucp-difference
- https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- https://stripe.com/newsroom/news/stripe-openai-instant-checkout
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- https://ap2-protocol.org/
- https://developers.googleblog.com/en/google-cloud-donates-a2a-to-linux-foundation/
- https://developer.visa.com/capabilities/trusted-agent-protocol/overview
- https://www.digitalcommerce360.com/2025/10/16/visa-mastercard-both-launch-agentic-ai-payments-tools/
- https://www.anthropic.com/news/model-context-protocol
- https://www.gartner.com/en/newsroom/press-releases/2026-01-15-gartner-predicts-60-percent-of-brands-will-use-agentic-ai-to-deliver-streamlined-one-to-one-interactions-by-2028
- https://deveshshetty.com/blog/universal-commerce-protocol/

**Dealership CRM / AI-BDC / sentiment**
- https://www.coxautoinc.com/insights/cox-automotive-advances-dealer-workflows-with-unified-inventory-sourcing-and-ai-automation/
- https://www.prnewswire.com/news-releases/cox-automotives-newest-vinsolutions-artificial-intelligence-solution-can-turn-data-into-deals-302332550.html
- https://www.vinsolutions.com/dealership-software/connect-crm/
- https://www.solera.com/blog/2026/02/03/solera-announces-landmark-ai-investment-and-major-dealersocket-crm-upgrade-ahead-of-nada-show-2026/
- https://impel.ai/nada-2026/
- https://impel.ai/blog/a-new-era-for-automotive-dealerships-and-oems-through-agentic-ai/
- https://www.conversica.com/industries/automotive
- https://techcrunch.com/2025/06/05/tomas-ai-voice-agents-have-taken-off-at-car-dealerships-and-attracted-funding-from-a16z/
- https://www.numa.com/blog/top-7-ai-bdc-solutions-dealerships
- https://www.asotucon.com/
- https://www.automotivemastermind.com/blog/uncategorized/year-of-the-human-at-asotu-con-2026-how-dealers-use-ai-to-win-without-losing-the-human-touch/
- https://www.cbtnews.com/half-of-us-car-dealers-expect-ai-to-cut-jobs-by-2030/
- https://www.cdkglobal.com/insights/cdk-releases-2026-friction-points-study
- https://www.cdkglobal.com/insights/visiting-1-store-key-factor-buyer-satisfaction
- https://www.demandlocal.com/blog/consumer-behavior-car-buying-statistics/
- https://porchgroupmedia.com/blog/25-amazing-statistics-on-how-consumers-shop-for-cars/
- https://www.activengage.com/retailing/
- https://www.coxautoinc.com/deal-central/resources/the-new-dealers-edge-from-chatbots-to-ai-agents-and-a-truly-seamless-click-to-keys-journey/

---

### Confidence & gaps (for your hindsight)
- **High confidence:** the deal happened and CDG reported it (2026-05-22); the 0.5% quote is Hudson's; DMC-12 exists, is MIT/v0.5, and has thin traction; CarEdge's 100k+ engagements are real (May 2026); UCP is Google's NRF-2026 launch; VinSolutions/DealerSocket shipped native auto-draft + auto-capture (Jan/Feb 2026).
- **Lower confidence / flagged:** exact DMC-12 "11 vs 14" tool count (read/partner tiering, homepage not fully read); exact CarEdge price/launch date (sources conflict); per-company UCP commitment tier (Google page 403'd); all market-size $ figures (vendor/SEO blogs, wide variance); the "commodity deals peel to agents" split is directionally supported but **not** backed by a single clean measured statistic.
- **Interested-party caution:** the most quotable claims (0.5%, "first," CarEdge savings) come from parties promoting the trend. Treated as directional, not measured.
