#!/bin/sh
# Container start: apply migrations, load demo accounts and reference data (idempotent), run the server.
set -e
prisma migrate deploy
if [ "${SEED_ON_START:-true}" = "true" ]; then
  node dist/seed.js
  # Public demo stand: finished lessons with attempts, so reports and the board are not empty.
  if [ "${DEMO_MODE:-false}" = "true" ]; then node dist/seed-demo.js; fi
fi
exec node cluster.cjs
