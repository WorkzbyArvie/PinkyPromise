# Background music

Tracks can come from three places. They are **not** interchangeable — each has
different capabilities, and the music bar degrades accordingly.

| Source | What you get | What you don't get |
|---|---|---|
| **Audio file** (upload, or paste a direct `.mp3`/`.m4a` link) | Play/pause, volume, skip, **live visualiser** | — |
| **YouTube link** | Play/pause, volume, skip, **a real player** in a popover above the bar | Live visualiser (see below) |
| **Spotify link** | An "Open in Spotify" hand-off | Any in-page playback |

## Why the visualiser stops for YouTube

The audio plays inside a cross-origin iframe. Chromium's
`MediaElementAudioSourceNode` returns zeros for cross-origin media, so the
`AnalyserNode` can never see the signal. Rather than fake a dancing bar, the
app shows a static equaliser. Uploaded files are same-origin, so those animate
for real.

## Why Spotify just opens

Spotify doesn't allow third-party sites to embed individual tracks or stream
their audio into a custom player. Their widget terms restrict the play button to
Spotify-operated properties. So a Spotify track is a hand-off, not a player.

## Adding tracks

Use the **Music tab** in the app. You don't need to touch these files.

Two legacy paths still work:

1. **`tracks.json`** — a static list of audio files, merged with saved tracks:
   ```json
   [
     { "title": "Our Song", "src": "/audio/our-song.mp3" }
   ]
   ```
   Entries from here are read-only in the UI and can't be deleted from it.

2. **The `audio_tracks` table** — what the Music tab writes to. See
   `db/004_tracks.sql`.

## Formats

`mp3`, `m4a`, `aac`, `ogg`, `wav`, `flac`, `opus`, `weba` all play in every
current browser. Keep files to a few MB each — they load on demand.

## Direct links

A pasted URL is only accepted as an audio source if it either ends in a known
audio extension or is one of our own Supabase public-object URLs. A random web
page link is rejected with *"That link is not a direct audio file"* rather than
quietly becoming a broken track.

If the list is empty or a track fails to load, the bar shows a hint instead of
breaking. Nothing else in the app depends on it.

## Demo mode

With `?demo=1` the Music tab is pre-seeded with one track of each type so you
can see all three behaviours. The file track is a **generated WAV tone**, which
means the visualiser genuinely runs. The YouTube and Spotify IDs are
placeholders — replace them with your own links.