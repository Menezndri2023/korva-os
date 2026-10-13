#!/usr/bin/env bash
#
# Takes a compressed, verified-restorable archive of the production MongoDB and keeps the last
# RETAIN_DAYS of them. Run ON THE SERVER (it reads ~/korva-os/.env.production); install it in
# cron with `ops/install-backup-cron.sh`.
#
# WHY THIS EXISTS. The Atlas cluster is the free M0 tier, which has NO backups of any kind:
# losing it loses every invoice, payment and organization with no recovery path. M10 (the first
# tier with Atlas's own continuous backups) is the real fix and needs a paid Atlas plan; this
# script is what stands between the business and total loss until then, and it stays useful
# afterwards as an off-Atlas copy.
#
# TWO THINGS THIS SCRIPT DELIBERATELY DOES NOT DO:
#
#   1. It does not put the connection URI on a command line. A command line is readable by any
#      local user through /proc, and on 2026-10-13 a container image's own entrypoint printed
#      its full argv — including the Atlas password — into a crash message. The URI goes into a
#      0600 YAML file that mongodump reads with --config, and that file is deleted on every
#      exit path via `trap`.
#   2. It does not copy the archive off this host. A backup that lives on the machine it is
#      backing up does not survive losing that machine. Sending it to object storage needs
#      credentials nobody has created yet; until then this protects against data loss inside
#      Mongo (a bad migration, a mistaken delete) but NOT against losing the VPS. Treat that as
#      an open gap, not a solved problem.
#
set -euo pipefail
umask 077

IMAGE="${BACKUP_MONGO_IMAGE:-mongodb/mongodb-community-server:7.0-ubi8}"
ENV_FILE="${KORVA_ENV_FILE:-$HOME/korva-os/.env.production}"
BACKUP_DIR="${KORVA_BACKUP_DIR:-$HOME/backups}"
RETAIN_DAYS="${KORVA_BACKUP_RETAIN_DAYS:-14}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Scrubs anything that looks like a Mongo URI out of a stream. Belt and braces: the --config
# file already keeps the URI out of argv, but mongodump can still echo a host string on a
# connection error, and this script's output goes to a log file and to cron mail.
scrub() { sed -E 's#mongodb(\+srv)?://[^ "]*#mongodb://***REDACTED***#g'; }

[[ -r "$ENV_FILE" ]] || { log "FATAL: cannot read $ENV_FILE"; exit 1; }

URI="$(grep -E '^MONGODB_URI=' "$ENV_FILE" | cut -d= -f2-)"
[[ -n "$URI" ]] || { log "FATAL: MONGODB_URI not set in $ENV_FILE"; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

CFG_DIR="$(mktemp -d)"
# Runs on every exit, including a failure or a signal, so the credential never outlives the run.
trap 'rm -rf "$CFG_DIR"' EXIT INT TERM
printf 'uri: %s\n' "$URI" > "$CFG_DIR/mongo.yaml"
chmod 600 "$CFG_DIR/mongo.yaml"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="korva-$STAMP.archive.gz"

# --user: the image runs as its own uid, which can neither read a 0600 config nor write into a
# 0700 directory owned by this user. Running the container as the invoking user fixes both
# without loosening either permission.
log "dumping to $BACKUP_DIR/$ARCHIVE"
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$CFG_DIR:/cfg:ro" -v "$BACKUP_DIR:/out" \
  --entrypoint mongodump "$IMAGE" \
  --config=/cfg/mongo.yaml --archive="/out/$ARCHIVE" --gzip 2>&1 | scrub | tail -2

chmod 600 "$BACKUP_DIR/$ARCHIVE"

SIZE="$(stat -c %s "$BACKUP_DIR/$ARCHIVE")"
# An empty or near-empty archive is the failure mode that looks like success: mongodump exits 0
# having written a valid gzip header and nothing else. 1 KiB is well under any real dump of this
# schema (81 collections of index metadata alone exceed it) and well over an empty one.
if (( SIZE < 1024 )); then
  log "FATAL: $ARCHIVE is only $SIZE bytes — treating as a failed dump"
  exit 1
fi
log "wrote $ARCHIVE ($SIZE bytes)"

# Rotation last, and only after the new archive has been written and sanity-checked, so a failed
# run never deletes the only good copy it had.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'korva-*.archive.gz' -mtime "+$RETAIN_DAYS" -print -delete | wc -l)"
log "retention: kept $RETAIN_DAYS days, removed $DELETED older archive(s)"
log "on hand: $(find "$BACKUP_DIR" -maxdepth 1 -name 'korva-*.archive.gz' | wc -l) archive(s)"
