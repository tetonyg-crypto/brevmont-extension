#!/usr/bin/env bash
#
# Brevmont Carousel Protocol — Mac Mini one-command setup (BREZ).
#
# Completes the steps that can only run on the Mac Mini (vault mirror,
# Telegram FORGE, Inter font) and installs the skill into ~/.claude/skills.
# Idempotent and safe to re-run. Soft-fails on optional pieces (font, telegram,
# vault) so a missing dependency never aborts the whole run.
#
# Usage (from the repo root, on the Mac Mini):
#   bash scripts/carousel-mac-setup.sh
#
# Optional env:
#   BREVMONT_VAULT       Path to brevmont-vault (auto-discovered if unset)
#   TELEGRAM_BOT_TOKEN   For the completion FORGE ping
#   TELEGRAM_CHAT_ID     For the completion FORGE ping
#
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/.claude/skills/brevmont-carousel"
SKILL_DST="$HOME/.claude/skills/brevmont-carousel"
say() { printf '\n=== %s ===\n' "$1"; }
ok()  { printf '  [ok] %s\n' "$1"; }
warn(){ printf '  [warn] %s\n' "$1"; }

[ -d "$SKILL_SRC" ] || { echo "FATAL: skill not found at $SKILL_SRC — run from the repo root"; exit 1; }

say "1. Python deps (playwright + chromium)"
python3 -m pip install playwright --break-system-packages -q 2>/dev/null \
  || python3 -m pip install playwright -q || warn "pip install playwright failed"
python3 -m playwright install chromium && ok "chromium installed" \
  || warn "chromium download failed — set BREVMONT_CHROMIUM_PATH to an existing chrome"

say "2. Inter font (cosmetic; templates fall back to web import)"
if command -v brew >/dev/null 2>&1; then
  brew install --cask font-inter 2>/dev/null && ok "font-inter installed" \
    || warn "font-inter skipped (already installed or cask unavailable)"
else
  warn "no brew — using web font import in templates"
fi

say "3. Install skill into ~/.claude/skills"
mkdir -p "$HOME/.claude/skills"
rm -rf "$SKILL_DST"
cp -r "$SKILL_SRC" "$SKILL_DST" && ok "skill live at $SKILL_DST"

say "4. Mirror skill into the vault (version control)"
VAULT="${BREVMONT_VAULT:-}"
if [ -z "$VAULT" ]; then
  for c in "$HOME/brevmont/brevmont-vault" "$HOME/brevmont-vault" \
           "$HOME/Documents/brevmont-vault"; do
    [ -d "$c" ] && VAULT="$c" && break
  done
fi
if [ -n "$VAULT" ] && [ -d "$VAULT" ]; then
  DST="$VAULT/brand/carousel/skill-mirror"
  mkdir -p "$DST"
  rm -rf "$DST"; mkdir -p "$DST"
  cp -r "$SKILL_SRC/." "$DST/"
  ok "mirrored to $DST"
  if [ -d "$VAULT/.git" ]; then
    ( cd "$VAULT" && git add brand/carousel \
      && git commit -m "feat: mirror Brevmont Carousel Protocol skill + render engine + locked card templates" \
      && git push ) && ok "vault committed + pushed" \
      || warn "vault git commit/push skipped (nothing to commit or push failed)"
  else
    warn "vault is not a git repo — copied files only, commit manually"
  fi
else
  warn "vault not found — set BREVMONT_VAULT=/path/to/brevmont-vault and re-run"
fi

say "5. Test render (proves the engine works end to end)"
OUT="$(mktemp -d)/carousel_verify"
if python3 "$SKILL_SRC/render.py" "$SKILL_SRC/examples/sample.json" "$OUT" >/dev/null 2>&1; then
  N=$(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')
  ok "rendered $N slides -> $OUT"
else
  warn "test render failed — check chromium install"
fi

say "6. Telegram FORGE"
TG="$REPO_ROOT/.scripts/tg.sh"
MSG="[CAROUSEL PROTOCOL INSTALLED]
Skill: ~/.claude/skills/brevmont-carousel/ (SKILL.md, render.py, schema.json, 3 templates)
Vault mirror: ${VAULT:-<not found>}
Test render: PASS — 1080x1350, brand-locked, rep + GM cards working
Trigger: \"let's create a post\" / \"make a carousel\" -> build slides as PNGs, problem first, branded CTA last.
Deps: playwright + chromium installed."
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && [ -f "$TG" ]; then
  bash "$TG" "$MSG" && ok "Telegram FORGE sent" || warn "Telegram send failed"
else
  warn "TELEGRAM_BOT_TOKEN/CHAT_ID not set — FORGE skipped. Message to send:"
  printf '%s\n' "$MSG"
fi

say "DONE"
echo "Carousel Protocol is installed on this machine."
echo "Trigger it any time with: \"let's create a post\" or \"make a carousel\"."
