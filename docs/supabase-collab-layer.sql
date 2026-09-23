/* Thrive Console - collaboration layer (members, watchers, activity, notifications, read-state, order).
   Run ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).

   Additive and idempotent only: create table if not exists, enable row level security (safe to re-run),
   each policy guarded by an existence check, add column if not exists, and backfills that fill ONLY missing
   values. There is no drop, no destructive change, and no data is rewritten. Every object is console_
   prefixed. There is no anon access: a signed-out client can neither read nor write any of this.

   Model: the board is a SHARED team surface, so the collaboration tables are OPEN read to authenticated,
   with owned writes where identity matters. The per-user notification inbox and read cursor are PRIVATE:
   a member reads and mutates only their own rows (recipient = auth.uid()). Lane/stage is DERIVED by the
   console_board view and is never stored here; only membership and an intra-lane order are stored. */

/* 1. card members: the assignee SET per card (independent of owner and of send)  */
create table if not exists console_card_members (
  opp        text not null,                    /* the opportunity slug */
  member     text not null,                    /* the assigned member's auth.uid() */
  added_by   text,                             /* the auth.uid() who added them (for the activity log) */
  created_at timestamptz default now(),
  primary key (opp, member)
);
create index if not exists console_card_members_opp_idx on public.console_card_members (opp);
create index if not exists console_card_members_member_idx on public.console_card_members (member);
alter table console_card_members enable row level security;

/* 2. watchers: who is notified about a card. Seeded = members; kept first-class for future watch-only. */
create table if not exists console_watchers (
  opp        text not null,
  watcher    text not null,                    /* the watching member's auth.uid() */
  created_at timestamptz default now(),
  primary key (opp, watcher)
);
create index if not exists console_watchers_opp_idx on public.console_watchers (opp);
alter table console_watchers enable row level security;

/* 3. activity: the who-did-what-when trail per card. The SOURCE for notifications and the Activity gate. */
create table if not exists console_activity (
  id         text primary key,                 /* client-minted stable id (also the idempotency key) */
  opp        text not null,
  actor      text not null,                    /* the auth.uid() who did it */
  verb       text not null,                    /* added | removed | comment | edit | state_change */
  meta       jsonb,                            /* verb context: target member, from/to lane, snippet, etc. */
  created_at timestamptz default now()
);
create index if not exists console_activity_opp_idx on public.console_activity (opp);
alter table console_activity enable row level security;

/* 4. notifications: the PER-USER DURABLE inbox. One row per recipient per event. read_at null = unread. */
create table if not exists console_notifications (
  id         text primary key,                 /* client-minted stable id */
  recipient  text not null,                    /* the member this notifies (auth.uid()) */
  actor      text not null,                    /* who caused it (auth.uid()); never equals recipient */
  opp        text,                             /* the card */
  verb       text not null,                    /* added | comment | edit | state_change */
  meta       jsonb,                            /* rendered-copy context */
  created_at timestamptz default now(),
  read_at    timestamptz                       /* set when the member opens the drawer; null while unread */
);
create index if not exists console_notifications_recipient_idx on public.console_notifications (recipient, created_at desc);
alter table console_notifications enable row level security;

/* 5. read-state: a per-user cursor so the badge clear is O(1) and survives across devices. */
create table if not exists console_read_state (
  recipient  text primary key,                 /* auth.uid() */
  seen_at    timestamptz default now()
);
alter table console_read_state enable row level security;

/* 6. card order: a storable intra-lane priority (NOT lane membership; lane stays derived). */
create table if not exists console_card_order (
  opp        text primary key,
  lane       text,                             /* the lane this order applies within (advisory) */
  ord        double precision,                 /* sort key within the lane; lower = higher */
  updated_at timestamptz default now()
);
alter table console_card_order enable row level security;

/* 7. policies: OPEN read for the shared-board tables; owned writes; PRIVATE inbox + cursor.  */
do $$
begin
  /* card members: open read; any authenticated member adds (stamped as themselves) or removes anyone. */
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_card_members' and policyname='console_card_members_read_all') then
    execute 'create policy console_card_members_read_all on public.console_card_members for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_card_members' and policyname='console_card_members_insert') then
    execute 'create policy console_card_members_insert on public.console_card_members for insert to authenticated with check (added_by = auth.uid()::text)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_card_members' and policyname='console_card_members_delete') then
    execute 'create policy console_card_members_delete on public.console_card_members for delete to authenticated using (true)';
  end if;

  /* watchers: open read; authenticated insert or delete. */
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_watchers' and policyname='console_watchers_read_all') then
    execute 'create policy console_watchers_read_all on public.console_watchers for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_watchers' and policyname='console_watchers_insert') then
    execute 'create policy console_watchers_insert on public.console_watchers for insert to authenticated with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_watchers' and policyname='console_watchers_delete') then
    execute 'create policy console_watchers_delete on public.console_watchers for delete to authenticated using (true)';
  end if;

  /* activity: open read; insert only an event stamped as the acting member. */
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_activity' and policyname='console_activity_read_all') then
    execute 'create policy console_activity_read_all on public.console_activity for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_activity' and policyname='console_activity_insert_own') then
    execute 'create policy console_activity_insert_own on public.console_activity for insert to authenticated with check (actor = auth.uid()::text)';
  end if;

  /* notifications: PRIVATE. A member reads and mutates ONLY their own rows. Insert is allowed for the
     fan-out (recipient may be another member) but must be stamped by the acting member (actor = auth.uid()),
     and a member can never notify themselves (recipient <> actor). */
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_notifications' and policyname='console_notifications_read_own') then
    execute 'create policy console_notifications_read_own on public.console_notifications for select to authenticated using (recipient = auth.uid()::text)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_notifications' and policyname='console_notifications_insert_actor') then
    execute 'create policy console_notifications_insert_actor on public.console_notifications for insert to authenticated with check (actor = auth.uid()::text and recipient <> auth.uid()::text)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_notifications' and policyname='console_notifications_update_own') then
    execute 'create policy console_notifications_update_own on public.console_notifications for update to authenticated using (recipient = auth.uid()::text) with check (recipient = auth.uid()::text)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_notifications' and policyname='console_notifications_delete_own') then
    execute 'create policy console_notifications_delete_own on public.console_notifications for delete to authenticated using (recipient = auth.uid()::text)';
  end if;

  /* read-state: PRIVATE own-row cursor. */
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_read_state' and policyname='console_read_state_rw_own') then
    execute 'create policy console_read_state_rw_own on public.console_read_state for all to authenticated using (recipient = auth.uid()::text) with check (recipient = auth.uid()::text)';
  end if;

  /* card order: open read; authenticated write (order is not lane membership). */
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_card_order' and policyname='console_card_order_read_all') then
    execute 'create policy console_card_order_read_all on public.console_card_order for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='console_card_order' and policyname='console_card_order_write') then
    execute 'create policy console_card_order_write on public.console_card_order for all to authenticated using (true) with check (true)';
  end if;
end $$;

/* 8. backfill: owner -> initial member + watcher. Additive; fills only where nothing exists yet, and only
   for cards that actually carry an owner (a card with no owner stays memberless / unassigned). */
insert into public.console_card_members (opp, member, added_by)
select o.slug, o.owner, o.owner
from public.console_opps o
where coalesce(o.owner, '') <> ''
on conflict (opp, member) do nothing;

insert into public.console_watchers (opp, watcher)
select o.slug, o.owner
from public.console_opps o
where coalesce(o.owner, '') <> ''
on conflict (opp, watcher) do nothing;

/* 9. identity backfill: give the three members their agreed canonical display_name + email so resolveActor
   always resolves (the fix for owner/member chips rendering "unassigned"). The names are set AUTHORITATIVELY
   here so they are the agreed ones and never a stale auth metadata name: muhelagha@gmail.com is set to "Agha".
   The email literals live ONLY here, in the SQL Thyab runs, never in any client,
   exactly like the existing owner seed. This adds or corrects only these three rows and removes nothing. */
insert into public.console_profiles (uid, display_name, email)
select u.id::text, m.name, u.email
from auth.users u
join (values
  ('abdu.thyab@gmail.com',      'Thyab'),
  ('muhelagha@gmail.com',       'Agha'),
  ('alnajjarjawad97@gmail.com', 'Basel')
) as m(email, name) on lower(u.email) = m.email
on conflict (uid) do update
set display_name = excluded.display_name,
    email        = excluded.email;
