// ---------------------------------------------------------------------------
// Clear the passcode so /api/auth-bootstrap can run again.
//
// Needed after scripts/test-api.mjs, which sets a throwaway passcode. Also
// the recovery path if you forget your passcode — it requires a database
// console, so it cannot be done through the app itself.
//
//   node scripts/reset-passcode.mjs
// ---------------------------------------------------------------------------

import { loadEnv, connect } from './db.mjs';

await loadEnv();
const client = await connect();

try {
  const before = await client.query(
    `select value from app_settings where key = 'passcode_hash'`,
  );

  await client.query(
    `update app_settings set value = '' where key = 'passcode_hash'`,
  );

  console.log(
    before.rows[0]?.value
      ? 'passcode cleared — every existing session cookie is now invalid'
      : 'passcode was already unset',
  );
  console.log('run POST /api/auth-bootstrap again to choose a new one');
} finally {
  await client.end();
}