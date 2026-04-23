import { chromium as chromiumExtra } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import {
  emptyStats,
  logError,
  resolveSourceId,
  sleep,
  upsertRawEvent,
  type RunStats,
} from '../run.ts';

// ECI (El Corte Inglés entradas) sirve ~50-70 JSON-LD Events inline por página
// de listado. Akamai bloquea curl/node-fetch → usamos Playwright + stealth.
//
// Venues son leads potenciales (Movistar Arena, WiZink Center, etc.). Promoter
// no está expuesto en JSON-LD (limitación conocida en plataformas ES).

chromiumExtra.use(stealth());

const SLUG = 'elcorteingles';
const ORIGIN = 'https://www.elcorteingles.es';
// Rutas donde ECI renderiza JSON-LD Events inline. Comprobadas manualmente.
const LISTING_PATHS = [
  '/entradas/',
  '/entradas/conciertos/',
  '/entradas/conciertos/todos/',
  '/entradas/teatro/',
  '/entradas/en-familia/',
  '/entradas/otros/',
];
const WAIT_AFTER_LOAD_MS = 3000;
const DELAY_BETWEEN_LISTINGS_MS = 2500;
// Scroll lento hasta el final para que Next.js / lazy-load monten todos los JSON-LD.
const SCROLL_STEPS = 8;
const SCROLL_DELAY_MS = 400;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Shape mínimo del JSON-LD de ECI. Tolerante a campos opcionales.
interface EciJsonLd {
  '@context'?: string;
  '@type'?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  eventStatus?: string;
  description?: string;
  image?: string | { '@type': string; url?: string; contentUrl?: string };
  url?: string;
  location?: {
    name?: string;
    url?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
      postalCode?: string;
    };
  };
  offers?: {
    price?: number | string;
    priceCurrency?: string;
    availability?: string;
    url?: string;
    validFrom?: string;
  };
  performer?: Array<{ '@type'?: string; name?: string }> | { name?: string };
}

interface EciPayload {
  externalId: string;
  url: string;
  eventDatetime: string;
  jsonLd: EciJsonLd;
  scrapedFrom: string;
}

export async function run(runId: number): Promise<RunStats> {
  const sourceId = await resolveSourceId(SLUG);
  const stats = emptyStats();

  const browser = await chromiumExtra.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Dedup cross-listing por URL del JSON-LD (estable, único por evento).
  const seenUrls = new Set<string>();

  try {
    for (const path of LISTING_PATHS) {
      const url = `${ORIGIN}${path}`;
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const status = res?.status() ?? 0;
        if (status !== 200) {
          await logError(runId, `HTTP ${status}`, { url, errorCode: `http_${status}` });
          stats.items_error++;
          continue;
        }
        await page.waitForTimeout(WAIT_AFTER_LOAD_MS);
        // Scroll incremental para gatillar IntersectionObserver-based lazy rendering.
        for (let i = 0; i < SCROLL_STEPS; i++) {
          await page.evaluate((step) => {
            window.scrollTo({ top: document.body.scrollHeight * (step / 8), behavior: 'instant' as ScrollBehavior });
          }, i + 1);
          await page.waitForTimeout(SCROLL_DELAY_MS);
        }
      } catch (e) {
        await logError(runId, `nav failed: ${String(e)}`, { url, errorCode: 'nav' });
        stats.items_error++;
        continue;
      }

      // Extraer todos los JSON-LD blocks que sean Event/MusicEvent/TheaterEvent/ComedyEvent/Festival.
      const rawBlocks: string[] = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
        nodes.map((n) => n.textContent ?? ''),
      );

      let parsedInThisPage = 0;
      for (const body of rawBlocks) {
        const data = safeJsonParse(body);
        if (data == null) continue;
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!isEvent(item)) continue;
          const jl = item as EciJsonLd;
          const eventUrl = jl.url ?? jl.offers?.url;
          if (!eventUrl) continue;
          if (seenUrls.has(eventUrl)) continue;
          seenUrls.add(eventUrl);

          const externalId = extractExternalId(eventUrl);
          if (!externalId) continue;
          if (!jl.startDate) continue;

          const payload: EciPayload = {
            externalId,
            url: eventUrl,
            eventDatetime: normalizeDateTime(jl.startDate),
            jsonLd: jl,
            scrapedFrom: url,
          };
          try {
            const result = await upsertRawEvent({
              runId,
              sourceId,
              externalId,
              url: eventUrl,
              payload,
            });
            stats.items_seen++;
            if (result === 'new') stats.items_new++;
            parsedInThisPage++;
          } catch (e) {
            await logError(runId, `upsert failed: ${String(e)}`, {
              url: eventUrl,
              errorCode: 'upsert',
            });
            stats.items_error++;
          }
        }
      }
      console.log(`[eci] ${path} → ${parsedInThisPage} events (total unique: ${seenUrls.size})`);
      await sleep(DELAY_BETWEEN_LISTINGS_MS);
    }
  } finally {
    await browser.close();
  }

  return stats;
}

function isEvent(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const t = (obj as { '@type'?: string | string[] })['@type'];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  return types.some((x) => /event$|festival$/i.test(x));
}

// El URL canónico de ECI termina en el slug. Usamos la última fracción como externalId
// estable. Ej: ".../entradas-miguel-poveda-madrid/" → "entradas-miguel-poveda-madrid".
function extractExternalId(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return segments[segments.length - 1] ?? null;
  } catch {
    return null;
  }
}

// ECI embebe saltos de línea literales dentro de strings JSON (en description,
// etc.). JSON.parse los rechaza con "Bad control character in string literal".
// Este preprocesador reemplaza \n/\r/\t dentro de string literals por sus
// equivalentes escapados, preservando el significado.
function safeJsonParse(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    // segundo intento tras sanitizar control chars dentro de strings
  }
  try {
    const fixed = s.replace(/"((?:[^"\\]|\\.)*)"/gs, (_match, body: string) => {
      const escaped = body
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `"${escaped}"`;
    });
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

function normalizeDateTime(s: string): string {
  // ECI usa YYYY-MM-DD. Lo promovemos a "YYYY-MM-DD HH:MM:SS" (hora local Madrid, 00:00).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  // Si viniera con hora, mantenemos los primeros 19 chars normalizados a "YYYY-MM-DD HH:MM:SS"
  return s.slice(0, 19).replace('T', ' ');
}
