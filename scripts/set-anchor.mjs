// One-off: set the countdown anchor date (the anniversary).
//
//   node scripts/set-anchor.mjs 2023-04-27
//
// Kept as a script rather than a one-liner because inline SQL through a shell
// is a quoting minefield.

import { loadEnv, connect } from './db.mjs';

const raw = process.argv[2];

if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
  console.error('Usage: node scripts/set-anchor.mjs YYYY-MM-DD');
  process.exit(1);
}

const [y, m, d] = raw.split('-').map(Number);
const probe = new Date(y, m - 1, d);
if (
  probe.getFullYear() !== y ||
  probe.getMonth() !== m - 1 ||
  probe.getDate() !== d
) {
  console.error(`${raw} is not a real calendar date.`);
  process.exit(1);
}

await loadEnv();
const client = await connect();

try {
  const before = await client.query(
    `select value from app_settings where key = 'anchor_date'`,
  );

  await client.query(
    `update app_settings set value = $1 where key = 'anchor_date'`,
    [raw],
  );

  const after = await client.query(
    `select value from app_settings where key = 'anchor_date'`,
  );

  console.log(`  anchor_date: ${before.rows[0]?.value ?? '(unset)'} -> ${after.rows[0].value}`);
  console.log('  the countdown on the site updates on its next tick (within 1s)');
} finally {
  await client.end();
}
