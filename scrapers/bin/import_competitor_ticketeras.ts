// Importa las ticketeras competencia desde el Excel curado:
//   ~/Downloads/Ticketeras Competencia dificultad servicios 1.xlsx
//
// Cada fila → 1 row en ticket_scraping.sources con:
//   - slug derivado del dominio (nevent.es → nevent_es)
//   - name derivado del dominio (nevent.es → "Nevent.es")
//   - kind = 'html' (todas las competidoras son HTML hasta que diga otra cosa)
//   - is_competitor = TRUE
//   - active = FALSE  (deshabilitadas hasta tener config en admin)
//   - difficulty / notes / white_label_of / cashless desde el Excel
//   - config = '{}' (placeholder, se rellena desde /admin/scrapers)
//
// Idempotente: ON DUPLICATE KEY UPDATE actualiza nombre, base_url y metadata
// pero NO sobreescribe config ni active (para no pisar ediciones manuales).
//
// Uso:
//   pnpm exec tsx bin/import_competitor_ticketeras.ts
//   pnpm exec tsx bin/import_competitor_ticketeras.ts --dry-run
//   XLSX_PATH=/otra/ruta.xlsx pnpm exec tsx bin/import_competitor_ticketeras.ts

import '../src/env.ts';
import { scrapingPool, closeAllPools } from '../src/db.ts';
import path from 'node:path';
import os from 'node:os';
import xlsx from 'xlsx';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const DRY_RUN = process.argv.includes('--dry-run');
const XLSX_PATH =
  process.env.XLSX_PATH ??
  path.join(os.homedir(), 'Downloads', 'Ticketeras Competencia dificultad servicios 1.xlsx');

interface SheetRow {
  url: string;
  cashless: string | null;
  cashlessName: string | null;
  difficulty: number | string | null;
  whiteLabel: string | null;
  fortes: string | null;
  weak: string | null;
  col7: string | number | null;
  col8: string | number | null;
}

interface Parsed {
  slug: string;
  name: string;
  baseUrl: string;
  difficulty: number | null;
  notes: string | null;
  whiteLabelOf: string | null;
  cashless: 'yes' | 'no' | 'unknown';
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme);
}

function deriveSlug(u: URL): string {
  const host = u.host.replace(/^www\./, '');
  return host.replace(/\./g, '_').toLowerCase().slice(0, 50);
}

function deriveName(u: URL): string {
  const host = u.host.replace(/^www\./, '');
  return host.charAt(0).toUpperCase() + host.slice(1);
}

function parseDifficulty(v: SheetRow['difficulty']): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

function parseCashless(v: string | null): 'yes' | 'no' | 'unknown' {
  if (!v) return 'unknown';
  const t = v.toString().trim().toUpperCase();
  if (t === 'NO') return 'no';
  if (t === 'SI' || t === 'SÍ' || t === 'YES') return 'yes';
  return 'unknown';
}

function buildNotes(r: SheetRow): string | null {
  const parts: string[] = [];
  if (r.fortes) parts.push(`Fuertes: ${String(r.fortes).trim()}`);
  if (r.weak) parts.push(`Débiles: ${String(r.weak).trim()}`);
  if (r.col7 != null && String(r.col7).trim()) parts.push(`Comisión: ${String(r.col7).trim()}`);
  if (r.col8 != null && String(r.col8).trim()) parts.push(`Extra: ${String(r.col8).trim()}`);
  if (r.cashlessName) parts.push(`Cashless: ${String(r.cashlessName).trim()}`);
  return parts.length ? parts.join(' | ').slice(0, 65535) : null;
}

function parseRow(r: SheetRow): Parsed | null {
  if (!r.url || typeof r.url !== 'string' || !r.url.trim()) return null;
  let u: URL;
  try {
    u = normalizeUrl(r.url);
  } catch {
    console.warn(`  ! URL inválida, salteo: ${r.url}`);
    return null;
  }
  return {
    slug: deriveSlug(u),
    name: deriveName(u),
    baseUrl: `${u.protocol}//${u.host}`,
    difficulty: parseDifficulty(r.difficulty),
    notes: buildNotes(r),
    whiteLabelOf: r.whiteLabel && String(r.whiteLabel).trim().toUpperCase() !== 'NO'
      ? String(r.whiteLabel).trim().slice(0, 255)
      : null,
    cashless: parseCashless(r.cashless),
  };
}

function readSheet(): SheetRow[] {
  const wb = xlsx.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json<SheetRow>(ws, {
    header: ['url', 'cashless', 'cashlessName', 'difficulty', 'whiteLabel', 'fortes', 'weak', 'col7', 'col8'],
    range: 1,
    defval: null,
  });
}

async function main() {
  console.log(`xlsx:    ${XLSX_PATH}`);
  console.log(`dry-run: ${DRY_RUN}`);

  const rows = readSheet();
  console.log(`rows en hoja: ${rows.length}`);

  const parsed = rows.map(parseRow).filter((p): p is Parsed => p !== null);
  console.log(`parseados:    ${parsed.length}`);

  // Detectar slugs duplicados antes de insertar
  const slugCount = new Map<string, number>();
  for (const p of parsed) slugCount.set(p.slug, (slugCount.get(p.slug) ?? 0) + 1);
  const dupes = [...slugCount.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    console.warn(`\n!! Slugs duplicados detectados (se quedará solo la última fila):`);
    for (const [s, n] of dupes) console.warn(`   ${s}  ×${n}`);
  }

  if (DRY_RUN) {
    console.log(`\nPreview (primeras 10):`);
    for (const p of parsed.slice(0, 10)) {
      console.log(`  ${p.slug.padEnd(28)} ${p.baseUrl.padEnd(35)} dif=${p.difficulty ?? '-'} cashless=${p.cashless}`);
    }
    await closeAllPools();
    return;
  }

  // Pre-fetch existentes para distinguir insert vs update
  const [existing] = await scrapingPool.query<RowDataPacket[]>(
    `SELECT slug FROM sources WHERE slug IN (?)`,
    [parsed.map((p) => p.slug)],
  );
  const existingSlugs = new Set((existing as Array<{ slug: string }>).map((r) => r.slug));

  let inserted = 0;
  let updated = 0;

  for (const p of parsed) {
    const isNew = !existingSlugs.has(p.slug);
    const [res] = await scrapingPool.query<ResultSetHeader>(
      `INSERT INTO sources
         (slug, name, kind, base_url, active, difficulty, is_competitor,
          notes, white_label_of, cashless, config)
       VALUES (?, ?, 'html', ?, FALSE, ?, TRUE, ?, ?, ?, JSON_OBJECT())
       ON DUPLICATE KEY UPDATE
          name           = VALUES(name),
          base_url       = VALUES(base_url),
          difficulty     = VALUES(difficulty),
          is_competitor  = TRUE,
          notes          = VALUES(notes),
          white_label_of = VALUES(white_label_of),
          cashless       = VALUES(cashless)`,
      [p.slug, p.name, p.baseUrl, p.difficulty, p.notes, p.whiteLabelOf, p.cashless],
    );
    if (isNew) inserted++;
    else updated++;
    if ((inserted + updated) % 10 === 0) {
      process.stdout.write(`  ${inserted + updated}/${parsed.length}\r`);
    }
  }

  console.log(`\nInserted: ${inserted}  Updated: ${updated}  Total: ${inserted + updated}`);
  await closeAllPools();
}

main().catch(async (err) => {
  console.error(err);
  await closeAllPools();
  process.exit(1);
});
