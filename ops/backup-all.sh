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
# DEAD MAN'S SWITCH. Everything above detects a backup that FAILED. Nothing detects one that
# never RAN — and that is the likelier accident: on 2026-10-18 this host was off for 37 minutes,
# and had that window covered 03:17 the nightly backup would simply not have happened. No error,
# no log line, nothing to notice, and a cron log that still ends in "complete" from the night
# before. The only way to catch an absence is for something OUTSIDE this machine to expect a
# signal and complain when it does not arrive.
#
# So: when a ping URL is configured, this script reports success to it. If the report stops
# arriving, the monitoring service raises the alarm on its own. Configure it in ~/ops/backup.env
# (0600), which is sourced below if present:
#
#     KORVA_BACKUP_PING_URL=https://hc-ping.com/<uuid>
#     # optional; defaults to "$KORVA_BACKUP_PING_URL/fail"
#     KORVA_BACKUP_PING_FAIL_URL=
#
# Provider-agnostic on purpose — healthchecks.io, Better Stack and Cronitor all accept a plain
# GET on a secret URL. The URL is a capability, which is why it lives in a 0600 file and not in
# the crontab, where `crontab -l` would print it.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PING_ENV="${KORVA_BACKUP_ENV_FILE:-$HERE/backup.env}"
# shellcheck disable=SC1090  # path is operator-provided by design
[[ -r "$PING_ENV" ]] && . "$PING_ENV"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Never allowed to affect the outcome: the backup already happened (or did not) before this runs,
# and a monitoring service being unreachable must not turn a good night into a failed one — nor
# hang the cron job, hence the timeouts. Logged either way, because a ping that silently stops
# working would quietly disarm the very alarm this exists to set.
ping_monitor() {
  local url="$1" label="$2"
  [[ -n "${url:-}" ]] || return 0
  if curl -fsS -m 10 --retry 2 --retry-delay 3 -o /dev/null "$url"; then
    log "monitor pinged ($label)"
  else
    log "WARNING: could not reach the monitoring service ($label) — the backup itself is"
    log "         unaffected, but the alarm for a MISSING backup is now unreliable"
  fi
}

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
  ping_monitor "${KORVA_BACKUP_PING_URL:-}" "success"
else
  log "=== nightly backup FINISHED WITH FAILURES — read the two sections above ==="
  # Report the failure explicitly rather than just staying silent and letting the schedule
  # expire: an immediate alert beats one that arrives whenever the grace period runs out.
  ping_monitor \
    "${KORVA_BACKUP_PING_FAIL_URL:-${KORVA_BACKUP_PING_URL:+${KORVA_BACKUP_PING_URL}/fail}}" \
    "failure"
fi
exit "$STATUS"
