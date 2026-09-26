#!/bin/sh
# Everything a classroom server needs without internet: Docker images and the project files.
# Run on a machine with internet, then copy the two archives into the isolated network:
#   scripts/offline-bundle.sh
#   # in the classroom:
#   tar xzf trainer-offline-project.tar.gz && cd trainer
#   gunzip -c ../trainer-offline-images.tar.gz | docker load
#   cp .env.example .env && docker compose --profile app --profile https up -d
set -eu
cd "$(dirname "$0")/.."
docker compose --profile app build
docker pull postgres:16-alpine
docker pull caddy:2-alpine
docker save trainer-112-dds:latest postgres:16-alpine caddy:2-alpine | gzip > ../trainer-offline-images.tar.gz
tar czf ../trainer-offline-project.tar.gz --transform 's,^\.,trainer,' \
  ./docker-compose.yml ./.env.example ./deploy ./scripts/restore.sh ./docs ./README.md
ls -lh ../trainer-offline-images.tar.gz ../trainer-offline-project.tar.gz
