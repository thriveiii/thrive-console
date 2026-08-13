-- Thrive Console · team discussion subsystem (comments)
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule:
--   * Every object here is console_ prefixed. Nothing outside that prefix is created, altered, or
--     dropped. No other Supabase project is referenced. The newsroom is not touched.
--   * Additive and idempotent only: create table if not exists, enable RLS (safe to re-run), and each
--     policy guarded by an existence check so a second run changes nothing. There is no drop.
--
-- What this adds:
--   * console_comments: the team's open discussion, one row per comment, attached to an opportunity by
--     its slug. A comment is stamped with its author's Supabase auth.uid() and carries a SNAPSHOT of the
--     author's display name taken at post time. The snapshot is deliberate: console_profiles is scoped
--     own-read-only (uid = auth.uid()) by the profile subsystem, so a client cannot read another
--     operator's profile to resolve their name at render. Snapshotting the name onto the comment keeps
--     the name "from console_profiles" (captured from the poster's own profile when they post) without
--     widening the profile RLS. parent_id gives one level of replies.
--
-- The room is OPEN by design: every authenticated operator reads every comment (this is the team's
-- shared thinking, not private notes). Writes are owned: an operator inserts only comments authored by
-- their own uid, and edits or deletes only their own. There is NO anon access at all: a signed-out
-- client can neither read nor write the discussion.

-- 1. comments: the open team discussion, owned writes ------------------------------
create table if not exists console_comments (
  id           text primary key,             -- client-minted stable id (also the Stage-4 idempotency key)
  opp          text not null,                 -- the opportunity slug the discussion is attached to
  author       text not null,                 -- the author's Supabase auth.uid()
  author_name  text,                          -- display-name snapshot from the author's console_profiles at post time
  body         text not null,                 -- the comment text (escaped at render; never injected as HTML)
  parent_id    text,                          -- one level of replies: the parent comment's id, else null
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists console_comments_opp_idx on public.console_comments (opp);

alter table console_comments enable row level security;

do $$
begin
  -- read: OPEN. Any authenticated operator reads every comment (the shared room). No anon.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_comments' and policyname='console_comments_read_all') then
    execute 'create policy console_comments_read_all on public.console_comments for select to authenticated using (true)';
  end if;

  -- insert: an operator may insert ONLY a comment authored by their own uid.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_comments' and policyname='console_comments_insert_own') then
    execute 'create policy console_comments_insert_own on public.console_comments for insert to authenticated with check (author = auth.uid())';
  end if;

  -- update: an operator may edit ONLY their own comment.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_comments' and policyname='console_comments_update_own') then
    execute 'create policy console_comments_update_own on public.console_comments for update to authenticated using (author = auth.uid()) with check (author = auth.uid())';
  end if;

  -- delete: an operator may remove ONLY their own comment.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_comments' and policyname='console_comments_delete_own') then
    execute 'create policy console_comments_delete_own on public.console_comments for delete to authenticated using (author = auth.uid())';
  end if;
end $$;
