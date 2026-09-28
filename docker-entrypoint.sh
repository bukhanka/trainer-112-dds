#!/bin/sh
# Container start: apply migrations, load demo accounts and reference data (idempotent), run the server.
set -e
prisma migrate deploy
if [ "${SEED_ON_START:-true}" = "true" ]; then
  node dist/seed.js
  # Public demo stand: finished lessons with attempts, so reports and the board are not empty.
  if [ "${DEMO_MODE:-false}" = "true" ]; then node dist/seed-demo.js; fi
fi
# Migrations and seeds above run once as root; the long-running server drops to the unprivileged «node» user.
# Volumes created by an older image, and demo materials the seed has just written, may belong to root — hand them over.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${MATERIALS_DIR:-/materials}"
  chown -R node:node "${BACKUP_DIR:-/backups}" "${MATERIALS_DIR:-/materials}" /app/.next/cache 2>/dev/null || true
  exec su-exec node node cluster.cjs
fi
exec node cluster.cjs
