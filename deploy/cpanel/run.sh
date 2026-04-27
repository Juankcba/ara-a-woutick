#!/bin/bash
# Wrapper para que cron no tenga que saber la ruta exacta de node/pnpm.
# Resuelve el binario de nvm (default alias o, si es parcial como "22",
# la última versión instalada que matchee) y delega a pnpm.
#
# Uso en cron:
#   /home/$USER/woutick-scrapers/deploy/cpanel/run.sh scrape ticketmaster
#   /home/$USER/woutick-scrapers/deploy/cpanel/run.sh promote ticketmaster 5000
#   /home/$USER/woutick-scrapers/deploy/cpanel/run.sh exec tsx bin/<script>.ts
set -euo pipefail

# Devuelve la ruta absoluta a un .../bin de nvm, o "" si no se puede resolver.
# Maneja:
#   - alias exacto "v22.22.2"
#   - alias sin prefijo "22.22.2"
#   - alias mayor "22" → busca la última v22.* instalada
#   - sin alias → fallback: la última versión instalada (semver sort)
resolve_nvm_bin() {
  local nvm_root="$HOME/.nvm/versions/node"
  [ -d "$nvm_root" ] || return 0

  if [ -r "$HOME/.nvm/alias/default" ]; then
    local alias_val
    alias_val="$(tr -d '[:space:]' < "$HOME/.nvm/alias/default")"
    if [ -n "$alias_val" ]; then
      [ -d "$nvm_root/$alias_val/bin" ] && { echo "$nvm_root/$alias_val/bin"; return 0; }
      [ -d "$nvm_root/v$alias_val/bin" ] && { echo "$nvm_root/v$alias_val/bin"; return 0; }
      local prefix_match
      prefix_match="$(ls -d "$nvm_root"/v"${alias_val#v}".*/bin 2>/dev/null | sort -V | tail -n1)"
      [ -n "$prefix_match" ] && { echo "$prefix_match"; return 0; }
    fi
  fi

  ls -d "$nvm_root"/v*/bin 2>/dev/null | sort -V | tail -n1
}

NVM_BIN="$(resolve_nvm_bin || true)"
if [ -n "${NVM_BIN:-}" ]; then
  export PATH="$NVM_BIN:$PATH"
fi
# Defensa adicional: paths estándar del sistema.
export PATH="/usr/local/bin:/usr/bin:$PATH"

# Log con fecha UTC para grep posterior.
echo "===== $(date -u +'%Y-%m-%dT%H:%M:%SZ') $* ====="

# Cambiar al directorio del scraper — .env se resuelve relativo al parent.
cd "$(dirname "$0")/../../scrapers"

# Validación temprana — si pnpm sigue sin encontrarse, error claro.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm no encontrado en PATH. PATH=$PATH" >&2
  exit 127
fi

exec pnpm "$@"
