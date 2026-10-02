/**
 * Migration runner.
 *
 * Applies every db/*.sql file in filename order inside a transaction,
 * recording each in _migrations so re-runs are safe.
 *
 *   node scripts/migrate.mjs            apply pending
 *   node scripts/migrate.mjs --status   list applied/pending, apply nothing
 *
 * Uses `pg` as a DEV dependency only — never deployed, never imported by PHP.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv, connect, redact, ROOT } from './db.mjs';

async function main() {
  await loadEnv();
  const statusOnly = process.argv.includes('--status');
  const client = await connect();

  const { rows: version } = await client.query('select version()');
  console.log(`connected — ${version[0].version.split(',')[0]}`);
  console.log(`via      ${redact(process.env.DATABASE_URL)}`);

  await client.query(`
    create table if not exists _migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const dir = join(ROOT, 'db');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows: applied } = await client.query('select name from _migrations');
  const done = new Set(applied.map((r) => r.name));
  const pending = files.filter((f) => !done.has(f));

  if (statusOnly) {
    console.log(`\nmigrations (${files.length} files)`);
    for (const f of files) console.log(`  ${done.has(f) ? 'applied' : 'PENDING'}  ${f}`);
    await client.end();
    return;
  }

  if (!pending.length) {
    console.log('\nnothing to do — all migrations already applied');
    await client.end();
    return;
  }

  console.log(`\napplying ${pending.length} migration(s)\n`);

  for (const file of pending) {
    const sql = await readFile(join(dir, file), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`  ok   ${file}`);
    } catch (err) {
      await client.query('rollback').catch(() => {});
      console.error(`  FAIL ${file}\n       ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  const { rows: tables } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in
      ('photo_cards','calendar_events','category_cards','app_settings','audio_tracks')
    order by table_name
  `);
  console.log(`\ntables present: ${tables.map((t) => t.table_name).join(', ') || 'none'}`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});