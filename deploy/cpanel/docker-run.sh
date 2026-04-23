#!/bin/bash
# Wrapper para cron: ejecuta un subcomando pnpm dentro del container woutick-scrapers.
# Ejemplo:
#   docker-run.sh scrape elcorteingles
#   docker-run.sh promote elcorteingles 5000
#
# Setup previo (una sola vez):
#   cd ~/woutick-scrapers
#   docker build -f deploy/cpanel/Dockerfile -t woutick-scrapers .
#
# Rebuild tras git pull con cambios de código:
#   cd ~/woutick-scrapers && git pull && docker build -f deploy/cpanel/Dockerfile -t woutick-scrapers .
set -euo pipefail

echo "===== $(date -u +'%Y-%m-%dT%H:%M:%SZ') docker scrape $* ====="

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env no existe en $ENV_FILE" >&2
  exit 1
fi

# --network host → el container ve localhost (MySQL) como el host.
# --rm            → se borra al terminar, no deja basura.
# --env-file      → pasa las vars del .env (DB_HOST=localhost funciona con network host).
# --name único    → evita colisiones si un cron se solapa con otro.
NAME="woutick-scrapers-$(date +%s)-$$"

exec docker run --rm \
  --name "$NAME" \
  --network host \
  --env-file "$ENV_FILE" \
  woutick-scrapers \
  pnpm "$@"
