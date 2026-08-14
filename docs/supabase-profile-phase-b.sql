-- Thrive Console · operator profile subsystem (Phase B)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule:
--   * Every object here is console_ prefixed. Nothing outside that prefix is created, altered, or
--     dropped. No other Supabase project is referenced. The newsroom is not touched.
--   * Additive and idempotent only: a create-or-replace view, a grant, and an add-column-if-not-exists.
--     A second run changes nothing. There is no drop, and no data is destroyed or rewritten.

-- 1. console_profile_names: a minimal, cross-readable projection of console_profiles -----------------
-- Why this exists: console_profiles is owner-only by RLS (console_profiles_own, uid = auth.uid()), which
-- is correct for preferences and memory but means one operator cannot read another operator's display
-- name. That is exactly why a teammate's comment rendered as the generic «زميل»: there was no live way to
-- turn an author's uid into their real name. This view exposes ONLY the three shareable identity columns
-- (uid, display_name, email) to any authenticated operator, so resolveOperator(uid) can show a real name
-- everywhere. It is a projection, not a policy change: the base table keeps its owner-only RLS untouched,
-- so preferences and memory are never readable across operators. Names are shareable; the rest is not.
--
-- The view runs with the definer's rights (security_invoker is left at its default of off), which is what
-- lets it read across rows while exposing only these columns; this is deliberate and safe because the
-- projection carries nothing private. Only the SELECT is granted, and only to the authenticated role, so
-- a signed-out client sees nothing.
create or replace view public.console_profile_names as
  select uid, display_name, email
    from public.console_profiles;

grant select on public.console_profile_names to authenticated;

-- 2. console_mail.actor: a first-class actor column for durable per-operator attribution -------------
-- The mail ledger already carries the operator who sent each message inside its data jsonb (actor), and
-- the client derives per-operator performance from that. This adds the same value as a top-level column
-- so it can be aggregated server-side in future without unpacking the jsonb, and without ever guessing at
-- history: it is added additively at the write site (supaMailRow now sets it), never backfilled onto old
-- rows, so a row with no actor stays honestly null rather than being fabricated into someone's number.
alter table public.console_mail add column if not exists actor text;
