import { leadsPool, publicPool, scrapingPool } from './db.ts';
import {
  mapTicketmaster,
  mapTicketmasterPromoter,
  MappingError,
  type NormalizedEvent,
  type NormalizedPromoter,
  type NormalizedVenue,
} from './mappers/ticketmaster.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface PromoteStats {
  processed: number;
  promoted: number;
  skipped_already: number;
  failed: number;
  companies_new: number;
  companies_updated: number;
}

const MAPPERS = {
  ticketmaster: {
    event: mapTicketmaster,
    promoter: mapTicketmasterPromoter,
  },
} as const;

type SupportedSlug = keyof typeof MAPPERS;

interface RawRow extends RowDataPacket {
  id: number;
  source_id: number;
  external_id: string;
  url: string | null;
  payload: unknown;
}

interface PlatformRow extends RowDataPacket {
  id: number;
  slug: string;
}

// Cache de venues para la corrida: evita SELECT/INSERT repetidos cuando muchos
// eventos comparten venue (ej: WiZink Center puede tener 50 eventos).
type VenueCache = Map<string, number>;
const venueCacheKey = (name: string, city: string) =>
  `${name.toLowerCase()}|${city.toLowerCase()}`;

// Cache de companies (por source_platform + external_id) para no hacer un
// SELECT/INSERT por cada evento cuando muchos comparten promoter
// (ej: Live Nation tiene 46 eventos).
type CompanyCache = Map<string, number>;
const companyCacheKey = (sourcePlatform: string, externalId: string) =>
  `${sourcePlatform}:${externalId}`;

type MapperBundle = (typeof MAPPERS)[SupportedSlug];

export async function promote(
  sourceSlug: SupportedSlug,
  limit = 2000,
): Promise<PromoteStats> {
  const stats: PromoteStats = {
    processed: 0,
    promoted: 0,
    skipped_already: 0,
    failed: 0,
    companies_new: 0,
    companies_updated: 0,
  };

  const sourceId = await resolveScrapingSourceId(sourceSlug);
  const platformId = await resolvePublicPlatformId(sourceSlug);
  const mapper = MAPPERS[sourceSlug];

  const rawRows = await fetchUnpromoted(sourceId, limit);
  if (rawRows.length === 0) {
    console.log(`[promote:${sourceSlug}] no unpromoted raw_events`);
    return stats;
  }
  console.log(`[promote:${sourceSlug}] processing ${rawRows.length} raw_events`);

  const venueCache: VenueCache = new Map();
  const companyCache: CompanyCache = new Map();
  const CHUNK_SIZE = 10;

  for (let i = 0; i < rawRows.length; i += CHUNK_SIZE) {
    const chunk = rawRows.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((row) =>
        processOne(row, mapper, sourceSlug, platformId, venueCache, companyCache, stats),
      ),
    );
    if (Math.floor((i + CHUNK_SIZE) / 100) > Math.floor(i / 100)) {
      console.log(`[promote:${sourceSlug}] ${stats.processed}/${rawRows.length}`);
    }
  }

  return stats;
}

async function processOne(
  row: RawRow,
  mapper: MapperBundle,
  sourceSlug: string,
  platformId: number,
  venueCache: VenueCache,
  companyCache: CompanyCache,
  stats: PromoteStats,
): Promise<void> {
  stats.processed++;
  try {
    const normalized = mapper.event(row.payload);
    const venueId = await upsertVenue(normalized.venue, venueCache);
    const eventId = await upsertEvent(normalized, venueId);
    await upsertListing(eventId, platformId, normalized);

    // Lead extraction: promoter → leads_crm.companies (best-effort, no bloquea la promoción).
    const promoter = mapper.promoter(row.payload);
    if (promoter) {
      try {
        const result = await upsertCompany(promoter, sourceSlug, row.url, companyCache);
        if (result === 'new') stats.companies_new++;
        else stats.companies_updated++;
      } catch (e) {
        console.error(`[promote] company upsert failed for raw #${row.id}:`, (e as Error).message);
      }
    }

    await markPromoted(row.id, eventId);
    stats.promoted++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markPromotionError(row.id, msg);
    stats.failed++;
    if (!(e instanceof MappingError)) {
      console.error(`[promote] raw_event #${row.id} failed:`, msg);
    }
  }
}

async function resolveScrapingSourceId(slug: string): Promise<number> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    'SELECT id FROM sources WHERE slug = ? LIMIT 1',
    [slug],
  );
  if (!rows[0]) throw new Error(`Unknown source slug in scraping DB: ${slug}`);
  return rows[0].id as number;
}

async function resolvePublicPlatformId(slug: string): Promise<number> {
  const [rows] = await publicPool.query<PlatformRow[]>(
    'SELECT id FROM platforms WHERE slug = ? LIMIT 1',
    [slug],
  );
  if (!rows[0]) throw new Error(`Unknown platform slug in public DB: ${slug}`);
  return rows[0].id;
}

async function fetchUnpromoted(sourceId: number, limit: number): Promise<RawRow[]> {
  // Para evitar re-procesar versiones viejas del mismo evento, agarramos solo
  // la fila más reciente (mayor id) por (source_id, external_id) que aún no fue promovida.
  const [rows] = await scrapingPool.query<RawRow[]>(
    `SELECT r.id, r.source_id, r.external_id, r.url, r.payload
       FROM raw_events r
       JOIN (
         SELECT source_id, external_id, MAX(id) AS max_id
           FROM raw_events
          WHERE source_id = ? AND promoted_at IS NULL
          GROUP BY source_id, external_id
       ) latest ON latest.max_id = r.id
      ORDER BY r.id
      LIMIT ?`,
    [sourceId, limit],
  );
  return rows;
}

async function upsertVenue(venue: NormalizedVenue, cache: VenueCache): Promise<number> {
  const key = venueCacheKey(venue.name, venue.city);
  const cached = cache.get(key);
  if (cached) return cached;

  const [res] = await publicPool.query<ResultSetHeader>(
    `INSERT INTO venues (name, city, region, country, address, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       region = COALESCE(VALUES(region), region),
       address = COALESCE(VALUES(address), address),
       lat = COALESCE(VALUES(lat), lat),
       lng = COALESCE(VALUES(lng), lng)`,
    [venue.name, venue.city, venue.region, venue.country, venue.address, venue.lat, venue.lng],
  );
  cache.set(key, res.insertId);
  return res.insertId;
}

async function upsertEvent(ev: NormalizedEvent, venueId: number): Promise<number> {
  const [res] = await publicPool.query<ResultSetHeader>(
    `INSERT INTO events
       (slug, title, category, description, image_url, event_datetime, doors_open,
        venue_id, canonical_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       title = VALUES(title),
       category = VALUES(category),
       description = COALESCE(VALUES(description), description),
       image_url = COALESCE(VALUES(image_url), image_url),
       event_datetime = VALUES(event_datetime),
       doors_open = VALUES(doors_open),
       venue_id = VALUES(venue_id),
       status = VALUES(status)`,
    [
      ev.slug,
      ev.title,
      ev.category,
      ev.description,
      ev.imageUrl,
      ev.eventDatetime,
      ev.doorsOpen,
      venueId,
      ev.canonicalKey,
    ],
  );
  return res.insertId;
}

async function upsertListing(
  eventId: number,
  platformId: number,
  normalized: NormalizedEvent,
): Promise<void> {
  await publicPool.query(
    `INSERT INTO event_listings
       (event_id, platform_id, external_id, url, price_min, price_max, currency,
        availability, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       external_id = VALUES(external_id),
       url = VALUES(url),
       price_min = VALUES(price_min),
       price_max = VALUES(price_max),
       currency = VALUES(currency),
       availability = VALUES(availability),
       last_checked_at = VALUES(last_checked_at)`,
    [
      eventId,
      platformId,
      normalized.externalId,
      normalized.listing.url,
      normalized.listing.priceMin,
      normalized.listing.priceMax,
      normalized.listing.currency,
      normalized.listing.availability,
    ],
  );
}

async function markPromoted(rawEventId: number, publicEventId: number): Promise<void> {
  await scrapingPool.query(
    `UPDATE raw_events
        SET promoted_at = UTC_TIMESTAMP(),
            promoted_event_id = ?,
            promotion_error = NULL
      WHERE id = ?`,
    [publicEventId, rawEventId],
  );
}

async function markPromotionError(rawEventId: number, message: string): Promise<void> {
  await scrapingPool.query(
    `UPDATE raw_events SET promotion_error = ? WHERE id = ?`,
    [message.slice(0, 5000), rawEventId],
  );
}

// Slug simple a partir del nombre. Si dos empresas distintas colisionan por el
// mismo slug, agregamos sufijo numérico (resuelto con el UNIQUE constraint +
// reintento sería lo ideal, pero por ahora aceptamos colisión rara).
function companySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function upsertCompany(
  promoter: NormalizedPromoter,
  sourceSlug: string,
  sourceUrl: string | null,
  cache: CompanyCache,
): Promise<'new' | 'updated'> {
  const cacheKey = companyCacheKey(sourceSlug, promoter.externalId);
  const cached = cache.get(cacheKey);

  let companyId: number;
  let wasNew = false;

  if (cached) {
    companyId = cached;
  } else {
    // 1. Upsert de la company. Categoría 'promoter' (desde TM todas son promotores).
    const slug = companySlug(promoter.name);
    const [res] = await leadsPool.query<ResultSetHeader>(
      `INSERT INTO companies (slug, name, legal_name, category, parent_company, status)
       VALUES (?, ?, ?, 'promoter', ?, 'new')
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         name = VALUES(name),
         legal_name = COALESCE(VALUES(legal_name), legal_name),
         parent_company = COALESCE(VALUES(parent_company), parent_company)`,
      [slug, promoter.name, promoter.legalName, promoter.parentCompany],
    );
    companyId = res.insertId;
    // affectedRows: 1 = inserted, 2 = updated (MySQL quirk con ON DUPLICATE KEY)
    wasNew = res.affectedRows === 1;
    cache.set(cacheKey, companyId);
  }

  // 2. Upsert de company_source. Aumenta events_count y actualiza last_seen_at.
  const [srcRes] = await leadsPool.query<ResultSetHeader>(
    `INSERT INTO company_sources
       (company_id, source_platform, external_id, source_url,
        first_seen_at, last_seen_at, events_count)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 1)
     ON DUPLICATE KEY UPDATE
       last_seen_at = UTC_TIMESTAMP(),
       events_count = events_count + 1,
       source_url = COALESCE(VALUES(source_url), source_url)`,
    [companyId, sourceSlug, promoter.externalId, sourceUrl],
  );
  // Si inserté una fila en sources Y la company ya existía, contamos "updated".
  // Si la company era nueva, no importa — ya contamos 'new' arriba.
  if (!wasNew && srcRes.affectedRows === 1) {
    // primera vez que esta plataforma ve a esta empresa
  }

  return wasNew ? 'new' : 'updated';
}
