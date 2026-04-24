// Seed masivo de entidades conocidas del sector music/entertainment ES:
// venues top, promotoras grandes/medianas, agencias de booking y producción.
// Fuente: conocimiento curado del sector, 2025-2026.
//
// Patrón: insertar/matchear en leads_crm.companies con category adecuada
// y setear website para que scrape_contact_pages extraiga emails.
//
//   pnpm exec tsx bin/seed_industry_directory.ts

import '../src/env.ts';
import { leadsPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

type Category =
  | 'promoter' | 'venue' | 'venue_complex' | 'agency_production'
  | 'agency_booking' | 'agency_marketing' | 'festival' | 'other';

interface Seed {
  name: string;
  website: string;
  category: Category;
  city?: string;
}

// ──────────────────────────────────────────────────────────────────────
// VENUES MAYORES DE ESPAÑA
const VENUES: Seed[] = [
  { name: 'Palau Sant Jordi',           website: 'https://www.palausantjordi.barcelona/',  category: 'venue', city: 'Barcelona' },
  { name: 'Estadio La Cartuja',         website: 'https://estadiolacartuja.com/',          category: 'venue', city: 'Sevilla' },
  { name: 'Estadio Metropolitano',      website: 'https://www.metropolitanosantiagobernabeu.com/', category: 'venue', city: 'Madrid' },
  { name: 'Teatro Real',                website: 'https://www.teatroreal.es/',             category: 'venue', city: 'Madrid' },
  { name: 'Auditorio Nacional de Música', website: 'https://www.auditorionacional.mcu.es/', category: 'venue', city: 'Madrid' },
  { name: 'Palau de la Música Catalana', website: 'https://www.palaumusica.cat/',           category: 'venue', city: 'Barcelona' },
  { name: 'Gran Teatre del Liceu',      website: 'https://www.liceubarcelona.cat/',        category: 'venue', city: 'Barcelona' },
  { name: 'Razzmatazz',                 website: 'https://www.salarazzmatazz.com/',        category: 'venue', city: 'Barcelona' },
  { name: 'Sala Apolo',                 website: 'https://www.sala-apolo.com/',            category: 'venue', city: 'Barcelona' },
  { name: 'La Riviera',                 website: 'https://www.salalariviera.com/',         category: 'venue', city: 'Madrid' },
  { name: 'Teatro Lope de Vega Madrid', website: 'https://www.teatrolopedevega.es/',       category: 'venue', city: 'Madrid' },
  { name: 'Teatro Flamenco Madrid',     website: 'https://www.teatroflamencomadrid.com/',  category: 'venue', city: 'Madrid' },
  { name: 'Sala Copernico',             website: 'https://salacopernico.com/',             category: 'venue', city: 'Madrid' },
  { name: 'Sala But',                   website: 'https://www.salabut.es/',                category: 'venue', city: 'Madrid' },
  { name: 'Teatro Fígaro',              website: 'https://teatrofigaro.es/',               category: 'venue', city: 'Madrid' },
  { name: 'Teatro Maravillas',          website: 'https://www.teatromaravillas.com/',      category: 'venue', city: 'Madrid' },
  { name: 'Teatros del Canal',          website: 'https://teatroscanal.com/',              category: 'venue', city: 'Madrid' },
  { name: 'Teatro Circo Price',         website: 'https://www.teatrocircoprice.es/',       category: 'venue', city: 'Madrid' },
  { name: 'La 2 de Apolo',              website: 'https://www.sala-apolo.com/',            category: 'venue', city: 'Barcelona' },
  { name: 'Bikini',                     website: 'https://www.bikinibcn.com/',             category: 'venue', city: 'Barcelona' },
  { name: 'Sala Wolf',                  website: 'https://www.salawolfvalencia.com/',      category: 'venue', city: 'Valencia' },
  { name: 'Sala Moon Valencia',         website: 'https://www.salamoon.com/',              category: 'venue', city: 'Valencia' },
  { name: 'Sala Santana 27',            website: 'https://santana27.com/',                  category: 'venue', city: 'Bilbao' },
  { name: 'Bilbao Arena',               website: 'https://www.bilbaoarena.com/',           category: 'venue', city: 'Bilbao' },
  { name: 'Sala Capitol',               website: 'https://salacapitol.com/',               category: 'venue', city: 'Santiago de Compostela' },
  { name: 'Sala Pelícano',              website: 'https://salapelicano.com/',              category: 'venue', city: 'A Coruña' },
  { name: 'Sala Mon',                   website: 'https://www.salamonclub.com/',           category: 'venue', city: 'Madrid' },
  { name: 'Joy Eslava',                 website: 'https://www.joy-eslava.com/',            category: 'venue', city: 'Madrid' },
  { name: 'Recinto Ferial IFEMA',       website: 'https://www.ifema.es/',                  category: 'venue_complex', city: 'Madrid' },
  { name: 'Fira Barcelona',             website: 'https://www.firabarcelona.com/',         category: 'venue_complex', city: 'Barcelona' },
  { name: 'IFEVI Vigo',                 website: 'https://www.ifevi.com/',                 category: 'venue_complex', city: 'Vigo' },
  { name: 'Feria de Zaragoza',          website: 'https://www.feriazaragoza.es/',          category: 'venue_complex', city: 'Zaragoza' },
  { name: 'Valencia Arena',             website: 'https://www.valenciaarena.es/',          category: 'venue', city: 'Valencia' },
  { name: 'Teatro Colón Coruña',        website: 'https://teatrocolon.es/',                category: 'venue', city: 'A Coruña' },
];

// ──────────────────────────────────────────────────────────────────────
// PROMOTORES / PRODUCTORAS
const PROMOTERS: Seed[] = [
  { name: 'Last Tour',                     website: 'https://www.lasttour.org/',                category: 'promoter', city: 'Bilbao' },
  { name: 'Doctor Music',                  website: 'https://www.doctormusic.com/',             category: 'promoter', city: 'Barcelona' },
  { name: 'Sharewood',                     website: 'https://sharewoodgroup.com/',              category: 'promoter', city: 'Madrid' },
  { name: 'RLM',                           website: 'https://www.rlm.es/',                      category: 'promoter', city: 'Madrid' },
  { name: 'Get In',                        website: 'https://www.getin.es/',                    category: 'promoter', city: 'Madrid' },
  { name: 'Madness Live',                  website: 'https://www.madnesslive.es/',              category: 'promoter', city: 'Madrid' },
  { name: 'Planet Events',                 website: 'https://www.planetevents.com/',            category: 'promoter', city: 'Madrid' },
  { name: 'Riff Producciones',             website: 'https://www.riffproducciones.com/',        category: 'promoter', city: 'Madrid' },
  { name: 'Taste The Floor',               website: 'https://tastethefloor.com/',               category: 'promoter', city: 'Madrid' },
  { name: 'Proactiv Entertainment',        website: 'https://proactiventertainment.com/',       category: 'promoter', city: 'Madrid' },
  { name: 'Monkey Pro',                    website: 'https://monkeypro.es/',                    category: 'promoter', city: 'Madrid' },
  { name: 'Proximo Cuarto',                website: 'https://www.proximocuarto.com/',           category: 'promoter', city: 'Madrid' },
  { name: 'New Event',                     website: 'https://www.newevent.es/',                 category: 'promoter', city: 'Madrid' },
  { name: 'Sweet Nocturna',                website: 'https://sweetnocturna.com/',               category: 'promoter', city: 'Madrid' },
  { name: 'Creative Producciones',         website: 'https://creativegestion.com/',             category: 'promoter', city: 'Madrid' },
  { name: 'Bring The Noise',               website: 'https://www.bringthenoise.events/',        category: 'promoter', city: 'Madrid' },
  { name: 'Los 40 Universo',               website: 'https://www.los40.com/',                   category: 'promoter', city: 'Madrid' },
  { name: 'Rock It Producciones',          website: 'https://rockit.es/',                       category: 'promoter', city: 'Valencia' },
  { name: 'Mercurio Producciones',         website: 'https://www.mercurioproducciones.com/',    category: 'promoter', city: 'Sevilla' },
  { name: 'Green Cow Music',               website: 'https://www.greencowmusic.com/',           category: 'promoter', city: 'Madrid' },
  { name: 'Rayos en la Niebla',            website: 'https://rayosenlaniebla.com/',             category: 'promoter', city: 'Madrid' },
  { name: 'Iberia Music',                  website: 'https://www.iberiamusic.com/',             category: 'promoter', city: 'Madrid' },
  { name: 'Subterfuge Records',            website: 'https://www.subterfuge.com/',              category: 'promoter', city: 'Madrid' },
  { name: 'Houston Party',                 website: 'https://houstonparty.com/',                category: 'promoter', city: 'Madrid' },
];

// ──────────────────────────────────────────────────────────────────────
// AGENCIAS DE BOOKING / MANAGEMENT
const AGENCIES: Seed[] = [
  { name: 'Iguapop',                    website: 'https://www.iguapop.com/',                    category: 'agency_booking', city: 'Barcelona' },
  { name: 'The Music Republic',         website: 'https://www.themusicrepublic.es/',            category: 'promoter',        city: 'Valencia' },
  { name: 'Hook Management',            website: 'https://www.hookmanagement.es/',              category: 'agency_booking', city: 'Madrid' },
  { name: 'SanMiguel Primavera',        website: 'https://www.primaverasound.com/',             category: 'agency_production', city: 'Barcelona' },
  { name: 'Esmerarte',                  website: 'https://www.esmerarte.com/',                  category: 'agency_production', city: 'Madrid' },
  { name: 'LAVA Producciones',          website: 'https://lavaproducciones.com/',               category: 'agency_production', city: 'Barcelona' },
  { name: 'Oldies',                     website: 'https://oldies.es/',                          category: 'agency_booking', city: 'Madrid' },
  { name: 'Mugre Records',              website: 'https://mugrerecords.com/',                   category: 'agency_booking', city: 'Madrid' },
  { name: 'Loud and Live',              website: 'https://loudandlive.com/',                    category: 'agency_production', city: 'Madrid' },
  { name: 'Glam Producciones',          website: 'https://www.glamproducciones.com/',           category: 'agency_production', city: 'Madrid' },
];

const ALL_SEEDS: Seed[] = [...VENUES, ...PROMOTERS, ...AGENCIES];

// ──────────────────────────────────────────────────────────────────────

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  website: string | null;
  category: string;
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

async function findExisting(name: string, category: Category): Promise<CompanyRow | null> {
  const tokens = normalize(name).split(' ').filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;

  // Permitimos cross-category match: a veces un "venue" en nuestra DB puede ser
  // en realidad una promotora (o vice versa), porque el scraping los mezcla.
  const likes = tokens.map(() => `LOWER(name) LIKE ?`).join(' AND ');
  const params = tokens.map((t) => `%${t}%`);
  const [rows] = await leadsPool.query<CompanyRow[]>(
    `SELECT id, name, website, category FROM companies WHERE ${likes} ORDER BY id ASC LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}

(async () => {
  let matched = 0;
  let created = 0;
  let websitesSet = 0;
  const byCategory: Record<string, number> = {};

  for (const s of ALL_SEEDS) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;

    const existing = await findExisting(s.name, s.category);
    let companyId: number;
    let actionTag: string;

    if (existing) {
      matched++;
      companyId = existing.id;
      const updates: string[] = [];
      const vals: unknown[] = [];
      if (!existing.website) { updates.push('website = ?'); vals.push(s.website); websitesSet++; }
      if (updates.length > 0) {
        vals.push(companyId);
        await leadsPool.query(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`, vals);
        actionTag = '↺';
      } else {
        actionTag = '=';
      }
      console.log(`${actionTag} [${companyId}] "${existing.name}" → matched (${existing.category})`);
    } else {
      const slug = companySlug(s.name);
      const [res] = await leadsPool.query<ResultSetHeader>(
        `INSERT INTO companies (slug, name, category, website, city, status)
         VALUES (?, ?, ?, ?, ?, 'new')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           website = COALESCE(website, VALUES(website))`,
        [slug, s.name, s.category, s.website, s.city ?? null],
      );
      companyId = res.insertId;
      created++;
      websitesSet++;
      console.log(`+ [${companyId}] created "${s.name}" (${s.category})`);
    }

    await leadsPool.query(
      `INSERT IGNORE INTO company_sources
         (company_id, source_platform, external_id, source_url, first_seen_at, last_seen_at)
       VALUES (?, 'seed_industry', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [companyId, companySlug(s.name), s.website],
    );
  }

  console.log(
    `\n[seed-industry] done · matched=${matched} · created=${created} · websites_set=${websitesSet} / ${ALL_SEEDS.length}`,
  );
  console.log(`  breakdown: ${Object.entries(byCategory).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  console.log(`\n[seed-industry] next: pnpm exec tsx bin/scrape_contact_pages.ts --limit ${ALL_SEEDS.length}`);
})()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
