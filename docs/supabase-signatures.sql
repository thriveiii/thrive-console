/* Thrive Console - shared signature book (PR-B: "use the card owner's signature").
   Run ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).

   Why: a member's saved signatures lived only in console_profiles.prefs, and console_profiles is OWN-ROW by RLS
   (uid = auth.uid()), so a teammate opening that member's card could never read them. The old engine also
   wrote prefs through a browser-local profile cache, and the live table holds no signatures for any member, so
   whatever a member set exists only in that one browser. This table is the durable, per-user store that every
   authenticated teammate can READ, while each member can WRITE only their own row.

   Shape: one row per member. uid is TEXT (it matches console_profiles.uid, console_opps.owner and the other
   console_ tables, which store the auth uid as text), so every policy compares against auth.uid()::text.
   signatures is the same array the board already keeps: [{ id, name, text }]. def is the id of the member's
   default signature (empty means the first one).

   Additive and idempotent only: create table if not exists, enable row level security (safe to re-run), each
   policy guarded by an existence check, and a backfill that fills ONLY missing rows. No drop, no destructive
   change, nothing rewritten. There is no anon access. */

/* 1. the book */
create table if not exists public.console_signatures (
  uid        text primary key,                       /* the member's auth.uid() as text */
  signatures jsonb not null default '[]'::jsonb,     /* [{ id, name, text }] */
  def        text,                                   /* id of the default signature; empty means the first */
  updated_at timestamptz default now()
);
alter table public.console_signatures enable row level security;

/* 2. policies: teammates READ every row (the card owner's signature must be readable); each member WRITES only
   their own row. */
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_signatures' and policyname='console_signatures_read_all') then
    execute 'create policy console_signatures_read_all on public.console_signatures for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_signatures' and policyname='console_signatures_insert_own') then
    execute 'create policy console_signatures_insert_own on public.console_signatures for insert to authenticated with check (uid = auth.uid()::text)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_signatures' and policyname='console_signatures_update_own') then
    execute 'create policy console_signatures_update_own on public.console_signatures for update to authenticated using (uid = auth.uid()::text) with check (uid = auth.uid()::text)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_signatures' and policyname='console_signatures_delete_own') then
    execute 'create policy console_signatures_delete_own on public.console_signatures for delete to authenticated using (uid = auth.uid()::text)';
  end if;
end $$;

/* 3. backfill: copy any signatures already saved in a member's profile prefs into the shared book. Fills only
   members who have no book row yet and who actually have a non-empty array; nothing else is touched. */
insert into public.console_signatures (uid, signatures)
select p.uid::text, p.prefs->'signatures'
from public.console_profiles p
where jsonb_typeof(p.prefs->'signatures') = 'array'
  and jsonb_array_length(p.prefs->'signatures') > 0
on conflict (uid) do nothing;
