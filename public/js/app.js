/**
 * App shell — Alpine state and all module wiring.
 *
 * Two data sources:
 *   • live  → the PHP API in /api (needs a valid session cookie)
 *   • demo  → js/demo.js, activated only with `?demo=1`, so the UI can be
 *             reviewed before Supabase + PHP are configured
 *
 * WHY ALPINE IS IMPORTED AND STARTED HERE, NOT FROM A <script> TAG
 *
 * The CDN build of Alpine calls start() itself. Loading it from a <script>
 * tag makes registration order a race: if Alpine starts before this module
 * has run, the `alpine:init` event has already fired, Alpine.data() is never
 * registered, and every x-data expression fails with
 * "appShell is not defined".
 *
 * That is exactly what happened on the first deploy. The ESM build does NOT
 * auto-start, so importing it here and calling Alpine.start() ourselves makes
 * the order deterministic: register first, then start. It is also vendored,
 * so there is no runtime CDN dependency.
 */

import Alpine from './vendor/alpine.esm.js';
import { authApi, cardsApi, calendarApi, decksApi, settingsApi, tracksApi, uploadApi, versionApi } from './api.js';
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

/*
 * Calendar event kinds, derived from the server's EVENT_EMOJI/EVENT_LABEL so
 * the picker, the legend and the day markers can never drift out of sync.
 *
 * The ids MUST match the icon_type CHECK constraint in db/001_schema.sql:
 *   check (icon_type in ('anniversary','monthsary','date','sorry','heart'))
 * and ICON_TYPES in api/calendar.php. Adding a value here without a migration
 * would fail at insert time with a constraint violation.
 */
const EVENT_TYPES = Object.keys(EVENT_EMOJI).map((id) => ({
  id,
  label: EVENT_LABEL[id],
  emoji: EVENT_EMOJI[id],
}));

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
    calJumpOpen: false,
    _jumpTimer: 0,

    /* decks */
    deckCategory: 'sorry',
    deckTabRefs: {},
    deckRow: null,
    deckEdit: { open: false, id: null, category: 'sorry', title: '', content: '', errors: {} },
    deckBusy: false,
    deckError: null,

    /* jar */
    jarNote: null,
    jarDrawing: false,

    /* music */
    music: {
      ready: false, playing: false, track: null, index: 0, volume: 1, muted: false,
      tracks: [], sourceType: null, playable: false, visualizer: false,
      popoverOpen: false, progress: 0, error: null, listError: null,
      elapsed: 0, duration: 0,
    },
    /* Deployed commit, from /api/version. Shown in the footer so a stale bundle
       is obvious rather than a mystery. "local" locally, "unknown" if the
       endpoint is missing, which is itself the answer. */
    build: { short: '…', env: null },
    get buildShort() {
      return this.build.short;
    },

    trackSources: TRACK_SOURCES,
    trackForm: { title: '', source_type: 'file', url: '', file: null },
    trackError: null,
    trackBusy: false,
    trackUploadProgress: 0,
    trackUploadedPath: null,

    /* admin */
    admin: { open: false, step: 'pick', editing: false, form: {}, errors: {}, preview: null },
    adminError: null,
    cropBusy: false,
    saveBusy: false,

    /* settings */
    settingsOpen: false,
    settingsBusy: false,
    settingsError: null,
    settingsForm: { anchor_date: '', site_title: '', partner_names: '', music_volume: 1 },
    settingsErrors: {},
    passcodeForm: { current: '', next: '', confirm: '' },
    passcodeBusy: false,
    passcodeError: null,

    /* calendar event editor */
    eventEdit: {
      open: false, id: null, event_date: '', title: '',
      description: '', icon_type: 'date', errors: {},
    },
    eventBusy: false,
    eventError: null,
    eventTypes: EVENT_TYPES,

    /* internal */
    _jar: null,
    _player: null,
    _cropper: null,
    _typer: null,
    _stopCountdown: null,
    _existingCard: null,
    _headerObserver: null,

    /* ======================== lifecycle =========================== */

    /**
     * Ask the server which commit is serving this page.
     *
     * Reported rather than fetched inline at boot, because a failure here must
     * never block the app — the whole point is to answer "am I looking at the
     * build I think I am?", and a network blip is not that.
     */
    async _loadBuild() {
      try {
        const info = await versionApi.get();
        this.build = { short: info?.short ?? 'unknown', env: info?.env ?? null };
      } catch {
        this.build = { short: 'offline', env: null };
      }
    },

    async boot() {
      this.bootError = null;
      this._makeHearts();
      this._jar = createJar();
      this._watchHeader();

      // Fire and forget: the footer build number is diagnostics, and boot must
      // not wait on it or fail because of it.
      this._loadBuild();

      if (this.demoMode) {
        this._loadDemo();
        this.authed = true;
        this.loading = false;
        this._startRuntime();
        return;
      }

      try {
        const status = await authApi.status();
        this.authed = Boolean(status?.authenticated);
      if (this.authed) {
        await this._loadAll();
        // The session cookie can already be valid on a plain page reload,
        // which is how most sessions actually begin. Without this the clock
        // and the player were never started on any reload -- see
        // _startRuntime for what that broke.
        this._startRuntime();
      } else {
        this.loading = false;
      }
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
        this._startRuntime();
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
      this.closeSettings();
      this.closeEventEdit();
      this.closeDeckEdit();
      this._stopCountdown?.();
      this._stopCountdown = null;
      this._player?.destroy();
      this._player = null;
      this._headerObserver?.disconnect();
      this._headerObserver = null;
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

    /**
     * Start everything that only makes sense once authenticated: the countdown
     * clock and the music player.
     *
     * This exists because the three ways into the authenticated app each used to
     * call these separately, and only two of them did. On a page RELOAD with a
     * still-valid session cookie, boot() authenticated and loaded data but never
     * started them, which produced two confusing symptoms at once:
     *
     *   - "No anchor date yet", even though anchor_date was loaded and present.
     *     The header renders that message whenever `countdown` is null, and the
     *     countdown only becomes non-null once the clock ticks. It was never
     *     ticking, so a perfectly good anchor date looked unset.
     *   - The queue stayed empty and nothing was playable. `this._player` stayed
     *     null, so after a successful upload `this._player?.refresh()` silently
     *     no-opped — the track row was written to the database and the UI just
     *     never learned about it.
     *
     * Idempotent, so calling it from every entry point is safe.
     */
    _startRuntime() {
      this._startClock();
      this._startPlayer();
    },

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
      this.trackUploadProgress = 0;
      this.trackUploadedPath = null;

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
            // Uploaded audio goes DIRECTLY to Supabase via a signed URL.
            // Vercel rejects function bodies over 4.5 MB before PHP runs, so a
            // 5 MB mp3 cannot be streamed through /api/upload at all.
            const uploaded = await uploadApi.sendDirect(this.trackForm.file, 'audio', {
              onProgress: (f) => {
                this.trackUploadProgress = Math.round(f * 100);
              },
            });
            sourceUrl = uploaded.url;
            this.trackUploadedPath = uploaded.path;

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

          await this._reloadTracksOrThrow();
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
          await this._reloadTracksOrThrow();
        }

        this.trackForm = { title: '', source_type: kind, url: '', file: null };
      } catch (err) {
        this.trackError = err.message || "Couldn't add that track.";
      } finally {
        this.trackBusy = false;
      }
    },

    /**
     * Reload the queue and PROVE the new track is in it.
     *
     * The upload and the track row are separate writes; only a re-read confirms
     * the UI knows about them. `this._player?.refresh()` was optional-chained,
     * which meant that when the player had not been started — the state left
     * behind by any page reload — the refresh silently did nothing. The row was
     * written, the upload succeeded, the button stopped spinning, the form
     * cleared, and the queue stayed empty with no error anywhere. That is
     * exactly the reported symptom, and it repeated three times in a row.
     *
     * So a missing player is now a hard, visible failure rather than a no-op,
     * and a still-empty queue after a successful save is reported too.
     */
    async _reloadTracksOrThrow() {
      if (!this._player) {
        throw new Error(
          'The track was saved, but the music player did not start, so it is '
          + 'not in the queue. Reload the page and try again.',
        );
      }

      const after = await this._player.refresh();

      if (after?.listError) {
        throw new Error(
          `The track was saved, but the queue could not be reloaded. ${after.listError}`,
        );
      }

      if (after && after.count === 0) {
        throw new Error(
          'The track was saved, but it did not appear in the queue. '
          + 'Reload the page to see it.',
        );
      }
    },

    /** Retry a failed track-list load without reloading the whole app. */
    async reloadTracks() {
      if (!this._player) {
        this.trackError =
          'The music player did not start. Reload the page to load your tracks.';
        return;
      }
      await this._player.refresh();
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
      this.calJumpOpen = false;
      if (this.demoMode) this._rebuildCalendar();
      else this._loadCalendarRange();
    },

    /* ---------------- month / year jump ---------------- */

    get calYears() {
      const now = new Date().getFullYear();
      const span = [];
      // Five years back, five forward: enough to reach any plausible
      // anniversary without an unbounded list.
      for (let y = now - 5; y <= now + 5; y += 1) span.push(y);
      if (!span.includes(this.calYear)) span.push(this.calYear);
      return span.sort((a, b) => a - b);
    },

    get calMonths() {
      return [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
    },

    jumpToToday() {
      const now = new Date();
      this.calYear = now.getFullYear();
      this.calMonth = now.getMonth();
      this.calJumpOpen = false;
      if (this.demoMode) this._rebuildCalendar();
      else this._loadCalendarRange();
    },

    jumpTo(month, year) {
      this.calYear = year;
      this.calMonth = month;
      this.calJumpOpen = false;
      if (this.demoMode) this._rebuildCalendar();
      else this._loadCalendarRange();
    },

    /** Jumping must not thrash the API if a user clicks through the picker. */
    queueJump() {
      clearTimeout(this._jumpTimer);
      this._jumpTimer = setTimeout(() => {
        if (this.demoMode) this._rebuildCalendar();
        else this._loadCalendarRange();
      }, 120);
    },

    openDay(cell) {
      this.dayCell = cell;
    },

    /**
     * Keep the tab bar's sticky offset equal to the header's real height.
     *
     * The header is not a fixed size: the countdown block appears and
     * disappears, and the title row wraps on narrow screens. A hardcoded offset
     * left the tab strip either floating in a gap or overlapping the header,
     * and content scrolled between the two.
     */
    syncHeaderOffset() {
      const header = this.$refs.appHeader;
      if (!header) return;
      const h = Math.ceil(header.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty('--header-h', `${h}px`);
      }
    },

    _watchHeader() {
      if (this._headerObserver || typeof ResizeObserver === 'undefined') {
        this.syncHeaderOffset();
        return;
      }
      this._headerObserver = new ResizeObserver(() => this.syncHeaderOffset());
      this._headerObserver.observe(this.$refs.appHeader);
      this.syncHeaderOffset();
    },

    /* --------------------- calendar event CRUD --------------------- */

    /** Open the editor to mark `key` (a YYYY-MM-DD date) as a special day. */
    markDay(key) {
      this.eventError = null;
      this.eventEdit = {
        open: true,
        id: null,
        event_date: key,
        title: '',
        description: '',
        icon_type: 'date',
        errors: {},
      };
    },

    editEvent(ev) {
      this.eventError = null;
      this.eventEdit = {
        open: true,
        id: ev.id,
        event_date: ev.event_date,
        title: ev.title,
        description: ev.description ?? '',
        icon_type: ev.icon_type,
        errors: {},
      };
    },

    closeEventEdit() {
      this.eventEdit = {
        open: false, id: null, event_date: '', title: '',
        description: '', icon_type: 'date', errors: {},
      };
      this.eventError = null;
    },

    async saveEvent() {
      const title = (this.eventEdit.title ?? '').trim();
      const description = (this.eventEdit.description ?? '').trim();
      const date = this.eventEdit.event_date;

      const errors = {};
      if (!date) errors.event_date = 'Pick a date.';
      if (!title) errors.title = 'Give this day a name.';
      else if (title.length > 255) errors.title = 'Title must be 255 characters or fewer.';

      if (Object.keys(errors).length) {
        this.eventEdit.errors = errors;
        return;
      }

      this.eventBusy = true;
      this.eventError = null;

      try {
        const payload = {
          event_date: date,
          title,
          description: description || null,
          icon_type: this.eventEdit.icon_type,
        };

        if (this.eventEdit.id) {
          await calendarApi.update({ id: this.eventEdit.id, ...payload });
        } else {
          await calendarApi.create(payload);
        }

        await this._loadCalendarRange();

        // Keep the open day popover in sync when the edit came from it, so the
        // marker appears immediately rather than on the next month change.
        if (this.dayCell) {
          const cell = this.cells.find((c) => c.key === date);
          if (cell) this.dayCell = cell;
        }

        this.closeEventEdit();
      } catch (err) {
        this.eventError = err.message || "Couldn't save that day.";
      } finally {
        this.eventBusy = false;
      }
    },

    async removeEvent(ev) {
      const ok = window.confirm(`Remove "${ev.title}" from this day?`);
      if (!ok) return;
      try {
        if (this.demoMode) {
          this.events = this.events.filter((e) => e.id !== ev.id);
          if (this.dayCell) {
            this.dayCell = {
              ...this.dayCell,
              events: this.dayCell.events.filter((e) => e.id !== ev.id),
            };
          }
        } else {
          await calendarApi.remove(ev.id);
          await this._loadCalendarRange();
          if (this.dayCell) {
            const cell = this.cells.find((c) => c.key === ev.event_date);
            if (cell) this.dayCell = cell;
          }
        }
      } catch (err) {
        window.alert(err.message || "Couldn't remove that day.");
      }
    },

    /* ========================== settings ============================ */

    openSettings() {
      this.settingsError = null;
      this.passcodeError = null;
      this.settingsErrors = {};
      // Copy out of `settings` so cancelling genuinely discards changes —
      // binding x-model straight to the loaded object would persist a
      // half-typed title just by opening and closing this modal.
      this.settingsForm = {
        anchor_date: this.settings.anchor_date ?? '',
        site_title: this.settings.site_title ?? '',
        partner_names: this.settings.partner_names ?? '',
        music_volume: Number(this.settings.music_volume ?? 1),
      };
      this.passcodeForm = { current: '', next: '', confirm: '' };
      this.settingsOpen = true;
      document.body.style.overflow = 'hidden';
    },

    closeSettings() {
      this.settingsOpen = false;
      this.settingsError = null;
      this.passcodeError = null;
      document.body.style.overflow = '';
    },

    async saveSettings() {
      const title = (this.settingsForm.site_title ?? '').trim();
      const partners = (this.settingsForm.partner_names ?? '').trim();

      const errors = {};
      if (!title) errors.site_title = 'Give the site a name.';
      else if (title.length > 120) errors.site_title = 'That name is too long.';
      if (partners.length > 120) errors.partner_names = 'That name is too long.';
      if (this.settingsForm.anchor_date && !/^\d{4}-\d{2}-\d{2}$/.test(this.settingsForm.anchor_date)) {
        errors.anchor_date = 'Use a valid date.';
      }

      if (Object.keys(errors).length) {
        this.settingsErrors = errors;
        return;
      }

      this.settingsBusy = true;
      this.settingsError = null;

      try {
        if (this.demoMode) {
          this.settings = {
            ...this.settings,
            anchor_date: this.settingsForm.anchor_date || null,
            site_title: title,
            partner_names: partners,
            music_volume: Math.round(Number(this.settingsForm.music_volume) * 100) / 100,
          };
        } else {
          const updated = await settingsApi.update({
            anchor_date: this.settingsForm.anchor_date || null,
            site_title: title,
            partner_names: partners,
            // The server validates music_volume as an int 0..100 and divides by
            // 100 before storing, while what comes back (and what audio.volume
            // wants) is a 0..1 fraction. Sending the fraction straight through
            // would be cast to int 0 and store silence — send percent.
            music_volume: Math.round(Number(this.settingsForm.music_volume) * 100),
          });
          this.settings = { ...this.settings, ...updated };
        }

        // The countdown reads the anchor through a getter, so restart it or it
        // keeps ticking against the previous value. _startClock stops the
        // existing timer itself.
        this._startClock();

        this._player?.setVolume(Number(this.settingsForm.music_volume));

        this.closeSettings();
      } catch (err) {
        this.settingsError = err.message || "Couldn't save your settings.";
      } finally {
        this.settingsBusy = false;
      }
    },

    async changePasscode() {
      const { current, next, confirm: again } = this.passcodeForm;

      if (!current) {
        this.passcodeError = 'Enter the current passcode.';
        return;
      }
      if (String(next).length < 4) {
        this.passcodeError = 'A new passcode needs at least 4 characters.';
        return;
      }
      if (next !== again) {
        this.passcodeError = "The two new passcodes don't match.";
        return;
      }

      this.passcodeBusy = true;
      this.passcodeError = null;

      try {
        await authApi.changePasscode({ current_passcode: current, new_passcode: next });
        this.passcodeForm = { current: '', next: '', confirm: '' };
        // Say so plainly: after this the old passcode no longer works and they
        // need to remember the new one, there is no second copy anywhere.
        window.alert('Passcode changed. Use the new one next time you open this.');
      } catch (err) {
        this.passcodeError = err.message || "Couldn't change the passcode.";
      } finally {
        this.passcodeBusy = false;
      }
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

    /* -------------------- deck card CRUD -------------------- */

    newDeckCard() {
      this.deckError = null;
      this.deckEdit = {
        open: true,
        id: null,
        category: this.deckCategory,
        title: '',
        content: '',
        errors: {},
      };
      document.body.style.overflow = 'hidden';
    },

    editDeckCard(card) {
      this.deckError = null;
      this.deckEdit = {
        open: true,
        id: card.id,
        category: card.category,
        title: card.title,
        content: card.content,
        errors: {},
      };
      document.body.style.overflow = 'hidden';
    },

    closeDeckEdit() {
      this.deckEdit = { open: false, id: null, category: 'sorry', title: '', content: '', errors: {} };
      this.deckError = null;
      document.body.style.overflow = '';
    },

    async saveDeckCard() {
      const title = (this.deckEdit.title ?? '').trim();
      const content = (this.deckEdit.content ?? '').trim();

      const errors = {};
      if (!title) errors.title = 'Give the card a title.';
      else if (title.length > 255) errors.title = 'Title must be 255 characters or fewer.';
      if (!content) errors.content = 'Write what this card says.';
      else if (content.length > 20000) errors.content = 'That card is too long.';

      if (Object.keys(errors).length) {
        this.deckEdit.errors = errors;
        return;
      }

      this.deckBusy = true;
      this.deckError = null;

      try {
        if (this.demoMode) {
          if (this.deckEdit.id) {
            this.decks[this.deckCategory] = (this.decks[this.deckCategory] ?? []).map((c) =>
              c.id === this.deckEdit.id ? { ...c, title, content } : c,
            );
          } else {
            this.decks[this.deckCategory] = [
              {
                id: `demo-${Date.now()}`,
                category: this.deckEdit.category,
                title,
                content,
                created_at: new Date().toISOString(),
              },
              ...(this.decks[this.deckCategory] ?? []),
            ];
          }
        } else if (this.deckEdit.id) {
          await decksApi.update({ id: this.deckEdit.id, title, content });
          for (const key of Object.keys(this.decks)) {
            this.decks[key] = (this.decks[key] ?? []).map((c) =>
              c.id === this.deckEdit.id ? { ...c, title, content } : c,
            );
          }
        } else {
          const created = await decksApi.create({
            category: this.deckEdit.category,
            title,
            content,
          });
          this.decks[this.deckEdit.category] = [
            created,
            ...(this.decks[this.deckEdit.category] ?? []),
          ];
        }
        this.closeDeckEdit();
      } catch (err) {
        this.deckError = err.message || "Couldn't save that card.";
      } finally {
        this.deckBusy = false;
      }
    },

    async removeDeckCard(card) {
      const ok = window.confirm(`Delete "${card.title}"? This can't be undone.`);
      if (!ok) return;
      try {
        if (this.demoMode) {
          this.decks[card.category] = (this.decks[card.category] ?? []).filter(
            (c) => c.id !== card.id,
          );
        } else {
          await decksApi.remove(card.id);
          for (const key of Object.keys(this.decks)) {
            this.decks[key] = (this.decks[key] ?? []).filter((c) => c.id !== card.id);
          }
        }
      } catch (err) {
        window.alert(err.message || "Couldn't delete that card.");
      }
    },

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
      this._cropper?.teardown();
      this._cropper = null;

      // When EDITING, land on the details step. Forcing a re-pick made it
      // impossible to fix a typo in the letter without hunting for the photo
      // again, and impossible to re-crop without starting over.
      this.admin = {
        open: true,
        step: editing ? 'details' : 'pick',
        editing,
        preview: card?.photo_url ?? null,
        // Carried over so saving details-only does not null them out.
        photo_url: card?.photo_url ?? '',
        photo_original_url: card?.photo_original_url ?? '',
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

    /** Re-open the cropper for a card that already exists. */
    async recropCard() {
      const card = this._existingCard;
      if (!card) return;

      const source = card.photo_original_url || card.photo_url;
      this.adminError = null;

      try {
        if (!this._cropper) {
          this._cropper = createCropper({ onUpdate: () => {} });
        }
        // Load the ORIGINAL so a re-crop is not compounding a previous crop.
        // This needs the CORS headers Supabase Storage sends, otherwise the
        // canvas is tainted and toBlob() throws a SecurityError.
        await this._cropper.loadFromUrl(source, this.$refs.cropImage);
        this.admin.step = 'crop';
      } catch (err) {
        this.adminError = err.message || "Couldn't load that photo for re-cropping.";
      }
    },

    

    closeAdmin() {
      this._cropper?.teardown();
      this._cropper = null;
      this.admin = {
        open: false, step: 'pick', editing: false, form: {},
        errors: {}, preview: null, photo_url: '', photo_original_url: '',
      };
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
          // Only send the image fields if a re-crop actually happened, so a
          // details-only edit cannot blank them.
          const patch = {
            id: this._existingCard.id,
            title: this.admin.form.title,
            letter_text: this.admin.form.letter_text,
            memory_date: this.admin.form.memory_date || null,
          };
          if (this.admin.form.photo_url && this.admin.form.photo_url !== this._existingCard.photo_url) {
            patch.photo_url = this.admin.form.photo_url;
            patch.photo_original_url = this.admin.form.photo_original_url || null;
          }

          await cardsApi.update(patch);
          // A re-crop on the edit path uploaded fresh objects. The row now
          // references them, so they are no longer orphans — otherwise a later
          // failure would delete images this card depends on.
          this._cropper?.releaseUploads();
          this.photos = this.photos.map((p) =>
            p.id === this._existingCard.id ? { ...p, ...patch } : p,
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

    /** Human-readable file size for the upload pickers. */
    fmtBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return 'mp3, m4a, ogg or wav';
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    },

    /**
     * Seconds -> "m:ss", or "h:mm:ss" past an hour.
     *
     * NaN and Infinity both become 0:00. `audio.duration` is NaN until metadata
     * loads and Infinity for a stream, and a player that briefly shows
     * "NaN:NaN" looks broken even though it is only waiting for the header.
     */
    fmtTime(seconds) {
      const total = Math.floor(Number(seconds));
      if (!Number.isFinite(total) || total < 0) return '0:00';
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    },

    /** Scrub the transport. Fraction 0..1, matching music.progress. */
    seekMusic(fraction) {
      this._player?.seekTo(fraction);
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
 *
 * Registration is unconditional — we own the start order, so there is no
 * event to miss. If anything in this module throws, Alpine must NOT start:
 * a half-initialised tree produces hundreds of confusing expression errors
 * instead of one honest message.
 * ------------------------------------------------------------------ */

window.Alpine = Alpine;

try {
  Alpine.data('appShell', () => {
    const shell = appShell();
    // Deck tab metadata is static — build it once per instance.
    shell.deckTabs = categories().map((id) => ({ id, ...DECK_META[id] }));
    return shell;
  });

  // A lapsed session anywhere in the app returns us to the lock screen. The
  // 401 handler in api.js fires `auth:expired`.
  window.addEventListener('auth:expired', () => {
    const el = document.querySelector('[x-data]');
    if (!el) return;
    const data = Alpine.$data(el);
    if (!data || data.demoMode) return;
    data._typer?.cancel();
    data._stopCountdown?.();
    data._player?.destroy();
    data._headerObserver?.disconnect();
    data.countdown = null;
    data.authed = false;
    document.body.style.overflow = '';
  });

  Alpine.start();
} catch (err) {
  showFatal(err);
}

/** Replace the page with one honest error instead of a wall of console noise. */
function showFatal(err) {
  const message = err?.message || String(err);
  console.error('[pinky-promise] startup failed:', err);

  document.body.innerHTML = `
    <div class="grid min-h-dvh place-items-center bg-blush p-6">
      <div class="glass-strong max-w-md rounded-card p-8 text-center">
        <h1 class="text-heading text-ink-strong">The app couldn't start</h1>
        <p class="mt-2 text-body text-ink-muted">
          This is a code problem, not a data problem — nothing has been lost.
        </p>
        <pre class="mt-4 overflow-auto rounded-input bg-white/60 p-3 text-left text-xs text-destructive">${String(message).replace(/[<>&]/g, '')}</pre>
        <button onclick="location.reload()"
          class="mt-5 min-h-11 rounded-input bg-rose-deep px-5 text-body font-bold text-white">
          Reload
        </button>
      </div>
    </div>`;
}

export { appShell };
