/**
 * Secret/Admin modal — crop, upload, and manage memories.
 *
 * Pipeline for one photo:
 *   file → <img> (browser auto-applies EXIF orientation)
 *        → Cropper.js, aspectRatio locked to 1:1
 *        → [canvas 1000×1000 q0.88]  card image   (~150 KB)
 *        → [canvas ≤2400px  q0.90]  original      (~600 KB)
 *        → two POSTs to /api/upload, then one POST to /api/cards
 *
 * If the card insert fails, both uploaded objects are deleted so we never
 * leave orphans behind in the bucket.
 */

import { uploadApi, cardsApi, esc } from './api.js';

export const CARD_SIZE = 1000; // 1:1, verified against DESIGN-SYSTEM.md
export const ORIGINAL_MAX = 2400; // enough headroom to change the ratio later
const CARD_QUALITY = 0.88;
const ORIGINAL_QUALITY = 0.9;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas encoding failed'))),
      type,
      quality,
    );
  });
}

/** Full image scaled down to `maxEdge` on its longest side. */
async function renderOriginal(img) {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, ORIGINAL_MAX / longest);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return toBlob(canvas, 'image/jpeg', ORIGINAL_QUALITY);
}

/**
 * Owns the cropper lifecycle inside the admin modal.
 * Emits progress through `onUpdate` so the UI can show a step indicator.
 */
export function createCropper({ onUpdate }) {
  let cropper = null;
  let sourceUrl = null;
  let img = null;
  const uploaded = []; // storage paths we created — cleaned up on failure

  function teardown() {
    cropper?.destroy();
    cropper = null;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = null;
    if (img) {
      img.removeAttribute('src');
      img.style.imageOrientation = '';
    }
    img = null;
  }

  async function cleanupUploads() {
    await Promise.allSettled(uploaded.map((p) => uploadApi.remove(p)));
    uploaded.length = 0;
  }

  /**
   * Load the file and open the cropper.
   *
   * `targetEl` must be an <img> already in the document — Cropper.js measures
   * the live element, so a detached Image() would compute a zero-size box.
   * @returns {Promise<boolean>}
   */
  async function load(file, targetEl) {
    if (!file) return false;
    if (!ACCEPTED.includes(file.type)) {
      throw new Error('Please choose a JPEG, PNG, or WebP image.');
    }
    if (file.size > MAX_SOURCE_BYTES) {
      throw new Error('That photo is larger than 25 MB. Please pick a smaller one.');
    }
    if (!targetEl) throw new Error('The crop area is not ready yet.');

    teardown();

    sourceUrl = URL.createObjectURL(file);
    img = targetEl;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    // EXIF orientation: modern browsers apply it by default; be explicit.
    img.style.imageOrientation = 'from-image';

    onUpdate?.({ phase: 'loading' });

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("That file couldn't be read as an image."));
      img.src = sourceUrl;
    });

    // Cropper must attach only after the image has real intrinsic dimensions.
    cropper = new window.Cropper(img, {
      aspectRatio: 1,
      viewMode: 1, // crop box stays inside the image — no empty corners
      autoCropArea: 0.92,
      background: false,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      dragMode: 'move',
    });

    onUpdate?.({ phase: 'cropping' });
    return true;
  }

  /**
   * Produce both images and upload them. Resolves with the two CDN URLs.
   * On any failure, rolls back whatever already landed in storage.
   */
  async function commit() {
    if (!cropper || !img) throw new Error('Choose a photo first.');

    onUpdate?.({ phase: 'rendering' });

    const cropped = cropper.getCroppedCanvas({
      width: CARD_SIZE,
      height: CARD_SIZE,
      fillColor: '#FFF0F3',
      imageSmoothingQuality: 'high',
    });
    if (!cropped) throw new Error("Couldn't crop that photo. Try a different framing.");

    const [cardBlob, originalBlob] = await Promise.all([
      toBlob(cropped, 'image/jpeg', CARD_QUALITY),
      renderOriginal(img),
    ]);

    onUpdate?.({ phase: 'uploading' });

    // Upload sequentially so a mid-way failure is easy to reason about.
    onUpdate?.({ phase: 'uploading', step: 1, of: 2 });
    const cardUpload = await uploadApi.image(cardBlob, 'card');
    uploaded.push(cardUpload.path);

    onUpdate?.({ phase: 'uploading', step: 2, of: 2 });
    const originalUpload = await uploadApi.image(originalBlob, 'original');
    uploaded.push(originalUpload.path);

    // Success — these now belong to the card row, so stop tracking them.
    uploaded.length = 0;
    return {
      photo_url: cardUpload.photo_url,
      photo_original_url: originalUpload.photo_url,
    };
  }

  function rotate() {
    cropper?.rotate(90);
  }

  function reset() {
    cropper?.reset();
  }

  /** Keyboard nudge — the cropper needs a non-drag path for accessibility. */
  function nudge(dx, dy) {
    if (!cropper) return;
    const box = cropper.getCropBoxData();
    cropper.setCropBoxData({ left: box.left + dx, top: box.top + dy });
  }

  return { load, commit, rotate, reset, nudge, teardown, cleanupUploads, get ready() { return Boolean(cropper); } };
}

/** Validate + normalise the card form before we hit the API. */
export function validateCard(form) {
  const errors = {};
  const title = (form.title ?? '').trim();
  const letter = (form.letter_text ?? '').trim();
  const date = (form.memory_date ?? '').trim();

  if (!title) errors.title = 'Give this memory a title.';
  else if (title.length > 255) errors.title = 'Title must be 255 characters or fewer.';

  if (!letter) errors.letter_text = 'Write the letter that goes with this photo.';
  else if (letter.length > 20000) errors.letter_text = 'That letter is too long.';

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.memory_date = 'Use the date picker, or leave this blank.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Create a card, rolling back the uploads if the insert fails. */
export async function saveCard(card, cropper) {
  try {
    return await cardsApi.create(card);
  } catch (err) {
    await cropper?.cleanupUploads();
    throw err;
  }
}

export { esc };