/**
 * App shell — Alpine state and all module wiring.
 *
 * Two data sources:
 *   • live  → the PHP API in /api (needs a valid session cookie)
 *   • demo  → js/demo.js, activated only with `?demo=1`, so the UI can be
 *             reviewed before Supabase + PHP are configured
 */

import { authApi, cardsApi, calendarApi, decksApi, settingsApi, tracksApi, uploadApi } from './api.js';
import { icon, EVENT_EMOJI, EVENT_LABEL, DECK_META } from './icons.js';
import { parseAnchor, startCountdown } from './countdown.js';
import { typewriter, caret } from './cardflip.js';
import {
  buildMonthGrid,
  rangeForMonth,
  monthLabel as monthLabelFor,
  WEEKDAY_LABELS,
  parseYmd,
} from './calendar.js';
import { categories, pageBy, onRowKeydown, revealTab } from './decks.js';
import { createJar } from './jar.js';
import { createPlayer } from './player.js';
import { createCropper, validateCard, saveCard } from './admin.js';
import { resolveSource } from './sources.js';
import {
  isDemo,
  DEMO_PHOTOS,
  DEMO_EVENTS,
  DEMO_DECKS,
  DEMO_SETTINGS,
  DEMO_TRACKS,
} from './demo.js';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const WEEKDAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const TABS = [
  { id: 'memories', label: 'Memories', icon: 'image' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'decks', label: 'Heart deck', icon: 'heart' },
  { id: 'jar', label: 'Promise jar', icon: 'sparkle' },
  { id: 'music', label: 'Music', icon: 'music' },
];

const TRACK_SOURCES = [
  { id: 'file', label: 'Audio file', icon: 'upload' },
  { id: 'youtube', label: 'YouTube', icon: 'youtube' },
  { id: 'spotify', label: 'Spotify', icon: 'external' },
];

function appShell() {
  return {
    /* ============================ auth ============================ */
    authed: false,
    authBusy: false,
    authError: null,
    bootError: null,
    passcode: '',
    remember: true,
    demoMode: isDemo(),

    /* ============================ data ============================ */
    loading: true,
    loadError: null,
    photos: [],
    events: [],
    decks: { sorry: [], appreciation: [], love: [], comfort: [] },
    settings: { ...DEMO_SETTINGS },
    countdown: null,

    /* ============================ ui ============================= */
    ic: icon,
    hearts: [],
    tabs: TABS,
    activeTab: 'memories',
    tabRefs: {},
    tabStrip: null,

    /* viewer */
    viewer: { open: false, card: null, flipped: false, canEdit: false },

    /* calendar */
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    cells: [],
    weekdays: WEEKDAY_LABELS,
    dayCell: null,

    /* decks */
    deckCategory: 'sorry',
    deckTabRefs: {},
    deckRow: null,

    /* jar */
    jarNote: null,
    jarDrawing: false,

    /* music */
    music: {
      ready: false, playing: false, track: null, index: 0, volume: 1, muted: false,
      tracks: [], sourceType: null, playable: false, visualizer: false,
      popoverOpen: false, progress: 0, error: null,
    },
    trackSources: TRACK_SOURCES,
    trackForm: { title: '', source_type: 'file', url: '', file: null },
    trackError: null,
    trackBusy: false,

    /* admin */
    admin: { open: false, step: 'pick', editing: false, form: {}, errors: {}, preview: null },
    adminError: null,
    cropBusy: false,
    saveBusy: false,

    /* internal */
    _jar: null,
    _player: null,
    _cropper: null,
    _typer: null,
    _stopCountdown: null,
    _existingCard: null,

    /* ======================== lifecycle =========================== */

    async boot() {
      this.bootError = null;
      this._makeHearts();
      this._jar = createJar();

      if (this.demoMode) {
        this._loadDemo();
        this.authed = true;
        this.loading = false;
        this._startClock();
        this._startPlayer();
        return;
      }

      try {
        const status = await authApi.status();
        this.authed = Boolean(status?.authenticated);
        if (this.authed) await this._loadAll();
        else this.loading = false;
      } catch (err) {
        this.bootError =
          err.code === 'not_initialised'
            ? 'No passcode has been set up yet. Run the setup step in README.md.'
            : "Couldn't reach the server. Is the API running?";
        this.loading = false;
      }
    },

    async signIn() {
      if (!this.passcode) {
        this.authError = 'Please enter the passcode.';
        this.$nextTick(() => this.$refs.passcode?.focus());
        return;
      }
      this.authBusy = true;
      this.authError = null;
      try {
        await authApi.login(this.passcode);
        this.passcode = '';
        this.authed = true;
        await this._loadAll();
        this._startClock();
        this._startPlayer();
      } catch (err) {
        this.authError = err.message || "That isn't our passcode. Try again.";
        this.$nextTick(() => this.$refs.authError?.focus());
      } finally {
        this.authBusy = false;
      }
    },

    async signOut() {
      this.closeViewer();
      this.closeAdmin();
      this._stopCountdown?.();
      this._stopCountdown = null;
      this._player?.destroy();
      this._player = null;
      this.countdown = null;
      this.music = {
        ready: false, playing: false, track: null, index: 0, volume: 1, muted: false,
        tracks: [], sourceType: null, playable: false, visualizer: false,
        popoverOpen: false, progress: 0, error: null,
      };
      try {
        await authApi.logout();
      } catch {
        /* the cookie is cleared regardless */
      }
      this.authed = false;
    },

    /* ========================== data load ========================= */

    async _loadAll() {
      this.loading = true;
      this.loadError = null;
      try {
        const [photos, decks, settings] = await Promise.all([
          cardsApi.list(),
          decksApi.all(),
          settingsApi.get(),
        ]);

        this.photos = photos ?? [];
        this.decks = { ...this.decks, ...(decks ?? {}) };
        if (settings) this.settings = { ...this.settings, ...settings };

        await this._loadCalendarRange();
      } catch (err) {
        this.loadError = err.message || 'Something went wrong.';
      } finally {
        this.loading = false;
      }
    },

    async reload() {
      await this._loadAll();
    },

    _loadDemo() {
      this.photos = DEMO_PHOTOS.map((p) => ({ ...p }));
      this.events = DEMO_EVENTS.map((e) => ({ ...e }));
      this.decks = Object.fromEntries(
        Object.entries(DEMO_DECKS).map(([k, v]) => [k, v.map((c) => ({ ...c }))]),
      );
      this.settings = { ...DEMO_SETTINGS };
      this._rebuildCalendar();

      // Demo tracks are seeded directly; the player only reads the manifest
      // and the API, neither of which exists in demo mode.
      this.music = { ...this.music, tracks: DEMO_TRACKS.map((t) => ({ ...t })), ready: true };
    },

    /* ========================== countdown ========================= */

    _startClock() {
      this._stopCountdown?.();
      this._stopCountdown = startCountdown({
        getAnchor: () => parseAnchor(this.settings.anchor_date),
        onTick: (data) => {
          this.countdown = data;
        },
      });
    },

    /* ============================ music =========================== */

    _startPlayer() {
      if (this._player) return;
      this._player = createPlayer({
        onState: (s) => {
          this.music = { ...s };
        },
      });
      // The YouTube mount lives inside the popover, so pass it through.
      this._player.init(this.$refs.viz, this.$refs.ytMount);
      if (this.demoMode) this._player.setTracks(DEMO_TRACKS);
    },

    musicToggle() { this._player?.toggle(); },
    musicNext() { this._player?.next(); },
    musicPrev() { this._player?.prev(); },
    musicSelect(i) { this._player?.select(Number(i)); },
    musicVolume(v) { this._player?.setVolume(Number(v)); },
    musicMute() { this._player?.toggleMute(); },
    musicOpenSpotify() { this._player?.openInSpotify(); },
    musicOpenPopover() { this._player?.openPopover(); },
    musicClosePopover() { this._player?.closePopover(); },
    musicJump(i) {
      this._player?.select(i);
      if (!this.music.playable) return;
      this._player?.toggle();
    },

    /* -------------------------- track admin ------------------------- */

    get trackHint() {
      if (this.trackForm.source_type === 'youtube') {
        return 'Any YouTube link works. Some videos have embedding turned off by their owner.';
      }
      return 'Spotify cannot be embedded on other sites — the track opens in Spotify instead.';
    },

    async addTrack() {
      this.trackError = null;
      const title = (this.trackForm.title ?? '').trim();
      if (!title) {
        this.trackError = 'Give the track a title.';
        return;
      }

      const kind = this.trackForm.source_type;
      this.trackBusy = true;

      try {
        if (this.demoMode) {
          const src = this.trackForm.file
            ? URL.createObjectURL(this.trackForm.file)
            : this.trackForm.url.trim();
          const resolved = resolveSource(src);
          if (!resolved) throw new Error("That doesn't look like a usable audio source.");
          this.music = {
            ...this.music,
            tracks: [
              ...this.music.tracks,
              {
                id: `demo-${Date.now()}`,
                title,
                source_type: resolved.type,
                source: resolved.type === 'file' ? src : resolved.source,
                origin: 'demo',
              },
            ],
          };
          this._player?.refresh();
        } else if (kind === 'file') {
          let sourceUrl = this.trackForm.url.trim();

          if (this.trackForm.file) {
            const uploaded = await uploadApi.audio(this.trackForm.file);
            sourceUrl = uploaded.url;
            await tracksApi.create({
              title,
              source_type: 'file',
              source: uploaded.url,
              storage_path: uploaded.path,
            });
          } else if (sourceUrl) {
            const resolved = resolveSource(sourceUrl);
            if (!resolved || resolved.type !== 'file') {
              throw new Error('That link is not a direct audio file.');
            }
            await tracksApi.create({ title, source_type: 'file', source: sourceUrl, storage_path: null });
          } else {
            throw new Error('Choose an audio file or paste a direct link.');
          }

          await this._player?.refresh();
        } else {
          const resolved = resolveSource(this.trackForm.url);
          if (!resolved) throw new Error("That doesn't look like a valid link.");
          if (resolved.type !== kind) {
            throw new Error(
              kind === 'youtube'
                ? 'That is not a YouTube link.'
                : 'That is not a Spotify link.',
            );
          }
          await tracksApi.create({ title, source_type: resolved.type, source: resolved.source });
          await this._player?.refresh();
        }

        this.trackForm = { title: '', source_type: kind, url: '', file: null };
      } catch (err) {
        this.trackError = err.message || "Couldn't add that track.";
      } finally {
        this.trackBusy = false;
      }
    },

    async removeTrack(track) {
      const ok = window.confirm(`Remove "${track.title}" from the playlist?`);
      if (!ok) return;
      try {
        await tracksApi.remove(track.id);
        await this._player?.refresh();
      } catch (err) {
        window.alert(err.message || "Couldn't remove that track.");
      }
    },

    /* ============================ tabs ============================ */

    setTab(id) {
      this.activeTab = id;
      if (id === 'decks') this.$nextTick(() => revealTab(this.deckTabRefs[this.deckCategory], this.$refs.deckRow));
      else this.$nextTick(() => revealTab(this.tabRefs[id], this.$refs.tabStrip));
    },

    /* ========================== viewer ============================ */

    openViewer(card) {
      if (!card) return;
      this.viewer = { open: true, card, flipped: false, canEdit: !this.demoMode };
      document.body.style.overflow = 'hidden';
    },

    closeViewer() {
      this._typer?.cancel();
      this._typer = null;
      this.viewer = { open: false, card: null, flipped: false, canEdit: false };
      document.body.style.overflow = '';
    },

    flipOpen() {
      this.viewer.flipped = true;
      const text = this.viewer.card?.letter_text ?? '';
      this.$nextTick(() => {
        const el = this.$refs.letter;
        if (!el) return;
        // Reset first so reopening always replays the reveal.
        this._typer?.cancel();
        el.textContent = '';
        const bar = caret();
        el.appendChild(bar);
        this._typer = typewriter(el, text, {
          onDone: () => bar.remove(),
        });
      });
    },

    flipClose() {
      this._typer?.cancel();
      this._typer = null;
      this.viewer.flipped = false;
    },

    skipTypewriter() {
      this._typer?.skip();
    },

    async removeViewerCard() {
      const card = this.viewer.card;
      if (!card) return;
      const ok = window.confirm(`Delete "${card.title}"? This can't be undone.`);
      if (!ok) return;
      try {
        await cardsApi.remove(card.id);
        this.photos = this.photos.filter((p) => p.id !== card.id);
        await this._loadCalendarRange();
        this.closeViewer();
      } catch (err) {
        window.alert(err.message || "Couldn't delete that memory.");
      }
    },

    /* ========================= calendar =========================== */

    async _loadCalendarRange() {
      const { from, to } = rangeForMonth(this.calYear, this.calMonth);
      try {
        const data = await calendarApi.range(from, to);
        this.events = data?.events ?? [];
      } catch {
        this.events = [];
      }
      this._rebuildCalendar();
    },

    _rebuildCalendar() {
      const memories = this.photos.filter((p) => p.memory_date);
      this.cells = buildMonthGrid(this.calYear, this.calMonth, this.events, memories);
    },

    moveMonth(delta) {
      const d = new Date(this.calYear, this.calMonth + delta, 1);
      this.calYear = d.getFullYear();
      this.calMonth = d.getMonth();
      if (this.demoMode) this._rebuildCalendar();
      else this._loadCalendarRange();
    },

    openDay(cell) {
      this.dayCell = cell;
    },

    /* =========================== decks ============================ */

    deckTabs: [],
    get deckMeta() { return DECK_META[this.deckCategory] ?? DECK_META.love; },

    setDeck(id) {
      this.deckCategory = id;
      this.$nextTick(() => {
        const row = this.$refs.deckRow;
        if (row) row.scrollTo({ left: 0, behavior: 'smooth' });
        revealTab(this.deckTabRefs[id], this.$refs.deckRow);
      });
    },

    pageDeck(dir) { pageBy(this.$refs.deckRow, dir); },
    onDeckKey(e) { onRowKeydown(e, this.$refs.deckRow); },

    /* ============================ jar ============================= */

    get jarTotal() { return this._jar?.count ?? 0; },
    get jarRemaining() { return this._jar?.peekCount() ?? 0; },

    async drawPromise() {
      if (!this._jar || this.jarDrawing) return;
      this.jarDrawing = true;
      this.jarNote = null;

      // Let the shake animation register before swapping the text in.
      await new Promise((r) => setTimeout(r, 260));
      this.jarNote = this._jar.draw();
      this._jar.settle();
      this.jarDrawing = false;
    },

    /* =========================== admin ============================ */

    openAdmin(card = null, editing = false) {
      this.adminError = null;
      this.admin = {
        open: true,
        step: 'pick',
        editing,
        preview: card?.photo_url ?? null,
        errors: {},
        form: {
          title: card?.title ?? '',
          letter_text: card?.letter_text ?? '',
          memory_date: card?.memory_date ?? '',
        },
      };
      this._existingCard = editing ? card : null;
      document.body.style.overflow = 'hidden';
    },

    closeAdmin() {
      this._cropper?.teardown();
      this._cropper = null;
      this.admin = { open: false, step: 'pick', editing: false, form: {}, errors: {}, preview: null };
      this._existingCard = null;
      this.adminError = null;
      document.body.style.overflow = '';
    },

    get adminStep() {
      if (this.admin.editing) return 'Update the details for this memory.';
      return { pick: 'Step 1 of 3 · choose a photo', crop: 'Step 2 of 3 · frame it', details: 'Step 3 of 3 · add the letter' }[
        this.admin.step
      ] ?? '';
    },

    async onFilePicked(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.adminError = null;

      if (!this._cropper) {
        this._cropper = createCropper({
          onUpdate: () => {
            /* step transitions are driven explicitly below */
          },
        });
      }

      try {
        await this._cropper.load(file, this.$refs.cropImage);
        this.admin.step = 'crop';
      } catch (err) {
        this.adminError = err.message;
        event.target.value = '';
      }
    },

    cropRotate() { this._cropper?.rotate(); },
    cropReset() { this._cropper?.reset(); },
    cropTeardown() {
      this._cropper?.teardown();
      this.admin.step = 'pick';
    },

    async confirmCrop() {
      if (!this._cropper?.ready) return;
      this.cropBusy = true;
      this.adminError = null;
      try {
        const urls = await this._cropper.commit();
        this.admin.form.photo_url = urls.photo_url;
        this.admin.form.photo_original_url = urls.photo_original_url;
        this.admin.preview = urls.photo_url;
        this.admin.step = 'details';
      } catch (err) {
        this.adminError = err.message || "Couldn't prepare that photo.";
      } finally {
        this.cropBusy = false;
      }
    },

    async saveMemory() {
      const { valid, errors } = validateCard(this.admin.form);
      this.admin.errors = errors;
      if (!valid) {
        this.adminError = 'Please fix the highlighted fields.';
        return;
      }

      this.saveBusy = true;
      this.adminError = null;
      try {
        if (this.demoMode) {
          const local = {
            id: `local-${Date.now()}`,
            photo_url: this.admin.form.photo_url,
            photo_original_url: this.admin.form.photo_original_url ?? null,
            title: this.admin.form.title,
            letter_text: this.admin.form.letter_text,
            memory_date: this.admin.form.memory_date || null,
            created_at: new Date().toISOString(),
          };
          this.photos = this.admin.editing
            ? this.photos.map((p) => (p.id === this._existingCard.id ? { ...p, ...local, id: p.id } : p))
            : [local, ...this.photos];
          this._rebuildCalendar();
        } else if (this.admin.editing) {
          await cardsApi.update({ id: this._existingCard.id, ...this.admin.form });
          this.photos = this.photos.map((p) =>
            p.id === this._existingCard.id ? { ...p, ...this.admin.form } : p,
          );
          await this._loadCalendarRange();
        } else {
          const created = await saveCard(this.admin.form, this._cropper);
          this.photos = [created, ...this.photos];
          await this._loadCalendarRange();
        }
        this.closeAdmin();
      } catch (err) {
        this.adminError = err.message || "Couldn't save that memory.";
      } finally {
        this.saveBusy = false;
      }
    },

    /* ========================== helpers =========================== */

    monthLabel(y, m) { return monthLabelFor(y, m); },

    get legend() {
      return Object.entries(EVENT_EMOJI).map(([type, emoji]) => ({
        type,
        emoji,
        label: EVENT_LABEL[type],
      }));
    },

    emojiForType(type) { return EVENT_EMOJI[type] ?? '💗'; },

    emojiFor(cell) {
      const types = cell.events.map((e) => e.icon_type);
      return types.slice(0, 2).map((t) => this.emojiForType(t)).join('');
    },

    dayLabel(cell) {
      const date = parseYmd(cell.key);
      const base = `${date ? date.toLocaleDateString(undefined, { dateStyle: 'full' }) : cell.key}`;
      if (!cell.events.length && !cell.memories.length) return `${base} — nothing marked`;
      const parts = [];
      if (cell.events.length) parts.push(`${cell.events.length} event${cell.events.length === 1 ? '' : 's'}`);
      if (cell.memories.length) parts.push(`${cell.memories.length} memor${cell.memories.length === 1 ? 'y' : 'ies'}`);
      return `${base} — ${parts.join(', ')}`;
    },

    fmtDate(iso) {
      const d = parseYmd(iso);
      return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : '';
    },

    longDate(iso) {
      const d = parseYmd(iso);
      if (!d) return iso;
      return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    },

    _makeHearts() {
      const glyphs = ['💗', '💕', '🩷', '💖'];
      this.hearts = Array.from({ length: 14 }, (_, i) => ({
        id: i,
        glyph: glyphs[i % glyphs.length],
        style: [
          `left:${5 + Math.random() * 85}%`,
          `bottom:${-10 - Math.random() * 40}%`,
          `font-size:${14 + Math.random() * 22}px`,
          `opacity:${0.18 + Math.random() * 0.3}`,
          `--float-duration:${11 + Math.random() * 10}s`,
          `--float-delay:${-Math.random() * 18}s`,
        ].join(';'),
      }));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

document.addEventListener('alpine:init', () => {
  window.Alpine.data('appShell', () => {
    const s = appShell();
    // Deck tab metadata is static — build it once per instance.
    s.deckTabs = categories().map((id) => ({ id, ...DECK_META[id] }));
    return s;
  });
});

/* A lapsed session anywhere in the app returns us to the lock screen. The
   401 handler in api.js fires `auth:expired`; the shell reacts by dropping
   the authenticated UI. */
window.addEventListener('auth:expired', () => {
  const el = document.querySelector('[x-data]');
  if (!el || !window.Alpine) return;
  const data = window.Alpine.$data(el);
  if (!data || data.demoMode) return;
  data._typer?.cancel();
  data._stopCountdown?.();
  data._player?.destroy();
  data.countdown = null;
  data.authed = false;
  document.body.style.overflow = '';
});

export { appShell };