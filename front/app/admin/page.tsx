import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Clock, Settings, XCircle } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import {
  getRecentErrors,
  getRecentRuns,
  getSources,
  type RunRow,
  type RunStatus,
  type SourceStatus,
} from "@/lib/scraping";

// Revalidamos cada 60s — suficiente para ver la última corrida sin saturar DB.
export const revalidate = 60;

const STATUS_META: Record<RunStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ok:        { label: "OK",         className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  partial:   { label: "Parcial",    className: "bg-amber-100 text-amber-700 border-amber-200",       icon: AlertTriangle },
  running:   { label: "Corriendo",  className: "bg-blue-100 text-blue-700 border-blue-200",           icon: Activity },
  failed:    { label: "Fallido",    className: "bg-red-100 text-red-700 border-red-200",              icon: XCircle },
  cancelled: { label: "Cancelado",  className: "bg-gray-100 text-gray-700 border-gray-200",           icon: XCircle },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AdminPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const expected = process.env.ADMIN_TOKEN;
  if (expected && token !== expected) {
    // 404 para no filtrar que la ruta existe
    notFound();
  }

  const [sources, runs, errors] = await Promise.all([
    getSources(),
    getRecentRuns(30),
    getRecentErrors(24, 50),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              Scraping dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Última corrida por fuente, histórico reciente y errores 24h. Refresh cada 60s.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={token ? `/admin/scrapers?token=${encodeURIComponent(token)}` : "/admin/scrapers"}
              className="text-sm font-medium text-foreground hover:text-primary inline-flex items-center gap-1"
            >
              <Settings className="w-3.5 h-3.5" />
              Configurar scrapers
            </Link>
            <Link href="/promoters" className="text-sm text-primary hover:underline">
              Organizadores →
            </Link>
          </div>
        </header>

        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3">Fuentes ({sources.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sources.map((s) => (
              <SourceCard key={s.slug} source={s} />
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3">Últimas {runs.length} corridas</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr className="text-left">
                  <Th>#</Th>
                  <Th>Fuente</Th>
                  <Th>Estado</Th>
                  <Th>Inicio</Th>
                  <Th className="text-right">Duración</Th>
                  <Th className="text-right">Vistos</Th>
                  <Th className="text-right">Nuevos</Th>
                  <Th className="text-right">Upd.</Th>
                  <Th className="text-right">Err.</Th>
                  <Th>Trigger</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <Td className="font-mono text-xs text-muted-foreground">{r.id}</Td>
                    <Td className="font-medium">{r.sourceName}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-xs">{formatDate(r.startedAt)}</Td>
                    <Td className="text-right tabular-nums text-xs">{formatDuration(r.durationS)}</Td>
                    <Td className="text-right tabular-nums">{r.itemsSeen}</Td>
                    <Td className="text-right tabular-nums">{r.itemsNew}</Td>
                    <Td className="text-right tabular-nums">{r.itemsUpdated}</Td>
                    <Td className={`text-right tabular-nums ${r.itemsError > 0 ? "text-red-600 font-semibold" : ""}`}>
                      {r.itemsError}
                    </Td>
                    <Td className="text-xs text-muted-foreground">{r.triggeredBy}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-3">
            Errores últimas 24h ({errors.length})
          </h2>
          {errors.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-emerald-500" />
              Sin errores en las últimas 24h.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr className="text-left">
                    <Th>Hora</Th>
                    <Th>Fuente</Th>
                    <Th>Código</Th>
                    <Th>Mensaje</Th>
                    <Th>URL</Th>
                    <Th className="text-right">Run</Th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <Td className="text-xs">{formatDate(e.occurredAt)}</Td>
                      <Td className="text-xs">{e.sourceSlug}</Td>
                      <Td className="text-xs font-mono">{e.errorCode ?? "—"}</Td>
                      <Td className="text-xs max-w-md truncate" title={e.message}>{e.message}</Td>
                      <Td className="text-xs max-w-xs truncate" title={e.url ?? undefined}>
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {shortUrl(e.url)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="text-right font-mono text-xs text-muted-foreground">{e.runId}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SourceCard({ source }: { source: SourceStatus }) {
  const r = source.lastRun;
  const neverRan = !r;
  const status: RunStatus = r?.status ?? "cancelled";
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const badgeLabel = neverRan ? "Sin corridas" : meta.label;
  const badgeClass = neverRan
    ? "bg-gray-50 text-gray-500 border-gray-200"
    : meta.className;
  return (
    <div className={`rounded-lg border bg-card px-4 py-3 ${neverRan ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm">{source.name}</div>
          <div className="text-xs text-muted-foreground">{source.slug} · {source.kind}</div>
        </div>
        <div className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
          <Icon className="w-3 h-3" />
          {badgeLabel}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Última" value={r ? formatDate(r.startedAt) : "—"} />
        <Stat label="Duración" value={r ? formatDuration(r.durationS) : "—"} />
        <Stat label="Vistos" value={r ? String(r.itemsSeen) : "—"} />
        <Stat label="Errores" value={r ? String(r.itemsError) : "—"} highlight={r?.itemsError ? "red" : undefined} />
        <Stat label="Total runs" value={String(source.totalRuns)} />
        <Stat
          label="OK rate"
          value={source.okRate != null ? `${source.okRate.toFixed(0)}%` : "—"}
          highlight={source.okRate != null && source.okRate < 50 ? "red" : undefined}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: "red" }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${highlight === "red" ? "text-red-600 font-semibold" : ""}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${meta.className}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
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

function formatDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + url.pathname.slice(0, 40);
  } catch {
    return u.slice(0, 50);
  }
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
