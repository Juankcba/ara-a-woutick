import { createHash } from 'node:crypto';
import {
  type Availability,
  type Category,
  MappingError,
  type NormalizedEvent,
  type NormalizedPromoter,
  type NormalizedVenue,
} from './ticketmaster.ts';

interface EciPayload {
  externalId: string;
  url: string;
  eventDatetime: string;
  scrapedFrom: string;
  jsonLd: {
    '@type'?: string;
    name?: string;
    startDate?: string;
    description?: string;
    image?: string | { url?: string; contentUrl?: string };
    url?: string;
    location?: {
      name?: string;
      address?: {
        streetAddress?: string;
        addressLocality?: string;
        addressRegion?: string;
        addressCountry?: string;
      };
    };
    offers?: {
      price?: number | string;
      priceCurrency?: string;
      availability?: string;
      url?: string;
    };
  };
}

function mapCategory(jsonLdType: string | undefined, title: string): Category {
  const t = title.toLowerCase();
  const jlt = (jsonLdType ?? '').toLowerCase();
  if (jlt === 'musicevent') return /festival/.test(t) ? 'festivales' : 'conciertos';
  if (jlt === 'theaterevent') return 'teatro';
  if (jlt === 'comedyevent') return 'comedia';
  if (jlt === 'sportsevent') return 'deportes';
  if (jlt === 'festival') return 'festivales';
  if (/festival/.test(t)) return 'festivales';
  if (/concierto|concert|tour/.test(t)) return 'conciertos';
  if (/teatro|musical|\u00f3pera|opera|ballet/.test(t)) return 'teatro';
  if (/mon[o\u00f3]logo|comedia|stand\s*up/.test(t)) return 'comedia';
  if (/liga|partido|clasico|derbi|basket/.test(t)) return 'deportes';
  if (/ni\u00f1os|infantil|familia|disney|circo/.test(t)) return 'familiar';
  return 'otros';
}

function mapAvailability(v: string | undefined): Availability {
  if (!v) return 'unknown';
  const tail = v.split('/').pop()?.toLowerCase() ?? '';
  if (tail === 'instock') return 'available';
  if (tail === 'soldout') return 'sold_out';
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

function extractImage(img: EciPayload['jsonLd']['image']): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  return img.url ?? img.contentUrl ?? null;
}

export function mapEci(raw: unknown): NormalizedEvent {
  const p = raw as EciPayload;
  const j = p.jsonLd;
  if (!j.name) throw new MappingError('ECI payload without name');
  if (!p.eventDatetime) throw new MappingError('ECI payload without date');

  const venueName = j.location?.name?.trim();
  const city = j.location?.address?.addressLocality?.trim();
  if (!venueName || !city) throw new MappingError('ECI payload without venue/city');

  const venue: NormalizedVenue = {
    name: venueName,
    city,
    region: j.location?.address?.addressRegion?.trim() ?? null,
    country: j.location?.address?.addressCountry?.startsWith('Esp') ? 'ES' : 'ES',
    address: j.location?.address?.streetAddress?.trim() ?? null,
    lat: null,
    lng: null,
  };

  const canonicalKey = buildCanonicalKey(j.name, p.eventDatetime, venue.name);
  const priceNum =
    typeof j.offers?.price === 'string' ? Number(j.offers.price) : j.offers?.price ?? null;

  return {
    externalId: p.externalId,
    title: j.name.trim(),
    slug: buildSlug(j.name, canonicalKey),
    category: mapCategory(j['@type'], j.name),
    description: j.description?.trim() ? j.description.trim().slice(0, 2000) : null,
    imageUrl: extractImage(j.image),
    eventDatetime: p.eventDatetime,
    doorsOpen: null,
    canonicalKey,
    venue,
    listing: {
      url: j.offers?.url ?? p.url,
      priceMin: Number.isFinite(priceNum) ? (priceNum as number) : null,
      priceMax: Number.isFinite(priceNum) ? (priceNum as number) : null,
      currency: j.offers?.priceCurrency ?? 'EUR',
      availability: mapAvailability(j.offers?.availability),
    },
  };
}

// ECI no expone promoter/organizer en JSON-LD.
export function mapEciPromoter(_raw: unknown): NormalizedPromoter | null {
  return null;
}
