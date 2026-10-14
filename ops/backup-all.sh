#!/usr/bin/env bash
#
# The nightly backup: the database and the tenant uploads, in that order.
#
# This is what cron runs. The two parts are useless apart — Mongo stores only the
# `/api/v1/uploads/:orgId/:filename` URL of each image, so a restored database without an
# uploads archive gives every customer a storefront full of broken images.
#
# Both halves run even if the first fails, and the exit code reflects the worst outcome, so a
# broken database dump can never quietly cancel the uploads archive (or the reverse) and leave a
# log that looks like a clean night.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

STATUS=0

log "=== database ==="
if ! "$HERE/backup-mongo.sh"; then
  log "database backup FAILED"
  STATUS=1
fi

log "=== uploads ==="
if ! "$HERE/backup-uploads.sh"; then
  log "uploads backup FAILED"
  STATUS=1
fi

if (( STATUS == 0 )); then
  log "=== nightly backup complete ==="
else
  log "=== nightly backup FINISHED WITH FAILURES — read the two sections above ==="
fi
exit "$STATUS"
