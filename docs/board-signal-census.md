# Board signal census (complete the ledger, complete the view)

Every board signal, its store of truth, its true linking key, and how it is lost. Confirmed from the
deployed code (`library/app.js`, `relay/thrive-relay.gs`, `library/lifecycle.js`); each mapping has a
read-only SQL confirmation below to run against one named production row (the code names the key; the
row confirms it).

## The one structural fact

**The relay never writes to Supabase.** `sendMail_` (thrive-relay.gs) POSTs to Resend and returns a
result; hits and replies are stored in a Drive JSON blob and pulled by the client. Every `console_*`
row is minted by the **client**, through `supaQueueUpsert`, fire-and-forget, gated on `supaOn()` and
only actually POSTed when signed in (RLS refuses an anon write). So a Postgres row can be missing
whenever the local mirror step was skipped, swallowed, or queued-but-not-flushed. This is the
dual-source problem: the external effect (Resend delivery, an inbox reply) and the `console_*` row are
two separate writes, and the second can fail silently.

## Census

| Signal | Store · table | Key column | How the key is set | Failure mode that loses it |
|---|---|---|---|---|
| Send (outreach / thread reply) | `console_mail` | `opp` (= slug) | `relaySend`→`logMail`→`supaMailRow.opp = rec.opp`; `rec.opp` is `oppOf()` / `slug` (app.js 4945, 5859, 4989). Never the address or an id. | Supabase off or signed-out → mirror skipped or queued-not-flushed; a `mailto:` "send" calls no `logMail`; an empty `intent.opp` → `opp=''` |
| Manual off-channel send | `console_opps.data.manual_contacts[]` | parent `slug` (the row) | `send_offchannel` move (lifecycle.js); `sent_on` per contact | No `console_mail` row at all  -  the view's separate `manual_sends` CTE recovers it, so it is not orphaned |
| Open ("N opens") | `console_hits` | `slug` | beacon `slug` query param → relay `hitPut_`; `supaHitRow.slug = e.slug` | wrong/empty beacon slug; a self visit or a pre-first-send hit (both excluded by the send-gate, by design) |
| Reply ("Replies N", "answered") | `console_inbound` | `opp` | relay `attributeMessage_` (parent slug via tag/thread/sender, else `''`); client `matchReply`/`rematchHeld` (parent slug); `attachReply` (manual slug); **`spawnChildrenFromReplies` re-keys a group reply to the child slug `<parent>--r-<hash>`** | a group reply re-keyed to a child slug the parent-slug join can't see; a **stranded child** whose `console_opps` row never flushed; an unmatched `opp=''` |
| Reply (hand-recorded move) | `console_opps.stage='replied'` + `data.replied_on` | `slug` | `record_reply` move (lifecycle.js)  -  writes **no** inbound or mail row | the view's `replied` must read `console_opps.stage='replied'` or a hand-recorded reply is invisible |
| Page prepared | `console_pages` | `slug` | opp upsert `if(d.html)` | opp/page upsert not flushed → view falls back to `published` alone |
| Email prepared | `console_opps` | `slug` (`outreach_text` / `outreach_subject`) | opp upsert promoted columns | both fields empty → `has_email=false` |

**True keys, summarized:** a send is `console_mail.opp = console_opps.slug`; an open is
`console_hits.slug = console_opps.slug`; a reply is `console_inbound.opp` = a parent slug, a child slug
`<parent>--r-<hash>`, or `''`. Cozy Calico's "delivered but zero mail rows on the slug" is the send
failure mode, not a different key: the local mail row (keyed by slug) never reached Postgres. Basel's
"Replies 10 but replied=0" is the reply key: his reply is keyed to a child slug (or the manual
`stage='replied'` move) that the plain `opp = console_opps.slug` join did not read.

## What this PR changes in the view (Part 3)

`docs/supabase-board-view.sql` `replied` now honors all three real reply paths: an inbound row keyed
by `opp`; a ledger `direction='in'`/`status='replied'`; and `console_opps.stage='replied'` (the manual
move). A child-slug reply keeps its own card when that child exists in `console_opps`, and resolves back
to the parent (`split_part(opp,'--r-',1)`) only when the child is stranded  -  so a real reply is never
dropped and a child that has its own card is not double-counted onto the parent. Verified against real
Postgres in `tools/board_view_sql_test.py` (cases `basel`, `grp`/`grp--r-kid`, `manualrep`).

## What this PR changes in the client (Part 4)

The two structural leaks the SQL cannot patch are (a) sends/replies that never reach Postgres because
the client mirror is best-effort and signed-in-only, and (b) the fact that the board reads the server
view, so such a gap reads as Ready/Draft silently. The client now:

- records a mail or inbound mirror failure on the diverge ledger instead of swallowing it
  (`logMail`, `setInbound`): no silent catch on a write with an external effect;
- runs a post-sync self-check, `boardDrift()`, that counts the visible cards whose **local** ledger holds
  a delivered send or a reply the **server view** has not caught up to, and shows a small warning pill
  (`board_drift`) next to the sync pill. Drift becomes a number Thyab sees the day it happens.

The client is deliberately NOT changed to block the "Sent" state on a Supabase confirm: a send goes out
through the relay while signed out, and blocking Sent on a signed-in Postgres write would break offline
sending. The truthful alternative is the visible drift badge plus the un-swallowed diverge.

## Part 5 · Naming: `live` is the Ready lane

The view emits stage `'live'`, which is the board's **Ready** lane. This is one vocabulary, not two:
`'live'` is the lane KEY (`stage-model.js` `LANES = [..., 'live', ...]`), and "Ready" is only its
display label in i18n (`stage_live` / the column heading). There is exactly one mapping site (the i18n
label), and the client buckets by the key `'live'`; renaming the view stage to `'ready'` would instead
require a new client mapping. So the view keeps `'live'` and the label stays "Ready".

## Read-only confirmation (run one per named row)

```sql
-- SEND key: cozy-calico has Resend deliveries; does any console_mail row carry its slug?
select id, opp, status, ts from public.console_mail where opp = 'cozy-calico-books';

-- REPLY key: how is Basel's reply keyed? (parent slug, a child slug, or empty)
select id, opp, kind, ts from public.console_inbound
 where opp = 'basel' or opp like 'basel--r-%' or opp = '' order by ts desc;

-- Manual reply move: did a record_reply stamp the opp itself?
select slug, stage, data->>'replied_on' as replied_on from public.console_opps where stage = 'replied';

-- OPEN key: are Rise Dance's hits real, and after a send?
select h.slug, count(*) from public.console_hits h where h.slug = 'rise-dance-center-of-virginia' group by 1;
```

The read-only reconciliation queries and the additive backfill/normalization template are in
`docs/supabase-ledger-reconcile.sql`.
