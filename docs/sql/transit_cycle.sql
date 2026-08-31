-- Thrive Console - transit cycle marker (additive only)
-- =========================================================================
-- Apply this in the Supabase SQL editor of the "thrive-console" project, THEN
-- (re)apply the console_board view in docs/supabase-live-verified.sql (which
-- reads these columns). Nothing here is destructive; every statement is guarded.
--
-- WHY. Operations must be a TRANSIT, not a ledger. A re-upload reuses the
-- console_opps / console_pages row (merge-duplicates on slug), and the board
-- view joins the append-only ledger (console_mail / console_hits) by bare slug,
-- so an OLD transit's sends and opens re-attach to the freshly uploaded card.
-- A per-transit "cycle" id fixes this by construction: the opp carries its
-- CURRENT cycle, each send/hit is stamped with the cycle it belonged to, and the
-- view counts only rows of the opp's current cycle.
--
-- LEGACY / NO-REGRESSION. Existing rows have cycle = NULL and stay UNSCOPED: the
-- view counts a row when (row.cycle = opp.cycle) OR (both are NULL), so a legacy
-- opp (cycle NULL) with legacy hits/sends (cycle NULL) reads exactly as today.
-- Only once an opp is given a cycle (on its next upload) do old-cycle / null-cycle
-- ledger rows drop out of that opp's counts.

alter table public.console_opps  add column if not exists cycle text;   -- the opp's CURRENT transit id (bumped on every upload)
alter table public.console_mail  add column if not exists cycle text;   -- the transit a send belonged to (stamped at send)
alter table public.console_hits  add column if not exists cycle text;   -- the transit an open belonged to (stamped when resolvable, else NULL)

-- Optional read aid: filtering opens/sends by cycle is a simple equality, so no
-- index is required at current volumes. Add one later only if a scan shows up:
-- create index if not exists console_mail_opp_cycle_idx on public.console_mail (opp, cycle);
-- create index if not exists console_hits_slug_cycle_idx on public.console_hits (slug, cycle);
