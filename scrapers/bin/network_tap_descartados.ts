// Network-tap masivo de fuentes descartadas para detectar APIs ocultas.
//
// El playwright-scan original detectó "probe none" en muchas fuentes mirando
// sólo HTML inicial. Pero codetickets y vivetix también aparecían como
// "probe none" — sus datos estaban en XHR a /api/... ocultos detrás de SPAs.
//
// Este script abre cada fuente con Playwright, escucha responses JSON
// (Content-Type: application/json) > 200 bytes que NO sean tracking/cookies,
// y reporta los hits para analizar manualmente cuál vale la pena scrapear.
//
// Uso:
//   pnpm exec tsx bin/network_tap_descartados.ts
//   pnpm exec tsx bin/network_tap_descartados.ts --slugs giglon_com,seetickets_com

import '../src/env.ts';
import { scrapingPool, closeAllPools } from '../src/db.ts';
import { chromium, type Page } from 'playwright';
import type { RowDataPacket } from 'mysql2';

const NOISE_HOSTS = [
  'google', 'gstatic', 'googletagmanager', 'doubleclick', 'sentry',
  'hotjar', 'cookiebot', 'cookiehub', 'cookiefirst', 'consent',
  'facebook', 'connect.facebook', 'tiktok', 'cloudflare', 'cf-',
  'segment', 'mixpanel', 'amplitude', 'clarity.ms',
  'akamaihd', 'newrelic', 'datadog', 'rollbar', 'bugsnag',
  'recaptcha', 'turnstile',
];

interface Hit {
  url: string;
  size: number;
  status: number;
}

interface Args { slugs: string[] | null }

function parseArgs(): Args {
  const args: Args = { slugs: null };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    if (av[i] === '--slugs') args.slugs = (av[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

function isNoise(url: string): boolean {
  return NOISE_HOSTS.some((h) => url.includes(h));
}

async function tapPage(page: Page, url: string, timeoutMs = 15000): Promise<Hit[]> {
  const hits: Hit[] = [];
  const seen = new Set<string>();

  page.on('response', async (res) => {
    try {
      const u = res.url();
      if (seen.has(u) || isNoise(u)) return;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.toLowerCase().includes('json')) return;
      const body = await res.body().catch(() => null);
      if (!body || body.length < 200) return;
      seen.add(u);
      hits.push({ url: u, size: body.length, status: res.status() });
    } catch { /* ignore */ }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => null);
    // Algunas SPAs disparan XHR sólo después de scroll/ready. Damos un poco más.
    await page.waitForTimeout(2000).catch(() => null);
  } catch { /* ignore navigation errors */ }

  return hits;
}

async function main() {
  const args = parseArgs();

  // Sólo descartados que tienen base_url útil. Excluyo los que ya migraron
  // a otro dominio (entradas.musikaze → musikaze.net) — esos probaron y nada.
  const where = args.slugs
    ? "slug IN (?)"
    : "config_status = 'descartado' AND base_url IS NOT NULL AND base_url != ''";
  const params = args.slugs ? [args.slugs] : [];
  const [rows] = await scrapingPool.query<RowDataPacket[]>(
    `SELECT slug, name, base_url FROM sources WHERE ${where} ORDER BY slug`,
    params,
  );

  console.log(`Target: ${rows.length} fuentes\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const summary: Array<{ slug: string; name: string; hits: Hit[] }> = [];

  for (const r of rows) {
    const slug = r.slug as string;
    const url = r.base_url as string;
    process.stdout.write(`[${slug.padEnd(32)}] `);
    const page = await ctx.newPage();
    const hits = await tapPage(page, url);
    await page.close();

    if (hits.length === 0) {
      console.log('—');
    } else {
      console.log(`${hits.length} JSON hit(s)`);
      for (const h of hits.slice(0, 5)) {
        console.log(`     ${h.status}  ${String(h.size).padStart(6)}b  ${h.url.slice(0, 120)}`);
      }
      if (hits.length > 5) console.log(`     (+${hits.length - 5} more)`);
    }
    summary.push({ slug, name: r.name as string, hits });
  }

  await ctx.close();
  await browser.close();

  console.log('\n====== RESUMEN ======');
  const withHits = summary.filter((s) => s.hits.length > 0);
  console.log(`Con JSON hits: ${withHits.length}/${summary.length}`);
  for (const s of withHits) {
    console.log(`  ${s.slug.padEnd(32)} ${s.hits.length} hit(s) — ${s.hits[0].url.slice(0, 80)}`);
  }
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exitCode = 1; })
  .finally(() => closeAllPools());
