#!/bin/bash
# Wrapper para que cron no tenga que saber la ruta exacta de node/pnpm.
# Setea PATH con el Node que instalaste via nvm y delega a pnpm.
#
# Uso en cron:
#   /home/$USER/woutick-scrapers/deploy/cpanel/run.sh scrape ticketmaster
#   /home/$USER/woutick-scrapers/deploy/cpanel/run.sh promote ticketmaster 5000
set -euo pipefail

# Si usás nvm — buscar el alias default y su ruta de binarios.
if [ -d "$HOME/.nvm" ]; then
  NVM_DEFAULT="$(cat "$HOME/.nvm/alias/default" 2>/dev/null || true)"
  if [ -n "${NVM_DEFAULT:-}" ] && [ -d "$HOME/.nvm/versions/node/$NVM_DEFAULT/bin" ]; then
    export PATH="$HOME/.nvm/versions/node/$NVM_DEFAULT/bin:$PATH"
  fi
fi

# Si Node está en /usr/local/bin via RPM u otra vía, también lo tomamos.
export PATH="/usr/local/bin:/usr/bin:$PATH"

# Log para cron: imprimir fecha para facilitar grep posterior.
echo "===== $(date -u +'%Y-%m-%dT%H:%M:%SZ') $* ====="

# Cambiar al directorio del scraper — .env se resuelve relativo al parent.
cd "$(dirname "$0")/../../scrapers"

# Ejecutar el subcomando (scrape / promote / typecheck).
exec pnpm "$@"
