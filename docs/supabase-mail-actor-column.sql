-- ============================================================================
-- Thrive Console - console_mail write freeze: the missing actor column
--
-- THE BREAK (named): on 2026-08-14 the client (commit 583207b, profile Phase B)
-- began writing a top-level `actor` column on every console_mail row
-- (library/app.js supaMailRow). The `actor` column is added only by the MANUAL,
-- additive migration docs/supabase-profile-phase-b.sql. If that migration was not
-- run, the deployed console_mail has no `actor` column, so PostgREST rejects EVERY
-- insert with PGRST204 ("Could not find the 'actor' column of 'console_mail' in
-- the schema cache"). Because the upsert is a single merge-duplicates batch, the
-- unknown column rejects the whole row; supaConfirmMail / supaFlush caught the 400
-- onto the diverge ledger and never surfaced it, so console_mail froze at 28 rows
-- while Resend kept Delivering.
--
-- THE FIX comes in two parts:
--   1. CLIENT (this PR, already deployed with the merge): mailUpsert retries a
--      console_mail write WITHOUT the optional column when the server is a
--      migration behind, so sends record even before this SQL is run. Nothing is
--      lost - actor still travels inside the data jsonb.
--   2. SERVER (this file): add the `actor` column so it becomes first-class again
--      and the server-side per-operator aggregation reads it. ADDITIVE and
--      IDEMPOTENT. Run once in the "thrive-console" project.
--
-- This is the same statement profile-phase-b.sql carries, isolated here so the
-- freeze can be lifted without running the whole Phase B migration. Safe to run
-- even if Phase B was already applied (add column if not exists is a no-op then).
-- ============================================================================

-- 0. CONFIRM THE DIAGNOSIS (read-only). If this returns a row, the column is
--    missing and every write is failing. If it returns nothing, actor already
--    exists and the freeze has another cause (check the client diverge ledger).
select 'actor column MISSING - this is the freeze' as finding
  from information_schema.columns
 where table_schema = 'public' and table_name = 'console_mail'
having count(*) filter (where column_name = 'actor') = 0;

-- 1. THE FIX (additive, idempotent): add the column the client has been writing.
alter table public.console_mail add column if not exists actor text;

-- ============================================================================
-- VERIFICATION (read-only). Run after the client reconcile (reconcileMailToServer
-- runs on sign-in) and after a fresh send, to prove the freeze is lifted.
-- ============================================================================

-- 2. THE COUNT MOVED. It sat at 28 during the freeze; after the fix it climbs as
--    the reconcile pushes the backlog and new sends land.
select count(*) as console_mail_rows from public.console_mail;

-- 3. THE LATEST ROWS carry today's sends at the top, each with its opp, recipient,
--    subject and timestamp - the visible proof a real send now writes its row.
select id, opp, status, to_addr, subject, ts, actor
  from public.console_mail
 order by ts desc nulls last
 limit 20;

-- 4. Per-opp recorded-send counts, so a card that read "sent, not recorded" can be
--    confirmed to now hold its sends (Fleurs and the rest).
select opp, count(*) as sends, max(ts) as last_send
  from public.console_mail
 where coalesce(data->>'direction','out') <> 'in'
 group by opp
 order by last_send desc nulls last;
