import { createHash } from 'node:crypto';
import {
  type Availability,
  type Category,
  MappingError,
  type NormalizedEvent,
  type NormalizedPromoter,
  type NormalizedVenue,
} from './ticketmaster.ts';

interface FeverPayload {
  externalId: string;
  url: string;
  city: string;
  eventDatetime: string | null;
  jsonLd: {
    '@context'?: string;
    '@type'?: string | string[];
    name?: string;
    description?: string;
    sku?: string;
    image?: { contentUrl?: string } | string;
    offers?: Array<{
      price?: number | string;
      priceCurrency?: string;
      availability?: string;
      url?: string;
      areaServed?: {
        name?: string;
        address?: { addressLocality?: string; streetAddress?: string };
        geo?: { latitude?: number; longitude?: number };
      };
    }>;
  };
}

function mapCategory(title: string): Category {
  const t = title.toLowerCase();
  if (/festival/.test(t)) return 'festivales';
  if (/concierto|concert|tour|candlelight|dj|musical\s|musica\s/.test(t)) return 'conciertos';
  if (/teatro|musical|\u00f3pera|opera|ballet/.test(t)) return 'teatro';
  if (/liga|partido|clasico|derbi|basket|f\u00fatbol|futbol|tenis|f1/.test(t)) return 'deportes';
  if (/mon[o\u00f3]logo|comedia|stand\s*up|humor|drag/.test(t)) return 'comedia';
  if (/ni\u00f1os|infantil|familia|parque|disney|circo/.test(t)) return 'familiar';
  return 'otros';
}

function mapAvailability(v: string | undefined): Availability {
  if (!v) return 'unknown';
  const tail = v.split('/').pop()?.toLowerCase() ?? '';
  if (tail === 'instock' || tail === 'onlineonly') return 'available';
  if (tail === 'soldout' || tail === 'discontinued') return 'sold_out';
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
  const input = `${normalize(title)}|${date.slice(0, 10)}|${normalize(venueName)}`;
  return createHash('sha1').update(input).digest('hex');
}

function buildSlug(title: string, canonicalKey: string): string {
  const base = normalize(title).slice(0, 60).replace(/-+$/, '');
  return `${base}-${canonicalKey.slice(0, 8)}`;
}

function extractImage(img: FeverPayload['jsonLd']['image']): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  return img.contentUrl ?? null;
}

function normalizeCityLabel(slug: string): string {
  // 'madrid' → 'Madrid', 'a-coruna' → 'A Coruña' (no tenemos el original acentuado).
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function mapFever(raw: unknown): NormalizedEvent {
  const p = raw as FeverPayload;
  const j = p.jsonLd;
  if (!j.name) throw new MappingError('Fever payload without name');
  if (!p.eventDatetime) throw new MappingError('Fever payload without parseable date');

  const offer = j.offers?.[0];
  const area = offer?.areaServed;
  const venueName = area?.name?.trim() || normalizeCityLabel(p.city);
  const city = area?.address?.addressLocality?.trim() || normalizeCityLabel(p.city);

  const venue: NormalizedVenue = {
    name: venueName,
    city,
    region: null,
    country: 'ES',
    address: area?.address?.streetAddress?.trim() ?? null,
    lat: typeof area?.geo?.latitude === 'number' ? area.geo.latitude : null,
    lng: typeof area?.geo?.longitude === 'number' ? area.geo.longitude : null,
  };

  const canonicalKey = buildCanonicalKey(j.name, p.eventDatetime, venue.name);
  const priceNum = typeof offer?.price === 'string' ? Number(offer.price) : offer?.price ?? null;

  return {
    externalId: p.externalId,
    title: j.name.trim(),
    slug: buildSlug(j.name, canonicalKey),
    category: mapCategory(j.name),
    description: j.description?.trim() ? j.description.trim().slice(0, 2000) : null,
    imageUrl: extractImage(j.image),
    eventDatetime: p.eventDatetime,
    doorsOpen: null,
    canonicalKey,
    venue,
    listing: {
      url: offer?.url ?? p.url,
      priceMin: Number.isFinite(priceNum) ? (priceNum as number) : null,
      priceMax: Number.isFinite(priceNum) ? (priceNum as number) : null,
      currency: offer?.priceCurrency ?? 'EUR',
      availability: mapAvailability(offer?.availability),
    },
  };
}

// Fever no expone promoter en JSON-LD.
export function mapFeverPromoter(_raw: unknown): NormalizedPromoter | null {
  return null;
}
