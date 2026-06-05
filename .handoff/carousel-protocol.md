# Handoff → BREZ (Mac Mini) — Finish Carousel Protocol install

**Date:** 2026-06-05
**Branch:** `claude/carousel-protocol-install-Y1PzF` (PR #40, draft)
**From:** Claude Code (cloud session — isolated container, no SSH/Telegram path to the Mac Mini)
**To:** BREZ on the Mac Mini

## Status
The Brevmont Carousel Protocol skill is **built, wired, and tested** in the repo at
`.claude/skills/brevmont-carousel/` (SKILL.md, schema.json, render.py, requirements.txt,
templates/{problem,cta_rep,cta_gm}.html, examples/sample.json). brand-lint CI is green.

Two steps can only run on the Mac Mini (they need brew, the local vault repo, and the
Telegram env vars that are not present in the cloud container):

1. Mirror the skill into `brevmont-vault` and commit/push it.
2. Send the Telegram FORGE completion ping.
3. (cosmetic) `brew install --cask font-inter`.

## Action — one command
From the repo root on the Mac Mini:

```bash
git fetch origin claude/carousel-protocol-install-Y1PzF
git checkout claude/carousel-protocol-install-Y1PzF
bash scripts/carousel-mac-setup.sh
```

`scripts/carousel-mac-setup.sh` is idempotent and does everything hands-off:
- installs `playwright` + chromium
- `brew install --cask font-inter` (soft-fail)
- installs the skill into `~/.claude/skills/brevmont-carousel`
- auto-discovers the vault (`$BREVMONT_VAULT`, then `~/brevmont/brevmont-vault`,
  `~/brevmont-vault`, `~/Documents/brevmont-vault`), mirrors to
  `brand/carousel/skill-mirror`, and `git add/commit/push`es it
- runs a test render of `examples/sample.json` (4 slides @ 1080x1350)
- sends the Telegram FORGE via `.scripts/tg.sh` if `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_ID` are set (otherwise it prints the exact message to send)

If the vault lives somewhere non-standard:
`BREVMONT_VAULT=/path/to/brevmont-vault bash scripts/carousel-mac-setup.sh`

## Acceptance checks (ready-to-go = all true)
- [ ] `~/.claude/skills/brevmont-carousel/SKILL.md` exists on the Mac Mini
- [ ] Test render wrote `slide_1.png … slide_4.png` at 1080x1350
- [ ] Vault shows a new commit under `brand/carousel/` (pushed)
- [ ] Telegram received the `[CAROUSEL PROTOCOL INSTALLED]` FORGE
- [ ] In a Claude Code session, "make a carousel" triggers the `brevmont-carousel` skill

## Notes
- Trigger phrases: "let's create a post", "make a carousel", "carousel poster".
- Output contract: problem slides first, branded CTA card (rep or GM) last; one set.
- Copy is "generations" internally; never imply the GM dashboard is free.
- The repo copy is the source of truth; the vault copy is a mirror. Re-running the
  script is safe and re-syncs both.
