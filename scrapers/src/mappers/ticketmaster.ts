import { createHash } from 'node:crypto';

export type Category =
  | 'conciertos'
  | 'teatro'
  | 'deportes'
  | 'festivales'
  | 'familiar'
  | 'comedia'
  | 'otros';

export type Availability = 'available' | 'low' | 'sold_out' | 'unknown';

export interface NormalizedVenue {
  name: string;
  city: string;
  region: string | null;
  country: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface NormalizedEvent {
  externalId: string;
  title: string;
  slug: string;
  category: Category;
  description: string | null;
  imageUrl: string | null;
  eventDatetime: string;
  doorsOpen: string | null;
  canonicalKey: string;
  venue: NormalizedVenue;
  listing: {
    url: string;
    priceMin: number | null;
    priceMax: number | null;
    currency: string;
    availability: Availability;
  };
}

interface TicketmasterImage {
  url?: string;
  width?: number;
  height?: number;
  ratio?: string;
}

interface TicketmasterPayload {
  id: string;
  name: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  images?: TicketmasterImage[];
  dates?: {
    start?: { localDate?: string; localTime?: string };
    status?: { code?: string };
  };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  _embedded?: {
    venues?: Array<{
      name?: string;
      city?: { name?: string };
      state?: { name?: string };
      country?: { countryCode?: string };
      address?: { line1?: string };
      location?: { latitude?: string; longitude?: string };
    }>;
  };
}

export class MappingError extends Error {}

export interface NormalizedPromoter {
  externalId: string;
  name: string;
  legalName: string | null;
  parentCompany: string | null;
}

interface TicketmasterPromoter {
  id?: string;
  name?: string;
}

export function mapTicketmasterPromoter(raw: unknown): NormalizedPromoter | null {
  const p = raw as TicketmasterPayload;
  const primary: TicketmasterPromoter | undefined =
    (p as unknown as { promoter?: TicketmasterPromoter }).promoter ??
    (p as unknown as { promoters?: TicketmasterPromoter[] }).promoters?.[0];
  if (!primary?.id || !primary.name) return null;
  const name = primary.name.trim();
  return {
    externalId: primary.id,
    name,
    legalName: extractLegalName(name),
    parentCompany: detectParentCompany(name),
  };
}

// Detecta la sigla legal (S.L., S.A., S.A.U., etc) al final del nombre.
function extractLegalName(name: string): string | null {
  if (/\b(S\.?L\.?U?\.?|S\.?A\.?U?\.?|S\.?R\.?L\.?|S\.?L\.?L\.?|S\.?C\.?P\.?)\b/i.test(name)) {
    return name;
  }
  return null;
}

// Heurística para agrupar SPVs bajo su matriz. Por ahora solo Live Nation,
// que tiene decenas de SPVs tipo "Live Nation España Golden Age SL".
function detectParentCompany(name: string): string | null {
  if (/live\s*nation/i.test(name)) return 'Live Nation España';
  return null;
}

export function mapTicketmaster(raw: unknown): NormalizedEvent {
  const p = raw as TicketmasterPayload;
  if (!p.id) throw new MappingError('Payload without id');
  if (!p.name) throw new MappingError('Payload without name');

  const venuePayload = p._embedded?.venues?.[0];
  if (!venuePayload?.name || !venuePayload.city?.name) {
    throw new MappingError('Payload without venue name/city');
  }

  const localDate = p.dates?.start?.localDate;
  if (!localDate) throw new MappingError('Payload without localDate');
  const localTime = p.dates?.start?.localTime ?? '00:00:00';
  const eventDatetime = `${localDate} ${localTime}`;

  const cat = mapCategory(
    p.classifications?.[0]?.segment?.name,
    p.classifications?.[0]?.genre?.name,
    p.classifications?.[0]?.subGenre?.name,
    p.name,
  );
  const availability = mapAvailability(p.dates?.status?.code);

  const venue: NormalizedVenue = {
    name: venuePayload.name.trim(),
    city: venuePayload.city.name.trim(),
    region: venuePayload.state?.name?.trim() ?? null,
    country: venuePayload.country?.countryCode ?? 'ES',
    address: venuePayload.address?.line1?.trim() ?? null,
    lat: parseCoord(venuePayload.location?.latitude),
    lng: parseCoord(venuePayload.location?.longitude),
  };

  const canonicalKey = buildCanonicalKey(p.name, localDate, venue.name);

  return {
    externalId: p.id,
    title: p.name.trim(),
    slug: buildSlug(p.name, canonicalKey),
    category: cat,
    description: (p.info ?? p.pleaseNote ?? null)?.trim() || null,
    imageUrl: pickImage(p.images),
    eventDatetime,
    doorsOpen: null,
    canonicalKey,
    venue,
    listing: {
      url: p.url ?? '',
      priceMin: p.priceRanges?.[0]?.min ?? null,
      priceMax: p.priceRanges?.[0]?.max ?? null,
      currency: p.priceRanges?.[0]?.currency ?? 'EUR',
      availability,
    },
  };
}

function mapCategory(
  segment: string | undefined,
  genre: string | undefined,
  subGenre: string | undefined,
  title: string | undefined,
): Category {
  const s = segment?.toLowerCase() ?? '';
  const g = genre?.toLowerCase() ?? '';
  const sg = subGenre?.toLowerCase() ?? '';
  const t = title?.toLowerCase() ?? '';
  const festivalHints = [g, sg, t].some((x) => x.includes('festival'));
  if (s === 'music') return festivalHints ? 'festivales' : 'conciertos';
  if (s === 'sports') return 'deportes';
  if (s === 'arts & theatre') return g.includes('comedy') ? 'comedia' : 'teatro';
  if (s === 'miscellaneous') {
    if (g.includes('family')) return 'familiar';
    if (g.includes('comedy')) return 'comedia';
  }
  return 'otros';
}

function mapAvailability(code: string | undefined): Availability {
  switch (code) {
    case 'onsale':
    case 'rescheduled':
      return 'available';
    case 'cancelled':
      return 'sold_out';
    default:
      return 'unknown';
  }
}

function parseCoord(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Elegimos la imagen más ancha con ratio horizontal (preferimos 16_9 o 3_2).
function pickImage(images: TicketmasterImage[] | undefined): string | null {
  if (!images?.length) return null;
  const scored = images
    .filter((i) => i.url)
    .map((i) => {
      const ratioScore = i.ratio === '16_9' ? 100 : i.ratio === '3_2' ? 50 : 0;
      const sizeScore = (i.width ?? 0) + (i.height ?? 0);
      return { url: i.url!, score: ratioScore + sizeScore / 100 };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.url ?? null;
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
