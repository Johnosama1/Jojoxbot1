#!/bin/bash
# sync-vercel-env.sh
# Syncs required environment variables from Replit secrets to the Vercel project.
#
# Required Replit secrets:
#   VERCEL_TOKEN        — Vercel API token (https://vercel.com/account/tokens)
#   NEON_DATABASE_URL   — Neon cloud PostgreSQL connection string
#   TELEGRAM_BOT_TOKEN  — Telegram bot token from BotFather
#
# Optional (already set on Vercel; only re-set if you need to update them):
#   BOT_WEBHOOK_URL     — Telegram webhook URL (e.g. https://jojoxbot-api-server.vercel.app/api/webhook)
#   MINI_APP_URL        — Frontend Mini App URL

set -euo pipefail

VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_fiuT4KK00JSNGe9b3cOUIsK7dber}"
VERCEL_API="https://api.vercel.com"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "ERROR: VERCEL_TOKEN is not set. Add it as a Replit secret first." >&2
  exit 1
fi

if [ -z "${NEON_DATABASE_URL:-}" ]; then
  echo "ERROR: NEON_DATABASE_URL is not set. Add it as a Replit secret first." >&2
  exit 1
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is not set. Add it as a Replit secret first." >&2
  exit 1
fi

# ── Helper: upsert a Vercel env var ──────────────────────────────────────────
# Usage: upsert_env KEY VALUE TYPE TARGET_JSON
# TYPE: "encrypted" | "sensitive" | "plain"
# TARGET_JSON: JSON array e.g. '["production","preview"]'
upsert_env() {
  local KEY="$1"
  local VALUE="$2"
  local TYPE="${3:-encrypted}"
  local TARGET="${4:-[\"production\",\"preview\"]}"

  # Check if key already exists and get its ID
  EXISTING=$(curl -sf \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$VERCEL_API/v10/projects/$VERCEL_PROJECT_ID/env" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
matches=[e for e in d.get('envs',[]) if e['key']=='$KEY']
print(matches[0]['id'] if matches else '')
" 2>/dev/null || echo "")

  if [ -n "$EXISTING" ]; then
    echo "  Updating $KEY (id=$EXISTING)..."
    curl -s -X PATCH \
      "$VERCEL_API/v10/projects/$VERCEL_PROJECT_ID/env/$EXISTING" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"value\":\"$VALUE\",\"type\":\"$TYPE\",\"target\":$TARGET}" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print('  OK key='+d.get('key','updated'))" 2>/dev/null || echo "  OK $KEY updated"
  else
    echo "  Creating $KEY..."
    curl -s -X POST \
      "$VERCEL_API/v10/projects/$VERCEL_PROJECT_ID/env" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"type\":\"$TYPE\",\"target\":$TARGET}" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print('  OK key='+d.get('key','created'))" 2>/dev/null || echo "  OK $KEY created"
  fi
}

echo "==> Syncing env vars to Vercel project: $VERCEL_PROJECT_ID"
echo ""

echo "[1/2] NEON_DATABASE_URL (encrypted, production + preview)"
upsert_env "NEON_DATABASE_URL" "$NEON_DATABASE_URL" "encrypted" '["production","preview"]'

echo "[2/2] TELEGRAM_BOT_TOKEN (encrypted, production + preview)"
upsert_env "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN" "encrypted" '["production","preview"]'

echo ""
echo "==> Done. Triggering redeploy..."

# Get latest deployment to redeploy from
LATEST_DEPLOY=$(curl -sf \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "$VERCEL_API/v6/deployments?projectId=$VERCEL_PROJECT_ID&limit=1" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
deps=d.get('deployments',[])
print(deps[0]['uid'] if deps else '')
" 2>/dev/null || echo "")

if [ -z "$LATEST_DEPLOY" ]; then
  echo "WARNING: Could not find latest deployment to redeploy from. Push a commit to trigger deploy."
  exit 0
fi

echo "  Redeploying from $LATEST_DEPLOY..."
NEW_DEPLOY=$(curl -sf -X POST \
  "$VERCEL_API/v13/deployments" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"jojoxbot-api-server\",\"deploymentId\":\"$LATEST_DEPLOY\",\"target\":\"production\"}" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('id','?') + '  url=' + d.get('url','?') + '  state=' + d.get('readyState','?'))
" 2>/dev/null || echo "redeploy failed")

echo "  $NEW_DEPLOY"
echo ""
echo "==> Vercel env sync complete. Check Vercel Function Logs after deploy finishes."
echo "    Production URL: https://jojoxbot-api-server.vercel.app/api/health"
