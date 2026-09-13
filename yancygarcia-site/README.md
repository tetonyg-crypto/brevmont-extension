# yancygarcia.com — personal hub site

This is your **entity home**: the page Google should rank #1 for "Yancy Garcia," with `Person`, `ProfilePage`, and `FAQPage` schema baked in. Static HTML — deploys anywhere in minutes, free.

## Files
- `index.html` — the hub / About / bio page (the entity home, with all schema)
- `links.html` — your link-in-bio page (`yancygarcia.com/links`) — replaces Linktree
- `styles.css` — styling (Brevmont teal)
- `yancy-garcia.jpg` — **ADD THIS**: drop in the same headshot you use on every social profile (square, ~600×600px)

## Before you deploy — 3 quick edits
1. **Add `yancy-garcia.jpg`** (your real headshot) to this folder.
2. **Confirm/fix the social URLs** in `index.html` (search for `sameAs` and the `<link rel="me">` tags) and in `links.html`. In particular:
   - Set your **LinkedIn vanity URL** to `linkedin.com/in/yancygarcia` (LinkedIn → Edit public profile & URL), then the links here are correct.
   - Confirm your **Facebook** URL (replace `facebook.com/yancygarcia` with your real one).
   - Add your **TikTok** / **YouTube** handle if different from `@cardogvlogs`.
3. After you create your **Wikidata** item (see `../WIKIDATA_ITEM.md`), add its URL (`https://www.wikidata.org/wiki/Qxxxxxxx`) to the `sameAs` array in `index.html`.

## Deploy options (pick one — all free, all take <10 min)

### Option A — Netlify drag-and-drop (easiest)
1. Go to https://app.netlify.com/drop
2. Drag this whole `yancygarcia-site` folder onto the page.
3. It goes live instantly on a `*.netlify.app` URL.
4. Add your domain: Site settings → Domain management → Add `yancygarcia.com`, then point your domain's DNS at Netlify (they show you the records).

### Option B — Vercel
1. `npm i -g vercel` → `cd yancygarcia-site` → `vercel` → follow prompts.
2. Add `yancygarcia.com` in the Vercel dashboard → Domains.

### Option C — GitHub Pages
1. Push this folder to a repo, Settings → Pages → deploy from branch.
2. Add `yancygarcia.com` as a custom domain.

## After it's live — DO THIS (don't skip)
1. **Google Search Console** (search.google.com/search-console): add `yancygarcia.com` as a property, verify, submit the sitemap / use **URL Inspection → Request Indexing** on `/` and `/links`.
2. **Validate the schema:** paste your live URL into https://search.google.com/test/rich-results — confirm Person + FAQ parse with no errors.
3. **Put `yancygarcia.com/links` in every social bio** (replace any Linktree).
