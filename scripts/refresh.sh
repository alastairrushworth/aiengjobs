#!/usr/bin/env bash
# Nightly refresh: ingest ATS feeds, regenerate the site snapshot, publish it,
# and tell search engines what changed.
#
# Runs on a GitHub Actions runner (see .github/workflows/refresh.yml). The
# database is restored and persisted by the workflow, not here.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${AIENGJOBS_DB:?AIENGJOBS_DB must be set}"

SNAPSHOT=site/src/data/snapshot.json
META=site/src/data/snapshot.meta.json

# Hold on to the pre-refresh snapshot: it's what we diff to work out which job
# URLs to announce, and what we compare against to decide whether to publish.
PREV="$(mktemp)"
trap 'rm -f "$PREV"' EXIT
# The workspace has no snapshot.json (it is gitignored), so seed the comparison
# from the published branch. Without this every job looks new on the first run.
git fetch --depth=1 origin snapshot 2>/dev/null &&
  git cat-file blob FETCH_HEAD:snapshot.json > "$PREV" 2>/dev/null ||
  echo "no published snapshot to diff against (first run?)"
# Deliberately NOT seeding $SNAPSHOT from $PREV: if the export step then failed
# to write it, cmp would compare the copy against itself, report "no change" and
# exit 0 — a broken run that looks like a quiet night.
rm -f "$SNAPSHOT"

# Poll feeds + regenerate the snapshot and its meta file.
npm run -s refresh -w @aiengjobs/engine

test -s "$SNAPSHOT" || { echo "refresh produced no snapshot" >&2; exit 1; }

if cmp -s "$PREV" "$SNAPSHOT"; then
  echo "no snapshot change"
  exit 0
fi

# The snapshot is ~22MB. Committing it nightly added a few MB to the repo every
# night, and that cost scales with refresh frequency — which is exactly the knob
# we want to be free to turn up. So publish it on a detached, single-commit
# branch (force-pushed, so the remote never accumulates history) and commit only
# the small meta file to main.
blob="$(git hash-object -w "$SNAPSHOT")"
tree="$(printf '100644 blob %s\tsnapshot.json\n' "$blob" | git mktree)"
commit="$(git commit-tree "$tree" -m "snapshot $(date -u +%FT%TZ)")"
git push --force origin "$commit:refs/heads/snapshot"
echo "snapshot published to refs/heads/snapshot"

if ! git diff --quiet -- "$META"; then
  git add "$META"
  git commit -m "data: refresh snapshot ($(date -u +%FT%TZ))"
  # main can move while the multi-hour ingest runs (merged PRs), making a plain
  # push non-fast-forward. Rebase the one meta commit onto wherever main is now
  # and retry; if main also touched the meta file, ours is the freshest (-X
  # theirs favours the replayed commit under rebase).
  for attempt in 1 2 3; do
    git push origin HEAD:main && break
    if [ "$attempt" -eq 3 ]; then
      echo "failed to push meta after $attempt attempts" >&2
      exit 1
    fi
    echo "push rejected (main moved during the run) — rebasing and retrying"
    git fetch origin main
    git rebase -X theirs origin/main || { git rebase --abort; exit 1; }
  done
  echo "meta committed + pushed"
else
  echo "meta unchanged"
fi

# Announce new and closed job URLs. Best-effort: a missed ping costs freshness,
# whereas failing here would leave the board published but the run marked failed.
npm run -s notify -w @aiengjobs/engine -- "$PREV" "$SNAPSHOT" ||
  echo "  ! notify failed (non-fatal)"
