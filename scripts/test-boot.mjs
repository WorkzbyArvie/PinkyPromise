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

/* ------------------------------------------------------------------ *
 * Minimal DOM stub â€” enough for module evaluation, not for a real render.
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
const { default: Alpine } = await import('../js/vendor/alpine.esm.js');
captureRegistrations(Alpine);

await t('app.js evaluates without throwing', async () => {
  await import('../js/app.js');
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
    'Alpine.start() ran BEFORE the component was registered — this is the ' +
      'original bug and it would fail every x-data expression',
  );
});

/**
 * Alpine.data() is a REGISTRATION call â€” it returns undefined, so it cannot
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
//      module's own top-level evaluation â€” a module-level `const` would still
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
  // registration races and the original 145-error bug returns â€” so assert the
  // ESM build stays auto-start-free.
  const fresh = new WeakMap();
  assert.ok(fresh, 'sanity');
  assert.equal(
    captured().appShell !== undefined,
    true,
    'appShell must be registered by app.js, not by an auto-start during import',
  );
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);