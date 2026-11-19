#!/usr/bin/env bash
#
# Stores the off-site bucket's credentials in ~/ops/offsite.env (0600) — but only after proving
# they work: it writes, reads back and deletes a probe object first. Run ON THE SERVER, with a
# terminal (ssh -t):
#
#   ssh -t korva@13.140.174.3 '~/ops/set-offsite.sh'
#
# It asks for four things from the Cloudflare dashboard (R2 → the bucket, and R2 → Manage API
# tokens → an "Object Read & Write" token limited to that bucket):
#   - the S3 endpoint  https://<account-id>.r2.cloudflarestorage.com  (the account ID alone works)
#   - the Access Key ID
#   - the Secret Access Key  (not echoed)
#   - the bucket name
#
# Nothing is ever an argument or printed back: argv is readable by any local user through /proc.
#
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${KORVA_OFFSITE_ENV_FILE:-$HERE/offsite.env}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[[ -t 0 ]] || { log "FATAL: needs a terminal — run it with ssh -t"; exit 1; }
[[ -x "$HERE/backup-offsite.sh" ]] || { log "FATAL: $HERE/backup-offsite.sh is missing"; exit 1; }

read -rp "S3 endpoint (or account ID): " ENDPOINT_INPUT
read -rp "Access Key ID: " KEY_ID
read -rsp "Secret Access Key (not echoed): " SECRET
echo
read -rp "Bucket name: " BUCKET

ENDPOINT_INPUT="$(printf '%s' "$ENDPOINT_INPUT" | tr -d '[:space:]')"
KEY_ID="$(printf '%s' "$KEY_ID" | tr -d '[:space:]')"
SECRET="$(printf '%s' "$SECRET" | tr -d '[:space:]')"
BUCKET="$(printf '%s' "$BUCKET" | tr -d '[:space:]')"

# Accept the account ID alone, or the URL as the dashboard shows it — which, on a bucket's page,
# ends with "/<bucket>": keep scheme and host only, and take the bucket from the path if needed.
if [[ "$ENDPOINT_INPUT" =~ ^[0-9a-f]{32}$ ]]; then
  ENDPOINT="https://$ENDPOINT_INPUT.r2.cloudflarestorage.com"
elif [[ "$ENDPOINT_INPUT" =~ ^https://([a-z0-9.-]+\.r2\.cloudflarestorage\.com)(/([a-z0-9-]+))?/?$ ]]; then
  ENDPOINT="https://${BASH_REMATCH[1]}"
  [[ -z "$BUCKET" && -n "${BASH_REMATCH[3]:-}" ]] && BUCKET="${BASH_REMATCH[3]}"
else
  log "FATAL: that is neither an R2 account ID nor https://<id>.r2.cloudflarestorage.com"
  exit 1
fi
[[ "$KEY_ID" =~ ^[A-Za-z0-9]{16,128}$ ]] || { log "FATAL: the Access Key ID does not look right"; exit 1; }
[[ -n "$SECRET" ]] || { log "FATAL: empty Secret Access Key"; exit 1; }
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || { log "FATAL: '$BUCKET' is not a valid bucket name"; exit 1; }

CANDIDATE="$(mktemp "$HERE/.offsite.env.XXXXXX")"
trap 'rm -f "$CANDIDATE"' EXIT INT TERM
chmod 600 "$CANDIDATE"
{
  printf 'R2_ENDPOINT=%q\n' "$ENDPOINT"
  printf 'R2_ACCESS_KEY_ID=%q\n' "$KEY_ID"
  printf 'R2_SECRET_ACCESS_KEY=%q\n' "$SECRET"
  printf 'R2_BUCKET=%q\n' "$BUCKET"
} > "$CANDIDATE"

log "testing the bucket before saving anything…"
if ! KORVA_OFFSITE_ENV_FILE="$CANDIDATE" "$HERE/backup-offsite.sh" --check; then
  log "FATAL: the bucket refused the test — nothing saved. Check that the token has"
  log "       'Object Read & Write' on bucket '$BUCKET' and that the endpoint is the account's."
  exit 1
fi

if [[ -e "$TARGET" ]]; then
  cp -p "$TARGET" "$TARGET.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  log "previous settings kept as $(basename "$TARGET").bak-…"
fi
mv "$CANDIDATE" "$TARGET"
chmod 600 "$TARGET"
log "saved to $TARGET (0600). Tonight's backup will also go to R2 bucket '$BUCKET'."
log "send one now:  ~/ops/backup-offsite.sh   — and see it:  ~/ops/backup-offsite.sh --list"
