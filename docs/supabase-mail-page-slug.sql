-- Thrive Console · Phase 3 (Contacts + Template memory + Reply tags)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation + safety:
--   * Touches ONLY console_mail, a console_ table. Nothing outside that prefix. No other project.
--   * Additive and idempotent: add column if not exists. There is no drop, no data rewrite, no policy change.
--     Existing rows keep working; the new column is simply NULL on them and the surface derives the template
--     for those old rows from the opportunity (console_opps.data->>'page_slug', falling back to the opp slug).
--
-- What this adds, and why:
--   * console_mail.page_slug: the template/page a send used, stamped by the client at send time from the SAME
--     pageSlug it already computes (data.page_slug || slug). This makes "which template went to whom" ONE hop
--     (group console_mail by page_slug) instead of joining every send back through the opportunity. The console
--     also mirrors this value into the row's existing data jsonb (data.page_slug), so the Contacts / Template
--     surfaces read correctly even before this column is applied; the column is the durable, queryable home.

alter table console_mail add column if not exists page_slug text;

-- Optional, fast "who received this template" lookups (safe to re-run):
create index if not exists console_mail_page_slug_idx on public.console_mail (page_slug);
