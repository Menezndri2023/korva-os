#!/usr/bin/env bash
#
# Copies the newest database and uploads archives OFF this host, to an S3-compatible bucket
# (Cloudflare R2), and keeps RETAIN_DAYS of them there. Run ON THE SERVER; backup-all.sh calls it
# after the two local backups. Configure it once with ops/set-offsite.sh.
#
#   ~/ops/backup-offsite.sh            push the newest archives (what cron does)
#   ~/ops/backup-offsite.sh --list     what the bucket holds
#   ~/ops/backup-offsite.sh --fetch korva-20261119T031700Z.archive.gz
#                                      download one into ~/backups (then verify-backup.sh it)
#   ~/ops/backup-offsite.sh --check    write, read back and delete a probe object (no archive)
#
# WHY. backup-mongo.sh and backup-uploads.sh write to ~/backups on this VPS: they protect against
# a bad migration or a mistaken delete, not against losing the VPS. Atlas M0 has no backup of its
# own. This is the copy that survives the machine.
#
# CREDENTIALS. They live in ~/ops/offsite.env (0600), written by set-offsite.sh — never in the
# crontab, never on a command line. rclone reads them from a config file generated into a 0700
# temporary directory for the run and deleted on every exit path (trap), the same discipline as
# backup-mongo.sh's mongo.yaml: a container image once printed its whole argv into a crash log.
#
# NOT ENCRYPTED CLIENT-SIDE, deliberately. The bucket is private and R2 encrypts at rest. A
# client-side key would have to live on this server — the very machine whose loss this guards
# against — so losing the server would also lose the only key that opens the backups.
#
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFSITE_ENV="${KORVA_OFFSITE_ENV_FILE:-$HERE/offsite.env}"
BACKUP_DIR="${KORVA_BACKUP_DIR:-$HOME/backups}"
RETAIN_DAYS="${KORVA_OFFSITE_RETAIN_DAYS:-30}"
IMAGE="${OFFSITE_RCLONE_IMAGE:-rclone/rclone:1.68.2}"
PREFIX="korva"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[[ -r "$OFFSITE_ENV" ]] || {
  log "FATAL: $OFFSITE_ENV not found — run ~/ops/set-offsite.sh first"
  exit 1
}
# shellcheck disable=SC1090  # path is operator-provided by design
. "$OFFSITE_ENV"
for var in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [[ -n "${!var:-}" ]] || { log "FATAL: $var is empty in $OFFSITE_ENV"; exit 1; }
done

CFG_DIR="$(mktemp -d)"
trap 'rm -rf "$CFG_DIR"' EXIT INT TERM
# no_check_bucket: a token scoped to one bucket may not create buckets, and rclone would try.
cat > "$CFG_DIR/rclone.conf" <<EOF
[r2]
type = s3
provider = Cloudflare
endpoint = $R2_ENDPOINT
access_key_id = $R2_ACCESS_KEY_ID
secret_access_key = $R2_SECRET_ACCESS_KEY
acl = private
no_check_bucket = true
EOF
chmod 600 "$CFG_DIR/rclone.conf"

# Never echo the config: rclone prints the remote and path on errors, not the keys, but the
# scrub is cheap and this output goes to a log file.
scrub() { sed -E "s#${R2_SECRET_ACCESS_KEY//#/\\#}#***REDACTED***#g; s#${R2_ACCESS_KEY_ID//#/\\#}#***REDACTED***#g"; }

rclone() {
  docker run --rm -i --user "$(id -u):$(id -g)" \
    -v "$CFG_DIR:/config:ro" -v "$BACKUP_DIR:/data" \
    "$IMAGE" --config /config/rclone.conf "$@" 2> >(scrub >&2)
}

REMOTE="r2:$R2_BUCKET/$PREFIX"

case "${1:-}" in
  --list)
    rclone lsl "$REMOTE" | sort -k2,3
    exit 0
    ;;
  --fetch)
    NAME="${2:-}"
    [[ "$NAME" =~ ^(korva-[0-9TZ]+\.archive\.gz|uploads-[0-9TZ]+\.tar\.gz)$ ]] || {
      log "usage: $0 --fetch <korva-…archive.gz | uploads-…tar.gz> (see --list)"
      exit 1
    }
    mkdir -p "$BACKUP_DIR"
    rclone copyto "$REMOTE/$NAME" "/data/$NAME"
    chmod 600 "$BACKUP_DIR/$NAME"
    log "fetched $BACKUP_DIR/$NAME — restore-test it with ~/ops/verify-backup.sh $BACKUP_DIR/$NAME"
    exit 0
    ;;
  --check)
    PROBE=".probe-$(date -u +%Y%m%dT%H%M%SZ)"
    printf 'korva off-site probe\n' | rclone rcat "$REMOTE/$PROBE"
    [[ "$(rclone cat "$REMOTE/$PROBE")" == "korva off-site probe" ]] || {
      log "FATAL: the probe object did not read back"
      exit 1
    }
    rclone deletefile "$REMOTE/$PROBE"
    log "off-site bucket reachable: wrote, read back and deleted a probe in $R2_BUCKET/$PREFIX"
    exit 0
    ;;
  "") ;;
  *) log "unknown option $1"; exit 1 ;;
esac

newest() { find "$BACKUP_DIR" -maxdepth 1 -name "$1" -printf '%T@ %f\n' | sort -nr | head -1 | cut -d' ' -f2; }

STATUS=0
PUSHED=0
for pattern in 'korva-*.archive.gz' 'uploads-*.tar.gz'; do
  NAME="$(newest "$pattern")"
  if [[ -z "$NAME" ]]; then
    # uploads-* legitimately may not exist (backup-uploads.sh skips an empty volume).
    log "no local $pattern to send"
    continue
  fi
  LOCAL_SIZE="$(stat -c %s "$BACKUP_DIR/$NAME")"
  # copyto, never sync: a sync mirrors deletions, so an emptied ~/backups would empty the bucket.
  if ! rclone copyto "/data/$NAME" "$REMOTE/$NAME"; then
    log "FAILED to send $NAME"
    STATUS=1
    continue
  fi
  # Arrival is not integrity: compare the size the bucket reports with the local file.
  # --stat prints indented JSON ("Size": 4023), so tolerate the space.
  REMOTE_SIZE="$(rclone lsjson --stat "$REMOTE/$NAME" | sed -nE 's/.*"Size":[[:space:]]*([0-9]+).*/\1/p')"
  if [[ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]]; then
    log "FAILED: $NAME is $LOCAL_SIZE bytes here but ${REMOTE_SIZE:-?} in the bucket"
    STATUS=1
    continue
  fi
  log "sent $NAME ($LOCAL_SIZE bytes, size confirmed in the bucket)"
  PUSHED=$((PUSHED + 1))
done

# Retention only after a successful push, so a broken night never thins the copies that remain.
if (( STATUS == 0 && PUSHED > 0 )); then
  rclone delete "$REMOTE" --min-age "${RETAIN_DAYS}d" --include 'korva-*.archive.gz' --include 'uploads-*.tar.gz'
  log "off-site retention: kept $RETAIN_DAYS days"
fi
exit "$STATUS"
