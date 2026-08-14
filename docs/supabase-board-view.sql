-- ============================================================================
-- Thrive Console - console_board
-- One server-computed row per opportunity: the board's canonical stage and its
-- display fields, computed in ONE deterministic pass over the base tables.
--
-- WHY: console_opps.stage is empty for every card, so stage is composed at
-- render time in the client by merging several scattered sources that load
-- asynchronously; each render cycle composes from a different partial subset,
-- so the same card resolves to a different lane per cycle and sometimes
-- fabricates a state (a card with page opens but zero sends read as Opened).
-- This view moves the computation server-side: one query, one consistent
-- snapshot, the same stage for the same data every read. The client reads the
-- view and only buckets by the returned stage; it computes no stage.
--
-- ADDITIVE and IDEMPOTENT: creates one view. It reads the base tables and
-- writes nothing. No base table or its data is touched. Safe to re-run.
--
-- security_invoker = true: the view runs with the CALLER's privileges, so the
-- per-operator RLS already on the base tables is honored (an operator sees only
-- their own rows). Grant select to the authenticated role.
--
-- THE SIGNALS ARE LIFTED FROM THE CLIENT, NOT REINVENTED. Each mapping below is
-- the client's own definition in library/app.js, confirmed against a real row.
-- The column shapes are the ones the client writes (the supa*Row builders):
--   console_opps    (slug, business, stage, published, archived,
--                    outreach_subject, outreach_text, data jsonb, up)
--   console_mail    (id, opp, status, to_addr, subject, ts, actor, data jsonb, up)
--   console_inbound (id, opp, kind, bounce, ts, data jsonb, up)
--   console_hits    (id, slug, type, ts, self, data jsonb)
--   console_pages   (slug, html)
-- ============================================================================

create or replace view public.console_board
with (security_invoker = true)
as
with
-- TIMESTAMP TYPES (the schema, docs/supabase-stage1.sql + docs/supabase-mail-migrate.sql):
--   console_mail.ts is timestamptz          -> used directly; a nullif(ts,'') here would force ''::timestamptz
--                                              and fail at parse time before any row is read.
--   console_inbound.ts / console_hits.ts are TEXT -> nullif(ts,'')::timestamptz guards an empty string
--                                              before the cast, which is correct and stays.
--   manual_contacts[].sent_on is TEXT (jsonb) -> same nullif-before-cast guard.
-- ---- SEND EVIDENCE ---------------------------------------------------------
-- app.js sendIndex(): a send is a console_mail row linked by opp = slug, that is
-- NOT a reply (data->>'direction' <> 'in'), whose status is a dispatched one
-- (NULL, 'sent', 'copied' or 'pending'; queued/failed/unsent do not count).
-- sent_on on the record proves nothing and is deliberately never consulted.
mail_sends as (
  select
    m.opp                                                as slug,
    count(*)                                             as n,
    min(m.ts)                                            as first_ts,
    max(m.ts)                                            as last_ts
  from public.console_mail m
  where coalesce(m.data->>'direction', '') <> 'in'
    and (m.status is null or m.status in ('', 'sent', 'copied', 'pending'))
  group by m.opp
),
-- app.js manualSends(): a hand contact recorded on the record (opp.data
-- manual_contacts[] with a sent_on) counts exactly as a ledger row counts.
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
-- ---- OPENS (send-gated) ----------------------------------------------------
-- app.js outreachOpens() -> opensSince(slug, firstSend): opens are page hits
-- (type 'open' or untyped) keyed by slug, counted only AT OR AFTER the first
-- send, and never the sender's own visits (self excluded). Zero until a send:
-- there is nothing for anyone to have opened before a message went out. This is
-- the gate that ends the fabrication (page traffic on a never-sent page is not
-- an open here, so a zero-send card can never read Opened).
opens as (
  select
    h.slug                                               as slug,
    count(*)                                             as open_count,
    max(nullif(h.ts, '')::timestamptz)                   as last_open_ts
  from public.console_hits h
  join sends s on s.slug = h.slug
  where coalesce(h.type, 'open') in ('', 'open')
    and coalesce(h.self, false) = false
    and s.first_ts is not null
    and nullif(h.ts, '')::timestamptz >= s.first_ts
  group by h.slug
),
-- ---- REPLIED ---------------------------------------------------------------
-- A reply is attributed to an opportunity through THREE real paths the client uses (the signal census,
-- docs/board-signal-census.md), and the view must honor all three or a real answer is lost:
--   (a) an inbound reply row (console_inbound, kind <> 'auto') keyed by opp;
--   (b) a hand-recorded reply in the mail ledger (data->>'direction' = 'in', or status = 'replied');
--   (c) a hand-recorded reply move that stamps the opportunity itself (console_opps.stage = 'replied'),
--       which writes NO inbound or mail row at all -- the client's effStage honors a declared 'replied',
--       so the view must too, or a manually recorded reply is invisible.
-- Child-slug attribution: a group reply is re-keyed from the parent to a child slug '<parent>--r-<hash>'
-- (app.js spawnChildrenFromReplies). When that child is a real console_opps row it is the member's own
-- card and keeps the reply (the plain opp holds). When the child was never flushed (a stranded child,
-- the flush race), the child slug matches no console_opps row and the reply would vanish; there we
-- resolve it back to the parent (split_part before '--r-') so a real reply is never dropped, and without
-- double counting a child that does exist.
replied as (
  select slug, bool_or(r) as replied, max(ts) as last_reply_ts
  from (
    select
      case
        when i.opp like '%--r-%'
             and not exists (select 1 from public.console_opps o2 where o2.slug = i.opp)
        then split_part(i.opp, '--r-', 1)                 -- stranded child: attribute to the parent
        else i.opp                                        -- normal reply, or a child that has its own card
      end                                                 as slug,
      true                                                as r,
      max(nullif(i.ts, '')::timestamptz)                  as ts
      from public.console_inbound i
     where coalesce(i.kind, '') <> 'auto'
     group by 1
    union all
    select opp as slug, true as r, max(ts) as ts
      from public.console_mail
     where coalesce(data->>'direction', '') = 'in' or status = 'replied'
     group by opp
    union all
    select slug, true as r, nullif(data->>'replied_on', '')::timestamptz as ts
      from public.console_opps
     where stage = 'replied'                              -- (c) a hand-recorded reply move on the opp itself
  ) x
  group by slug
),
-- ---- BOUNCE ----------------------------------------------------------------
-- app.js bounceFor(): a mailer-daemon notice is an inbound 'auto' record with
-- bounce 'hard' (permanent -> Bounced) or 'soft' (temporary -> Failed).
bounce as (
  select
    opp                                as slug,
    bool_or(bounce = 'hard')           as hard,
    bool_or(bounce = 'soft')           as soft
  from public.console_inbound
  where kind = 'auto' and bounce in ('hard', 'soft')
  group by opp
),
-- ---- HAS PAGE ---------------------------------------------------------------
pages as ( select slug, true as has_page_row from public.console_pages group by slug )
select
  o.slug,
  o.business,
  -- has_page: the record is published, or a page row exists for it.
  (coalesce(o.published, false) or coalesce(p.has_page_row, false))          as has_page,
  -- has_email: an outreach message has been prepared on the record.
  (coalesce(nullif(o.outreach_text, ''), nullif(o.outreach_subject, '')) is not null) as has_email,
  coalesce(o.archived, false)                                                as archived,
  coalesce(s.sent_count, 0)                                                  as sent_count,
  coalesce(op.open_count, 0)                                                 as open_count,
  coalesce(r.replied, false)                                                 as replied,
  -- last_activity_ts: the most recent thing that actually happened (last send,
  -- last reply, last open-after-send). NULL when nothing has happened yet.
  greatest(s.last_ts, r.last_reply_ts, op.last_open_ts)                      as last_activity_ts,
  -- idle_days: whole days since the last activity, computed straight from last_activity_ts. A card with
  -- no send/reply/open has a NULL last_activity_ts, so idle_days is NULL by normal timestamp arithmetic
  -- (now() minus NULL is NULL), never a fabricated zero and never a string coalesce. The client treats a
  -- NULL idle_days as "no idle clock yet" and falls back to its own last-touch, so nothing breaks.
  extract(day from (now() - greatest(s.last_ts, r.last_reply_ts, op.last_open_ts)))::int as idle_days,
  -- ---- THE STAGE LADDER (app.js effStage, first match wins) ----------------
  -- coalesce(manual_override, computed): a declared terminal stage on the record
  -- (anything other than the derived 'sent'/'replied') stands as the override,
  -- exactly as effStage returns a declaration before deriving. A future dedicated
  -- override column plugs in at this same coalesce with no rule change.
  case
    when nullif(o.stage, '') is not null
         and o.stage not in ('sent', 'replied')          then o.stage        -- 1. declared stands
    when coalesce(r.replied, false)                       then 'replied'      -- 2. a reply exists
    when coalesce(s.sent_count, 0) = 0
      then case
             when (coalesce(o.published, false) or coalesce(p.has_page_row, false)
                   or coalesce(nullif(o.outreach_text, ''), nullif(o.outreach_subject, '')) is not null)
             then 'live' else 'draft' end                                    -- 3. no send: ready or draft
    when coalesce(b.hard, false)                          then 'bounced'      -- 4. hard bounce
    when coalesce(b.soft, false)                          then 'failed'       --    soft bounce
    when coalesce(op.open_count, 0) > 0                   then 'opened'       -- 5. opened after a send
    else 'sent'                                                              --    otherwise sent
  end                                                                        as stage
from public.console_opps o
left join sends   s  on s.slug  = o.slug
left join opens   op on op.slug = o.slug
left join replied r  on r.slug  = o.slug
left join bounce  b  on b.slug  = o.slug
left join pages   p  on p.slug  = o.slug;

grant select on public.console_board to authenticated;

-- ----------------------------------------------------------------------------
-- READ-ONLY DATA HYGIENE HUNT (run separately; changes nothing).
-- The Rise Dance mismatch (the board showed opens with zero mail on the slug
-- join) is resolved by the send-gate above: with zero sends the view yields
-- zero opens and the card is 'live' or 'draft', never 'opened'. If any mail
-- rows are linked to an opportunity by a key OTHER than opp = slug, they would
-- be orphaned here. This lists them read-only so a link key other than slug can
-- be confirmed before proposing any additive backfill. No destructive change.
-- ----------------------------------------------------------------------------
-- select m.id, m.opp, m.to_addr, m.status, m.ts
-- from public.console_mail m
-- left join public.console_opps o on o.slug = m.opp
-- where o.slug is null
-- order by m.ts desc;
