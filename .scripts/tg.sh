#!/usr/bin/env bash
# Usage: .scripts/tg.sh "[WORKER] [PHASE] short message"
MSG="$1"
: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN in env}"
: "${TELEGRAM_CHAT_ID:?set TELEGRAM_CHAT_ID in env}"
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=${MSG}" \
  -d "disable_web_page_preview=true" > /dev/null
