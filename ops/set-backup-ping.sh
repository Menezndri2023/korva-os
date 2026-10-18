#!/usr/bin/env bash
#
# Configures the backup dead man's switch, and REFUSES to write a URL that does not work.
# Run ON THE SERVER:
#
#   ~/ops/set-backup-ping.sh
#
# WHY THIS EXISTS RATHER THAN A ONE-LINER. The one-liner it replaces had `TON-UUID` in it as a
# placeholder, and was pasted verbatim — which is the predictable outcome of putting a
# placeholder inside something designed to be copied. healthchecks.io answered 400, and the
# nightly job would have logged a warning every night while the alarm stayed disarmed.
#
# A monitoring switch that is misconfigured is worse than one that is absent: the absent one is
# obvious, the misconfigured one looks installed. So this pings the URL BEFORE writing it and
# keeps the old configuration if the ping fails. A URL that cannot be reached never becomes the
# thing you are relying on.
#
set -euo pipefail
umask 077

ENV_FILE="${KORVA_BACKUP_ENV_FILE:-$HOME/ops/backup.env}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Read visibly, not with `read -s`. It is a capability, so it is stored 0600 — but a URL pasted
# from a browser is worth seeing before it is committed to, because a typo here disarms the alarm
# silently, and that costs more than the small risk of it being on screen. It lands in terminal
# scrollback either way.
echo "Paste the ping URL from your monitoring service."
echo "healthchecks.io looks like: https://hc-ping.com/0123abcd-....-....-....-............"
read -rp "URL: " URL

URL="${URL#"${URL%%[![:space:]]*}"}"   # trim leading whitespace
URL="${URL%"${URL##*[![:space:]]}"}"   # trim trailing whitespace

[[ -n "$URL" ]] || { log "FATAL: empty, nothing written"; exit 1; }

[[ "$URL" =~ ^https?://[A-Za-z0-9.-]+/.+ ]] || {
  log "FATAL: that does not look like a ping URL (expected https://host/path)"
  exit 1
}

# The exact failure that happened: a placeholder pasted as if it were a value.
if [[ "$URL" =~ (TON-UUID|YOUR-UUID|VOTRE-UUID|\<uuid\>|TON_UUID|example\.com) ]]; then
  log "FATAL: that is still the placeholder, not your own URL."
  log "       Create the check on your monitoring service first, then paste ITS url."
  exit 1
fi

log "testing the URL before writing it"
if ! curl -fsS -m 10 --retry 2 --retry-delay 3 -o /dev/null "$URL"; then
  log "FATAL: that URL did not accept a ping, so it is NOT being written."
  log "       Nothing changed — the previous configuration (if any) is untouched."
  log "       Check you copied the whole URL, and that the check still exists."
  exit 1
fi
log "the monitoring service accepted a test ping"

[[ -f "$ENV_FILE" ]] && log "note: replacing the existing $(basename "$ENV_FILE")"

# Written through a temp file and moved into place, so a crash halfway cannot leave a truncated
# file that `backup-all.sh` would then source.
TMP="$(mktemp "${ENV_FILE}.XXXXXX")"
{
  printf '# Backup dead man'"'"'s switch — read by ops/backup-all.sh.\n'
  printf '# Written by ops/set-backup-ping.sh on %s after a successful test ping.\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '# This URL is a capability: anyone holding it can report your backup as healthy.\n'
  printf 'KORVA_BACKUP_PING_URL=%s\n' "$URL"
} > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"
log "written to $ENV_FILE (0600)"

log "running the real backup now, so the switch is verified end to end"
"$HOME/ops/backup-all.sh" | tail -4
