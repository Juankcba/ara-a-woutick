# Deploy en cPanel (scrapers + cron)

Los scrapers viven en el mismo server que MySQL (cpanel.woutick.es, 185.140.33.46). La DB se conecta por `localhost` → sin Remote MySQL whitelist, latencia ~0ms.

## Una sola vez — setup del server

### 1. SSH al cPanel

```bash
ssh <CPANEL_USER>@cpanel.woutick.es -p <SSH_PORT_SI_NO_22>
```

### 2. Instalar nvm + Node 22 + pnpm

cPanel suele traer un Node viejo. Usá nvm en tu home (no toca el sistema):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
corepack enable
corepack prepare pnpm@latest --activate
# verifica
node -v && pnpm -v
```

> Si es **shared cPanel sin SSH** → usar *Setup Node.js App* del UI para crear una app Node.js (solo como mecanismo de instalación de node+pnpm; el scraper NO corre como app web). En "Application root" poné `woutick-scrapers`.

### 3. Clonar repo en home (fuera de public_html)

```bash
cd ~
git clone https://github.com/Juankcba/ara-a-woutick.git woutick-scrapers
cd woutick-scrapers/scrapers
pnpm install
# test de compile
pnpm typecheck
```

### 4. Crear .env en el home del proyecto

```bash
cp ~/woutick-scrapers/deploy/cpanel/.env.example ~/woutick-scrapers/.env
nano ~/woutick-scrapers/.env
# Completar DB_PASS, TICKETMASTER_API_KEY, TICKETMASTER_SECRET
```

⚠️ **Importante**: `DB_HOST=localhost` (no `cpanel.woutick.es`) — conexión vía socket local.

### 5. Crear carpeta de logs

```bash
mkdir -p ~/logs
```

### 6. Smoke test (corre APM, es el más rápido)

```bash
~/woutick-scrapers/deploy/cpanel/run.sh scrape apm_musical
```

Esperado: termina en ~8s, imprime `items_new: 0` o `items_new: 1-101` dependiendo de si el directorio ya estaba poblado. Sin errores.

Verificar en DB:
```bash
mysql -u dbwoutick_admin -p dbwoutick_leads_crm -e "SELECT COUNT(*) FROM company_sources WHERE source_platform='apm_musical';"
```

Si el número coincide con los runs previos, el setup está OK.

## Configurar cron jobs

En el UI de cPanel → **Cron Jobs** → pegar cada línea de `crontab.example` reemplazando `<CPANEL_USER>` por tu usuario real.

Equivalente por CLI:

```bash
crontab -e
# (pegar contenido de deploy/cpanel/crontab.example con <CPANEL_USER> reemplazado)
```

### Verificar que el cron está programado

```bash
crontab -l
```

Debería mostrar las tres entradas (TM, Taquilla, APM) + rotación de logs.

## Verificar que los jobs corren

Tras el primer dispáro programado:

```bash
# Últimas líneas del log más reciente
tail -50 ~/logs/tm-scrape.log
tail -50 ~/logs/tm-promote.log

# ¿Quedó en DB?
mysql -u dbwoutick_admin -p dbwoutick_ticket_scraping -e "
  SELECT id, status, items_seen, items_new, items_error,
         TIMESTAMPDIFF(SECOND, started_at, finished_at) AS secs
    FROM scraping_runs ORDER BY id DESC LIMIT 5;"
```

## Actualizar a una nueva versión del código

```bash
cd ~/woutick-scrapers
git pull
cd scrapers
pnpm install      # solo si cambiaron deps
pnpm typecheck
```

El cron empieza a usar la nueva versión en su próxima corrida. Sin restart.

## Troubleshooting

**Cron no dispara nada.**
- `crontab -l` para confirmar que está instalado.
- Revisar `/var/log/cron` o el panel de cPanel → Cron Jobs tiene su propio log.
- Setear `MAILTO="tuemail@..."` al inicio del crontab para recibir stdout/stderr por mail.

**"pnpm: command not found" en el log.**
- nvm no está en PATH del cron. El script `run.sh` debería solucionarlo, pero si falla: probar el nvm default. `cat ~/.nvm/alias/default` debe devolver un valor válido.

**"Access denied for user 'dbwoutick_admin'@'localhost'".**
- El usuario MySQL probablemente solo tiene permisos para `%` (remoto). Añadir permisos locales en cPanel → MySQL Databases → Users → Add User + Add to DB. El usuario `dbwoutick_admin@localhost` debe existir.

**Taquilla corre 35 min — ¿lo mata el server?**
- Comprobar si hay `MaxExecTime` en los límites de cPanel. Cron jobs rara vez tienen límite (distinto de PHP). Si hay problema, partir el scrape por ciudad/categoría en múltiples runs pequeños.

## ECI vía Docker (scrapers con Playwright)

ECI está detrás de Akamai Bot Manager y requiere un browser headless. En lugar de pedir sudo para instalar Chromium + sus libs del sistema, corremos ese scraper dentro de un container basado en `mcr.microsoft.com/playwright:v1.59.1-jammy` que ya trae todo.

### 1. Build de la imagen (una sola vez)

```bash
cd ~/woutick-scrapers
docker build -f deploy/cpanel/Dockerfile -t woutick-scrapers .
```

Esto tarda ~2-3 min la primera vez (descarga imagen base ~1.5GB + instala deps). Quedan cacheados en docker, las builds posteriores tras `git pull` son <30s porque solo se rebuildean las capas que cambiaron.

### 2. Smoke test manual

```bash
~/woutick-scrapers/deploy/cpanel/docker-run.sh scrape elcorteingles
```

Esperado: ~1-2 min, `items_seen > 100`, 0 errors. Verifica en la DB con:

```bash
set -a && source ~/woutick-scrapers/.env && set +a
mysql -u "$DB_USER" -p"$DB_PASS" dbwoutick_ticket_scraping -e \
  "SELECT COUNT(*) FROM raw_events r JOIN sources s ON s.id=r.source_id WHERE s.slug='elcorteingles';"
```

### 3. Activar en cron

La línea de ECI en `crontab.example` ya está destapada (usa `docker-run.sh`). Si ya tenés el crontab instalado de las otras fuentes, agregá solo la línea de ECI:

```bash
crontab -l > /tmp/current
cat >> /tmp/current <<'EOF'
0 6,18 * * *   /home/dbwoutick/woutick-scrapers/deploy/cpanel/docker-run.sh scrape elcorteingles >> /home/dbwoutick/logs/eci-scrape.log 2>&1 && /home/dbwoutick/woutick-scrapers/deploy/cpanel/docker-run.sh promote elcorteingles 5000 >> /home/dbwoutick/logs/eci-promote.log 2>&1
EOF
crontab /tmp/current && crontab -l
```

### 4. Actualizar tras cambios de código

```bash
cd ~/woutick-scrapers
git pull
docker build -f deploy/cpanel/Dockerfile -t woutick-scrapers .
# la próxima corrida usa la imagen nueva
```

### Troubleshooting Docker

- **"permission denied while trying to connect to docker daemon"**: el user cPanel no está en el grupo `docker`. Pedir al hosting: `usermod -aG docker dbwoutick` o similar.
- **"Host '127.0.0.1' is not allowed to connect to this MySQL server"**: con `--network host` funciona como si fuera el mismo host. Si seguís viendo el error, probar setear `DB_HOST=host.docker.internal` en el `.env` (agregar también `--add-host=host.docker.internal:host-gateway` al `docker run`).
- **Imagen ocupa mucho espacio**: `docker image prune -a` limpia imágenes sin referencia. Hacerlo cada varios meses.
- **"pnpm: command not found" dentro del container**: el Dockerfile activa corepack — si falla, el build tenía un error. Re-correr `docker build`.

## Alternativa: Express API para trigger manual (opcional)

Si después querés disparar scrapers ad-hoc desde n8n u otra parte, añadir una mini API Express:

```
/api/scrape/:source   POST → corre pnpm scrape <source> en background, devuelve run_id
/api/promote/:source  POST → corre pnpm promote <source>
/api/runs             GET  → SELECT * FROM scraping_runs ORDER BY id DESC LIMIT 20
/api/health           GET  → verifica DB + devuelve stats
```

Se deploya como "Setup Node.js App" en cPanel (Passenger lo mantiene corriendo). Comparte el mismo `.env` y módulos que los scripts CLI. Lo armamos cuando haga falta.
