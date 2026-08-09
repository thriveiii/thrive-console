-- Thrive Console · Close the anon door (Path A, step 5: REMOVE the permissive anon policy)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- ============================ RUN THIS ONLY AFTER DEVICE-GREEN ============================
-- Do NOT run this until a real device has signed in (Settings > Storage > Sign in) and confirmed the
-- board, an opportunity save, a template import, the mail ledger and a reply all work while signed in.
-- Until then the signed-in path is unproven, and removing anon access could lock the operator out.
-- The safe order is in supabase-auth-policies.sql (step 3); this is step 5, the last step.
-- =========================================================================================
--
-- What this does: drops the <table>_anon_all policy on each console_ table. After this, the anon key can
-- no longer read or write console data; only the authenticated operator session (the signed-in JWT) can.
-- The anon key still ships in the browser, but it is now powerless against these tables, so anyone who
-- lifts it from the page gets nothing. The <table>_auth_all policies added in step 3 keep the operator in.
--
-- Isolation: every object named is console_ prefixed. Nothing outside that prefix is touched. Idempotent:
-- drop policy if exists is a no-op if the policy is already gone, so re-running is safe.

do $$
declare
  t text;
begin
  foreach t in array array['console_opps','console_pages','console_templates','console_mail',
                           'console_settings','console_inbound','console_hits']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
  end loop;
end $$;
