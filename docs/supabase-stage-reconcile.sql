-- ============================================================================
-- Thrive Console - stage-source reconciliation (READ-ONLY hunts, then additive)
--
-- The structural gap: a card can live in the manifest with NO row in console_opps,
-- so it has no row in console_board either. The board reads its own base (ready or
-- draft) for such a card, and before this PR the card detail read a SECOND source
-- and could show opened or replied. Ludic Lillian is the live instance: a slug and
-- name search in console_opps returns nothing.
--
-- The client fix (library/app.js resolvedStage) already makes both surfaces agree
-- WITHOUT any data change: an absent card reads ready/draft on the board AND in the
-- detail. This file is the DATA-completeness follow-up: it (A) proves the DB-side
-- invariants read-only, and (B) additively lets the view carry a real opportunity
-- that was missing, so its stage is server-computed rather than a base fallback.
--
-- READ-ONLY first (Part A). ADDITIVE and IDEMPOTENT only (Part B): no row is ever
-- deleted, no stage is ever overwritten. Run in the "thrive-console" project only.
-- The manifest-vs-opps direction is done by tools/reconcile.js (the manifest lives
-- in the repo, not the DB); run it with an exported console_opps snapshot.
-- ============================================================================

-- =====================================================================================================
-- PART A - READ-ONLY HUNTS  (run first; they change nothing)
-- =====================================================================================================

-- A1. console_opps -> console_board is 1:1 by construction (the view is `from console_opps o` with LEFT
--     JOINs), so every opps row must yield exactly one board row. This lists any opps slug the view does
--     NOT carry. Expected: ZERO rows. A non-empty result means the view lost a row (investigate the join).
select o.slug, o.business
  from public.console_opps o
  left join public.console_board b on b.slug = o.slug
 where b.slug is null
 order by o.slug;

-- A2. Row-count agreement, the same invariant stated as counts. Expected: equal.
select (select count(*) from public.console_opps)  as opps_rows,
       (select count(*) from public.console_board) as board_rows;

-- A3. Non-canonical / duplicate slugs inside console_opps (the gift-gather and Madar-school class): a slug
--     that would change if "&" read as "and", or two rows for one business. Deletes nothing; lists the pair.
select o.slug as slug, o.business,
       regexp_replace(regexp_replace(lower(coalesce(o.business,'')), '&', ' and ', 'g'),
                      '[^a-z0-9]+', '-', 'g') as canonical_ascii
  from public.console_opps o
 where coalesce(o.business,'') <> ''
   and regexp_replace(regexp_replace(lower(coalesce(o.business,'')), '&', ' and ', 'g'),
                      '[^a-z0-9]+', '-', 'g') <> ''
   and o.slug <> trim(both '-' from regexp_replace(regexp_replace(lower(coalesce(o.business,'')), '&', ' and ', 'g'),
                      '[^a-z0-9]+', '-', 'g'))
 order by o.business;

-- A4. Duplicate opportunities: one business under two slugs (same as hygiene-audit A4; repeated here so the
--     stage reconciliation is self-contained). A human picks the canonical slug; the migration never guesses.
select lower(trim(business)) as business, count(*) as n, string_agg(slug, ', ' order by slug) as slugs
  from public.console_opps
 where coalesce(business,'') <> ''
 group by lower(trim(business))
 having count(*) > 1
 order by n desc;

-- =====================================================================================================
-- PART B - ADDITIVE RECONCILIATION  (idempotent; deletes nothing, overwrites no stage)
-- =====================================================================================================

-- B1. LUDIC LILLIAN - the decision, stated and made additive.
--     Decision: Ludic Lillian is a REAL opportunity, not stale in the manifest. Its manifest entry carries a
--     live page (activated), a sent_on date and a location (Fairfax, VA), and the operator has recorded
--     activity against it. It therefore BELONGS in console_opps so the view carries it and computes its
--     stage server-side (from the console_mail/console_hits/console_inbound rows that exist for it), instead
--     of the board reading a base fallback. This inserts the row from its manifest identity and NOTHING else:
--     no stage is set (the view derives it), published=true reflects its live page. Idempotent: on conflict
--     it does nothing, so re-running is safe and an existing row (with its own richer data) is never clobbered.
insert into public.console_opps (slug, business, published)
values ('ludic-lillian', 'Ludic Lillian', true)
on conflict (slug) do nothing;

-- B2. Any OTHER manifest card that tools/reconcile.js reports as missing from console_opps is folded the
--     same way, one INSERT ... ON CONFLICT DO NOTHING per real card, once the human confirms it is real (a
--     card that is genuinely stale in the manifest is retired from the manifest instead - never inserted
--     here, and never deleted silently). Template to copy per confirmed-real slug:
--
--   insert into public.console_opps (slug, business, published)
--   values ('<slug>', '<business>', <true|false>)
--   on conflict (slug) do nothing;
--
-- B3. Slug-form reconciliation (A3 hits, e.g. the Madar school slug مدرسة vs the business مدارس) is a HUMAN
--     decision - which slug is canonical is a judgement, so this migration does not guess. Fold the
--     non-canonical row with the audited archived + reconciled_into pattern from
--     docs/supabase-slug-reconcile.sql once the canonical slug is chosen. Never merge automatically.
--
-- B4. No stage is written anywhere in this file. A stage is the view's to compute from evidence; the only
--     additive act here is giving a real, missing opportunity a row so the ONE authority (console_board via
--     resolvedStage) can carry it. Everything else the client fix already reconciles at read time.
