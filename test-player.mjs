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
    this.src = '';
    this.paused = true;
    this.volume = 1;
    this.muted = false;
    this.duration = NaN;
    this.currentTime = 0;
    this.loop = false;
    this.crossOrigin = null;
    this.preload = 'none';
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);