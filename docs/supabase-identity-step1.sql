-- Thrive Console - Step 1 (identity unification): signature_title on console_profiles
-- ADDITIVE ONLY. No drop, no destructive change, safe to re-run. Thyab applies this in the Supabase
-- SQL editor; the client already tolerates its absence (board.html reads signature_title with select=*
-- and falls back to prefs.title, so an unapplied migration never errors a read).
--
-- WHY. console_profiles already holds the per-operator signature inside prefs (sig_en / sig_ar, written by
-- the engine at library/app.js:1789). What is missing is a signature TITLE - the line under a name in a
-- signature block (for example "Managing Partner"). There is no such column and no prefs.title today
-- (verified: no signature_title anywhere in the repo). This adds the column so a later step can edit it.
--
-- The base table keeps its existing owner-only RLS (console_profiles_own, uid = auth.uid(),
-- supabase-operator-profile.sql:51). This file changes NO policy; it only adds a nullable column.

-- 1. the column ---------------------------------------------------------------------
alter table public.console_profiles
  add column if not exists signature_title text;

-- 2. RLS INTENT for a later step (documented here, NOT enforced by this file) --------
-- The two-tier write law for this column, to be enforced by policy when the edit UI ships (a later step):
--   * display_name and the operator's OWN prefs (language, theme, signature body) are editable by the ROW
--     OWNER: the existing console_profiles_own policy (uid = auth.uid()) already grants exactly that.
--   * signature_title AND role are ADMIN-ONLY: a member must not be able to grant themselves a title or a
--     role from a session. role already lives in console_members with NO client write policy
--     (supabase-members-oversight.sql:49), so it is owner-managed by SQL only. signature_title should be
--     writable only by an owner-tier operator, enforced by a policy such as (illustrative, for the later
--     step, do NOT run here):
--
--       -- allow an owner (console_admins row) to update any profile's signature_title; a non-owner may
--       -- update only their own non-privileged columns. Enforce with a column-aware UPDATE policy or a
--       -- SECURITY DEFINER function; never rely on the client hiding a field.
--       -- create policy console_profiles_admin_title on public.console_profiles
--       --   for update to authenticated
--       --   using (exists (select 1 from public.console_admins a where a.uid = auth.uid()));
--
-- The rule stated for the whole console: a privileged value (title, role) is protected by the database,
-- never by the client hiding a control.

-- 3. VERIFICATION (read-only) -------------------------------------------------------
-- Run after applying. Returns one row if the column now exists.
select 'signature_title present' as finding
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'console_profiles'
   and column_name  = 'signature_title';
