-- Thrive Console · intake-integrity clamp (a persisted Sent stage without a send record)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Why this exists: the manifest used to default status:"sent" on a page nobody had emailed, and a
-- zip-batch import plus "activate every template" could persist stage:"sent" on cards that were never
-- sent. Those cards landed in the Sent lane reading "0 days without movement" and drained Ready. The
-- console is now RESILIENT to that stored lie: a lane is derived from a delivered send RECORD, never from
-- a bare stage stamp, so effStage already clamps such a card to Ready (a page exists) or Draft (none),
-- with NO migration required for the board to be correct. This statement only ALIGNS the stored data with
-- that read view, so a card the console shows in Ready is not still carrying stage:"sent" as data.
--
-- Isolation, the first rule:
--   * Every statement touches console_opps and READS console_mail ONLY. Nothing outside the console_
--     prefix is read or written, and no other Supabase project is referenced.
--   * Additive and idempotent. It clears `stage` (the column and the data jsonb mirror) ONLY on rows
--     whose stage is a send-requiring lane (sent or opened) AND that have NO send evidence anywhere:
--     no outbound row in the console_mail ledger, and no recorded manual contact carrying a send date.
--     A second run changes nothing, because the first run left no send-requiring stage without evidence
--     behind. There is no drop, no alter, and no row is destroyed: a phantom stage is cleared to empty,
--     the send-backed stages (a real sent, opened) and every declared outcome (replied, won, lost,
--     dropped, bounced, failed) are untouched, and the rest of each record is untouched. The board then
--     re-derives Ready or Draft from evidence, exactly as it already does on read.
--
-- ORDER, if you also ran supabase-lifecycle-legacy.sql: run THIS one AFTER it, and do not re-run the
-- legacy backfill afterward. That backfill copied a legacy status:"sent" into stage for parity; for the
-- two send-requiring lanes (sent, opened) that copy is now superseded by evidence, and re-running it
-- would re-persist the same phantom this statement clears. The board stays correct on read either way.

update public.console_opps o
   set stage = '',
       data  = jsonb_set(coalesce(o.data, '{}'::jsonb), '{stage}', '""'::jsonb),
       updated_at = now()
 where (coalesce(o.stage, '') in ('sent','opened')
        or coalesce(o.data->>'stage', '') in ('sent','opened'))
   -- no delivered send record in the mail ledger (an outbound row is a real send)
   and not exists (
     select 1 from public.console_mail m
      where m.opp = o.slug
        and coalesce(m.data->>'direction', '') = 'out'
   )
   -- and no recorded manual contact carrying a real send date (manual_contacts lives in the record itself)
   and not exists (
     select 1 from jsonb_array_elements(
       case when jsonb_typeof(o.data->'manual_contacts') = 'array'
            then o.data->'manual_contacts' else '[]'::jsonb end) mc
      where coalesce(mc->>'sent_on', '') <> ''
   );
