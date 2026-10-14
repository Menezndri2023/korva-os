#!/usr/bin/env bash
#
# Copies the production backup archives OFF the production host, onto the machine you run this
# from. Run it from your own computer, not from the server.
#
#   ops/pull-backups.sh
#
# WHY THIS IS NOT OPTIONAL. ops/backup-mongo.sh and ops/backup-uploads.sh write to ~/backups on
# the VPS, which protects against a bad migration or a mistaken delete inside the data — and not
# at all against losing the VPS. A backup stored on the machine it backs up is not a backup of
# that machine. Until the archives also live somewhere else, the whole business still has a
# single point of failure, and the nightly cron can give a false sense that it does not.
#
# This is the version that needs no new account. It is also the weakest one, because it only runs
# when you remember to run it: a laptop that is asleep copies nothing. Object storage with a
# scheduled push is the real answer when you are ready to create that account.
#
set -euo pipefail
umask 077

HOST="${KORVA_SSH_HOST:-korva@13.140.174.3}"
REMOTE_DIR="${KORVA_REMOTE_BACKUP_DIR:-backups}"
LOCAL_DIR="${KORVA_LOCAL_BACKUP_DIR:-$HOME/korva-backups}"
# How many of the newest archives of EACH kind to fetch. The server keeps 14 days; there is no
# reason to re-download all of them every time.
KEEP="${KORVA_PULL_COUNT:-5}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

# Ask the server which files to take, newest first, rather than globbing blindly: the two kinds
# rotate independently and `uploads-*` may legitimately not exist yet.
# shellcheck disable=SC2029  # $REMOTE_DIR and $KEEP are meant to expand locally.
FILES="$(ssh "$HOST" "ls -1t $REMOTE_DIR/korva-*.archive.gz 2>/dev/null | head -$KEEP; ls -1t $REMOTE_DIR/uploads-*.tar.gz 2>/dev/null | head -$KEEP")"

if [[ -z "${FILES//[[:space:]]/}" ]]; then
  log "FATAL: no archives found in $HOST:$REMOTE_DIR — has the backup ever run?"
  exit 1
fi

COUNT=0
while IFS= read -r remote; do
  [[ -n "$remote" ]] || continue
  name="$(basename "$remote")"
  if [[ -s "$LOCAL_DIR/$name" ]]; then
    log "already here, skipping: $name"
    continue
  fi
  log "fetching $name"
  # -p preserves the modification time, which is what the local pruning below sorts on.
  scp -q -p "$HOST:$remote" "$LOCAL_DIR/$name"
  chmod 600 "$LOCAL_DIR/$name"
  COUNT=$((COUNT + 1))
done <<< "$FILES"

log "fetched $COUNT new archive(s) into $LOCAL_DIR"

# Integrity, not just arrival: gzip -t reads the whole stream and fails on a truncated transfer.
# A silently half-copied archive is the one failure this script could otherwise introduce.
BAD=0
for f in "$LOCAL_DIR"/korva-*.archive.gz "$LOCAL_DIR"/uploads-*.tar.gz; do
  [[ -e "$f" ]] || continue
  if ! gzip -t "$f" 2>/dev/null; then
    log "CORRUPT: $(basename "$f") — delete it and re-run"
    BAD=$((BAD + 1))
  fi
done
if (( BAD > 0 )); then
  log "FATAL: $BAD corrupt archive(s) locally"
  exit 1
fi

log "all local archives pass gzip -t"
log "on hand: $(find "$LOCAL_DIR" -maxdepth 1 -name '*.gz' | wc -l | tr -d '[:space:]') file(s) in $LOCAL_DIR"
log "NOTE: these hold every customer record. They are 0600 in a 0700 directory; keep them that way."
log "NOTE: restoring one is ops/verify-backup.sh on the server, which also proves it is readable."
