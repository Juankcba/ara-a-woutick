# Deploy del front en Vercel

El front (Next.js 16 en `/front`) se deploya a Vercel. Base URL objetivo: algo tipo `woutick.vercel.app` o `ticket.woutick.com`.

## Prereq ya resueltos

- ✅ `dbwoutick_admin@%` existe en MySQL (habilitado para GH Actions, lo usa Vercel también).
- ✅ 3 DBs accesibles desde `cpanel.woutick.es:3306`.
- ✅ Scrapers alimentan `ticket_public` cada pocas horas.
- ✅ Build del front pasa local (`pnpm -C front build` sin errores).

## Pasos en Vercel (UI)

### 1. Importar el repo

1. Entrá a [vercel.com/new](https://vercel.com/new) con tu cuenta.
2. **Import Git Repository** → elegí `Juankcba/ara-a-woutick`.
3. Si es primera vez, Vercel te pide conectar GitHub → dale acceso solo a ese repo.

### 2. Configure Project

**Crítico**: Vercel por default buildea desde la raíz del repo. Nuestro front vive en `/front`, así que hay que cambiarlo.

- **Project Name**: `woutick` (o el que prefieras)
- **Framework Preset**: Next.js (Vercel lo auto-detecta)
- **Root Directory**: clic en **Edit** → escribir `front` → **Continue**
- **Build and Output Settings**: dejar default (`pnpm build`, `.next`)
- **Install Command**: dejar default (`pnpm install`)
- **Node.js Version**: 22.x

### 3. Environment Variables

En la misma pantalla, sección **Environment Variables**, añadir cada una (aplicar a **Production, Preview, Development**):

| Nombre | Valor | Notas |
|---|---|---|
| `DATABASE_URL_PUBLIC` | `mysql://dbwoutick_admin:jMzka%40f%5E5%7BIup%2B-4@cpanel.woutick.es:3306/dbwoutick_ticket_public` | **URL-encoded** obligatorio (el password tiene `@^{+` que rompen URI) |
| `DB_HOST` | `cpanel.woutick.es` | |
| `DB_PORT` | `3306` | |
| `DB_USER` | `dbwoutick_admin` | |
| `DB_PASS` | `jMzka@f^5{Iup+-4` | password RAW (para mysql2, no URL-encoded) |
| `DB_PUBLIC` | `dbwoutick_ticket_public` | |
| `DB_SCRAPING` | `dbwoutick_ticket_scraping` | para `/admin` |
| `DB_LEADS` | `dbwoutick_leads_crm` | para `/promoters` |
| `ADMIN_TOKEN` | genera uno nuevo random (32+ chars, ej: `openssl rand -hex 32`) | **crítico** — si falta, `/admin` es público |

Para el `ADMIN_TOKEN`, generalo vos antes de importar:
```bash
openssl rand -hex 32
```
Copiás la salida, la guardás en tu password manager, y la pegás como valor del secret en Vercel. Después accedés a `/admin?token=<ese-valor>`.

### 4. Deploy

Clic **Deploy**. Build dura ~1-2 min. Al terminar, Vercel te da la URL: `https://woutick.vercel.app` (o similar).

### 5. Verificar

- `https://<tu-url>/` → maqueta con los 2900+ eventos reales
- `https://<tu-url>/promoters` → tabla de 133+ empresas
- `https://<tu-url>/admin` → **404** sin token. Con `?token=<tu-admin-token>` → dashboard de scraping runs.

## Custom domain (opcional)

En Vercel → proyecto → **Settings → Domains** → Add Domain. Si tenés `ticket.woutick.com` o similar, Vercel te da los registros DNS para apuntar desde cPanel → DNS Zone Editor.

## CI/CD automático

Después del primer deploy, cada push a `main` dispara un build automático de Vercel. No hace falta configurar nada más.

## Troubleshooting

**"ECONNREFUSED" en logs de Vercel**: Vercel no logra conectar a MySQL. Verificar que `dbwoutick_admin@%` exista (`SHOW GRANTS FOR CURRENT_USER()` desde una conexión externa).

**Prisma "Environment variable not found: DATABASE_URL_PUBLIC"**: el env var no se agregó, o está marcado solo para Preview/Development. Revisar que esté en **Production** también.

**`/admin` muestra la data sin pedir token**: el `ADMIN_TOKEN` está vacío o ausente. El check en `app/admin/page.tsx` solo bloquea si la var existe. Añadirla + redeploy.

**Build falla con "Cannot find module '@/lib/...'"**: probablemente Vercel no detectó bien el Root Directory. Settings → General → Root Directory = `front`. Redeploy.
