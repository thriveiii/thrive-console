-- Thrive Console · data-hygiene audit (READ-ONLY hunts, then additive cleanup)
-- Run in the SQL editor of the "thrive-console" Supabase project ONLY. Nothing here touches a table outside
-- the console_ prefix, and no row is ever deleted. Part A is read-only (SELECT) to SEE the hits; Part B is
-- additive and idempotent, to be run only after Part A shows what it will touch.
--
-- Scope of the hunts (Section 1 of the consistency audit):
--   1. Duplicate / non-canonical slugs  (the "&" phantom: gift-gather vs gift-and-gather)
--   2. console_inbound noise             (github / google / dmarc / no-reply that are not campaign replies)
--   3. Orphans and empties               (mail with no opp; opp with no business; inbound with no opp and no
--                                         matching send)
--   4. Duplicate opportunities           (one shop under two slugs)

-- =====================================================================================================
-- PART A · READ-ONLY HUNTS  (run these first; they change nothing)
-- =====================================================================================================

-- A1. Non-canonical "&"-dropped slugs: a slug that would change if "&" read as "and". These are the
--     gift-gather-class phantoms. (The client derivation is now deterministic in PR #159; this finds any
--     already-stored phantom whose canonical twin also exists.)
select o.slug as phantom_slug, c.slug as canonical_slug, o.data->>'business' as business
  from public.console_opps o
  join public.console_opps c
    on c.slug = regexp_replace(regexp_replace(lower(coalesce(o.data->>'business','')), '&', ' and ', 'g'),
                               '[^a-z0-9]+', '-', 'g')
 where c.slug <> o.slug
   and o.slug <> ''
 order by canonical_slug;

-- A2. console_inbound noise that is (wrongly) carrying an opp link. Expected: ZERO rows. Noise
--     (kind=auto, dmarc, google.com/github.com senders, no-reply) must never be attributed to a campaign.
select gid, opp, kind, data->>'from' as from_addr, data->>'subject' as subject
  from public.console_inbound
 where coalesce(opp, '') <> ''
   and ( coalesce(data->>'kind','') = 'auto'
      or lower(coalesce(data->>'from','')) ~ '(dmarc|no-?reply|mailer-daemon)'
      or split_part(split_part(lower(coalesce(data->>'from','')), '@', 2), '>', 1) in ('google.com','github.com') )
 order by gid;

-- A3a. Mail rows with no opp (an outbound send filed against nothing).
select id, data->>'to' as to_addr, data->>'subject' as subject, data->>'ts' as ts
  from public.console_mail
 where coalesce(opp, '') = ''
 order by ts;

-- A3b. Opportunities with no business name (a card that cannot label itself).
select slug, data->>'stage' as stage
  from public.console_opps
 where coalesce(data->>'business', '') = ''
 order by slug;

-- A3c. Inbound with no opp AND no send it could answer (a reply matching no campaign at all).
select i.gid, i.data->>'from' as from_addr, i.data->>'subject' as subject
  from public.console_inbound i
 where coalesce(i.opp, '') = ''
   and coalesce(i.data->>'kind','') <> 'auto'
   and not exists (
     select 1 from public.console_mail m
      where coalesce(m.data->>'direction','') = 'out'
        and lower(coalesce(m.data->>'to','')) = lower(coalesce(i.data->>'from',''))
   )
 order by i.gid;

-- A4. Duplicate opportunities: the same business under two different slugs.
select lower(trim(data->>'business')) as business, count(*) as n,
       string_agg(slug, ', ' order by slug) as slugs
  from public.console_opps
 where coalesce(data->>'business','') <> ''
 group by lower(trim(data->>'business'))
 having count(*) > 1
 order by n desc;

-- =====================================================================================================
-- PART B · ADDITIVE CLEANUP  (idempotent; run only after Part A shows the rows; deletes nothing)
-- =====================================================================================================
--
-- B1. The "&"-dropped phantom fold is handled by its own audited migration:
--       docs/supabase-slug-reconcile.sql  (archives the phantom, records reconciled_into, keeps the row).
--     Run that; do not duplicate it here.
--
-- B2. Noise that carries an opp (if A2 returned any): unlink it. Additive and idempotent -- it only clears
--     the link on rows the noise filter says should never have carried one, and never deletes the row, so
--     the machinery stays on record but stops surfacing as a reply.
update public.console_inbound
   set opp = '',
       data = jsonb_set(coalesce(data,'{}'::jsonb), '{unlinked_reason}',
                        to_jsonb('automated / noise sender, never a campaign reply'::text)),
       updated_at = now()
 where coalesce(opp, '') <> ''
   and ( coalesce(data->>'kind','') = 'auto'
      or lower(coalesce(data->>'from','')) ~ '(dmarc|no-?reply|mailer-daemon)'
      or split_part(split_part(lower(coalesce(data->>'from','')), '@', 2), '>', 1) in ('google.com','github.com') )
   and coalesce(data->>'unlinked_reason','') = '';   -- idempotent: skip rows already unlinked here
--
-- B3. Orphans from A3 are LEFT IN PLACE as harmless by default: a mail row with no opp is a historical
--     send that predates linking, an inbound with no opp and no send is a stray forward -- neither surfaces
--     on the board (the board reads console_board, which requires an opp), so neither misleads. Delete
--     nothing; if a specific orphan is confirmed junk by a human, archive it additively rather than drop it.
--
-- B4. Duplicate opportunities from A4 (a real shop under two slugs, not the "&" case) are a HUMAN decision:
--     which slug is canonical is a judgement, so this migration does not guess. Fold the non-canonical one
--     with the same audited pattern as the slug reconcile (set archived=true + reconciled_into) once the
--     canonical slug is chosen. Never merge automatically.
