// Enriquecimiento con Apollo.io — organization enrichment only (free tier).
// People search requiere plan pago; lo dejamos deshabilitado hasta upgrade.
//
// Flags:
//   --limit N       cuántas empresas procesar (default 5)
//   --dry-run       no persiste ni gasta créditos, solo muestra qué haría
//   --category X    filtra por category (promoter|venue|festival|...)
//   --force         re-enriquece empresas ya procesadas
//
// Uso ejemplo:
//   pnpm exec tsx bin/enrich_apollo.ts --dry-run --limit 3
//   pnpm exec tsx bin/enrich_apollo.ts --limit 5 --category promoter
//   pnpm exec tsx bin/enrich_apollo.ts --limit 100  # correr todo el batch

import '../src/env.ts';
import { leadsPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  website: string | null;
  category: string;
  city: string | null;
  phone: string | null;
}

interface CliArgs {
  limit: number;
  dryRun: boolean;
  category: string | null;
  force: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { limit: 5, dryRun: false, category: null, force: false };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    const a = av[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--limit') args.limit = Number(av[++i] ?? 5);
    else if (a === '--category') args.category = av[++i] ?? null;
  }
  return args;
}

const API_KEY = process.env.APOLLO_API_KEY;
if (!API_KEY) throw new Error('Missing APOLLO_API_KEY');

const APOLLO_HEADERS: HeadersInit = {
  'Cache-Control': 'no-cache',
  'Content-Type': 'application/json',
  'X-API-KEY': API_KEY,
};

// Rate: ~1 req/sec para mantenernos debajo del límite y ser buenos ciudadanos
const REQ_DELAY_MS = 1100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  phone?: string;
  industry?: string;
  estimated_num_employees?: number;
  organization_raw_address?: string;
  city?: string;
  state?: string;
  country?: string;
  founded_year?: number;
}

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function sizeBucket(n: number | undefined): string | null {
  if (!n) return null;
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  return '1000+';
}

async function enrichOrg(opts: { domain?: string; name?: string }): Promise<ApolloOrganization | null> {
  const qs = new URLSearchParams();
  if (opts.domain) qs.set('domain', opts.domain);
  else if (opts.name) qs.set('organization_name', opts.name);
  else return null;

  const url = `https://api.apollo.io/v1/organizations/enrich?${qs.toString()}`;
  const res = await fetch(url, { method: 'POST', headers: APOLLO_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { organization?: ApolloOrganization };
  return data.organization ?? null;
}

async function fetchTargets(args: CliArgs): Promise<CompanyRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!args.force) where.push('c.enriched_at IS NULL');
  if (args.category) {
    where.push('c.category = ?');
    params.push(args.category);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Priorizamos por (has website DESC, events_count DESC). Las que tienen
  // website tienen mayor hit rate en Apollo (enrich by domain ≫ enrich by name).
  const [rows] = await leadsPool.query<CompanyRow[]>(
    `SELECT c.id, c.name, c.website, c.category, c.city, c.phone,
            (c.website IS NOT NULL) AS has_website,
            COALESCE(SUM(s.events_count), 0) AS total_events
       FROM companies c
       LEFT JOIN company_sources s ON s.company_id = c.id
       ${whereSql}
       GROUP BY c.id
       ORDER BY has_website DESC, total_events DESC, c.id ASC
       LIMIT ?`,
    [...params, args.limit],
  );
  return rows;
}

async function saveEnrichment(companyId: number, org: ApolloOrganization): Promise<void> {
  const size = sizeBucket(org.estimated_num_employees);

  await leadsPool.query<ResultSetHeader>(
    `UPDATE companies
        SET website         = COALESCE(website, ?),
            linkedin_url    = COALESCE(linkedin_url, ?),
            twitter_url     = COALESCE(twitter_url, ?),
            facebook_url    = COALESCE(facebook_url, ?),
            phone           = COALESCE(phone, ?),
            industry        = COALESCE(industry, ?),
            employees_size  = COALESCE(employees_size, ?),
            employees_exact = COALESCE(employees_exact, ?),
            founded_year    = COALESCE(founded_year, ?),
            city            = COALESCE(city, ?),
            status          = CASE WHEN status = 'new' THEN 'enriched' ELSE status END,
            enriched_at     = UTC_TIMESTAMP(),
            enrichment_source = 'apollo'
      WHERE id = ?`,
    [
      org.website_url ?? null,
      org.linkedin_url ?? null,
      org.twitter_url ?? null,
      org.facebook_url ?? null,
      org.phone ?? null,
      org.industry ?? null,
      size,
      org.estimated_num_employees ?? null,
      org.founded_year ?? null,
      org.city ?? null,
      companyId,
    ],
  );

  // Log en company_sources para trazabilidad.
  await leadsPool.query(
    `INSERT INTO company_sources
       (company_id, source_platform, external_id, source_url,
        first_seen_at, last_seen_at, events_count, raw)
     VALUES (?, 'apollo', ?, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 0, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       last_seen_at = UTC_TIMESTAMP(),
       raw = VALUES(raw)`,
    [companyId, org.id ?? `name:${org.name ?? ''}`, JSON.stringify(org)],
  );
}

async function markNotFound(companyId: number): Promise<void> {
  await leadsPool.query(
    `UPDATE companies
        SET enriched_at = UTC_TIMESTAMP(),
            enrichment_source = 'apollo-miss'
      WHERE id = ?`,
    [companyId],
  );
}

(async () => {
  const args = parseArgs();
  console.log(
    `[apollo] ${args.dryRun ? 'DRY RUN' : 'LIVE'} · limit=${args.limit} · category=${args.category ?? 'any'} · force=${args.force}`,
  );

  const targets = await fetchTargets(args);
  console.log(`[apollo] ${targets.length} companies to process\n`);

  let matched = 0;
  let notFound = 0;
  let errors = 0;

  for (const c of targets) {
    const domain = extractDomain(c.website);

    // Apollo free tier rechaza enrichment por name. Saltamos a no quemar
    // créditos en 422. Se desbloquea con plan Basic — cambiar ALLOW_NAME_ONLY
    // a true cuando se upgradee.
    const ALLOW_NAME_ONLY = process.env.APOLLO_ALLOW_NAME_ONLY === '1';
    if (!domain && !ALLOW_NAME_ONLY) {
      console.log(`→ [${c.id}] ${c.name} (${c.category}) · SKIP (no website, name-only requires paid plan)`);
      continue;
    }

    const strategy = domain ? `domain=${domain}` : `name="${c.name}"`;
    console.log(`→ [${c.id}] ${c.name} (${c.category}) · ${strategy}`);

    if (args.dryRun) {
      console.log('   (dry run — no API call)');
      continue;
    }

    try {
      const org = await enrichOrg(domain ? { domain } : { name: c.name });
      if (!org) {
        console.log('   ✗ not found in Apollo');
        await markNotFound(c.id);
        notFound++;
      } else {
        const summary = [
          org.website_url,
          org.industry,
          org.estimated_num_employees ? `${org.estimated_num_employees} emp` : null,
          org.city,
          org.phone,
        ]
          .filter(Boolean)
          .join(' · ');
        console.log(`   ✓ ${org.name} · ${summary}`);
        await saveEnrichment(c.id, org);
        matched++;
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`   ERROR: ${msg}`);
      errors++;
      // si es rate-limit, esperar más
      if (msg.includes('429')) await sleep(5000);
    }

    await sleep(REQ_DELAY_MS);
  }

  console.log(`\n[apollo] done · matched=${matched} · not_found=${notFound} · errors=${errors}`);
  console.log(`[apollo] credits used: ~${targets.length} (1 per attempt)`);
})()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
