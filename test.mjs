/**
 * Logic smoke tests — the parts most likely to be subtly wrong.
 * Run with: node test.mjs
 */

import assert from 'node:assert/strict';
import {
  parseAnchor,
  addMonths,
  completedMonths,
  elapsed,
  nextMilestone,
} from './js/countdown.js';
import {
  buildMonthGrid,
  gridStart,
  rangeForMonth,
  ymd,
  parseYmd,
  WEEKDAY_LABELS,
} from './js/calendar.js';
import { createJar } from './js/jar.js';
import { validateCard } from './js/admin.js';

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

console.log('\ncountdown — date math');

t('parseAnchor reads YYYY-MM-DD as a LOCAL date', () => {
  const d = parseAnchor('2024-02-14');
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 0, 'must not shift by timezone');
});

t('parseAnchor rejects junk', () => {
  assert.equal(parseAnchor(''), null);
  assert.equal(parseAnchor('not-a-date'), null);
  assert.equal(parseAnchor('2024-13-01'), null, 'month 13 must not roll into next year');
  assert.equal(parseAnchor('2023-02-29'), null, 'Feb 29 in a non-leap year must fail');
  assert.notEqual(parseAnchor('2024-02-29'), null, 'Feb 29 in a leap year is valid');
  assert.equal(parseAnchor('2024-00-10'), null, 'month 0 must fail');
  assert.equal(parseAnchor('2024-04-31'), null, 'April has 30 days');
});

t('parseYmd applies the same rollover guard', () => {
  assert.equal(parseYmd('2024-13-01'), null);
  assert.equal(parseYmd('2023-02-29'), null);
  assert.equal(parseYmd('2024-04-31'), null, 'April has only 30 days');
  assert.equal(ymd(parseYmd('2024-02-29')), '2024-02-29');
});

t('addMonths clamps Jan 31 + 1 month to Feb 28 (2024 is a leap year)', () => {
  const d = addMonths(new Date(2024, 0, 31), 1);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 29, 'leap year should give Feb 29');
});

t('addMonths clamps Jan 31 + 1 month to Feb 28 in a non-leap year', () => {
  const d = addMonths(new Date(2023, 0, 31), 1);
  assert.equal(d.getDate(), 28);
});

t('addMonths never spills into the following month', () => {
  for (let year of [2023, 2024, 2025]) {
    for (let day of [28, 29, 30, 31]) {
      const d = addMonths(new Date(year, 0, day), 1);
      assert.equal(d.getMonth(), 1, `Jan ${day} ${year} must land in February`);
      assert.ok(d.getDate() <= 29, `Feb date out of range: ${d.getDate()}`);
    }
  }
});

t('completedMonths is 0 on the anchor day itself', () => {
  assert.equal(completedMonths(new Date(2024, 1, 14), new Date(2024, 1, 14, 23, 59)), 0);
});

t('completedMonths counts a full month the day after', () => {
  assert.equal(completedMonths(new Date(2024, 1, 14), new Date(2024, 2, 14)), 1);
});

t('completedMonths stays 0 the day before the month mark', () => {
  assert.equal(completedMonths(new Date(2024, 1, 14), new Date(2024, 2, 13, 12, 0)), 0);
});

t('elapsed splits 27 months into 2y 3m 0d', () => {
  const e = elapsed(new Date(2024, 1, 14), new Date(2026, 4, 14));
  assert.equal(e.totalMonths, 27);
  assert.equal(e.years, 2);
  assert.equal(e.months, 3);
  assert.equal(e.days, 0);
});

t('elapsed counts remaining days within the month', () => {
  const e = elapsed(new Date(2024, 1, 14), new Date(2026, 4, 19));
  assert.equal(e.days, 5);
  assert.equal(e.months, 3);
});

t('elapsed hours/minutes reflect time of day', () => {
  const e = elapsed(new Date(2024, 1, 14), new Date(2024, 1, 20, 14, 37));
  assert.equal(e.hours, 14);
  assert.equal(e.minutes, 37);
});

t('nextMilestone on the anchor day points at the 1st monthsary', () => {
  // Feb 14 -> Mar 14 is 29 days in a leap year.
  const n = nextMilestone(new Date(2024, 1, 14), new Date(2024, 1, 14, 9, 0));
  assert.equal(n.label, 'Monthsary');
  assert.equal(ymd(n.target), '2024-03-14');
  assert.equal(n.days, 29);
});

t('on a month mark, the next milestone is the FOLLOWING month', () => {
  // 14 Feb -> 14 Mar means the March mark has just arrived, so the next
  // monthsary is 14 Apr — 31 days away, not 0.
  const n = nextMilestone(new Date(2024, 1, 14), new Date(2024, 2, 14, 0, 30));
  assert.equal(n.label, 'Monthsary');
  assert.equal(ymd(n.target), '2024-04-14');
  assert.equal(n.days, 31);
});

t('mid-year points at the monthsary still ahead this month', () => {
  // 1 June 2025; the 14th is still coming, so the June monthsary wins.
  // anchor Feb 2024 + 16 months = Jun 2025.
  const n = nextMilestone(new Date(2024, 1, 14), new Date(2025, 5, 1));
  assert.equal(n.label, 'Monthsary');
  assert.equal(ymd(n.target), '2025-06-14');
  assert.equal(n.days, 13);
});

t('just after a month mark, points at the next one a month out', () => {
  // 15 June 2025 — the June mark has passed, so July is next.
  const n = nextMilestone(new Date(2024, 1, 14), new Date(2025, 5, 15));
  assert.equal(ymd(n.target), '2025-07-14');
  assert.equal(n.days, 29);
});

t('nextMilestone right before an anniversary reports both', () => {
  const n = nextMilestone(new Date(2024, 1, 14), new Date(2025, 1, 13));
  assert.equal(n.label, 'Anniversary & monthsary');
  assert.equal(n.days, 1);
});

t('nextMilestone mid-year reports the monthsary', () => {
  // now = 1 June 2025 (month index 5); the 14th is still ahead.
  const n = nextMilestone(new Date(2024, 1, 14), new Date(2025, 5, 1));
  assert.equal(n.label, 'Monthsary');
  assert.equal(ymd(n.target), '2025-06-14');
});

t('nextMilestone never returns a past date', () => {
  const anchor = new Date(2024, 1, 14);
  for (let m = 0; m < 24; m += 1) {
    const now = new Date(2024, 1 + m, 20);
    const n = nextMilestone(anchor, now);
    assert.ok(n.target > now, `month ${m}: target must be in the future`);
  }
});

console.log('\ncalendar — grid');

t('gridStart lands on a Sunday', () => {
  assert.equal(gridStart(2024, 1).getDay(), 0);
});

t('gridStart walks back to cover the 1st', () => {
  // Feb 2024 starts on a Thursday -> grid must start Sun Jan 28.
  const s = gridStart(2024, 1);
  assert.equal(s.getMonth(), 0);
  assert.equal(s.getDate(), 28);
});

t('grid is always 42 cells and covers the whole month', () => {
  const cells = buildMonthGrid(2024, 1, [], []);
  assert.equal(cells.length, 42);
  const inMonth = cells.filter((c) => c.inMonth);
  assert.equal(inMonth.length, 29, 'Feb 2024 has 29 days');
});

t('grid handles a 31-day month starting on Saturday', () => {
  // May 2026 starts Friday; grid must still contain all 31 days.
  const cells = buildMonthGrid(2026, 4, [], []);
  assert.equal(cells.filter((c) => c.inMonth).length, 31);
});

t('weekday headers are 7 long', () => {
  assert.equal(WEEKDAY_LABELS.length, 7);
  assert.equal(WEEKDAY_LABELS[0], 'Sun');
});

t('rangeForMonth covers the full visible grid', () => {
  const { from, to } = rangeForMonth(2024, 1);
  assert.equal(from, '2024-01-28');
  assert.ok(to > '2024-02-29', `range must extend past month end, got ${to}`);
});

t('events are grouped onto the right day cell', () => {
  const cells = buildMonthGrid(2024, 1, [
    { id: '1', event_date: '2024-02-14', icon_type: 'anniversary' },
  ], []);
  const day = cells.find((c) => c.key === '2024-02-14');
  assert.equal(day.events.length, 1);
  assert.equal(day.events[0].icon_type, 'anniversary');
});

t('memories with a date land on their day, others are ignored', () => {
  const cells = buildMonthGrid(
    2024, 1,
    [],
    [
      { id: 'a', memory_date: '2024-02-14' },
      { id: 'b', memory_date: null },
    ],
  );
  assert.equal(cells.find((c) => c.key === '2024-02-14').memories.length, 1);
  assert.equal(cells.flatMap((c) => c.memories).length, 1);
});

t('today is flagged on exactly one cell of the current month', () => {
  const now = new Date();
  const cells = buildMonthGrid(now.getFullYear(), now.getMonth(), [], []);
  assert.equal(cells.filter((c) => c.isToday).length, 1);
  assert.equal(cells.find((c) => c.isToday).key, ymd(now));
});

t('today is flagged nowhere in a month that is not now', () => {
  const cells = buildMonthGrid(2024, 1, [], []);
  assert.equal(cells.filter((c) => c.isToday).length, 0);
});

t('ymd and parseYmd round-trip', () => {
  for (const s of ['2024-02-29', '2025-12-01', '2023-07-04']) {
    assert.equal(ymd(parseYmd(s)), s);
  }
});

console.log('\njar — shuffle bag');

t('draw yields the full set with no repeats before reshuffling', () => {
  const jar = createJar();
  const seen = [];
  for (let i = 0; i < jar.count; i += 1) {
    jar.settle();
    seen.push(jar.draw());
  }
  assert.equal(new Set(seen).size, jar.count, 'no repeats across a full cycle');
});

t('bag count decrements and reshuffles when empty', () => {
  const jar = createJar();
  const start = jar.peekCount();
  jar.settle();
  jar.draw();
  assert.equal(jar.peekCount(), start - 1);
  for (let i = 0; i < start - 1; i += 1) {
    jar.settle();
    jar.draw();
  }
  assert.equal(jar.peekCount(), 0);
  jar.settle();
  jar.draw();
  assert.equal(jar.peekCount(), jar.count - 1, 'reshuffled after exhausting');
});

console.log('\nadmin — validation');

t('accepts a complete card', () => {
  const r = validateCard({ title: 'Hi', letter_text: 'There', memory_date: '' });
  assert.equal(r.valid, true);
});

t('rejects a missing title', () => {
  const r = validateCard({ title: '  ', letter_text: 'There' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.title);
});

t('rejects a missing letter', () => {
  const r = validateCard({ title: 'Hi', letter_text: '' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.letter_text);
});

t('rejects a malformed date but allows blank', () => {
  assert.equal(validateCard({ title: 'a', letter_text: 'b', memory_date: '14/02/2024' }).valid, false);
  assert.equal(validateCard({ title: 'a', letter_text: 'b', memory_date: '' }).valid, true);
});

t('rejects an over-long title', () => {
  assert.equal(validateCard({ title: 'x'.repeat(256), letter_text: 'b' }).valid, false);
});

console.log(`\n${passed} passed\n`);