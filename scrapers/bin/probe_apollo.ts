// Probe: ver qué devuelve Apollo.io para 3 empresas españolas conocidas.
// Gasta ~6 créditos total (2 por empresa: 1 org enrich + 1 people search).
// No persiste nada. Si la pinta es buena, armo el script de enriquecimiento real.
//
// Run: pnpm exec tsx bin/probe_apollo.ts

import '../src/env.ts';

const API_KEY = process.env.APOLLO_API_KEY;
if (!API_KEY) throw new Error('Missing APOLLO_API_KEY');

const TARGETS = [
  { name: 'Live Nation España', domain: 'livenation.es' },
  { name: 'Búho Management', domain: 'buhomanagement.com' },
  { name: 'Cosmic Producciones', domain: 'cosmicproducciones.es' },
];

const HEADERS = {
  'Cache-Control': 'no-cache',
  'Content-Type': 'application/json',
  'X-API-KEY': API_KEY,
};

async function enrichOrg(domain: string): Promise<unknown> {
  const url = `https://api.apollo.io/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`;
  const res = await fetch(url, { method: 'POST', headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`enrich ${domain} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function peopleSearch(orgName: string, orgDomain: string): Promise<unknown> {
  const body = {
    q_organization_domains_list: [orgDomain],
    page: 1,
    per_page: 3,
    person_titles: ['ceo', 'founder', 'owner', 'managing director', 'booking manager', 'general manager', 'director'],
  };
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`people ${orgName} HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

(async () => {
  for (const t of TARGETS) {
    console.log(`\n━━━━ ${t.name} (${t.domain}) ━━━━`);

    try {
      const org = (await enrichOrg(t.domain)) as Record<string, unknown>;
      const organization = (org as { organization?: Record<string, unknown> }).organization;
      if (!organization) {
        console.log('org: not found');
      } else {
        const summary = {
          name: organization.name,
          website_url: organization.website_url,
          linkedin_url: organization.linkedin_url,
          industry: organization.industry,
          estimated_num_employees: organization.estimated_num_employees,
          city: organization.city,
          country: organization.country,
          founded_year: organization.founded_year,
          phone: organization.phone,
        };
        console.log('org:', JSON.stringify(summary, null, 2));
      }
    } catch (e) {
      console.error('enrich error:', (e as Error).message);
    }

    try {
      const people = (await peopleSearch(t.name, t.domain)) as Record<string, unknown>;
      const contacts = ((people as { people?: Array<Record<string, unknown>> }).people ?? []);
      const mixed = ((people as { contacts?: Array<Record<string, unknown>> }).contacts ?? []);
      const all = [...contacts, ...mixed];
      console.log(`people: ${all.length} found`);
      for (const p of all) {
        const row = {
          name: p.name,
          title: p.title,
          email_status: p.email_status,
          email: p.email ?? '(credit required)',
          linkedin: p.linkedin_url,
        };
        console.log('  ', JSON.stringify(row));
      }
    } catch (e) {
      console.error('people error:', (e as Error).message);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
