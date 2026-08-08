-- Thrive Console · Supabase Stage 1 schema
-- Run this ONCE in the SQL editor of the "thrive-console" Supabase project (never any other project).
--
-- Isolation, the first rule:
--   * Every object here is prefixed console_. Nothing outside that prefix is created, altered, or
--     dropped. The pre-existing experiment tables in this project (the opp_ and jood_ ones) are left
--     exactly as they are. No other Supabase project is ever referenced.
--   * The statements are additive and idempotent only: create table if not exists, enable row level
--     security (safe to re-run), and create each policy guarded by a "does it already exist" check so a
--     second run changes nothing. There is no drop and no alter of any table you did not create here.
--
-- Shape: a page is a ROW, not a fragment of a shared JSON file. console_pages.html is a text column, so
-- a large page is one large row and the browser store and the 400 KB relay JSON cap are no longer the
-- ceiling. Capacity is bounded only by the database.
--
-- RLS choice, a judgment call raised for you (brief section 8): these tables are reached from the
-- browser with the project ANON key, which is public in a static site, exactly like the relay URL today.
-- The policies below grant the anon role read and write on the console_ tables ONLY (never on any other
-- table), so the console can run serverless. If you want a stronger model later, Stage 2+ can add a
-- shared-secret or JWT claim and tighten these policies; that is additive and does not change the shape.

-- 1. opportunities: one row each -------------------------------------------------
create table if not exists console_opps (
  slug              text primary key,
  business          text,
  stage             text,
  published         boolean default false,
  archived          boolean default false,
  outreach_subject  text,
  outreach_text     text,
  channel           jsonb,
  data              jsonb,                 -- catch-all for the remaining record fields, forward compatible
  up                bigint,                -- freshness stamp for cross-device merge (matches the console)
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- 2. pages: one row each, the HTML as a text column ------------------------------
create table if not exists console_pages (
  slug        text primary key,
  html        text,
  up          bigint,
  updated_at  timestamptz default now()
);

-- 3. message and page templates -------------------------------------------------
create table if not exists console_templates (
  id          text primary key,
  kind        text,                        -- "email" or "page"
  name        text,
  subject     text,
  html        text,
  lang        text,
  up          bigint,
  updated_at  timestamptz default now()
);

-- 4. mail ledger ----------------------------------------------------------------
create table if not exists console_mail (
  id          text primary key,            -- the message id (mid)
  opp         text,
  status      text,
  to_addr     text,
  subject     text,
  ts          timestamptz,
  data        jsonb,
  up          bigint
);

-- 5. settings and scalars -------------------------------------------------------
create table if not exists console_settings (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz default now()
);

-- Row level security: enabled on the console_ tables, with the anon role allowed on THESE tables only.
alter table console_opps      enable row level security;
alter table console_pages     enable row level security;
alter table console_templates enable row level security;
alter table console_mail      enable row level security;
alter table console_settings  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['console_opps','console_pages','console_templates','console_mail','console_settings']
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
