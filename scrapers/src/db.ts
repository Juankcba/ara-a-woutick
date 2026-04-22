import './env.ts';
import mysql from 'mysql2/promise';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const baseConfig = {
  host: requireEnv('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 3306),
  user: requireEnv('DB_USER'),
  password: requireEnv('DB_PASS'),
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
} satisfies mysql.PoolOptions;

export const scrapingPool = mysql.createPool({
  ...baseConfig,
  database: requireEnv('DB_SCRAPING'),
});

export const publicPool = mysql.createPool({
  ...baseConfig,
  database: requireEnv('DB_PUBLIC'),
});

export async function closeAllPools(): Promise<void> {
  await Promise.all([scrapingPool.end(), publicPool.end()]);
}
