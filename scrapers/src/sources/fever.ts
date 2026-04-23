import {
  emptyStats,
  logError,
  resolveSourceId,
  sleep,
  upsertRawEvent,
  type RunStats,
} from '../run.ts';

const SLUG = 'fever';
const ORIGIN = 'https://feverup.com';
// Ciudades ES con mayor volumen. Cada página listado expone ~300 links /m/<id>.
const CITY_PATHS = [
  '/es/madrid',
  '/es/barcelona',
  '/es/sevilla',
  '/es/valencia',
  '/es/bilbao',
  '/es/malaga',
  '/es/zaragoza',
];
const REQ_DELAY_MS = 1200;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 4000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// JSON-LD que Fever embebe en /m/<id>. Estructura estable observada 2026-04.
interface FeverJsonLd {
  '@context'?: string;
  '@type'?: string | string[];
  name?: string;
  description?: string;
  sku?: string;
  image?: { contentUrl?: string } | string;
  offers?: Array<{
    '@type'?: string;
    name?: string;
    price?: number | string;
    priceCurrency?: string;
    availability?: string;
    url?: string;
    validFrom?: string;
    validThrough?: string;
    areaServed?: {
      '@type'?: string;
      name?: string;
      address?: { addressLocality?: string; streetAddress?: string; postalCode?: string };
      geo?: { latitude?: number; longitude?: number };
    };
  }>;
  startDate?: string;
  endDate?: string;
}

interface FeverPayload {
  externalId: string;
  url: string;
  city: string;
  jsonLd: FeverJsonLd;
  // Campos pre-extraidos para que la promoción no tenga que repetir lógica:
  eventDatetime: string | null;
}

export async function run(runId: number): Promise<RunStats> {
  const sourceId = await resolveSourceId(SLUG);
  const stats = emptyStats();

  // Paso 1: colectar IDs únicos de evento por ciudad.
  const eventUrls = new Map<string, string>(); // externalId → city (primera ciudad donde lo vimos)
  for (const cityPath of CITY_PATHS) {
    const cityName = cityPath.split('/').pop() ?? '';
    try {
      const html = await fetchHtml(`${ORIGIN}${cityPath}`);
      const ids = extractEventIds(html);
      for (const id of ids) {
        if (!eventUrls.has(id)) eventUrls.set(id, cityName);
      }
    } catch (e) {
      await logError(runId, `city fetch failed: ${String(e)}`, {
        url: `${ORIGIN}${cityPath}`,
        errorCode: 'city',
      });
      stats.items_error++;
    }
    await sleep(REQ_DELAY_MS);
  }
  console.log(`[fever] discovered ${eventUrls.size} unique events across ${CITY_PATHS.length} cities`);

  // Paso 2: fetch detalle por evento → JSON-LD → raw_events.
  let idx = 0;
  const totalEvents = eventUrls.size;
  for (const [externalId, city] of eventUrls) {
    idx++;
    const url = `${ORIGIN}/m/${externalId}`;
    try {
      const html = await fetchHtml(url);
      const jsonLd = extractJsonLd(html);
      if (!jsonLd) {
        await logError(runId, 'no JSON-LD found', { url, errorCode: 'no_jsonld' });
        stats.items_error++;
      } else {
        const eventDatetime = inferDatetime(jsonLd);
        if (!eventDatetime) {
          // Fever sin fecha = experiencia ongoing; saltamos para no ensuciar
          // ticket_public (que requiere event_datetime NOT NULL).
          stats.items_error++;
        } else {
          const payload: FeverPayload = {
            externalId,
            url,
            city,
            jsonLd,
            eventDatetime,
          };
          try {
            const result = await upsertRawEvent({
              runId,
              sourceId,
              externalId,
              url,
              payload,
            });
            stats.items_seen++;
            if (result === 'new') stats.items_new++;
          } catch (e) {
            await logError(runId, `upsert failed: ${String(e)}`, { url, errorCode: 'upsert' });
            stats.items_error++;
          }
        }
      }
    } catch (e) {
      await logError(runId, `detail fetch failed: ${String(e)}`, { url, errorCode: 'detail' });
      stats.items_error++;
    }
    if (idx % 50 === 0) {
      console.log(`[fever] ${idx}/${totalEvents} events · ${stats.items_seen} with date`);
    }
    await sleep(REQ_DELAY_MS);
  }

  return stats;
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
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_RETRIES) await sleep(FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function extractEventIds(html: string): string[] {
  const out = new Set<string>();
  const re = /href="\/m\/(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return Array.from(out);
}

// El JSON-LD de Fever viene en <script> sin type="application/ld+json".
// Hay múltiples scripts con el mismo contenido; el primero que matchea sirve.
function extractJsonLd(html: string): FeverJsonLd | null {
  const re = /<script[^>]*>(\{[\s\S]*?\})<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    if (!body.includes('"@context"') || !body.includes('schema.org')) continue;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && '@context' in parsed) {
        return parsed as FeverJsonLd;
      }
    } catch {
      // ignore; sigue buscando
    }
  }
  return null;
}

// Intenta deducir una fecha válida. Fever sólo la expone para eventos datados.
function inferDatetime(j: FeverJsonLd): string | null {
  const candidates = [j.startDate, j.offers?.[0]?.validFrom, j.offers?.[0]?.validThrough];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) {
        // Persistimos como "YYYY-MM-DD HH:MM:SS" (hora local asumida).
        return c.length === 10 ? `${c} 00:00:00` : c.slice(0, 19).replace('T', ' ');
      }
    }
  }
  return null;
}
