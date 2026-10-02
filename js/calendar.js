/**
 * Calendar grid — month layout, day markers, and the fetch range.
 *
 * The grid is always 6 rows (42 cells) so the calendar doesn't change height
 * when you page between months. Days that spill in from the neighbouring
 * months are rendered but dimmed, and they still carry their own events —
 * so the fetch range covers the whole visible grid, not just the month.
 */

export const WEEK_START = 0; // 0 = Sunday
const ROWS = 6;

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  // new Date(2024, 13, 1) rolls into January rather than failing — verify.
  const d = new Date(year, month - 1, day);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** First cell of the grid containing the 1st of the given month. */
export function gridStart(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - WEEK_START + 7) % 7;
  return new Date(year, month, 1 - offset);
}

/** Inclusive date range spanned by the visible grid. */
export function rangeForMonth(year, month) {
  const start = gridStart(year, month);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + ROWS * 7 - 1);
  return { from: ymd(start), to: ymd(end) };
}

function groupByDate(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Short weekday headers, rotated to match WEEK_START. */
export const WEEKDAY_LABELS = (() => {
  const base = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 7 }, (_, i) => base[(i + WEEK_START) % 7]);
})();

export const monthLabel = (year, month) => `${MONTH_LABELS[month]} ${year}`;

/**
 * Build the 42 cells for a month.
 * @param {number} year
 * @param {number} month  0-based
 * @param {Array} events  calendar_events
 * @param {Array} memories photo_cards that have a memory_date
 */
export function buildMonthGrid(year, month, events = [], memories = []) {
  const eventsByDay = groupByDate(events, (e) => e.event_date);
  const memoriesByDay = groupByDate(memories, (m) => m.memory_date);

  const start = gridStart(year, month);
  const todayKey = ymd(new Date());
  const cells = [];

  for (let i = 0; i < ROWS * 7; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = ymd(date);

    cells.push({
      key,
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: key === todayKey,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      events: eventsByDay.get(key) ?? [],
      memories: memoriesByDay.get(key) ?? [],
    });
  }

  return cells;
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}