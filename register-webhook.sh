#!/bin/bash
set -e

echo "======================================"
echo "  Jojox Bot — Register Telegram Webhook"
echo "======================================"
echo ""

# Use BOT_TOKEN from env (Replit secret) or prompt
TOKEN="${BOT_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  read -s -p "Enter BOT_TOKEN: " TOKEN
  echo ""
fi

if [ -z "$TOKEN" ]; then
  echo "❌ No BOT_TOKEN. Aborting."
  exit 1
fi

echo "Enter your Vercel domain (e.g. jojoxbot1-api-server.vercel.app):"
echo "⚠️  Only the domain — NOT a GitHub URL!"
read -p "Domain: " VERCEL_DOMAIN

if [ -z "$VERCEL_DOMAIN" ]; then
  echo "❌ No domain entered. Aborting."
  exit 1
fi

# Strip https:// or http:// prefix if user accidentally included it
VERCEL_DOMAIN="${VERCEL_DOMAIN#https://}"
VERCEL_DOMAIN="${VERCEL_DOMAIN#http://}"
# Strip trailing slashes and .git
VERCEL_DOMAIN="${VERCEL_DOMAIN%%/*}"
VERCEL_DOMAIN="${VERCEL_DOMAIN%.git}"

# Validate it looks like a vercel domain
if [[ "$VERCEL_DOMAIN" == *"github.com"* ]]; then
  echo "❌ That's a GitHub URL — please enter your Vercel domain (e.g. jojoxbot1-api-server.vercel.app)"
  exit 1
fi

WEBHOOK_URL="https://${VERCEL_DOMAIN}/api/webhook"

echo ""
echo "🔗 Registering webhook: $WEBHOOK_URL"

RESPONSE=$(curl -s -X POST \
  "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBHOOK_URL}\", \"allowed_updates\": [\"message\", \"callback_query\", \"chat_member\"]}")

echo ""
echo "Telegram response:"
echo "$RESPONSE" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try {
      const r=JSON.parse(d);
      if(r.ok) console.log('✅ Webhook registered successfully!');
      else console.log('❌ Error:', r.description);
    } catch(e){ console.log(d); }
  });
"

echo ""
echo "Verify at: https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
