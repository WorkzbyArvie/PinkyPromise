/**
 * Persistent background music bar with per-source transports.
 *
 * Three source types, each with different capabilities:
 *
 *   file     — our own upload or a direct audio URL.
 *              Full transport + the canvas visualiser, because the audio is
 *              same-origin and therefore reachable by an AnalyserNode.
 *
 *   youtube  — plays in-page through the official IFrame embed. Transport
 *              works, but the audio lives in a cross-origin iframe, so the
 *              visualiser CANNOT run (Chromium returns zeroes for cross-origin
 *              MediaElementAudioSourceNode). Shown as a static equaliser.
 *
 *   spotify  — cannot be embedded by third parties. The play control becomes
 *              an "Open in Spotify" hand-off instead of playback.
 */

import {
  isPlayableInPage,
  supportsVisualizer,
  spotifyOpenUrl,
  parseSpotify,
} from './sources.js';

/* ------------------------------------------------------------------ *
 * YouTube IFrame API — loaded lazily, only when a YT track is played.
 * ------------------------------------------------------------------ */

let ytApiPromise = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => reject(new Error("YouTube didn't load.")), 15000);

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      prev?.();
      resolve(window.YT);
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Couldn't reach YouTube."));
    };
    document.head.appendChild(tag);
  });

  return ytApiPromise;
}

/* ------------------------------------------------------------------ */

const idleBars = 7;

export function createPlayer({ onState } = {}) {
  /* ---------------- file transport ---------------- */
  const audio = new Audio();

  /*
   * MUST be set before any src is assigned.
   *
   * The visualiser routes this element through Web Audio via
   * createMediaElementSource(), and Web Audio refuses to read a cross-origin
   * media element that was not fetched in CORS mode — it "outputs zeroes" and
   * playback stalls. Supabase Storage does send Access-Control-Allow-Origin: *
   * on public objects, so the only thing missing was this opt-in: without it the
   * browser fetches the audio untainted, the analyser reads silence, and the
   * console fills with
   *   "MediaElementAudioSource outputs zeroes due to CORS access restrictions"
   *
   * Setting it after the first load is too late — the element is already
   * tainted and needs a reload — so it goes here, at construction.
   */
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';

  let ctx = null;
  let analyser = null;
  let dataArray = null;
  let graphStarted = false;
  let rafId = 0;

  /* ---------------- youtube transport ---------------- */
  let ytPlayer = null;
  let ytSlot = null; // the throwaway div YT replaces with an iframe
  let ytMount = null; // the stable container that lives in the DOM
  let ytPopoverOpen = false;
  let ytProgress = 0;
// Raw seconds for the timestamp readout; ytProgress alone is only a ratio.
let ytElapsed = 0;
let ytDuration = 0;

  /* ---------------- shared ---------------- */
  let tracks = [];
  let index = 0;
  let lastError = null;
// Failure to LOAD the list, as opposed to a playback failure. Kept apart so
// "the server is unreachable" never masquerades as "you have no songs".
let listError = null;
  let progressTimer = 0;

  function current() {
    return tracks[index] ?? null;
  }

  function sourceType() {
    return current()?.source_type ?? null;
  }

  const state = () => ({
    ready: tracks.length > 0,
    playing: playingNow(),
    track: current(),
    index,
    tracks,
    count: tracks.length,
    volume: audio.volume,
    muted: sourceType() === 'youtube' ? ytMuted() : audio.muted,
    error: lastError,
    // Separate from `error`, which is a PLAYBACK failure. This is the list
    // failing to load at all — previously indistinguishable from "no tracks",
    // so a broken /api/tracks rendered as an empty playlist with no message.
    listError: listError || null,
    sourceType: sourceType(),
    playable: tracks.length ? isPlayableInPage(sourceType()) : false,
    visualizer: tracks.length ? supportsVisualizer(sourceType()) : false,
    popoverOpen: ytPopoverOpen,
    progress: progressNow(),
    // Raw seconds for the "1:04 / 3:27" readout. duration is 0 until metadata
    // arrives, which the formatter renders as 0:00 rather than NaN:NaN.
    elapsed: timesNow().elapsed,
    duration: timesNow().duration,
  });

  function playingNow() {
    if (sourceType() === 'youtube') return ytPlaying();
    if (sourceType() === 'file') return !audio.paused;
    return false;
  }

  function progressNow() {
    if (sourceType() === 'youtube') return ytProgress;
    if (sourceType() === 'file' && audio.duration && Number.isFinite(audio.duration)) {
      return audio.currentTime / audio.duration;
    }
    return 0;
  }

  /*
   * Elapsed and total seconds, for a "1:04 / 3:27" readout.
   *
   * duration is NaN until metadata arrives, and Infinity for a stream, so both
   * collapse to 0 rather than rendering "NaN:NaN". Spotify shows "--:--" in that
   * window; a zero total with the elapsed count is honest and simpler.
   */
  function timesNow() {
    if (sourceType() === 'youtube') {
      return { elapsed: ytElapsed || 0, duration: ytDuration || 0 };
    }
    if (sourceType() === 'file') {
      const d = audio.duration;
      return {
        elapsed: audio.currentTime || 0,
        duration: Number.isFinite(d) && d > 0 ? d : 0,
      };
    }
    return { elapsed: 0, duration: 0 };
  }

  /**
   * Seek to a fraction of the track (0..1).
   *
   * Spotify's bar is a control, not a readout, so this is what makes the
   * progress bar scrubbable. Guarded because a seek with no loaded duration
   * would set currentTime to NaN and wedge the element.
   */
  function seekTo(fraction) {
    const f = Number(fraction);
    if (!Number.isFinite(f)) return;

    if (sourceType() === 'youtube') {
      const d = ytDuration || 0;
      if (d > 0) ytPlayer?.seekTo?.(Math.max(0, Math.min(1, f)) * d, true);
      return;
    }

    if (sourceType() !== 'file') return;
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    audio.currentTime = Math.max(0, Math.min(1, f)) * d;
    emit();
  }

  function emit() {
    onState?.(state());
  }

  /* ---------------- visualiser (file only) ---------------- */

  function sizeCanvas(canvas) {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }

  function drawIdle(canvas) {
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    c.clearRect(0, 0, w, h);
    // Static "equaliser" — also the YouTube stand-in, since we can't analyse it.
    const gap = 2;
    const barW = (w - gap * (idleBars - 1)) / idleBars;
    for (let i = 0; i < idleBars; i += 1) {
      const barH = h * (0.22 + 0.5 * Math.abs(Math.sin(i * 1.1 + performance.now() / 700)));
      c.fillStyle = 'rgba(190, 24, 93, 0.45)';
      c.beginPath();
      if (c.roundRect) c.roundRect(i * (barW + gap), h - barH, barW, barH, barW / 2);
      else c.rect(i * (barW + gap), h - barH, barW, barH);
      c.fill();
    }
    rafId = requestAnimationFrame(() => drawIdle(canvas));
  }

  function drawLive(canvas) {
    if (!canvas || !analyser) return;
    const c = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    c.clearRect(0, 0, w, h);

    analyser.getByteFrequencyData(dataArray);
    const bars = dataArray.length;
    const gap = 2;
    const barW = Math.max(1, (w - gap * (bars - 1)) / bars);

    for (let i = 0; i < bars; i += 1) {
      const v = dataArray[i] / 255;
      const barH = Math.max(2, v * (h - 4));
      const x = i * (barW + gap);
      const y = h - barH;
      const g = c.createLinearGradient(0, y, 0, h);
      g.addColorStop(0, 'rgba(190, 24, 93, 0.85)');
      g.addColorStop(1, 'rgba(139, 92, 246, 0.55)');
      c.fillStyle = g;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, barW, barH, barW / 2);
      else c.rect(x, y, barW, barH);
      c.fill();
    }
    rafId = requestAnimationFrame(() => drawLive(canvas));
  }

  let canvasEl = null;
  let vizMode = 'none';

  function setVisualiser(canvas, mode) {
    canvasEl = canvas ?? null;
    if (canvasEl) sizeCanvas(canvasEl);
    vizMode = mode;
    cancelAnimationFrame(rafId);
    rafId = 0;
    if (!canvasEl) return;
    if (mode === 'live') drawLive(canvasEl);
    else drawIdle(canvasEl);
  }

  function ensureGraph() {
    if (graphStarted) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    graphStarted = true;
    sizeCanvas(canvasEl);
  }

  /* ---------------- progress polling ---------------- */

  function startProgressPolling() {
    stopProgressPolling();
    progressTimer = setInterval(() => {
      if (sourceType() === 'youtube' && ytPlayer?.getCurrentTime) {
        const dur = ytPlayer.getDuration() || 0;
        const cur = ytPlayer.getCurrentTime() || 0;
        ytProgress = dur ? Math.min(1, cur / dur) : 0;
        // Kept as state, not just a ratio, so the "1:04 / 3:27" readout has
        // real numbers to format. The IFrame API exposes both.
        ytElapsed = cur;
        ytDuration = dur;
      }
      emit();
    }, 500);
  }

  function stopProgressPolling() {
    clearInterval(progressTimer);
    progressTimer = 0;
  }

  /* ---------------- file transport ---------------- */

  function loadFile(track) {
    audio.src = track.source;
    audio.load();
    setVisualiser(canvasEl, 'idle');
  }

  async function playFile() {
    ensureGraph();
    if (ctx.state === 'suspended') await ctx.resume();
    await audio.play();
    setVisualiser(canvasEl, 'live');
  }

  function pauseFile() {
    audio.pause();
    setVisualiser(canvasEl, 'idle');
  }

  /* ---------------- youtube transport ---------------- */

  function ytPlaying() {
    return ytPlayer?.getPlayerState?.() === 1;
  }

  function ytMuted() {
    return (ytPlayer?.isMuted?.() ?? false) || (ytPlayer?.getVolume?.() ?? 100) === 0;
  }

  /** Destroy any existing player so a fresh div can be handed to YT. */
  function teardownYT() {
    if (ytPlayer?.destroy) {
      try {
        ytPlayer.destroy();
      } catch {
        /* already gone */
      }
    }
    ytPlayer = null;
    ytProgress = 0;
    ytElapsed = 0;
    ytDuration = 0;
    ytSlot?.remove();
    ytSlot = null;
  }

  async function mountYT(track) {
    if (!ytMount) {
      lastError = 'Player unavailable.';
      emit();
      return;
    }

    teardownYT();
    setVisualiser(canvasEl, 'idle');

    lastError = null;
    try {
      const YT = await loadYouTubeApi();

      ytSlot = document.createElement('div');
      ytSlot.id = `yt-${track.id}`;
      ytSlot.className = 'h-full w-full';
      ytMount.replaceChildren(ytSlot);

      ytPlayer = new YT.Player(ytSlot, {
        videoId: track.source,
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          // Hide YouTube's own chrome — our bar is the transport.
          controls: 0,
          disablekb: 1,
          fs: 0,
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(Math.round(audio.volume * 100));
            emit();
          },
          onStateChange: (e) => {
            if (e.data === 1 && vizMode === 'none') setVisualiser(canvasEl, 'idle');
            emit();
          },
          onError: (e) => {
            // 101/150 = embedding disabled by the uploader; 2 = invalid id.
            lastError =
              e.data === 101 || e.data === 150
                ? "That video can't be embedded here."
                : "Couldn't play that YouTube video.";
            emit();
          },
        },
      });
      // Fresh video, fresh clock — otherwise the previous track's position
      // shows until the first poll lands.
      ytProgress = 0;
      ytElapsed = 0;
      ytDuration = 0;
    } catch (err) {
      lastError = err.message || "Couldn't load YouTube.";
      emit();
    }
  }

  async function playYT() {
    if (!ytPlayer) return;
    ytPopoverOpen = true;
    try {
      await ytPlayer.playVideo();
    } catch {
      lastError = 'Tap play again to start YouTube.';
      emit();
    }
  }

  function pauseYT() {
    ytPlayer?.pauseVideo?.();
  }

  function openPopover() {
    if (sourceType() !== 'youtube') return;
    ytPopoverOpen = true;
    const track = current();
    if (ytPlayer && ytSlot?.dataset.videoId !== track.source) {
      mountYT(track);
    } else if (!ytPlayer) {
      mountYT(track);
    }
    emit();
  }

  function closePopover() {
    ytPopoverOpen = false;
    pauseYT();
    emit();
  }

  /* ---------------- transport dispatch ---------------- */

  function syncVisualiserMode() {
    const type = sourceType();
    if (!tracks.length) {
      setVisualiser(canvasEl, 'none');
      return;
    }
    // 'live' only once a file is actually playing; otherwise the static
    // equaliser stands in — including for YouTube, which can't be analysed.
    const mode = type === 'file' && !audio.paused ? 'live' : 'idle';
    if (vizMode !== mode) setVisualiser(canvasEl, mode);
  }

  function load(i) {
    if (!tracks.length) return;
    index = (i + tracks.length) % tracks.length;
    lastError = null;
    ytPopoverOpen = false;

    const track = current();
    if (track.source_type === 'file') {
      teardownYT();
      loadFile(track);
    } else if (track.source_type === 'youtube') {
      audio.pause();
      audio.removeAttribute('src');
      setVisualiser(canvasEl, 'idle');
    } else {
      // Spotify — nothing to load, just show the track as link-out.
      audio.pause();
      audio.removeAttribute('src');
      teardownYT();
      setVisualiser(canvasEl, 'idle');
    }

    syncVisualiserMode();
    emit();
  }

  async function toggle() {
    if (!tracks.length) return;
    const type = sourceType();

    if (type === 'spotify') {
      openInSpotify();
      return;
    }

    if (playingNow()) {
      if (type === 'youtube') pauseYT();
      else pauseFile();
      syncVisualiserMode();
    } else {
      if (type === 'youtube') {
        ytPopoverOpen = true;
        if (!ytPlayer) await mountYT(current());
        await playYT();
      } else {
        try {
          await playFile();
        } catch {
          lastError = 'Playback was blocked. Tap play again.';
        }
      }
      syncVisualiserMode();
    }
    startProgressPolling();
    emit();
  }

  function openInSpotify() {
    const track = current();
    if (!track) return;
    let ref = null;
    try {
      ref = parseSpotify(track.source);
      // Stored source is already "track/ID" or "playlist/ID".
      if (!ref) {
        const [kind, id] = String(track.source).split('/');
        ref = { kind, id };
      }
    } catch {
      ref = null;
    }
    if (ref) window.open(spotifyOpenUrl(ref), '_blank', 'noopener,noreferrer');
  }

  function next() {
    const wasPlaying = playingNow();
    load(index + 1);
    if (wasPlaying && isPlayableInPage(sourceType())) toggle();
    else emit();
  }

  function prev() {
    if (sourceType() === 'file' && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const wasPlaying = playingNow();
    load(index - 1);
    if (wasPlaying && isPlayableInPage(sourceType())) toggle();
    else emit();
  }

  function select(i) {
    if (i === index) return;
    const wasPlaying = playingNow();
    load(i);
    if (wasPlaying && isPlayableInPage(sourceType())) toggle();
  }

  function setVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    audio.volume = clamped;
    audio.muted = false;
    if (ytPlayer?.setVolume) ytPlayer.setVolume(Math.round(clamped * 100));
    if (ytPlayer?.unMuted) ytPlayer.unMuted();
    emit();
  }

  function toggleMute() {
    if (sourceType() === 'youtube') {
      if (ytPlayer?.isMuted?.()) {
        ytPlayer.unMuted();
        ytPlayer.setVolume(Math.round(audio.volume * 100));
      } else {
        ytPlayer?.mute();
      }
      emit();
      return;
    }
    audio.muted = !audio.muted;
    emit();
  }

  /* ---------------- events ---------------- */

  audio.addEventListener('play', () => {
    syncVisualiserMode();
    startProgressPolling();
    emit();
  });
  audio.addEventListener('pause', () => {
    syncVisualiserMode();
    emit();
  });
  audio.addEventListener('ended', next);
  audio.addEventListener('volumechange', emit);
  audio.addEventListener('timeupdate', () => {
    if (!progressTimer) emit();
  });
  audio.addEventListener('error', () => {
    lastError = "Couldn't load that track.";
    emit();
  });

  window.addEventListener('resize', () => {
    sizeCanvas(canvasEl);
  });

  /** @param {HTMLElement} canvas @param {HTMLElement} mount */
  async function init(canvas, mount) {
    canvasEl = canvas ?? null;
    ytMount = mount ?? null;
    if (canvasEl) {
      sizeCanvas(canvasEl);
      setVisualiser(canvasEl, 'idle');
    }

    // Bundled manifest first, then anything saved through the admin panel.
    const fromManifest = await readManifest();
    const { tracks: saved, error } = await readApiTracks();
    listError = error;
    tracks = dedupe([...saved, ...fromManifest]);
    if (tracks.length) load(0);
    emit();
    return state();
  }

  async function readManifest() {
    try {
      const res = await fetch('/audio/tracks.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const body = await res.json();
      if (!Array.isArray(body)) return [];
      return body
        .filter((t) => t && t.src)
        .map((t) => ({
          id: `file-${t.src}`,
          title: t.title || 'Untitled',
          source_type: 'file',
          source: t.src,
          storage_path: null,
          origin: 'bundled',
        }));
    } catch {
      return [];
    }
  }

  async function readApiTracks() {
    /*
     * Returns { tracks, error } instead of collapsing every failure into [].
     *
     * The old version caught everything and returned an empty array, which made
     * a failing request look exactly like a playlist with nothing in it: the
     * Music tab said "No tracks yet" and nothing else, so a broken deployment
     * looked like a working app that had forgotten its songs. A real failure now
     * carries a reason the UI can show.
     *
     * An empty playlist and a failed request are genuinely different states and
     * must not render the same.
     */
    let res;
    try {
      res = await fetch('/api/tracks', { credentials: 'same-origin' });
    } catch {
      return { tracks: [], error: "Couldn't reach the server to load your tracks." };
    }

    if (!res.ok) {
      if (res.status === 401) {
        return { tracks: [], error: 'Session expired — unlock again to see your tracks.' };
      }
      return {
        tracks: [],
        error: `Couldn't load your tracks (server error ${res.status}).`,
      };
    }

    let body;
    try {
      body = await res.json();
    } catch {
      return { tracks: [], error: "The server sent something we couldn't read." };
    }

    if (body?.ok === false) {
      return { tracks: [], error: body?.error?.message ?? "Couldn't load your tracks." };
    }

    const list = Array.isArray(body) ? body : (body?.data ?? body?.tracks ?? []);
    if (!Array.isArray(list)) {
      return { tracks: [], error: "The server sent an unexpected track list." };
    }

    return { tracks: list.filter((t) => t && t.source), error: null };
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((t) => {
      const key = `${t.source_type}:${t.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Seed a track list directly — used by demo mode, where there is no API. */
function setTracks(list) {
    tracks = dedupe(list.filter((t) => t && t.source));
    if (tracks.length) {
      index = 0;
      load(0);
    } else {
      emit();
    }
    return state();
  }

  /**
 * Called after the admin adds or removes a track.
 *
 * Returns the new state, like init() and setTracks(). It used to return
 * undefined, so a caller could not tell whether the reload had succeeded —
 * which is exactly the question "did my upload land?" needs answered.
 */
  async function refresh() {
    const fromManifest = await readManifest();
    const { tracks: saved, error } = await readApiTracks();
    listError = error;
    const keepIndex = index;
    tracks = dedupe([...saved, ...fromManifest]);
    if (!tracks.length) {
      index = 0;
      emit();
      return state();
    }
    index = Math.min(keepIndex, tracks.length - 1);
    load(index);
    return state();
  }

  function destroy() {
    stopProgressPolling();
    cancelAnimationFrame(rafId);
    rafId = 0;
    audio.pause();
    audio.removeAttribute('src');
    teardownYT();
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    graphStarted = false;
  }

  return {
    init,
    setTracks,
    refresh,
    toggle,
    next,
    prev,
    select,
    setVolume,
    seekTo,
    toggleMute,
    openInSpotify,
    openPopover,
    closePopover,
    destroy,
    emit,
    get tracks() {
      return tracks;
    },
  };
}