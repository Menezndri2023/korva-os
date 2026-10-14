#!/usr/bin/env bash
#
# Archives the tenant uploads volume (logos, hero images, product photos) alongside the database
# dumps, and keeps the same retention window.
#
# WHY A SECOND SCRIPT. With STORAGE_PROVIDER=local the images live in the `korva_uploads` Docker
# volume, not in MongoDB — Mongo holds only the `/api/v1/uploads/:orgId/:filename` URL that
# points at them. So a restored database with no uploads archive gives every customer a
# storefront full of broken images. The two have to be taken together to mean anything, which is
# what ops/backup-all.sh is for.
#
# Skips silently (exit 0) when the volume holds nothing, so this is safe to schedule even while
# STORAGE_PROVIDER is still `s3` and the directory is empty — a nightly "0 bytes" archive would
# only make the real ones harder to find.
#
set -euo pipefail
umask 077

VOLUME="${KORVA_UPLOADS_VOLUME:-korva-os_korva_uploads}"
BACKUP_DIR="${KORVA_BACKUP_DIR:-$HOME/backups}"
RETAIN_DAYS="${KORVA_BACKUP_RETAIN_DAYS:-14}"
# Any small image with tar; busybox is already the smallest thing that has one.
TAR_IMAGE="${KORVA_TAR_IMAGE:-busybox:stable}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

docker volume inspect "$VOLUME" >/dev/null 2>&1 || {
  log "volume $VOLUME does not exist yet — nothing to back up"
  exit 0
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Count first: an empty volume is the normal state until STORAGE_PROVIDER=local is in use.
FILES="$(docker run --rm -v "$VOLUME:/data:ro" "$TAR_IMAGE" \
  sh -c 'find /data -type f 2>/dev/null | wc -l' | tr -d '[:space:]')"
if [[ "${FILES:-0}" -eq 0 ]]; then
  # Normal in two cases: STORAGE_PROVIDER is not `local`, or it is and no customer has uploaded
  # anything yet. Either way an archive of nothing is worse than no archive — it would push a
  # real one out of the retention window.
  log "volume $VOLUME holds no files — skipping"
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="uploads-$STAMP.tar.gz"

log "archiving $FILES file(s) from $VOLUME to $BACKUP_DIR/$ARCHIVE"
# --user: the archive must be owned by the invoking user, not root, so rotation and an off-host
# copy both work without sudo.
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$VOLUME:/data:ro" -v "$BACKUP_DIR:/out" "$TAR_IMAGE" \
  tar czf "/out/$ARCHIVE" -C /data .

chmod 600 "$BACKUP_DIR/$ARCHIVE"
SIZE="$(stat -c %s "$BACKUP_DIR/$ARCHIVE")"
log "wrote $ARCHIVE ($SIZE bytes)"

# Same ordering rule as the database backup: rotate only after the new archive exists, so a
# failed run never deletes the last good copy.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime "+$RETAIN_DAYS" -print -delete | wc -l)"
log "retention: kept $RETAIN_DAYS days, removed $DELETED older archive(s)"
