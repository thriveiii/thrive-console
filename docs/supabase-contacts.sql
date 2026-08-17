-- Thrive Console · the Contact Book (curation overlay)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule:
--   * Every object here is console_ prefixed. Nothing outside that prefix is created, altered, or
--     dropped. No other Supabase project is referenced. The newsroom is not touched.
--   * Additive and idempotent only: create table if not exists, enable RLS (safe to re-run), and each
--     policy guarded by an existence check so a second run changes nothing. There is no drop.
--
-- What this adds:
--   * console_contacts: the team's Contact Book, ONE row per person. This table holds ONLY curation
--     facts, the facts a human decides and a machine cannot derive:
--       - addresses: the bare email addresses a human has confirmed belong to ONE person (the merge
--         grouping). This is the whole point of the Book: the ledger lists addresses, a person decides
--         which addresses are the same human.
--       - name: the curated display name for the person (nullable; the surface falls back to a name
--         derived from the ledger when this is null).
--       - tags: free tags plus the standing set (client, prospect, partner, personal, test).
--       - note: a free-text note about the person.
--     The activity history itself (campaigns touched, sends, opens, replies, bounces, last activity) is
--     NEVER copied here. It stays derived live from console_mail, console_hits and console_inbound. A
--     contact row is a lens over the ledger, not a copy of it, so a merge is reversible by deleting the
--     row and the ledger is never disturbed.
--
-- The Book is SHARED by design: every authenticated operator reads and curates the same directory (it is
-- the team's shared address book, like the board, not a private notebook). Each write is stamped with
-- its author's uid and a snapshot of the author's display name for an audit trail. There is NO anon
-- access at all: a signed-out client can neither read nor curate the Book.

-- 1. contacts: one person, one record; curation facts only --------------------------
create table if not exists console_contacts (
  id           text primary key,             -- client-minted stable person id (also the Stage-4 idempotency key)
  addresses    jsonb not null default '[]'::jsonb,  -- the bare addresses a human grouped as ONE person (the merge)
  name         text,                          -- curated display name (nullable; surface derives a fallback from the ledger)
  tags         jsonb not null default '[]'::jsonb,  -- free tags + the standing set (client/prospect/partner/personal/test)
  note         text,                          -- free-text note about the person
  author       text,                          -- the curator's Supabase auth.uid() (audit trail)
  author_name  text,                          -- display-name snapshot from the curator's console_profiles at write time
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Containment lookups ("which person owns this address?") read the grouped addresses array.
create index if not exists console_contacts_addresses_idx on public.console_contacts using gin (addresses);

alter table console_contacts enable row level security;

do $$
begin
  -- read: OPEN to authenticated. Every operator reads the same shared Contact Book. No anon.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_contacts' and policyname='console_contacts_read_all') then
    execute 'create policy console_contacts_read_all on public.console_contacts for select to authenticated using (true)';
  end if;

  -- insert: any authenticated operator may add a person record to the shared Book, stamped as their own.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_contacts' and policyname='console_contacts_insert_auth') then
    execute 'create policy console_contacts_insert_auth on public.console_contacts for insert to authenticated with check (author = auth.uid())';
  end if;

  -- update: any authenticated operator may curate any person in the shared Book (fix a merge, retag).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_contacts' and policyname='console_contacts_update_auth') then
    execute 'create policy console_contacts_update_auth on public.console_contacts for update to authenticated using (true) with check (true)';
  end if;

  -- delete: any authenticated operator may un-merge (remove a person record); the ledger is untouched.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_contacts' and policyname='console_contacts_delete_auth') then
    execute 'create policy console_contacts_delete_auth on public.console_contacts for delete to authenticated using (true)';
  end if;
end $$;
