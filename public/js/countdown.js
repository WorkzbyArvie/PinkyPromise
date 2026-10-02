/**
 * Live countdown — total years / months / days / hours / minutes since the
 * anchor date, plus the next upcoming monthsary or anniversary.
 *
 * Uses calendar arithmetic rather than dividing milliseconds by 86400000,
 * which drifts across month lengths and daylight-saving boundaries.
 */

/** Parse `YYYY-MM-DD` as a LOCAL date. `new Date('2024-02-14')` is UTC and shifts a day. */
export function parseAnchor(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  // new Date(2024, 13, 1) silently rolls into January 2025 rather than failing,
  // so verify the components survived the round-trip.
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

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Add `n` calendar months, clamping to the last valid day of the target month
 * so that Jan 31 + 1 month lands on Feb 28/29 rather than spilling into March.
 */
export function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** Whole calendar months completed between `anchor` and `now`. */
export function completedMonths(anchor, now) {
  let months =
    (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth());
  if (addMonths(anchor, months) > now) months -= 1;
  return months < 0 ? 0 : months;
}

/**
 * Elapsed breakdown. `days` is rounded rather than floored so a 23-hour or
 * 25-hour daylight-saving day still counts as one whole day.
 */
export function elapsed(anchor, now = new Date()) {
  const totalMonths = completedMonths(anchor, now);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  const monthMark = addMonths(anchor, totalMonths);
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(monthMark)) / 86400000));

  const sinceMidnight = now - startOfDay(now);
  const hours = Math.floor(sinceMidnight / 3600000);
  const minutes = Math.floor((sinceMidnight % 3600000) / 60000);

  return { years, months, days, hours, minutes, totalMonths };
}

/**
 * The soonest future monthsary or anniversary.
 * On a whole-year boundary both coincide, so it is labelled as both.
 */
export function nextMilestone(anchor, now = new Date()) {
  const totalMonths = completedMonths(anchor, now);

  const nextMonthsary = addMonths(anchor, totalMonths + 1);
  const nextAnniversary = addMonths(anchor, (Math.floor(totalMonths / 12) + 1) * 12);

  const isWholeYear = nextMonthsary.getTime() === nextAnniversary.getTime();
  const target = isWholeYear || nextMonthsary < nextAnniversary ? nextMonthsary : nextAnniversary;

  const days = Math.max(
    0,
    Math.round((startOfDay(target) - startOfDay(now)) / 86400000),
  );

  let label;
  if (isWholeYear) label = 'Anniversary & monthsary';
  else if (target.getTime() === nextAnniversary.getTime()) label = 'Anniversary';
  else label = 'Monthsary';

  const yearsOut = Math.floor(totalMonths / 12) + 1;
  const caption =
    yearsOut === 1
      ? `${ordinal(yearsOut)} anniversary`
      : `${ordinal(yearsOut)} anniversary`;

  return { label, caption, target, days };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Drive a countdown element. Re-renders every second but only recomputes the
 * calendar breakdown on minute boundaries — `elapsed` is not free.
 */
export function startCountdown({ getAnchor, onTick }) {
  const tick = () => {
    const anchor = getAnchor();
    if (!anchor) {
      onTick(null);
      return;
    }
    const now = new Date();
    onTick({ elapsed: elapsed(anchor, now), next: nextMilestone(anchor, now) });
  };

  tick();
  const id = setInterval(tick, 1000);

  const onVisible = () => {
    if (!document.hidden) tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}