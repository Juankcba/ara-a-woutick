import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import {
  emptyStats,
  logError,
  resolveSourceId,
  sleep,
  upsertRawEvent,
  type RunStats,
} from '../run.ts';

const SLUG = 'taquilla';
const ORIGIN = 'https://www.taquilla.com';
// Páginas índice por categoría. Cada una expone una lista de /entradas/<slug>
// (páginas-artista que a su vez contienen múltiples fechas).
const CATEGORY_PATHS = [
  '/conciertos',
  '/espectaculos',
  '/deportes',
  '/actividades',
  '/parques',
  '/cine',
];
// Rate limit: Taquilla se queja con ETIMEDOUT si vamos muy rápido.
const REQ_DELAY_MS = 1500;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 4000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

interface TaquillaRawEvent {
  externalId: string;
  url: string;
  name: string;
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
    lat: number | null;
    lng: number | null;
  };
  offers: {
    price: number | null;
    lowPrice: number | null;
    highPrice: number | null;
    currency: string | null;
    availability: string | null;
    validFrom: string | null;
    buyUrl: string | null;
  };
  scrapedFrom: string;
}

export async function run(runId: number): Promise<RunStats> {
  const sourceId = await resolveSourceId(SLUG);
  const stats = emptyStats();

  const artistUrls = await collectArtistUrls(runId, stats);
  console.log(`[taquilla] discovered ${artistUrls.size} unique artist pages`);
  await logError(runId, `discovered ${artistUrls.size} artist pages`, { errorCode: 'info' });

  let artistIdx = 0;
  for (const artistUrl of artistUrls) {
    artistIdx++;
    try {
      const html = await fetchHtml(artistUrl);
      const events = parseArtistPage(html, artistUrl);
      if (events.length === 0) {
        // No bloqueante pero útil para el análisis post-run.
        await logError(runId, 'parsed 0 events from artist page', {
          url: artistUrl,
          errorCode: 'empty_parse',
        });
      }
      for (const ev of events) {
        try {
          const result = await upsertRawEvent({
            runId,
            sourceId,
            externalId: ev.externalId,
            url: ev.url,
            payload: ev,
          });
          stats.items_seen++;
          if (result === 'new') stats.items_new++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logError(runId, `upsert failed: ${msg}`, {
            url: ev.url,
            errorCode: 'upsert',
          });
          stats.items_error++;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logError(runId, `artist page failed: ${msg}`, {
        url: artistUrl,
        errorCode: 'fetch',
      });
      stats.items_error++;
    }
    if (artistIdx % 25 === 0) {
      console.log(
        `[taquilla] ${artistIdx}/${artistUrls.size} artists · ${stats.items_seen} events seen`,
      );
    }
    await sleep(REQ_DELAY_MS);
  }

  return stats;
}

async function collectArtistUrls(
  runId: number,
  stats: RunStats,
): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const path of CATEGORY_PATHS) {
    const categoryUrl = `${ORIGIN}${path}`;
    try {
      const html = await fetchHtml(categoryUrl);
      const $ = cheerio.load(html);
      $('a[href^="/entradas/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        // Limpiamos query params y fragmento para dedup.
        const clean = href.split('?')[0].split('#')[0];
        const m = clean.match(/^\/entradas\/[a-z0-9-]+$/);
        if (m) urls.add(`${ORIGIN}${clean}`);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logError(runId, `category fetch failed ${path}: ${msg}`, {
        url: categoryUrl,
        errorCode: 'category',
      });
      stats.items_error++;
    }
    await sleep(REQ_DELAY_MS);
  }
  return urls;
}

async function fetchHtml(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        // Node fetch default es sin timeout, lo ponemos explícito para no colgar.
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_RETRIES) await sleep(FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Selector para el itemscope raíz de un evento. Usamos $="Event" para NO
// capturar EventVenue (que también contiene "Event" como substring pero es un
// nested itemscope dentro del evento). Festival no termina en Event, se suma aparte.
const EVENT_SELECTOR =
  '[itemtype$="Event"], [itemtype$="Festival"]';

// Parsea microdata de Schema.org/Event (cualquier subtipo) en páginas de artista.
function parseArtistPage(html: string, sourceUrl: string): TaquillaRawEvent[] {
  const $ = cheerio.load(html);
  const out: TaquillaRawEvent[] = [];

  $(EVENT_SELECTOR).each((_, node) => {
    const $ev = $(node);
    const url = readMeta($ev, 'url') ?? '';
    const externalId = extractEventId(url);
    if (!externalId) return;

    const $performer = $ev.find('[itemprop="performer"]').first();
    const $location = $ev.find('[itemprop="location"]').first();
    const $address = $location.find('[itemprop="address"]').first();
    const $geo = $location.find('[itemprop="geo"]').first();
    const $offers = $ev.find('[itemprop="offers"]').first();

    out.push({
      externalId,
      url,
      name: readMeta($ev, 'name') ?? '',
      description: readMeta($ev, 'description'),
      startDate: readMeta($ev, 'startDate'),
      endDate: readMeta($ev, 'endDate'),
      image: readMeta($ev, 'image'),
      performer: {
        name: readMeta($performer, 'name'),
        url: readMeta($performer, 'url'),
      },
      venue: {
        name: readMeta($location, 'name'),
        url: readMeta($location, 'url'),
        streetAddress: readMeta($address, 'streetAddress'),
        postalCode: readMeta($address, 'postalCode'),
        locality: readMeta($address, 'addressLocality'),
        country: readMeta($address, 'addressCountry'),
        lat: readMetaNumber($geo, 'latitude'),
        lng: readMetaNumber($geo, 'longitude'),
      },
      offers: {
        price: readMetaNumber($offers, 'price'),
        lowPrice: readMetaNumber($offers, 'lowPrice'),
        highPrice: readMetaNumber($offers, 'highPrice'),
        currency: readMeta($offers, 'priceCurrency'),
        availability: readMeta($offers, 'availability'),
        validFrom: readMeta($offers, 'validFrom'),
        buyUrl: readMeta($offers, 'url'),
      },
      scrapedFrom: sourceUrl,
    });
  });

  return out;
}

type CheerioNode = ReturnType<CheerioAPI>;

// Para microdata inline, el valor suele venir en el atributo `content` del
// <meta itemprop="...">. Pero a veces también en texto. Soportamos ambos.
function readMeta($scope: CheerioNode, prop: string): string | null {
  const $el = $scope.find(`[itemprop="${prop}"]`).first();
  if (!$el.length) return null;
  const content = $el.attr('content');
  if (content != null && content.trim() !== '') return content.trim();
  const text = $el.text().trim();
  return text || null;
}

function readMetaNumber($scope: CheerioNode, prop: string): number | null {
  const v = readMeta($scope, prop);
  if (v == null) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function extractEventId(url: string): string | null {
  // URLs de evento en Taquilla: .../entradas/dani-martin?event=25091977#tickets-list
  const m = url.match(/[?&]event=(\d+)/);
  return m ? m[1] : null;
}
