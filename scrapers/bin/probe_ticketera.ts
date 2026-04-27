// Probe: visita un sitio (o un batch) y sugiere un config_json para
// el motor genérico. Detecta:
//   - sitemap.xml (y filtra URLs candidatas a evento)
//   - JSON-LD Event en homepage o en /eventos /entradas /agenda
//   - estructura HTML básica si nada de lo anterior matchea
//
// No escribe a DB. Imprime un JSON pegable en /admin/scrapers > Editar config.
//
//   pnpm exec tsx bin/probe_ticketera.ts <slug>           # un slug
//   pnpm exec tsx bin/probe_ticketera.ts --difficulty=1   # toda la tanda
//   pnpm exec tsx bin/probe_ticketera.ts --all            # las 64

import '../src/env.ts';
import { scrapingPool, closeAllPools } from '../src/db.ts';
import * as cheerio from 'cheerio';
import type { RowDataPacket } from 'mysql2';

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; WoutickProbe/1.0; +https://woutick.es/bot)';
const COMMON_LISTING_PATHS = ['/eventos', '/events', '/agenda', '/entradas', '/cartelera', '/calendario'];
const EVENT_URL_REGEX = /\/(eventos?|entradas?|agenda|tickets?|spectacle|concert|conciertos)\b/i;

interface ProbeResult {
  slug: string;
  baseUrl: string;
  // Tests:
  homeReachable: boolean;
  homeStatus: number | null;
  sitemapFound: { url: string; total: number; eventLike: number; sample: string[] } | null;
  jsonLdEventsOnHome: number;
  listingHits: Array<{ url: string; status: number; jsonldEvents: number; htmlCards: number }>;
  socials: { instagram: string | null; facebook: string | null; twitter: string | null };
  recommendation: { confidence: 'high' | 'medium' | 'low' | 'none'; config: unknown; rationale: string };
}

async function fetchWithTimeout(url: string): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'es-ES,es;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const body = res.ok ? await res.text() : '';
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function extractSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function countJsonLdEvents(html: string): number {
  if (!html) return 0;
  const $ = cheerio.load(html);
  let count = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    try {
      const parsed = JSON.parse(txt);
      walk(parsed, (n) => {
        const t = n['@type'];
        if (typeof t === 'string' && /Event/i.test(t)) count++;
        else if (Array.isArray(t) && t.some((x) => typeof x === 'string' && /Event/i.test(x)))
          count++;
      });
    } catch {
      // ignore
    }
  });
  return count;
}

function walk(node: unknown, cb: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, cb);
    return;
  }
  const obj = node as Record<string, unknown>;
  cb(obj);
  for (const v of Object.values(obj)) walk(v, cb);
}

function extractSocials(html: string): ProbeResult['socials'] {
  if (!html) return { instagram: null, facebook: null, twitter: null };
  const $ = cheerio.load(html);
  const find = (re: RegExp): string | null => {
    let f: string | null = null;
    $('a[href]').each((_, el) => {
      if (f) return;
      const href = $(el).attr('href') ?? '';
      if (re.test(href)) f = href;
    });
    return f;
  };
  return {
    instagram: find(/instagram\.com\/[^\/?#]+/i),
    facebook: find(/facebook\.com\/[^\/?#]+/i),
    twitter: find(/(twitter\.com|x\.com)\/[^\/?#]+/i),
  };
}

function countCardCandidates(html: string): number {
  if (!html) return 0;
  const $ = cheerio.load(html);
  // Heurística: elementos típicos de listings de eventos
  const selectors = [
    'article',
    '[class*="event-card"]',
    '[class*="event_card"]',
    '[class*="EventCard"]',
    '[class*="ticket-card"]',
    'li[class*="event"]',
    'div[class*="event"]',
  ];
  let max = 0;
  for (const s of selectors) {
    const n = $(s).length;
    if (n > max && n < 200) max = n; // descartar selectores demasiado genéricos
  }
  return max;
}

async function probe(slug: string, baseUrl: string): Promise<ProbeResult> {
  const r: ProbeResult = {
    slug,
    baseUrl,
    homeReachable: false,
    homeStatus: null,
    sitemapFound: null,
    jsonLdEventsOnHome: 0,
    listingHits: [],
    socials: { instagram: null, facebook: null, twitter: null },
    recommendation: { confidence: 'none', config: null, rationale: '' },
  };

  // 1) Home
  const home = await fetchWithTimeout(baseUrl);
  r.homeStatus = home.status;
  r.homeReachable = home.status >= 200 && home.status < 400;
  if (r.homeReachable) {
    r.jsonLdEventsOnHome = countJsonLdEvents(home.body);
    r.socials = extractSocials(home.body);
  }

  // 2) Sitemap
  const sitemapUrl = new URL('/sitemap.xml', baseUrl).href;
  const sm = await fetchWithTimeout(sitemapUrl);
  if (sm.status >= 200 && sm.status < 400 && sm.body.includes('<loc')) {
    const urls = extractSitemapUrls(sm.body);
    const eventLike = urls.filter((u) => EVENT_URL_REGEX.test(u));
    r.sitemapFound = {
      url: sitemapUrl,
      total: urls.length,
      eventLike: eventLike.length,
      sample: eventLike.slice(0, 5),
    };
  }

  // 3) Listings comunes
  for (const path of COMMON_LISTING_PATHS) {
    const url = new URL(path, baseUrl).href;
    const res = await fetchWithTimeout(url);
    if (res.status >= 200 && res.status < 400) {
      r.listingHits.push({
        url,
        status: res.status,
        jsonldEvents: countJsonLdEvents(res.body),
        htmlCards: countCardCandidates(res.body),
      });
    }
    await new Promise((s) => setTimeout(s, 500));
  }

  // 4) Recomendación
  r.recommendation = recommend(r);
  return r;
}

function recommend(r: ProbeResult): ProbeResult['recommendation'] {
  // Sitemap con muchas URLs candidatas → high confidence
  if (r.sitemapFound && r.sitemapFound.eventLike >= 5) {
    return {
      confidence: 'high',
      rationale: `sitemap.xml tiene ${r.sitemapFound.eventLike} URLs match a /eventos|entradas|agenda`,
      config: {
        strategy: {
          type: 'sitemap',
          url: r.sitemapFound.url,
          event_url_pattern: EVENT_URL_REGEX.source,
          fetch_each: true,
          max_urls: 100,
        },
        rate_limit_ms: 1500,
      },
    };
  }

  // Listing con muchos JSON-LD events → high
  const bestListing = [...r.listingHits].sort((a, b) => b.jsonldEvents - a.jsonldEvents)[0];
  if (bestListing && bestListing.jsonldEvents >= 3) {
    return {
      confidence: 'high',
      rationale: `${bestListing.url} expone ${bestListing.jsonldEvents} JSON-LD Events`,
      config: {
        strategy: { type: 'jsonld', listing_url: bestListing.url },
        rate_limit_ms: 1500,
      },
    };
  }

  // JSON-LD en home → medium
  if (r.jsonLdEventsOnHome >= 1) {
    return {
      confidence: 'medium',
      rationale: `homepage tiene ${r.jsonLdEventsOnHome} JSON-LD Events (puede ser parcial)`,
      config: {
        strategy: { type: 'jsonld', listing_url: r.baseUrl },
        rate_limit_ms: 1500,
      },
    };
  }

  // Listing con muchas cards HTML → medium (necesita afinar selectors)
  const bestCardListing = [...r.listingHits].sort((a, b) => b.htmlCards - a.htmlCards)[0];
  if (bestCardListing && bestCardListing.htmlCards >= 5) {
    return {
      confidence: 'low',
      rationale: `${bestCardListing.url} tiene ${bestCardListing.htmlCards} cards heurísticos pero sin JSON-LD — afinar selectors a mano`,
      config: {
        strategy: {
          type: 'selectors',
          listing_url: bestCardListing.url,
          event_card: 'article, [class*="event-card"], [class*="event_card"]',
          fields: { title: 'h2, h3, .title', url: 'a', datetime: 'time', price: '[class*="price"]' },
        },
        rate_limit_ms: 2000,
      },
    };
  }

  // Sitemap chico (1-4 URLs) → low
  if (r.sitemapFound && r.sitemapFound.eventLike >= 1) {
    return {
      confidence: 'low',
      rationale: `solo ${r.sitemapFound.eventLike} URLs de eventos en sitemap — site con pocos eventos o regex demasiado estricto`,
      config: {
        strategy: {
          type: 'sitemap',
          url: r.sitemapFound.url,
          event_url_pattern: EVENT_URL_REGEX.source,
          fetch_each: true,
          max_urls: 50,
        },
        rate_limit_ms: 1500,
      },
    };
  }

  return {
    confidence: 'none',
    rationale: r.homeReachable
      ? 'sitio alcanzable pero sin sitemap, JSON-LD ni listings detectables — requiere análisis manual'
      : `home no alcanzable (status=${r.homeStatus})`,
    config: null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const difficulty = args.find((a) => a.startsWith('--difficulty='))?.split('=')[1];
  const slug = args.find((a) => !a.startsWith('--'));

  let where = 'WHERE is_competitor = TRUE';
  const params: unknown[] = [];
  if (slug) {
    where += ' AND slug = ?';
    params.push(slug);
  } else if (difficulty) {
    where += ' AND difficulty = ?';
    params.push(Number(difficulty));
  } else if (!all) {
    console.error('Uso: <slug> | --difficulty=N | --all');
    process.exit(1);
  }

  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    `SELECT slug, base_url FROM sources ${where} ORDER BY difficulty, slug`,
    params,
  );
  if (rows.length === 0) {
    console.log('No se encontraron sources con esos filtros.');
    await closeAllPools();
    return;
  }

  console.log(`Probing ${rows.length} sources...\n`);

  const results: ProbeResult[] = [];
  for (const row of rows as Array<{ slug: string; base_url: string | null }>) {
    if (!row.base_url) continue;
    process.stdout.write(`[${row.slug}] `);
    const r = await probe(row.slug, row.base_url);
    process.stdout.write(`→ ${r.recommendation.confidence} (${r.recommendation.rationale.slice(0, 60)})\n`);
    results.push(r);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('SUMARIO');
  console.log('═══════════════════════════════════════════');
  const byConfidence = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.recommendation.confidence] = (acc[r.recommendation.confidence] ?? 0) + 1;
    return acc;
  }, {});
  for (const k of ['high', 'medium', 'low', 'none']) {
    if (byConfidence[k]) console.log(`  ${k.padEnd(6)}: ${byConfidence[k]}`);
  }

  // Imprimir detalle de cada uno
  for (const r of results) {
    console.log(`\n──────────── ${r.slug} (${r.baseUrl}) ────────────`);
    console.log(`  home=${r.homeStatus}  jsonld_home=${r.jsonLdEventsOnHome}`);
    if (r.sitemapFound) {
      console.log(`  sitemap=${r.sitemapFound.url} total=${r.sitemapFound.total} eventLike=${r.sitemapFound.eventLike}`);
      if (r.sitemapFound.sample.length) {
        console.log(`  sample: ${r.sitemapFound.sample[0]}`);
      }
    }
    for (const h of r.listingHits) {
      console.log(`  ${h.url} → status=${h.status} jsonld=${h.jsonldEvents} cards=${h.htmlCards}`);
    }
    if (r.socials.instagram) console.log(`  ig: ${r.socials.instagram}`);
    console.log(`  → ${r.recommendation.confidence}: ${r.recommendation.rationale}`);
    if (r.recommendation.config) {
      console.log('  config:');
      console.log(
        JSON.stringify(r.recommendation.config, null, 2)
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n'),
      );
    }
  }

  await closeAllPools();
}

main().catch(async (e) => {
  console.error('Fatal:', e);
  await closeAllPools();
  process.exit(1);
});
