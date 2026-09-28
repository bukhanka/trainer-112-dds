#!/bin/sh
# Restore the database from a pg_dump custom-format file made by the backup job, and put back the files of the
# library of materials from the mirror next to the dumps (BACKUP_DIR/materials).
#   scripts/restore.sh backups/trainer-2026-09-27T03-00-00.dump
# Stops nothing by itself: run it when no lesson is in progress.
set -eu
FILE="${1:?usage: scripts/restore.sh <file.dump>}"
URL="${DATABASE_URL:?DATABASE_URL is not set}"
URL="${URL%%\?*}"   # drop Prisma's ?schema= parameter
echo "Restoring $FILE into ${URL##*@} ..."
pg_restore --clean --if-exists --no-owner --dbname="$URL" "$FILE"

# Materials: files are never changed after upload, so a missing one is simply copied back; nothing is overwritten.
MIRROR="$(dirname "$FILE")/materials"
TARGET="${MATERIALS_DIR:-storage/materials}"
if [ -d "$MIRROR" ]; then
  mkdir -p "$TARGET"
  restored=0
  for f in "$MIRROR"/*; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    if [ ! -e "$TARGET/$name" ]; then cp "$f" "$TARGET/$name" && restored=$((restored + 1)); fi
  done
  # In the container the server runs as «node»: the files must stay its own.
  if [ "$(id -u)" = "0" ] && id node >/dev/null 2>&1; then chown -R node:node "$TARGET"; fi
  echo "Materials: $restored file(s) put back into $TARGET."
fi
echo "Done."
