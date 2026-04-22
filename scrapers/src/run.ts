import { createHash } from 'node:crypto';
import { scrapingPool } from './db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface RunStats {
  items_seen: number;
  items_new: number;
  items_updated: number;
  items_error: number;
}

export const emptyStats = (): RunStats => ({
  items_seen: 0,
  items_new: 0,
  items_updated: 0,
  items_error: 0,
});

export async function resolveSourceId(slug: string): Promise<number> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    'SELECT id FROM sources WHERE slug = ? LIMIT 1',
    [slug],
  );
  const row = rows[0];
  if (!row) throw new Error(`Unknown source slug: ${slug}`);
  return row.id as number;
}

export async function startRun(
  sourceId: number,
  triggeredBy: 'cron' | 'manual' | 'n8n' | 'retry' = 'manual',
  meta: Record<string, unknown> | null = null,
): Promise<number> {
  const [res] = await scrapingPool.query<ResultSetHeader>(
    `INSERT INTO scraping_runs (source_id, triggered_by, started_at, status, meta)
     VALUES (?, ?, UTC_TIMESTAMP(), 'running', ?)`,
    [sourceId, triggeredBy, meta ? JSON.stringify(meta) : null],
  );
  return res.insertId;
}

export async function endRun(
  runId: number,
  status: 'ok' | 'partial' | 'failed' | 'cancelled',
  stats: RunStats,
  errorMessage: string | null = null,
): Promise<void> {
  await scrapingPool.query(
    `UPDATE scraping_runs
        SET finished_at = UTC_TIMESTAMP(),
            status = ?,
            items_seen = ?,
            items_new = ?,
            items_updated = ?,
            items_error = ?,
            error_message = ?
      WHERE id = ?`,
    [
      status,
      stats.items_seen,
      stats.items_new,
      stats.items_updated,
      stats.items_error,
      errorMessage,
      runId,
    ],
  );
}

export async function logError(
  runId: number,
  message: string,
  opts: { url?: string; errorCode?: string; stack?: string } = {},
): Promise<void> {
  await scrapingPool.query(
    `INSERT INTO scraping_errors (run_id, url, error_code, message, stack, occurred_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [runId, opts.url ?? null, opts.errorCode ?? null, message, opts.stack ?? null],
  );
}

export function sha256(payload: unknown): string {
  const json = JSON.stringify(payload);
  return createHash('sha256').update(json).digest('hex');
}

export interface UpsertRawEventInput {
  runId: number;
  sourceId: number;
  externalId: string;
  url: string | null;
  payload: unknown;
  fetchedAt?: Date;
}

// Devuelve 'new' si se insertó, 'duplicate' si el hash ya existía (no-op).
// La UNIQUE KEY (source_id, external_id, payload_hash) garantiza que:
// - misma versión del evento no se duplica
// - versiones distintas del mismo evento se guardan como filas separadas
export async function upsertRawEvent(
  input: UpsertRawEventInput,
): Promise<'new' | 'duplicate'> {
  const hash = sha256(input.payload);
  const fetchedAt = input.fetchedAt ?? new Date();
  const [res] = await scrapingPool.query<ResultSetHeader>(
    `INSERT INTO raw_events
       (source_id, run_id, external_id, url, payload, payload_hash, fetched_at)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      input.sourceId,
      input.runId,
      input.externalId,
      input.url,
      JSON.stringify(input.payload),
      hash,
      fetchedAt,
    ],
  );
  return res.affectedRows === 1 ? 'new' : 'duplicate';
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
