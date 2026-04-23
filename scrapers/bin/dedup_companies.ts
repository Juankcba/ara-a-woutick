// Dedup de leads_crm.companies. Normaliza nombres (strip "S.L.", "S.A.U.",
// paréntesis, tildes) y agrupa empresas idénticas. Por grupo elige un "winner"
// y fusiona el resto: migra company_sources, company_tags, contacts al winner,
// después borra los losers.
//
// SAFE by default: corre en --dry-run si no se pasa --apply.
//
//   pnpm exec tsx bin/dedup_companies.ts                  # dry-run
//   pnpm exec tsx bin/dedup_companies.ts --apply          # ejecuta merges

import '../src/env.ts';
import { leadsPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  legal_name: string | null;
  category: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  industry: string | null;
  enriched_at: Date | null;
  status: string;
  total_events: number;
}

function parseArgs(): { apply: boolean } {
  return { apply: process.argv.includes('--apply') };
}

// Sufijos societarios españoles. Orden importante — los más largos primero.
const LEGAL_SUFFIXES = [
  's\\.?a\\.?u\\.?',
  's\\.?l\\.?u\\.?',
  's\\.?c\\.?p\\.?',
  's\\.?l\\.?l\\.?',
  's\\.?r\\.?l\\.?',
  's\\.?c\\.?',
  's\\.?a\\.?',
  's\\.?l\\.?',
  's\\.?e\\.?',
  'a\\.?i\\.?e\\.?',
  'c\\.?b\\.?',
];

// Tokens que no agregan info para dedup (ruido post-nombre).
const NOISE_TOKENS = [
  'antes\\s+wizink\\s+center',
  'antes\\s+[a-z0-9 ]+',
  'el\\s+musical',
  'musical',
];

// Placeholders de venue "por confirmar" — NO dedupear, cada ciudad es un
// slot distinto. "A concretar (Madrid)" ≠ "A concretar (Zaragoza)".
const PLACEHOLDER_NAMES = /^(a\s+concretar|por\s+confirmar|to\s+be\s+announced|tba|venue\s+tbd)\b/i;

function normalizeForDedup(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (PLACEHOLDER_NAMES.test(s)) return null;

  // NO stripeamos paréntesis ciegamente — "Bajo La Gran Carpa (Barcelona)"
  // y "(Málaga)" son carpas distintas que tourean por ciudades. El caso
  // Movistar "(antes Wizink)" sí se resuelve vía NOISE_TOKENS más abajo.
  // Si más adelante aparecen casos legítimos "X (detalle)" que necesiten
  // merge, agregarlos al NOISE_TOKENS o manejar con whitelist.

  for (const sfx of LEGAL_SUFFIXES) {
    s = s.replace(new RegExp(`[,\\s]+${sfx}\\s*$`, 'i'), '');
  }
  for (const n of NOISE_TOKENS) {
    s = s.replace(new RegExp(n, 'i'), ' ');
  }
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

// Score para elegir winner: más datos enriquecidos + más eventos gana.
function scoreCompany(c: CompanyRow): number {
  let s = 0;
  if (c.enriched_at) s += 100;
  if (c.website) s += 10;
  if (c.linkedin_url) s += 10;
  if (c.industry) s += 5;
  if (c.phone) s += 5;
  if (c.email) s += 5;
  if (c.legal_name) s += 3; // más formal
  s += Math.min(Number(c.total_events ?? 0), 200);
  return s;
}

async function fetchAll(): Promise<CompanyRow[]> {
  const [rows] = await leadsPool.query<CompanyRow[]>(
    `SELECT c.id, c.name, c.legal_name, c.category, c.website, c.email, c.phone,
            c.linkedin_url, c.industry, c.enriched_at, c.status,
            COALESCE(SUM(s.events_count), 0) AS total_events
       FROM companies c
       LEFT JOIN company_sources s ON s.company_id = c.id
      GROUP BY c.id`,
  );
  return rows;
}

async function mergeInto(winnerId: number, loserIds: number[]): Promise<void> {
  if (loserIds.length === 0) return;

  // 1. Migrar company_sources — usar INSERT IGNORE para respetar UNIQUE(triple).
  for (const loser of loserIds) {
    await leadsPool.query(
      `INSERT IGNORE INTO company_sources
         (company_id, source_platform, external_id, source_url,
          first_seen_at, last_seen_at, events_count, raw)
       SELECT ?, source_platform, external_id, source_url,
              first_seen_at, last_seen_at, events_count, raw
         FROM company_sources
        WHERE company_id = ?`,
      [winnerId, loser],
    );
  }

  // 2. Migrar company_tags.
  for (const loser of loserIds) {
    await leadsPool.query(
      `INSERT IGNORE INTO company_tags (company_id, tag_id, added_at)
       SELECT ?, tag_id, added_at FROM company_tags WHERE company_id = ?`,
      [winnerId, loser],
    );
  }

  // 3. Migrar contacts (mover company_id a winner, email queda UNIQUE global).
  for (const loser of loserIds) {
    await leadsPool.query(
      `UPDATE IGNORE contacts SET company_id = ? WHERE company_id = ?`,
      [winnerId, loser],
    );
  }

  // 4. Borrar losers (CASCADE limpia company_sources, company_tags, contacts
  //    residuales que hayan quedado por UNIQUE constraints).
  await leadsPool.query(
    `DELETE FROM companies WHERE id IN (${loserIds.map(() => '?').join(',')})`,
    loserIds,
  );
}

(async () => {
  const { apply } = parseArgs();
  console.log(`[dedup] mode = ${apply ? 'APPLY (destructive)' : 'dry-run'}\n`);

  const companies = await fetchAll();
  console.log(`[dedup] loaded ${companies.length} companies`);

  // Agrupar por (normalized name, category). Misma category solo —
  // "Movistar Arena" como venue + "Movistar Arena" como promoter serían
  // diferentes; no mezclamos categorías.
  const groups = new Map<string, CompanyRow[]>();
  for (const c of companies) {
    const norm = normalizeForDedup(c.name);
    if (!norm || norm.length < 3) continue;
    const key = `${c.category}|${norm}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`[dedup] ${dupGroups.length} groups with duplicates (${dupGroups.reduce((a, g) => a + g.length - 1, 0)} rows to merge)\n`);

  let merged = 0;
  for (const g of dupGroups) {
    const sorted = g.map((c) => ({ c, score: scoreCompany(c) })).sort((a, b) => b.score - a.score);
    const winner = sorted[0].c;
    const losers = sorted.slice(1).map((x) => x.c);
    const cat = winner.category;

    console.log(`━━ [${cat}] winner #${winner.id} "${winner.name}" (score ${sorted[0].score})`);
    for (const l of losers) {
      const s = sorted.find((x) => x.c.id === l.id)?.score ?? 0;
      console.log(`   merge ← #${l.id} "${l.name}" (score ${s})`);
    }

    if (apply) {
      try {
        await mergeInto(winner.id, losers.map((l) => l.id));
        merged += losers.length;
      } catch (e) {
        console.error(`   ERROR merging: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n[dedup] done · groups=${dupGroups.length} · rows_merged=${apply ? merged : 0}${apply ? '' : ' (dry-run)'}`);
})()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
