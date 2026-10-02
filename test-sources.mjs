/**
 * Source-resolution tests — the YouTube / Spotify / direct-audio matrix.
 * Run with: node test.mjs
 */

import assert from 'node:assert/strict';
import {
  parseYouTubeId,
  parseSpotify,
  resolveSource,
  spotifyOpenUrl,
  youtubeEmbedUrl,
  isPlayableInPage,
  supportsVisualizer,
} from './js/sources.js';

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

const ID = 'dQw4w9WgXcQ'; // 11 chars — the canonical fixture

console.log('\nsources — YouTube id extraction');

t('bare video id', () => {
  assert.equal(parseYouTubeId(ID), ID);
});

t('short youtu.be link', () => {
  assert.equal(parseYouTubeId(`https://youtu.be/${ID}`), ID);
});

t('short link with a timestamp query', () => {
  assert.equal(parseYouTubeId(`https://youtu.be/${ID}?t=42`), ID);
});

t('standard watch link', () => {
  assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`), ID);
});

t('watch link with extra query params', () => {
  assert.equal(parseYouTubeId(`https://www.youtube.com/watch?app=desktop&v=${ID}&t=90s`), ID);
});

t('embed link', () => {
  assert.equal(parseYouTubeId(`https://www.youtube.com/embed/${ID}`), ID);
});

t('shorts link', () => {
  assert.equal(parseYouTubeId(`https://youtube.com/shorts/${ID}`), ID);
});

t('music.youtube.com link', () => {
  assert.equal(parseYouTubeId(`https://music.youtube.com/watch?v=${ID}`), ID);
});

t('mobile link without scheme', () => {
  assert.equal(parseYouTubeId(`m.youtube.com/watch?v=${ID}`), ID);
});

t('rejects a non-YouTube host', () => {
  assert.equal(parseYouTubeId(`https://vimeo.com/123456`), null);
  assert.equal(parseYouTubeId('https://notyoutube.com/watch?v=' + ID), null);
});

t('rejects a malformed id of the wrong length', () => {
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=' + 'x'.repeat(12)), null);
});

t('rejects empty input', () => {
  assert.equal(parseYouTubeId(''), null);
  assert.equal(parseYouTubeId(null), null);
  assert.equal(parseYouTubeId('   '), null);
});

console.log('\nsources — Spotify');

t('track link', () => {
  const r = parseSpotify('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.deepEqual(r, { kind: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
});

t('track link with a ?si share token', () => {
  const r = parseSpotify('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123');
  assert.equal(r.kind, 'track');
});

t('playlist link', () => {
  assert.equal(parseSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').kind, 'playlist');
});

t('international domain', () => {
  assert.equal(parseSpotify('https://open.spotify.co.uk/track/4cOdK2wGLETKBW3PvgPWqT').kind, 'track');
});

t('rejects a non-Spotify host', () => {
  assert.equal(parseSpotify('https://soundcloud.com/artist/track'), null);
});

t('rejects a Spotify URL with no track id', () => {
  assert.equal(parseSpotify('https://open.spotify.com/'), null);
});

t('rejects an id of the wrong length', () => {
  assert.equal(parseSpotify('https://open.spotify.com/track/short'), null);
});

console.log('\nsources — resolveSource classification');

t('YouTube url resolves to a youtube source', () => {
  const r = resolveSource(`https://youtu.be/${ID}`);
  assert.equal(r.type, 'youtube');
  assert.equal(r.videoId, ID);
  assert.equal(r.label, 'YouTube');
});

t('Spotify url resolves to a spotify source', () => {
  const r = resolveSource('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(r.type, 'spotify');
  assert.equal(r.spotify.kind, 'track');
});

t('direct mp3 url resolves to a file source', () => {
  const r = resolveSource('https://cdn.example.com/song.mp3');
  assert.equal(r.type, 'file');
  assert.equal(r.source, 'https://cdn.example.com/song.mp3');
});

t('Supabase public url resolves to a file source', () => {
  const r = resolveSource('https://abc.supabase.co/storage/v1/object/public/recon-media/a/song.mp3');
  assert.equal(r.type, 'file');
});

t('m4a and ogg resolve as files', () => {
  assert.equal(resolveSource('https://x.test/a.m4a').type, 'file');
  assert.equal(resolveSource('https://x.test/a.ogg').type, 'file');
});

t('a path ending in .mp3 without a scheme still resolves', () => {
  assert.equal(resolveSource('/audio/local.mp3').type, 'file');
});

t('a plain sentence is rejected', () => {
  assert.equal(resolveSource('our song'), null);
  assert.equal(resolveSource('just some words'), null);
});

t('a non-audio page URL is rejected', () => {
  assert.equal(resolveSource('https://example.com/about-us'), null);
});

console.log('\nsources — playback capability');

t('capability matrix', () => {
  assert.equal(isPlayableInPage('file'), true);
  assert.equal(isPlayableInPage('youtube'), true);
  assert.equal(isPlayableInPage('spotify'), false, 'Spotify cannot play in-page');
  assert.equal(supportsVisualizer('file'), true);
  assert.equal(supportsVisualizer('youtube'), false, 'cross-origin iframe blocks the analyser');
  assert.equal(supportsVisualizer('spotify'), false);
});

console.log('\nsources — generated urls');

t('spotify open url round-trips', () => {
  const r = parseSpotify('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x');
  assert.equal(spotifyOpenUrl(r), 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
});

t('youtube embed url is nocookie and hardened', () => {
  const url = youtubeEmbedUrl(ID, 'https://example.com');
  assert.ok(url.startsWith('https://www.youtube-nocookie.com/embed/'));
  assert.ok(url.includes('enablejsapi=1'));
  assert.ok(url.includes('playsinline=1'));
  assert.ok(url.includes('origin='));
});

console.log(`\n${passed} source tests passed\n`);