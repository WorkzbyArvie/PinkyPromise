/**
 * Validates vercel.json against the shape Vercel accepts.
 *
 * Added after a real failure: a "comment" key was left inside a headers[] entry
 * to explain a cache decision, and Vercel rejected the whole build with
 * "'headers[0]' should NOT have additional property 'comment'". vercel.json is
 * JSON, not JSONC — there is nowhere to put a comment inline, and an unknown key
 * anywhere in the file is a hard schema failure, not a warning.
 *
 * So this enumerates the properties each section actually permits. Anything else
 * fails here, in a second, instead of as an unexplained red build.
 *
 *   node scripts/test-vercel.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'vercel.json');

let pass = 0;
let fail = 0;

const check = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail += 1;
    console.error(`  FAIL ${name}\n         ${err.message}`);
  }
};

const section = (name) => {
  console.log(`\n${name}`);
};

// Documented Vercel build-config properties we might legitimately use. Anything
// outside this set is a typo or an attempt to inline a comment.
const ALLOWED_TOP = new Set([
  '$schema', 'builds', 'functions', 'routes', 'crons', 'headers',
  'redirects', 'cleanUrls', 'trailingSlash', 'outputDirectory',
  'installCommand', 'devCommand', 'buildCommand', 'framework', 'git',
  'github', 'ignoreCommand', 'regions', 'public', 'version',
]);

const ALLOWED_FUNCTION = new Set([
  'runtime', 'memory', 'maxDuration', 'entrypoint', 'environment', 'regions',
]);

const ALLOWED_HEADER_ENTRY = new Set(['source', 'headers', 'has', 'missing']);

const ALLOWED_HEADER_KEY = new Set(['key', 'value']);

const ALLOWED_CRONS = new Set(['path', 'schedule', 'headers']);

const ALLOWED_REDIRECT = new Set(['source', 'destination', 'permanent', 'statusCode']);

const ALLOWED_ROUTE = new Set(['src', 'dest', 'headers', 'methods', 'continue']);

console.log('\nvercel.json schema');

let config = {};

check('vercel.json exists', () => {
  assert.ok(existsSync(file), 'vercel.json not found');
});

check('parses as strict JSON', () => {
  const raw = readFileSync(file, 'utf8');
  config = JSON.parse(raw);
});

check('no unknown top-level properties', () => {
  const unknown = Object.keys(config).filter((k) => !ALLOWED_TOP.has(k));
  assert.deepEqual(
    unknown,
    [],
    `unsupported propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}. ` +
      'vercel.json is strict JSON — inline comments are not allowed and an ' +
      'unknown key fails the build.',
  );
});

section('functions');

check('every function entry uses only allowed properties', () => {
  const fns = config.functions ?? {};
  const problems = [];
  for (const [glob, spec] of Object.entries(fns)) {
    for (const key of Object.keys(spec)) {
      if (!ALLOWED_FUNCTION.has(key)) problems.push(`${glob} -> ${key}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

check('the PHP runtime is pinned', () => {
  const spec = Object.values(config.functions ?? {})[0];
  assert.ok(spec?.runtime, 'no runtime set');
  assert.match(spec.runtime, /^vercel-php@/, `runtime is "${spec.runtime}"`);
});

check('the functions glob covers every api/*.php endpoint', () => {
  const globs = Object.keys(config.functions ?? {});
  const endpoints = readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.php'));
  // The only meaningful glob is one that matches every endpoint.
  assert.ok(
    globs.includes('api/*.php'),
    `expected an "api/*.php" glob, found ${globs.join(', ')}`,
  );
  assert.ok(endpoints.length > 0, 'no endpoints found in api/');
});

section('headers');

check('every header entry uses only allowed properties', () => {
  const problems = [];
  for (const entry of config.headers ?? []) {
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_HEADER_ENTRY.has(key)) problems.push(`entry "${entry.source}" -> ${key}`);
    }
    for (const h of entry.headers ?? []) {
      for (const key of Object.keys(h)) {
        if (!ALLOWED_HEADER_KEY.has(key)) problems.push(`${entry.source} header -> ${key}`);
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    problems.join('; ') + ' — remove the key; vercel.json cannot carry inline comments.',
  );
});

check('every header has a source and at least one key/value pair', () => {
  for (const entry of config.headers ?? []) {
    assert.ok(entry.source, 'a headers[] entry has no source');
    assert.ok(Array.isArray(entry.headers) && entry.headers.length > 0, `${entry.source} has no headers`);
    for (const h of entry.headers) {
      assert.ok(h.key, `${entry.source} has a header with no key`);
      assert.equal(typeof h.value, 'string', `${entry.source} / ${h.key} value must be a string`);
    }
  }
});

check('static assets revalidate rather than being immutable', () => {
  // public/css/app.css and public/js/*.js keep stable filenames across commits
  // (Tailwind builds locally, no hashing step on Vercel). `immutable` would make
  // browsers hold a year-old bundle through every redeploy, so edits silently
  // appear to do nothing.
  for (const entry of config.headers ?? []) {
    if (!/^\/(css|js)\//.test(entry.source)) continue;
    for (const h of entry.headers) {
      if (h.key.toLowerCase() !== 'cache-control') continue;
      assert.ok(
        !/immutable/i.test(h.value),
        `${entry.source} sets Cache-Control to "${h.value}". Filenames are not ` +
          'content-hashed, so immutable serves a stale bundle after redeploy.',
      );
    }
  }
});

check('security headers are present on the catch-all', () => {
  const all = (config.headers ?? []).flatMap((e) => e.headers.map((h) => h.key.toLowerCase()));
  for (const header of ['x-content-type-options', 'referrer-policy', 'x-frame-options']) {
    assert.ok(all.includes(header), `missing ${header}`);
  }
});

section('crons');

check('every cron entry uses only allowed properties', () => {
  const problems = [];
  for (const c of config.crons ?? []) {
    for (const key of Object.keys(c)) {
      if (!ALLOWED_CRONS.has(key)) problems.push(`${c.path} -> ${key}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

check('every cron path resolves to a real endpoint', () => {
  for (const c of config.crons ?? []) {
    const name = path.basename(c.path);
    assert.ok(
      existsSync(path.join(root, 'api', `${name}.php`)),
      `cron "${c.path}" has no api/${name}.php`,
    );
  }
});

section('redirects and routes');

check('every redirect uses only allowed properties', () => {
  const problems = [];
  for (const r of config.redirects ?? []) {
    for (const key of Object.keys(r)) {
      if (!ALLOWED_REDIRECT.has(key)) problems.push(`${r.source} -> ${key}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

check('every route uses only allowed properties', () => {
  const problems = [];
  for (const r of config.routes ?? []) {
    for (const key of Object.keys(r)) {
      if (!ALLOWED_ROUTE.has(key)) problems.push(`${r.src} -> ${key}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

section('packaging');

check('outputDirectory exists', () => {
  const out = config.outputDirectory;
  assert.ok(out, 'no outputDirectory set');
  assert.ok(existsSync(path.join(root, out)), `outputDirectory "${out}" does not exist`);
});

check('public/ is not excluded by .vercelignore', () => {
  // Excluding the served directory builds cleanly and then 404s every path.
  if (!existsSync(path.join(root, '.vercelignore'))) return;
  const rules = readFileSync(path.join(root, '.vercelignore'), 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));

  for (const rule of rules) {
    assert.ok(
      !/^public\/?$/.test(rule.replace(/\/$/, '')),
      `.vercelignore excludes "${rule}" — that 404s the whole deployment`,
    );
  }
});

check('.vercelignore does not ship secrets', () => {
  if (!existsSync(path.join(root, '.vercelignore'))) return;
  const raw = readFileSync(path.join(root, '.vercelignore'), 'utf8');
  assert.match(raw, /^\.env$/m, '.vercelignore should exclude .env');
  // lib/ must ship: the PHP runtime has no includeFiles support, so helpers
  // there are loaded at runtime and omitting them 500s every endpoint.
  assert.ok(!/^lib\/?$/m.test(raw), '.vercelignore excludes lib/ — every endpoint would 500');
});

check('.env is gitignored', () => {
  if (!existsSync(path.join(root, '.gitignore'))) return;
  const raw = readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(raw, /^\.env$/m, '.env is not gitignored');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);