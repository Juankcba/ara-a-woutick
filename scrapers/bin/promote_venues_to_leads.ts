// One-shot (o cron semanal): promueve los venues de ticket_public.venues
// a leads_crm.companies con category='venue'. Los venues son leads B2B
// válidos (salas, recintos, teatros) — los scrapers ya los tienen en DB.
//
// Uso:
//   pnpm exec tsx bin/promote_venues_to_leads.ts

import '../src/env.ts';
import { leadsPool, publicPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface VenueRow extends RowDataPacket {
  id: number;
  name: string;
  city: string;
  region: string | null;
  country: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  events_count: number;
}

function companySlug(name: string, city: string): string {
  const base = `${name}-${city}`;
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function main(): Promise<void> {
  const [rows] = await publicPool.query<VenueRow[]>(
    `SELECT v.id, v.name, v.city, v.region, v.country, v.address, v.lat, v.lng,
            COUNT(e.id) AS events_count
       FROM venues v
       LEFT JOIN events e ON e.venue_id = v.id
      GROUP BY v.id
      ORDER BY events_count DESC`,
  );
  console.log(`Fetched ${rows.length} venues from ticket_public`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const v of rows) {
    try {
      const slug = companySlug(v.name, v.city);

      // Upsert en leads_crm.companies. Si ya existe por slug y NO es venue,
      // no lo degradamos; solo actualizamos campos vacíos vía COALESCE.
      const [res] = await leadsPool.query<ResultSetHeader>(
        `INSERT INTO companies (slug, name, category, city, region, country, address, status)
         VALUES (?, ?, 'venue', ?, ?, ?, ?, 'new')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           city = COALESCE(VALUES(city), city),
           region = COALESCE(VALUES(region), region),
           address = COALESCE(VALUES(address), address)`,
        [slug, v.name, v.city, v.region, v.country, v.address],
      );
      const companyId = res.insertId;
      const wasNew = res.affectedRows === 1;

      // company_sources con platform 'venues_promoted' para trazabilidad.
      await leadsPool.query(
        `INSERT INTO company_sources
           (company_id, source_platform, external_id, source_url,
            first_seen_at, last_seen_at, events_count)
         VALUES (?, 'venues_promoted', ?, NULL,
                 UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?)
         ON DUPLICATE KEY UPDATE
           last_seen_at = UTC_TIMESTAMP(),
           events_count = VALUES(events_count)`,
        [companyId, String(v.id), v.events_count],
      );

      if (wasNew) inserted++;
      else skipped++;
    } catch (e) {
      errors++;
      console.error(`venue #${v.id} ${v.name}:`, (e as Error).message);
    }
  }

  console.log({ total: rows.length, inserted, skipped, errors });
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
