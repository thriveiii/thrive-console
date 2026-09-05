# The repo SQL is not the live view

**Symptom.** The repo's docs/supabase-board-view.sql had no cycle scoping, but the live view
dropped sends on cycle mismatch. Reasoning from the repo file would have produced the wrong
fix.

**Root.** Supabase views are hand-applied in the SQL editor; the repo .sql file is not the
deployed artifact and drifts. The live view carried a hand-added cycle filter absent from
the repo file.

**How we proved it.** Read the repo file (no cycle scope) against
pg_get_viewdef('console_board', true) (cycle scoped). They differed.

**Fix.** Treat pg_get_viewdef as the only authority. Generate CREATE OR REPLACE VIEW
byte-faithfully from the live def, changing only the target lines. Preserve reloptions
(security_invoker), read from pg_class.reloptions, or the anon board read breaks. Keep the
prior live def as a rollback file.

**Guard.** Never diagnose or patch a DB object from a repo file. Live def is truth. Preserve
security_invoker. Ship a rollback alongside every view change.
