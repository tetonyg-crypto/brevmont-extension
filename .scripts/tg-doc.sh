#!/usr/bin/env bash
# Usage: .scripts/tg-doc.sh <file-path> "caption text"
# Sends a document to Telegram with a caption. Use for RELEASE builds only.
# See CLAUDE.md > LOCKED ARCHITECTURAL PATTERNS > Build/Deploy Workflow.

FILE="$1"
CAPTION="$2"

: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN in env}"
: "${TELEGRAM_CHAT_ID:?set TELEGRAM_CHAT_ID in env}"

if [ -z "$FILE" ]; then
  echo "Usage: $0 <file-path> \"caption\"" >&2
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" \
  -F "chat_id=${TELEGRAM_CHAT_ID}" \
  -F "document=@${FILE}" \
  --form-string "caption=${CAPTION}" > /dev/null
