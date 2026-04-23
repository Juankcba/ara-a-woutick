# n8n workflows — scrapers scheduling

Workflows listos para importar en el n8n self-hosted en `185.140.33.45`. Cada uno ejecuta el scraper + promoción de una fuente en cron.

## Requisitos del servidor (una sola vez)

Antes de importar los workflows, el host donde corre n8n necesita:

### 1. Whitelist de IP en cPanel MySQL

En `cpanel.woutick.es` → **Remote MySQL** → Add Access Host: `185.140.33.45`. Sin esto el pool del scraper falla con `Host '185.140.33.45' is not allowed to connect`.

### 2. Node + pnpm en el host

```bash
# Node 20+ (por ejemplo vía nodesource o fnm)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
sudo corepack enable
sudo corepack prepare pnpm@latest --activate
```

### 3. Clonar repo + install + .env

```bash
sudo mkdir -p /opt/woutick-scrapers
sudo chown $USER:$USER /opt/woutick-scrapers
cd /opt && git clone https://github.com/Juankcba/ara-a-woutick.git woutick-scrapers
cd /opt/woutick-scrapers/scrapers && pnpm install
```

Crear `/opt/woutick-scrapers/.env` (copiar el mismo .env que tenés en tu Mac con las credenciales reales). Ejecutar un smoke test manual antes de activar workflows:

```bash
cd /opt/woutick-scrapers/scrapers && pnpm scrape apm_musical
```

Si eso corre sin errores y ves nuevas filas en `leads_crm.company_sources` con `source_platform='apm_musical'`, el server está listo.

## Importar los workflows en n8n

En la UI de n8n → **Workflows** → **Import from File** → seleccionar cada `.json` de este directorio. Importar los tres:

- `scrape-ticketmaster.json` — cada 12h, ~6 min
- `scrape-taquilla.json` — diario 03:00 Europe/Madrid, ~35 min
- `scrape-apm-musical.json` — semanal lunes 04:00, ~8s

Después de importar cada uno, **activar el toggle** (viene importado en `active: false` por seguridad).

## Si n8n corre en Docker

El Execute Command node corre DENTRO del container de n8n, no en el host. Dos opciones:

**A) Montar el repo y tener node en el container** — en `docker-compose.yml` de n8n:

```yaml
services:
  n8n:
    # ...
    volumes:
      - /opt/woutick-scrapers:/opt/woutick-scrapers
    environment:
      - N8N_DEFAULT_BINARY_DATA_MODE=filesystem
```

Y además instalar node+pnpm en la imagen (custom Dockerfile FROM n8nio/n8n: `apk add nodejs npm && npm i -g pnpm`).

**B) Usar el SSH node de n8n** para volver a SSH al host y ejecutar allí. Requiere SSH credentials guardadas en n8n Credentials y reescribir los workflows con SSH node en lugar de Execute Command.

Recomendación: si instalaste n8n nativo (`npm install -g n8n` + systemd), los workflows funcionan tal cual.

## Verificar que funcionó

Después de la primera corrida real (esperá el schedule o ejecutá "Execute Workflow" manualmente):

```sql
-- ¿Corrió?
SELECT id, status, items_seen, items_new, items_error,
       TIMESTAMPDIFF(SECOND, started_at, finished_at) AS duration_s
  FROM dbwoutick_ticket_scraping.scraping_runs
 ORDER BY id DESC LIMIT 5;

-- ¿Hay errores?
SELECT error_code, COUNT(*) AS n
  FROM dbwoutick_ticket_scraping.scraping_errors
 WHERE run_id = (SELECT MAX(id) FROM dbwoutick_ticket_scraping.scraping_runs)
 GROUP BY error_code;
```
