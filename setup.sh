#!/bin/bash
set -e

echo "========================================="
echo "  Floq Extension — Clean Setup"
echo "========================================="
echo ""

# 1. Check Node version
REQUIRED_MAJOR="24"
CURRENT_VERSION=$(node -v 2>/dev/null || echo "none")
CURRENT_MAJOR=$(echo "$CURRENT_VERSION" | cut -d'.' -f1 | tr -d 'v')

if [ "$CURRENT_VERSION" = "none" ]; then
  echo "ERROR: Node.js is not installed."
  echo "Install Node v${REQUIRED_MAJOR}.x via nvm:"
  echo "  nvm install 24 && nvm use 24"
  exit 1
fi

if [ "$CURRENT_MAJOR" != "$REQUIRED_MAJOR" ]; then
  echo "ERROR: Node v${REQUIRED_MAJOR}.x required. You have ${CURRENT_VERSION}."
  echo ""
  echo "Fix with nvm:"
  echo "  nvm install 24 && nvm use 24"
  echo ""
  echo "Or if using .nvmrc:"
  echo "  nvm use"
  exit 1
fi

echo "Node version: ${CURRENT_VERSION} ✓"
echo "npm version:  $(npm -v) ✓"
echo ""

# 2. Nuke all build artifacts and dependencies
echo "Cleaning node_modules, .wxt, .output..."
rm -rf node_modules .wxt .output
echo "Clean ✓"
echo ""

# 3. Install from lockfile (exact versions, no drift)
echo "Installing dependencies via npm ci..."
npm ci
echo "Install ✓"
echo ""

# 4. Set up git hooks
echo "Configuring git hooks..."
git config core.hooksPath .githooks 2>/dev/null || true
echo "Git hooks ✓"
echo ""

# 5. Build
echo "Building extension..."
npx wxt build
echo "Build ✓"
echo ""

# 6. Verify
if [ -f ".output/chrome-mv3/manifest.json" ]; then
  VERSION=$(grep '"version"' .output/chrome-mv3/manifest.json | head -1 | sed 's/.*: "//;s/".*//')
  echo "========================================="
  echo "  SUCCESS — Extension v${VERSION} built"
  echo "========================================="
  echo ""
  echo "Load in Chrome:"
  echo "  1. Go to chrome://extensions"
  echo "  2. Enable Developer Mode"
  echo "  3. Click 'Load unpacked'"
  echo "  4. Select: $(pwd)/.output/chrome-mv3"
  echo ""
else
  echo "ERROR: Build failed. No manifest.json found in .output/chrome-mv3/"
  echo "Run 'npx wxt build' manually to see errors."
  exit 1
fi
