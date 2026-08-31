-- Thrive Console - stage approval gate (additive only)
-- =========================================================================
-- Apply this in the Supabase SQL editor of the "thrive-console" project, THEN
-- (re)apply the console_board view in docs/supabase-live-verified.sql (which
-- reads these columns). Nothing here is destructive; every statement is guarded.
--
-- WHY. A card must not reach "ready" (engine stage 'live') on its own. The
-- deployed console_board derived 'live' for any no-send card that had a live
-- page or a prepared message (docs/supabase-live-verified.sql, the stage CASE),
-- so a fully formed upload appeared ready with no human step - the auto-jump.
--
-- THE GATE. 'ready' (engine 'live') is reached ONLY by an explicit approval
-- write: approved_at is stamped with now() and approved_by with the approver's
-- uid. The view then computes stage = 'live' only when approved_at is not null,
-- and 'draft' (displayed as "Under review") otherwise. No derivation, on the
-- client or in the view, may produce 'live' from page/email presence any more.
-- Axiom 5 (every event carries its actor): the approval records who and when.
--
-- LEGACY / NO-REGRESSION. Existing rows have approved_at null, so they render
-- as "Under review" (draft). Nothing auto-promotes, which is the safe default.
-- No backfill.

alter table public.console_opps add column if not exists approved_at timestamptz;   -- when the card was approved to Ready (null = under review)
alter table public.console_opps add column if not exists approved_by text;           -- the approver's uid (Axiom 5: actor of the approval)
