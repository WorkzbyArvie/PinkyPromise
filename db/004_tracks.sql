-- ---------------------------------------------------------------------------
-- 004 — audio tracks
--
-- One row per playable item in the music bar. `source_type` decides which
-- transport the frontend uses, and therefore which capabilities are available:
--
--   file     → our own upload or a direct audio URL.
--              Full transport + live canvas visualiser.
--   youtube  → official IFrame embed. Transport works, but the audio is in a
--              cross-origin frame so the visualiser is replaced by a static
--              equaliser. Requires a visible player.
--   spotify  → NOT embeddable by third parties. The play control becomes an
--              "Open in Spotify" hand-off.
--
-- `source` holds the normalised value, not the raw paste:
--   file     → absolute URL
--   youtube  → bare 11-char video id
--   spotify  → "track/<id>" or "playlist/<id>"
--
-- `storage_path` is set only for files WE uploaded, so the bucket object can
-- be deleted when the row is removed. External links leave it NULL.
-- ---------------------------------------------------------------------------

create table if not exists audio_tracks (
  id           uuid primary key default gen_random_uuid(),
  title        varchar(255) not null,
  source_type  varchar(20)  not null,
  source       text         not null,
  storage_path text,
  position     integer      not null default 0,
  created_at   timestamptz  not null default now(),

  constraint audio_tracks_source_type_check
    check (source_type in ('file', 'youtube', 'spotify')),

  -- A YouTube id is exactly 11 URL-safe base64 characters.
  constraint audio_tracks_youtube_id_check
    check (source_type <> 'youtube' or source ~ '^[A-Za-z0-9_-]{11}$'),

  -- Spotify entries are stored as "<kind>/<22-char id>".
  constraint audio_tracks_spotify_ref_check
    check (source_type <> 'spotify'
           or source ~ '^(track|playlist|album|episode|show)/[A-Za-z0-9]{22}$'),

  -- File sources must be absolute URLs.
  constraint audio_tracks_file_url_check
    check (source_type <> 'file' or source ~* '^https?://'),

  -- Only our own uploads carry a storage path.
  constraint audio_tracks_storage_path_check
    check (storage_path is null or source_type = 'file')
);

-- Playback order, then newest first within the same position.
create index if not exists audio_tracks_position_idx
  on audio_tracks (position asc, created_at desc);

-- ---------------------------------------------------------------
-- Optional starter content. Remove or edit as you like.
-- ---------------------------------------------------------------
insert into audio_tracks (title, source_type, source, position) values
  ('Placeholder — replace me', 'youtube', 'jNQXAC9IVRW', 0)
on conflict do nothing;