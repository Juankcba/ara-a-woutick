import 'server-only';
import { prisma } from '@/lib/db';
import type { Category, Event, Platform, PlatformPrice } from '@/lib/data';

const CATEGORY_LABEL: Record<string, Category> = {
  conciertos: 'Conciertos',
  teatro: 'Teatro',
  deportes: 'Deportes',
  festivales: 'Festivales',
  familiar: 'Familiar',
  comedia: 'Comedia',
};

const PLATFORM_SLUGS: readonly Platform[] = [
  'taquilla',
  'ticketmaster',
  'eventbrite',
  'fever',
  'elcorteingles',
];

function isPlatform(slug: string): slug is Platform {
  return (PLATFORM_SLUGS as readonly string[]).includes(slug);
}

// Prisma interpreta MySQL DATETIME como UTC, así que los componentes UTC del
// Date coinciden con los dígitos guardados (que ya estaban en hora local Madrid).
function splitDatetime(d: Date): { date: string; time: string } {
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function truncate(s: string | null, max = 140): string {
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// Normaliza títulos para agrupar variantes del mismo evento:
//  - "Bad Bunny - Debí Tirar Más Fotos World Tour"
//  - "Bad Bunny - Debí Tirar Más Fotos World Tour | VIP Packages"
//  - "Bad Bunny"
// todos deben colapsar al mismo key dentro de la misma ciudad.
function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*\|\s*vip packages?\s*$/i, '')
    .replace(/\s*\|\s*box\s*seats?\s*$/i, '')
    .replace(/\s*\|\s*preferred\s*seats?\s*$/i, '')
    .replace(/\s*[-–—]\s*(las mujeres ya no lloran|world tour|tour \d*|residencia europea)[^|]*$/i, '')
    .replace(/\s*\(.*?\)\s*$/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type PrismaEventRow = Awaited<ReturnType<typeof fetchRows>>[number];

async function fetchRows(limit: number, onlyPublished: boolean, onlyWithListings: boolean) {
  return prisma.event.findMany({
    where: {
      ...(onlyPublished ? { status: 'published' } : {}),
      category: { not: 'otros' },
      ...(onlyWithListings ? { listings: { some: {} } } : {}),
      // Sólo mostramos eventos futuros (tolera +12h para que no se caigan los de hoy).
      eventDatetime: { gte: new Date(Date.now() - 12 * 3600 * 1000) },
    },
    include: {
      venue: true,
      listings: { include: { platform: true } },
    },
    orderBy: { eventDatetime: 'asc' },
    take: limit,
  });
}

export interface GetEventsOptions {
  limit?: number;
  onlyPublished?: boolean;
  onlyWithListings?: boolean;
}

export async function getEvents(opts: GetEventsOptions = {}): Promise<Event[]> {
  const limit = opts.limit ?? 1000;
  const onlyPublished = opts.onlyPublished ?? true;
  const onlyWithListings = opts.onlyWithListings ?? true;

  const rows = await fetchRows(limit, onlyPublished, onlyWithListings);

  // Agrupamos por (título normalizado, ciudad). Cada grupo se colapsa en una
  // sola card con la fecha más próxima + dateCount.
  const groups = new Map<string, PrismaEventRow[]>();
  for (const row of rows) {
    if (!row.venue) continue;
    if (!CATEGORY_LABEL[row.category]) continue;
    const key = `${normalizeTitle(row.title)}|${row.venue.city.toLowerCase()}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const merged: Event[] = [];
  for (const bucket of groups.values()) {
    // rows ya vienen ordenadas por event_datetime asc, así que [0] es la más próxima.
    const primary = bucket[0];
    const { date, time } = splitDatetime(primary.eventDatetime);

    // Mergear listings entre variantes. Si hay varias del mismo platform,
    // quedarse con la que tenga precio (priceMin != null).
    const listingsByPlatform = new Map<string, PlatformPrice>();
    for (const ev of bucket) {
      for (const l of ev.listings) {
        if (!isPlatform(l.platform.slug)) continue;
        const price: PlatformPrice = {
          platform: l.platform.slug as Platform,
          price: l.priceMin ? Number(l.priceMin) : 0,
          url: l.url,
          available: l.availability === 'available',
        };
        const prev = listingsByPlatform.get(l.platform.slug);
        // Orden de preferencia: con precio > sin precio; available > no-available.
        // Mejora significativa cuando un bucket tiene fechas vendidas + futuras.
        if (!prev) {
          listingsByPlatform.set(l.platform.slug, price);
          continue;
        }
        const prevScore = (prev.price > 0 ? 2 : 0) + (prev.available ? 1 : 0);
        const newScore = (price.price > 0 ? 2 : 0) + (price.available ? 1 : 0);
        if (newScore > prevScore) {
          listingsByPlatform.set(l.platform.slug, price);
        }
      }
    }

    // Título: el más largo del bucket (suele ser el más descriptivo —
    // "Bad Bunny - Debí Tirar Más Fotos World Tour" > "Bad Bunny").
    const title = bucket.reduce(
      (best, ev) => (ev.title.length > best.length ? ev.title : best),
      primary.title,
    );

    merged.push({
      id: String(primary.id),
      title,
      subtitle: truncate(primary.description),
      category: CATEGORY_LABEL[primary.category],
      city: primary.venue!.city,
      venue: primary.venue!.name,
      date,
      time,
      image: primary.imageUrl ?? '',
      prices: [...listingsByPlatform.values()],
      featured: false,
      dateCount: bucket.length,
    });
  }

  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Destacamos los 3 primeros que tengan imagen y ≥2 fechas (son los "grandes").
  const candidates = merged.filter((e) => e.image && (e.dateCount ?? 1) >= 2);
  for (let i = 0; i < Math.min(3, candidates.length); i++) {
    candidates[i].featured = true;
  }

  return merged;
}
