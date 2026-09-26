#!/bin/sh
# Restore the database from a pg_dump custom-format file made by the backup job.
#   scripts/restore.sh backups/trainer-2026-09-27T03-00-00.dump
# Stops nothing by itself: run it when no lesson is in progress.
set -eu
FILE="${1:?usage: scripts/restore.sh <file.dump>}"
URL="${DATABASE_URL:?DATABASE_URL is not set}"
URL="${URL%%\?*}"   # drop Prisma's ?schema= parameter
echo "Restoring $FILE into ${URL##*@} ..."
pg_restore --clean --if-exists --no-owner --dbname="$URL" "$FILE"
echo "Done."
