-- Thrive Console · duplicate-slug reconcile (an ampersand-dropped phantom folded into its canonical slug)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Why this exists: the intake slug used to drop "&" instead of reading it as "and", so a business named
-- "Gift & Gather" derived TWO slugs for one shop -- the canonical gift-and-gather (from the manifest/zip)
-- and a phantom gift-gather (the ampersand dropped). The intake is now DETERMINISTIC: "&" always reads as
-- "and", in both the match key and the slug (library/intake.js: keyOf and slugify), so a page and its
-- manifest entry resolve to the SAME identity and merge into one row -- no NEW phantom is ever created.
-- This statement only ALIGNS the already-stored data with that rule: it folds an existing phantom into its
-- canonical row. No source change is required for future imports to be correct.
--
-- Isolation, the first rule:
--   * Every statement touches console_opps ONLY. Nothing outside the console_ prefix is read or written,
--     and no other Supabase project is referenced.
--   * Additive and idempotent, and it DELETES NOTHING. The phantom row is not dropped: it is marked
--     archived (so the board, which already excludes archived cards, stops showing it) and carries an
--     audit trail on its own record -- reconciled_into (the canonical slug it folded into), the reason,
--     and the time. A second run changes nothing, because the first run left the phantom already archived
--     and already carrying reconciled_into, and the WHERE clause skips both. There is no drop and no alter.
--   * SAFETY: the phantom is only ever retired when its canonical row EXISTS, so this can never retire the
--     only copy of a shop. If the canonical is absent, the row is left untouched for a human to decide.
--
-- The known pair is gift-gather -> gift-and-gather. If another ampersand-dropped phantom ever surfaces,
-- add it to the VALUES list below (phantom, canonical) and re-run; the statement stays idempotent.

with pairs(phantom, canonical) as (
  values
    ('gift-gather', 'gift-and-gather')
    -- , ('another-phantom', 'another-and-canonical')
)
update public.console_opps o
   set data = jsonb_set(
                jsonb_set(
                  jsonb_set(coalesce(o.data, '{}'::jsonb),
                            '{archived}', 'true'::jsonb),
                  '{reconciled_into}', to_jsonb(p.canonical)),
                '{reconciled_reason}',
                to_jsonb('ampersand-dropped duplicate slug; "&" now reads as "and", folded into the canonical shop'::text)),
       updated_at = now()
  from pairs p
 where o.slug = p.phantom
   -- idempotent: skip a row that is already archived or already carries the fold audit
   and coalesce(o.data->>'archived', '') <> 'true'
   and coalesce(o.data->>'reconciled_into', '') = ''
   -- safety: never retire the only copy of a shop -- the canonical must already exist
   and exists (select 1 from public.console_opps c where c.slug = p.canonical);

-- After this runs, the review/board shows one row per real shop (organic-allure, gift-and-gather,
-- fleurs-de-lea): the gift-and-gather record stands, and the gift-gather phantom is archived off the board
-- with an on-record note saying which shop it was folded into and why. Nothing was deleted.
