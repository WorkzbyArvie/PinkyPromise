/**
 * Photocard interactions — 3D flip reveal and typewriter letter reveal.
 *
 * Note on state: nothing here depends on `animationend` / `transitionend`.
 * Timers and rAF own the final state and are always cancellable, so a second
 * click mid-animation can't leave a card stuck edge-on.
 */

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TYPE_SPEED_MS = 18;
const CARET_BLINK_MS = 530;

/**
 * Reveal `text` character by character into `el`.
 * @returns {{ skip: () => void, cancel: () => void }}
 */
export function typewriter(el, text, { speed = TYPE_SPEED_MS, onDone } = {}) {
  const source = String(text ?? '');
  let index = 0;
  let raf = 0;
  let last = 0;
  let finished = false;

  // Reduced motion: show the letter immediately, no animation.
  if (reducedMotion()) {
    el.textContent = source;
    finished = true;
    onDone?.();
    return { skip() {}, cancel() {} };
  }

  const paint = (upto) => {
    // textContent, never innerHTML — letters are user-authored.
    el.textContent = source.slice(0, upto);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    paint(source.length);
    onDone?.();
  };

  const step = (t) => {
    if (finished) return;
    if (!last) last = t;
    if (t - last >= speed) {
      last = t;
      index += 1;
      paint(index);
      if (index >= source.length) {
        finish();
        return;
      }
    }
    raf = requestAnimationFrame(step);
  };

  paint(0);
  raf = requestAnimationFrame(step);

  return {
    skip: finish,
    cancel() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** Blinking caret element, auto-removed when the reveal ends. */
export function caret() {
  const el = document.createElement('span');
  el.className = 'ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.15em] bg-ink align-middle';
  el.setAttribute('aria-hidden', 'true');
  el.style.animation = `caretBlink ${CARET_BLINK_MS}ms steps(1) infinite`;
  return el;
}

/**
 * Controller for the photocard viewer: flip + letter reveal.
 *
 * Flipping is a pure CSS class toggle (see `.card-3d` in index.html), driven
 * from JS state so the phase is always explicit and cancellable.
 */
export function createViewer() {
  let typer = null;
  let caretEl = null;

  function openLetter(letterEl, text) {
    typer?.cancel();
    if (caretEl) caretEl.remove();

    letterEl.textContent = '';
    typer = typewriter(letterEl, text, {
      onDone() {
        if (caretEl) {
          caretEl.remove();
          caretEl = null;
        }
      },
    });

    if (!reducedMotion()) {
      caretEl = caret();
      letterEl.appendChild(caretEl);
    }
  }

  function close() {
    typer?.cancel();
    typer = null;
    if (caretEl) {
      caretEl.remove();
      caretEl = null;
    }
  }

  return { openLetter, close };
}