/**
 * Decisive RLS + privilege test.
 *
 * Requires DATA to be meaningful: an empty table cannot distinguish
 * "RLS filtered everything" from "RLS off and there was nothing there".
 * So we seed a probe row as the server role, then compare what anon sees.
 *
 *   anon     must be unable to read it, write it, or delete it
 *   pooler   must still see it — this is the app's own path
 *
 * `node scripts/verify-rls.mjs`
 */

import { loadEnv, connect, asRole } from './db.mjs';

const TABLES = ['photo_cards', 'calendar_events', 'category_cards', 'app_settings', 'audio_tracks'];
const PROBE = '__rls_probe__';

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  console.error(`  FAIL  ${m}`);
  failures += 1;
};

async function main() {
  await loadEnv();
  const client = await connect();

  // --- clean any leftovers from a previous run ---
  await client.query('delete from category_cards where title = $1 or title = $2', [
    PROBE,
    '__anon_write__',
  ]);

  await client.query(
    `insert into category_cards (category, title, content) values ('love', $1, 'secret probe')`,
    [PROBE],
  );
  console.log('\nseeded a probe row as the server role');

  // --- 1. read isolation ---
  console.log('\n1. can anon read the seeded row?');
  let anonRead = 'denied';
  try {
    const n = await asRole(client, 'anon', async () => {
      const r = await client.query('select count(*)::int as n from category_cards');
      return r.rows[0].n;
    });
    anonRead = `${n} rows`;
    if (n === 0) ok('anon sees 0 rows (RLS filtering)');
    else bad(`anon sees ${n} rows — data is exposed`);
  } catch (err) {
    ok(`anon read denied at the privilege layer (${err.message.split('\n')[0].slice(0, 55)})`);
  }

  // --- 2. app path still works ---
  console.log('\n2. can the app read it? (pooler role)');
  const mine = await client.query('select count(*)::int as n from category_cards where title = $1', [PROBE]);
  if (mine.rows[0].n === 1) ok('pooler role sees the row — the app path works');
  else bad('pooler role cannot see its own row — the app is broken');

  // --- 3. mutation attempts ---
  console.log('\n3. can anon mutate or destroy data?');
  for (const [label, sql] of [
    ['INSERT', "insert into category_cards (category,title,content) values ('love','__anon_write__','x')"],
    ['UPDATE', `update category_cards set title='__hacked__' where title='${PROBE}'`],
    ['DELETE', `delete from category_cards where title='${PROBE}'`],
    ['TRUNCATE', 'truncate category_cards'],
  ]) {
    try {
      const res = await asRole(client, 'anon', () => client.query(sql));
      const affected = res.rowCount ?? 0;
      // A statement can be permitted yet affect zero rows because RLS hid
      // them. Only an actual write is a problem.
      if (affected > 0) bad(`anon ${label} modified ${affected} row(s)`);
      else ok(`anon ${label} had no effect (0 rows visible to anon)`);
    } catch (err) {
      const m = err.message.split('\n')[0];
      if (/timeout|canceling/i.test(m)) {
        bad(`anon ${label} timed out instead of being denied — privilege layer let it through`);
      } else {
        ok(`anon ${label} denied`);
      }
    }
  }

  // --- 4. integrity ---
  console.log('\n4. is the probe row still intact?');
  const survivor = await client.query('select count(*)::int as n from category_cards where title = $1', [PROBE]);
  if (survivor.rows[0].n === 1) ok('probe row untouched');
  else bad('probe row was modified or deleted');

  // --- 5. RLS flags + policies ---
  console.log('\n5. RLS flags and policy count');
  const flags = await client.query(
    `select c.relname as table, c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename=c.relname) as policies,
            has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
            has_table_privilege('anon', c.oid, 'TRUNCATE') as anon_truncate
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname = any($1) order by c.relname`,
    [TABLES],
  );
  console.table(flags.rows);

  for (const r of flags.rows) {
    if (!r.rls) bad(`${r.table}: RLS is OFF`);
    if (r.anon_select) bad(`${r.table}: anon still holds SELECT`);
    if (r.anon_truncate) bad(`${r.table}: anon still holds TRUNCATE (not RLS-protected)`);
  }
  if (flags.rows.every((r) => r.rls && !r.anon_select && !r.anon_truncate)) {
    ok('every table: RLS on, anon holds neither SELECT nor TRUNCATE');
  }

  // --- 6. real anon key over PostgREST ---
  console.log('\n6. PostgREST with the real anon key');
  const anonKey = process.env.ANON_KEY_PROBE;
  if (anonKey && process.env.SUPABASE_URL) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/category_cards?select=title`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    const body = await res.text();
    if (body.includes(PROBE)) bad('anon API response CONTAINS the probe row');
    else ok(`anon API response excludes it (HTTP ${res.status})`);
  } else {
    console.log('  (skipped: ANON_KEY_PROBE not set)');
  }

  // --- cleanup ---
  await client.query('delete from category_cards where title = any($1)', [[PROBE, '__anon_write__']]);
  await client.end();
  console.log('\ncleanup: probe rows removed');
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});