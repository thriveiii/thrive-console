-- Thrive Console · Backfill console_inbound.opp by normalized subject (replies-are-linked brief)
-- Run in the SQL editor of the "thrive-console" Supabase project ONLY. Read the read-only pass first,
-- confirm the matched set, then run the UPDATE. Additive and idempotent; no row is ever deleted.
--
-- Isolation: only console_ tables are touched. Nothing outside that prefix is read or written. No user,
-- profile, or permission table is referenced: a console_inbound row is a "reply to a campaign", never a
-- person's identity or platform role, and this backfill keeps those contexts firewalled.
--
-- THE LINK (proven read-only on the server): console_inbound.opp is empty for every row; threadId does not
-- join; the sender address must not be the link. A reply attaches to the send it answers by NORMALIZED
-- SUBJECT: strip a leading Re:/Fwd:/رد:/إعادة توجيه:, lower-trim, match console_mail.subject, resolve to
-- that send's opp. The same normalization app.js subjLinkKey and docs/supabase-board-view.sql apply, so
-- the backfill, the write path, and the board view all resolve one reply to the same opportunity.
--
-- THE NOISE FILTER (the exact exclusion list): a real reply is a non-auto row whose sender is not a DMARC
-- sender (dmarc anywhere), a no-reply / notifications / mailer-daemon / postmaster / bounce local part, or
-- the google.com / github.com report and invite domains. gmail.com and a prospect's own host stay in.

-- ===========================================================================
-- STEP 1 - READ-ONLY. The real replies among the rows, each with the opp it links to. Run this first and
--          read it. The github / google / dmarc rows are absent (filtered), and each matched row shows
--          exactly one resolved opp; Basel's row resolves to مدرسة-المدار-الدولية.
-- ===========================================================================
with norm_in as (
  select
    i.id,
    i.opp                                                                 as opp_now,
    lower(coalesce(i.data->>'from',''))                                   as sender,
    lower(trim(regexp_replace(coalesce(i.data->>'subject',''),
      '^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*', '', 'i')))                as subj_key
  from public.console_inbound i
  where coalesce(i.kind, '') <> 'auto'
    and lower(coalesce(i.data->>'from','')) !~ '(dmarc|(^|[.+_-])(no-?reply|noreply|notifications?|notify|mailer-daemon|postmaster|bounces?)@)'
    and split_part(lower(coalesce(i.data->>'from','')), '@', 2) not in ('google.com', 'github.com')
),
mail_subj as (
  select
    lower(trim(regexp_replace(coalesce(subject,''),
      '^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*', '', 'i')))                as subj_key,
    opp
  from public.console_mail
  where coalesce(data->>'direction', '') <> 'in'
    and coalesce(opp, '') <> ''
    and coalesce(subject, '') <> ''
  group by 1, 2
),
matched as (
  select
    n.id, n.sender, n.subj_key, n.opp_now,
    (select case when count(distinct ms.opp) = 1 then min(ms.opp) end
       from mail_subj ms where ms.subj_key = n.subj_key)                  as opp_linked
  from norm_in n
  where n.subj_key <> ''
)
select id, sender, subj_key, opp_now, opp_linked
  from matched
 where opp_linked is not null
 order by opp_linked, id;

-- ===========================================================================
-- STEP 2 - ADDITIVE, IDEMPOTENT UPDATE. Sets opp on exactly the matched rows whose opp is still empty,
--          keyed by id, and keeps the original empty value at data.opp_before for audit. Re-running is a
--          no-op: the WHERE clause only fills a still-empty opp, so a second pass matches nothing. Noise
--          rows (no subject match, or an excluded sender) are never touched and stay unlinked.
-- ===========================================================================
with norm_in as (
  select
    i.id,
    lower(trim(regexp_replace(coalesce(i.data->>'subject',''),
      '^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*', '', 'i')))                as subj_key
  from public.console_inbound i
  where coalesce(i.kind, '') <> 'auto'
    and lower(coalesce(i.data->>'from','')) !~ '(dmarc|(^|[.+_-])(no-?reply|noreply|notifications?|notify|mailer-daemon|postmaster|bounces?)@)'
    and split_part(lower(coalesce(i.data->>'from','')), '@', 2) not in ('google.com', 'github.com')
),
mail_subj as (
  select
    lower(trim(regexp_replace(coalesce(subject,''),
      '^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*', '', 'i')))                as subj_key,
    opp
  from public.console_mail
  where coalesce(data->>'direction', '') <> 'in'
    and coalesce(opp, '') <> ''
    and coalesce(subject, '') <> ''
  group by 1, 2
),
matched as (
  select
    n.id,
    (select case when count(distinct ms.opp) = 1 then min(ms.opp) end
       from mail_subj ms where ms.subj_key = n.subj_key)                  as opp_linked
  from norm_in n
  where n.subj_key <> ''
)
update public.console_inbound i
   set opp  = m.opp_linked,
       data = jsonb_set(coalesce(i.data, '{}'::jsonb), '{opp_before}', to_jsonb(coalesce(i.opp, '')), true)
  from matched m
 where m.opp_linked is not null
   and i.id = m.id
   and coalesce(i.opp, '') = '';        -- idempotent: only fill an empty opp, keep the audit of the original

-- ===========================================================================
-- STEP 3 - READ-ONLY RE-CHECK. Every matched reply now carries its opp (opp_before records the original
--          empty); the noise still carries none. count(*) of console_board where replied is true now
--          includes the مدارس المدار الدولية card.
-- ===========================================================================
-- 3a. matched rows are now linked, with the audit trail intact:
select id, opp, data->>'opp_before' as opp_before, data->>'from' as sender
  from public.console_inbound
 where coalesce(opp,'') <> '' and data ? 'opp_before'
 order by opp, id;

-- 3b. the noise is still unlinked (a spot check: the github / google / dmarc senders carry no opp):
select id, opp, data->>'from' as sender
  from public.console_inbound
 where (lower(coalesce(data->>'from','')) like '%dmarc%'
        or split_part(lower(coalesce(data->>'from','')), '@', 2) in ('google.com','github.com'))
 order by id;

-- 3c. the board now marks the linked card Replied:
select slug, business, stage, replied
  from public.console_board
 where replied is true
 order by slug;
