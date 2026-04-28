// Generic ticketera scraper — consumed `config_json` de sources.
//
// Soporta 3 estrategias en orden de robustez:
//   1. sitemap   → leer sitemap.xml, filtrar URLs por regex de "evento",
//                  luego (opcional) fetch a cada página y extraer JSON-LD.
//   2. jsonld    → fetch a una página listing y extraer todo `Event` de JSON-LD.
//   3. selectors → CSS selectors custom sobre una listing (fallback manual).
//
// Cada evento se normaliza al payload schema "lite" Schema.org-style y se
// guarda en raw_events. La promoción a leads_crm.companies (organizadores +
// venues) la hace el job promote.ts existente.
//
// Mode dry-run: setea `dryRun: true` en runOptions; no escribe a DB,
// devuelve los eventos en stats.preview.

import * as cheerio from 'cheerio';
import {
  emptyStats,
  logError,
  sleep,
  upsertRawEvent,
  type RunStats,
} from '../run.ts';
import { scrapingPool } from '../db.ts';
import type { RowDataPacket } from 'mysql2';

// ────────────────────────────────────────────────────────────────────
// Tipos del config_json
// ────────────────────────────────────────────────────────────────────

interface SitemapStrategy {
  type: 'sitemap';
  url: string;                       // absolute URL of sitemap.xml
  event_url_pattern?: string;        // regex literal sin slashes (e.g. "/evento/|/entradas/")
  fetch_each?: boolean;              // also fetch each event URL for details
  max_urls?: number;                 // safety cap (default: 200)
  // 'http' (default) usa fetch() — rápido. 'playwright' lanza chromium con
  // stealth para pasar Cloudflare / WAF. Costo: ~5s × max_urls.
  fetch_via?: 'http' | 'playwright';
  // Solo aplica con fetch_via=playwright. Tiempo extra a esperar después del
  // domcontentloaded para que el JS hidrate (default 1500ms).
  wait_ms_per_page?: number;
}

interface JsonLdStrategy {
  type: 'jsonld';
  listing_url: string;               // page that exposes JSON-LD events
  paginate?: {                       // optional pagination
    url_template: string;            // '?page={n}' or '/page/{n}'
    start?: number;                  // default 1
    max_pages?: number;              // default 5
  };
}

interface SelectorsStrategy {
  type: 'selectors';
  listing_url: string;
  event_card: string;                // selector for each event element
  fields: {
    title?: string;
    url?: string;
    datetime?: string;
    venue?: string;
    price?: string;
    image?: string;
  };
}

interface PlaywrightStrategy {
  type: 'playwright';
  // String para 1 listing, array para varios (cada URL se procesa con la misma
  // config y un browser context fresco). Útil para sitios particionados por
  // ciudad / categoría / página.
  listing_url: string | string[];
  // Qué extraer DESPUÉS de que la página renderice. 'jsonld' = parsea JSON-LD
  // del HTML final (cubre la mayoría — Cloudflare-passed sites con SSR-tras-JS).
  // 'next_data' = parsea __NEXT_DATA__ JSON (Next.js SPAs). 'selectors' = aplica
  // CSS selectors sobre el HTML hidratado (igual que strategy=selectors).
  extract: 'jsonld' | 'next_data' | { selectors: SelectorsStrategy['fields'] & { event_card: string } };
  wait_ms?: number;                  // default 3000 — tras goto, antes de extraer
  wait_for_selector?: string;        // si se setea, espera por ese selector antes
  scroll?: boolean;                  // default true — scroll para lazy-load
  scroll_steps?: number;             // default 8
  // Si se setea, busca un iframe cuyo URL matchee este regex y aplica
  // `extract` sobre el HTML del iframe en vez del de la page principal.
  // Útil para sitios legacy janto que renderizan eventos dentro de
  // modulos.php?nivel=menuEventos.
  iframe_url_pattern?: string;
}

type Strategy = SitemapStrategy | JsonLdStrategy | SelectorsStrategy | PlaywrightStrategy;

export interface ScraperConfig {
  strategy: Strategy;
  rate_limit_ms?: number;
  user_agent?: string;
}

// ────────────────────────────────────────────────────────────────────
// Payload normalizado (similar a taquilla)
// ────────────────────────────────────────────────────────────────────

export interface GenericRawEvent {
  externalId: string;
  url: string;
  name: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  image: string | null;
  performer: { name: string | null; url: string | null };
  venue: {
    name: string | null;
    url: string | null;
    streetAddress: string | null;
    postalCode: string | null;
    locality: string | null;
    country: string | null;
  };
  organizer: { name: string | null; url: string | null };
  offers: {
    lowPrice: number | null;
    highPrice: number | null;
    currency: string | null;
    availability: string | null;
  };
  socials: {
    instagram: string | null;
    facebook: string | null;
    twitter: string | null;
  };
  scrapedFrom: string;
  source: string;
  strategy: string;
}

// ────────────────────────────────────────────────────────────────────
// Public entry
// ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  dryRun?: boolean;        // no DB writes; events into stats.preview
  maxItems?: number;       // hard cap regardless of config
}

export interface RunResult extends RunStats {
  preview?: GenericRawEvent[];
}

const DEFAULT_DELAY_MS = 1500;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20_000;
const SAFETY_MAX_URLS = 200;

export async function runGeneric(
  runId: number,
  sourceSlug: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    'SELECT id, slug, base_url, config FROM sources WHERE slug = ?',
    [sourceSlug],
  );
  const src = rows[0];
  if (!src) throw new Error(`Unknown source: ${sourceSlug}`);

  const rawConfig = src.config;
  const config: ScraperConfig | null =
    rawConfig && typeof rawConfig === 'object' && 'strategy' in rawConfig
      ? (rawConfig as ScraperConfig)
      : null;
  if (!config?.strategy?.type) {
    throw new Error(
      `Source '${sourceSlug}' has no strategy configured (config.strategy.type missing)`,
    );
  }

  const ctx: RunContext = {
    runId,
    sourceId: src.id as number,
    sourceSlug,
    baseUrl: (src.base_url as string) ?? '',
    config,
    options,
    stats: emptyStats(),
    preview: options.dryRun ? [] : undefined,
    delayMs: config.rate_limit_ms ?? DEFAULT_DELAY_MS,
    userAgent: config.user_agent ?? DEFAULT_USER_AGENT,
  };

  switch (config.strategy.type) {
    case 'sitemap':
      await runSitemapStrategy(ctx, config.strategy);
      break;
    case 'jsonld':
      await runJsonLdStrategy(ctx, config.strategy);
      break;
    case 'selectors':
      await runSelectorsStrategy(ctx, config.strategy);
      break;
    case 'playwright':
      await runPlaywrightStrategy(ctx, config.strategy);
      break;
  }

  return { ...ctx.stats, preview: ctx.preview };
}

// ────────────────────────────────────────────────────────────────────
// Internal context + helpers
// ────────────────────────────────────────────────────────────────────

interface RunContext {
  runId: number;
  sourceId: number;
  sourceSlug: string;
  baseUrl: string;
  config: ScraperConfig;
  options: RunOptions;
  stats: RunStats;
  preview?: GenericRawEvent[];
  delayMs: number;
  userAgent: string;
}

async function reportError(
  ctx: RunContext,
  message: string,
  opts: { url?: string; errorCode?: string } = {},
): Promise<void> {
  if (ctx.options.dryRun) {
    const tag = opts.errorCode === 'info' ? 'INFO' : 'ERR ';
    console.log(`  [${tag}] ${message}${opts.url ? ` (${opts.url})` : ''}`);
    return;
  }
  await logError(ctx.runId, message, opts);
}

async function fetchText(url: string, userAgent: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} on ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function resolveUrl(maybeRelative: string, base: string): string {
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return maybeRelative;
  }
}

function maxItemsReached(ctx: RunContext): boolean {
  return ctx.options.maxItems !== undefined && ctx.stats.items_seen >= ctx.options.maxItems;
}

async function emitEvent(ctx: RunContext, event: GenericRawEvent): Promise<void> {
  if (maxItemsReached(ctx)) return;
  ctx.stats.items_seen++;

  if (ctx.options.dryRun) {
    ctx.preview?.push(event);
    return;
  }

  try {
    const result = await upsertRawEvent({
      runId: ctx.runId,
      sourceId: ctx.sourceId,
      externalId: event.externalId,
      url: event.url,
      payload: event,
    });
    if (result === 'new') ctx.stats.items_new++;
    else ctx.stats.items_updated++;
  } catch (err) {
    ctx.stats.items_error++;
    await reportError(ctx, err instanceof Error ? err.message : String(err), {
      url: event.url,
      errorCode: 'upsert_failed',
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// Strategy: sitemap
// ────────────────────────────────────────────────────────────────────

async function runSitemapStrategy(ctx: RunContext, s: SitemapStrategy): Promise<void> {
  const usePlaywright = s.fetch_via === 'playwright';
  const sitemapUrl = resolveUrl(s.url, ctx.baseUrl);

  // Pool de fetch unificado — abre browser una sola vez si aplica.
  const fetcher = usePlaywright
    ? await openPlaywrightFetcher(ctx, s.wait_ms_per_page ?? 1500)
    : { fetch: (u: string) => fetchText(u, ctx.userAgent), close: async () => {} };

  try {
    const xml = await fetcher.fetch(sitemapUrl);
    const urls = extractSitemapUrls(xml, ctx.baseUrl);

    const filtered = s.event_url_pattern
      ? (() => {
          const re = new RegExp(s.event_url_pattern!, 'i');
          return urls.filter((u) => re.test(u));
        })()
      : urls;

    const limit = Math.min(filtered.length, s.max_urls ?? SAFETY_MAX_URLS);
    const slice = filtered.slice(0, limit);

    await reportError(ctx, `sitemap (${usePlaywright ? 'pw' : 'http'}): ${urls.length} urls, ${filtered.length} match, processing ${limit}`, {
      errorCode: 'info',
      url: sitemapUrl,
    });

    if (!s.fetch_each) {
      // Modo "solo URLs": cada URL es un evento mínimo (sin detalles)
      for (const u of slice) {
        await emitEvent(ctx, {
          ...emptyEvent(ctx, u),
          url: u,
          name: null,
        });
      }
      return;
    }

    // Modo "fetch each": para cada URL, descargar página y parsear JSON-LD
    for (const u of slice) {
      if (maxItemsReached(ctx)) break;
      try {
        const html = await fetcher.fetch(u);
        const events = parseJsonLdEvents(html, u, ctx);
        if (events.length === 0) {
          // Si no hay JSON-LD, al menos guardamos URL+title del HTML
          events.push(parseHtmlMinimum(html, u, ctx));
        }
        for (const ev of events) {
          if (maxItemsReached(ctx)) break;
          await emitEvent(ctx, ev);
        }
      } catch (err) {
        ctx.stats.items_error++;
        await reportError(ctx, err instanceof Error ? err.message : String(err), {
          url: u,
          errorCode: 'fetch_failed',
        });
      }
      await sleep(ctx.delayMs);
    }
  } finally {
    await fetcher.close();
  }
}

interface Fetcher {
  fetch: (url: string) => Promise<string>;
  close: () => Promise<void>;
}

// Devuelve un fetcher que reusa una sola página de chromium para todas las
// requests. Más lento que fetch() pero pasa Cloudflare y puede esperar JS.
//
// Para XML/JSON (page.goto los descarga en vez de navegar), evaluamos un
// fetch() desde el contexto del navegador — reusa las cookies de CF que
// quedaron seteadas tras el warmup a la home.
async function openPlaywrightFetcher(ctx: RunContext, waitPerPageMs = 1500): Promise<Fetcher> {
  const { chromium } = await import('playwright-extra');
  const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
  chromium.use(stealth());

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const browserCtx = await browser.newContext({
    userAgent: ctx.userAgent,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1440, height: 900 },
  });
  const page = await browserCtx.newPage();

  // Warmup: visitar la home a sembrar cookies de CF antes de cualquier request.
  if (ctx.baseUrl) {
    try {
      await page.goto(ctx.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);
    } catch {
      // El warmup puede fallar sin que importe — seguimos y vemos qué pasa.
    }
  }

  return {
    async fetch(url: string): Promise<string> {
      // XML / JSON: page.goto los baja en lugar de navegar.
      // page.evaluate(fetch) usa las cookies actuales y devuelve el body como texto.
      if (/\.(xml|json)(\?|$)/i.test(url)) {
        return await page.evaluate(async (u) => {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`);
          return await r.text();
        }, url);
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(waitPerPageMs);
      return page.content();
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

function extractSitemapUrls(xml: string, baseUrl: string): string[] {
  // Soporta sitemap simple (<urlset>) y sitemapindex (recursivo no implementado todavía)
  const out: string[] = [];
  const locRegex = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = locRegex.exec(xml)) !== null) {
    const loc = m[1].trim();
    out.push(resolveUrl(loc, baseUrl));
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Strategy: jsonld
// ────────────────────────────────────────────────────────────────────

async function runJsonLdStrategy(ctx: RunContext, s: JsonLdStrategy): Promise<void> {
  const start = s.paginate?.start ?? 1;
  const maxPages = s.paginate?.max_pages ?? 1;

  for (let page = start; page < start + maxPages; page++) {
    const url =
      s.paginate?.url_template
        ? resolveUrl(s.paginate.url_template.replace('{n}', String(page)), ctx.baseUrl)
        : resolveUrl(s.listing_url, ctx.baseUrl);

    try {
      const html = await fetchText(url, ctx.userAgent);
      const events = parseJsonLdEvents(html, url, ctx);
      await reportError(ctx,`jsonld page ${page}: ${events.length} events`, {
        errorCode: 'info',
        url,
      });
      for (const ev of events) await emitEvent(ctx, ev);
      if (events.length === 0 && page > start) break; // empty page → stop paginating
    } catch (err) {
      ctx.stats.items_error++;
      await reportError(ctx,err instanceof Error ? err.message : String(err), {
        url,
        errorCode: 'fetch_failed',
      });
      break;
    }
    if (s.paginate) await sleep(ctx.delayMs);
  }
}

// Parsea todos los <script type="application/ld+json"> y extrae:
// - @type Event (o array)
// - ItemList con @type Event en items
// - @graph que contenga Events
function parseJsonLdEvents(html: string, pageUrl: string, ctx: RunContext): GenericRawEvent[] {
  const $ = cheerio.load(html);
  const events: GenericRawEvent[] = [];
  const socials = extractSocials($);

  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(txt);
    } catch {
      return;
    }
    walkJsonLd(parsed, (node) => {
      if (isEventNode(node)) {
        events.push(jsonLdToEvent(node, pageUrl, ctx, socials));
      }
    });
  });

  return events;
}

type JsonLdNode = Record<string, unknown>;

function walkJsonLd(node: unknown, cb: (n: JsonLdNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, cb);
    return;
  }
  const obj = node as JsonLdNode;
  cb(obj);
  if (Array.isArray(obj['@graph'])) walkJsonLd(obj['@graph'], cb);
  if (Array.isArray(obj.itemListElement)) walkJsonLd(obj.itemListElement, cb);
  if (obj.item && typeof obj.item === 'object') walkJsonLd(obj.item, cb);
}

function isEventNode(node: JsonLdNode): boolean {
  const t = node['@type'];
  if (typeof t === 'string') return /Event/i.test(t);
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && /Event/i.test(x));
  return false;
}

function getString(o: unknown, ...keys: string[]): string | null {
  for (const k of keys) {
    if (o && typeof o === 'object' && k in o) {
      const v = (o as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

function getNumber(o: unknown, key: string): number | null {
  if (o && typeof o === 'object' && key in o) {
    const v = (o as Record<string, unknown>)[key];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function jsonLdToEvent(
  node: JsonLdNode,
  pageUrl: string,
  ctx: RunContext,
  socials: GenericRawEvent['socials'],
): GenericRawEvent {
  const url = getString(node, 'url') ?? pageUrl;
  const externalId = url; // canonical URL es id estable

  const location = node.location && typeof node.location === 'object' ? node.location : {};
  const address =
    typeof (location as JsonLdNode).address === 'object'
      ? ((location as JsonLdNode).address as JsonLdNode)
      : {};

  const offers = node.offers && typeof node.offers === 'object' ? node.offers : {};
  const offerArr = Array.isArray(offers) ? (offers as JsonLdNode[]) : [offers as JsonLdNode];
  const prices = offerArr
    .map((o) => getNumber(o, 'price') ?? getNumber(o, 'lowPrice'))
    .filter((p): p is number => p !== null);
  const lowPrice = prices.length ? Math.min(...prices) : getNumber(offers, 'lowPrice');
  const highPrice = prices.length ? Math.max(...prices) : getNumber(offers, 'highPrice');

  const performer = node.performer && typeof node.performer === 'object'
    ? Array.isArray(node.performer)
      ? (node.performer[0] as JsonLdNode | undefined) ?? {}
      : (node.performer as JsonLdNode)
    : {};

  const organizer = node.organizer && typeof node.organizer === 'object'
    ? Array.isArray(node.organizer)
      ? (node.organizer[0] as JsonLdNode | undefined) ?? {}
      : (node.organizer as JsonLdNode)
    : {};

  return {
    externalId,
    url,
    name: getString(node, 'name'),
    description: getString(node, 'description'),
    startDate: getString(node, 'startDate'),
    endDate: getString(node, 'endDate'),
    image: getImageString(node.image) ?? null,
    performer: {
      name: getString(performer, 'name'),
      url: getString(performer, 'url'),
    },
    venue: {
      name: getString(location, 'name'),
      url: getString(location, 'url'),
      streetAddress: getString(address, 'streetAddress'),
      postalCode: getString(address, 'postalCode'),
      locality: getString(address, 'addressLocality'),
      country: getString(address, 'addressCountry'),
    },
    organizer: {
      name: getString(organizer, 'name'),
      url: getString(organizer, 'url'),
    },
    offers: {
      lowPrice,
      highPrice,
      currency: getString(offers, 'priceCurrency'),
      availability: getString(offers, 'availability'),
    },
    socials,
    scrapedFrom: pageUrl,
    source: ctx.sourceSlug,
    strategy: ctx.config.strategy.type,
  };
}

function getImageString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  if (v && typeof v === 'object' && 'url' in v && typeof (v as JsonLdNode).url === 'string') {
    return (v as JsonLdNode).url as string;
  }
  return null;
}

function extractSocials($: cheerio.CheerioAPI): GenericRawEvent['socials'] {
  const find = (re: RegExp): string | null => {
    let found: string | null = null;
    $('a[href]').each((_, el) => {
      if (found) return;
      const href = $(el).attr('href') ?? '';
      if (re.test(href)) found = href;
    });
    return found;
  };
  return {
    instagram: find(/instagram\.com\/[^\/?#]+/i),
    facebook: find(/facebook\.com\/[^\/?#]+/i),
    twitter: find(/(twitter\.com|x\.com)\/[^\/?#]+/i),
  };
}

// ────────────────────────────────────────────────────────────────────
// Strategy: selectors (fallback manual)
// ────────────────────────────────────────────────────────────────────

async function runSelectorsStrategy(ctx: RunContext, s: SelectorsStrategy): Promise<void> {
  const url = resolveUrl(s.listing_url, ctx.baseUrl);
  const html = await fetchText(url, ctx.userAgent);
  const $ = cheerio.load(html);
  const socials = extractSocials($);

  const cards = $(s.event_card);
  await reportError(ctx,`selectors: ${cards.length} cards`, { errorCode: 'info', url });

  const cardArr = cards.toArray();
  for (let idx = 0; idx < cardArr.length; idx++) {
    const $el = $(cardArr[idx]);
    const pick = makePick($el);
    // URL resolution con varios fallbacks:
    //   1) selector explícito en fields.url (puede ser "selector@attr")
    //   2) card mismo si es <a>
    //   3) primer <a> dentro del card
    let href: string | undefined;
    if (s.fields.url) {
      const { sel, attr } = parseSelectorSpec(s.fields.url);
      href = $el.find(sel).first().attr(attr ?? 'href') ?? undefined;
    }
    if (!href && $el.is('a')) href = $el.attr('href') ?? undefined;
    if (!href) href = $el.find('a').first().attr('href') ?? undefined;
    const eventUrl = href ? resolveUrl(href, ctx.baseUrl) : `${url}#card-${idx}`;

    const ev: GenericRawEvent = {
      ...emptyEvent(ctx, eventUrl),
      externalId: eventUrl,
      url: eventUrl,
      name: pick(s.fields.title),
      startDate: pick(s.fields.datetime),
      image: pickImg($el, s.fields.image),
      venue: {
        ...emptyVenue(),
        name: pick(s.fields.venue),
      },
      offers: {
        lowPrice: parsePriceFromText(pick(s.fields.price)),
        highPrice: null,
        currency: 'EUR',
        availability: null,
      },
      socials,
    };
    await emitEvent(ctx, ev);
  }
}

function parsePriceFromText(txt: string | null): number | null {
  if (!txt) return null;
  const m = txt.match(/(\d+[.,]?\d*)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────────
// Strategy: playwright (browser real para CF challenges + SPAs)
// ────────────────────────────────────────────────────────────────────

async function runPlaywrightStrategy(ctx: RunContext, s: PlaywrightStrategy): Promise<void> {
  // Dynamic import: si nadie usa playwright en una run, no se cargan los binarios.
  const { chromium } = await import('playwright-extra');
  const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
  chromium.use(stealth());

  const listingUrls = Array.isArray(s.listing_url) ? s.listing_url : [s.listing_url];

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const browserCtx = await browser.newContext({
      userAgent: ctx.userAgent,
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
      viewport: { width: 1440, height: 900 },
    });
    const page = await browserCtx.newPage();

    for (const rawUrl of listingUrls) {
      if (maxItemsReached(ctx)) break;
      const url = resolveUrl(rawUrl, ctx.baseUrl);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (err) {
        ctx.stats.items_error++;
        await reportError(ctx, err instanceof Error ? err.message : String(err), {
          url,
          errorCode: 'pw_goto_failed',
        });
        continue;
      }

      if (s.wait_for_selector) {
        try {
          await page.waitForSelector(s.wait_for_selector, { timeout: 15_000 });
        } catch {
          await reportError(ctx, `wait_for_selector timeout: ${s.wait_for_selector}`, {
            url,
            errorCode: 'pw_wait_timeout',
          });
        }
      }
      await page.waitForTimeout(s.wait_ms ?? 3000);

      if (s.scroll !== false) {
        const steps = s.scroll_steps ?? 8;
        for (let i = 0; i < steps; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(400);
        }
      }

      // Si pidieron extraer del contenido de un iframe, lo buscamos por URL.
      // Útil para sitios legacy janto que renderizan eventos dentro de
      // /modulos.php?nivel=menuEventos.
      let html: string;
      let extractedFrom = url;
      if (s.iframe_url_pattern) {
        const re = new RegExp(s.iframe_url_pattern);
        const frame = page.frames().find((f) => re.test(f.url()));
        if (!frame) {
          await reportError(ctx, `iframe matching /${s.iframe_url_pattern}/ no encontrado`, {
            url,
            errorCode: 'iframe_not_found',
          });
          continue;
        }
        html = await frame.content();
        extractedFrom = frame.url();
      } else {
        html = await page.content();
      }

      let events: GenericRawEvent[] = [];
      if (s.extract === 'jsonld') {
        events = parseJsonLdEvents(html, extractedFrom, ctx);
      } else if (s.extract === 'next_data') {
        events = parseNextDataEvents(html, extractedFrom, ctx);
      } else {
        events = parseSelectorsFromHtml(html, extractedFrom, ctx, s.extract.selectors);
      }

      await reportError(ctx, `playwright ${url}${s.iframe_url_pattern ? ' (iframe)' : ''}: ${events.length} events`, {
        errorCode: 'info',
        url,
      });

      for (const ev of events) {
        if (maxItemsReached(ctx)) break;
        await emitEvent(ctx, ev);
      }

      if (listingUrls.length > 1) await sleep(ctx.delayMs);
    }
  } finally {
    await browser.close();
  }
}

// Parsea __NEXT_DATA__ de Next.js para sitios que solo exponen eventos
// en el JSON server-side props. Heurística: encontrar arrays de objetos
// que tengan name + (startDate|date|datetime) + (location|venue).
function parseNextDataEvents(html: string, pageUrl: string, ctx: RunContext): GenericRawEvent[] {
  const $ = cheerio.load(html);
  const socials = extractSocials($);
  const script = $('#__NEXT_DATA__').contents().text();
  if (!script.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(script);
  } catch {
    return [];
  }

  const events: GenericRawEvent[] = [];
  const seen = new Set<string>();

  function looksLikeEvent(o: Record<string, unknown>): boolean {
    if (!o || typeof o !== 'object') return false;
    const hasName = typeof o.name === 'string' || typeof o.title === 'string';
    const hasDate =
      typeof o.startDate === 'string' ||
      typeof o.date === 'string' ||
      typeof o.datetime === 'string' ||
      typeof o.event_date === 'string';
    return hasName && hasDate;
  }

  function nodeToEvent(o: Record<string, unknown>): GenericRawEvent | null {
    const url =
      (typeof o.url === 'string' && o.url) ||
      (typeof o.slug === 'string' && new URL(`/${o.slug}`, pageUrl).href) ||
      pageUrl;
    if (seen.has(url)) return null;
    seen.add(url);

    const name = (typeof o.name === 'string' && o.name) || (typeof o.title === 'string' && o.title) || null;
    const startDate =
      (typeof o.startDate === 'string' && o.startDate) ||
      (typeof o.date === 'string' && o.date) ||
      (typeof o.datetime === 'string' && o.datetime) ||
      null;
    const venueRaw = (o.venue ?? o.location) as Record<string, unknown> | string | undefined;
    const venueName =
      typeof venueRaw === 'string'
        ? venueRaw
        : (venueRaw && typeof venueRaw === 'object' && typeof venueRaw.name === 'string'
            ? venueRaw.name
            : null);

    return {
      ...emptyEvent(ctx, url),
      externalId: url,
      url,
      name,
      startDate,
      venue: { ...emptyVenue(), name: venueName },
      socials,
    };
  }

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (looksLikeEvent(obj)) {
      const ev = nodeToEvent(obj);
      if (ev) events.push(ev);
    }
    for (const v of Object.values(obj)) walk(v);
  }

  walk(parsed);
  return events;
}

// Aplica selectors style sobre HTML pre-renderizado (post-Playwright).
function parseSelectorsFromHtml(
  html: string,
  pageUrl: string,
  ctx: RunContext,
  spec: { event_card: string } & SelectorsStrategy['fields'],
): GenericRawEvent[] {
  const $ = cheerio.load(html);
  const socials = extractSocials($);
  const cards = $(spec.event_card).toArray();
  const out: GenericRawEvent[] = [];

  for (let idx = 0; idx < cards.length; idx++) {
    const $el = $(cards[idx]);
    const pick = makePick($el);
    let href: string | undefined;
    if (spec.url) {
      const parsed = parseSelectorSpec(spec.url);
      href = $el.find(parsed.sel).first().attr(parsed.attr ?? 'href') ?? undefined;
    }
    if (!href && $el.is('a')) href = $el.attr('href') ?? undefined;
    if (!href) href = $el.find('a').first().attr('href') ?? undefined;
    const eventUrl = href ? resolveUrl(href, ctx.baseUrl) : `${pageUrl}#card-${idx}`;

    out.push({
      ...emptyEvent(ctx, eventUrl),
      externalId: eventUrl,
      url: eventUrl,
      name: pick(spec.title),
      startDate: pick(spec.datetime),
      image: pickImg($el, spec.image),
      venue: { ...emptyVenue(), name: pick(spec.venue) },
      offers: {
        lowPrice: parsePriceFromText(pick(spec.price)),
        highPrice: null,
        currency: 'EUR',
        availability: null,
      },
      socials,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Field extraction helpers — sintaxis "selector@attr"
//
// Default (sin @attr): toma .text() del primer match, fallback a attr('content').
// Con "@attr": toma ese atributo (típico: img@alt, img@src, time@datetime).
// ────────────────────────────────────────────────────────────────────

function parseSelectorSpec(spec: string): { sel: string; attr: string | null } {
  // Solo aceptamos un único '@' como separador, y debe venir después del selector.
  // Esto permite selectores con [attr=value] siempre que no usen '@'.
  const idx = spec.lastIndexOf('@');
  if (idx <= 0) return { sel: spec, attr: null };
  return { sel: spec.slice(0, idx), attr: spec.slice(idx + 1) };
}

type CheerioElement = ReturnType<cheerio.CheerioAPI>;

function makePick($el: CheerioElement): (spec?: string) => string | null {
  return (spec) => {
    if (!spec) return null;
    const { sel, attr } = parseSelectorSpec(spec);
    const t = $el.find(sel).first();
    if (attr) return t.attr(attr)?.trim() || null;
    const txt = t.text().trim();
    return txt || t.attr('content')?.trim() || null;
  };
}

function pickImg($el: CheerioElement, spec?: string): string | null {
  if (!spec) return $el.find('img').first().attr('src') ?? null;
  const { sel, attr } = parseSelectorSpec(spec);
  const t = $el.find(sel).first();
  return t.attr(attr ?? 'src')?.trim() || null;
}

// ────────────────────────────────────────────────────────────────────
// Empty payload helpers
// ────────────────────────────────────────────────────────────────────

function emptyVenue(): GenericRawEvent['venue'] {
  return {
    name: null,
    url: null,
    streetAddress: null,
    postalCode: null,
    locality: null,
    country: null,
  };
}

function emptyEvent(ctx: RunContext, url: string): GenericRawEvent {
  return {
    externalId: url,
    url,
    name: null,
    description: null,
    startDate: null,
    endDate: null,
    image: null,
    performer: { name: null, url: null },
    venue: emptyVenue(),
    organizer: { name: null, url: null },
    offers: { lowPrice: null, highPrice: null, currency: null, availability: null },
    socials: { instagram: null, facebook: null, twitter: null },
    scrapedFrom: url,
    source: ctx.sourceSlug,
    strategy: ctx.config.strategy.type,
  };
}

function parseHtmlMinimum(html: string, url: string, ctx: RunContext): GenericRawEvent {
  const $ = cheerio.load(html);
  const socials = extractSocials($);
  return {
    ...emptyEvent(ctx, url),
    name: $('h1').first().text().trim() || $('title').text().trim() || null,
    description: $('meta[name="description"]').attr('content') ?? null,
    image: $('meta[property="og:image"]').attr('content') ?? null,
    socials,
  };
}
