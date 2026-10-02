/**
 * Heart Deck — category tabs and a scroll-snap row.
 *
 * No carousel library. Native scroll-snap does the work; these helpers just
 * page the row by one card and keep keyboard focus inside it.
 */

const ORDER = ['sorry', 'appreciation', 'love', 'comfort'];

export function categories() {
  return [...ORDER];
}

/**
 * Page the row left/right by roughly one card, clamped to the ends.
 * Uses instant behaviour so it never fights the user's own scroll momentum.
 */
export function pageBy(row, direction) {
  if (!row) return;
  const card = row.querySelector('[data-deck-card]');
  const step = card ? card.getBoundingClientRect().width + 24 : row.clientWidth * 0.8;
  const max = row.scrollWidth - row.clientWidth;
  const next = Math.max(0, Math.min(max, row.scrollLeft + step * direction));
  row.scrollTo({ left: next, behavior: 'smooth' });
}

/** Left/right arrows page the row when it holds keyboard focus. */
export function onRowKeydown(event, row) {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    pageBy(row, 1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    pageBy(row, -1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    row.scrollTo({ left: 0, behavior: 'smooth' });
  } else if (event.key === 'End') {
    event.preventDefault();
    row.scrollTo({ left: row.scrollWidth, behavior: 'smooth' });
  }
}

/** Jump the tab strip so the selected tab is in view on narrow screens. */
export function revealTab(tabEl, stripEl) {
  if (!tabEl || !stripEl) return;
  const t = tabEl.getBoundingClientRect();
  const s = stripEl.getBoundingClientRect();
  if (t.left < s.left || t.right > s.right) {
    tabEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
}