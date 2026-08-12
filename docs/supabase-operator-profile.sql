-- Thrive Console · operator profile subsystem (Phase A)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule:
--   * Every object here is console_ prefixed. Nothing outside that prefix is created, altered, or
--     dropped. No other Supabase project is referenced. The newsroom is not touched.
--   * Additive and idempotent only: create table if not exists, enable RLS (safe to re-run), and each
--     policy guarded by an existence check so a second run changes nothing. There is no drop.
--
-- What this adds, and why it is the FIRST per-owner-scoped pair in this project:
--   * console_profiles: one row per operator, keyed to auth.uid(), holding preferences and memory as
--     JSON. RLS scopes each row to its owner, so an operator reads and writes ONLY their own profile
--     and there is no anon access at all. This is stronger than the op_prefs:<uid> key convention on
--     console_settings, which relied on the client querying only its own key.
--   * console_admins: the two-tier boundary as a DATABASE fact. A row per owner-tier operator. An
--     operator can read only whether THEY are an admin (select scoped to auth.uid()); no client can
--     insert, update or delete, so the tier can never be self-granted. The admin identity lives here,
--     seeded below, and NEVER as a literal in any client (the client only ever asks "is my own uid in
--     this table"). This is what makes the owner tier a role check, not a readable secret.
--
-- These policies are written for the AUTHENTICATED role (the signed-in Supabase session), because a
-- profile is meaningful only for a signed-in operator. Unlike the Stage-1 console_ tables, they grant
-- NO anon access: a signed-out client cannot see any profile or admin row.

-- 1. profiles: one row per operator, scoped to its owner --------------------------
create table if not exists console_profiles (
  uid           text primary key,            -- the operator's Supabase auth.uid()
  email         text,                         -- their own email, for display (LTR, never a secret)
  display_name  text,
  avatar        text,
  prefs         jsonb default '{}'::jsonb,    -- language, theme, digest, default view, timezone, signature
  memory        jsonb default '{}'::jsonb,    -- dismissed hints, pinned cards, draft notes
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 2. admins: the owner tier, a database fact, un-self-promotable --------------------
create table if not exists console_admins (
  uid           text primary key,            -- an owner-tier operator's auth.uid()
  email         text,
  added_at      timestamptz default now()
);

alter table console_profiles enable row level security;
alter table console_admins    enable row level security;

do $$
begin
  -- profiles: an operator reads and writes ONLY their own row (uid = auth.uid()); no anon access.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_profiles' and policyname='console_profiles_own') then
    execute 'create policy console_profiles_own on public.console_profiles for all to authenticated using (uid = auth.uid()) with check (uid = auth.uid())';
  end if;

  -- admins: an operator may read ONLY their own row, so a client can learn whether IT is an admin and
  -- nothing about anyone else. There is deliberately NO insert/update/delete policy for any client
  -- role, so the tier cannot be self-granted from a session; only this SQL (run as the table owner)
  -- writes it. That is the whole point of enforcing the tier at the database rather than in the UI.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_admins' and policyname='console_admins_read_own') then
    execute 'create policy console_admins_read_own on public.console_admins for select to authenticated using (uid = auth.uid())';
  end if;
end $$;

-- 3. seed the owner tier from the auth identity, by email -------------------------
-- The email literal lives ONLY here, in the SQL Thyab runs, never in any client. This resolves the
-- owner's auth.uid() from auth.users, so the client never needs to compare against an address.
insert into console_admins (uid, email)
select id, email from auth.users
where lower(email) in ('abdu.thyab@gmail.com', 'hi@thriveiii.com')
on conflict (uid) do nothing;
