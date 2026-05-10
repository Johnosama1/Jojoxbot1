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

# Use credential store instead of embedding token in URL (avoids special char issues)
git config --local credential.helper '!f() { echo "username=oauth2"; echo "password='"$GH_TOKEN"'"; }; f'
git config --local url."https://github.com/".insteadOf "git@github.com:"

git push origin main

# Clean up credentials after push
git config --local --unset credential.helper 2>/dev/null || true

echo ""
echo "✅ Done! Code pushed to GitHub successfully."
echo "   Vercel will auto-deploy in about 1-2 minutes."
echo ""
echo "Check deploy status at:"
echo "   https://vercel.com/johnosama1s-projects"
