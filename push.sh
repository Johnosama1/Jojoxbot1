#!/bin/bash
set -e

echo "================================"
echo "  Jojox Bot — Push to GitHub"
echo "================================"
echo ""

# Use GITHUB_TOKEN secret if available, otherwise prompt
if [ -n "$GITHUB_TOKEN" ]; then
  GH_TOKEN="$GITHUB_TOKEN"
  echo "✅ Using saved GitHub token..."
else
  echo "Enter your GitHub Personal Access Token (ghp_...):"
  read -s -p "Token: " GH_TOKEN
  echo ""
fi

if [ -z "$GH_TOKEN" ]; then
  echo "❌ No token found. Add GITHUB_TOKEN to Replit Secrets."
  exit 1
fi

echo ""
echo "🔄 Pushing to GitHub..."

ENCODED=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$GH_TOKEN")
REMOTE_URL="https://oauth2:${ENCODED}@github.com/Johnosama1/Jojoxbot1.git"

git push --force "$REMOTE_URL" main

echo ""
echo "✅ Done! Code is on GitHub."
echo "   Vercel will auto-deploy in ~2 minutes."
echo ""
echo "📋 After Vercel deploys, register the webhook:"
echo "   bash register-webhook.sh"
echo ""
echo "Check deployment: https://vercel.com/johnosama1s-projects"
