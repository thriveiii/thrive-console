-- Thrive Console · Supabase Auth policies (Path A, step 3: ADD the signed-in path, alongside anon)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- What this does and does NOT do:
--   * ADDS a policy per console_ table that grants the authenticated role full access. This is additive:
--     it sits ALONGSIDE the existing <table>_anon_all policy, so nothing that works today stops working.
--   * It does NOT remove the permissive anon policy. That removal is a SEPARATE, later file
--     (supabase-auth-remove-anon.sql), to be run ONLY after a device proves the signed-in path works.
--
-- Order of operations (the whole point of splitting this in two):
--   1. Enable Supabase Auth and create the single operator account (Authentication > Users > Add user).
--   2. Run THIS file. Now both anon and the signed-in operator have access. Still nothing is closed.
--   3. On the real device: sign in from Settings, confirm the board, an opportunity save, a template
--      import, the ledger and a reply all work signed in.
--   4. ONLY after that device-green, run supabase-auth-remove-anon.sql to close the anon door.
--
-- Isolation: every object named is console_ prefixed. Nothing outside that prefix is touched. Additive and
-- idempotent: enable RLS is safe to re-run, and each policy is created only if it does not already exist.

alter table console_opps      enable row level security;
alter table console_pages     enable row level security;
alter table console_templates enable row level security;
alter table console_mail      enable row level security;
alter table console_settings  enable row level security;
alter table console_inbound   enable row level security;
alter table console_hits      enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['console_opps','console_pages','console_templates','console_mail',
                           'console_settings','console_inbound','console_hits']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_auth_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        t || '_auth_all', t
      );
    end if;
  end loop;
end $$;
