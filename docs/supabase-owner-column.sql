/* OWNER COLUMN + BACKFILL (additive, non-destructive). Run once in the Supabase SQL editor.

   Each opportunity's owner is the member who created / uploaded it (the auth uid, matching console_mail.actor
   and the console_profiles / console_profile_names key). The console stamps it at create / upload / send from
   the client (currentUid); this migration adds the column and backfills existing rows.

   It is additive: it adds a nullable column IF NOT EXISTS, then fills ONLY rows that have no owner yet, from the
   earliest send actor for that opp (console_mail.actor). A row with no send stays null (shown as unassigned) and
   is never given a fabricated owner. It changes no send, compile, or any other column, and removes no data. */

alter table public.console_opps add column if not exists owner text;

update public.console_opps o
set owner = m.actor
from (
  select distinct on (opp) opp, actor
  from public.console_mail
  where actor is not null and actor <> ''
  order by opp, ts asc
) m
where m.opp = o.slug
  and coalesce(o.owner, '') = '';
