-- Thrive Console · members, roles, and the owner's oversight (P27 · R17)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule (unchanged from every migration before it):
--   * Every object here is console_ prefixed. Nothing outside that prefix is created, altered, or
--     dropped. No other Supabase project is referenced. The newsroom is not touched, read, or reused;
--     this feature is authored natively for Thrive and the firewall is absolute.
--   * Additive and idempotent only: create table if not exists, enable RLS (safe to re-run), and each
--     policy guarded by an existence check so a second run changes nothing. There is NO drop, and no
--     existing row is rewritten.
--
-- What this adds:
--   * console_members: the roster. One row per member, keyed to their Supabase auth.uid(), holding
--     name, email, role (owner | member), and active. This is the identity P27 resolves a sign-in to;
--     every write's actor is already this uid (currentActor()). The role is the two-role law: a member
--     does the daily work; an owner also sees the oversight room, the member roster, and global settings.
--   * The RLS mirrors console_admins exactly: a member reads ONLY their own row (so a client learns its
--     own role and nothing about anyone else); the owner reads the whole roster (scoped by console_admins
--     membership). There is deliberately NO client insert/update/delete policy, so a role can never be
--     self-granted from a session -- the roster is managed only by this SQL, run as the table owner. That
--     keeps the owner tier a database fact, not a readable-or-writable session capability.
--
-- These policies are for the AUTHENTICATED role; a signed-out client sees nothing.

-- 1. the members roster -----------------------------------------------------------
create table if not exists console_members (
  id            text primary key,            -- the member's Supabase auth.uid() (== currentActor())
  name          text,                         -- display name (LTR/AR, never a secret)
  email         text,                         -- their own email, for the owner's roster
  role          text not null default 'member' check (role in ('owner','member')),
  active        boolean not null default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table console_members enable row level security;

do $$
begin
  -- a member reads ONLY their own row: a client learns its own role/active, nothing about anyone else.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_members' and policyname='console_members_read_own') then
    execute 'create policy console_members_read_own on public.console_members for select to authenticated using (id = auth.uid())';
  end if;
  -- the owner reads the whole roster (scoped by console_admins membership, the same owner-tier fact the
  -- rest of the console already trusts). This is what lets the oversight room list every member.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_members' and policyname='console_members_read_owner') then
    execute 'create policy console_members_read_owner on public.console_members for select to authenticated using (exists (select 1 from public.console_admins a where a.uid = auth.uid()))';
  end if;
  -- NO insert/update/delete policy for any client role: the roster is written only by this SQL. Add or
  -- deactivate a member below, run as the table owner, so a role is never self-granted from a session.
end $$;

-- 2. seed the owner from the auth identity, by email ------------------------------
-- The email literal lives ONLY here, never in a client. This resolves the owner's auth.uid() and files
-- them as role 'owner'. It also mirrors the existing console_admins owner tier, so the two agree.
insert into console_members (id, name, email, role, active)
select id, coalesce(nullif(raw_user_meta_data->>'name',''), split_part(email,'@',1)), email, 'owner', true
from auth.users
where lower(email) in ('abdu.thyab@gmail.com', 'hi@thriveiii.com')
on conflict (id) do update set role='owner', active=true, updated_at=now();

-- 3. add a member (template; uncomment and set the address, run as the table owner) ---------
-- A member is any signed-in operator you file here with role 'member'. Their auth.uid() is resolved
-- from auth.users by email, exactly like the owner seed, so no uid literal is ever needed.
--
-- insert into console_members (id, name, email, role, active)
-- select id, coalesce(nullif(raw_user_meta_data->>'name',''), split_part(email,'@',1)), email, 'member', true
-- from auth.users where lower(email) = 'member@example.com'
-- on conflict (id) do update set role='member', active=true, updated_at=now();

-- 4. the pre-stamp history mapping (stated and reversible) ------------------------
-- Everything recorded before per-operator stamping began carries the reserved default actor 'thyab'
-- (the client's ACTOR constant), reported today as one labeled "console history" bucket. That bucket is
-- attributed to the owner (Thyab) by this stated convention: the client, in the OWNER's own panel and
-- the oversight room, folds the 'thyab' bucket into the owner's totals under a visible "console history"
-- note. Nothing is rewritten -- the ledger rows keep actor='thyab' -- so the mapping is reversible: it
-- is a read-time attribution, undone by removing the fold in the client (or by ignoring this note). No
-- data migration is performed here; this comment IS the mapping of record.
