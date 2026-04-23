# Imagen para correr el scraper ECI (y cualquiera que requiera Playwright).
# Se builda desde la raíz del repo: docker build -f deploy/cpanel/Dockerfile -t woutick-scrapers .
#
# Uso:
#   docker run --rm --network host \
#     --env-file /home/dbwoutick/woutick-scrapers/.env \
#     woutick-scrapers pnpm scrape elcorteingles
#
# Tag del base image alineado con la versión de Playwright en package.json
# (1.59.x). Si subís Playwright, subí también el tag aquí.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# Node 22 viene con corepack; activamos pnpm.
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app/scrapers

# Instalamos deps primero para aprovechar cache de Docker.
COPY scrapers/package.json scrapers/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Copiamos código después (cambia más seguido).
COPY scrapers/ ./

# El .env vive fuera del código — se monta via --env-file al correr.
# DB_HOST debe ser 'host.docker.internal' o '127.0.0.1' con --network host.

# Default: muestra el catálogo de scrapers.
CMD ["pnpm", "scrape"]
