// Aplica un .sql a una de las DBs (scraping / public / leads).
// Uso: tsx bin/_apply_migration.ts <db> <path-to-sql>
//   db: scraping | public | leads
// El archivo se splitea por `;` (excluyendo dentro de comentarios) y se
// ejecuta sentencia por sentencia para que mysql2 acepte multiples ALTER.

import '../src/env.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const TARGET = process.argv[2];
const SQL_PATH = process.argv[3];

if (!TARGET || !SQL_PATH) {
  console.error('Uso: tsx bin/_apply_migration.ts <scraping|public|leads> <path>');
  process.exit(1);
}

function pickDb(target: string): string {
  switch (target) {
    case 'scraping': return process.env.DB_SCRAPING!;
    case 'public':   return process.env.DB_PUBLIC!;
    case 'leads':    return process.env.DB_LEADS!;
    default: throw new Error(`Target inválido: ${target}`);
  }
}

function splitStatements(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const db = pickDb(TARGET);
  const fullPath = path.resolve(SQL_PATH);
  const sql = await fs.readFile(fullPath, 'utf8');
  const stmts = splitStatements(sql);

  console.log(`DB: ${db}`);
  console.log(`File: ${fullPath}`);
  console.log(`Statements: ${stmts.length}`);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER!,
    password: process.env.DB_PASS!,
    database: db,
    multipleStatements: false,
  });

  let ok = 0;
  let skipped = 0;
  for (const [i, stmt] of stmts.entries()) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
    try {
      await conn.query(stmt);
      console.log(`  ✓ [${i + 1}/${stmts.length}] ${preview}`);
      ok++;
    } catch (err) {
      const e = err as { code?: string; message: string };
      if (
        e.code === 'ER_DUP_FIELDNAME' ||
        e.code === 'ER_DUP_KEYNAME' ||
        e.code === 'ER_TABLE_EXISTS_ERROR'
      ) {
        console.log(`  ↷ [${i + 1}/${stmts.length}] (skip — ya existe) ${preview}`);
        skipped++;
        continue;
      }
      console.error(`  ✗ [${i + 1}/${stmts.length}] ${preview}`);
      console.error(`    ${e.code ?? ''} ${e.message}`);
      await conn.end();
      process.exit(2);
    }
  }

  console.log(`\nOK: ${ok}  Skipped: ${skipped}`);
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
