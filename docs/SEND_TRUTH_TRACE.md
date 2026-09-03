# SEND_TRUTH_TRACE.md

READ-ONLY trace of the send-truth and delivery-truth defect (B). No build, no source edits, no SQL.
Every claim carries a `file:line` in the LIVE SERVED path: `library/app.js` on origin/main (de7de93) and
the Apps Script relay `relay/thrive-relay.gs`. Where a capability is missing it says **ABSENT** plainly.
No fixes are proposed; this trace precedes the B fix brief.

## The two proven divergences this explains

- **uncle-cs** (`info@uncleccw.com`): Resend = Delivered; `console_mail.status` = `sent`; UI banner said
  "Sent 0 of 1. 1 failed: info@uncleccw.com".
- **underdog** (`underdogcoffeeandbread.shop@gmail.com`): Resend = Bounced; `console_mail.status` = `sent`;
  UI showed success and moved the card.

Both follow from one shape: the UI/ledger verdict is written at the moment the RELAY accepts the request,
and there is no path that reconciles it to Resend's actual Delivered/Bounced outcome.

---

## B1. THE SEND CALL

There are two hops, and the browser owns the first.

- **Browser to relay.** The one send function is `relaySend` (`app.js:7500`). It POSTs the compiled message
  to the relay endpoint over HTTP from the browser: `fetchT(ep, { method:"POST", ... body:JSON.stringify(payload) })`
  (`app.js:7529`). The payload names `op` implicitly through the endpoint; the relay routes `op === 'send'`.
- **Relay to Resend.** Only the relay talks to Resend. `sendMail_` (`relay/thrive-relay.gs:712`) builds the
  Resend payload and calls `UrlFetchApp.fetch('https://api.resend.com/emails', ...)` (`relay:757`). The browser
  never calls Resend directly.
- **Interactive single send** (the composer Send button) enters through the `eSend` handler, which calls
  `relaySend(...)` for exactly ONE recipient (`app.js:8925`) - `to`, `recName()`. It does not loop.
- **Campaign (multi-recipient) send.** `startCampaignQueue` (`app.js:1484`) compiles ONE row per recipient
  (`sched.rows.forEach`, `app.js:1494-1504`), logs each locally as `status:"queued"` (`app.js:1497`), and hands
  the whole batch to the relay outbox via `pushOutbox(batch)` (`app.js:1507`, `op:"outbox_push"` at `app.js:3108`).
  The relay then drains the queue in `sendQueue_` (`relay:893`), sending each row with its own `sendMail_` call
  (`relay:919`). So the per-recipient loop that actually hits Resend is the relay's `sendQueue_`, not the browser.

## B2. THE "Sent N of M, failed X" BANNER

The "N of M sent / Failed X" surface is the campaign control panel `campaignControlHtml` (`app.js:2128`):
`p.sent / p.n` (`app.js:2135`) and `Failed p.failed` (`app.js:2138`), reading `campaignProgress` (`app.js:1552`),
which counts the LOCAL mail rows by status (`sent`/`queued`/`held`/`failed`, `app.js:1555-1561`). The per-recipient
row that names the address with a state chip is `recipientsPanelHtml` (`app.js:2148-2158`), whose chip comes from
`recipientState(slug, addr)` (`app.js:2151`) - again the local mail row's status.

**What decides `failed` per recipient.** For a campaign row, the status is set by `reconcileOutbox` (`app.js:1537`)
from the relay's reported per-row status: `sr.status==="failed"` maps the local row to `failed` (`app.js:1544`),
`sr.status==="sent"` maps it to `sent` (`app.js:1543`). The relay decides `sent` vs `failed` in `sendQueue_`:

```
try {
  var res = sendMail_({ ... idempotencyKey: row.mid });   // relay/thrive-relay.gs:919
  flipOutbox_(row.mid, { status:'sent', id:res.id, sent_at, error:'' });   // relay:922
} catch (err) {
  flipOutbox_(row.mid, { status:'failed', error:String(err.message) });    // relay:925
  failed++;
}
```

`sendMail_` throws on any non-2xx (`relay:767`) AND, critically, `UrlFetchApp.fetch` throws on a network timeout
or transient error. **The relay cannot tell "Resend rejected the request" from "my fetch to Resend timed out
after Resend already accepted and delivered" - both land in the same `catch` and both stamp `failed` (`relay:925`).**

**For uncle-cs specifically:** Resend Delivered, but the banner said failed. The mechanism that produces a
`failed` verdict on a delivered message is exactly `relay:924-925` - `sendMail_` threw (a timeout on the
`UrlFetchApp.fetch` to Resend, or a transient 5xx, or a duplicate-key edge on a retried `row.mid`) AFTER Resend
had already accepted and delivered the email, so the relay marked the row `failed` while Resend's own record says
Delivered. **What is missing to name the exact trigger** for uncle-cs (timeout vs 5xx vs retry) is a runtime fact,
not in the source: the error string the relay stored on that row (`flipOutbox_ ... error:`, `relay:925`) and the
Resend dashboard's delivery timeline. The source proves the CLASS of bug (a thrown fetch masks a real delivery);
only the stored error string names the instance.

Note the `console_mail.status = sent` half of the divergence: that value is written by a DIFFERENT signal (B3,
the relay-accept confirm), so the durable ledger and the campaign banner can disagree - the ledger row can read
`sent` (an accept confirmed on one attempt) while the recipient chip reads `failed` (a later attempt threw).

## B3. WHAT MARKS status='sent'

`console_mail.status` is written `sent` at RELAY-ACCEPT time, never from Resend's delivery result.

- **Single send.** After the relay answers ok (`r.ok`, `parsed.ok!==false`), `relaySend` builds
  `confRow = { ..., status:"sent", id }` (`app.js:7541`) and calls `supaConfirmMail(confRow)` (`app.js:7542`).
  `supaConfirmMail` (`app.js:4005`) writes the row through `mailUpsert([row])` (`app.js:4019`), where
  `row = supaMailRow(rec)` carries `status: rec.status` = `"sent"` (`app.js:3934-3940`). Its own comment says the
  server row is minted "the moment Resend accepts" (`app.js:4010`). The local row is set `sent` at `app.js:7549`.
- **Campaign.** `reconcileOutbox` sets `m.status="sent"` when the relay says `sent` (`app.js:1543`), i.e. when
  the relay's `sendMail_` returned 2xx - acceptance, not delivery - then mirrors it with `supaMirrorMail`
  (`app.js:1548`).

**The flat status has no delivery vocabulary.** `supaMailRow` emits `status` only (`app.js:3939`); the status
values in the whole path are `pending / sending / sent / unsent / queued / held / failed` (client) - there is no
`delivered`, `bounced`, or `complained` value, and nothing reconciles `console_mail.status` against Resend.
**ABSENT.**

## B4. RESEND RESPONSE IN HAND

At the send, Resend returns a JSON with an `id`. The relay's `sendMail_` returns
`{ ok:true, id: j.id, messageId, replyTo, delivered:true }` (`relay:768`). Two things to note:

- **`delivered:true` is hardcoded on any 2xx** (`relay:768`). It means "Resend accepted the request," not that
  Resend delivered the mail. The word "delivered" here is a name, not a fact from Resend.
- **The Resend id IS stored** on `console_mail`. Single send: `const id = parsed ? (parsed.id||"") : ""`
  (`app.js:7538`) flows into `confRow.id` (`app.js:7541`) and becomes `console_mail.id` via
  `supaMailRow` (`app.js:3934`, `id: rec.mid||rec.id`). Campaign: `sr.id` becomes `m.id` (`app.js:1543`). (This is
  the `resend_id` seen on older rows.)
- **The send path does NOT distinguish "accepted" from "delivered."** The 2xx-with-id is treated as the terminal
  success: local status `sent` (`app.js:7549`), server status `sent` (`app.js:4019`), card advances. There is no
  second, later signal consulted. So an immediate 2xx-with-id is conflated with delivery.

## B5. WEBHOOK / DELIVERY RECONCILIATION

**ABSENT.** There is no Resend webhook receiver anywhere in the live path.

- The relay's HTTP router `doPost` handles exactly these ops (`relay:1058-1097`): `hit`, `page_publish`,
  `state_get`, `state_put`, `hits_get`, `send`, `store_stats`, `send_stats`, `store_migrate`, `inbound_get`,
  `inbox_scan`, `inbox_repair`, `inbox_reconcile`, `outbox_push`, `outbox_status`, `outbox_control`, `outbox_run`.
  **There is no `resend-webhook`, no `webhook`, no `email.delivered` / `email.bounced` / `email.complained`
  handler** (grep across `relay/thrive-relay.gs`: zero matches for any of these event names).
- No code anywhere writes `console_mail.status = 'delivered' | 'bounced' | 'complained'`.

This is the load-bearing gap: **the console can never learn from Resend that a message bounced.** The only bounce
signal is an inbound DSN email (B6), which is a different and lossy channel.

## B6. BOUNCE BLINDNESS

From B3 + B5: nothing in the live path can flip a bounced send off `sent` on the strength of Resend's own bounce
event. `console_mail.status` is written `sent` at accept (B3) and never revisited from Resend (B5).

There IS one indirect bounce channel, and it does NOT come from Resend directly:

- **Who writes bounce rows.** The relay's inbox scanner, `attributeMessage_` (`relay:516`), classifies an
  incoming email as machinery and detects a bounce by REGEX ON THE DSN BODY: `kind='auto'` when the sender is
  `mailer-daemon@` / `postmaster@` or `Auto-Submitted` (`relay:555-559`), then `bounce='hard'` on `5.x.x / no
  such user / user unknown` (`relay:562`) or `bounce='soft'` on `4.x.x / mailbox full / over quota` (`relay:563`).
  These become `console_inbound` rows (`kind='auto'`, `bounce` hard/soft), which the view's `bounce` CTE reads
  (`docs/supabase-live-verified.sql:174-181`).
- **The view CAN flip a card to bounced** - but only if such a row exists. The stage ladder checks
  `when coalesce(b.hard,false) then 'bounced'` / `when coalesce(b.soft,false) then 'failed'`
  (`docs/supabase-live-verified.sql:217-218`), after the `sent_count=0` branch and before `opened`. So a send WITH
  a linked hard-bounce row would read `bounced`.
- **Why underdog still shows sent.** For the view to see a bounce, a DSN email must (1) actually arrive in the
  scanned Gmail inbox, (2) be picked up by `scanInbox`, (3) parse as `kind='auto'` with a hard/soft body match,
  and (4) link to the opp by slug tag / sender / subject. Resend's Bounced event does not generate that DSN into
  our scanned inbox by itself, so for underdog no `console_inbound` bounce row was written, the `bounce` CTE was
  empty for that slug, and the stage fell through to `sent` (`docs/supabase-live-verified.sql:220`). The card
  showed success and moved. **The gap: there is no Resend-to-console bounce path; the console depends entirely on
  a DSN round-trip through Gmail scan, which did not fire here.**

## B7. THE MULTI-RECIPIENT VERDICT

underdog had two recipients (one delivered, one bounced). The single card outcome is computed two ways, and both
mask the bounce today:

- **The card stage** is the server-derived `console_board.stage` for the slug. `sent_count` counts every
  `console_mail` send row of the current cycle (`docs/supabase-live-verified.sql:60-73`); both recipients wrote
  `status='sent'` rows (B3), so both count. A bounce would override to `bounced` ONLY if a linked
  `console_inbound` hard-bounce row existed for the slug (`...live-verified.sql:217`) - which, per B6, it did not.
  So one delivered send plus one (unrecorded) bounce reads as `sent`.
- **The per-recipient panel** (`recipientsPanelHtml`, `app.js:2148`; chip via `recipientState`, `app.js:2151`)
  reads each recipient's local mail row status. With no bounce known, the bounced recipient's row is still `sent`,
  so its chip reads sent too. The bounce is invisible per-recipient as well.
- **Aggregation.** `campaignProgress` (`app.js:1552-1566`) counts `sent` (includes `sending`) vs `failed` from the
  local rows; a partial bounce is not among its inputs (bounce is neither `failed` nor a status it reads). So a
  partial failure is not surfaced. One success does not have to "mask" one bounce actively - the bounce simply
  never enters the ledger, so there is nothing to aggregate against.

---

## ABSENT list (reconciliation capabilities that do not exist today)

1. **A Resend webhook receiver.** No `email.delivered` / `email.bounced` / `email.complained` handler, no webhook
   op in `doPost` (`relay:1058-1097`).
2. **A delivered/bounced/complained status vocabulary** on `console_mail`. The status is a flat
   `pending/sending/sent/unsent/queued/held/failed`; `supaMailRow` writes `status` only (`app.js:3939`).
3. **Any reconciliation of `console_mail.status` against Resend's actual result.** It is written at accept
   (`app.js:7541-7549`, `app.js:1543`) and never revisited.
4. **A relay ability to distinguish "Resend rejected" from "my fetch to Resend timed out."** Both throw into one
   `catch` and both stamp `failed` (`relay:924-925`).
5. **A direct Resend-to-console bounce path.** Bounces are seen only if a DSN email is scanned, parsed, and linked
   (`relay:555-564`); Resend's own bounce event is not consumed.
6. **A partial-failure surface for a multi-recipient card.** The card stage and the recipient chips both read
   `sent` when a bounce is unrecorded (`app.js:2135-2158`, `...live-verified.sql:217-220`).

## Why uncle-cs said failed when it delivered

The relay's `sendMail_` call to Resend threw after Resend had already accepted and delivered the message (a
`UrlFetchApp.fetch` timeout or transient error), and the relay stamps `failed` on any throw without distinguishing
a real rejection from a post-delivery fetch failure (`relay:924-925`), which `reconcileOutbox` then rendered as
the recipient's "failed" verdict (`app.js:1544`).

## Why underdog said success when it bounced

`console_mail.status` was written `sent` the moment the relay accepted the request (`app.js:7541-7549`) and there
is no Resend webhook or any other path that ever reconciles it to Resend's Bounced result (`relay:1058-1097`,
ABSENT), and no bounce DSN was scanned into `console_inbound` for that slug, so the view had nothing to override
`sent` with and the card advanced (`docs/supabase-live-verified.sql:217-220`).
