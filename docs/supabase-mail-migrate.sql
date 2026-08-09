-- Thrive Console · Supabase mail-ledger migration (replies and opens tables)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation: every object is console_ prefixed. Nothing outside that prefix is created, altered, or
-- dropped. Additive and idempotent only (create table if not exists, enable RLS which is safe to re-run,
-- and a policy per table guarded by an existence check). console_mail already exists from Stage 1; this
-- adds the two stores Stage 2 missed, so the states and replies can be read back from Supabase:
--   * console_inbound: one row per reply (and per auto bounce notice), keyed on the Gmail message id.
--   * console_hits:    one row per open, keyed on the console's hitKey (type|slug|ts|vid).
-- The whole record travels in a data jsonb, so the shape read back is exactly the shape written.

create table if not exists console_inbound (
  id          text primary key,   -- the Gmail message id (gid); the same key the inbound merge dedupes on
  opp         text,
  kind        text,               -- "" a real reply, "auto" a mailer-daemon notice
  bounce      text,               -- "hard" / "soft" / "" (only on auto notices)
  ts          text,
  data        jsonb,
  up          bigint
);

create table if not exists console_hits (
  id          text primary key,   -- hitKey: type|slug|ts|vid
  slug        text,
  type        text,               -- "open" etc.
  ts          text,
  self        boolean default false,
  data        jsonb
);

alter table console_inbound enable row level security;
alter table console_hits    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['console_inbound','console_hits']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_anon_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon using (true) with check (true)',
        t || '_anon_all', t
      );
    end if;
  end loop;
end $$;
