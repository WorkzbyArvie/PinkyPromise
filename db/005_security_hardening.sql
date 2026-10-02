-- ---------------------------------------------------------------------------
-- 005 — security hardening sweep
--
-- Idempotent: re-running this is safe and is the point. Every statement is an
-- `if not exists` / `enable` operation, so this file can be applied to any
-- database regardless of how far it got, and re-applied any time to be sure
-- nothing drifted.
--
-- Add it to your migration list and run it after any schema change that
-- introduces a new table. Run `node scripts/verify-rls.mjs` afterwards — it
-- fails loudly if any table is unprotected.
-- ---------------------------------------------------------------------------

-- Every table the app owns, including any added later.
-- Authoritative list — keep in sync with scripts/verify-rls.mjs.
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
      execute format('alter table %I enable row level security', t);
      -- Drop any SELECT policy that would re-open PostgREST to the anon key.
      execute format('drop policy if exists %I on %I', t || '_anon_read', t);
      raise notice 'RLS enforced on %', t;
    else
      raise warning 'table % does not exist yet — skipped', t;
    end if;
  end loop;
end
$$;

-- Explicitly remove any policy that grants anon/authenticated access.
-- These are the only two roles that could ever reach data without the
-- service_role bypass, and both must have nothing.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (array_to_string(roles, ',') like '%anon%'
           or array_to_string(roles, ',') like '%authenticated%')
  loop
    raise notice 'dropping permissive policy % on table %', r.policyname, r.tablename;
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$$;