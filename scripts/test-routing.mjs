// ---------------------------------------------------------------------------
// Guards the static-file routing.
//
// Regression test for a bug this restructure introduced: the local server was
// started as `php -S ... router.php` with no document root, so PHP resolved the
// router's `return false` against the repo root. After the move into public/,
// /css/app.css resolved to a file that no longer existed, every static request
// fell through to the HTML shell, and the page rendered completely unstyled.
//
// This asserts each asset is served with its REAL content type, and that
// static paths do not return the HTML shell.
//
//   node scripts/test-routing.mjs
//
// Requires the server: php -S 127.0.0.1:8000 -t public router.php
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8000';

const SHELL_PREFIX = '<!doctype html';

let pass = 0;
let fail = 0;

const check = async (name, fn) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail += 1;
    console.error(`  FAIL ${name}\n         ${err.message}`);
  }
};

console.log(`\nrouting against ${BASE}\n`);

const cases = [
  { path: '/', type: 'text/html', exact: 'html' },
  { path: '/css/app.css', type: 'text/css', contains: '#831843' },
  { path: '/js/app.js', type: 'javascript', contains: 'vendor/alpine.esm.js' },
  { path: '/js/vendor/alpine.esm.js', type: 'javascript', contains: 'packages/alpinejs' },
  { path: '/js/vendor/cropper.min.js', type: 'javascript', contains: 'Cropper.js' },
  { path: '/js/vendor/cropper.min.css', type: 'text/css', contains: 'cropper' },
  { path: '/audio/tracks.json', type: 'application/json' },
];

for (const c of cases) {
  await check(`${c.path} serves ${c.type}`, async () => {
    const res = await fetch(`${BASE}${c.path}`, {
      headers: { Accept: '*/*' },
    });
    assert.equal(res.status, 200, `status ${res.status}`);

    const contentType = res.headers.get('content-type') ?? '';
    assert.ok(
      contentType.includes(c.type),
      `content-type was "${contentType}", expected it to include "${c.type}"`,
    );

    const body = await res.text();

    // The bug this guards: a static path returning the HTML shell.
    if (c.exact !== 'html') {
      assert.ok(
        !body.trimStart().startsWith(SHELL_PREFIX),
        'served the HTML shell instead of the asset — the server is probably ' +
          'missing `-t public`, or router.php is not returning false',
      );
    }

    if (c.contains) {
      assert.ok(
        body.includes(c.contains),
        `body does not contain "${c.contains}" (got ${body.length} bytes, ` +
          `starts "${body.trimStart().slice(0, 40)}")`,
      );
    }
  });
}

await check('the API still responds with JSON', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200, `status ${res.status}`);
  const body = await res.json();
  assert.equal(body.ok, true, 'health envelope was not ok');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
