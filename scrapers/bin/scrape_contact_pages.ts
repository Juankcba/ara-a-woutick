// Scrapea las páginas de contacto/prensa/equipo de las empresas de leads_crm
// que ya tienen website. Extrae emails + teléfonos + URLs de redes sociales
// (IG, FB, Twitter/X, LinkedIn). Persiste en leads_crm.contacts y
// leads_crm.companies (cuando los campos están NULL).
//
// Flags:
//   --limit N       cuántas empresas procesar (default 30)
//   --dry-run       no persiste, solo muestra qué encontraría
//   --category X    filtra por category
//   --force         reintenta empresas que ya tienen contacts
//
// Uso:
//   pnpm exec tsx bin/scrape_contact_pages.ts --dry-run --limit 5
//   pnpm exec tsx bin/scrape_contact_pages.ts --limit 30 --category festival

import '../src/env.ts';
import { leadsPool, closeAllPools } from '../src/db.ts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  website: string;
  category: string;
  existing_contacts: number;
}

interface CliArgs {
  limit: number;
  dryRun: boolean;
  category: string | null;
  force: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { limit: 30, dryRun: false, category: null, force: false };
  const av = process.argv.slice(2);
  for (let i = 0; i < av.length; i++) {
    const a = av[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--limit') args.limit = Number(av[++i] ?? 30);
    else if (a === '--category') args.category = av[++i] ?? null;
  }
  return args;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Paths típicos donde las empresas suelen poner contacto.
// Orden: más probable primero (corta al primer hit con email).
const CONTACT_PATHS = [
  '/contacto',
  '/contacto/',
  '/contact',
  '/contact/',
  '/contactanos',
  '/contactenos',
  '/prensa',
  '/press',
  '/media',
  '/equipo',
  '/team',
  '/sobre-nosotros',
  '/quienes-somos',
  '/nosotros',
  '/about',
  '/',
];

const REQ_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 10000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Regex permisivo para emails. Filtramos después obvios fakes.
const EMAIL_RE = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]{2,}/g;
// Phones ES: exigimos separador explícito entre grupos — sin separadores son
// casi siempre IDs de tracking de 9+ dígitos que matchean el pattern.
// Formatos aceptados: "+34 915 00 18 83", "915-001-883", "915 001 883".
const PHONE_RE = /(?:\+34[\s.-]+)?[6-9]\d{2}[\s.-]+\d{2,3}[\s.-]+\d{2,3}(?:[\s.-]+\d{2,3})?/g;

const FAKE_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.es',
  'ejemplo.com',
  'ejemplo.es',
  'tu-dominio.com',
  'tudominio.com',
  'dominio.com',
  'tuempresa.com',
  'tuempresa.es',
  'empresa.com',
  'tuweb.com',
  'tuweb.es',
  'email.com',
  'site.com',
  'domain.com',
  'test.com',
  'placeholder.com',
  'sentry-next.wixpress.com',
  'sentry.wixpress.com',
  'sentry.io',
  'wixpress.com',
  'cloudflare.com',
]);

function cleanEmails(raw: string[]): string[] {
  const out = new Set<string>();
  for (const e of raw) {
    const lower = e.toLowerCase().replace(/\.$/, '');
    const parts = lower.split('@');
    if (parts.length !== 2) continue;
    const [local, domain] = parts;
    if (FAKE_EMAIL_DOMAINS.has(domain)) continue;
    // domain debe tener al menos 1 letra — "3.2.1" no es un dominio real
    if (!/[a-z]/.test(domain)) continue;
    // extension del TLD debe ser ≥2 chars no numéricos
    const tld = domain.split('.').pop() ?? '';
    if (!/^[a-z]{2,}$/.test(tld)) continue;
    if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|js|css|ico)$/i.test(lower)) continue;
    // filtrar pseudo-emails de tracking/assets
    if (/u0026|sentry|wixpress|recaptcha|google-analytics/.test(lower)) continue;
    // filtrar IDs tipo 3edbrsr79n34akqgs5catgdout4e0s@example
    if (/^[a-f0-9]{24,}@/.test(lower)) continue;
    // filtrar patrones package@version (ej: core-js-bundle@3.2.1)
    if (/^[\w-]+@\d+\.\d+/.test(lower)) continue;
    out.add(lower);
  }
  return [...out];
}

// Detección de URLs de redes sociales en el HTML.
// Para cada red, captura el primer "perfil" — descarta links de share,
// intent/tweet, plugins, hashtags, y links a la propia red genérica.
type SocialField = 'instagram' | 'facebook' | 'twitter' | 'linkedin';
interface Socials {
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  linkedin: string | null;
}

// Después de la URL base, cualquier query/fragmento queda restringido a chars
// URL-seguros — esto evita capturar JSON inline (",iconEnabled":...) cuando el
// HTML mete varios profile URLs juntos en un script tag.
const URL_TAIL = `[?#][^\\s"'<>,;]*`;
const SOCIAL_PATTERNS: Record<SocialField, RegExp> = {
  instagram: new RegExp(`https?:\\/\\/(?:www\\.)?instagram\\.com\\/([a-zA-Z0-9._]{2,30})\\/?(?:${URL_TAIL})?`, 'g'),
  facebook:  new RegExp(`https?:\\/\\/(?:www\\.|m\\.)?facebook\\.com\\/([a-zA-Z0-9.-]{2,50})\\/?(?:${URL_TAIL})?`, 'g'),
  twitter:   new RegExp(`https?:\\/\\/(?:www\\.)?(?:twitter\\.com|x\\.com)\\/([a-zA-Z0-9_]{1,15})\\/?(?:${URL_TAIL})?`, 'g'),
  linkedin:  new RegExp(`https?:\\/\\/(?:[a-z]{2,3}\\.)?linkedin\\.com\\/(?:company|in|school)\\/[a-zA-Z0-9_-]{2,80}\\/?(?:${URL_TAIL})?`, 'g'),
};

// Subpaths que NO son perfiles reales — se filtran por handle/path.
const SOCIAL_HANDLE_BLACKLIST: Record<SocialField, RegExp> = {
  instagram: /^(p|reel|reels|stories|share|explore|tv|accounts|developer|about|legal|directory)$/i,
  facebook:  /^(sharer|share|dialog|plugins|tr|events|pages|groups|gaming|watch|marketplace|business|policies|help|policy|terms)$/i,
  twitter:   /^(intent|share|home|search|hashtag|i|settings|login|signup|notifications|messages|explore|compose)$/i,
  linkedin:  /^$/, // linkedin pattern ya exige /company/, /in/ o /school/, no necesita blacklist
};

function extractSocials(html: string, _baseHost: string): Socials {
  const out: Socials = { instagram: null, facebook: null, twitter: null, linkedin: null };
  for (const field of Object.keys(SOCIAL_PATTERNS) as SocialField[]) {
    const re = SOCIAL_PATTERNS[field];
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const url = match[0];
      const handle = match[1] ?? '';
      if (handle && SOCIAL_HANDLE_BLACKLIST[field].test(handle)) continue;
      // limpiar trailing punctuation y quotes
      const clean = url.replace(/['"]+$/, '').replace(/[).,;]+$/, '');
      out[field] = clean;
      break;
    }
  }
  return out;
}

function cleanPhones(raw: string[]): string[] {
  const out = new Set<string>();
  for (const p of raw) {
    const digits = p.replace(/[^\d+]/g, '');
    if (digits.length < 9 || digits.length > 14) continue;
    out.add(p.trim());
  }
  return [...out];
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface ContactData {
  emails: string[];
  phones: string[];
  socials: Socials;
  pagesVisited: string[];
}

async function scrapeContacts(website: string): Promise<ContactData> {
  const emailsSet = new Set<string>();
  const phonesSet = new Set<string>();
  const socials: Socials = { instagram: null, facebook: null, twitter: null, linkedin: null };
  const visited: string[] = [];

  let base: URL;
  try {
    base = new URL(website.startsWith('http') ? website : `https://${website}`);
  } catch {
    return { emails: [], phones: [], socials, pagesVisited: [] };
  }

  for (const path of CONTACT_PATHS) {
    const url = `${base.origin}${path}`;
    const html = await fetchHtml(url);
    if (!html) continue;
    visited.push(url);

    // mailto: primero (más confiable)
    const mailtos = [...html.matchAll(/mailto:([^"'>\s?&]+)/gi)].map((m) => m[1]);
    for (const m of cleanEmails(mailtos)) emailsSet.add(m);

    // plaintext email
    const emailHits = html.match(EMAIL_RE) ?? [];
    for (const e of cleanEmails(emailHits)) emailsSet.add(e);

    // phones
    const phoneHits = html.match(PHONE_RE) ?? [];
    for (const p of cleanPhones(phoneHits)) phonesSet.add(p);

    // socials — solo seteamos las que todavía no encontramos
    const found = extractSocials(html, base.host);
    for (const k of ['instagram', 'facebook', 'twitter', 'linkedin'] as const) {
      if (!socials[k] && found[k]) socials[k] = found[k];
    }

    // Cortamos cuando ya tenemos email + las 4 socials. Si solo email,
    // damos una página más por si el contacto está separado del footer.
    const allSocialsFound = Object.values(socials).every((v) => v !== null);
    if (emailsSet.size > 0 && allSocialsFound) break;
    await sleep(500);
  }

  return {
    emails: [...emailsSet].slice(0, 5),
    phones: [...phonesSet].slice(0, 3),
    socials,
    pagesVisited: visited,
  };
}

async function fetchTargets(args: CliArgs): Promise<CompanyRow[]> {
  const where = ['c.website IS NOT NULL'];
  const params: unknown[] = [];
  // Sin --force, procesar empresas a las que les falte AL MENOS UNA cosa:
  // contactos, instagram, facebook, twitter o linkedin.
  if (!args.force) {
    where.push(
      `(NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.company_id = c.id)
        OR c.instagram_url IS NULL
        OR c.facebook_url IS NULL
        OR c.twitter_url IS NULL
        OR c.linkedin_url IS NULL)`,
    );
  }
  if (args.category) {
    where.push('c.category = ?');
    params.push(args.category);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await leadsPool.query<CompanyRow[]>(
    `SELECT c.id, c.name, c.website, c.category,
            (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id) AS existing_contacts
       FROM companies c
       ${whereSql}
       ORDER BY
         -- 1) más socials NULL primero — estas son las que más beneficio reciben
         ((c.instagram_url IS NULL) + (c.facebook_url IS NULL) +
          (c.twitter_url IS NULL) + (c.linkedin_url IS NULL)) DESC,
         -- 2) entre las del mismo bucket, las nunca enriquecidas primero
         (c.enriched_at IS NULL) DESC,
         c.enriched_at ASC,
         c.id ASC
       LIMIT ?`,
    [...params, args.limit],
  );
  return rows;
}

async function saveContacts(companyId: number, data: ContactData): Promise<number> {
  let inserted = 0;
  for (const email of data.emails) {
    try {
      const [res] = await leadsPool.query<ResultSetHeader>(
        `INSERT IGNORE INTO contacts
           (company_id, email, source_platform, source_ref, email_verified)
         VALUES (?, ?, 'scrape_contact', ?, FALSE)`,
        [companyId, email, data.pagesVisited[0] ?? null],
      );
      if (res.affectedRows === 1) inserted++;
    } catch (e) {
      console.error(`     email insert failed (${email}): ${(e as Error).message}`);
    }
  }

  // Guardamos el primer phone en companies.phone si está vacío.
  if (data.phones.length > 0) {
    await leadsPool.query(
      `UPDATE companies SET phone = COALESCE(phone, ?) WHERE id = ?`,
      [data.phones[0], companyId],
    );
  }

  // También seteamos companies.email con el mejor email (booking/contratacion/press
  // > info/hola > el resto). Esto hace que el icono Mail en /promoters aparezca.
  if (data.emails.length > 0) {
    const ranked = [...data.emails].sort((a, b) => emailRank(a) - emailRank(b));
    await leadsPool.query(
      `UPDATE companies SET email = COALESCE(email, ?) WHERE id = ?`,
      [ranked[0], companyId],
    );
  }

  // Socials — solo llenamos los que están NULL. UPDATE con COALESCE no toca
  // los valores existentes, así que un re-run no pisa lo verificado a mano.
  // Si algún URL salió monstruoso (regex roto sobre JSON inline), lo descartamos
  // antes del UPDATE — la columna es VARCHAR(500), un >500 char haría fallar
  // la query y matar el run entero.
  const MAX_URL = 500;
  const updates: string[] = [];
  const params: unknown[] = [];
  const safe = (v: string | null) => (v && v.length <= MAX_URL ? v : null);
  const ig = safe(data.socials.instagram);
  const fb = safe(data.socials.facebook);
  const tw = safe(data.socials.twitter);
  const li = safe(data.socials.linkedin);
  if (ig) { updates.push('instagram_url = COALESCE(instagram_url, ?)'); params.push(ig); }
  if (fb) { updates.push('facebook_url  = COALESCE(facebook_url,  ?)'); params.push(fb); }
  if (tw) { updates.push('twitter_url   = COALESCE(twitter_url,   ?)'); params.push(tw); }
  if (li) { updates.push('linkedin_url  = COALESCE(linkedin_url,  ?)'); params.push(li); }
  if (updates.length > 0) {
    params.push(companyId);
    try {
      await leadsPool.query(
        `UPDATE companies SET ${updates.join(', ')} WHERE id = ?`,
        params,
      );
    } catch (e) {
      // No matar el run por un row patológico — log y seguimos.
      console.error(`     socials UPDATE failed for #${companyId}: ${(e as Error).message}`);
    }
  }
  return inserted;
}

// Menor número = mejor email de contacto B2B.
function emailRank(email: string): number {
  const local = email.split('@')[0];
  if (/^(booking|contratacion|contrataciones|management)$/.test(local)) return 0;
  if (/^(press|prensa|comunicacion)$/.test(local)) return 1;
  if (/^(info|hola|hello|contact|contacto)$/.test(local)) return 2;
  if (/^(marketing|ventas|comercial)$/.test(local)) return 3;
  if (/^(admin|administracion|jobs|rrhh|hr)$/.test(local)) return 5;
  // Si es personal (ej: juan@, marco@), lo ponemos intermedio (más útil que info/admin)
  return 4;
}

(async () => {
  const args = parseArgs();
  console.log(
    `[scrape-contacts] ${args.dryRun ? 'DRY RUN' : 'LIVE'} · limit=${args.limit} · category=${args.category ?? 'any'} · force=${args.force}\n`,
  );

  const targets = await fetchTargets(args);
  console.log(`[scrape-contacts] ${targets.length} companies with website to process\n`);

  let matched = 0;
  let totalEmails = 0;

  let totalSocials = 0;

  for (const c of targets) {
    console.log(`→ [${c.id}] ${c.name} · ${c.website}`);
    const data = await scrapeContacts(c.website);
    const emailsTxt = data.emails.length ? data.emails.join(', ') : '(none)';
    const phonesTxt = data.phones.length ? data.phones.join(', ') : '(none)';
    const socialsList = (Object.entries(data.socials).filter(([, v]) => v) as [string, string][])
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(none)';
    console.log(`   emails:  ${emailsTxt}`);
    console.log(`   phones:  ${phonesTxt}`);
    console.log(`   socials: ${socialsList}`);
    console.log(`   visited: ${data.pagesVisited.length} pages`);

    if (data.emails.length > 0) matched++;
    totalEmails += data.emails.length;
    totalSocials += Object.values(data.socials).filter((v) => v).length;

    const hasAnything = data.emails.length > 0 || Object.values(data.socials).some((v) => v);
    if (!args.dryRun && hasAnything) {
      const inserted = await saveContacts(c.id, data);
      console.log(`   ✓ saved ${inserted} new contacts + socials`);
    }

    // Marcar enriched_at incluso cuando no encontramos nada — así el siguiente
    // ORDER BY enriched_at ASC no la vuelve a elegir antes que las vírgenes.
    if (!args.dryRun) {
      await leadsPool.query('UPDATE companies SET enriched_at = UTC_TIMESTAMP() WHERE id = ?', [c.id]);
    }

    await sleep(REQ_DELAY_MS);
  }

  console.log(
    `\n[scrape-contacts] done · companies=${targets.length} · with_email=${matched} · emails_found=${totalEmails} · socials_found=${totalSocials}`,
  );
})()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => closeAllPools());
