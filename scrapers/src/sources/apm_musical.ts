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

// APM Musical = Asociación de Promotores Musicales de España. Directorio
// público de promotores, salas y agencias asociadas. NO scrapea eventos:
// escribe directamente a leads_crm.companies + company_sources.
//
// Fuentes:
//   1. WP REST API /wp-json/wp/v2/asociados → 101 registros con name + id
//   2. HTML /asociados-apm/ → los primeros ~20 vienen pre-renderizados con
//      website y categoría inferida por la sección
// El resto se guarda solo con el nombre (enriquecimiento manual/apollo después).

const SLUG = 'apm_musical';
const ORIGIN = 'https://apmusicales.com';
const DIRECTORY_URL = `${ORIGIN}/asociados-apm/`;
const API_BASE = `${ORIGIN}/wp-json/wp/v2/asociados`;
const REQ_DELAY_MS = 800;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

type ApmCategory =
  | 'promoter'
  | 'ticketing'
  | 'venue'
  | 'agency_production'
  | 'venue_complex'
  | 'other';

interface ApmRecord {
  externalId: string;     // WP post id
  name: string;
  slug: string;
  profileUrl: string;     // /asociados/<slug>/ aunque redirija
  website: string | null;
  category: ApmCategory;
  logoUrl: string | null;
}

interface WpAsociado {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  featured_media?: number;
}

export async function run(runId: number): Promise<RunStats> {
  const sourceId = await resolveSourceId(SLUG);
  const stats = emptyStats();

  // 1. Lista completa desde REST API.
  const apiRecords = await fetchAllFromApi(runId, stats);
  console.log(`[apm_musical] REST API devolvió ${apiRecords.length} asociados`);

  // 2. Parseo del HTML público para obtener website + categoría de los visibles.
  const htmlMap = await fetchDirectoryEnrichments(runId, stats);
  console.log(`[apm_musical] HTML parseó ${htmlMap.size} con website`);

  // 3. Merge + upsert.
  for (const rec of apiRecords) {
    const enrich = htmlMap.get(rec.externalId);
    if (enrich) {
      rec.website = enrich.website ?? rec.website;
      rec.category = enrich.category ?? rec.category;
      rec.logoUrl = enrich.logoUrl ?? rec.logoUrl;
    }
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

async function fetchAllFromApi(runId: number, stats: RunStats): Promise<ApmRecord[]> {
  const out: ApmRecord[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${API_BASE}?per_page=${perPage}&page=${page}&_fields=id,slug,link,title`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (e) {
      await logError(runId, `API fetch failed p${page}: ${String(e)}`, { url, errorCode: 'api' });
      stats.items_error++;
      break;
    }
    if (!res.ok) {
      // WP devuelve 400 cuando pedís una página más allá del total.
      if (res.status === 400) break;
      await logError(runId, `API HTTP ${res.status} p${page}`, { url, errorCode: `http_${res.status}` });
      stats.items_error++;
      break;
    }
    const items = (await res.json()) as WpAsociado[];
    if (!Array.isArray(items) || items.length === 0) break;

    for (const it of items) {
      out.push({
        externalId: String(it.id),
        name: decodeHtml(it.title.rendered).trim(),
        slug: it.slug,
        profileUrl: it.link,
        website: null,
        category: 'promoter',
        logoUrl: null,
      });
    }
    if (items.length < perPage) break;
    page++;
    await sleep(REQ_DELAY_MS);
  }
  return out;
}

// Parsea la página /asociados-apm/ para extraer, de los asociados visibles,
// website + categoría + logo.
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

  // Cada asociado renderizado vive en <div class="... post-<ID> asociados ...">.
  // Usamos clase parcial "e-loop-item" como ancla segura.
  $('[class*="asociados"][class*="post-"]').each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') ?? '';
    const idMatch = classes.match(/\bpost-(\d+)\b/);
    if (!idMatch) return;
    const postId = idMatch[1];

    // Primer link externo (el de la web de la empresa, no apmusicales ni social).
    const website = $el
      .find('a[href^="http"]')
      .map((__, a) => $(a).attr('href') ?? '')
      .get()
      .find((href) => isCompanyWebsite(href)) ?? null;

    const logoUrl = $el.find('img').first().attr('src') ?? null;

    // Categoría por la sección en la que está (H2 ancestro).
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

  const [res] = await leadsPool.query<ResultSetHeader>(
    `INSERT INTO companies (slug, name, category, website, status)
     VALUES (?, ?, ?, ?, 'new')
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       name = VALUES(name),
       category = CASE
         -- Si ya tenía una categoría más específica (ej: venimos de TM con 'promoter'),
         -- solo actualizamos si APM nos da algo más concreto.
         WHEN category = 'other' THEN VALUES(category)
         WHEN VALUES(category) IN ('ticketing','venue','venue_complex') THEN VALUES(category)
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
        slug: rec.slug,
        logoUrl: rec.logoUrl,
        category: rec.category,
      }),
    ],
  );

  return wasNew ? 'new' : 'updated';
}
