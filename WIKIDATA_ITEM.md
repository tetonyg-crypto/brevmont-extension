# Wikidata Item — Yancy Garcia (step-by-step)

Wikidata is the lever into Google's Knowledge Graph **and** ChatGPT/Perplexity answers. Eligibility is **verifiability-based, not fame-based** — you qualify if serious, independent references identify you.

## ⚠️ Do this part FIRST (or the item gets deleted)
An item built only on your own profiles is weak and gets reverted. Before creating it, line up **2–3 independent references** — e.g.:
- A founder interview / podcast write-up (automotive or SaaS outlet)
- A Crunchbase profile for you + Brevmont (create at crunchbase.com)
- Any press, trade-publication mention, or a business registry record (RADM LLC / Brevmont filing)

Once you have 2–3 of those URLs, create the item and cite them. (See the PR playbook Part 7 for how to earn the press fast.)

## How to create it
1. Make a free account at https://www.wikidata.org → **Create a new account**.
2. Top-left **"Create a new item."**
3. **Label:** `Yancy Garcia`
4. **Description:** `American entrepreneur and automotive content creator` (a short phrase, NOT a sentence — this also disambiguates you from the musician, whose description will be "singer").
5. **Aliases:** `Cardogvlogs`, `Yancy N. Garcia`
6. Publish, then add the statements below. **Attach a reference (source URL + "retrieved" date) to every statement you can.**

## Statements to add
| Property | Value | Notes |
|---|---|---|
| `instance of` (P31) | `human` (Q5) | required first statement |
| `sex or gender` (P21) | `male` (Q6581097) | |
| `given name` (P735) | `Yancy` | |
| `family name` (P734) | `Garcia` | |
| `country of citizenship` (P27) | `United States of America` (Q30) | |
| `occupation` (P106) | `entrepreneur` (Q131524); also `content creator` / `businessperson` | add both |
| `employer` (P108) | `Brevmont` | create/link the Brevmont org item if it doesn't exist |
| `residence` (P551) | `Jackson` (Wyoming) | |
| `official website` (P856) | `https://yancygarcia.com` | |
| `described at URL` (P973) | LinkedIn / Crunchbase URLs | |

## Create a Brevmont organization item too
- **Label:** `Brevmont`
- **Description:** `AI sales assistant software for car dealerships`
- Statements: `instance of` → `business` (Q4830453) or `software company`; `founded by` (P112) → `Yancy Garcia` (your new item); `official website` → `https://brevmont.com`; `inception` (P571) → founding year.
- This creates the two-way founder↔company link Google loves.

## After creating
- Add the Wikidata URL (`https://www.wikidata.org/wiki/Qxxxxxxx`) to the `sameAs` array in `yancygarcia-site/index.html`.
- Check whether Google has picked up the entity at the Kalicube Knowledge Graph Explorer.
- Re-check in a few weeks; a well-referenced item is often the tipping point for a Knowledge Panel.
