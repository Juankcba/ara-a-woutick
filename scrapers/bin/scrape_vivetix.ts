// Scrape vivetix.com via su API DataTables-style pública (sin auth).
//
// La home llama a /api/v3/events?start=...&length=24 con un payload tipo
// jQuery DataTables. Devuelve eventos con `seller_id`/`organizer` (PROMOTER)
// y `address` libre (a veces venue, a veces solo dirección). `venue`
// estructurado suele venir null — el address es la única señal.
//
// Estos `seller_id` son leads B2B reales: cada uno es un organizador
// distinto que decidió vender en vivetix.
//
// Inserta en leads_crm.companies:
//   - 1 row por seller_id único: category='promoter'
// Y 1 row en company_sources con source_platform='vivetix' por cada uno.
//
// Vivetix NO expone venues estructurados, así que no creamos rows venue
// — sería ruido (texto libre tipo "📍 Lugar: ... 📅 Fechas: ..." con
// emojis). Si en el futuro la API los expone, ampliamos el script.
//
// Uso:
//   pnpm exec tsx bin/scrape_vivetix.ts
//   pnpm exec tsx bin/scrape_vivetix.ts --dry-run
//   pnpm exec tsx bin/scrape_vivetix.ts --page-size 100

import '../src/env.ts';
import { leadsPool, scrapingPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const API_URL = 'https://vivetix.com/api/v3/events';
const SOURCE_PLATFORM = 'vivetix';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

interface ApiEvent {
  id: number;
  title: string;
  seller_id: number | null;
  organizer: string | null;
  venue: string | null;
  city: string | null;
  url: string | null;
  start_datetime: string | null;
}

interface ApiResponse {
  recordsTotal: number;
  recordsFiltered: number;
  data: ApiEvent[];
}

interface CliArgs { dryRun: boolean; pageSize: number }

function parseArgs(): CliArgs {
  const args: CliArgs = { dryRun: false, pageSize: 100 };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    const a = av[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--page-size') args.pageSize = Number(av[++i] ?? 100);
  }
  return args;
}

function slugify(name: string, scope: string): string {
  // Prefijo `vt-` evita colisión con seeds/otras ticketeras y mantiene trazabilidad.
  const base = `vt-${scope}-${name}`;
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 250);
}

function titleCase(s: string): string {
  // Vivetix devuelve nombres en cualquier casing. Title Case con stopwords ES.
  // Ojo: usar \p{L} con flag /u — \b es ASCII y rompe acentos (GIJÓN → GijÓN).
  return s
    .toLowerCase()
    .replace(/(^|\s|[-/])(\p{L})/gu, (_, sep, ch: string) => sep + ch.toUpperCase())
    // Stopwords ES con look-around — sin consumir espacios, así que stopwords
    // adyacentes (ej. "De Las") se procesan en una sola pasada.
    .replace(/(?<=^|\s)(De|Del|La|Las|El|Los|Y|En)(?=\s|$)/g, (m) => m.toLowerCase())
    .trim();
}

async function fetchPage(start: number, length: number): Promise<ApiResponse> {
  // El endpoint exige al menos un descriptor de columna (formato DataTables).
  // Con uno solo basta — no estamos paginando ni filtrando del lado server.
  const qs = new URLSearchParams({
    start: String(start),
    length: String(length),
    'columns[0][name]': 'events.title',
    'columns[0][searchable]': 'true',
  });
  const res = await fetch(`${API_URL}?${qs}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${API_URL}`);
  return await res.json() as ApiResponse;
}

async function fetchAllEvents(pageSize: number): Promise<ApiEvent[]> {
  const first = await fetchPage(0, pageSize);
  const total = first.recordsTotal;
  console.log(`API reports ${total} total events`);
  const all: ApiEvent[] = [...first.data];
  for (let start = pageSize; start < total; start += pageSize) {
    const page = await fetchPage(start, pageSize);
    all.push(...page.data);
    process.stdout.write(`  fetched ${all.length}/${total}\r`);
  }
  process.stdout.write('\n');
  return all;
}

async function getVivetixSourceId(): Promise<number> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    "SELECT id FROM sources WHERE slug = 'vivetix_com' LIMIT 1",
  );
  if (!rows[0]) throw new Error('Source vivetix_com not in ticket_scraping.sources');
  return rows[0].id as number;
}

async function upsertCompany(
  slug: string,
  name: string,
  city: string | null,
  notes: string | null,
): Promise<number> {
  // ON DUPLICATE: si el slug ya existe, COALESCE preserva edits manuales.
  const [res] = await leadsPool.query<ResultSetHeader>(
    `INSERT INTO companies (slug, name, category, city, country, status, notes)
     VALUES (?, ?, 'promoter', ?, 'ES', 'new', ?)
     ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        name = COALESCE(NULLIF(name, ''), VALUES(name)),
        city = COALESCE(NULLIF(city, ''), VALUES(city)),
        notes = COALESCE(NULLIF(notes, ''), VALUES(notes))`,
    [slug, name, city, notes],
  );
  return res.insertId;
}

async function upsertCompanySource(
  companyId: number,
  externalId: string,
  externalUrl: string | null,
  eventsCount: number,
): Promise<void> {
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
  console.log(`[vivetix] ${args.dryRun ? 'DRY RUN' : 'LIVE'} · pageSize=${args.pageSize}\n`);

  const events = await fetchAllEvents(args.pageSize);
  console.log(`Fetched ${events.length} events from API`);

  // Dedup por seller_id. `organizer` es texto libre — el id es la fuente de verdad.
  type Bucket = { name: string; city: string | null; count: number; sampleUrl: string | null };
  const orgs = new Map<number, Bucket>();

  for (const e of events) {
    if (!e.seller_id || !e.organizer) continue;
    const cleanName = titleCase(e.organizer);
    if (!cleanName) continue;
    const b = orgs.get(e.seller_id) ?? {
      name: cleanName,
      city: e.city ? titleCase(e.city) : null,
      count: 0,
      sampleUrl: e.url ?? null,
    };
    b.count++;
    orgs.set(e.seller_id, b);
  }

  console.log(`Unique organizers: ${orgs.size}\n`);

  if (args.dryRun) {
    console.log('--- ORGANIZADORES (top 15 por eventos) ---');
    [...orgs.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 15)
      .forEach(([id, b]) => console.log(`  #${String(id).padStart(7)}  ${String(b.count).padStart(3)} ev  ${b.name}  (${b.city ?? '?'})`));
    await closeAllPools();
    return;
  }

  let n = 0;
  const note = 'Importado desde vivetix.com API (vivetix.com/api/v3/events)';

  for (const [sellerId, b] of orgs) {
    const slug = slugify(b.name, `org-${sellerId}`);
    const companyId = await upsertCompany(slug, b.name, b.city, note);
    await upsertCompanySource(companyId, `seller-${sellerId}`, b.sampleUrl, b.count);
    n++;
    if (n % 25 === 0) process.stdout.write(`  orgs ${n}/${orgs.size}\r`);
  }
  process.stdout.write('\n');

  try {
    const sourceId = await getVivetixSourceId();
    await logRun(sourceId, { itemsSeen: events.length, itemsNew: orgs.size, itemsUpdated: 0 });
  } catch (e) {
    console.warn(`(could not log run: ${(e as Error).message})`);
  }

  console.log(`\n[vivetix] done · events=${events.length} · orgs=${orgs.size}`);
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
