#!/usr/bin/env bash
set -euo pipefail

# MongoDB refuses to start with --replSet + auth enabled unless a keyFile is set
# (internal cluster auth, required even for a single-node replica set — see
# the audit note in docker-compose.yml). This generates one on first boot and
# reuses it on every later start, so the dev keyfile lives only in the
# korva_mongodb_keyfile volume — never committed to git, never touching the
# app's real secrets.
KEYFILE=/data/keyfile/mongo-keyfile

if [ ! -f "$KEYFILE" ]; then
  mkdir -p "$(dirname "$KEYFILE")"
  head -c 756 /dev/urandom | base64 -w 0 > "$KEYFILE"
fi
chmod 400 "$KEYFILE"
chown mongodb:mongodb "$KEYFILE"

exec docker-entrypoint.sh "$@"
