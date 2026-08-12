-- Thrive Console · legacy-parity backfill (opportunity stage from a legacy status)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Why this exists: a card made before Stage 4 was written with a `status` (the manifest only ever
-- wrote "sent") where the board now reads `stage`. The console already defaults this on READ
-- (normalizeOpp maps a legacy status to the stage the derivation honors), so nothing here is required
-- for the board to be correct. This migration only PERSISTS that same default in console_opps, so a
-- stage the console derives on read is also stored as data, matching the read view exactly.
--
-- Isolation, the first rule:
--   * Every statement touches console_opps ONLY. Nothing outside the console_ prefix is read or
--     written. No other table and no other Supabase project is referenced.
--   * Additive and idempotent. It writes `stage` ONLY on rows where `stage` is null or empty AND the
--     legacy status (carried in the record's data jsonb) is one of the stages the derivation honors
--     as a declaration. A second run changes nothing, because the first run left no empty stage with
--     a legacy status behind. There is no drop, no alter, and no row is destroyed: a status is copied
--     into stage, the rest of the record is untouched.
--
-- The declared stages only: sent, opened, replied, won, lost, dropped, bounced, failed. The pre-send
-- states (draft, ready, live) are deliberately NOT backfilled, because the new model reads those from
-- evidence (isLive and the send ledger), not from a claim the record makes about itself. This is the
-- same set normalizeOpp uses on read, so the persisted value and the derived value never disagree.

update public.console_opps
   set stage = data->>'status',
       updated_at = now()
 where (stage is null or stage = '')
   and coalesce(data->>'status','') in
       ('sent','opened','replied','won','lost','dropped','bounced','failed');
