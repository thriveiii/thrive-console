/* OWNER BACKFILL (optional, additive, non-destructive). Run once in the Supabase SQL editor.

   The console stores each opportunity's owner (the member who created/uploaded it) in the EXISTING
   console_opps.data jsonb, under data.owner (the auth uid). New cards stamp it at creation from the client, so
   NO schema change is required for the feature to work. Existing cards created before that stamp existed are
   already shown with a DERIVED owner (the earliest send's console_mail.actor) read client-side, so this backfill
   is not required either - it only makes that derivation DURABLE in data.owner for existing rows.

   This statement is additive: it writes data.owner ONLY for opps that do not already carry one, from the
   earliest send actor for that opp. It never overwrites an existing owner and never removes any data. It does
   not touch send, compile, or any other column. */

update public.console_opps o
set data = jsonb_set(coalesce(o.data, '{}'::jsonb), '{owner}', to_jsonb(m.actor), true)
from (
  select distinct on (opp) opp, actor
  from public.console_mail
  where actor is not null and actor <> ''
  order by opp, ts asc
) m
where m.opp = o.slug
  and coalesce(o.data->>'owner', '') = '';
