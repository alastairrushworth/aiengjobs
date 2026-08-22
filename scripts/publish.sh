#!/usr/bin/env bash
# Nightly refresh, phase 2: publish the snapshot, commit its meta file, and tell
# search engines what changed.
#
# Runs only after the workflow has already persisted the database (see the
# ordering note in scripts/refresh.sh). Everything in here is therefore safe to
# fail: the cost is a night's publication, never a night's ingest.
set -euo pipefail

cd "$(dirname "$0")/.."

SNAPSHOT=site/src/data/snapshot.json
META=site/src/data/snapshot.meta.json
# The record of what /daily/rss.xml has already announced. Committed for the
# same reason META is, and load-bearing in a way META is not: it is the only
# copy of that history, and re-deriving it from a later snapshot gives different
# answers (see engine/src/export/dailyPicks.ts).
PICKS=site/src/data/daily-picks.json
PREV=data/prev-snapshot.json

test -s "$SNAPSHOT" || { echo "no snapshot to publish" >&2; exit 1; }
# Absent only if phase 1 found no published branch to diff against; an empty
# file compares unequal to any real snapshot, which is the behaviour we want.
test -f "$PREV" || : > "$PREV"

if cmp -s "$PREV" "$SNAPSHOT"; then
  echo "no snapshot change"
  exit 0
fi

# The snapshot is ~32MB. Committing it nightly added a few MB to the repo every
# night, and that cost scales with refresh frequency — which is exactly the knob
# we want to be free to turn up. So publish it on a detached, single-commit
# branch (force-pushed, so the remote never accumulates history) and commit only
# the small meta file to main.
blob="$(git hash-object -w "$SNAPSHOT")"
tree="$(printf '100644 blob %s\tsnapshot.json\n' "$blob" | git mktree)"
commit="$(git commit-tree "$tree" -m "snapshot $(date -u +%FT%TZ)")"
git push --force origin "$commit:refs/heads/snapshot"
echo "snapshot published to refs/heads/snapshot"

if ! git diff --quiet -- "$META" "$PICKS"; then
  git add "$META" "$PICKS"
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
