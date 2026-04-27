import 'server-only';
import mysql from 'mysql2/promise';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Pool singleton para evitar reconexiones en hot-reload.
declare global {
  // eslint-disable-next-line no-var
  var __leadsPool: mysql.Pool | undefined;
}

function getPool(): mysql.Pool {
  if (globalThis.__leadsPool) return globalThis.__leadsPool;
  const pool = mysql.createPool({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASS'),
    database: requireEnv('DB_LEADS'),
    waitForConnections: true,
    connectionLimit: 5,
  });
  if (process.env.NODE_ENV !== 'production') globalThis.__leadsPool = pool;
  return pool;
}

export type CompanyCategory =
  | 'promoter'
  | 'ticketing'
  | 'venue'
  | 'agency_production'
  | 'agency_marketing'
  | 'agency_booking'
  | 'festival'
  | 'fair'
  | 'congress'
  | 'hotel'
  | 'camping'
  | 'venue_complex'
  | 'other';

export type CompanyStatus =
  | 'new'
  | 'enriching'
  | 'enriched'
  | 'contacted'
  | 'qualified'
  | 'won'
  | 'lost'
  | 'dnc';

export interface CompanyRow {
  id: number;
  name: string;
  legalName: string | null;
  category: CompanyCategory;
  parentCompany: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  industry: string | null;
  employeesSize: string | null;
  employeesExact: number | null;
  status: CompanyStatus;
  totalEvents: number;
  sources: string[];
  lastSeenAt: Date | null;
  enrichmentSource: string | null;
}

interface RawRow {
  id: number;
  name: string;
  legal_name: string | null;
  category: CompanyCategory;
  parent_company: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  industry: string | null;
  employees_size: string | null;
  employees_exact: number | null;
  status: CompanyStatus;
  total_events: string | number | null;
  sources_csv: string | null;
  last_seen_at: Date | null;
  enrichment_source: string | null;
}

export interface GetCompaniesOptions {
  limit?: number;
  category?: CompanyCategory;
  status?: CompanyStatus;
  source?: string;
  city?: string;
  search?: string;
  hasInstagram?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
}

export async function getCompanies(opts: GetCompaniesOptions = {}): Promise<CompanyRow[]> {
  const limit = opts.limit ?? 500;
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.category) {
    where.push('c.category = ?');
    params.push(opts.category);
  }
  if (opts.status) {
    where.push('c.status = ?');
    params.push(opts.status);
  }
  if (opts.city) {
    where.push('c.city = ?');
    params.push(opts.city);
  }
  if (opts.hasInstagram) {
    where.push("c.instagram_url IS NOT NULL AND c.instagram_url <> ''");
  }
  if (opts.hasEmail) {
    where.push("c.email IS NOT NULL AND c.email <> ''");
  }
  if (opts.hasPhone) {
    where.push("c.phone IS NOT NULL AND c.phone <> ''");
  }
  if (opts.search) {
    where.push('(c.name LIKE ? OR c.website LIKE ? OR c.email LIKE ?)');
    const term = `%${opts.search}%`;
    params.push(term, term, term);
  }
  if (opts.source) {
    where.push(
      'EXISTS (SELECT 1 FROM company_sources cs WHERE cs.company_id = c.id AND cs.source_platform = ?)',
    );
    params.push(opts.source);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    `
    SELECT
      c.id, c.name, c.legal_name, c.category, c.parent_company,
      c.city, c.website, c.email, c.phone,
      c.linkedin_url, c.instagram_url, c.facebook_url, c.twitter_url,
      c.industry, c.employees_size, c.employees_exact,
      c.status, c.enrichment_source,
      COALESCE(SUM(s.events_count), 0)           AS total_events,
      GROUP_CONCAT(DISTINCT s.source_platform)    AS sources_csv,
      MAX(s.last_seen_at)                         AS last_seen_at
    FROM companies c
    LEFT JOIN company_sources s ON s.company_id = c.id
    ${whereSql}
    GROUP BY c.id
    ORDER BY total_events DESC, c.name ASC
    LIMIT ?
    `,
    params,
  );

  return (rows as unknown as RawRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    category: r.category,
    parentCompany: r.parent_company,
    city: r.city,
    website: r.website,
    email: r.email,
    phone: r.phone,
    linkedinUrl: r.linkedin_url,
    instagramUrl: r.instagram_url,
    facebookUrl: r.facebook_url,
    twitterUrl: r.twitter_url,
    industry: r.industry,
    employeesSize: r.employees_size,
    employeesExact: r.employees_exact,
    status: r.status,
    totalEvents: Number(r.total_events ?? 0),
    sources: r.sources_csv ? r.sources_csv.split(',') : [],
    lastSeenAt: r.last_seen_at,
    enrichmentSource: r.enrichment_source,
  }));
}

export async function getDistinctCities(): Promise<string[]> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT city FROM companies
       WHERE city IS NOT NULL AND city <> ''
       ORDER BY city ASC`,
  );
  return rows.map((r) => r.city as string);
}

export interface CompanyStats {
  total: number;
  byCategory: Record<CompanyCategory, number>;
  byStatus: Record<CompanyStatus, number>;
  bySource: Record<string, number>;
}

export async function getCompanyStats(): Promise<CompanyStats> {
  const [catRows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT category, COUNT(*) AS n FROM companies GROUP BY category',
  );
  const [stRows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT status, COUNT(*) AS n FROM companies GROUP BY status',
  );
  const [srcRows] = await getPool().query<mysql.RowDataPacket[]>(
    `SELECT source_platform, COUNT(DISTINCT company_id) AS n
       FROM company_sources GROUP BY source_platform`,
  );

  const byCategory = Object.fromEntries(
    catRows.map((r) => [r.category as string, Number(r.n)]),
  ) as Record<CompanyCategory, number>;
  const byStatus = Object.fromEntries(
    stRows.map((r) => [r.status as string, Number(r.n)]),
  ) as Record<CompanyStatus, number>;
  const bySource = Object.fromEntries(srcRows.map((r) => [r.source_platform as string, Number(r.n)]));

  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  return { total, byCategory, byStatus, bySource };
}
