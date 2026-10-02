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

// ---------------------------------------------------------------------------
// API route shape
//
// Vercel maps api/foo.php to /api/foo (cleanUrls). It never produces a nested
// URL, so a client calling /api/upload/signed 404s in production no matter what
// exists on disk. That shipped once already — the client asked for
// /api/upload/signed while the file was api/upload-signed.php.
//
// These assert every route the frontend actually calls is reachable, so a
// rename breaks the build instead of the upload.
// ---------------------------------------------------------------------------

const CLIENT_ROUTES = [
  'auth',
  'health',
  'version',
  'cards',
  'calendar',
  'decks',
  'tracks',
  'settings',
  'upload',
  'upload-signed',
];

console.log('\napi route shape');

for (const route of CLIENT_ROUTES) {
  await check(`/api/${route} resolves to a real endpoint`, async () => {
    const res = await fetch(`${BASE}/api/${route}`, { method: 'POST', body: '{}' });
    // Auth-gated endpoints answer 401, method-gated ones 405. What matters is
    // that it is NOT 404, which would mean the file does not exist.
    assert.notEqual(res.status, 404, `/api/${route} returned 404 — file missing or renamed`);
    const body = await res.json().catch(() => null);
    assert.ok(body?.error, `${route} did not answer with the standard error envelope`);
  });
}

await check('the frontend calls routes that exist', async () => {
  const res = await fetch(`${BASE}/js/api.js`);
  const src = await res.text();
  const called = [...src.matchAll(/`(\/api\/[a-z0-9-]+)/g)].map((m) => m[1]);
  assert.ok(called.length > 0, 'found no /api routes referenced in api.js');

  for (const route of new Set(called)) {
    const res2 = await fetch(`${BASE}${route}`, { method: 'POST', body: '{}' });
    assert.notEqual(
      res2.status,
      404,
      `api.js calls ${route} but it 404s — endpoints are flat, e.g. /api/upload-signed`,
    );
  }
});

await check('a nested api path is rejected, not silently collapsed', async () => {
  const res = await fetch(`${BASE}/api/upload/signed`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404, 'expected the nested path to be refused');
  const body = await res.json();
  assert.equal(body.error.code, 'not_found');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
