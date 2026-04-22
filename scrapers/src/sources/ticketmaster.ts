import {
  emptyStats,
  logError,
  resolveSourceId,
  sleep,
  upsertRawEvent,
  type RunStats,
} from '../run.ts';

const SLUG = 'ticketmaster';
const BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';
const COUNTRY = 'ES';
const PAGE_SIZE = 100;
// Free tier: 5 req/sec. 250 ms ≈ 4 req/sec, margen de seguridad.
const REQ_DELAY_MS = 250;
// API limita size × page < 1000: 10 páginas × 100.
const MAX_PAGES = 10;

interface TicketmasterListResponse {
  _embedded?: { events?: unknown[] };
  page?: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

export async function run(runId: number): Promise<RunStats> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) throw new Error('Missing env var: TICKETMASTER_API_KEY');

  const sourceId = await resolveSourceId(SLUG);
  const stats = emptyStats();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE}?countryCode=${COUNTRY}&size=${PAGE_SIZE}&page=${page}&apikey=${encodeURIComponent(apiKey)}`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logError(runId, `Network error: ${msg}`, { url, errorCode: 'network' });
      stats.items_error++;
      break;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      await logError(runId, `HTTP ${res.status}: ${body.slice(0, 500)}`, {
        url,
        errorCode: `http_${res.status}`,
      });
      stats.items_error++;
      // Si es auth o rate limit, abortamos el run; otros errores transitorios: seguimos.
      if (res.status === 401 || res.status === 429) break;
      await sleep(REQ_DELAY_MS);
      continue;
    }

    const data = (await res.json()) as TicketmasterListResponse;
    const events = data._embedded?.events ?? [];
    if (events.length === 0) break;

    for (const ev of events) {
      const record = ev as { id?: string; url?: string };
      if (!record.id) {
        stats.items_error++;
        continue;
      }
      try {
        const result = await upsertRawEvent({
          runId,
          sourceId,
          externalId: record.id,
          url: record.url ?? null,
          payload: ev,
        });
        stats.items_seen++;
        if (result === 'new') stats.items_new++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logError(runId, `Upsert failed: ${msg}`, {
          url: record.url,
          errorCode: 'upsert',
        });
        stats.items_error++;
      }
    }

    const totalPages = data.page?.totalPages ?? 0;
    if (page + 1 >= totalPages) break;
    await sleep(REQ_DELAY_MS);
  }

  return stats;
}
