#!/bin/bash
set -e

echo "================================"
echo "  Jojox Bot — Push to GitHub"
echo "================================"
echo ""
echo "Enter your GitHub Personal Access Token:"
echo "(Go to github.com → Settings → Developer settings → Personal access tokens → Tokens classic → Generate new token)"
echo "Required scopes: repo"
echo ""
read -s -p "Token: " GH_TOKEN
echo ""

if [ -z "$GH_TOKEN" ]; then
  echo "❌ No token entered. Aborting."
  exit 1
fi

REPO="https://${GH_TOKEN}@github.com/Johnosama1/Jojoxbot1.git"

echo ""
echo "🔄 Pushing to GitHub..."
git push "$REPO" main

echo ""
echo "✅ Done! Code is on GitHub."
echo ""
echo "Next: Go to vercel.com → your project → and it will auto-deploy."
echo "Or trigger a manual redeploy from the Vercel dashboard."
