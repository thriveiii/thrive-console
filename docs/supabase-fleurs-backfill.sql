-- ============================================================================
-- Thrive Console - Fleurs-de-Lea send backfill (ADDITIVE, idempotent)
--
-- The defect: the outreach email to Fleurs-de-Lea was delivered (Resend shows it
-- Delivered), but its console_mail row was never written, so the card waited on a
-- server confirmation that never came and hung on 'sending'. The client fix gives
-- 'sending' a bounded timeout (it now surfaces as 'sent, not recorded' with a
-- retry, and can never hang), and the retry re-writes the record when the send is
-- still in the local ledger. This file covers the OTHER case: the delivered send
-- whose local row is already gone (a cleared browser, a new device), so there is
-- nothing left to retry from. It writes the missing row directly from the known
-- delivery, so the board finally records the send it truly made.
--
-- ADDITIVE and IDEMPOTENT: one INSERT ... ON CONFLICT (id) DO NOTHING. It writes a
-- single console_mail row and nothing else; it deletes nothing and overwrites no
-- existing row. Safe to re-run. Run in the "thrive-console" project only.
--
-- BEFORE RUNNING: fill the three values marked <FILL ...> from the Resend delivery
-- record (the real recipient address, the subject line as sent, and the delivered
-- timestamp). The slug and id are fixed. If Fleurs was a multi-recipient campaign,
-- add one row per delivered recipient, each with its own id suffix and to_addr.
-- ============================================================================

-- Read-only confirmation first: prove the row is truly missing before writing it.
-- Expected: ZERO rows. If it returns a row, the send is already recorded; stop.
select id, opp, status, to_addr, subject, ts
  from public.console_mail
 where opp = 'fleurs-de-lea'
 order by ts;

-- The additive backfill. status='sent' because the email was delivered; direction
-- 'out' in data marks it an outbound send (the send-evidence CTE reads
-- data->>'direction'); the id is a stable, deterministic key so a re-run is a no-op.
insert into public.console_mail (id, opp, status, to_addr, subject, ts, data, up)
values (
  'fleurs-de-lea-backfill-1',                       -- stable id (PK): re-running does nothing
  'fleurs-de-lea',                                  -- the opportunity slug
  'sent',                                           -- delivered, so it is a real send
  '<FILL recipient address>',                       -- e.g. hello@fleursdelea.example
  '<FILL subject as sent>',                         -- the exact outreach subject
  '<FILL delivered timestamp>'::timestamptz,        -- e.g. 2026-08-10T14:32:00Z, from Resend
  jsonb_build_object(
    'opp',        'fleurs-de-lea',
    'status',     'sent',
    'direction',  'out',
    'provider',   'endpoint',
    'backfill',   'delivered send whose console_mail row was lost; see docs/supabase-fleurs-backfill.sql'
  ),
  extract(epoch from now())::bigint * 1000          -- up: a freshness stamp for the cross-device merge
)
on conflict (id) do nothing;

-- After running, the console_board view recomputes Fleurs' stage from this send
-- (Sent, or Opened/Replied if hits/inbound already exist for it), and the card
-- reads the same stage on the board and in its detail. Nothing hangs on 'sending'.
