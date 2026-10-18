#!/usr/bin/env bash
#
# Sets one secret in ~/korva-os/.env.production, recreates the api container, and verifies it
# came back. Run ON THE SERVER:
#
#   ~/ops/set-secret.sh SENTRY_DSN
#   ~/ops/set-secret.sh RESEND_API_KEY
#
# The value is read with `read -s`: never an argument, never printed, never in shell history.
# That matters more than it looks — a container image's own entrypoint once printed its whole
# argv, Atlas password included, into a crash message (see ops/backup-mongo.sh).
#
# REFUSES A VARIABLE THAT IS NOT ALREADY IN THE FILE, deliberately. Every name the application
# reads is present in .env.production (blank when unset), so a name that is missing is a typo —
# and a typo would otherwise add a dead variable that looks set, while the real one stays empty.
# That failure is silent and can survive for months.
#
set -euo pipefail
umask 077

VAR="${1:-}"
[[ -n "$VAR" ]] || { echo "usage: $0 <VARIABLE_NAME>"; exit 1; }
[[ "$VAR" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "FATAL: '$VAR' is not a plausible env var name"; exit 1; }

ENV_FILE="${KORVA_ENV_FILE:-$HOME/korva-os/.env.production}"
COMPOSE_DIR="${KORVA_COMPOSE_DIR:-$HOME/korva-os}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

api_healthy() {
  # /health/database, not /health: the latter answers from a literal and never touches Mongo, so
  # it would call a broken deploy healthy. Runs inside the container because no app service
  # publishes a host port — only Caddy binds one.
  "${COMPOSE[@]}" exec -T api node -e '
    fetch("http://127.0.0.1:4000/api/v1/health/database")
      .then((r) => process.exit(r.ok ? 0 : 1))
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1
}

[[ -w "$ENV_FILE" ]] || { log "FATAL: cannot write $ENV_FILE"; exit 1; }
grep -qE "^${VAR}=" "$ENV_FILE" || {
  log "FATAL: $VAR is not declared in $(basename "$ENV_FILE"). If the application really reads"
  log "       it, add the blank line to .env.production.example first, then here — do not let"
  log "       this script invent a name."
  exit 1
}

CURRENT="$(grep -E "^${VAR}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -n "${CURRENT// /}" ]]; then
  log "note: $VAR already has a value (${#CURRENT} characters). Continuing replaces it."
fi

read -rsp "Value for $VAR (not echoed): " VALUE
echo
[[ -n "${VALUE// /}" ]] || { log "FATAL: empty value, nothing done"; exit 1; }

BACKUP="$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP"
log "current env saved to $(basename "$BACKUP")"

# Python, not sed: the value can contain /, &, # or a backslash, any of which would corrupt a
# sed replacement — and a DSN contains both / and @.
VAR="$VAR" VALUE="$VALUE" ENV_FILE="$ENV_FILE" python3 <<'PY'
import os, pathlib, re

var, value = os.environ["VAR"], os.environ["VALUE"]
path = pathlib.Path(os.environ["ENV_FILE"])
text = path.read_text()
new_text, count = re.subn(
    rf"^{re.escape(var)}=.*$",
    lambda _: f"{var}={value}",   # a lambda, so backslashes in the value are never re-escaped
    text,
    flags=re.MULTILINE,
)
if count != 1:
    raise SystemExit(f"refusing to write: expected exactly 1 {var} line, matched {count}")
path.write_text(new_text)
PY

chmod 600 "$ENV_FILE"
log "$VAR written (${#VALUE} characters)"

log "recreating the api container"
cd "$COMPOSE_DIR"
"${COMPOSE[@]}" up -d --no-build --force-recreate api >/dev/null 2>&1

for i in $(seq 1 30); do
  if api_healthy; then
    log "api healthy after ${i} attempt(s)"
    log "the previous env file is at $(basename "$BACKUP") — it contains live secrets, so delete"
    log "it once you are satisfied: shred -u ~/korva-os/$(basename "$BACKUP")"
    exit 0
  fi
  sleep 3
done

log "FATAL: api did not come back — rolling back to $(basename "$BACKUP")"
cp -p "$BACKUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
"${COMPOSE[@]}" up -d --no-build --force-recreate api >/dev/null 2>&1
log "rolled back. Check: docker compose -f docker-compose.prod.yml logs --tail=50 api"
exit 1
