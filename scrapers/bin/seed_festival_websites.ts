// Siembra websites de los festivales ES más grandes en leads_crm. Después el
// scrape_contact_pages los recoge y extrae emails de /prensa /contacto /equipo.
//
// El match con compañías existentes se hace por name tokens; si no existe,
// se crea nueva (category='festival') + company_source='seed_festival'.
//
//   pnpm exec tsx bin/seed_festival_websites.ts

import '../src/env.ts';
import { leadsPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// Festivales ES de alto perfil con web oficial verificable. Seleccionados por
// volumen de atendientes, cobertura de prensa y probabilidad de exponer
// contacto directo de producción / prensa.
const FESTIVALS: Array<{ name: string; website: string }> = [
  { name: 'Mad Cool Festival', website: 'https://madcoolfestival.es/' },
  { name: 'Primavera Sound', website: 'https://www.primaverasound.com/' },
  { name: 'Festival Internacional de Benicàssim (FIB)', website: 'https://fiberfib.com/' },
  { name: 'Sónar', website: 'https://sonar.es/' },
  { name: 'Bilbao BBK Live', website: 'https://www.bilbaobbklive.com/' },
  { name: 'Viña Rock', website: 'https://vinarock.com/' },
  { name: 'Resurrection Fest', website: 'https://resurrectionfest.es/' },
  { name: 'O Son do Camiño', website: 'https://osondocamino.com/' },
  { name: 'Low Festival', website: 'https://lowfestival.es/' },
  { name: 'Arenal Sound', website: 'https://www.arenalsound.com/' },
  { name: 'Rototom Sunsplash', website: 'https://www.rototomsunsplash.com/' },
  { name: 'Iberia Festival', website: 'https://iberiafestival.com/' },
  { name: 'Cruïlla Barcelona', website: 'https://www.cruillabarcelona.com/' },
  { name: 'Vida Festival', website: 'https://vidafestival.com/' },
  { name: 'SanSan Festival', website: 'https://sansanfestival.com/' },
  { name: 'Noches del Botánico', website: 'https://www.nochesdelbotanico.com/' },
  { name: 'Starlite Occident', website: 'https://starlitecatalanaoccidente.com/' },
  { name: 'Tomavistas', website: 'https://tomavistas.com/' },
  { name: 'Festival Porta Ferrada', website: 'https://portaferrada.cat/' },
  { name: 'Festival Cap Roig', website: 'https://caproigfestival.cat/' },
  { name: 'Festival de la Guitarra de Córdoba', website: 'https://guitarracordoba.com/' },
  { name: 'Pirineos Sur', website: 'https://pirineos-sur.es/' },
  { name: 'Festival Jardins Pedralbes', website: 'https://festivalpedralbes.com/' },
  { name: 'DCODE Festival', website: 'https://dcodefest.com/' },
  { name: 'Palencia Sonora', website: 'https://palenciasonora.com/' },
];

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  website: string | null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companySlug(name: string): string {
  return normalize(name).replace(/\s/g, '-').slice(0, 200);
}

async function findExisting(name: string): Promise<CompanyRow | null> {
  const norm = normalize(name);
  // Match por cualquier token significativo que contenga al menos 4 chars
  // contra el nombre en DB (LIKE %token%).
  const tokens = norm.split(' ').filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;

  const likes = tokens.map(() => `LOWER(name) LIKE ?`).join(' AND ');
  const params = tokens.map((t) => `%${t}%`);
  const [rows] = await leadsPool.query<CompanyRow[]>(
    `SELECT id, name, website FROM companies
      WHERE category = 'festival' AND ${likes}
      ORDER BY id ASC LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}

(async () => {
  let matched = 0;
  let created = 0;
  let websitesSet = 0;

  for (const f of FESTIVALS) {
    const existing = await findExisting(f.name);
    let companyId: number;

    if (existing) {
      matched++;
      companyId = existing.id;
      if (!existing.website) {
        await leadsPool.query(`UPDATE companies SET website = ? WHERE id = ?`, [f.website, companyId]);
        websitesSet++;
        console.log(`↺ [${companyId}] matched existing "${existing.name}" → set website ${f.website}`);
      } else {
        console.log(`= [${companyId}] matched existing "${existing.name}" (website already present)`);
      }
    } else {
      const slug = companySlug(f.name);
      const [res] = await leadsPool.query<ResultSetHeader>(
        `INSERT INTO companies (slug, name, category, website, status)
         VALUES (?, ?, 'festival', ?, 'new')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           website = COALESCE(website, VALUES(website))`,
        [slug, f.name, f.website],
      );
      companyId = res.insertId;
      created++;
      websitesSet++;
      console.log(`+ [${companyId}] created new "${f.name}" website=${f.website}`);
    }

    // Company source de traceability
    await leadsPool.query(
      `INSERT IGNORE INTO company_sources
         (company_id, source_platform, external_id, source_url, first_seen_at, last_seen_at)
       VALUES (?, 'seed_festival', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [companyId, companySlug(f.name), f.website],
    );
  }

  console.log(
    `\n[seed-festivals] done · matched=${matched} · created=${created} · websites_set=${websitesSet} / ${FESTIVALS.length}`,
  );
  console.log(`[seed-festivals] next: pnpm exec tsx bin/scrape_contact_pages.ts --category festival --limit 50`);
})()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
