-- ============================================================================
-- Thrive Console - reconcile every delivered-but-unrecorded send (Part 1)
--
-- Cozy Calico (cozy-calico-books) is the known stuck send: Resend Delivered it,
-- but during the Aug-14 write freeze (the console_mail actor-column mismatch, see
-- docs/mail-write-freeze.md) no row was written, so the card sits in Ready. This
-- reconciles it and any other delivered-but-unrecorded send from the freeze
-- window, ADDITIVELY and idempotently. Deletes nothing. Run in the "thrive-console"
-- project only.
--
-- NOTE ON SOURCES: the client already self-heals from the operator's own device -
-- reconcileMailToServer (docs/mail-write-freeze.md) pushes every send still in the
-- local ledger on sign-in, so a send the operator's browser remembers is recorded
-- without SQL. This file is for a send whose LOCAL row is also gone (a cleared
-- browser, another device), reconstructed from Resend's delivered record.
--
-- BEFORE RUNNING: fill each <FILL ...> from the Resend delivery record. The slug
-- and a stable id are fixed so a re-run is a no-op.
-- ============================================================================

-- 1. BEFORE count (evidence). Record this number; it must move up by the number of
--    rows inserted below.
select count(*) as console_mail_rows_before from public.console_mail;

-- 1a. Confirm Cozy Calico is truly missing (evidence). Expected: ZERO rows.
select id, opp, status, ts from public.console_mail where opp = 'cozy-calico-books' order by ts;

-- 2. THE RECONCILE (additive, idempotent). Cozy Calico, from its delivered record.
--    status='sent' because Resend Delivered it; direction 'out' in data marks the
--    send; the id is a stable, deterministic key so re-running does nothing.
insert into public.console_mail (id, opp, status, to_addr, subject, ts, data, up)
values (
  'cozy-calico-books-backfill-1',                   -- stable id (PK): re-run is a no-op
  'cozy-calico-books',
  'sent',
  '<FILL recipient address>',
  '<FILL subject as sent>',
  '<FILL delivered timestamp>'::timestamptz,        -- from Resend, e.g. 2026-08-15T14:00:00Z
  jsonb_build_object(
    'opp','cozy-calico-books','status','sent','direction','out','provider','endpoint',
    'backfill','delivered send unrecorded during the Aug-14 write freeze; see docs/supabase-cozy-calico-backfill.sql'
  ),
  extract(epoch from now())::bigint * 1000
)
on conflict (id) do nothing;

-- 2a. TEMPLATE for any OTHER delivered-but-unrecorded send from the freeze window.
--     List them from Resend (Delivered since 2026-08-14) minus what console_mail
--     holds, and add one INSERT per send with its own id suffix. Never delete.
--   insert into public.console_mail (id, opp, status, to_addr, subject, ts, data, up)
--   values ('<slug>-backfill-1', '<slug>', 'sent', '<to>', '<subject>', '<ts>'::timestamptz,
--     jsonb_build_object('opp','<slug>','status','sent','direction','out','backfill','freeze-window reconcile'),
--     extract(epoch from now())::bigint * 1000)
--   on conflict (id) do nothing;

-- 3. AFTER count (evidence). Must be BEFORE + (rows inserted). Paste both numbers.
select count(*) as console_mail_rows_after from public.console_mail;

-- 4. Cozy Calico now HAS its row and LEAVES Ready (evidence). The console_board view
--    recomputes its stage from the send, so it reads Sent (or Opened/Replied if hits
--    or inbound exist), never Ready. Paste both rows.
select 'mail' as source, id, opp, status, ts::text as detail
  from public.console_mail where opp = 'cozy-calico-books'
union all
select 'board' as source, slug as id, slug as opp, stage as status, coalesce(last_activity_ts::text,'') as detail
  from public.console_board where slug = 'cozy-calico-books';
