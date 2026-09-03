# MULTI_RECIPIENT_TRACE.md

READ-ONLY trace of per-recipient status on a multi-recipient opportunity (defect B-3). No build, no source
edits, no SQL. Every claim carries a `file:line` in the live served path (`library/app.js` on origin/main,
snapshot `1292723`), the relay `relay/thrive-relay.gs`, and the view `docs/supabase-live-verified.sql`.
**ABSENT** where a capability is missing. No fixes are proposed.

## The proven case (not re-derived)

underdog was sent to TWO recipients: `underdogcoffeeandbread.shop@gmail.com` (bounced) and
`jungheeoh801@gmail.com` (delivered). `console_mail` holds one row per (opp, to_addr) send.
`console_inbound` now receives `kind='auto'` bounce rows per email id via the `resend_webhook`. The card
carries ONE stage, and a single hard-bounce row flips the whole card to `bounced`, hiding the delivered
recipient.

---

## 1. STORAGE: per-recipient facts and their linkage

**One `console_mail` row per recipient, with the address.** The send writer emits a row per recipient
carrying `to_addr`:

```
return { id:rec.mid||rec.id||"", opp:rec.opp||"", status:rec.status||"", to_addr:rec.to||"",
  subject:..., ts:..., actor:..., cycle:_cycle, data:rec, up:... };
```
`library/app.js:3944`. The column is real: `console_mail (id text primary key, opp, status, to_addr, ...)`
(`docs/supabase-stage1.sql:60-62`), and `id` is the Resend email id (`app.js:3944`, `id: rec.mid||rec.id`).
So the per-recipient send facts already exist, keyed by (opp, to_addr), each with its own Resend id.

**Is a bounce linkable back to the specific recipient?** In principle YES, through the Resend email id;
in the stored row, NOT as a usable key.

- The Resend `email.bounced` event carries the `email_id`. The webhook reads it: `var emailId =
  String((data && (data.email_id || data.id)) || '')` (`relay/thrive-relay.gs:506`), and that email id
  equals the ONE recipient's `console_mail.id`. So the bounce identifies exactly one recipient's send row.
- The webhook even USES that linkage to resolve the opp: `supaSelectOppByMailId_(emailId)` reads
  `console_mail?id=eq.<emailId>&select=opp` (`relay:479` handler, the read helper). It selects **only
  `opp`** - not `to_addr`.
- The row it writes has **no `to_addr`**: `{ id:'rb_'+emailId+'_'+type, opp, kind:'auto', bounce, ts,
  data:{source,type,event:d}, up }` (`relay:511-518`). And `console_inbound` has **no `to_addr` column** at
  all: `console_inbound (id, opp, kind, bounce, ts, data, up)` (`docs/supabase-mail-migrate.sql:12-20`).
- The recipient address is therefore recoverable ONLY by digging into the raw event
  (`data.event.data.to`, `data.event.data.email_id`), or by re-reading `console_mail` by the `email_id`
  embedded in the row id string `rb_<email_id>_<type>`. **Neither the view nor any client path does this.**

So: the send facts are per-recipient and the bounce is attributable per-recipient via the email id, but the
bounce row does not carry `to_addr` (nor an `email_id` column), so nothing can JOIN a bounce to its
recipient today.

## 2. VIEW AGGREGATION: how ONE stage is computed

The stage is a single per-opp `CASE`, and the bounce input is opp-level.

- **`mail_sends`** counts sends per opp: `count(*) ... group by m.opp` (`docs/supabase-live-verified.sql:60-73`).
  It has no per-recipient dimension; `sent_count` is one scalar per opp (`...live-verified.sql:200`).
- **`bounce`** collapses ALL bounce rows of an opp into two booleans:
  ```
  bounce as ( select opp as slug, bool_or(bounce='hard') as hard, bool_or(bounce='soft') as soft
              from public.console_inbound where kind='auto' and bounce in ('hard','soft') group by opp )
  ```
  `docs/supabase-live-verified.sql:174-181`. `bool_or` over `group by opp` means a SINGLE hard-bounce row
  sets `b.hard = true` for the WHOLE opp.
- **The stage ladder** (`...live-verified.sql:205-221`), in precedence order:
  1. a declared terminal/override stage stands (line 209-210);
  2. `replied` if any reply exists (line 211);
  3. `sent_count = 0` -> `live`/`draft` by approval (line 212-216);
  4. **`when coalesce(b.hard,false) then 'bounced'`** (line 217); `b.soft -> 'failed'` (line 218);
  5. `open_count > 0` -> `opened` (line 219); else `sent` (line 220).

**Does a single bounce flip the whole opp?** Yes. Once there is at least one send (`sent_count > 0`) and no
reply, line 217 fires on `b.hard` and the entire card reads `bounced`, regardless of how many other
recipients delivered. The only things that outrank it are a declared terminal stage or a reply (lines
209-211). Delivery of the other recipient contributes nothing that can override the bounce, because the view
has no "delivered" input at all (only bounces are recorded; `email.delivered` is not consumed - the webhook
handles only `email.bounced`/`email.complained`, `relay:489`).

## 3. PER-RECIPIENT SURFACE

A per-recipient surface EXISTS in the client, but it cannot see a webhook bounce.

- **`recipientState(slug, addr)`** (`library/app.js:1126-1141`) computes a per-recipient chip:
  `sent` / `replied` / `bounced`. Its bounce test matches the address inside the bounce TEXT:
  ```
  inboundFor(slug).forEach(function(r){ if(r && r.kind==="auto" && r.bounce &&
    String((r.snippet||"")+" "+(r.subject||"")).toLowerCase().indexOf(a)>=0) bounced=true; });
  ```
  `library/app.js:1136`. It is rendered per recipient by `recipientsPanelHtml` (`app.js:2148`) and summed by
  `campaignStats` (`app.js:1145`) and `campaignAggHtml` (`app.js:2079`).
- **But a webhook bounce is invisible to this path.** The client hydrates inbound as the `data` jsonb ONLY:
  `__supa.inbound = (inbound||[]).map(function(r){ return r.data||{}; })` (`library/app.js:4543`) - the
  top-level `opp`/`kind`/`bounce` columns are dropped. The webhook stored `data:{source,type,event}`
  (`relay:516`), so the client's local record for a webhook bounce is `{source,type,event}` - it has no
  `r.kind`, no `r.bounce`, no `r.opp`, no `r.snippet`. Therefore `resolvedReplyOpp(r)` returns `""` (it reads
  `r.opp`, then `r.kind`, then `r.subject`, all absent, `resolvedReplyOpp` at `app.js:919`), so
  `inboundFor(slug)` (`app.js:2728`, `filter(r => resolvedReplyOpp(r)===slug)`) EXCLUDES it, and
  `recipientState` never even reaches its `r.kind==="auto"` test.
- By contrast a DSN-scanned bounce IS visible, because the scanner writes the whole record into `data`
  (`supaInboundRow_`, `relay:453-456`, `data: r` with `snippet`/`subject`/`from`/`kind`/`bounce`). So the
  per-recipient chip works for scanned bounces and not for webhook bounces.

Net: the modal has a per-recipient chip row, but for a webhook bounce **no recipient is shown as bounced**
(the row is client-invisible), even as the whole card reads `bounced` from the server view. The board card
itself renders only the one server stage; it has no per-recipient breakdown (ABSENT on the card).

## 4. THE HONEST MODEL GAP

- **The card holds one scalar stage.** `console_board.stage` is a single value per opp
  (`...live-verified.sql:205-221`), and the board buckets the card by it.
- **Counts are per-opp scalars, not per-recipient.** `sent_count` and `open_count` are `count(*) ... group
  by opp` (`...live-verified.sql:60-73, 101-116, 200-201`). There is no per-recipient row in the view.
- **So the card cannot express "2 sent, 1 delivered, 1 bounced."** It can say `sent_count = 2` and it can say
  `stage = bounced`, but it cannot say WHICH recipient bounced or that one delivered - and it has no
  "delivered" quantity at all, only "sent" (accept-time) and "bounced" (`email.delivered` is not consumed,
  `relay:489`). The client's `recipientState` is the only place a per-recipient breakdown is even shaped, and
  (section 3) it cannot see webhook bounces.

## 5. SMALLEST TRUTHFUL PATH (described, not built)

The one enabler under all options: **materialize the recipient link on the bounce row.** The webhook already
reads `console_mail` by the Resend `email_id` (`supaSelectOppByMailId_`, `relay:506`), so it can select
`to_addr` in the SAME read and write it onto the row - no new table read, no new join key invented. Absent
that, both view- and client-side attribution are blocked.

- **(a) Per-recipient status derived in the view** (`console_mail LEFT JOIN console_inbound` per recipient,
  surfaced in the modal). Changes: `docs/supabase-live-verified.sql` (a new per-recipient CTE, e.g. join a
  bounce to `console_mail.to_addr`). **Gated:** the join needs a key. `console_inbound` has no `to_addr`
  column (`docs/supabase-mail-migrate.sql:12-20`) and the webhook writes none (`relay:511-518`); joining on
  the Resend id needs the bounce to carry `email_id` as a column too. So this option requires the webhook
  first to write `to_addr` (or `email_id`) - a schema-free change if stored in `data`, but a view that
  joins on it wants a real column, so realistically also a `console_inbound` column add (SQL). Files:
  `relay/thrive-relay.gs` (write `to_addr`), `docs/supabase-live-verified.sql` (the CTE), possibly
  `docs/supabase-mail-migrate.sql` (add the column).
- **(b) A card-level summary "N sent, X delivered, Y bounced" without changing the stage.** `sent_count`
  exists (`...live-verified.sql:200`); a bounced count is `count` of `console_inbound` auto-bounce rows per
  opp (already grouped in the `bounce` CTE, extendable to a count). **But "delivered" is not a stored fact** -
  only sends and bounces are recorded, so "delivered" can only be inferred as `sent - bounced`, which is an
  estimate, not truth, and mislabels a still-in-flight or complained send. This option needs NO `to_addr`
  (it is pure opp-level counting), so it is the cheapest, but it cannot name WHICH recipient bounced and its
  "delivered" is an inference. Files: `library/app.js` (a summary render on the card/modal) reading the
  counts; optionally `docs/supabase-live-verified.sql` to expose a `bounced_count`.
- **(c) Both** - the summary for the card glance (b) plus the per-recipient breakdown in the modal (a). The
  per-recipient half is still gated by materializing `to_addr` on the bounce row, and the client also needs
  the webhook to put `kind`/`bounce`/`opp`/`to_addr` into `data` (not only the top-level columns), because
  the client reads `r.data` only (`app.js:4543`) - otherwise `recipientState` stays blind to webhook bounces
  regardless of any view change.

---

## The load-bearing sentence on attribution

The current bounce row CAN be attributed to the exact recipient in principle, because it carries the Resend
`email_id` which equals that one recipient's `console_mail.id` (`relay:506`, `app.js:3944`), but that link is
never materialized as `to_addr` on the `console_inbound` row (the table has no `to_addr` column and the
webhook writes only `opp`, `relay:511-518`, `docs/supabase-mail-migrate.sql:12-20`), so no live view or
client path can today say which recipient bounced - the attribution is available but unmaterialized, and
materializing `to_addr` on the bounce row gates every per-recipient option.

## ABSENT list

1. **No `to_addr` on the bounce row** - `console_inbound` has no such column (`mail-migrate.sql:12-20`) and
   the webhook writes only `opp` (`relay:511-518`), though the recipient is recoverable from the raw event or
   the embedded `email_id`.
2. **No per-recipient dimension in the view** - `stage`, `sent_count`, `open_count` are per-opp scalars
   (`live-verified.sql:60-73, 200-221`); a bounce is `bool_or` over the whole opp (`174-181`).
3. **No client visibility of a webhook bounce** - the client reads inbound as `r.data` only (`app.js:4543`),
   and the webhook's `data` lacks `kind`/`bounce`/`opp`/`to_addr`, so `recipientState` cannot see it
   (`app.js:1126-1141`, `2728`).
4. **No "delivered" fact anywhere** - only sends (accept-time) and bounces are stored; `email.delivered` is
   not consumed (`relay:489`), so a delivered recipient is only an inference (sent minus bounced).
5. **No card-level per-recipient breakdown rendered** - `recipientState` shapes one, but nothing on the board
   card shows it, and it is blind to webhook bounces (sections 3-4).
