-- ---------------------------------------------------------------------------
-- 006 — revoke privileges from the public-facing roles
--
-- WHY THIS EXISTS, INSTEAD OF RLS ALONE
--
-- Supabase grants `anon` and `authenticated` full table privileges on new
-- tables in the `public` schema. RLS is what stops them reading your data, and
-- it does that correctly. But RLS is NOT sufficient on its own:
--
--   * TRUNCATE is not subject to RLS in PostgreSQL at all. A role holding the
--     TRUNCATE grant can wipe a table regardless of any policy.
--   * RLS filtering yields "0 rows", not an error, so a caller cannot tell a
--     filtered result from an empty table.
--
-- Defence in depth: deny at the privilege layer as well as the policy layer.
-- `service_role` and `postgres` keep full access (service_role bypasses RLS;
-- postgres owns the tables), which is exactly what the PHP app needs — it
-- connects as `postgres` via the pooler and uses `service_role` for Storage.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  wanted text[] := array[
    'photo_cards',
    'calendar_events',
    'category_cards',
    'app_settings',
    'audio_tracks'
  ];
begin
  foreach t in array wanted loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on %I from anon, authenticated', t);
      raise notice 'revoked anon/authenticated on %', t;
    else
      raise warning 'table % missing — skipped', t;
    end if;
  end loop;
end
$$;

-- Same for sequences and functions in the public schema, in case any are
-- added later.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','S')
      and c.relname not like 'pg_%'
  loop
    execute format('revoke all on %I.%I from anon, authenticated', r.nspname, r.relname);
  end loop;
end
$$;

revoke all on function public.touch_updated_at() from anon, authenticated;

-- Keep RLS enabled too — the two layers are independent, and either alone
-- would leave a gap the other covers.
alter table photo_cards      enable row level security;
alter table calendar_events enable row level security;
alter table category_cards   enable row level security;
alter table app_settings     enable row level security;
alter table audio_tracks     enable row level security;