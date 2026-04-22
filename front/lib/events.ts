import 'server-only';
import { prisma } from '@/lib/db';
import type { Category, Event, Platform } from '@/lib/data';

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

export interface GetEventsOptions {
  limit?: number;
  onlyPublished?: boolean;
  onlyWithListings?: boolean;
}

export async function getEvents(opts: GetEventsOptions = {}): Promise<Event[]> {
  const limit = opts.limit ?? 200;
  const onlyPublished = opts.onlyPublished ?? true;
  const onlyWithListings = opts.onlyWithListings ?? true;

  const rows = await prisma.event.findMany({
    where: {
      ...(onlyPublished ? { status: 'published' } : {}),
      category: { not: 'otros' },
      ...(onlyWithListings ? { listings: { some: {} } } : {}),
    },
    include: {
      venue: true,
      listings: { include: { platform: true } },
    },
    orderBy: { eventDatetime: 'asc' },
    take: limit,
  });

  return rows
    .filter((e) => e.venue && CATEGORY_LABEL[e.category])
    .map((e, idx): Event => {
      const { date, time } = splitDatetime(e.eventDatetime);
      const prices = e.listings
        .filter((l) => isPlatform(l.platform.slug))
        .map((l) => ({
          platform: l.platform.slug as Platform,
          price: l.priceMin ? Number(l.priceMin) : 0,
          url: l.url,
          available: l.availability === 'available',
        }));
      return {
        id: String(e.id),
        title: e.title,
        subtitle: truncate(e.description),
        category: CATEGORY_LABEL[e.category],
        city: e.venue!.city,
        venue: e.venue!.name,
        date,
        time,
        image: e.imageUrl ?? '',
        prices,
        featured: idx < 3,
      };
    });
}
