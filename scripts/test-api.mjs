// ---------------------------------------------------------------------------
// End-to-end API test against a live PHP server.
//
//   php -S 127.0.0.1:8000 router.php   (in another shell)
//   node scripts/test-api.mjs
//
// Exercises the real auth flow, every endpoint, and the rejection paths.
// Sets a throwaway passcode the first time it runs; later runs reuse it.
// ---------------------------------------------------------------------------

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8000';

// Read .env here rather than expecting it on the command line, so the
// setup token never has to appear in a shell command or its output.
await (await import('./db.mjs')).loadEnv();

const SETUP_TOKEN = process.env.APP_SETUP_TOKEN ?? '';
const TEST_PASSCODE = 'rmb-test-9142';

let pass = 0;
let fail = 0;

const ok = (m) => {
  pass += 1;
  console.log(`  PASS  ${m}`);
};
const bad = (m, extra = '') => {
  fail += 1;
  console.error(`  FAIL  ${m}${extra ? `\n        ${extra}` : ''}`);
};

const check = (cond, m, extra = '') => (cond ? ok(m) : bad(m, extra));

/** A cookie jar so the session behaves like a browser's. */
let cookie = '';

async function call(path, { method = 'GET', body, raw, headers: extra } = {}) {
  const headers = { ...(extra ?? {}) };
  if (cookie) headers.Cookie = cookie;

  let payload;
  if (raw) {
    headers['Content-Type'] = 'application/octet-stream';
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload,
    redirect: 'manual',
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    if (pair.startsWith('rmb_session=')) cookie = pair;
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON — kept as text for the assertion message */
  }

  return { status: res.status, json, text, headers: res.headers };
}

/** A tiny valid JPEG, so upload MIME sniffing has real bytes to read. */
function makeJpeg() {
  // 1x1 baseline JPEG.
  const b64 =
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  return Buffer.from(b64, 'base64');
}

async function main() {
  console.log(`\nAPI test against ${BASE}\n`);

  // ---------------------------------------------------------------- health
  console.log('1. health (unauthenticated)');
  {
    const r = await call('/api/health');
    check(r.status === 200, 'health returns 200', `got ${r.status}: ${r.text.slice(0, 120)}`);
    check(r.json?.ok === true, 'health envelope ok');
    check(r.json?.data?.checks?.database === true, 'database reachable');
    check(r.json?.data?.checks?.storage === true, 'storage reachable');
    check(r.json?.data?.checks?.schema === true, 'schema applied');
  }

  // ----------------------------------------------------------------- auth
  console.log('\n2. auth gate rejects anonymous reads');
  {
    for (const p of ['/api/cards', '/api/decks', '/api/settings', '/api/tracks']) {
      const r = await call(p);
      check(r.status === 401, `${p} → 401 without a session`, `got ${r.status}`);
    }
  }

  console.log('\n3. bootstrap');
  {
    // A wrong token must be refused.
    const bad = await call('/api/auth-bootstrap', {
      method: 'POST',
      headers: { 'x-setup-token': 'definitely-wrong' },
      body: { passcode: TEST_PASSCODE },
    });
    check(bad.status === 403, 'wrong setup token → 403', `got ${bad.status}`);

    const r = await call('/api/auth-bootstrap', {
      method: 'POST',
      headers: { 'x-setup-token': SETUP_TOKEN },
      body: { passcode: TEST_PASSCODE, anchor_date: '2024-02-14' },
    });
    // 201 on first run, 409 if it was already bootstrapped.
    check(
      r.status === 201 || r.status === 409,
      'bootstrap succeeds or is already done',
      `got ${r.status}: ${r.text.slice(0, 160)}`,
    );
    if (r.status === 201) ok('passcode set, and a session was issued');
  }

  console.log('\n4. login');
  {
    cookie = '';
    const wrong = await call('/api/auth', { method: 'POST', body: { passcode: 'nope-nope' } });
    check(wrong.status === 401, 'wrong passcode → 401', `got ${wrong.status}`);
    check(
      !/not set up|not_initialised/i.test(wrong.text),
      'error does not leak setup state',
    );

    const right = await call('/api/auth', { method: 'POST', body: { passcode: TEST_PASSCODE } });
    check(right.status === 200, 'correct passcode → 200', `got ${right.status}: ${right.text.slice(0, 160)}`);
    check(cookie.length > 20, 'session cookie issued');

    const me = await call('/api/auth');
    check(me.json?.data?.authenticated === true, 'session reports authenticated');
  }

  // ---------------------------------------------------------------- decks
  console.log('\n5. decks');
  let deckId = null;
  {
    const all = await call('/api/decks');
    check(all.status === 200, 'list decks → 200');
    check(
      ['sorry', 'appreciation', 'love', 'comfort'].every((c) => Array.isArray(all.json?.data?.[c])),
      'all four categories present',
    );
    check(all.json.data.sorry.length === 3, 'seeded sorry cards present');

    const created = await call('/api/decks', {
      method: 'POST',
      body: { category: 'love', title: 'API test card', content: 'temporary' },
    });
    check(created.status === 201, 'create → 201', `got ${created.status}: ${created.text.slice(0, 160)}`);
    deckId = created.json?.data?.id ?? null;

    const badCat = await call('/api/decks', {
      method: 'POST',
      body: { category: 'evil', title: 'x', content: 'y' },
    });
    check(badCat.status === 422, 'invalid category → 422', `got ${badCat.status}`);

    const shortTitle = await call('/api/decks', {
      method: 'POST',
      body: { category: 'love', title: '', content: 'y' },
    });
    check(shortTitle.status === 422, 'empty title → 422', `got ${shortTitle.status}`);

    const patched = await call('/api/decks', {
      method: 'PATCH',
      body: { id: deckId, title: 'API test card (edited)' },
    });
    check(patched.json?.data?.title === 'API test card (edited)', 'patch updates one field');

    if (deckId) {
      const del = await call('/api/decks', { method: 'DELETE', body: { id: deckId } });
      check(del.status === 200, 'delete → 200', `got ${del.status}`);
    }
  }

  // ------------------------------------------------------------- calendar
  console.log('\n6. calendar');
  let eventId = null;
  {
    const created = await call('/api/calendar', {
      method: 'POST',
      body: { event_date: '2024-06-15', title: 'API test event', icon_type: 'heart', description: 'temp' },
    });
    check(created.status === 201, 'create → 201', `got ${created.status}: ${created.text.slice(0, 200)}`);
    eventId = created.json?.data?.id ?? null;

    const badIcon = await call('/api/calendar', {
      method: 'POST',
      body: { event_date: '2024-06-15', title: 'x', icon_type: 'not-a-real-icon' },
    });
    check(badIcon.status === 422, 'invalid icon_type → 422', `got ${badIcon.status}`);

    const badDate = await call('/api/calendar', {
      method: 'POST',
      body: { event_date: '2024-02-31', title: 'x', icon_type: 'heart' },
    });
    check(badDate.status === 422, 'impossible date 2024-02-31 → 422', `got ${badDate.status}`);

    const month = await call('/api/calendar?from=2024-06-01&to=2024-06-30');
    check(month.status === 200, 'range query → 200');
    check(
      month.json?.data?.events?.some((e) => e.title === 'API test event'),
      'event appears in its range',
    );

    const reversed = await call('/api/calendar?from=2024-06-30&to=2024-06-01');
    check(reversed.status === 200, 'reversed range is normalised → 200', `got ${reversed.status}`);

    const tooWide = await call('/api/calendar?from=2000-01-01&to=2030-01-01');
    check(tooWide.status === 400, 'absurd range → 400', `got ${tooWide.status}`);

    if (eventId) {
      await call('/api/calendar', { method: 'DELETE', body: { id: eventId } });
    }
  }

  // --------------------------------------------------------------- upload
  console.log('\n7. upload (raw body, not multipart)');
  let uploadedPath = null;
  let uploadedUrl = null;
  {
    const jpeg = makeJpeg();
    const r = await call('/api/upload?kind=photo&variant=card', { method: 'POST', raw: jpeg });
    check(r.status === 201, 'upload JPEG → 201', `got ${r.status}: ${r.text.slice(0, 200)}`);
    check(r.json?.data?.mime === 'image/jpeg', 'MIME sniffed from bytes, not the client');
    uploadedPath = r.json?.data?.path ?? null;
    uploadedUrl = r.json?.data?.url ?? null;
    check(/photos\/[a-f0-9]{32}\.jpg$/.test(uploadedPath ?? ''), 'path is random hex', uploadedPath);

    if (uploadedUrl) {
      const head = await fetch(uploadedUrl, { method: 'GET' });
      check(head.status === 200, 'uploaded object is publicly readable', `got ${head.status}`);
    }

    // A non-image must be refused.
    const text = await call('/api/upload?kind=photo', { method: 'POST', raw: Buffer.from('not an image') });
    check(text.status === 415, 'non-image rejected → 415', `got ${text.status}`);

    // Traversal in the delete path must be refused.
    const trav = await call('/api/upload', { method: 'DELETE', body: { path: '../../etc/passwd' } });
    check(trav.status === 422, 'path traversal refused → 422', `got ${trav.status}`);

    const trav2 = await call('/api/upload', { method: 'DELETE', body: { path: 'photos/../../x.jpg' } });
    check(trav2.status === 422, 'embedded traversal refused → 422', `got ${trav2.status}`);

    if (uploadedPath) {
      const del = await call('/api/upload', { method: 'DELETE', body: { path: uploadedPath } });
      check(del.status === 200, 'delete object → 200', `got ${del.status}`);
    }
  }

  // ---------------------------------------------------------------- cards
  console.log('\n8. cards');
  {
    const created = await call('/api/cards', {
      method: 'POST',
      body: {
        photo_url: uploadedUrl ?? 'https://example.com/x.jpg',
        title: 'API test memory',
        letter_text: 'temporary',
        memory_date: '2024-02-14',
      },
    });
    check(created.status === 201, 'create → 201', `got ${created.status}: ${created.text.slice(0, 200)}`);
    const cardId = created.json?.data?.id ?? null;

    const list = await call('/api/cards');
    check(Array.isArray(list.json?.data), 'list returns an array');

    const dated = await call('/api/cards?memory_date=2024-02-14');
    check(dated.status === 200, 'memory_date filter → 200');

    const badDate = await call('/api/cards?memory_date=2024-13-01');
    check(badDate.status === 422, 'invalid memory_date → 422', `got ${badDate.status}`);

    if (cardId) {
      await call('/api/cards', { method: 'DELETE', body: { id: cardId } });
    }
  }

  // -------------------------------------------------------------- tracks
  console.log('\n9. tracks');
  let trackId = null;
  {
    const yt = await call('/api/tracks', {
      method: 'POST',
      body: { title: 'YT', source_type: 'youtube', source: 'https://youtu.be/jNQXAC9IVRW?t=42' },
    });
    check(yt.status === 201, 'youtube link accepted → 201', `got ${yt.status}: ${yt.text.slice(0, 200)}`);
    check(yt.json?.data?.source === 'jNQXAC9IVRW', 'normalised to the bare video id', yt.json?.data?.source);
    trackId = yt.json?.data?.id ?? null;

    const wrongType = await call('/api/tracks', {
      method: 'POST',
      body: { title: 'x', source_type: 'youtube', source: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' },
    });
    check(wrongType.status === 422, 'spotify link rejected as youtube → 422', `got ${wrongType.status}`);

    const spotify = await call('/api/tracks', {
      method: 'POST',
      body: { title: 'SP', source_type: 'spotify', source: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc' },
    });
    check(spotify.status === 201, 'spotify link accepted → 201', `got ${spotify.status}`);
    check(
      spotify.json?.data?.source === 'track/4cOdK2wGLETKBW3PvgPWqT',
      'spotify normalised to kind/id',
      spotify.json?.data?.source,
    );
    if (spotify.json?.data?.id) {
      await call('/api/tracks', { method: 'DELETE', body: { id: spotify.json.data.id } });
    }

    const badYt = await call('/api/tracks', {
      method: 'POST',
      body: { title: 'x', source_type: 'youtube', source: 'https://vimeo.com/12345' },
    });
    check(badYt.status === 422, 'non-youtube url → 422', `got ${badYt.status}`);

    if (trackId) {
      await call('/api/tracks', { method: 'DELETE', body: { id: trackId } });
    }
  }

  // ------------------------------------------------------------ settings
  console.log('\n10. settings');
  {
    const read = await call('/api/settings');
    check(read.status === 200, 'read → 200');
    check(
      read.json?.data && !('passcode_hash' in read.json.data),
      'passcode_hash is never exposed',
      Object.keys(read.json?.data ?? {}).join(','),
    );

    const patched = await call('/api/settings', {
      method: 'PATCH',
      body: { site_title: 'Our Little World' },
    });
    check(patched.status === 200, 'patch → 200', `got ${patched.status}`);

    const sneaky = await call('/api/settings', {
      method: 'PATCH',
      body: { passcode_hash: 'hijacked' },
    });
    check(sneaky.status === 422, 'writing passcode_hash → 422', `got ${sneaky.status}`);

    const badAnchor = await call('/api/settings', {
      method: 'PATCH',
      body: { anchor_date: '2024-02-31' },
    });
    check(badAnchor.status === 422, 'impossible anchor_date → 422', `got ${badAnchor.status}`);

    const wrongPass = await call('/api/settings', {
      method: 'POST',
      body: { current_passcode: 'wrong', new_passcode: 'newpass123' },
    });
    check(wrongPass.status === 401, 'passcode change with wrong current → 401', `got ${wrongPass.status}`);
  }

  // ------------------------------------------------------------- logout
  console.log('\n11. logout');
  {
    const out = await call('/api/auth-logout', { method: 'POST' });
    check(out.status === 200, 'logout → 200', `got ${out.status}`);

    cookie = '';
    const after = await call('/api/cards');
    check(after.status === 401, 'reads blocked again after logout', `got ${after.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});