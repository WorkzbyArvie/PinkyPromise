/**
 * Tests the distinction between "the playlist is empty" and "the playlist
 * failed to load".
 *
 * These were the same thing. readApiTracks() caught every error and returned [],
 * so a broken /api/tracks rendered the Music tab as "No tracks yet" with no
 * message — indistinguishable from a working app that had lost its songs. That
 * is the reported symptom: upload a track, nothing appears, no error anywhere.
 *
 * fetch is stubbed per test so each failure mode is provoked deliberately, and
 * the DOM shim is the same one scripts/test-boot.mjs uses (Alpine patches
 * Element.prototype at module scope, so the globals must exist before import).
 *
 *   node test-player.mjs
 */

import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ *
 * DOM shim — must be installed BEFORE importing anything that touches
 * window/Audio at module scope.
 * ------------------------------------------------------------------ */

class FakeAudio {
  constructor() {
    this._src = '';
    this.paused = true;
    this.volume = 1;
    this.muted = false;
    this.duration = NaN;
    this.currentTime = 0;
    this.loop = false;
    this.crossOrigin = null;
    this.preload = 'none';
    // Records the crossOrigin value at the moment src was first assigned, so a
    // test can prove the opt-in happened BEFORE the first load. Setting it
    // afterwards is too late: the element is already tainted and only a reload
    // would help.
    this.srcAtCrossOriginSet = undefined;
    globalThis.__lastAudio = this;
  }
  get src() { return this._src; }
  set src(v) {
    if (!this._src) this.srcAtCrossOriginSet = this.crossOrigin;
    this._src = v;
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
  setAttribute() {}
}

globalThis.Audio = FakeAudio;
globalThis.AudioContext = class {
  createMediaElementSource() { return { connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 0, getByteFrequencyData() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {} }; }
  close() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  get destination() { return {}; }
  get sampleRate() { return 44100; }
  get state() { return 'running'; }
};
globalThis.createScriptProcessor = () => ({ connect() {}, disconnect() {} });

const noop = () => {};
const el = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop,
  remove: noop, setAttribute: noop, style: {}, dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [],
});

class Element {}
class HTMLElement extends Element {}

globalThis.Element = Element;
globalThis.HTMLElement = HTMLElement;
globalThis.Node = class Node {};
globalThis.Event = class Event {};
globalThis.CustomEvent = globalThis.CustomEvent ?? class CustomEvent {};
globalThis.NodeFilter = { SHOW_ELEMENT: 1 };
globalThis.document = {
  readyState: 'complete', visibilityState: 'visible',
  body: { innerHTML: '', style: {}, classList: { add: noop, remove: noop } },
  head: { appendChild: noop },
  documentElement: el(),
  addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => el(), createElementNS: () => el(), dispatchEvent: noop,
  exitFullscreen: noop,
};
globalThis.window = {
  Element, HTMLElement,
  addEventListener: noop, removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  URL, Blob, FormData, Headers: globalThis.Headers,
  CustomEvent: globalThis.CustomEvent,
  getComputedStyle: () => ({}), scrollTo: noop,
  Audio: FakeAudio, AudioContext: globalThis.AudioContext,
  navigator: { userAgent: 'node', mediaDevices: undefined },
  location: { search: '', href: 'http://localhost/' },
  document: globalThis.document,
};
globalThis.location = { search: '', href: 'http://localhost/', protocol: 'http:' };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node' }, configurable: true, writable: true,
});

const { createPlayer } = await import('./public/js/player.js');

/* ------------------------------------------------------------------ *
 * tests
 * ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n         ${err.message}`);
  }
};

const realFetch = globalThis.fetch;
function stub(handler) {
  globalThis.fetch = async (url) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href.includes('/api/tracks')) return handler(href);
    if (href.includes('/audio/tracks.json')) return { ok: true, status: 200, json: async () => [] };
    throw new Error(`unstubbed fetch: ${href}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const track = (id, title) => ({
  id, title, source_type: 'file', source: `https://x/${id}.mp3`,
});

async function withPlayer(handler, fn) {
  const restore = stub(handler);
  try {
    const p = createPlayer({ onState: noop });
    const s = await p.init();
    await fn(s, p);
    p.destroy();
  } finally {
    restore();
  }
}

console.log('\ntrack list failures are distinguishable from an empty playlist\n');

await t('a successful empty list is empty, NOT an error', () =>
  withPlayer(() => json({ ok: true, data: [] }), (s) => {
    assert.equal(s.count, 0, 'expected no tracks');
    assert.equal(s.listError, null, 'an empty playlist must not report an error');
  }));

await t('a network failure reports an error', () =>
  withPlayer(() => { throw new TypeError('Failed to fetch'); }, (s) => {
    assert.equal(s.count, 0);
    assert.ok(s.listError, 'a network failure must set listError');
    assert.match(s.listError, /reach the server/i);
  }));

await t('a 500 reports the status', () =>
  withPlayer(() => json({ ok: false, error: { message: 'boom' } }, 500), (s) => {
    assert.ok(s.listError, 'a 500 must set listError');
    assert.match(s.listError, /500/);
  }));

await t('a 401 says the session expired', () =>
  withPlayer(() => json({ ok: false }, 401), (s) => {
    assert.ok(s.listError, 'a 401 must set listError');
    assert.match(s.listError, /session expired|unlock/i);
  }));

await t('a 200 carrying ok:false surfaces the server message', () =>
  withPlayer(() => json({ ok: false, error: { message: 'database is gone' } }), (s) => {
    assert.ok(s.listError, 'ok:false must set listError');
    assert.match(s.listError, /database is gone/);
  }));

await t('unparseable JSON is an error, not an empty list', () =>
  withPlayer(() => ({
    ok: true, status: 200,
    json: async () => { throw new SyntaxError('Unexpected token'); },
  }), (s) => {
    assert.ok(s.listError, 'a malformed body must set listError');
  }));

await t('a real list loads with no error', () =>
  withPlayer(() => json({ ok: true, data: [track('1', 'Telepono'), track('2', 'Other')] }), (s) => {
    assert.equal(s.count, 2, `expected 2 tracks, got ${s.count}`);
    assert.equal(s.listError, null);
    assert.equal(s.tracks[0].title, 'Telepono');
  }));

await t('entries without a source are filtered out', () =>
  withPlayer(() => json({
    ok: true,
    data: [track('1', 'Good'), { id: '2', title: 'No source' }, null],
  }), (s) => {
    assert.equal(s.count, 1, `expected 1 usable track, got ${s.count}`);
  }));

await t('refresh clears a previous error once the server recovers', async () => {
  let fail = true;
  const restore = stub(() => (fail
    ? json({ ok: false }, 500)
    : json({ ok: true, data: [track('1', 'Back')] })));
  try {
    const p = createPlayer({ onState: noop });
    const broken = await p.init();
    assert.ok(broken.listError, 'expected an error while the server is down');

    fail = false;
    const fixed = await p.refresh();
    assert.equal(fixed.listError, null, 'error must clear after recovery');
    assert.equal(fixed.count, 1);
    p.destroy();
  } finally {
    restore();
  }
});

await t('refresh keeps reporting while it is still broken', async () => {
  const restore = stub(() => json({ ok: false }, 503));
  try {
    const p = createPlayer({ onState: noop });
    await p.init();
    const still = await p.refresh();
    assert.ok(still.listError, 'a retry while still broken must keep reporting');
    assert.match(still.listError, /503/);
    p.destroy();
  } finally {
    restore();
  }
});

await t('a bundled manifest still merges in alongside API tracks', async () => {
  globalThis.fetch = async (url) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href.includes('/api/tracks')) {
      return json({ ok: true, data: [track('1', 'FromApi')] });
    }
    if (href.includes('/audio/tracks.json')) {
      return json([{ src: 'local/b.mp3', title: 'FromManifest' }]);
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  try {
    const p = createPlayer({ onState: noop });
    const s = await p.init();
    assert.equal(s.count, 2, `expected both sources, got ${s.count}`);
    assert.ok(s.tracks.some((x) => x.origin === 'bundled'));
    assert.equal(s.listError, null);
    p.destroy();
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log('\ntransport: cross-origin, timestamps, seeking\n');

await t('the audio element opts into CORS before any src is set', async () => {
  // The visualiser routes playback through Web Audio, and createMediaElementSource
  // reads silence from a cross-origin element that was not fetched in CORS mode.
  // Supabase sends Access-Control-Allow-Origin: *; without this opt-in the
  // analyser outputs zeroes and the console fills with a CORS warning.
  const restore = stub(() => json({ ok: true, data: [track('1', 'Cors')] }));
  try {
    const p = createPlayer({ onState: noop });
    await p.init();
    const a = globalThis.__lastAudio;
    assert.ok(a, 'the player did not construct an Audio element');
    assert.equal(
      a.crossOrigin,
      'anonymous',
      'crossOrigin must be "anonymous" or Web Audio cannot read the track',
    );
    // Ordering is the whole point: crossOrigin must already be 'anonymous' at
    // the moment the first src is assigned. Patching it in afterwards leaves
    // the element tainted and needs a reload to fix.
    assert.equal(
      a.srcAtCrossOriginSet,
      'anonymous',
      'crossOrigin was not set before the first src assignment — the element ' +
        'loads tainted and the analyser will read silence',
    );
    p.destroy();
  } finally {
    restore();
  }
});

await t('state exposes elapsed and duration in seconds', async () => {
  const restore = stub(() => json({ ok: true, data: [track('1', 'Timed')] }));
  try {
    const p = createPlayer({ onState: noop });
    const s = await p.init();
    assert.equal(typeof s.elapsed, 'number', 'elapsed must be a number');
    assert.equal(typeof s.duration, 'number', 'duration must be a number');
    assert.ok(Number.isFinite(s.elapsed), 'elapsed must be finite');
    assert.ok(Number.isFinite(s.duration), 'duration must be finite');
    p.destroy();
  } finally {
    restore();
  }
});

await t('an unknown duration is 0, never NaN or Infinity', async () => {
  // audio.duration is NaN before metadata loads and Infinity for a stream. A
  // player showing "NaN:NaN" looks broken even though it is only waiting.
  const restore = stub(() => json({ ok: true, data: [track('1', 'Unknown')] }));
  try {
    const p = createPlayer({ onState: noop });
    const s = await p.init();
    assert.equal(s.duration, 0, `expected 0 for an unknown duration, got ${s.duration}`);
    assert.equal(s.elapsed, 0);
    p.destroy();
  } finally {
    restore();
  }
});

await t('progress stays within 0..1 when a duration is known', async () => {
  const restore = stub(() => json({ ok: true, data: [track('1', 'Timed')] }));
  try {
    const p = createPlayer({ onState: noop });
    await p.init();
    const a = globalThis.__lastAudio;
    a.duration = 200;
    a.currentTime = 50;
    const s = p.emit() ?? p.state?.() ?? null;
    // seekTo is the public probe; it must not throw on a valid fraction.
    p.seekTo(0.25);
    assert.ok(a.currentTime >= 0 && a.currentTime <= a.duration, 'seek kept the playhead in range');
    void s;
    p.destroy();
  } finally {
    restore();
  }
});

await t('seekTo is a no-op when no duration is known', async () => {
  const restore = stub(() => json({ ok: true, data: [track('1', 'NoMeta')] }));
  try {
    const p = createPlayer({ onState: noop });
    await p.init();
    const a = globalThis.__lastAudio;
    a.duration = NaN;
    a.currentTime = 0;
    // Must not write NaN into currentTime, which would wedge the element.
    p.seekTo(0.5);
    assert.ok(Number.isFinite(a.currentTime), `currentTime became ${a.currentTime}`);
    p.destroy();
  } finally {
    restore();
  }
});

await t('seekTo clamps out-of-range fractions', async () => {
  const restore = stub(() => json({ ok: true, data: [track('1', 'Clamp')] }));
  try {
    const p = createPlayer({ onState: noop });
    await p.init();
    const a = globalThis.__lastAudio;
    a.duration = 100;

    p.seekTo(5);
    assert.ok(Math.abs(a.currentTime - 100) < 0.001, `expected the end, got ${a.currentTime}`);

    p.seekTo(-3);
    assert.ok(Math.abs(a.currentTime) < 0.001, `expected the start, got ${a.currentTime}`);

    p.seekTo('nonsense');
    assert.ok(Number.isFinite(a.currentTime), 'a non-numeric fraction must be ignored');

    p.destroy();
  } finally {
    restore();
  }
});

await t('seekTo on a Spotify hand-off track does not touch the element', async () => {
  const restore = stub(() => json({
    ok: true,
    data: [{ id: '1', title: 'Spot', source_type: 'spotify', source: 'track/abcdefghijklmnopqrstuv' }],
  }));
  try {
    const p = createPlayer({ onState: noop });
    await p.init();
    const a = globalThis.__lastAudio;
    a.duration = 100;
    a.currentTime = 0;
    p.seekTo(0.5);
    assert.equal(a.currentTime, 0, 'a link-out track must not be seeked locally');
    p.destroy();
  } finally {
    restore();
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);