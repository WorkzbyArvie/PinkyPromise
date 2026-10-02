/**
 * Apology & Promise Jar — draws a random promise from a pre-loaded array.
 *
 * Uses a shuffle-bag so you never see the same promise twice in a row and
 * every promise appears once before any repeats. Bag position is kept in
 * sessionStorage so closing the modal doesn't reshuffle.
 */

const STORAGE_KEY = 'rmb:jarBag';

const PROMISES = [
  'I will never stop choosing you, even on the days I choose badly.',
  'I will learn the things you tell me twice, until I only need to hear them once.',
  'I will say the first thing I think when it is kind, instead of the third thing.',
  'I will keep trying — out loud, where you can see it.',
  'I will ask about your day before I tell you about mine.',
  'I will hold your hand in the hard conversations, not just the easy ones.',
  'I will be gentle with you when you are not at your best, because you are always more than your worst hour.',
  'I will notice. I will say it out loud, so you know it landed.',
  'I will leave room on the shelf for the version of you that is still arriving.',
  'I will fight for us without keeping score.',
  'I will keep the pictures. Every single one. Even the blurry ones.',
  'I will bring you the good news first, even if we are far apart.',
  'I will not use silence as a weapon — ever, not even when I am hurt.',
  'I will apologise before I defend myself, every time, even when I was right.',
  'I will keep falling for you on ordinary days with no reason at all.',
  'I will make you tea without being asked, and I will remember how you take it.',
  'I will tell you when I am struggling, before it becomes a wall.',
  'I will stay for the boring parts, not just the beautiful ones.',
  'I will let you be proud of me without feeling threatened.',
  'I will remember this, and I will keep writing it down.',
];

function loadBag() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== PROMISES.length) return null;
    if (parsed.some((p) => !PROMISES.includes(p))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveBag(bag) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bag));
  } catch {
    /* private mode — the bag just resets on reload */
  }
}

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createJar() {
  let bag = loadBag() ?? shuffled(PROMISES);
  let drawn = null;
  let drawing = false;

  function draw() {
    if (drawing) return drawn;
    if (bag.length === 0) bag = shuffled(PROMISES);
    drawn = bag.pop();
    saveBag(bag);
    drawing = true;
    return drawn;
  }

  function peekCount() {
    return bag.length;
  }

  function reset() {
    bag = shuffled(PROMISES);
    drawn = null;
    saveBag(bag);
  }

  return {
    draw,
    peekCount,
    reset,
    get current() {
      return drawn;
    },
    /** Called when the note animation settles, so the next click is allowed. */
    settle() {
      drawing = false;
    },
    count: PROMISES.length,
    sample: PROMISES.slice(0, 3),
  };
}