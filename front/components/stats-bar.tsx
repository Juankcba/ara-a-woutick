import { prisma } from "@/lib/db";

export async function StatsBar() {
  const stats = await loadStats();

  return (
    <div className="bg-brand-light border-b border-primary/20">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
        <Stat value={formatCount(stats.totalEvents)} label="Eventos" />
        <div className="w-px h-4 bg-primary/20 hidden sm:block" />
        <Stat value={String(stats.platformCount)} label="Plataformas" />
        <div className="w-px h-4 bg-primary/20 hidden sm:block" />
        <Stat value={formatSavings(stats.avgSavings)} label="Ahorro medio" />
        <div className="w-px h-4 bg-primary/20 hidden sm:block" />
        <Stat value="100%" label="Gratis" />
      </div>
    </div>
  );
}

interface Stats {
  totalEvents: number;
  platformCount: number;
  avgSavings: number | null;
}

async function loadStats(): Promise<Stats> {
  const [eventsCount, platformsCount, savings] = await Promise.all([
    prisma.event.count({
      where: { status: "published", listings: { some: {} } },
    }),
    prisma.platform.count({ where: { active: true } }),
    // Ahorro = max(price_min) - min(price_min) entre plataformas del mismo evento.
    // Sólo eventos con ≥2 listings con precio no-null.
    prisma.$queryRaw<Array<{ avg_savings: number | null }>>`
      SELECT AVG(savings) AS avg_savings FROM (
        SELECT MAX(price_min) - MIN(price_min) AS savings
        FROM event_listings
        WHERE price_min IS NOT NULL
        GROUP BY event_id
        HAVING COUNT(*) >= 2
      ) t
    `,
  ]);

  const raw = savings[0]?.avg_savings;
  const avgSavings = raw != null ? Math.round(Number(raw)) : null;

  return { totalEvents: eventsCount, platformCount: platformsCount, avgSavings };
}

function formatCount(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 100) / 10}k+`;
  if (n >= 100) return `${Math.floor(n / 10) * 10}+`;
  return String(n);
}

function formatSavings(v: number | null): string {
  return v == null ? "—" : `${v}€`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-bold text-primary">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
