// Scrape ticketeras Janto v5 (apiw5.janto.es). Janto es un SaaS B2B —
// múltiples ticketeras corren sobre el mismo backend (uniticket.janto.es,
// teuticket.com, etc). El front llama a /v5/events/{repoId}?combinedsalesentities=...
// y devuelve un dict {events: {<id>: {...}, ...}, ...}.
//
// Cada event trae `venues[]` con name/address/region/postalCode → leads venue
// reales. NO trae organizer estructurado, así que sólo creamos venues.
//
// La API responde 500 a curl directo (chequea TLS/JA3 fingerprint) — usamos
// Playwright en headless. Cada tenant de Janto tiene su URL pública; el script
// la abre, escucha la response a /v5/events y procesa.
//
// Uso:
//   pnpm exec tsx bin/scrape_janto_v5.ts
//   pnpm exec tsx bin/scrape_janto_v5.ts --dry-run
//   pnpm exec tsx bin/scrape_janto_v5.ts --tenant uniticket.janto.es

import '../src/env.ts';
import { leadsPool, scrapingPool, closeAllPools } from '../src/db.ts';
import { chromium } from 'playwright';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const SOURCE_PLATFORM = 'janto_v5';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Tenants Janto v5 conocidos. Cada slug refiere a la source en DB.
// La URL es la que el browser abre — el script intercepta /v5/events.
//
// teuticket.com NO está acá: su home dispara sólo /v5/configuration y un
// GraphQL `getQservlet` que devuelve UN evento featured con todas sus
// sesiones (no es enumerable sin paginar IDs). Si en el futuro se descubre
// el query de listado, agregar acá.
const TENANTS: Array<{ slug: string; url: string }> = [
  { slug: 'uniticket_janto_es', url: 'https://uniticket.janto.es/' },
];

interface JantoVenue {
  name: string;
  address: string;
  region: string | null;
  postalCode: string | null;
  id: string;
}

interface JantoEvent {
  id: string;
  name: string;
  venues?: JantoVenue[];
  startDate?: number;
}

interface JantoResponse {
  events: Record<string, JantoEvent> | JantoEvent[];
  status?: number;
}

interface CliArgs { dryRun: boolean; tenant: string | null }

function parseArgs(): CliArgs {
  const args: CliArgs = { dryRun: false, tenant: null };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    if (av[i] === '--dry-run') args.dryRun = true;
    else if (av[i] === '--tenant') args.tenant = av[++i] ?? null;
  }
  return args;
}

function slugify(name: string, scope: string): string {
  // Prefijo `jt-v-` evita colisión con seeds y otras ticketeras.
  const base = `jt-v-${scope}-${name}`;
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 250);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s|[-/])(\p{L})/gu, (_, sep, ch: string) => sep + ch.toUpperCase())
    .replace(/(?<=^|\s)(De|Del|La|Las|El|Los|Y|En)(?=\s|$)/g, (m) => m.toLowerCase())
    .trim();
}

async function fetchTenantEvents(url: string): Promise<JantoEvent[]> {
  // Playwright: lanzamos chromium, navegamos al tenant y esperamos a que
  // dispare la request /v5/events/...; capturamos el body.
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: USER_AGENT });
    const page = await ctx.newPage();
    let body: string | null = null;
    page.on('response', async (res) => {
      if (res.url().includes('apiw5.janto.es') && res.url().includes('/v5/events/')) {
        body = await res.text().catch(() => null);
      }
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2500);
    await ctx.close();
    if (!body) return [];

    const data = JSON.parse(body) as JantoResponse;
    const ev = data.events;
    if (!ev) return [];
    return Array.isArray(ev) ? ev : Object.values(ev);
  } finally {
    await browser.close();
  }
}

async function getSourceId(slug: string): Promise<number | null> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    'SELECT id FROM sources WHERE slug = ? LIMIT 1', [slug],
  );
  return rows[0]?.id ?? null;
}

async function upsertVenue(
  slug: string,
  name: string,
  city: string | null,
  notes: string,
): Promise<number> {
  const [res] = await leadsPool.query<ResultSetHeader>(
    `INSERT INTO companies (slug, name, category, city, country, status, notes)
     VALUES (?, ?, 'venue', ?, 'ES', 'new', ?)
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

async function logRun(sourceId: number, stats: { itemsSeen: number; itemsNew: number }) {
  await scrapingPool.query<ResultSetHeader>(
    `INSERT INTO scraping_runs
       (source_id, triggered_by, started_at, finished_at, status, items_seen, items_new, items_updated, items_error)
     VALUES (?, 'manual', UTC_TIMESTAMP(), UTC_TIMESTAMP(), 'ok', ?, ?, 0, 0)`,
    [sourceId, stats.itemsSeen, stats.itemsNew],
  );
}

// Janto venue.address es texto libre tipo "Palacio de Festivales - C/ Gamazo,
// Santander " o "Casyc, 25" — los segmentos finales pueden ser # de calle,
// "S/N", o realmente ciudad. Estrategia: tomar el penúltimo segmento si la
// region está como último, sino fallback a region (que siempre viene limpia).
function extractCity(address: string, region: string | null): string | null {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  // Si region está como último, ciudad es penúltimo.
  if (region && parts.length >= 2) {
    const last = parts[parts.length - 1].toLowerCase();
    if (last === region.toLowerCase()) {
      const cand = parts[parts.length - 2];
      if (/^[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(cand)) return cand;
    }
  }
  // Fallback: si el último segmento empieza con letra (no número/S/N/-), úsalo.
  if (parts.length >= 1) {
    const last = parts[parts.length - 1];
    if (/^[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(last) && last.toLowerCase() !== 's/n') {
      return last;
    }
  }
  // Last resort: region (provincia/comunidad — agrupa decentemente).
  return region;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const targets = args.tenant ? TENANTS.filter((t) => t.slug === args.tenant) : TENANTS;
  if (targets.length === 0) {
    console.error(`No tenant matches: ${args.tenant}`);
    process.exit(1);
  }

  console.log(`[janto_v5] ${args.dryRun ? 'DRY RUN' : 'LIVE'} · tenants=${targets.length}\n`);

  for (const t of targets) {
    console.log(`--- ${t.slug} (${t.url}) ---`);
    let events: JantoEvent[] = [];
    try { events = await fetchTenantEvents(t.url); }
    catch (e) { console.warn(`  fetch failed: ${(e as Error).message}`); continue; }

    console.log(`  events: ${events.length}`);
    if (events.length === 0) continue;

    // Dedup venues por venue.id (Janto venue id) dentro del tenant.
    type Bucket = { name: string; city: string | null; count: number };
    const venues = new Map<string, Bucket>();
    for (const e of events) {
      for (const v of e.venues ?? []) {
        if (!v.id || !v.name) continue;
        const cleanName = titleCase(v.name);
        const city = extractCity(v.address ?? '', v.region);
        const b = venues.get(v.id) ?? { name: cleanName, city: city ? titleCase(city) : null, count: 0 };
        b.count++;
        venues.set(v.id, b);
      }
    }
    console.log(`  unique venues: ${venues.size}`);

    if (args.dryRun) {
      [...venues.entries()]
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 5)
        .forEach(([id, b]) => console.log(`    ${id.padEnd(6)} ${String(b.count).padStart(3)} ev  ${b.name}  (${b.city ?? '?'})`));
      continue;
    }

    const note = `Importado desde ${t.url} (Janto v5 API · apiw5.janto.es)`;
    let n = 0;
    for (const [vId, b] of venues) {
      const slug = slugify(b.name, `${t.slug.replace(/_/g, '-')}-v-${vId}`);
      const companyId = await upsertVenue(slug, b.name, b.city, note);
      await upsertCompanySource(companyId, `${t.slug}:venue-${vId}`, t.url, b.count);
      n++;
    }
    console.log(`  upserted ${n} venues`);

    const sourceId = await getSourceId(t.slug);
    if (sourceId) {
      await logRun(sourceId, { itemsSeen: events.length, itemsNew: venues.size });
    } else {
      console.warn(`  (no source row for ${t.slug} — skipping run log)`);
    }
  }

  console.log(`\n[janto_v5] done`);
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exitCode = 1; })
  .finally(() => closeAllPools());
