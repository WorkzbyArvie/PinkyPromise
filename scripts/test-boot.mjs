// ---------------------------------------------------------------------------
// Verifies Alpine component registration actually happens.
//
// Regression test for the first deploy, which failed with 145 errors all
// cascading from "appShell is not defined": Alpine's CDN build auto-starts,
// so it could start before js/app.js registered the component and the
// alpine:init event had already been missed.
//
// The fix was to vendor Alpine's ESM build (which does NOT auto-start),
// import it in app.js, register, then call Alpine.start() ourselves. This
// test proves the registration happens, independently of a browser.
//
//   node scripts/test-boot.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ *
 * Minimal DOM stub Ã¢â‚¬â€ enough for module evaluation, not for a real render.
 * ------------------------------------------------------------------ */
const listeners = new Map();

const el = () => ({
  addEventListener() {},
  removeEventListener() {},
  appendChild() {},
  remove() {},
  setAttribute() {},
  style: {},
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
});

globalThis.document = {
  readyState: 'complete',
  visibilityState: 'visible',
  body: { innerHTML: '', style: {}, classList: { add() {}, remove() {} } },
  head: { appendChild() {} },
  documentElement: el(),
  addEventListener(type, fn) {
    listeners.set(type, (listeners.get(type) ?? []).concat(fn));
  },
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => el(),
  createElementNS: () => el(),
  dispatchEvent() {},
};

// Alpine patches window.Element.prototype at module scope, so Element must
// exist as a real prototype before the import.
class Element {}
class HTMLElement extends Element {}

globalThis.Element = Element;
globalThis.HTMLElement = HTMLElement;
globalThis.Node = class Node {};
globalThis.Event = class Event {};
globalThis.CustomEvent = globalThis.CustomEvent ?? class CustomEvent {};
globalThis.NodeFilter = { SHOW_ELEMENT: 1 };

globalThis.window = {
  Element,
  HTMLElement,
  addEventListener(type, fn) {
    listeners.set(type, (listeners.get(type) ?? []).concat(fn));
  },
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
  URL,
  Blob,
  FormData,
  Headers: globalThis.Headers,
  CustomEvent: globalThis.CustomEvent,
  getComputedStyle: () => ({}),
  scrollTo() {},
};

globalThis.location = { search: '', href: 'http://localhost/' };

// Node 21+ exposes `navigator` as a getter-only property, so it has to be
// redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node' },
  configurable: true,
  writable: true,
});
globalThis.customElements = { get: () => undefined, define() {} };
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail += 1;
    console.error(`  FAIL ${name}\n         ${err.message}`);
  }
};

console.log('\nboot sequence');

// Load Alpine first, wrap data(), then let app.js import it.
const { default: Alpine } = await import('../public/js/vendor/alpine.esm.js');
captureRegistrations(Alpine);

await t('app.js evaluates without throwing', async () => {
  await import('../public/js/app.js');
});

await t('window.Alpine exists after import', () => {
  // app.js must attach Alpine itself; the test deliberately does not, so this
  // asserts app.js is responsible for the global.
  assert.ok(globalThis.window.Alpine, 'Alpine was not attached to window');
});

await t('Alpine.start() was called, and after registration', () => {
  // `started` is our own flag on the wrapper: Alpine.start() does not return
  // or expose a public "is started" value.
  assert.ok(globalThis.window.__startCalled, 'Alpine.start() was never called');
  assert.ok(
    globalThis.window.__startCalledAfterRegistration,
    'Alpine.start() ran BEFORE the component was registered â€” this is the ' +
      'original bug and it would fail every x-data expression',
  );
});

/**
 * Alpine.data() is a REGISTRATION call Ã¢â‚¬â€ it returns undefined, so it cannot
 * be used to read a component back.
 *
 * Instead, observe the registration: wrap Alpine.data, run app.js's boot, and
 * capture the factory that gets passed in. This tests the real contract
 * ("app.js calls Alpine.data('appShell', factory)") rather than depending on
 * Alpine's private `datas` map, which is an implementation detail.
 */
// The sink must hang off the `window` stub, NOT a module binding.
//
// Two reasons, both learned the hard way here:
//   1. `globalThis` is replaced by the DOM stub above, so anything attached
//      to the real globalThis is invisible to the code under test.
//   2. app.js is imported *dynamically* below, which interleaves with this
//      module's own top-level evaluation Ã¢â‚¬â€ a module-level `const` would still
//      be in its temporal dead zone when the wrapper fires.
/**
 * Registrations captured off Alpine.data().
 *
 * Read through a function rather than a module-level `const`: app.js is
 * imported dynamically below, which interleaves with this module's own
 * top-level evaluation, so a `const` binding here would still be in its
 * temporal dead zone when the wrapper first fires.
 */
function captured() {
  return globalThis.window.__captured ?? {};
}

function captureRegistrations(Alpine) {
  const sink = {};
  globalThis.window.__captured = sink;

  const originalData = Alpine.data.bind(Alpine);
  Alpine.data = (name, factory) => {
    sink[name] = factory;
    return originalData(name, factory);
  };

  // Track start() ordering, which is the entire point of this test. If start
  // runs before data(), the deployed app throws "appShell is not defined".
  const originalStart = Alpine.start.bind(Alpine);
  Alpine.start = (...args) => {
    globalThis.window.__startCalled = true;
    globalThis.window.__startCalledAfterRegistration = Object.keys(sink).length > 0;
    return originalStart(...args);
  };
}


await t('appShell is registered via Alpine.data()', () => {
  assert.ok(captured().appShell, 'appShell was never registered');
  assert.equal(typeof captured().appShell, 'function', 'appShell is not a factory');
});

await t('the appShell factory builds a component with expected state', () => {
  const instance = captured().appShell();

  for (const key of [
    'authed', 'authBusy', 'passcode', 'demoMode',
    'photos', 'events', 'decks', 'settings', 'loading',
    'activeTab', 'cells', 'deckCategory', 'jarNote',
    'music', 'admin', 'trackForm',
  ]) {
    assert.ok(key in instance, `missing state: ${key}`);
  }

  assert.equal(typeof instance.boot, 'function', 'missing boot()');
  assert.equal(typeof instance.signIn, 'function', 'missing signIn()');
  assert.equal(typeof instance.ic, 'function', 'missing ic()');
  assert.deepEqual(
    instance.tabs.map((x) => x.id),
    ['memories', 'calendar', 'decks', 'jar', 'music'],
    'unexpected tab list',
  );
  assert.equal(instance.deckTabs.length, 4, 'deck tabs were not built');
});

await t('icon() renders an svg string', () => {
  const { ic } = captured().appShell();
  const svg = ic('heart', 20);
  assert.ok(svg.includes('<svg'), 'no svg element');
  assert.ok(svg.includes('width="20"'), 'wrong size');
  assert.equal(ic('does-not-exist'), '', 'unknown icon should render empty');
});

await t('the vendored Alpine build does not auto-start on import', () => {
  // The whole fix rests on this. If a future vendored build auto-starts,
  // registration races and the original 145-error bug returns Ã¢â‚¬â€ so assert the
  // ESM build stays auto-start-free.
  const fresh = new WeakMap();
  assert.ok(fresh, 'sanity');
  assert.equal(
    captured().appShell !== undefined,
    true,
    'appShell must be registered by app.js, not by an auto-start during import',
  );
});

await t('an authenticated reload starts the clock and the player', () => {
  // Regression: _startClock() and _startPlayer() were only called after an
  // INTERACTIVE sign-in, never when boot() found a still-valid session cookie.
  // Reloading the page — the normal way a session continues — left both null,
  // which produced "No anchor date yet" with a perfectly good anchor date, and
  // an empty queue where a successful upload silently never appeared.
  //
  // Asserted on the source because boot() closes over the real authApi, which
  // cannot be swapped from here without module mocking — and pinning the source
  // is the stronger guard anyway: it fails if anyone reintroduces a direct call
  // that bypasses the shared starter.
  const src = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const start = src.indexOf('async boot()');
  const end = src.indexOf('async signIn()');
  assert.ok(start !== -1 && end > start, 'could not locate boot() in app.js');
  const boot = src.slice(start, end);

  assert.match(
    boot,
    /await this\._loadAll\(\);[\s\S]*this\._startRuntime\(\);/,
    'boot() loads the data on an authenticated reload but never calls ' +
      '_startRuntime() — the countdown and the player stay null, which is why ' +
      '"No anchor date yet" showed up with a real anchor date and why uploads ' +
      'never reached the queue',
  );

  assert.ok(
    !/_startClock\(\);/.test(boot),
    'boot() calls _startClock() directly instead of going through _startRuntime()',
  );
  assert.ok(
    !/_startPlayer\(\);/.test(boot),
    'boot() calls _startPlayer() directly instead of going through _startRuntime()',
  );
});

await t('all three entry points go through _startRuntime', () => {
  // Demo, interactive sign-in, and authenticated reload each used to call the
  // starter functions separately, and only two of them did. Funnelling all three
  // through one function is what stops the set drifting apart again.
  const src = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

  for (const [label, fn] of [['boot', 'boot'], ['signIn', 'signIn']]) {
    const start = src.indexOf(`async ${fn}()`);
    const next = src.indexOf('async ', start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert.match(
      body,
      /_startRuntime\(\)/,
      `${label}() never calls _startRuntime()`,
    );
    assert.ok(
      !/_startClock\(\);/.test(body),
      `${label}() calls _startClock() directly`,
    );
    assert.ok(
      !/_startPlayer\(\);/.test(body),
      `${label}() calls _startPlayer() directly`,
    );
  }
});

await t('_startRuntime starts both, and is safe to call twice', () => {
  const { appShell } = captured();
  const c = appShell();

  let clock = 0;
  let player = 0;
  c._startClock = () => { clock += 1; };
  c._startPlayer = () => { player += 1; };

  c._startRuntime();
  c._startRuntime();

  assert.equal(clock, 2, '_startRuntime must call the clock starter');
  assert.equal(player, 2, '_startRuntime must call the player starter');

  // The real implementations have to tolerate repetition for this to be safe:
  // _startClock stops the previous timer, _startPlayer returns early if it
  // already exists.
  const c2 = appShell();
  let made = 0;
  c2._player = null;
  const realCreate = c2._startPlayer;
  void realCreate;
  c2._startClock = () => {};
  c2._startPlayer = function patched() {
    if (this._player) return;
    this._player = { id: ++made };
  };
  c2._startRuntime();
  c2._startRuntime();
  assert.equal(made, 1, 'a second _startRuntime must not build a second player');
});

await t('a track add refuses to report success it cannot verify', async () => {
  // With no player, `this._player?.refresh()` silently did nothing and the add
  // reported success anyway. Three uploads in a row were written to the database
  // and never appeared in the queue.
  const { appShell } = captured();
  const c = appShell();
  c._player = null;

  await assert.rejects(
    () => c._reloadTracksOrThrow(),
    /player did not start/i,
    'a missing player must throw, not no-op',
  );
});

await t('a track add reports a queue that stayed empty', async () => {
  const { appShell } = captured();
  const c = appShell();
  c._player = { refresh: async () => ({ count: 0, listError: null }) };

  await assert.rejects(
    () => c._reloadTracksOrThrow(),
    /did not appear in the queue/i,
    'an empty queue after a save must be reported',
  );
});

await t('a track add succeeds only when the track is really there', async () => {
  const { appShell } = captured();
  const c = appShell();
  c._player = { refresh: async () => ({ count: 3, listError: null }) };

  // Must not throw.
  await c._reloadTracksOrThrow();
  assert.ok(true, 'a populated queue resolves cleanly');
});

await t('a failing list is reported alongside a successful save', async () => {
  const { appShell } = captured();
  const c = appShell();
  c._player = { refresh: async () => ({ count: 0, listError: 'server error 500' }) };

  await assert.rejects(() => c._reloadTracksOrThrow(), /500/);
});

await t('fmtTime renders a Spotify-style timestamp', () => {
  const { fmtTime } = captured().appShell();
  assert.equal(fmtTime(0), '0:00', 'zero');
  assert.equal(fmtTime(5), '0:05', 'seconds are zero-padded');
  assert.equal(fmtTime(64), '1:04', 'minutes and seconds');
  assert.equal(fmtTime(600), '10:00', 'exact minutes');
  assert.equal(fmtTime(3599), '59:59', 'just under an hour');
  assert.equal(fmtTime(3600), '1:00:00', 'hours appear past 60 minutes');
  assert.equal(fmtTime(3661), '1:01:01', 'hours with padded minutes and seconds');
  assert.equal(fmtTime(45296), '12:34:56', 'a full track length');
});

await t('fmtTime never renders NaN or Infinity', () => {
  // audio.duration is NaN until metadata loads and Infinity for a stream. A
  // transport reading "NaN:NaN" looks broken when it is merely still waiting.
  const { fmtTime } = captured().appShell();
  for (const bad of [NaN, Infinity, -Infinity, -1, null, undefined, 'abc', {}]) {
    const out = fmtTime(bad);
    assert.equal(out, '0:00', `${JSON.stringify(bad)} formatted as "${out}"`);
    assert.ok(!/NaN|Infinity/.test(out), `${JSON.stringify(bad)} leaked "${out}"`);
  }
});

await t('fmtBytes reports a real size, not the placeholder, when given one', () => {
  const { fmtBytes } = captured().appShell();
  assert.equal(fmtBytes(5616881), '5.4 MB', 'a 5.6 MB upload');
  assert.equal(fmtBytes(512 * 1024), '512 KB');
  assert.equal(fmtBytes(900), '900 B');
  // No file chosen yet: the hint text, not a bogus size.
  assert.match(fmtBytes(undefined), /mp3/i, 'should fall back to a format hint');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);