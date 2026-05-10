#!/bin/bash
set -e

echo "================================"
echo "  Jojox Bot — Push to GitHub"
echo "================================"
echo ""
echo "Enter your GitHub Personal Access Token (ghp_...):"
read -s -p "Token: " GH_TOKEN
echo ""

if [ -z "$GH_TOKEN" ]; then
  echo "❌ No token entered. Aborting."
  exit 1
fi

echo ""
echo "🔄 Pushing to GitHub..."

# URL-encode the token to handle special characters safely
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$GH_TOKEN")
REMOTE_URL="https://oauth2:${ENCODED}@github.com/Johnosama1/Jojoxbot1.git"

git push "$REMOTE_URL" main

echo ""
echo "✅ Done! Code is on GitHub."
echo "   Vercel will auto-deploy in 1-2 minutes."
echo ""
echo "Check: https://vercel.com/johnosama1s-projects"
