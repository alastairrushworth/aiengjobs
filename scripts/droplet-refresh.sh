#!/usr/bin/env bash
# Nightly refresh: pull latest code, ingest ATS feeds, regenerate the site
# snapshot, and push it back (which triggers the GitHub Pages rebuild).
# Runs on the droplet as the `deploy` user via systemd (see deploy/).
set -euo pipefail

cd "$(dirname "$0")/.."

export AIENGJOBS_DB="${AIENGJOBS_DB:-/var/lib/aiengjobs/aiengjobs.db}"

# Stay in sync with the repo (deploy may have happened from elsewhere).
git pull --ff-only origin main || true

# Poll feeds + regenerate site/src/data/snapshot.json.
npm run -s refresh -w @aiengjobs/engine

if git diff --quiet -- site/src/data/snapshot.json; then
  echo "no snapshot change"
else
  git add site/src/data/snapshot.json
  git commit -m "data: refresh snapshot ($(date -u +%FT%TZ))"
  git push origin main
  echo "snapshot updated + pushed"
fi
