/**
 * Source resolution for the music bar.
 *
 * Turns whatever the user pastes into a normalised descriptor. Kept separate
 * from the player because this is pure logic and the part most likely to
 * quietly fail on an odd URL.
 */

const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be', 'www.youtu.be',
]);

const SPOTIFY_HOSTS = new Set([
  'open.spotify.com', 'play.spotify.com', 'spotify.link', 'spoti.fi',
]);

/** open.spotify.com, play.spotify.com, open.spotify.co.uk, spotify.de, … */
const SPOTIFY_HOST = /(^|\.)spotify\.[a-z]{2,3}(\.[a-z]{2})?$/;

/** A YouTube video ID is exactly 11 URL-safe base64 chars. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export const SOURCE_TYPES = ['file', 'youtube', 'spotify'];

/**
 * Extract a YouTube video ID from any of the URL shapes people actually paste.
 * @returns {string|null}
 */
export function parseYouTubeId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // Bare ID
  if (YT_ID.test(raw)) return raw;

  // youtu.be/ID  and  youtu.be/ID?t=30
  const short = /^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})/.exec(raw);
  if (short) return short[1];

  // Strip a scheme-less prefix and query/hash before parsing.
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;

  // youtube.com/watch?v=ID
  const v = url.searchParams.get('v');
  if (v && YT_ID.test(v)) return v;

  // youtube.com/embed/ID, /shorts/ID, /live/ID, /v/ID
  const path = url.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
  if (path) return path[1];

  return null;
}

/**
 * Extract a Spotify track or playlist ID.
 * @returns {{ kind: 'track'|'playlist', id: string }|null}
 */
export function parseSpotify(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const supported = SPOTIFY_HOSTS.has(host) || SPOTIFY_HOST.test(host);
  if (!supported) return null;

  const match = url.pathname.match(/\/(track|playlist|album|episode|show)\/([A-Za-z0-9]{22})/);
  if (!match) return null;

  return { kind: match[1], id: match[2] };
}

/** Open URL for a parsed Spotify reference. */
export function spotifyOpenUrl(ref) {
  return `https://open.spotify.com/${ref.kind}/${ref.id}`;
}

/** YouTube embed URL. `origin` is recommended by Google to harden the embed. */
export function youtubeEmbedUrl(videoId, origin = '') {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    enablejsapi: '1',
  });
  if (origin) params.set('origin', origin);
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|weba)(\?|#|$)/i;

/** Our own Supabase public-object URLs, which may or may not carry an extension. */
const SUPABASE_PUBLIC = /\/storage\/v1\/object\/public\//i;

/**
 * Classify whatever was pasted into a source descriptor.
 *
 * `file` covers both uploads we hosted and any direct audio URL, so it is the
 * fallback for anything that isn't recognisably YouTube or Spotify.
 *
 * @returns {{ type:'file'|'youtube'|'spotify', source:string,
 *             videoId?:string, spotify?:{kind:string,id:string}, label:string }|null}
 */
export function resolveSource(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  const yt = parseYouTubeId(raw);
  if (yt) {
    return { type: 'youtube', source: yt, videoId: yt, label: 'YouTube' };
  }

  const sp = parseSpotify(raw);
  if (sp) {
    return {
      type: 'spotify',
      source: `${sp.kind}/${sp.id}`,
      spotify: sp,
      label: 'Spotify',
    };
  }

  // A bare http(s) URL is NOT enough — pasting any web page would otherwise
  // become a silently-broken track. Require an audio extension, or one of our
  // own Supabase public-object URLs.
  const hasAudioExt = AUDIO_EXT.test(raw);
  const isOurBucket = SUPABASE_PUBLIC.test(raw);
  if (hasAudioExt || isOurBucket) {
    return { type: 'file', source: raw, label: 'Audio file' };
  }

  return null;
}

/** True when a track can actually be played in-page. */
export function isPlayableInPage(sourceType) {
  return sourceType === 'file' || sourceType === 'youtube';
}

/** True when the live canvas visualiser can run (needs same-origin audio). */
export function supportsVisualizer(sourceType) {
  return sourceType === 'file';
}