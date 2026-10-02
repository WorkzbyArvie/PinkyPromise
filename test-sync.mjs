/**
 * Keeps the calendar event kinds in agreement across every place they are
 * declared.
 *
 * The list of icon_type values now exists in three places:
 *
 *   db/001_schema.sql      check (icon_type in (...))   the actual constraint
 *   api/calendar.php       const ICON_TYPES = [...]    the API allowlist
 *   public/js/icons.js     EVENT_EMOJI / EVENT_LABEL   the UI picker + legend
 *
 * Nothing forces them to match. Adding a value to the frontend without a
 * migration is not a lint error — it is a Postgres constraint violation the
 * first time somebody picks that option, and an insert that fails only in
 * production. So this parses all three and compares.
 *
 *   node test-sync.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { EVENT_EMOJI, EVENT_LABEL } from './public/js/icons.js';

const root = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n         ${err.message}`);
    process.exitCode = 1;
  }
};

const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

console.log('\nevent kinds stay in sync across schema, API, and UI\n');

// --- schema ----------------------------------------------------------------
const schema = read(path.join('db', '001_schema.sql'));
const schemaMatch = schema.match(/icon_type\s+in\s*\(([^)]+)\)/i);
const schemaTypes = schemaMatch
  ? schemaMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  : null;

// --- api -------------------------------------------------------------------
const api = read(path.join('api', 'calendar.php'));
const apiMatch = api.match(/const\s+ICON_TYPES\s*=\s*\[([^\]]+)\]/);
const apiTypes = apiMatch
  ? apiMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  : null;

// --- ui --------------------------------------------------------------------
const uiTypes = Object.keys(EVENT_EMOJI);

t('the CHECK constraint was found in db/001_schema.sql', () => {
  assert.ok(schemaTypes, 'no "icon_type in (...)" constraint found in the schema');
  assert.ok(schemaTypes.length > 0, 'the constraint list is empty');
});

t('ICON_TYPES was found in api/calendar.php', () => {
  assert.ok(apiTypes, 'no "const ICON_TYPES = [...]" found in api/calendar.php');
  assert.ok(apiTypes.length > 0, 'ICON_TYPES is empty');
});

t('the API allowlist matches the database constraint', () => {
  assert.deepEqual(
    apiTypes,
    schemaTypes,
    'api/calendar.php ICON_TYPES and the schema CHECK constraint disagree — ' +
      'the API would accept a value the database rejects, or reject one it allows.',
  );
});

t('the UI picker matches the API allowlist', () => {
  assert.deepEqual(
    uiTypes,
    apiTypes,
    'EVENT_EMOJI and api/calendar.php ICON_TYPES disagree — picking an option ' +
      'in the app would fail at insert time with a constraint violation.',
  );
});

t('every kind has a human label', () => {
  for (const id of uiTypes) {
    assert.ok(EVENT_LABEL[id], `EVENT_LABEL has no entry for "${id}"`);
    assert.equal(typeof EVENT_LABEL[id], 'string');
    assert.ok(EVENT_LABEL[id].trim().length > 0, `label for "${id}" is blank`);
  }
});

t('no label exists without a kind behind it', () => {
  // A stray label is dead code that implies a UI option nobody can reach.
  assert.deepEqual(
    Object.keys(EVENT_LABEL).sort(),
    [...uiTypes].sort(),
    'EVENT_LABEL has entries with no matching EVENT_EMOJI entry',
  );
});

t('every kind has a distinct emoji marker', () => {
  // The day cell renders one emoji per event; duplicates make two different
  // kinds indistinguishable in the grid.
  const seen = new Map();
  for (const [id, emoji] of Object.entries(EVENT_EMOJI)) {
    assert.ok(emoji && emoji.trim().length > 0, `no emoji for "${id}"`);
    assert.ok(!seen.has(emoji), `"${id}" and "${seen.get(emoji)}" share the emoji ${emoji}`);
    seen.set(emoji, id);
  }
});

t('kind ids are safe as object keys and in a query', () => {
  // They are interpolated into HTML attributes and sent as JSON values.
  for (const id of uiTypes) {
    assert.match(id, /^[a-z][a-z0-9_]*$/, `"${id}" is not a safe identifier`);
  }
});

console.log(`\n${passed} passed\n`);