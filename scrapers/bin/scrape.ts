import '../src/env.ts';
import { closeAllPools } from '../src/db.ts';
import { endRun, logError, resolveSourceId, startRun } from '../src/run.ts';

const SCRAPERS = ['ticketmaster', 'taquilla', 'apm_musical', 'fever', 'elcorteingles'] as const;
type ScraperSlug = (typeof SCRAPERS)[number];

function isKnown(slug: string): slug is ScraperSlug {
  return (SCRAPERS as readonly string[]).includes(slug);
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug || !isKnown(slug)) {
    console.error(`Usage: pnpm scrape <source>\nKnown sources: ${SCRAPERS.join(', ')}`);
    process.exit(1);
  }

  const scraper = await import(`../src/sources/${slug}.ts`);
  const sourceId = await resolveSourceId(slug);
  const runId = await startRun(sourceId, 'manual');
  console.log(`[${slug}] run #${runId} starting (source_id=${sourceId})`);

  try {
    const stats = await scraper.run(runId);
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
