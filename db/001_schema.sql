-- ---------------------------------------------------------------------------
-- 001 — core tables
--
-- SECURITY MODEL
-- Row Level Security is enabled on every table and left with NO permissive
-- policy. Effect: the public `anon` key cannot read or write anything through
-- PostgREST, even though that key is designed to be public.
--
--   anon         → denied by RLS
--   authenticated → denied by RLS
--   service_role → BYPASSES RLS (Supabase grants this by default) — this is
--                  how the PHP upload endpoint writes to Storage
--   postgres (direct/pooler connection) → superuser, unaffected — this is
--                  how every read and write in the app goes through PDO
--
-- Because the app never uses the Supabase client SDK, it never depends on the
-- anon key at all.
--
-- Enum-like columns use varchar + CHECK rather than Postgres ENUM types:
-- a value can never be added to an ENUM in the same transaction that uses it,
-- which makes migrations and rollbacks needlessly awkward.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- photo_cards — a memory photocard: one image plus the letter attached to it.
-- ---------------------------------------------------------------------------
create table if not exists photo_cards (
  id                 uuid primary key default gen_random_uuid(),
  photo_url          text        not null,
  photo_original_url text,                       -- 2400px original, for re-cropping
  title              varchar(255) not null,
  letter_text        text        not null,
  memory_date        date,                       -- nullable: links into the calendar
  created_at         timestamptz not null default now(),

  constraint photo_cards_title_len  check (char_length(title) between 1 and 255),
  constraint photo_cards_letter_len check (char_length(letter_text) between 1 and 20000),
  constraint photo_cards_photo_url  check (photo_url ~* '^https?://')
);

create index if not exists photo_cards_created_at_idx
  on photo_cards (created_at desc);

-- Partial index: only dated cards appear in a calendar lookup.
create index if not exists photo_cards_memory_date_idx
  on photo_cards (memory_date)
  where memory_date is not null;

-- ---------------------------------------------------------------------------
-- calendar_events — anniversaries, monthsaries, dates, apologies.
-- ---------------------------------------------------------------------------
create table if not exists calendar_events (
  id          uuid primary key default gen_random_uuid(),
  event_date  date        not null,
  title       varchar(255) not null,
  description text,
  icon_type   varchar(50) not null,
  created_at  timestamptz not null default now(),

  constraint calendar_events_title_len check (char_length(title) between 1 and 255),
  constraint calendar_events_icon_check
    check (icon_type in ('anniversary', 'monthsary', 'date', 'sorry', 'heart'))
);

-- The calendar fetches by range on every month change.
create index if not exists calendar_events_date_idx
  on calendar_events (event_date);

-- ---------------------------------------------------------------------------
-- category_cards — the four heart decks.
-- ---------------------------------------------------------------------------
create table if not exists category_cards (
  id         uuid primary key default gen_random_uuid(),
  category   varchar(50)  not null,
  title      varchar(255) not null,
  content    text         not null,
  created_at timestamptz  not null default now(),

  constraint category_cards_category_check
    check (category in ('sorry', 'appreciation', 'love', 'comfort')),
  constraint category_cards_title_len   check (char_length(title) between 1 and 255),
  constraint category_cards_content_len check (char_length(content) between 1 and 20000)
);

create index if not exists category_cards_category_idx
  on category_cards (category, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — deny everything to anon/authenticated.
--
-- No policy is created on purpose: with RLS enabled and zero policies, every
-- non-bypassing role is denied by default. service_role and postgres are
-- unaffected, which is exactly what the PHP layer needs.
-- ---------------------------------------------------------------------------
alter table photo_cards      enable row level security;
alter table calendar_events enable row level security;
alter table category_cards   enable row level security;

-- Belt and braces: drop any policy a previous run may have created, so a
-- re-run can never silently widen access.
drop policy if exists photo_cards_read      on photo_cards;
drop policy if exists calendar_events_read on calendar_events;
drop policy if exists category_cards_read   on category_cards;

-- NOTE: deliberately NOT using FORCE ROW LEVEL SECURITY.
--
-- FORCE also subjects the table OWNER to RLS. Every read and write this app
-- makes goes through the pooler as the `postgres` role, so if that role lacks
-- BYPASSRLS, FORCE would silently break the entire application rather than
-- protect it. Plain ENABLE gives us the thing we actually need — anon and
-- authenticated are denied — while leaving the server-side path untouched.
--
-- `node scripts/verify-rls.mjs` asserts both halves of that claim.