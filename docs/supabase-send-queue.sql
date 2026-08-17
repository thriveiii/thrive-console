-- ============================================================================
-- Thrive Console - the durable send queue (P8 / D6 + R3)
-- ADDITIVE and IDEMPOTENT. Nothing here deletes, rewrites, or narrows a row.
--
-- No new table, and no new column. A queued send is an ordinary console_mail
-- row: status = 'queued' (a value the status column already holds as text) and
-- data.due (the jittered per-row send time) inside the jsonb that already
-- carries every field. So the queue "lives in the ledger" exactly as R3 ratifies,
-- and reads back through the same select=data path with zero migration.
--
-- The only physical change is one index to keep the queued-rows scan cheap as a
-- campaign grows. Indexes are safe: they add no data and drop cleanly. Run this
-- whole file as many times as you like.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Keep the "queued rows for this opportunity" read cheap. The board and the
--    campaign card ask it on every render; the index turns a table scan into a
--    lookup once a campaign has thousands of rows. IF NOT EXISTS => idempotent.
-- ---------------------------------------------------------------------------
create index if not exists console_mail_opp_status_idx
  on public.console_mail (opp, status);

-- A partial index just for the live queue (queued + held): the smallest, hottest
-- slice, ordered so "the next row due" is the index's first entry.
create index if not exists console_mail_queue_due_idx
  on public.console_mail (opp, (data->>'due'))
  where status in ('queued', 'held');

-- ---------------------------------------------------------------------------
-- READ-ONLY. Inspect the live queue for a campaign (fill in the slug). One row
-- per recipient; the dues should differ by randomized gaps, never a fixed beat.
-- ---------------------------------------------------------------------------
-- select id, to_addr, status, data->>'due' as due, ts
-- from public.console_mail
-- where opp = 'YOUR-CAMPAIGN-SLUG' and status in ('queued','held','sent','failed')
-- order by (data->>'due');

-- ---------------------------------------------------------------------------
-- READ-ONLY. The one-row-per-recipient invariant, the strictest in this brief:
-- for a campaign, each recipient address must have exactly one queued/sent row.
-- Any address with a count > 1 is a duplicate the batch loop must never create.
-- Zero rows returned is the healthy state.
-- ---------------------------------------------------------------------------
-- select opp, to_addr, count(*) as rows
-- from public.console_mail
-- where opp = 'YOUR-CAMPAIGN-SLUG' and direction is distinct from 'in'
-- group by opp, to_addr
-- having count(*) > 1;

-- ---------------------------------------------------------------------------
-- NOTE (source of truth for the SEND). The relay never writes to Supabase: it
-- holds the compiled batch in its own Drive store (store.outbox), sends on a
-- time trigger, and reports each row's outcome through outbox_status. The
-- console reconciles that outcome back into console_mail (queued -> sent/failed).
-- So a row's terminal status here is a MIRROR of the relay's send, written by
-- whichever device syncs next; the send itself needs no device awake. There is
-- nothing to backfill from SQL for a sent row: Resend's dashboard and the relay's
-- outbox are the record of the send, this table is the ledger view of it.
-- ============================================================================
