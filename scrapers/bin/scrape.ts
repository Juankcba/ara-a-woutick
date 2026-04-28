import '../src/env.ts';
import { closeAllPools, scrapingPool } from '../src/db.ts';
import { endRun, logError, resolveSourceId, startRun } from '../src/run.ts';
import { runGeneric } from '../src/sources/generic_ticketera.ts';
import type { RowDataPacket } from 'mysql2';

// Sources con scraper dedicado (cada uno tiene su archivo en src/sources/<slug>.ts).
// Si una source DEDICATED tiene también config.strategy en DB, gana el config:
// permite migrar sources del scraper dedicado al motor genérico sin borrar código.
const DEDICATED = ['ticketmaster', 'taquilla', 'apm_musical', 'fever', 'elcorteingles'] as const;
type DedicatedSlug = (typeof DEDICATED)[number];

function isDedicated(slug: string): slug is DedicatedSlug {
  return (DEDICATED as readonly string[]).includes(slug);
}

async function hasGenericConfig(slug: string): Promise<boolean> {
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    'SELECT config FROM sources WHERE slug = ?',
    [slug],
  );
  const cfg = rows[0]?.config;
  return !!cfg && typeof cfg === 'object' && 'strategy' in cfg;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error(`Usage: pnpm scrape <source>\nDedicated: ${DEDICATED.join(', ')}\nGeneric: cualquier slug con config.strategy en DB`);
    process.exit(1);
  }

  const useGeneric = await hasGenericConfig(slug);
  if (!isDedicated(slug) && !useGeneric) {
    console.error(
      `Source '${slug}' no es dedicado y no tiene config.strategy en DB.\n` +
        `Dedicated: ${DEDICATED.join(', ')}`,
    );
    process.exit(1);
  }

  const sourceId = await resolveSourceId(slug);
  const runId = await startRun(sourceId, 'manual');
  const route = useGeneric ? 'generic' : 'dedicated';
  console.log(`[${slug}] run #${runId} starting (source_id=${sourceId}, route=${route})`);

  try {
    const stats = useGeneric
      ? await runGeneric(runId, slug)
      : await (await import(`../src/sources/${slug}.ts`)).run(runId);
    await endRun(runId, stats.items_error > 0 ? 'partial' : 'ok', stats);
    console.log(`[${slug}] run #${runId} done`, stats);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    await logError(runId, msg, { errorCode: 'fatal', stack });
    await endRun(
      runId,
      'failed',
      { items_seen: 0, items_new: 0, items_updated: 0, items_error: 1 },
      msg,
    );
    console.error(`[${slug}] run #${runId} failed:`, msg);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
