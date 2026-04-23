// Promueve los festivales de ticket_public.events (category='festivales')
// a leads_crm.companies con category='festival'. Los festivales son leads
// B2B válidos — detrás de cada uno hay una productora/organizador.
//
// Heurística: extrae el "nombre de festival" del título del evento
// (strip city/venue suffix, strip "Presenta:", etc.) y agrupa por ese
// nombre. Se asume algo de ruido — después limpiamos con fuzzy matching.
//
// Uso:
//   pnpm exec tsx bin/promote_festivals_to_leads.ts

import '../src/env.ts';
import { leadsPool, publicPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface EventRow extends RowDataPacket {
  id: number;
  title: string;
  city: string | null;
  image_url: string | null;
}

function extractFestivalName(title: string): string {
  let s = title.trim();
  // Quitar sufijo " - <Ciudad>" al final (Madrid, Barcelona, etc.)
  s = s.replace(/\s*[-\u2013\u2014]\s*[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA][a-z\u00E1\u00E9\u00ED\u00F3\u00FA]{2,}[\w\u00C0-\u024F ]*$/, '');
  // Quitar "Presenta:" y lo que venga después (suele ser el artista, no el festival)
  s = s.replace(/\s*[Pp]resenta:?\s*.*$/, '');
  // Si hay "Festival" en el nombre, intentar quedarse con el trozo que lo contiene
  const m = s.match(/([\d\u00BA\u00B0 ]*[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\w\u00C0-\u024F][\w\u00C0-\u024F\s\u00BA\u00B0]*Festival[\w\u00C0-\u024F\s]*)/i);
  if (m) s = m[1].trim();
  return s.trim();
}

function companySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function main(): Promise<void> {
  const [rows] = await publicPool.query<EventRow[]>(
    `SELECT e.id, e.title, v.city, e.image_url
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
      WHERE e.category = 'festivales'`,
  );
  console.log(`Fetched ${rows.length} festival events`);

  // Agrupar por nombre normalizado
  const groups = new Map<string, { name: string; cities: Set<string>; eventCount: number; imageUrl: string | null; eventIds: number[] }>();
  for (const row of rows) {
    const fest = extractFestivalName(row.title);
    if (!fest || fest.length < 3) continue;
    const key = companySlug(fest);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.eventCount++;
      if (row.city) existing.cities.add(row.city);
      if (!existing.imageUrl && row.image_url) existing.imageUrl = row.image_url;
      existing.eventIds.push(row.id);
    } else {
      groups.set(key, {
        name: fest,
        cities: row.city ? new Set([row.city]) : new Set(),
        eventCount: 1,
        imageUrl: row.image_url,
        eventIds: [row.id],
      });
    }
  }

  console.log(`Grouped into ${groups.size} unique festivals`);

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const [slug, g] of groups) {
    try {
      const primaryCity = g.cities.size > 0 ? [...g.cities][0] : null;
      const [res] = await leadsPool.query<ResultSetHeader>(
        `INSERT INTO companies (slug, name, category, city, status)
         VALUES (?, ?, 'festival', ?, 'new')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           category = CASE
             WHEN category = 'other' THEN 'festival'
             ELSE category
           END,
           city = COALESCE(city, VALUES(city))`,
        [slug, g.name, primaryCity],
      );
      const companyId = res.insertId;
      const wasNew = res.affectedRows === 1;

      await leadsPool.query(
        `INSERT INTO company_sources
           (company_id, source_platform, external_id, source_url,
            first_seen_at, last_seen_at, events_count, raw)
         VALUES (?, 'festivals_promoted', ?, NULL,
                 UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE
           last_seen_at = UTC_TIMESTAMP(),
           events_count = VALUES(events_count),
           raw = VALUES(raw)`,
        [
          companyId,
          slug,
          g.eventCount,
          JSON.stringify({ cities: [...g.cities], eventIds: g.eventIds.slice(0, 20) }),
        ],
      );

      if (wasNew) inserted++;
      else updated++;
    } catch (e) {
      errors++;
      console.error(`festival "${g.name}" (slug=${slug}):`, (e as Error).message);
    }
  }

  console.log({ totalGroups: groups.size, inserted, updated, errors });
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
