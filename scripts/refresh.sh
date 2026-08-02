#!/usr/bin/env bash
# Nightly refresh, phase 1: poll the ATS feeds and regenerate the site snapshot.
#
# This script deliberately publishes NOTHING. The workflow persists the database
# the moment this exits 0 (see .github/workflows/refresh.yml), and only then
# runs scripts/publish.sh.
#
# The two used to be one script, publishing before the workflow saved the
# database. Any non-zero exit after the snapshot push then threw away the whole
# night's ingest while the public board had already moved — which is exactly
# what happened on 2026-07-31 (run 30653925404): a routine non-fast-forward
# `git push` discarded 3h47m of work. Splitting them means a publish failure
# costs only the publish.
#
# Runs on a GitHub Actions runner. The database is restored and persisted by the
# workflow, not here.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${AIENGJOBS_DB:?AIENGJOBS_DB must be set}"

SNAPSHOT=site/src/data/snapshot.json
# Hold on to the pre-refresh snapshot: publish.sh diffs it to decide whether to
# publish at all, and notify diffs it to work out which URLs to announce. It
# lives under data/ rather than in $TMPDIR because it has to survive between
# workflow steps.
PREV=data/prev-snapshot.json

mkdir -p data
# The workspace has no snapshot.json (it is gitignored), so seed the comparison
# from the published branch. Without this every job looks new on the first run.
if ! { git fetch --depth=1 origin snapshot 2>/dev/null &&
  git cat-file blob FETCH_HEAD:snapshot.json > "$PREV" 2>/dev/null; }; then
  echo "no published snapshot to diff against (first run?)"
  : > "$PREV"
fi

# Deliberately NOT seeding $SNAPSHOT from $PREV: if the export step then failed
# to write it, cmp would compare the copy against itself, report "no change" and
# exit 0 — a broken run that looks like a quiet night.
rm -f "$SNAPSHOT"

# Poll feeds + regenerate the snapshot and its meta file.
npm run -s refresh -w @aiengjobs/engine

test -s "$SNAPSHOT" || { echo "refresh produced no snapshot" >&2; exit 1; }

echo "ingest complete — snapshot regenerated, nothing published yet"
