-- Thrive Console · opportunity delete (R12, P19)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule:
--   * Every object here is console_ prefixed. Nothing outside that prefix is created, altered, or
--     dropped. No other Supabase project is referenced. The newsroom is not touched.
--   * Additive and idempotent only: each policy is guarded by an existence check, so a second run
--     changes nothing. There is NO drop, NO alter of a column, and NO foreign key or cascade added.
--
-- What this is for:
--   R12 gives the console a real delete for a wrongly-imported DRAFT: an opportunity with NO ledger
--   history (zero console_mail rows, zero console_inbound, zero token-bearing console_hits). The client
--   removes the opportunity by deleting its console_opps and console_pages rows (supaDeleteOpp), gated so
--   a history-bearing card can never reach the delete - it archives instead. This migration only makes
--   sure the DELETE is PERMITTED on those two tables for an authenticated operator; the gate itself lives
--   in the client, and the whole truth of what was sent and received lives in the ledger tables, which
--   this migration deliberately leaves untouchable.
--
-- THE LEDGER IS NEVER DELETED. There is no cascade from console_opps or console_pages into console_mail,
-- console_hits, or console_inbound, and this file adds none. A deleted opportunity's send and reply
-- history remains, keyed by its slug string; that is the point of the delete law. Do not add an ON DELETE
-- CASCADE or a delete policy that widens beyond the opportunity's own rows.

-- 1. console_opps: allow an authenticated operator to delete an opportunity row ------------------------
-- (RLS is already enabled on this table by the Stage-1 migration; this only adds the DELETE policy if it
--  is missing. The row-scoping matches however the project already scopes console_opps writes.)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='console_opps') then
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_opps' and policyname='console_opps_delete_auth') then
      execute 'create policy console_opps_delete_auth on public.console_opps for delete to authenticated using (true)';
    end if;
  end if;
end $$;

-- 2. console_pages: the opportunity's page row is removed with it -------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='console_pages') then
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_pages' and policyname='console_pages_delete_auth') then
      execute 'create policy console_pages_delete_auth on public.console_pages for delete to authenticated using (true)';
    end if;
  end if;
end $$;

-- 3. The ledger tables get NO delete policy here, on purpose. With RLS enabled and no delete policy, a
--    DELETE against console_mail / console_hits / console_inbound affects zero rows: the database itself
--    refuses to let an opportunity delete reach the record of what was sent or received. This block only
--    ASSERTS that state (it creates nothing); if any of these tables ever grows a delete policy, review it
--    against the R12 law before shipping.
do $$
declare
  leaked text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into leaked
    from pg_policies
   where schemaname='public'
     and tablename in ('console_mail','console_hits','console_inbound')
     and cmd in ('DELETE','ALL');
  if leaked is not null then
    raise notice 'R12 review: a delete-capable policy exists on a ledger table (%). The opportunity delete must never remove ledger rows.', leaked;
  end if;
end $$;
