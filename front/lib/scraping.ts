import 'server-only';
import mysql from 'mysql2/promise';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

declare global {
  // eslint-disable-next-line no-var
  var __scrapingPool: mysql.Pool | undefined;
}

function getPool(): mysql.Pool {
  if (globalThis.__scrapingPool) return globalThis.__scrapingPool;
  const pool = mysql.createPool({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASS'),
    database: requireEnv('DB_SCRAPING'),
    waitForConnections: true,
    connectionLimit: 5,
  });
  if (process.env.NODE_ENV !== 'production') globalThis.__scrapingPool = pool;
  return pool;
}

export type RunStatus = 'running' | 'ok' | 'partial' | 'failed' | 'cancelled';

export interface RunRow {
  id: number;
  sourceSlug: string;
  sourceName: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: RunStatus;
  triggeredBy: string;
  itemsSeen: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsError: number;
  durationS: number | null;
  errorMessage: string | null;
}

export interface SourceStatus {
  slug: string;
  name: string;
  kind: string;
  active: boolean;
  lastRun: RunRow | null;
  totalRuns: number;
  okRate: number | null; // % OK sobre últimas 10
}

export interface ErrorRow {
  id: number;
  runId: number;
  sourceSlug: string;
  errorCode: string | null;
  message: string;
  url: string | null;
  occurredAt: Date;
}

interface RawRunRow {
  id: number;
  source_slug: string;
  source_name: string;
  started_at: Date;
  finished_at: Date | null;
  status: RunStatus;
  triggered_by: string;
  items_seen: number;
  items_new: number;
  items_updated: number;
  items_error: number;
  duration_s: number | null;
  error_message: string | null;
}

function mapRun(r: RawRunRow): RunRow {
  return {
    id: r.id,
    sourceSlug: r.source_slug,
    sourceName: r.source_name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    triggeredBy: r.triggered_by,
    itemsSeen: Number(r.items_seen ?? 0),
    itemsNew: Number(r.items_new ?? 0),
    itemsUpdated: Number(r.items_updated ?? 0),
    itemsError: Number(r.items_error ?? 0),
    durationS: r.duration_s != null ? Number(r.duration_s) : null,
    errorMessage: r.error_message,
  };
}

export async function getSources(): Promise<SourceStatus[]> {
  const pool = getPool();
  const [sourceRows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id, slug, name, kind, active FROM sources ORDER BY slug',
  );

  const sources = sourceRows as Array<{ id: number; slug: string; name: string; kind: string; active: number }>;

  // Para cada source, el último run + total + % OK de los últimos 10
  const results = await Promise.all(
    sources.map(async (src): Promise<SourceStatus> => {
      const [lastRunRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT r.id, s.slug AS source_slug, s.name AS source_name,
                r.started_at, r.finished_at, r.status, r.triggered_by,
                r.items_seen, r.items_new, r.items_updated, r.items_error,
                TIMESTAMPDIFF(SECOND, r.started_at, r.finished_at) AS duration_s,
                r.error_message
           FROM scraping_runs r
           JOIN sources s ON s.id = r.source_id
          WHERE r.source_id = ?
          ORDER BY r.id DESC LIMIT 1`,
        [src.id],
      );

      const [countRows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM scraping_runs WHERE source_id = ?',
        [src.id],
      );

      const [last10Rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT status FROM scraping_runs WHERE source_id = ? ORDER BY id DESC LIMIT 10`,
        [src.id],
      );

      const total = Number(countRows[0]?.total ?? 0);
      const last10 = last10Rows as Array<{ status: RunStatus }>;
      const okRate = last10.length > 0 ? (last10.filter((r) => r.status === 'ok').length / last10.length) * 100 : null;

      return {
        slug: src.slug,
        name: src.name,
        kind: src.kind,
        active: Boolean(src.active),
        lastRun: lastRunRows[0] ? mapRun(lastRunRows[0] as RawRunRow) : null,
        totalRuns: total,
        okRate,
      };
    }),
  );

  return results;
}

export async function getRecentRuns(limit = 30): Promise<RunRow[]> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    `SELECT r.id, s.slug AS source_slug, s.name AS source_name,
            r.started_at, r.finished_at, r.status, r.triggered_by,
            r.items_seen, r.items_new, r.items_updated, r.items_error,
            TIMESTAMPDIFF(SECOND, r.started_at, r.finished_at) AS duration_s,
            r.error_message
       FROM scraping_runs r
       JOIN sources s ON s.id = r.source_id
      ORDER BY r.id DESC
      LIMIT ?`,
    [limit],
  );
  return (rows as unknown as RawRunRow[]).map(mapRun);
}

export async function getRecentErrors(hours = 24, limit = 50): Promise<ErrorRow[]> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    `SELECT e.id, e.run_id, s.slug AS source_slug, e.error_code, e.message, e.url, e.occurred_at
       FROM scraping_errors e
       JOIN scraping_runs r ON r.id = e.run_id
       JOIN sources s ON s.id = r.source_id
      WHERE e.occurred_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
        AND e.error_code <> 'info'
      ORDER BY e.id DESC
      LIMIT ?`,
    [hours, limit],
  );
  return (rows as unknown as Array<{
    id: number;
    run_id: number;
    source_slug: string;
    error_code: string | null;
    message: string;
    url: string | null;
    occurred_at: Date;
  }>).map((r) => ({
    id: r.id,
    runId: r.run_id,
    sourceSlug: r.source_slug,
    errorCode: r.error_code,
    message: r.message,
    url: r.url,
    occurredAt: r.occurred_at,
  }));
}
