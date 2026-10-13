#!/usr/bin/env bash
#
# Restores a backup archive into a throwaway mongod and prints what came back, then destroys it.
#
# WHY A SEPARATE SCRIPT, AND WHY IT MATTERS MORE THAN THE DUMP. An archive nobody has ever
# restored is not a backup, it is a file. `mongorestore --dryRun` does not help: it still opens a
# connection to a target server, so there is no way to validate an archive without somewhere to
# put it. This spins up a disposable mongod on its own Docker network with NO published port,
# restores into it, counts what landed, and removes both.
#
# Usage:  ops/verify-backup.sh [archive]      (default: the newest in ~/backups)
#
set -euo pipefail
umask 077

IMAGE="${BACKUP_MONGO_IMAGE:-mongodb/mongodb-community-server:7.0-ubi8}"
BACKUP_DIR="${KORVA_BACKUP_DIR:-$HOME/backups}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

ARCHIVE_PATH="${1:-$(find "$BACKUP_DIR" -maxdepth 1 -name 'korva-*.archive.gz' -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2-)}"
[[ -n "${ARCHIVE_PATH:-}" && -r "$ARCHIVE_PATH" ]] || { log "FATAL: no readable archive found"; exit 1; }
ARCHIVE="$(basename "$ARCHIVE_PATH")"

NET="verifybackup-$$"
CONTAINER="verifymongo-$$"
# Tear down on every exit path, so a failed verification never leaves a stray mongod running.
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

log "verifying $ARCHIVE ($(stat -c %s "$ARCHIVE_PATH") bytes)"
docker network create "$NET" >/dev/null
# No -p: reachable only from inside $NET. This mongod has no authentication, so publishing a
# port would expose every restored document to the internet for the length of the check.
docker run -d --name "$CONTAINER" --network "$NET" "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker run --rm --network "$NET" --entrypoint mongosh "$IMAGE" \
      --quiet "mongodb://$CONTAINER:27017/admin" --eval 'db.runCommand({ping:1}).ok' 2>/dev/null \
      | grep -q 1; then
    break
  fi
  sleep 2
done

docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -v "$BACKUP_DIR:/out" \
  --entrypoint mongorestore "$IMAGE" \
  --uri="mongodb://$CONTAINER:27017" --archive="/out/$ARCHIVE" --gzip 2>&1 \
  | grep -E 'document\(s\) restored|error' | tail -3

log "restored contents:"
docker run --rm --network "$NET" --entrypoint mongosh "$IMAGE" \
  --quiet "mongodb://$CONTAINER:27017/korva" --eval '
  const counts = {};
  for (const c of db.getCollectionNames().sort()) {
    const n = db[c].countDocuments();
    if (n) counts[c] = n;
  }
  print(JSON.stringify(counts, null, 1));
  // The three rows that say the restore is coherent rather than merely non-empty: at least one
  // organization, the full plan catalog, and the migration ledger the next deploy reads.
  print("organizations: " + db.organizations.find({}, {name:1, slug:1, _id:0}).toArray()
    .map(o => o.name + "/" + o.slug).join(", "));
  print("plans: " + db.plans.countDocuments() + " rows in " +
    db.plans.distinct("priceCurrency").sort().join(","));
  print("migrations applied: " + db.migrations.distinct("name").sort().join(", "));
'
log "throwaway mongod removed"
