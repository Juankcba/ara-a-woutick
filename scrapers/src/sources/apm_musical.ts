import * as cheerio from 'cheerio';
import { leadsPool } from '../db.ts';
import {
  emptyStats,
  logError,
  resolveSourceId,
  sleep,
  type RunStats,
} from '../run.ts';
import type { ResultSetHeader } from 'mysql2';

// APM Musical = Asociación de Promotores Musicales de España. Explotamos
// TRES custom post types que APM expone vía WP REST, cada uno mapeado a
// una categoría de lead distinta:
//
//   /wp-json/wp/v2/asociados       → ~101 asociados institucionales
//   /wp-json/wp/v2/festivales      → ~80  festivales
//   /wp-json/wp/v2/tribe_organizer → ~107 organizadores (de events) distintos
//
// Además, del HTML de /asociados-apm/ extraemos website + categoría para los
// primeros ~20 asociados visibles (el resto está tras infinite-scroll de
// Elementor que no emulamos).

const SLUG = 'apm_musical';
const ORIGIN = 'https://apmusicales.com';
const DIRECTORY_URL = `${ORIGIN}/asociados-apm/`;
const REQ_DELAY_MS = 600;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

type ApmCategory =
  | 'promoter'
  | 'ticketing'
  | 'venue'
  | 'agency_production'
  | 'festival'
  | 'venue_complex'
  | 'other';

interface PostTypeConfig {
  endpoint: string;
  defaultCategory: ApmCategory;
  externalIdPrefix: string;
  profilePath: string; // path fragment para doc (no se usa en upsert)
}

const POST_TYPES: PostTypeConfig[] = [
  {
    endpoint: 'asociados',
    defaultCategory: 'promoter',
    externalIdPrefix: 'asociado',
    profilePath: '/asociados/',
  },
  {
    endpoint: 'festivales',
    defaultCategory: 'festival',
    externalIdPrefix: 'festival',
    profilePath: '/festivales/',
  },
  {
    endpoint: 'tribe_organizer',
    defaultCategory: 'promoter',
    externalIdPrefix: 'tribe-organizer',
    profilePath: '/organizador/',
  },
];

interface ApmRecord {
  externalId: string; // prefix-<wpid>
  postId: number;
  name: string;
  slug: string;
  profileUrl: string;
  website: string | null;
  category: ApmCategory;
  logoUrl: string | null;
}

interface WpPost {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
}

export async function run(runId: number): Promise<RunStats> {
  const sourceId = await resolveSourceId(SLUG);
  const stats = emptyStats();

  // 1. Obtener datos de los 3 post types vía REST.
  const allRecords: ApmRecord[] = [];
  for (const pt of POST_TYPES) {
    try {
      const recs = await fetchAllFromApi(runId, stats, pt);
      console.log(`[apm_musical] ${pt.endpoint}: ${recs.length} items`);
      allRecords.push(...recs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logError(runId, `fetch ${pt.endpoint}: ${msg}`, { errorCode: 'api' });
      stats.items_error++;
    }
    await sleep(REQ_DELAY_MS);
  }
  console.log(`[apm_musical] total ${allRecords.length} records from ${POST_TYPES.length} post types`);

  // 2. Enriquecer los asociados visibles con website + categoría inferida.
  const htmlMap = await fetchDirectoryEnrichments(runId, stats);
  console.log(`[apm_musical] HTML enrichment for ${htmlMap.size} asociados with website`);
  for (const rec of allRecords) {
    if (rec.externalId.startsWith('asociado-')) {
      const e = htmlMap.get(String(rec.postId));
      if (e) {
        rec.website = e.website ?? rec.website;
        rec.category = e.category ?? rec.category;
        rec.logoUrl = e.logoUrl ?? rec.logoUrl;
      }
    }
  }

  // 3. Upsert a leads_crm.
  for (const rec of allRecords) {
    try {
      const result = await upsertCompany(rec);
      stats.items_seen++;
      if (result === 'new') stats.items_new++;
      else stats.items_updated++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logError(runId, `upsert ${rec.name}: ${msg}`, { errorCode: 'upsert' });
      stats.items_error++;
    }
  }

  return stats;
}

async function fetchAllFromApi(
  runId: number,
  stats: RunStats,
  pt: PostTypeConfig,
): Promise<ApmRecord[]> {
  const out: ApmRecord[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${ORIGIN}/wp-json/wp/v2/${pt.endpoint}?per_page=${perPage}&page=${page}&_fields=id,slug,link,title`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (e) {
      await logError(runId, `API fetch failed ${pt.endpoint} p${page}: ${String(e)}`, { url, errorCode: 'api' });
      stats.items_error++;
      break;
    }
    if (!res.ok) {
      if (res.status === 400) break; // página fuera de rango
      await logError(runId, `API HTTP ${res.status} ${pt.endpoint} p${page}`, { url, errorCode: `http_${res.status}` });
      stats.items_error++;
      break;
    }
    const items = (await res.json()) as WpPost[];
    if (!Array.isArray(items) || items.length === 0) break;

    for (const it of items) {
      out.push({
        externalId: `${pt.externalIdPrefix}-${it.id}`,
        postId: it.id,
        name: decodeHtml(it.title.rendered).trim(),
        slug: it.slug,
        profileUrl: it.link,
        website: null,
        category: pt.defaultCategory,
        logoUrl: null,
      });
    }
    if (items.length < perPage) break;
    page++;
    await sleep(REQ_DELAY_MS);
  }
  return out;
}

async function fetchDirectoryEnrichments(
  runId: number,
  stats: RunStats,
): Promise<Map<string, Partial<ApmRecord>>> {
  const out = new Map<string, Partial<ApmRecord>>();
  let html: string;
  try {
    const res = await fetch(DIRECTORY_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    await logError(runId, `directory fetch failed: ${String(e)}`, {
      url: DIRECTORY_URL,
      errorCode: 'html',
    });
    stats.items_error++;
    return out;
  }

  const $ = cheerio.load(html);
  $('[class*="asociados"][class*="post-"]').each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') ?? '';
    const idMatch = classes.match(/\bpost-(\d+)\b/);
    if (!idMatch) return;
    const postId = idMatch[1];

    const website = $el
      .find('a[href^="http"]')
      .map((__, a) => $(a).attr('href') ?? '')
      .get()
      .find((href) => isCompanyWebsite(href)) ?? null;

    const logoUrl = $el.find('img').first().attr('src') ?? null;

    const sectionHeading = $el
      .closest('section')
      .prevAll('section')
      .find('.elementor-heading-title')
      .last()
      .text()
      .trim()
      .toUpperCase();
    const category = mapCategory(sectionHeading);

    out.set(postId, { website, category, logoUrl });
  });

  return out;
}

function isCompanyWebsite(href: string): boolean {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if (host.includes('apmusicales.com')) return false;
    if (/facebook|instagram|twitter|x\.com|youtube|linkedin|whatsapp|wa\.me/.test(host)) return false;
    if (/gstatic|google|gmpg|wordpress|schema\.org/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function mapCategory(heading: string): ApmCategory {
  if (heading.includes('TICKETING')) return 'ticketing';
  if (heading.includes('VENUE')) return 'venue';
  if (heading.includes('COLABORADORES') || heading.includes('SERVICIOS')) return 'agency_production';
  if (heading.includes('INSTITUCIONES') || heading.includes('INCENTIVOS')) return 'other';
  return 'promoter';
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function companySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function upsertCompany(rec: ApmRecord): Promise<'new' | 'updated'> {
  const slug = companySlug(rec.name);

  // Lógica de categoría en el ON DUPLICATE:
  //  - si la fila actual es 'other' → aceptar la nueva
  //  - si la nueva es una upgrade específica (ticketing/venue_complex/festival)
  //    → aceptar la nueva
  //  - en caso de conflicto promoter↔venue, mantener la existente (ambas son
  //    válidas, no queremos flip-flop según último upsert)
  const [res] = await leadsPool.query<ResultSetHeader>(
    `INSERT INTO companies (slug, name, category, website, status)
     VALUES (?, ?, ?, ?, 'new')
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       name = VALUES(name),
       category = CASE
         WHEN category = 'other' THEN VALUES(category)
         WHEN VALUES(category) IN ('ticketing','venue_complex','festival') THEN VALUES(category)
         ELSE category
       END,
       website = COALESCE(VALUES(website), website)`,
    [slug, rec.name, rec.category, rec.website],
  );
  const companyId = res.insertId;
  const wasNew = res.affectedRows === 1;

  await leadsPool.query(
    `INSERT INTO company_sources
       (company_id, source_platform, external_id, source_url,
        first_seen_at, last_seen_at, events_count, raw)
     VALUES (?, 'apm_musical', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 0, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       last_seen_at = UTC_TIMESTAMP(),
       source_url = COALESCE(VALUES(source_url), source_url),
       raw = VALUES(raw)`,
    [
      companyId,
      rec.externalId,
      rec.profileUrl,
      JSON.stringify({
        postId: rec.postId,
        slug: rec.slug,
        logoUrl: rec.logoUrl,
        category: rec.category,
      }),
    ],
  );

  return wasNew ? 'new' : 'updated';
}
