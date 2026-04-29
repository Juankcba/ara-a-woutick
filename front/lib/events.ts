import 'server-only';
import { prisma } from '@/lib/db';
import { getSavings } from '@/lib/data';
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

  // Destacados = mejor comparable. El producto justifica al usuario cuando un
  // evento aparece en >=2 plataformas — eso es lo que vale mostrar arriba.
  // Antes elegíamos por dateCount (cantidad de funciones), que siempre ganaban
  // los mismos 3 musicales de Madrid de Taquilla.
  //
  // Cascada:
  //   1) ≥2 plataformas con precio>0 → ideal (muestra ahorro)
  //   2) ≥2 plataformas (sin filtro precio) → cubre el caso TM (Discovery API
  //      free no expone priceRanges en ES, ver memoria del proyecto)
  //   3) Fallback: dateCount>=2 + imagen → llena los 3 slots si las anteriores
  //      no alcanzan
  function platformsWithPrice(e: Event): number {
    const set = new Set<Platform>();
    for (const p of e.prices) if (p.price > 0 && p.available) set.add(p.platform);
    return set.size;
  }
  function distinctPlatforms(e: Event): number {
    const set = new Set<Platform>();
    for (const p of e.prices) set.add(p.platform);
    return set.size;
  }

  const tier1 = merged
    .filter((e) => e.image && platformsWithPrice(e) >= 2)
    .sort((a, b) => {
      const cp = platformsWithPrice(b) - platformsWithPrice(a);
      if (cp !== 0) return cp;
      return getSavings(b) - getSavings(a);
    });
  const tier2 = merged
    .filter((e) => e.image && distinctPlatforms(e) >= 2 && !tier1.includes(e))
    .sort((a, b) => distinctPlatforms(b) - distinctPlatforms(a));
  const tier3 = merged
    .filter((e) => e.image && (e.dateCount ?? 1) >= 2)
    .filter((e) => !tier1.includes(e) && !tier2.includes(e));

  const featured: Event[] = [...tier1, ...tier2, ...tier3].slice(0, 3);
  for (const e of featured) e.featured = true;

  return merged;
}
