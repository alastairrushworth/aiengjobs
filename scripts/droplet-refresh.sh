#!/usr/bin/env bash
# Nightly refresh: pull latest code, ingest ATS feeds, regenerate the site
# snapshot, publish it, and tell search engines what changed.
# Runs on the droplet as the `deploy` user via systemd (see deploy/).
set -euo pipefail

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/.."

# Stay in sync with the repo (deploy may have happened from elsewhere), then hand
# the run over to the copy of this script we just pulled.
#
# The re-exec is the point. That pull can rewrite this very file, and bash reads a
# script lazily from disk as it executes — so a run that pulls a change to itself
# can execute half the old script and half the new one. That is not hypothetical:
# on 2026-07-30 the pull landed the commit that untracked snapshot.json while the
# *previous* version of this script was still running, and its check —
# `git diff --quiet -- site/src/data/snapshot.json`, now asking about a path git no
# longer tracks — dutifully reported no change. A clean sweep of 3703 open roles
# published nothing and the site sat a day stale. Re-exec so that whatever runs
# past this point is entirely the new code, reading the repo it was written for.
if [ "${AIENGJOBS_REEXECED:-}" != 1 ]; then
  git pull --ff-only origin main || true
  AIENGJOBS_REEXECED=1 exec "$SELF" "$@"
fi

# Load secrets (OPENAI_API_KEY etc.) for both manual and systemd runs.
if [ -f /etc/aiengjobs.env ]; then
  set -a
  . /etc/aiengjobs.env
  set +a
fi

export AIENGJOBS_DB="${AIENGJOBS_DB:-/var/lib/aiengjobs/aiengjobs.db}"

SNAPSHOT=site/src/data/snapshot.json
META=site/src/data/snapshot.meta.json

# Hold on to the pre-refresh snapshot: it's what we diff to work out which job
# URLs to announce, and what we compare against to decide whether to publish.
PREV="$(mktemp)"
trap 'rm -f "$PREV"' EXIT
cp "$SNAPSHOT" "$PREV" 2>/dev/null || true

# Poll feeds + regenerate the snapshot and its meta file.
npm run -s refresh -w @aiengjobs/engine

if cmp -s "$PREV" "$SNAPSHOT"; then
  echo "no snapshot change"
  exit 0
fi

# The snapshot is ~22MB. Committing it nightly added a few MB to the repo every
# night, and that cost scales with refresh frequency — which is exactly the knob
# we want to be free to turn up. So publish it on a detached, single-commit
# branch (force-pushed, so the remote never accumulates history) and commit only
# the small meta file to main, which is what triggers the Pages build.
blob="$(git hash-object -w "$SNAPSHOT")"
tree="$(printf '100644 blob %s\tsnapshot.json\n' "$blob" | git mktree)"
commit="$(git commit-tree "$tree" -m "snapshot $(date -u +%FT%TZ)")"
git push --force origin "$commit:refs/heads/snapshot"
echo "snapshot published to refs/heads/snapshot"

git add "$META"
git commit -m "data: refresh snapshot ($(date -u +%FT%TZ))"
git push origin main
echo "meta committed + pushed (triggers Pages build)"

# Announce new and closed job URLs. Best-effort: a missed ping costs freshness,
# whereas failing here would leave the board published but the run marked failed.
npm run -s notify -w @aiengjobs/engine -- "$PREV" "$SNAPSHOT" || \
  echo "  ! notify failed (non-fatal)"
