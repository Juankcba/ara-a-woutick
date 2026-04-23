import { createHash } from 'node:crypto';
import {
  type Availability,
  type Category,
  MappingError,
  type NormalizedEvent,
  type NormalizedPromoter,
  type NormalizedVenue,
} from './ticketmaster.ts';

// Payload que el scraper de Taquilla guarda en raw_events.
interface TaquillaPayload {
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

// Adivinamos la categoría a partir del slug del artist page desde donde se scrapeó.
// /conciertos y /espectaculos tienen URLs distintas para los artistas, pero el
// slug en sí no lo dice. Usamos el `scrapedFrom` cuando sea posible: si el
// artista aparece en /conciertos → música. Heurística simple.
function mapCategory(payload: TaquillaPayload): Category {
  const t = (payload.name ?? '').toLowerCase();
  const scraped = payload.scrapedFrom.toLowerCase();

  // Heurística por título
  if (/festival|fira|feria/.test(t)) return 'festivales';
  if (/liga|partido|clasico|cl\u00e1sico|derbi|basket|tenis|f1/.test(t)) return 'deportes';
  if (/monologo|mon\u00f3logo|comedia|stand\s*up|humor/.test(t)) return 'comedia';
  if (/musical|teatro|ballet|\u00f3pera|opera/.test(t)) return 'teatro';
  if (/circo|parque|familiar|ni\u00f1os|infantil|disney/.test(t)) return 'familiar';

  // Heurística por URL de scrape
  if (scraped.includes('/conciertos')) return 'conciertos';
  if (scraped.includes('/espectaculos')) return 'teatro';
  if (scraped.includes('/deportes')) return 'deportes';
  if (scraped.includes('/actividades')) return 'familiar';
  if (scraped.includes('/parques')) return 'familiar';

  return 'otros';
}

// Schema.org availability URLs → nuestro enum
function mapAvailability(v: string | null): Availability {
  if (!v) return 'unknown';
  const tail = v.split('/').pop()?.toLowerCase() ?? '';
  if (tail === 'instock' || tail === 'onlineonly') return 'available';
  if (tail === 'soldout' || tail === 'soldoutonline') return 'sold_out';
  if (tail === 'limitedavailability') return 'low';
  return 'unknown';
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildCanonicalKey(title: string, date: string, venueName: string): string {
  const input = `${normalize(title)}|${date}|${normalize(venueName)}`;
  return createHash('sha1').update(input).digest('hex');
}

function buildSlug(title: string, canonicalKey: string): string {
  const base = normalize(title).slice(0, 60).replace(/-+$/, '');
  return `${base}-${canonicalKey.slice(0, 8)}`;
}

export function mapTaquilla(raw: unknown): NormalizedEvent {
  const p = raw as TaquillaPayload;
  if (!p.externalId) throw new MappingError('Payload without externalId');
  if (!p.name) throw new MappingError('Payload without name');
  if (!p.venue?.name || !p.venue.locality) {
    throw new MappingError('Payload without venue name/city');
  }
  if (!p.startDate) throw new MappingError('Payload without startDate');

  // Taquilla nos da solo fecha (YYYY-MM-DD), sin hora. Usamos 00:00:00.
  const eventDatetime = `${p.startDate} 00:00:00`;
  const category = mapCategory(p);

  const venue: NormalizedVenue = {
    name: p.venue.name.trim(),
    city: p.venue.locality.trim(),
    region: null,
    country: p.venue.country ?? 'ES',
    address: p.venue.streetAddress?.trim() ?? null,
    lat: p.venue.lat,
    lng: p.venue.lng,
  };

  const canonicalKey = buildCanonicalKey(p.name, p.startDate, venue.name);

  return {
    externalId: p.externalId,
    title: p.name.trim(),
    slug: buildSlug(p.name, canonicalKey),
    category,
    description: p.description?.trim() || null,
    imageUrl: p.image ?? null,
    eventDatetime,
    doorsOpen: null,
    canonicalKey,
    venue,
    listing: {
      url: p.offers.buyUrl ?? p.url,
      priceMin: p.offers.lowPrice ?? p.offers.price,
      priceMax: p.offers.highPrice ?? p.offers.price,
      currency: p.offers.currency ?? 'EUR',
      availability: mapAvailability(p.offers.availability),
    },
  };
}

// Taquilla no expone promoter en las páginas de artista. Devolvemos null y
// dejamos que la promoción siga sin bloquearse.
export function mapTaquillaPromoter(_raw: unknown): NormalizedPromoter | null {
  return null;
}
