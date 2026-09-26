#!/bin/sh
# Container start: apply migrations, load demo accounts and reference data (idempotent), run the server.
set -e
prisma migrate deploy
if [ "${SEED_ON_START:-true}" = "true" ]; then
  node dist/seed.js
fi
exec node server.js
