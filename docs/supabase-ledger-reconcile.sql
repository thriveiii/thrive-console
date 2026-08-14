-- ============================================================================
-- Thrive Console - ledger reconciliation (Part 2)
-- Read-only first, then an ADDITIVE, IDEMPOTENT backfill/normalization TEMPLATE.
-- Nothing here deletes or rewrites an existing row. Run the SELECTs, read the
-- output, then run only the INSERT/UPDATE templates you need, with real values.
--
-- SOURCE NOTE (state which was used, per the brief): the relay never writes to
-- Supabase (it POSTs to Resend and keeps hits/replies in a Drive JSON blob), so
-- a send that is missing from console_mail cannot be reconstructed from SQL
-- alone -- Resend's dashboard (or the relay's Drive log) is the only record of
-- it. These queries therefore reconcile WITHIN Supabase (orphans, integrity,
-- key mismatches); the concrete missing-send backfill is filled in from Resend
-- by hand, using the template at the bottom.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- READ-ONLY 1. Mail rows whose opp matches no opportunity (orphans).
-- The client always keys a send by the slug (docs/board-signal-census.md), so a
-- non-matching opp is an empty key or a slug whose opportunity was never
-- mirrored. Zero rows here is the healthy state.
-- ---------------------------------------------------------------------------
select m.id, m.opp, m.to_addr, m.status, m.ts
from public.console_mail m
left join public.console_opps o on o.slug = m.opp
where o.slug is null
order by m.ts desc;

-- ---------------------------------------------------------------------------
-- READ-ONLY 2. Inbound replies (non-auto) whose opp reaches no opportunity,
-- directly or as a stranded child '<parent>--r-<hash>'. These are the replies
-- the board loses (Basel). The view now resolves a stranded child to its
-- parent at read time; this lists the underlying rows so the cause is visible.
-- ---------------------------------------------------------------------------
select i.id, i.opp,
       case when i.opp like '%--r-%' then split_part(i.opp, '--r-', 1) else i.opp end as resolved_parent,
       i.ts
from public.console_inbound i
where coalesce(i.kind, '') <> 'auto'
  and not exists (select 1 from public.console_opps o where o.slug = i.opp)
  and not exists (
        select 1 from public.console_opps o
        where i.opp like '%--r-%' and o.slug = split_part(i.opp, '--r-', 1))
order by i.ts desc;

-- ---------------------------------------------------------------------------
-- READ-ONLY 3. Opportunities the board would show as never-contacted: no
-- console_mail row AND no manual_contacts. Informational (many are legitimately
-- unsent); cross-check the named cards (cozy-calico-books) against Resend to
-- find a real send that never reached the ledger.
-- ---------------------------------------------------------------------------
select o.slug, o.business
from public.console_opps o
left join public.console_mail m on m.opp = o.slug
where m.opp is null
  and coalesce(jsonb_array_length(o.data->'manual_contacts'), 0) = 0
  and coalesce(o.archived, false) = false
order by o.slug;

-- ============================================================================
-- ADDITIVE TEMPLATE A. Backfill a known-missing send from Resend.
-- Idempotent: on a row id collision it does nothing, so re-running is safe. Set
-- id to a stable value (the Resend message id is ideal). The original source is
-- kept in data.reconciled_from for audit. Fill in the real values per Resend.
-- ============================================================================
-- insert into public.console_mail (id, opp, status, to_addr, subject, ts, data, up)
-- values (
--   'resend_<message_id>',            -- stable id (Resend message id) so re-runs dedupe
--   'cozy-calico-books',              -- the opportunity slug (the true send key)
--   'sent',                           -- delivered
--   'tracy@cozycalicobooks.com',      -- recipient, from Resend
--   'The shop, found',                -- subject, from Resend
--   '2026-08-01T10:00:00Z'::timestamptz,  -- real delivery time, from Resend
--   jsonb_build_object('opp','cozy-calico-books','to','tracy@cozycalicobooks.com',
--     'status','sent','direction','out','reconciled_from','resend'),  -- data mirrors the row + audit
--   (extract(epoch from now())*1000)::bigint
-- )
-- on conflict (id) do nothing;

-- ============================================================================
-- ADDITIVE TEMPLATE B. Normalize a reply keyed to a stranded child slug onto its
-- parent, keeping the original key for audit. OPTIONAL: the view already resolves
-- a stranded child at read time, so this is only for operators who prefer the
-- stored key to match. Idempotent (only rewrites rows still on a child key whose
-- child has no opportunity), additive to data, never a delete.
-- ============================================================================
-- update public.console_inbound i
--    set opp  = split_part(i.opp, '--r-', 1),
--        data = coalesce(i.data, '{}'::jsonb) || jsonb_build_object('opp_original', i.opp)
--  where coalesce(i.kind,'') <> 'auto'
--    and i.opp like '%--r-%'
--    and not exists (select 1 from public.console_opps o where o.slug = i.opp)          -- child is stranded
--    and exists     (select 1 from public.console_opps o where o.slug = split_part(i.opp,'--r-',1))  -- parent exists
--    and (i.data->>'opp_original') is null;                                             -- not already normalized

-- ---------------------------------------------------------------------------
-- ACCEPTANCE re-run (after any backfill): both should return zero rows.
--   READ-ONLY 1 (no orphaned mail rows) and READ-ONLY 2 (no unreachable replies).
-- ---------------------------------------------------------------------------
