/**
 * Why can the anon key read tables despite RLS being enabled?
 * Read-only diagnostics. Hard timeouts everywhere so it cannot hang.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (!/^["']/.test(v)) {
      const h = v.indexOf(' #');
      if (h !== -1) v = v.slice(0, h).trim();
    }
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}

async function main() {
  await loadEnv();
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    query_timeout: 15000,
  });
  await client.connect();

  console.log('\n1. role attributes');
  console.table(
    (
      await client.query(`
        select rolname, rolsuper, rolbypassrls
        from pg_roles
        where rolname in ('anon','authenticated','service_role','authenticator','postgres')
        order by rolname
      `)
    ).rows,
  );

  console.log('2. table owner + rls flag');
  console.table(
    (
      await client.query(`
        select c.relname as table,
               pg_get_userbyid(c.relowner) as owner,
               c.relrowsecurity as rls_enabled
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relkind='r'
          and c.relname in ('photo_cards','category_cards','app_settings')
        order by c.relname
      `)
    ).rows,
  );

  console.log('3. table privileges by role');
  console.table(
    (
      await client.query(`
        select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
        from information_schema.role_table_grants
        where table_name='photo_cards'
        group by grantee order by grantee
      `)
    ).rows,
  );

  for (const [label, sql] of [
    ['SELECT', 'select count(*)::int as n from photo_cards'],
    ['INSERT', "insert into category_cards (category,title,content) values ('love','__probe__','p')"],
  ]) {
    try {
      await client.query('begin');
      await client.query('set local role anon');
      const r = await client.query(sql);
      console.log(`4. anon ${label} -> ALLOWED${label === 'SELECT' ? ` (${r.rows[0].n} rows)` : ''}`);
      await client.query('rollback');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      console.log(`4. anon ${label} -> DENIED (${err.message.split('\n')[0]})`);
    }
  }

  await client.end();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  },
);