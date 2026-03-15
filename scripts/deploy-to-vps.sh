#!/bin/bash
# Deploy Phoenix Echo Gateway from Studio to VPS
# Run from Studio: ~/Phoenix-Echo-Gateway/scripts/deploy-to-vps.sh
#
# What this does:
#   1. Pushes current Studio code to GitHub
#   2. SCPs src/ files to VPS (preserves VPS public/ and workspace/)
#   3. Installs any new dependencies on VPS
#   4. Restarts the phoenix-echo service
#
# Created: 2026-03-02 by Phoenx Echo

set -euo pipefail

VPS="phoenix-echo"
VPS_PATH="/opt/phoenix-echo-gateway"
REPO_DIR="$HOME/Phoenix-Echo-Gateway"

echo "=== Phoenix Echo Gateway — Deploy to VPS ==="
echo ""

# Step 1: Make sure we're in the repo
cd "${REPO_DIR}"

# Step 2: Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "WARNING: You have uncommitted changes. Commit first or they won't be deployed."
  echo ""
  git status --short
  echo ""
  read -p "Continue anyway? (y/N) " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

# Step 3: Push to GitHub
echo "[1/4] Pushing to GitHub..."
git push origin main || echo "Push failed — check SSH key. Continuing with local files."

# Step 4: SCP src/ to VPS
echo "[2/4] Copying src/ to VPS..."
scp -r src/*.js "${VPS}:${VPS_PATH}/src/"
scp -r src/channels/*.js "${VPS}:${VPS_PATH}/src/channels/"
echo "      src/ synced."

# Step 5: Install dependencies
echo "[3/4] Installing dependencies on VPS..."
ssh "${VPS}" "cd ${VPS_PATH} && npm install --omit=dev 2>&1 | tail -3"

# Step 6: Restart service
echo "[4/4] Restarting phoenix-echo service..."
ssh "${VPS}" "sudo systemctl restart phoenix-echo && sleep 2 && systemctl is-active phoenix-echo"

echo ""
echo "=== Deploy complete ==="
echo "VPS health: $(ssh ${VPS} "curl -s http://localhost:18790/health | head -c 80")"
