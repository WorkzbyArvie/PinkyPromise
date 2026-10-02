/**
 * Quick database status: row counts, deck breakdown, settings, migrations.
 *   node scripts/status.mjs
 */

import { loadEnv, connect } from './db.mjs';

const TABLES = ['photo_cards', 'calendar_events', 'category_cards', 'app_settings', 'audio_tracks'];

async function main() {
  await loadEnv();
  const c = await connect();

  console.log('\nrow counts');
  for (const t of TABLES) {
    const r = await c.query(`select count(*)::int as n from ${t}`);
    console.log(`  ${t.padEnd(18)}${r.rows[0].n}`);
  }

  const decks = await c.query(
    `select category, count(*)::int as cards from category_cards
     group by category order by category`,
  );
  console.log('\ndeck cards per category');
  console.table(decks.rows);

  const app = await c.query(
    `select key,
            case when key = 'passcode_hash'
                 then case when value = '' then '(not set yet)'
                          else '(set, ' || length(value) || ' chars)'
                 end
            else value end as value
     from app_settings order by key`,
  );
  console.log('settings');
  console.table(app.rows);

  const tracks = await c.query(
    `select title, source_type from audio_tracks order by position, created_at`,
  );
  console.log('tracks');
  console.table(tracks.rows);

  const mig = await c.query(`select name from _migrations order by applied_at`);
  console.log(`migrations applied (${mig.rows.length}): ${mig.rows.map((r) => r.name).join(', ')}`);

  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});