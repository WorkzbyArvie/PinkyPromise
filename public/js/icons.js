/**
 * Icon set — outline SVGs, 2px stroke, round caps/joins.
 * Rendered via `icon(name, size)` → returns an SVG string.
 * Colour always inherits from `currentColor` so it themes with the ink tokens.
 */

const P = {
  play: '<path d="M6 3.5 20 12 6 20.5z"/>',
  pause: '<path d="M9.5 4v16M14.5 4v16"/>',
  prev: '<path d="M19 20 9 12l10-8zM5 4v16"/>',
  next: '<path d="m5 4 10 8-10 8zM19 4v16"/>',
  volumeHigh:
    '<path d="M11 4.5 6.5 8.5H3v7h3.5L11 19.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6a8 8 0 0 1 0 12"/>',
  volumeLow: '<path d="M11 4.5 6.5 8.5H3v7h3.5L11 19.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  volumeMute:
    '<path d="M11 4.5 6.5 8.5H3v7h3.5L11 19.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  heart:
    '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  envelope:
    '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 15v2.5"/>',
  calendar:
    '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M3.5 6h17M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6"/><path d="m18.5 6-1 13.5a2 2 0 0 1-2 1.9h-7a2 2 0 0 1-2-1.9L5.5 6"/><path d="M10 11v6M14 11v6"/>',
  pencil: '<path d="M17 3.5a2.8 2.8 0 0 1 4 4L7.5 21 2 22.5 3.5 17z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  upload:
    '<path d="M20.5 15.5V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3.5"/><path d="m16.5 8-4.5-4.5L7.5 8"/><path d="M12 3.5V16"/>',
  image:
    '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><circle cx="8.8" cy="9.3" r="1.8"/><path d="m20.5 15.5-3.6-3.6a2 2 0 0 0-2.8 0L5.5 20"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  rotate:
    '<path d="M20.5 5.5v5h-5"/><path d="M4 12a8.5 8.5 0 0 1 14.6-5.9L20.5 5.5"/><path d="M3.5 11.5A8.5 8.5 0 0 0 18.1 17.4l1.9.6"/>',
  cropReset:
    '<path d="M8 3.5H5.5A2 2 0 0 0 3.5 5.5V8"/><path d="M20.5 8V5.5a2 2 0 0 0-2-2H16"/><path d="M3.5 16v2.5a2 2 0 0 0 2 2H8"/><path d="M16 20.5h2.5a2 2 0 0 0 2-2V16"/><path d="M8 8h8v8H8z"/>',
  sparkle:
    '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  quote:
    '<path d="M9.5 5.5C6.5 6.8 4.5 9.6 4.5 13v5.5h6.5V12H8c0-2 .6-3.4 2.4-4.3z"/><path d="M19.5 5.5C16.5 6.8 14.5 9.6 14.5 13v5.5H21V12h-3c0-2 .6-3.4 2.4-4.3z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8.2-8.2M17 6l2.5 2.5M14.5 8.5 17 11"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.2h.01"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  retry: '<path d="M20.5 5.5v5h-5"/><path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L20.5 5.5"/><path d="M3.5 11.5A8.5 8.5 0 0 0 18.1 17.4"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  youtube:
    '<rect x="2.5" y="5.5" width="19" height="14" rx="4"/><path d="m10 9.5 5 2.5-5 2.5z"/>',
  music: '<path d="M9 18V5.5l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>',
  gift: '<rect x="3" y="8.5" width="18" height="4" rx="1"/><path d="M4.5 12.5V20a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-7.5M12 8.5v13"/><path d="M12 8.5S10.5 3 8 3a2.5 2.5 0 0 0 0 5.5M12 8.5S13.5 3 16 3a2.5 2.5 0 0 1 0 5.5"/>',
  bandage: '<path d="M8.5 15.5 15.5 8.5"/><rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M12 12h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',

  // Sliders, for the settings entry point. Distinct from `calendar` at a glance
  // so the header control does not read as another calendar tab.
  settings:
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/>' +
    '<circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',

  // A calendar with a plus: "mark this day" in the day popover.
  markDay:
    '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>' +
    '<path d="M12 12.5v5M9.5 15h5"/>',
};

export const ICON_NAMES = Object.keys(P);

/**
 * Render an icon as an SVG string.
 * @param {keyof typeof P} name
 * @param {number} size  px
 * @param {string} [cls]  extra classes on the <svg>
 */
export function icon(name, size = 20, cls = '') {
  const body = P[name];
  if (!body) return '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `class="${cls}">${body}</svg>`
  );
}

/** Emoji markers for calendar days — these are CONTENT (icon_type), not UI chrome. */
export const EVENT_EMOJI = {
  anniversary: '💖',
  monthsary: '🍰',
  date: '🌸',
  sorry: '🩹',
  heart: '💗',
};

export const EVENT_LABEL = {
  anniversary: 'Anniversary',
  monthsary: 'Monthsary',
  date: 'Date',
  sorry: 'Sorry note',
  heart: 'Love note',
};

export const DECK_META = {
  sorry: { label: 'Sorry', emoji: '🩹', blurb: 'Sincere apologies, accountability, promises.' },
  appreciation: { label: 'Appreciation', emoji: '🌷', blurb: 'Cute moments and reasons for gratitude.' },
  love: { label: 'Love', emoji: '💖', blurb: 'Sweet notes and the core love messages.' },
  comfort: { label: 'Comfort', emoji: '🫂', blurb: 'Virtual hugs and “Open When…” notes.' },
};