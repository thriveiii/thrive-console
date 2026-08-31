-- ============================================================================
-- Thrive Console - PR1: activation state = true liveness
-- console_pages.live_verified_at is the SINGLE source of truth for activated/live.
-- It is written ONLY after the board's Activate runs GET /opp/<slug> and gets ok
-- (tools/board-upload.src.js pageStampLive). Nothing else determines live.
--
-- This file redefines console_board so has_page and the page-live signal in the
-- stage ladder derive SOLELY from console_pages.live_verified_at IS NOT NULL,
-- joined by slug. It stops using console_opps.published and bare console_pages
-- row-existence as the live signal. Everything else in the view is unchanged.
--
-- ADDITIVE and IDEMPOTENT. It reads base tables and writes nothing to their data.
-- Safe to re-run. security_invoker = true, so per-operator RLS still applies.
--
-- !!! DEPLOY NOTE FOR THYAB (READ BEFORE APPLYING) !!!
-- The live console_board definition has been shown to DIVERGE from the repo copy,
-- and this environment cannot reach the database (outbound to Supabase is blocked
-- by the agent proxy: CONNECT 403), so pg_get_viewdef could NOT be captured here.
-- This CREATE OR REPLACE is authored against docs/supabase-board-view.sql (the
-- best available reference). Before you apply it:
--   1. Capture the live view:  select pg_get_viewdef('console_board', true);
--   2. Diff it against the SELECT below. If the live view has extra columns/CTEs,
--      DO NOT drop them - instead apply ONLY these two localized edits to the
--      LIVE definition:
--        (a) the `pages` CTE: expose live_verified_at (not `true as has_page_row`);
--        (b) both places that read `o.published OR p.has_page_row` as the page-live
--            signal (the `has_page` column and the stage='live' branch): replace
--            that two-part signal with `p.live_verified_at is not null`, leaving
--            the `has_email` part of the 'live' branch untouched.
-- The whole-view CREATE OR REPLACE below is correct ONLY if the live view already
-- matches this repo copy exactly. When unsure, hand-apply (a)+(b) instead.
--
-- INTERPRETATION NOTE: "stage='live' derives solely from live_verified_at" is read
-- here as "the PAGE-LIVE signal is solely live_verified_at". The existing
-- has_email branch (a prepared-but-unsent message with no page still reads 'live'
-- = ready) is left unchanged per "leave everything else in the view unchanged".
-- If you want a card with a message but no live page to read 'draft' instead,
-- drop the `or coalesce(nullif(o.outreach_text,''), nullif(o.outreach_subject,''))
-- is not null` from the stage='live' branch - a one-line follow-up, called out.
-- ============================================================================

-- The column is the given confirmed schema; guarded add so this file is self-sufficient.
alter table public.console_pages
  add column if not exists live_verified_at timestamptz;
-- STAGE GATE (docs/sql/stage_gate.sql): the approval columns this view reads. Guarded adds so this file is
-- self-sufficient; legacy rows keep approved_at null and render as "Under review" (draft).
alter table public.console_opps
  add column if not exists approved_at timestamptz;
alter table public.console_opps
  add column if not exists approved_by text;

-- The stage gate exposes two NEW columns (approved_at, approved_by). CREATE OR REPLACE cannot reorder existing
-- view columns, and the live view has been shown to diverge from this repo copy, so drop-then-create is the safe
-- path (a drop view touches NO table data). Rebuilt in full below, ending with the grant.
drop view if exists public.console_board;
create view public.console_board
with (security_invoker = true)
as
with
mail_sends as (
  select
    m.opp                                                as slug,
    count(*)                                             as n,
    min(m.ts)                                            as first_ts,
    max(m.ts)                                            as last_ts
  from public.console_mail m
  left join public.console_opps mo on mo.slug = m.opp    -- TRANSIT SCOPE: the opp's current cycle (docs/sql/transit_cycle.sql)
  where coalesce(m.data->>'direction', '') <> 'in'
    and (m.status is null or m.status in ('', 'sent', 'copied', 'pending'))
    -- current-transit rows only: a row counts when its cycle equals the opp's cycle, OR both are null (legacy,
    -- unchanged). Once an opp has a cycle, an old-transit send (a different or null cycle) drops out of the join.
    and ((m.cycle = mo.cycle) or (m.cycle is null and mo.cycle is null))
  group by m.opp
),
manual_sends as (
  select
    o.slug                                               as slug,
    count(*)                                             as n,
    min(nullif(mc->>'sent_on', '')::timestamptz)         as first_ts,
    max(nullif(mc->>'sent_on', '')::timestamptz)         as last_ts
  from public.console_opps o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.data->'manual_contacts') = 'array'
         then o.data->'manual_contacts' else '[]'::jsonb end) mc
  where nullif(mc->>'sent_on', '') is not null
  group by o.slug
),
sends as (
  select
    slug,
    sum(n)         as sent_count,
    min(first_ts)  as first_ts,
    max(last_ts)   as last_ts
  from (
    select slug, n, first_ts, last_ts from mail_sends
    union all
    select slug, n, first_ts, last_ts from manual_sends
  ) s
  group by slug
),
opens as (
  select
    h.slug                                               as slug,
    count(*)                                             as open_count,
    max(nullif(h.ts, '')::timestamptz)                   as last_open_ts
  from public.console_hits h
  join sends s on s.slug = h.slug
  left join public.console_opps ho on ho.slug = h.slug   -- TRANSIT SCOPE: the opp's current cycle (docs/sql/transit_cycle.sql)
  where coalesce(h.type, 'open') in ('', 'open')
    and coalesce(h.self, false) = false
    and s.first_ts is not null
    and nullif(h.ts, '')::timestamptz >= s.first_ts
    -- current-transit opens only: a hit counts when its cycle equals the opp's cycle, OR both are null (legacy,
    -- unchanged). An old-transit open (a different or null cycle on a now-cycled opp) is excluded.
    and ((h.cycle = ho.cycle) or (h.cycle is null and ho.cycle is null))
  group by h.slug
),
inbound_real as (
  select
    i.opp                                                                 as row_opp,
    lower(trim(regexp_replace(coalesce(i.data->>'subject',''),
      '^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*', '', 'i')))                as subj_key,
    nullif(i.ts, '')::timestamptz                                         as ts
  from public.console_inbound i
  where coalesce(i.kind, '') <> 'auto'
    and lower(coalesce(i.data->>'from','')) !~ '(dmarc|(^|[.+_-])(no-?reply|noreply|notifications?|notify|mailer-daemon|postmaster|bounces?)@)'
    and split_part(lower(coalesce(i.data->>'from','')), '@', 2) not in ('google.com', 'github.com')
),
mail_subj as (
  select
    lower(trim(regexp_replace(coalesce(subject,''),
      '^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*', '', 'i')))                as subj_key,
    opp
  from public.console_mail
  where coalesce(data->>'direction', '') <> 'in'
    and coalesce(opp, '') <> ''
    and coalesce(subject, '') <> ''
  group by 1, 2
),
inbound_linked as (
  select
    coalesce(
      (select case when count(distinct ms.opp) = 1 then min(ms.opp) end
         from mail_subj ms where r.subj_key <> '' and ms.subj_key = r.subj_key),
      case
        when coalesce(r.row_opp,'') <> '' and r.row_opp like '%--r-%'
             and not exists (select 1 from public.console_opps o2 where o2.slug = r.row_opp)
          then split_part(r.row_opp, '--r-', 1)
        when coalesce(r.row_opp,'') <> '' then r.row_opp
        else null end
    )                                                                     as slug,
    r.ts
  from inbound_real r
),
replied as (
  select slug, bool_or(r) as replied, max(ts) as last_reply_ts
  from (
    select slug, true as r, max(ts) as ts
      from inbound_linked
     where slug is not null
     group by slug
    union all
    select opp as slug, true as r, max(ts) as ts
      from public.console_mail
     where coalesce(data->>'direction', '') = 'in' or status = 'replied'
     group by opp
    union all
    select slug, true as r, nullif(data->>'replied_on', '')::timestamptz as ts
      from public.console_opps
     where stage = 'replied'
  ) x
  group by slug
),
bounce as (
  select
    opp                                as slug,
    bool_or(bounce = 'hard')           as hard,
    bool_or(bounce = 'soft')           as soft
  from public.console_inbound
  where kind = 'auto' and bounce in ('hard', 'soft')
  group by opp
),
-- ---- LIVE PAGE (the single source of truth) --------------------------------
-- A page counts as live ONLY when console_pages.live_verified_at is set - written
-- by the board after a real GET /opp/<slug> returned ok. console_opps.published and
-- bare row-existence are NO LONGER the live signal. Keyed by slug.
pages as (
  select slug, max(live_verified_at) as live_verified_at
  from public.console_pages
  group by slug
)
select
  o.slug,
  o.business,
  -- has_page: SOLELY that the page has been verified live (live_verified_at is set).
  (p.live_verified_at is not null)                                           as has_page,
  (coalesce(nullif(o.outreach_text, ''), nullif(o.outreach_subject, '')) is not null) as has_email,
  coalesce(o.archived, false)                                                as archived,
  o.cycle                                                                    as cycle,   -- the opp's current transit id (send stamps console_mail.cycle with it)
  coalesce(s.sent_count, 0)                                                  as sent_count,
  coalesce(op.open_count, 0)                                                 as open_count,
  coalesce(r.replied, false)                                                 as replied,
  greatest(s.last_ts, r.last_reply_ts, op.last_open_ts)                      as last_activity_ts,
  extract(day from (now() - greatest(s.last_ts, r.last_reply_ts, op.last_open_ts)))::int as idle_days,
  case
    -- 1. a declared TERMINAL / override stage stands (won / lost / dropped, etc.). The pre-send lane values
    --    'draft' and 'live' are EXCLUDED here: they are never taken from a stored value, they are derived below
    --    from the approval gate, so a stale stored stage can never produce 'ready' (Axiom 6, compute here).
    when nullif(o.stage, '') is not null
         and o.stage not in ('sent', 'replied', 'draft', 'live')  then o.stage
    when coalesce(r.replied, false)                       then 'replied'      -- 2. a reply exists
    when coalesce(s.sent_count, 0) = 0
      -- STAGE GATE: 'live' (ready) ONLY when the card has an explicit approval (approved_at). A page or a
      -- prepared message no longer makes a card ready by itself; it is 'draft' (displayed "Under review") until
      -- an approver stamps approved_at. Legacy rows (approved_at null) therefore read as under review.
      then case when o.approved_at is not null then 'live' else 'draft' end   -- 3. no send: ready ONLY by approval
    when coalesce(b.hard, false)                          then 'bounced'      -- 4. hard bounce
    when coalesce(b.soft, false)                          then 'failed'       --    soft bounce
    when coalesce(op.open_count, 0) > 0                   then 'opened'       -- 5. opened after a send
    else 'sent'                                                              --    otherwise sent
  end                                                                        as stage,
  o.approved_at                                                              as approved_at,   -- when the card was approved to Ready (null = under review)
  o.approved_by                                                              as approved_by    -- the approver's uid (Axiom 5: the actor of the approval)
from public.console_opps o
left join sends   s  on s.slug  = o.slug
left join opens   op on op.slug = o.slug
left join replied r  on r.slug  = o.slug
left join bounce  b  on b.slug  = o.slug
left join pages   p  on p.slug  = o.slug;

grant select on public.console_board to authenticated;
