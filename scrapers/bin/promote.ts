import '../src/env.ts';
import { closeAllPools } from '../src/db.ts';
import { promote } from '../src/promote.ts';

const SUPPORTED = ['ticketmaster', 'taquilla', 'fever', 'elcorteingles'] as const;
type Slug = (typeof SUPPORTED)[number];
const isSupported = (s: string): s is Slug => (SUPPORTED as readonly string[]).includes(s);

async function main(): Promise<void> {
  const slug = process.argv[2];
  const limit = Number(process.argv[3] ?? 2000);
  if (!slug || !isSupported(slug)) {
    console.error(`Usage: pnpm promote <source> [limit]\nSupported: ${SUPPORTED.join(', ')}`);
    process.exit(1);
  }

  const started = Date.now();
  const stats = await promote(slug, limit);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[promote:${slug}] done in ${secs}s`, stats);
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
