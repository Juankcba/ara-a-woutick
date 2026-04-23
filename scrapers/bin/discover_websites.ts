// Descubre website oficial de empresas sin él mediante "domain-guessing":
// genera candidatos plausibles (<slug>.com, <slug>.es, <slug>festival.com, ...)
// y testea cada uno con GET. El primero que devuelva 200 y contenga un token
// del nombre en el <title> o <h1> se guarda como companies.website.
//
// No usa motor de búsqueda (bloqueados por bot detection desde IP AR). Muy
// efectivo para festivales/promotores/venues con nombre-marca descriptivo.
//
// Flags:
//   --limit N         default 30
//   --dry-run         no persiste
//   --category X      filtra
//
// Uso:
//   pnpm exec tsx bin/discover_websites.ts --dry-run --limit 20
//   pnpm exec tsx bin/discover_websites.ts --limit 100 --category festival

import '../src/env.ts';
import { leadsPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  category: string;
  city: string | null;
  total_events: number;
}

interface CliArgs {
  limit: number;
  dryRun: boolean;
  category: string | null;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { limit: 30, dryRun: false, category: null };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    const a = av[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(av[++i] ?? 30);
    else if (a === '--category') args.category = av[++i] ?? null;
  }
  return args;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const REQ_TIMEOUT_MS = 8000;
const DELAY_BETWEEN_CANDIDATES_MS = 200;
const DELAY_BETWEEN_COMPANIES_MS = 300;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const STOP_WORDS = new Set([
  'de', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'u', 'del', 'al',
  'sl', 'sau', 'slu', 'sa', 'aie', 'sc', 'slp', 'cb',
  'group', 'grupo', 'company', 'co', 'the',
  'show', 'shows', 'en',
  'a', 'concretar', // skip placeholders
]);

// Dominios que NO debemos aceptar como "website oficial" aunque el HEAD
// devuelva 200: son parking pages, squatters, agregadores, etc.
const BLOCKLIST_HOSTS_CONTAINS = [
  'parking',
  'sedo.com',
  'godaddy',
  'afternic',
  'namesilo',
  'dan.com',
  'hugedomains',
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ');
}

function tokenize(name: string): string[] {
  return normalize(name).split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// Variantes de slug: compacto y con guiones, y con y sin "festival".
function candidateDomains(name: string): string[] {
  const tokens = tokenize(name);
  if (tokens.length === 0) return [];

  const joined = tokens.join('');
  const hyphenated = tokens.join('-');
  const withoutFestival = tokens.filter((t) => t !== 'festival');
  const joinedNoFest = withoutFestival.join('');
  const hyphenatedNoFest = withoutFestival.join('-');

  const bases = new Set<string>([
    joined,
    hyphenated,
    joinedNoFest,
    hyphenatedNoFest,
    joined + 'festival',
    hyphenated + 'festival',
    joined.replace(/^(el|la|los|las)/, ''),
  ]);
  bases.delete('');

  const tlds = ['com', 'es', 'org', 'net'];
  const out: string[] = [];
  for (const b of bases) {
    for (const tld of tlds) {
      out.push(`${b}.${tld}`);
    }
  }
  // Limitamos a ~16 para no pasar eternidades
  return out.slice(0, 16);
}

interface ValidationResult {
  ok: boolean;
  url: string;
  reason?: string;
  title?: string;
}

async function validateDomain(domain: string, nameTokens: string[]): Promise<ValidationResult> {
  const urls = [`https://${domain}/`, `https://www.${domain}/`];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const finalHost = new URL(res.url).hostname.toLowerCase();

      // si redirigió a una blocklist, fail
      if (BLOCKLIST_HOSTS_CONTAINS.some((b) => finalHost.includes(b))) {
        return { ok: false, url: res.url, reason: `redirected to parking/blocklist (${finalHost})` };
      }

      const html = (await res.text()).slice(0, 20000); // first 20KB enough for title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const text = normalize(`${titleMatch?.[1] ?? ''} ${h1Match?.[1] ?? ''}`);

      // al menos un token significativo del nombre debe aparecer en title/h1
      const anyMatch = nameTokens.some((t) => t.length >= 4 && text.includes(t));
      if (!anyMatch) {
        return {
          ok: false,
          url: res.url,
          reason: `no name token in title (${titleMatch?.[1]?.slice(0, 60) ?? '(no title)'})`,
          title: titleMatch?.[1],
        };
      }
      return { ok: true, url: res.url, title: titleMatch?.[1] };
    } catch {
      // timeout / DNS / TLS error → probar siguiente variante
    }
  }

  return { ok: false, url: `https://${domain}/`, reason: 'unreachable' };
}

async function fetchTargets(args: CliArgs): Promise<CompanyRow[]> {
  const where = ['c.website IS NULL'];
  const params: unknown[] = [];
  if (args.category) {
    where.push('c.category = ?');
    params.push(args.category);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [rows] = await leadsPool.query<CompanyRow[]>(
    `SELECT c.id, c.name, c.category, c.city,
            COALESCE(SUM(s.events_count), 0) AS total_events
       FROM companies c
       LEFT JOIN company_sources s ON s.company_id = c.id
       ${whereSql}
       GROUP BY c.id
       ORDER BY total_events DESC, c.id ASC
       LIMIT ?`,
    [...params, args.limit],
  );
  return rows;
}

async function saveWebsite(companyId: number, website: string): Promise<void> {
  await leadsPool.query<ResultSetHeader>(
    `UPDATE companies SET website = ? WHERE id = ? AND website IS NULL`,
    [website, companyId],
  );
}

(async () => {
  const args = parseArgs();
  console.log(
    `[discover] ${args.dryRun ? 'DRY RUN' : 'LIVE'} · limit=${args.limit} · category=${args.category ?? 'any'}\n`,
  );

  const targets = await fetchTargets(args);
  console.log(`[discover] ${targets.length} companies without website\n`);

  let matched = 0;
  let noMatch = 0;

  for (const c of targets) {
    const tokens = tokenize(c.name);
    if (tokens.length === 0) {
      console.log(`→ [${c.id}] ${c.name} — SKIP (no tokens)`);
      noMatch++;
      continue;
    }

    const candidates = candidateDomains(c.name);
    console.log(`→ [${c.id}] ${c.name} (${candidates.length} candidates, tokens=${tokens.join(',')})`);

    let found: ValidationResult | null = null;
    for (const d of candidates) {
      const v = await validateDomain(d, tokens);
      if (v.ok) {
        found = v;
        break;
      }
      await sleep(DELAY_BETWEEN_CANDIDATES_MS);
    }

    if (found) {
      console.log(`   ✓ ${found.url}  title="${found.title?.slice(0, 70) ?? ''}"`);
      matched++;
      if (!args.dryRun) await saveWebsite(c.id, found.url);
    } else {
      console.log('   ✗ no valid domain found');
      noMatch++;
    }

    await sleep(DELAY_BETWEEN_COMPANIES_MS);
  }

  console.log(
    `\n[discover] done · matched=${matched} · no_match=${noMatch} / ${targets.length} (${((matched / targets.length) * 100).toFixed(1)}% hit rate)`,
  );
})()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
