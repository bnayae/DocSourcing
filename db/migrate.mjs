#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://docsourcing:docsourcing@localhost:5432/docsourcing';

async function collectSqlFiles() {
  const dirs = [path.join(here, 'init'), path.join(here, 'migrations')];
  const files = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir);
      for (const entry of entries.filter((e) => e.endsWith('.sql')).sort()) {
        files.push(path.join(dir, entry));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return files;
}

async function main() {
  const files = await collectSqlFiles();
  if (files.length === 0) {
    console.log('No SQL files found under db/init/ or db/migrations/.');
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      const sql = await readFile(file, 'utf8');
      process.stdout.write(`  applying ${path.relative(here, file)} ... `);
      await client.query(sql);
      process.stdout.write('ok\n');
    }
  } finally {
    await client.end();
  }
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
