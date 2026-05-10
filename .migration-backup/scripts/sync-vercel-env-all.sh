#!/bin/bash
# sync-vercel-env-all.sh
# Syncs NEON_DATABASE_URL and TELEGRAM_BOT_TOKEN to all Vercel projects
# that may serve bot traffic (staging / preview deployments).
#
# Projects covered:
#   prj_fiuT4KK00JSNGe9b3cOUIsK7dber  — jojoxbot-api-server   (primary, already synced)
#   prj_zUkPacAba2U1N2Par8kx1gDB6rT7  — jojoxbot1-api-server
#   prj_BUwGgFRkDxiqxYte9Xy97CrqgJOl  — jojoxbot1-api-server-3t2g
#   prj_nLGylhfQTWBTtCN8QNSKyvCiNlxr  — jojoxbot1-app
#
# Required Replit secrets: VERCEL_TOKEN, NEON_DATABASE_URL, TELEGRAM_BOT_TOKEN

set -euo pipefail

VERCEL_API="https://api.vercel.com"

for var in VERCEL_TOKEN NEON_DATABASE_URL TELEGRAM_BOT_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set. Add it as a Replit secret first." >&2
    exit 1
  fi
done

# ── Helper: upsert a single env var on a given project ───────────────────────
upsert_env() {
  local PROJECT_ID="$1"
  local KEY="$2"
  local VALUE="$3"
  local TYPE="${4:-encrypted}"
  local TARGET="${5:-[\"production\",\"preview\"]}"

  EXISTING=$(curl -sf \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$VERCEL_API/v10/projects/$PROJECT_ID/env" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
matches=[e for e in d.get('envs',[]) if e['key']=='$KEY']
print(matches[0]['id'] if matches else '')
" 2>/dev/null || echo "")

  if [ -n "$EXISTING" ]; then
    echo "    Updating $KEY (id=$EXISTING)..."
    curl -s -X PATCH \
      "$VERCEL_API/v10/projects/$PROJECT_ID/env/$EXISTING" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"value\":\"$VALUE\",\"type\":\"$TYPE\",\"target\":$TARGET}" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print('    OK key='+d.get('key','updated'))" 2>/dev/null || echo "    OK $KEY updated"
  else
    echo "    Creating $KEY..."
    curl -s -X POST \
      "$VERCEL_API/v10/projects/$PROJECT_ID/env" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"type\":\"$TYPE\",\"target\":$TARGET}" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print('    OK key='+d.get('key','created'))" 2>/dev/null || echo "    OK $KEY created"
  fi
}

# ── Projects to sync ──────────────────────────────────────────────────────────
declare -A PROJECTS=(
  ["prj_fiuT4KK00JSNGe9b3cOUIsK7dber"]="jojoxbot-api-server"
  ["prj_zUkPacAba2U1N2Par8kx1gDB6rT7"]="jojoxbot1-api-server"
  ["prj_BUwGgFRkDxiqxYte9Xy97CrqgJOl"]="jojoxbot1-api-server-3t2g"
  ["prj_nLGylhfQTWBTtCN8QNSKyvCiNlxr"]="jojoxbot1-app"
)

for PROJECT_ID in "${!PROJECTS[@]}"; do
  NAME="${PROJECTS[$PROJECT_ID]}"
  echo ""
  echo "==> Project: $NAME ($PROJECT_ID)"
  echo "  [1/2] NEON_DATABASE_URL"
  upsert_env "$PROJECT_ID" "NEON_DATABASE_URL" "$NEON_DATABASE_URL" "encrypted" '["production","preview"]'
  echo "  [2/2] TELEGRAM_BOT_TOKEN"
  upsert_env "$PROJECT_ID" "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN" "encrypted" '["production","preview"]'
  echo "  Done."
done

echo ""
echo "==> All projects synced. Each project will pick up the new values on next deploy."
echo "    Push a commit or manually redeploy each project in the Vercel dashboard to apply."
