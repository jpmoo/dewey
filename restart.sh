#!/usr/bin/env bash
# Dewey: pull, clean build, and restart the app.
# Run from the repo root or from anywhere (script uses its own directory).
# Uses systemd --user by default. For PM2, replace the last step with: pm2 restart dewey

set -e
cd "$(dirname "$0")"

echo "→ git pull"
git pull

echo "→ Freeing port 3000"
fuser -k 3000/tcp 2>/dev/null || true
sleep 2

echo "→ Clean build"
rm -rf .next
npm ci
npm run build

echo "→ Restarting Dewey (systemd user service)"
systemctl --user restart dewey

echo "Done. Check: systemctl --user status dewey"
