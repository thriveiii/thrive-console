-- Thrive Console - Sentinel Sweep 5, Layer 3: data-integrity HUNTS (READ ONLY)
-- Run these in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- These are SELECT-only hunts. They CHANGE NOTHING. Each one looks for a class of corruption the audit
-- suspects; a non-empty result is a finding. Corrections are PROPOSED separately as additive idempotent
-- SQL once the findings ledger is ratified; nothing here writes, drops, or alters.
--
-- Before trusting a hunt, confirm the real shape with a quick look, because a column can carry its value
-- either first-class or inside the data jsonb:
--     select * from public.console_opps    limit 5;
--     select * from public.console_mail    limit 5;
--     select * from public.console_inbound limit 5;
--     select * from public.console_hits    limit 5;
-- Notes that shape every hunt below:
--   * console_opps.stage and .slug are dual-written: a top-level column AND mirrored in data (data->>'stage').
--   * console_mail.direction is JSON only (data->>'direction'); opp, status, actor, ts are columns.
--   * console_inbound.ts and console_hits.ts are TEXT, while console_mail.ts is timestamptz: cast to compare.
--   * A group child opp uses the slug pattern parent--r-<hash>; a reply on such a slug is legitimate.
--   * There is NO console_activity table: activity is local-only and never reaches Supabase (see Hunt 6).

-- ============================================================================
-- Hunt 1: a card whose stage claims a send (sent/opened) with NO send record.
-- The exact phantom the intake-integrity brief closed on read; this finds any that persisted.
-- A row is a phantom only if there is no outbound mail row AND no recorded manual contact.
-- ============================================================================
select o.slug, o.stage, o.data->>'stage' as data_stage
  from public.console_opps o
 where (coalesce(o.stage,'') in ('sent','opened')
        or coalesce(o.data->>'stage','') in ('sent','opened'))
   and not exists (
     select 1 from public.console_mail m
      where m.opp = o.slug
        and coalesce(m.data->>'direction','') = 'out'
        and coalesce(m.status,'') in ('sent','copied','pending'))
   and not exists (
     select 1 from jsonb_array_elements(
       case when jsonb_typeof(o.data->'manual_contacts')='array'
            then o.data->'manual_contacts' else '[]'::jsonb end) mc
      where coalesce(mc->>'sent_on','') <> '');

-- ============================================================================
-- Hunt 2: a child opportunity whose parent is absent.
-- A child carries data->>'spawned_from' (the parent slug) and/or a slug of the form parent--r-<hash>.
-- ============================================================================
select c.slug,
       coalesce(nullif(c.data->>'spawned_from',''), split_part(c.slug,'--r-',1)) as parent_slug
  from public.console_opps c
 where (coalesce(c.data->>'spawned_from','') <> '' or c.slug like '%--r-%')
   and not exists (
     select 1 from public.console_opps p
      where p.slug = coalesce(nullif(c.data->>'spawned_from',''), split_part(c.slug,'--r-',1)));

-- ============================================================================
-- Hunt 3: a slug disagreeing with itself.
-- The slug column is the primary key, so column-level duplicates cannot exist; the real divergence is a
-- row whose data->>'slug' disagrees with its slug column, or two rows whose data slug collides.
-- ============================================================================
select o.slug, o.data->>'slug' as data_slug
  from public.console_opps o
 where coalesce(o.data->>'slug','') <> '' and o.data->>'slug' <> o.slug;

select o.data->>'slug' as data_slug, count(*) as n
  from public.console_opps o
 where coalesce(o.data->>'slug','') <> ''
 group by o.data->>'slug'
having count(*) > 1;

-- ============================================================================
-- Hunt 4: an inbound reply pointing at a missing opportunity.
-- A group child reply legitimately uses a parent--r-<hash> slug, so accept an exact match OR a match on
-- the parent slug before flagging.
-- ============================================================================
select i.id, i.opp, i.kind
  from public.console_inbound i
 where coalesce(i.opp,'') <> ''
   and not exists (select 1 from public.console_opps o where o.slug = i.opp)
   and not exists (select 1 from public.console_opps o where o.slug = split_part(i.opp,'--r-',1));

-- ============================================================================
-- Hunt 5: a visit (open) attributed with no send.
-- Only real outreach opens count: type='open', not the operator's own view (self=false). A visit is a
-- phantom if there is no qualifying send for its slug at or before the visit. console_hits.ts is TEXT, so
-- it is cast to compare with the timestamptz send ts; a manual contact with a sent_on also qualifies.
-- ============================================================================
select h.id, h.slug, h.ts
  from public.console_hits h
 where h.type = 'open' and coalesce(h.self,false) = false
   and not exists (
     select 1 from public.console_mail m
      where m.opp = h.slug
        and coalesce(m.data->>'direction','') <> 'in'
        and coalesce(m.status,'') in ('sent','copied','pending')
        and m.ts <= (nullif(h.ts,''))::timestamptz)
   and not exists (
     select 1 from public.console_opps o
      join lateral jsonb_array_elements(
        case when jsonb_typeof(o.data->'manual_contacts')='array'
             then o.data->'manual_contacts' else '[]'::jsonb end) mc on true
     where o.slug = h.slug and coalesce(mc->>'sent_on','') <> ''
       and (mc->>'sent_on') <= h.ts);

-- ============================================================================
-- Hunt 6: an actor-less send.
-- IMPORTANT: activity is LOCAL-ONLY. There is no console_activity table, so activity rows cannot be hunted
-- in the database at all; state that plainly in the finding. The nearest server-side actor surface is the
-- mail ledger: console_mail.actor was added additively and is never backfilled, so old outbound sends are
-- honestly actor-less. This lists them (expected for pre-Phase-B history; a finding only if a NEW send is
-- actor-less).
-- ============================================================================
select m.id, m.opp, m.ts, m.actor, m.data->>'actor' as data_actor
  from public.console_mail m
 where coalesce(m.data->>'direction','') = 'out'
   and coalesce(m.actor,'') = '' and coalesce(m.data->>'actor','') = '';

-- ============================================================================
-- Hunt 7: a profile without a display name.
-- The name resolver falls back to the email, so a blank display_name is not broken, but it is the reason a
-- teammate once read as the generic label; this lists who has not set a name yet.
-- ============================================================================
select p.uid, p.email, p.display_name
  from public.console_profiles p
 where coalesce(p.display_name,'') = '';
