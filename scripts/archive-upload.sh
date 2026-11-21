#!/usr/bin/env bash
# Upload archive files to R2 and confirm each one to the engine.
#
#   scripts/archive-upload.sh <dir>                 # tonight's change log(s)
#   scripts/archive-upload.sh --monthly-db <file>   # this month's database copy, once
#
# Needs AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (an R2 API token's S3
# credentials), R2_ACCOUNT_ID and ARCHIVE_BUCKET.
#
# Every key is written exactly once. A change log is named for its run's
# timestamp, so two runs can never collide, and the upload refuses to replace
# an object that already exists: the archive is append-only, and a bug that
# tried to rewrite history should fail loudly rather than succeed.
set -euo pipefail

: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" "${R2_ACCOUNT_ID:?}" "${ARCHIVE_BUCKET:?}"

export AWS_DEFAULT_REGION=auto
# Newer AWS CLIs add a CRC trailer by default, which not every S3-compatible
# store accepts. Asking for checksums only where the API requires them is
# correct against R2 either way.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

exists() {
  aws s3api head-object --endpoint-url "$ENDPOINT" --bucket "$ARCHIVE_BUCKET" --key "$1" >/dev/null 2>&1
}

# Upload, then read the size back: "the command exited 0" and "the object is
# there and whole" are different claims, and only the second lets the engine
# delete what the file records.
put() {
  local file=$1 key=$2 want got
  want=$(wc -c < "$file" | tr -d ' ')
  aws s3 cp "$file" "s3://${ARCHIVE_BUCKET}/${key}" --endpoint-url "$ENDPOINT" --only-show-errors
  got=$(aws s3api head-object --endpoint-url "$ENDPOINT" --bucket "$ARCHIVE_BUCKET" --key "$key" \
    --query ContentLength --output text)
  [ "$want" = "$got" ] || { echo "size mismatch for $key: wrote $want, stored $got" >&2; return 1; }
}

if [ "${1:-}" = "--monthly-db" ]; then
  file=${2:?usage: archive-upload.sh --monthly-db <file>}
  key="db/$(date -u +%Y-%m).db.gz"
  if exists "$key"; then
    echo "monthly copy $key already stored"
  else
    put "$file" "$key"
    echo "stored monthly database copy at $key"
  fi
  exit 0
fi

dir=${1:?usage: archive-upload.sh <dir>}
shopt -s nullglob
files=("$dir"/*.jsonl.gz)
if [ ${#files[@]} -eq 0 ]; then
  echo "no archive files in $dir"
  exit 0
fi

for file in "${files[@]}"; do
  name=$(basename "$file")
  # runs/2026/11/2026-11-22T23-14-05-123Z.jsonl.gz
  key="runs/${name:0:4}/${name:5:2}/${name}"
  if exists "$key"; then
    echo "$key already stored"
  else
    put "$file" "$key"
    echo "stored $key ($(wc -c < "$file" | tr -d ' ') bytes)"
  fi
  # Only now is it safe for the engine to stop holding these rows back.
  # ARCHIVE_NO_COMMIT=1 skips this, for uploading a file by hand that no
  # working database is waiting on (the baseline, a re-upload).
  if [ -z "${ARCHIVE_NO_COMMIT:-}" ]; then
    npm run -s archive:commit -w @aiengjobs/engine -- "$name"
  fi
done
