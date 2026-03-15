#!/bin/bash
# Sync all devices from GitHub (source of truth)
# Run from anywhere: ssh studio-remote "~/Phoenix-Echo-Gateway/scripts/sync-from-github.sh"
#
# What this does:
#   1. Pulls latest from GitHub to Studio
#   2. Optionally deploys to VPS
#
# Created: 2026-0302 by Phoenix Echo

set -euo pipefail

REPO_DIR="$HOME/Phoenix-Echo-Gateway"

echo "=== Phoenix Echo Gateway — Sync from GitHub ==="
echo ""

cd "${REPO_DIR}"

# Pull latest
echo "[1/2] Pulling from GitHub..."
git pull origin main
echo "      Studio is up to date."

echo ""
echo "[2/2] Deploy to VPS too?"
read -p "Deploy to VPS? (y/N) " deploy_vps
if [[ "$deploy_vps" =~ ^[Yy]$ ]]; then
  bash "${REPO_DIR}/scripts/deploy-to-vps.sh"
else
  echo "      Skipped VPS deploy."
fi

echo ""
echo "=== Sync complete ==="
