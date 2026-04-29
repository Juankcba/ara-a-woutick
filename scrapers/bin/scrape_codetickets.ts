// Scrape codetickets.com via su API JSON pública (sin auth).
//
// Codetickets es WL de portalticket.com. La home renderiza cards client-side
// llamando a /api/home/proximos?length=N. Ese endpoint devuelve eventos con
// `entidadId/entidad/poblacion` (ORGANIZADOR) y `recintoId/recinto` (VENUE).
//
// Estos organizadores son leads B2B reales — ayuntamientos, festivales,
// asociaciones, salas — que decidieron usar codetickets para vender.
//
// Inserta en leads_crm.companies:
//   - 1 row por organizador único (entidadId): category='promoter'
//   - 1 row por venue único (recintoId): category='venue'
// Y 1 row en company_sources con source_platform='codetickets' por cada uno
// para no perder de vista de qué origen vino.
//
// Uso:
//   pnpm exec tsx bin/scrape_codetickets.ts
//   pnpm exec tsx bin/scrape_codetickets.ts --dry-run
//   pnpm exec tsx bin/scrape_codetickets.ts --length 2000
//
// El endpoint tiene un cap interno (~700 events). length>700 no agrega nada.

import '../src/env.ts';
import { leadsPool, scrapingPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const API_URL = 'https://api.codetickets.com/api/home/proximos';
const SOURCE_PLATFORM = 'codetickets';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

interface ApiEvent {
  id: number;
  nombre: string;
  fechaInicial: string | null;
  entidadId: number | null;
  entidad: string | null;
  recintoId: number | null;
  recinto: string | null;
  poblacion: string | null;
  urlSale: string | null;
  urlImage: string | null;
}

interface CliArgs { dryRun: boolean; length: number }

function parseArgs(): CliArgs {
  const args: CliArgs = { dryRun: false, length: 2000 };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    const a = av[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--length') args.length = Number(av[++i] ?? 2000);
  }
  return args;
}

function slugify(name: string, scope: string): string {
  // Prefijo `ct-` evita colisión con seeds y mantiene trazabilidad.
  const base = `ct-${scope}-${name}`;
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 250);
}

function titleCase(s: string): string {
  // Codetickets devuelve nombres en MAYÚSCULAS (ej. "AJUNTAMENT DE MARTORELLES").
  // Pasamos a Title Case para que se lea decente en el front.
  return s
    .toLowerCase()
    .replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase())
    .replace(/\b(De|Del|La|Las|El|Los|Y|En|D'|L')\b/gi, (m) => m.toLowerCase())
    .trim();
}

async function fetchEvents(length: number): Promise<ApiEvent[]> {
  const url = `${API_URL}?length=${length}`;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return await res.json() as ApiEvent[];
}

async function getCodeticketsSourceId(): Promise<number> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    "SELECT id FROM sources WHERE slug = 'codetickets_com' LIMIT 1",
  );
  if (!rows[0]) throw new Error('Source codetickets_com not in ticket_scraping.sources');
  return rows[0].id as number;
}

async function upsertCompany(
  slug: string,
  name: string,
  category: 'promoter' | 'venue',
  city: string | null,
  notes: string | null,
): Promise<number> {
  // ON DUPLICATE: si ya existe el slug, actualizamos campos vacíos vía COALESCE.
  // No degradamos categoría — si ya existe como 'promoter' y este pase la trae
  // como 'venue', conservamos la previa.
  const [res] = await leadsPool.query<ResultSetHeader>(
    `INSERT INTO companies (slug, name, category, city, country, status, notes)
     VALUES (?, ?, ?, ?, 'ES', 'new', ?)
     ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        name = COALESCE(NULLIF(name, ''), VALUES(name)),
        city = COALESCE(NULLIF(city, ''), VALUES(city)),
        notes = COALESCE(NULLIF(notes, ''), VALUES(notes))`,
    [slug, name, category, city, notes],
  );
  return res.insertId;
}

async function upsertCompanySource(
  companyId: number,
  externalId: string,
  externalUrl: string | null,
  eventsCount: number,
): Promise<void> {
  // company_sources mantiene el link a codetickets — útil para `/promoters` y
  // dedup futuro. UPSERT por (company_id, source_platform).
  await leadsPool.query<ResultSetHeader>(
    `INSERT INTO company_sources
       (company_id, source_platform, external_id, source_url, events_count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       events_count = VALUES(events_count),
       last_seen_at = UTC_TIMESTAMP(),
       source_url = COALESCE(NULLIF(source_url, ''), VALUES(source_url))`,
    [companyId, SOURCE_PLATFORM, externalId, externalUrl, eventsCount],
  );
}

async function logRun(sourceId: number, stats: { itemsSeen: number; itemsNew: number; itemsUpdated: number }) {
  await scrapingPool.query<ResultSetHeader>(
    `INSERT INTO scraping_runs
       (source_id, triggered_by, started_at, finished_at, status, items_seen, items_new, items_updated, items_error)
     VALUES (?, 'manual', UTC_TIMESTAMP(), UTC_TIMESTAMP(), 'ok', ?, ?, ?, 0)`,
    [sourceId, stats.itemsSeen, stats.itemsNew, stats.itemsUpdated],
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[codetickets] ${args.dryRun ? 'DRY RUN' : 'LIVE'} · length=${args.length}\n`);

  const events = await fetchEvents(args.length);
  console.log(`Fetched ${events.length} events from API`);

  // Dedup por entidadId y por recintoId. Contamos cuántos eventos por cada uno.
  type Bucket = { name: string; city: string | null; count: number; sampleUrl: string | null };
  const orgs = new Map<number, Bucket>();
  const venues = new Map<number, Bucket>();

  for (const e of events) {
    if (e.entidadId && e.entidad) {
      const b = orgs.get(e.entidadId) ?? {
        name: titleCase(e.entidad),
        city: e.poblacion ? titleCase(e.poblacion) : null,
        count: 0,
        sampleUrl: e.urlSale ?? null,
      };
      b.count++;
      orgs.set(e.entidadId, b);
    }
    if (e.recintoId && e.recinto) {
      const b = venues.get(e.recintoId) ?? {
        name: e.recinto,
        city: e.poblacion ? titleCase(e.poblacion) : null,
        count: 0,
        sampleUrl: e.urlSale ?? null,
      };
      b.count++;
      venues.set(e.recintoId, b);
    }
  }

  console.log(`Unique organizers: ${orgs.size}`);
  console.log(`Unique venues:     ${venues.size}\n`);

  if (args.dryRun) {
    console.log('--- ORGANIZADORES (top 10 por eventos) ---');
    [...orgs.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .forEach(([id, b]) => console.log(`  #${id.toString().padStart(4)}  ${b.count.toString().padStart(3)} ev  ${b.name}  (${b.city ?? '?'})`));
    console.log('\n--- VENUES (top 10) ---');
    [...venues.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .forEach(([id, b]) => console.log(`  #${id.toString().padStart(4)}  ${b.count.toString().padStart(3)} ev  ${b.name}  (${b.city ?? '?'})`));
    await closeAllPools();
    return;
  }

  let newOrgs = 0, newVenues = 0;
  const note = 'Importado desde codetickets.com API (api.codetickets.com/api/home/proximos)';

  for (const [entidadId, b] of orgs) {
    const slug = slugify(b.name, `org-${entidadId}`);
    const companyId = await upsertCompany(slug, b.name, 'promoter', b.city, note);
    await upsertCompanySource(companyId, `entidad-${entidadId}`, b.sampleUrl, b.count);
    newOrgs++;
    if (newOrgs % 25 === 0) process.stdout.write(`  orgs ${newOrgs}/${orgs.size}\r`);
  }
  process.stdout.write('\n');

  for (const [recintoId, b] of venues) {
    const slug = slugify(b.name, `venue-${recintoId}`);
    const companyId = await upsertCompany(slug, b.name, 'venue', b.city, note);
    await upsertCompanySource(companyId, `recinto-${recintoId}`, b.sampleUrl, b.count);
    newVenues++;
    if (newVenues % 25 === 0) process.stdout.write(`  venues ${newVenues}/${venues.size}\r`);
  }
  process.stdout.write('\n');

  // Registrar run en ticket_scraping.scraping_runs para que aparezca en /admin.
  try {
    const sourceId = await getCodeticketsSourceId();
    await logRun(sourceId, { itemsSeen: events.length, itemsNew: orgs.size + venues.size, itemsUpdated: 0 });
  } catch (e) {
    console.warn(`(could not log run: ${(e as Error).message})`);
  }

  console.log(`\n[codetickets] done · events=${events.length} · orgs=${orgs.size} · venues=${venues.size}`);
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
