#!/usr/bin/env bash
#
# Installs (or re-installs) the nightly MongoDB backup in the invoking user's crontab.
# Idempotent: re-running replaces the existing KORVA entry rather than adding a second one.
#
# Run ON THE SERVER, as the user that owns ~/korva-os/.env.production:
#   ~/ops/install-backup-cron.sh
#
set -euo pipefail

SCRIPT="${KORVA_BACKUP_SCRIPT:-$HOME/ops/backup-mongo.sh}"
LOG="${KORVA_BACKUP_LOG:-$HOME/backups/backup.log}"
# 03:17 rather than 03:00 — a whole-hour schedule is when every other cron on every other host
# fires, and Atlas's free tier shares its hardware.
SCHEDULE="${KORVA_BACKUP_SCHEDULE:-17 3 * * *}"
MARKER='# KORVA_MONGO_BACKUP'

[[ -x "$SCRIPT" ]] || { echo "FATAL: $SCRIPT is not executable"; exit 1; }

mkdir -p "$(dirname "$LOG")"

# cron runs with a near-empty PATH and no login shell, so `docker` must be found explicitly;
# resolving it here (at install time, in a real shell) rather than hardcoding /usr/bin/docker
# keeps this working wherever docker lives.
DOCKER_DIR="$(dirname "$(command -v docker)")"

# `|| true`: crontab -l exits 1 when there is no crontab yet, which `set -e` would treat as fatal.
EXISTING="$(crontab -l 2>/dev/null || true)"
# Drop any previous KORVA entry (the marker line and the job line that follows it).
CLEANED="$(printf '%s\n' "$EXISTING" | grep -v -F "$MARKER" || true)"

{
  printf '%s\n' "$CLEANED" | sed '/^$/d'
  printf '%s\n' "$MARKER"
  printf 'PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$DOCKER_DIR"
  # Output is appended, not mailed: cron mail is not configured on this host and a silent
  # failure is the whole problem a backup job is supposed to not have. 2>&1 keeps mongodump's
  # diagnostics in the same file, already scrubbed of the URI by backup-mongo.sh itself.
  printf '%s %s >> %s 2>&1 %s\n' "$SCHEDULE" "$SCRIPT" "$LOG" "$MARKER"
} | crontab -

echo "installed:"
crontab -l | grep -A2 -F "$MARKER"
echo
echo "log: $LOG"
echo "next step a human still has to take: copy these archives OFF this host, and move Atlas"
echo "off the free M0 tier — a backup stored on the machine it backs up does not survive losing it."
