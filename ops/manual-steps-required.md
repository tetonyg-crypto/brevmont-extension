# Manual Steps Required — Carousel Protocol Install

Generated 2026-06-04 by the carousel-protocol install task.

## Environment note
This task was authored for "BREZ on the Mac Mini" with a separate vault repo at
`~/brevmont/brevmont-vault`. It actually executed inside the **brevmont-extension
remote container** (ephemeral Linux, `HOME=/root`), whose only persistent,
travels-with-the-company-brain surface is the git repo `tetonyg-crypto/brevmont-extension`.
The steps below diverged from the script for that reason. The carousel system itself
is fully built, tested, and committed to the repo.

## What landed automatically
- Skill committed to the repo (canonical, version-controlled home):
  `.claude/skills/brevmont-carousel/` — `SKILL.md`, `render.py`, `schema.json`,
  `templates/{problem,cta_rep,cta_gm}.html`. This is what makes the skill "travel
  with the company brain" via git — it is auto-loaded for any Claude Code session in
  this repo.
- Mirrored into the live session at `~/.claude/skills/brevmont-carousel/` (ephemeral;
  does not persist past this container, which is why the repo copy is canonical).
- Playwright python package + chromium verified working; test render produced
  `slide_1.png` (problem) + `slide_2.png` (cta_gm) at 1080x1350 @2x, brand-locked. PASS.

## Manual steps still required
1. **Vault mirror.** `~/brevmont/brevmont-vault/` does not exist in this container and
   is outside this session's repo scope, so Step 8 (`cp -r ... brevmont-vault/brand/carousel`
   + commit + push) could not run here. On the Mac Mini, copy the skill from the repo
   into the vault if you still want a second canonical copy:
   ```bash
   cp -r <brevmont-extension>/.claude/skills/brevmont-carousel \
         ~/brevmont/brevmont-vault/brand/carousel/skill-mirror
   cd ~/brevmont/brevmont-vault && git add brand/carousel && \
     git commit -m "feat: mirror Brevmont Carousel Protocol skill" && git push
   ```
   Recommendation: treat the repo copy as the single source of truth and have the
   vault reference it, to avoid drift between two copies.

2. **Telegram FORGE.** No Telegram credentials/network are available in this container,
   so the completion ping (Step 10) was not sent. Send it from the Mac Mini, or rely on
   the PR as the record. Message body:
   ```
   [CAROUSEL PROTOCOL INSTALLED]
   Skill: .claude/skills/brevmont-carousel/ (SKILL.md, render.py, schema.json, 3 templates)
   Test render: PASS — 1080x1350, brand-locked, problem + GM cards working
   Trigger: "let's create a post" / "make a carousel" -> build slides as PNGs, problem first, branded CTA last.
   Deps: playwright + chromium.
   ```

3. **Inter font (cosmetic).** `brew install --cask font-inter` is Mac-only and was not
   run here (Linux, no brew). The templates already `@import` Inter from Google Fonts
   and fall back to system sans-serif / Georgia serif, so renders are correct either way.
   On the Mac Mini, install `font-inter` for crisper offline renders, or leave the web
   import — both produce on-brand output.

4. **Chromium path in sandboxes.** On the Mac Mini the engine uses the bundled chromium
   after `python3 -m playwright install chromium`. In sandboxed/CI environments where
   the download is blocked, set `BREVMONT_CHROMIUM_PATH=/path/to/chrome` and the engine
   launches it with `--no-sandbox`. (This container used
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.)
