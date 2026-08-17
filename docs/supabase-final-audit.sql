-- ============================================================================
-- Thrive Console - the provable final audit: read-only data correctness (Part 3)
--
-- One query per column class. Run each; PASTE its output into the ledger
-- (docs/final-audit.md) as the evidence for those columns. Every query is
-- READ-ONLY and changes nothing. A query that returns rows where "expected: zero"
-- is a numbered finding, not a pass. Run in the "thrive-console" project.
--
-- The column inventory these cover is generated mechanically by
-- tools/audit_inventory.js (68 columns across 10 console_* tables); this file
-- proves the load-bearing ones. The identity/text columns (business, subject,
-- html, name, avatar, prefs, memory) are proven by "not null where required" and
-- by the surface screenshots, not re-queried per row.
-- ============================================================================

-- 0. COLUMN INVENTORY, from the live DB (evidence for Part 2 completeness). Paste
--    this; it must match tools/audit_inventory.js. Any column here not in the audit
--    means the audit is incomplete.
select table_name, string_agg(column_name, ', ' order by ordinal_position) as columns
  from information_schema.columns
 where table_schema = 'public' and table_name like 'console\_%'
 group by table_name order by table_name;

-- ---- console_opps ----------------------------------------------------------
-- A1. slug is the primary key: never null, never blank. Expected: ZERO rows.
select slug, business from public.console_opps where slug is null or slug = '';
-- A2. business present (a card must label itself). Expected: ZERO rows (or a stated finding).
select slug from public.console_opps where coalesce(business,'') = '';
-- A3. non-canonical slug (the "&"-dropped / school class): a slug that differs from its
--     business canonicalized. Expected: ZERO, or a stated slug-reconcile finding.
select slug, business,
       regexp_replace(regexp_replace(lower(coalesce(business,'')),'&',' and ','g'),'[^a-z0-9]+','-','g') as canonical
  from public.console_opps
 where coalesce(business,'') <> '' and business !~ '[^\x00-\x7f]'   -- ASCII businesses only (Arabic verified by hand)
   and slug <> trim(both '-' from regexp_replace(regexp_replace(lower(business),'&',' and ','g'),'[^a-z0-9]+','-','g'));
-- A4. duplicate business under two slugs. Expected: ZERO, or a stated fold finding.
select lower(trim(business)) as business, count(*) n, string_agg(slug,', ') slugs
  from public.console_opps where coalesce(business,'')<>'' group by 1 having count(*)>1;
-- A5. stage sanity: any stored stage outside the known set. Expected: ZERO.
select slug, stage from public.console_opps
 where coalesce(stage,'') <> '' and stage not in
   ('draft','live','ready','sent','opened','replied','bounced','failed','won','lost','dropped');

-- ---- console_mail ----------------------------------------------------------
-- B1. every send row carries its opp (no lane to land on otherwise). Expected: ZERO.
select id, to_addr, subject from public.console_mail where coalesce(opp,'') = '';
-- B2. orphan send: opp not in console_opps. Expected: ZERO (else a stated finding).
select m.id, m.opp from public.console_mail m
  left join public.console_opps o on o.slug = m.opp where o.slug is null and coalesce(m.opp,'')<>'';
-- B3. status is a known one. Expected: ZERO rows outside the set.
select id, opp, status from public.console_mail
 where coalesce(status,'') not in ('','sent','copied','pending','replied','received');
-- B4. duplicate id (the PK dedupes; a re-import must not double). Expected: ZERO.
select id, count(*) n from public.console_mail group by id having count(*)>1;
-- B5. the freeze proof: total count, and the latest send with today's timestamp.
select count(*) as console_mail_rows from public.console_mail;
select id, opp, status, to_addr, subject, ts from public.console_mail order by ts desc nulls last limit 10;

-- ---- console_inbound -------------------------------------------------------
-- C1. noise (dmarc / no-reply / google / github / mailer-daemon) must NOT carry an
--     opp (it is not a campaign reply). Expected: ZERO (docs/supabase-hygiene-audit.sql B2 unlinks any).
select id, opp, data->>'from' as from_addr from public.console_inbound
 where coalesce(opp,'')<>'' and ( coalesce(kind,'')='auto'
   or lower(coalesce(data->>'from','')) ~ '(dmarc|no-?reply|mailer-daemon)'
   or split_part(split_part(lower(coalesce(data->>'from','')),'@',2),'>',1) in ('google.com','github.com') );
-- C2. bounce values are known. Expected: ZERO rows outside the set.
select id, bounce from public.console_inbound where coalesce(bounce,'') not in ('','hard','soft');
-- C3. a real reply resolves to an opp (subject-linked or attached). A reply with no opp
--     and no matching send is stray noise; list it (a finding only if it should have linked).
select i.id, i.data->>'from' as from_addr, i.data->>'subject' as subject
  from public.console_inbound i
 where coalesce(i.opp,'')='' and coalesce(i.kind,'')<>'auto'
   and not exists (select 1 from public.console_mail m
     where coalesce(m.data->>'direction','')<>'in'
       and lower(coalesce(m.to_addr,''))=lower(coalesce(i.data->>'from','')));

-- ---- console_hits ----------------------------------------------------------
-- D1. an open hit is keyed to a slug. Expected: ZERO blank-slug hits.
select id, type from public.console_hits where coalesce(slug,'')='';
-- D2. self flag is boolean-clean (the sender's own visits are excluded from opens). Peek.
select coalesce(self::text,'null') as self, count(*) from public.console_hits group by 1;

-- ---- console_board (lane == detail for every card) -------------------------
-- E1. THE ONE-STAGE INVARIANT, server side: the view emits exactly one row per opp,
--     with one stage. lane==detail is proven engine-independently by one_stage_source_test;
--     here, confirm 1:1 and no null stage. Expected: board rows == opps rows, ZERO null stage.
select (select count(*) from public.console_opps) as opps,
       (select count(*) from public.console_board) as board,
       (select count(*) from public.console_board where coalesce(stage,'')='') as board_null_stage;
-- E2. every board stage is a known lane. Expected: ZERO rows outside the set.
select slug, stage from public.console_board
 where stage not in ('draft','live','sent','opened','replied','bounced','failed','won','lost','dropped');

-- ---- console_comments / console_profiles / console_templates ---------------
-- F1. a comment carries its author and opp (RLS ownership + the thread it belongs to). Expected: ZERO.
select id from public.console_comments where coalesce(author,'')='' or coalesce(opp,'')='';
-- F2. a template carries a kind and a name. Expected: ZERO blank.
select id from public.console_templates where coalesce(kind,'')='' or coalesce(name,'')='';
-- F3. a profile is keyed by uid. Expected: ZERO blank.
select uid from public.console_profiles where coalesce(uid,'')='';
