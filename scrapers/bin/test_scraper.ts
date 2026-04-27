// Corre el scraper genérico para 1 source en MODO SECO (no escribe a DB).
// Devuelve los eventos extraídos para validar que el config está bien.
//
//   pnpm exec tsx bin/test_scraper.ts <slug> [--limit=5] [--full]
//
// Flags:
//   --limit=N   tope de eventos a procesar (default 5 — para iteración rápida)
//   --full      sin limit (cuidado, puede tardar minutos)

import '../src/env.ts';
import { closeAllPools } from '../src/db.ts';
import { runGeneric } from '../src/sources/generic_ticketera.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const full = args.includes('--full');

  if (!slug) {
    console.error('Uso: pnpm exec tsx bin/test_scraper.ts <slug> [--limit=5] [--full]');
    process.exit(1);
  }

  const maxItems = full ? undefined : Number(limitArg ?? 5);
  console.log(`[${slug}] dry-run, maxItems=${maxItems ?? 'unlimited'}\n`);

  const FAKE_RUN_ID = -1; // negativo = nunca colisiona con runs reales
  try {
    const result = await runGeneric(FAKE_RUN_ID, slug, { dryRun: true, maxItems });
    console.log(`\n═══════════════════════════════════════════`);
    console.log(`Stats: seen=${result.items_seen} new=${result.items_new} updated=${result.items_updated} errors=${result.items_error}`);

    const events = result.preview ?? [];
    console.log(`Preview (${events.length} eventos):`);
    for (const [i, ev] of events.entries()) {
      console.log(`\n[${i + 1}] ${ev.name ?? '(sin nombre)'}`);
      console.log(`    url:   ${ev.url}`);
      console.log(`    fecha: ${ev.startDate ?? '—'}`);
      console.log(`    venue: ${ev.venue.name ?? '—'} | ${ev.venue.locality ?? '—'}`);
      console.log(`    org:   ${ev.organizer.name ?? '—'}`);
      console.log(`    price: ${ev.offers.lowPrice ?? '—'}–${ev.offers.highPrice ?? '—'} ${ev.offers.currency ?? ''}`);
      if (ev.socials.instagram) console.log(`    ig:    ${ev.socials.instagram}`);
    }
    if (events.length === 0) {
      console.log('  (cero eventos extraídos — revisar config / probe del sitio)');
    }
  } catch (e) {
    console.error(`\n❌ Falló: ${e instanceof Error ? e.message : e}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  }

  await closeAllPools();
}

main().catch(async (e) => {
  console.error(e);
  await closeAllPools();
  process.exit(1);
});
