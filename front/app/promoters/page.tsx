import Link from "next/link";
import { ArrowUpRight, Building2, Globe, Mail, Phone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { getCompanies, getCompanyStats, type CompanyCategory, type CompanyStatus } from "@/lib/leads";

export const revalidate = 300;

const CATEGORY_LABEL: Record<CompanyCategory, string> = {
  promoter: "Promotor",
  ticketing: "Ticketera",
  venue: "Sala/Venue",
  agency_production: "Ag. Producción",
  agency_marketing: "Ag. Marketing",
  agency_booking: "Ag. Booking",
  festival: "Festival",
  fair: "Feria",
  congress: "Congreso",
  hotel: "Hotel",
  camping: "Camping",
  venue_complex: "Recinto ferial",
  other: "Otro",
};

const STATUS_BADGE: Record<CompanyStatus, { label: string; className: string }> = {
  new: { label: "Nuevo", className: "bg-gray-100 text-gray-700" },
  enriching: { label: "Enriqueciendo", className: "bg-amber-100 text-amber-700" },
  enriched: { label: "Enriquecido", className: "bg-blue-100 text-blue-700" },
  contacted: { label: "Contactado", className: "bg-purple-100 text-purple-700" },
  qualified: { label: "Cualificado", className: "bg-emerald-100 text-emerald-700" },
  won: { label: "Ganado", className: "bg-green-200 text-green-800" },
  lost: { label: "Perdido", className: "bg-red-100 text-red-700" },
  dnc: { label: "No contactar", className: "bg-rose-100 text-rose-700" },
};

const PLATFORM_COLOR: Record<string, string> = {
  ticketmaster: "bg-[#026CDF] text-white",
  taquilla: "bg-[#E8001D] text-white",
  eventbrite: "bg-[#F05537] text-white",
  fever: "bg-[#FF2D55] text-white",
  elcorteingles: "bg-[#007940] text-white",
  apm_musical: "bg-slate-700 text-white",
  manual: "bg-slate-300 text-slate-800",
};

export default async function PromotersPage() {
  const [companies, stats] = await Promise.all([
    getCompanies({ limit: 500 }),
    getCompanyStats(),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <header className="mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Building2 className="w-6 h-6 text-primary" />
                Organizadores y empresas
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Empresas descubiertas al scrapear ticketeras. Base para prospección B2B.
              </p>
            </div>
            <Link
              href="/"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              Volver al comparador <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <StatsCards stats={stats} />
        </header>

        <section>
          <h2 className="text-sm font-semibold mb-3 text-foreground">
            {companies.length} empresa{companies.length !== 1 ? "s" : ""}
          </h2>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr className="text-left">
                  <Th>Empresa</Th>
                  <Th>Categoría</Th>
                  <Th>Grupo</Th>
                  <Th className="text-right">Eventos</Th>
                  <Th>Fuentes</Th>
                  <Th>Ciudad</Th>
                  <Th>Contacto</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-secondary/40 transition-colors">
                    <Td>
                      <div className="font-medium text-foreground">{c.name}</div>
                      {c.legalName && c.legalName !== c.name && (
                        <div className="text-xs text-muted-foreground">{c.legalName}</div>
                      )}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center rounded px-2 py-0.5 bg-secondary text-xs">
                        {CATEGORY_LABEL[c.category]}
                      </span>
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {c.parentCompany ?? "—"}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">{c.totalEvents}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.sources.map((src) => (
                          <span
                            key={src}
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              PLATFORM_COLOR[src] ?? "bg-secondary text-secondary-foreground"
                            }`}
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td className="text-xs">{c.city ?? "—"}</Td>
                    <Td>
                      <div className="flex gap-2 text-muted-foreground">
                        {c.website && (
                          <a
                            href={c.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Website"
                            className="hover:text-primary"
                          >
                            <Globe className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            aria-label="Email"
                            className="hover:text-primary"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            aria-label="Phone"
                            className="hover:text-primary"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {!c.website && !c.email && !c.phone && (
                          <span className="text-xs">—</span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[c.status].className}`}
                      >
                        {STATUS_BADGE[c.status].label}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {companies.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              Aún no hay empresas en la base. Correr scrapers para poblarla.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatsCards({ stats }: { stats: Awaited<ReturnType<typeof getCompanyStats>> }) {
  const items = [
    { label: "Total", value: stats.total },
    { label: "Promotores", value: stats.byCategory.promoter ?? 0 },
    {
      label: "Fuentes",
      value: Object.keys(stats.bySource).length,
      sub: Object.keys(stats.bySource).join(", ") || "—",
    },
    { label: "Nuevos (sin contactar)", value: stats.byStatus.new ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{it.label}</div>
          <div className="text-xl font-bold tabular-nums">{it.value}</div>
          {it.sub && <div className="text-[10px] text-muted-foreground mt-0.5">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
