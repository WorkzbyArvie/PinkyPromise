-- ---------------------------------------------------------------------------
-- 002 — app settings (key/value)
--
-- Holds the passcode hash and the countdown anchor date. Small, deliberately
-- separate from user content so it can be locked down independently later if
-- you ever want a second reader (e.g. a shared device).
--
-- 'passcode_hash' starts EMPTY. That empty state is what /api/auth-bootstrap
-- checks: while it is empty, anyone who knows APP_SETUP_TOKEN may set the
-- passcode exactly once. After that only the passcode itself can change it,
-- and the token can be cleared from Vercel.
-- ---------------------------------------------------------------------------

create table if not exists app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now(),

  constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_]{1,48}$')
);

insert into app_settings (key, value) values
  ('passcode_hash',   ''),                    -- bcrypt hash, set by bootstrap
  ('anchor_date',     ''),                    -- YYYY-MM-DD
  ('site_title',      'Our Little World'),
  ('partner_names',   'You & Me'),
  ('music_volume',    '0.7')
on conflict (key) do nothing;

-- Keep updated_at honest without needing a trigger.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_settings_touch on app_settings;
create trigger app_settings_touch
  before update on app_settings
  for each row execute function touch_updated_at();

-- Same RLS posture as 001: enabled, no policies.
alter table app_settings enable row level security;
drop policy if exists app_settings_read on app_settings;