import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { AdminSourceFilters } from "@/components/admin-source-filters";
import { SourceRowActions } from "@/components/source-row-actions";
import {
  getAdminSources,
  type ConfigStatus,
  type GetAdminSourcesOptions,
  type RunStatus,
  type SourceAdminRow,
} from "@/lib/scraping";

const CONFIG_STATUS_META: Record<
  ConfigStatus,
  { label: string; className: string }
> = {
  empty: { label: "Sin config", className: "bg-gray-100 text-gray-600 border-gray-200" },
  draft: { label: "Draft", className: "bg-amber-100 text-amber-700 border-amber-200" },
  tested: { label: "Probado", className: "bg-blue-100 text-blue-700 border-blue-200" },
  production: { label: "En producción", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STATUS_META: Record<
  RunStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  ok: { label: "OK", className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  partial: { label: "Parcial", className: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle },
  running: { label: "Corriendo", className: "bg-blue-100 text-blue-700 border-blue-200", icon: Activity },
  failed: { label: "Fallido", className: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  cancelled: { label: "Cancelado", className: "bg-gray-100 text-gray-700 border-gray-200", icon: XCircle },
};

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(p: Record<string, string | string[] | undefined>): GetAdminSourcesOptions {
  const competitor = asString(p.competitor);
  const state = asString(p.state);
  const cs = asString(p.configStatus);
  const validCs: readonly ConfigStatus[] = ["empty", "draft", "tested", "production"];
  return {
    search: asString(p.q)?.trim() || undefined,
    competitor: competitor === "yes" || competitor === "no" ? competitor : "all",
    state:
      state === "active" || state === "inactive" || state === "never_ran" ? state : "all",
    configStatus: cs && (validCs as readonly string[]).includes(cs) ? (cs as ConfigStatus) : "all",
  };
}

export default async function AdminScrapersPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const expected = process.env.ADMIN_TOKEN;
  const token = asString(params.token);
  if (expected && token !== expected) notFound();

  const filters = parseFilters(params);
  const sources = await getAdminSources(filters);

  const competitorTotal = sources.filter((s) => s.isCompetitor).length;
  const seedTotal = sources.length - competitorTotal;
  const activeTotal = sources.filter((s) => s.active).length;
  const productionTotal = sources.filter((s) => s.configStatus === "production").length;
  const draftTotal = sources.filter((s) => s.configStatus === "draft" || s.configStatus === "tested").length;
  const emptyTotal = sources.filter((s) => s.configStatus === "empty").length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              Scrapers
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configuración y estado de las {sources.length} fuentes registradas. Toggle para
              activar/desactivar — editar config para definir selectores y rutas.
            </p>
          </div>
          <Link
            href={token ? `/admin?token=${encodeURIComponent(token)}` : "/admin"}
            className="text-sm text-primary hover:underline"
          >
            ← Dashboard
          </Link>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <Stat label="Total" value={sources.length} />
          <Stat label="Activas" value={activeTotal} />
          <Stat label="En producción" value={productionTotal} highlight="emerald" />
          <Stat label="Draft / probadas" value={draftTotal} highlight="amber" />
          <Stat
            label="Sin configurar"
            value={emptyTotal}
            highlight={emptyTotal > 0 ? "red" : undefined}
          />
        </div>

        <AdminSourceFilters basePath="/admin/scrapers" />

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr className="text-left">
                <Th>Fuente</Th>
                <Th>URL</Th>
                <Th>Config</Th>
                <Th className="text-center">Dif.</Th>
                <Th>Última corrida</Th>
                <Th className="text-right">Runs</Th>
                <Th className="text-right">Eventos</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <SourceTableRow key={s.id} source={s} token={token} />
              ))}
            </tbody>
          </table>
        </div>

        {sources.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No hay fuentes que coincidan con los filtros.
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          Seed = fuentes propias (Ticketmaster, Taquilla, ECI, etc.). Competencia = ticketeras
          importadas del Excel curado, sin scraper aún (Fase 2B).
        </p>
      </main>
    </div>
  );
}

function SourceTableRow({ source: s, token }: { source: SourceAdminRow; token?: string }) {
  return (
    <tr className="border-t border-border hover:bg-secondary/30 transition-colors">
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              s.isCompetitor ? "bg-orange-400" : "bg-blue-500"
            }`}
            title={s.isCompetitor ? "Competencia" : "Seed propia"}
          />
          <div>
            <div className="font-medium text-foreground">{s.name}</div>
            <div className="text-[11px] font-mono text-muted-foreground">{s.slug}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top text-xs">
        {s.baseUrl ? (
          <a
            href={s.baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1 max-w-[260px] truncate"
            title={s.baseUrl}
          >
            <span className="truncate">{shortHost(s.baseUrl)}</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <ConfigStatusBadge status={s.configStatus} />
        {s.whiteLabelOf && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            wl: {s.whiteLabelOf}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top text-center">
        {s.difficulty != null ? (
          <span className="font-mono text-xs tabular-nums">{s.difficulty}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-top text-xs">
        {s.lastRunAt ? (
          <div className="flex flex-col gap-0.5">
            <RunBadge status={s.lastRunStatus} />
            <span className="text-muted-foreground">{formatDate(s.lastRunAt)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground italic">Sin corridas</span>
        )}
      </td>
      <td className="px-3 py-2 align-top text-right text-xs tabular-nums">{s.totalRuns}</td>
      <td className="px-3 py-2 align-top text-right text-xs tabular-nums">{s.totalEvents}</td>
      <td className="px-3 py-2 align-top">
        <SourceRowActions
          id={s.id}
          slug={s.slug}
          name={s.name}
          baseUrl={s.baseUrl}
          active={s.active}
          config={s.config}
          notes={s.notes}
          token={token}
        />
      </td>
    </tr>
  );
}

function ConfigStatusBadge({ status }: { status: ConfigStatus }) {
  const meta = CONFIG_STATUS_META[status];
  return (
    <span
      className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function RunBadge({ status }: { status: RunStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${meta.className}`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "amber" | "red" | "emerald";
}) {
  const valColor =
    highlight === "amber"
      ? "text-amber-600"
      : highlight === "red"
        ? "text-red-600"
        : highlight === "emerald"
          ? "text-emerald-600"
          : "";
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${valColor}`}>{value}</div>
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

function shortHost(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u.slice(0, 50);
  }
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(d));
}
