# B2_WEBHOOK_TRACE.md

READ-ONLY trace of the Resend delivery-truth reconciliation gap (defect B-2). No build, no source edits,
no SQL. Every claim carries a `file:line` in the LIVE relay `relay/thrive-relay.gs` and `library/app.js` on
origin/main (de7de93). **ABSENT** where a capability is missing. No fixes are proposed; this trace sizes the
additive path for a delivery/bounce webhook.

## Proven going in (from SEND_TRUTH_TRACE, not re-derived)

- No Resend webhook exists: the `doPost` op list (`relay:1058-1097`) has no delivered/bounced/complained handler.
- `sendMail_` hardcodes `delivered:true` on any 2xx (`relay:768`); `console_mail.status` is written `sent` at
  relay-accept (`app.js:7541`) and never reconciled.
- `console_mail.id` already stores the Resend id (`app.js:7538`). The view reads a bounce only from
  `console_inbound` (`kind='auto'`, `bounce` hard/soft), `docs/supabase-live-verified.sql:217-220`.

---

## 1. WEBHOOK ENTRY

**How `doPost` reads the body.** The relay parses the POST body as JSON, once, at the top of `doPost`:

```
function doPost(e) {                                              // relay:1034
  var d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}   // relay:1036
  var op = d.op || '';                                           // relay:1037
```

So the request body is JSON in `e.postData.contents`, and the operation is the `op` field of that JSON
(`relay:1037`). (Query/form params are read separately via `e.parameter`, used only by `doGet`, `relay:1011`.)

**How ops are routed.** A flat if-chain on `op`, in two tiers:

- **Unauthenticated tier, answered BEFORE `authOk_`.** A bare body with no `op` is a send (`relay:1050`); then
  `op === 'hit'` (`relay:1058`) and `op === 'page_publish'` (`relay:1071`) each return before any auth. Their
  documented justification (`relay:1063-1075`) is that the caller carries no `SYNC_KEY`, "so the /exec URL is the
  capability, exactly as for email." These are the pattern a webhook follows: a third party (Resend) has no
  console credential.
- **Authenticated tier, gated by `authOk_(d.auth)` (`relay:1076`).** Everything after it (`state_get`,
  `send`, `outbox_*`, `inbox_*`, ...) requires the console's `SYNC_KEY`. The chain ends
  `return json_({ ok:false, error:'unknown op: ' + op })` (`relay:1099`).

**Where a `resend_webhook` op would attach.** Immediately after the `page_publish` branch (`relay:1071`) and
BEFORE `authOk_(d.auth)` (`relay:1076`), because Resend cannot present the console `SYNC_KEY`. It would read the
event from the already-parsed `d` (the JSON body). It must carry its own verification (section 5), since it sits
outside `authOk_`. Insertion point, precisely: a new `if (op === 'resend_webhook') return json_(resendWebhook_(d));`
between line 1071 and line 1076.

## 2. IDENTITY MATCH

A Resend webhook event names the email by its Resend id. The console already stores exactly that id.

- **The write.** Single send: `const id = parsed ? (parsed.id||"") : ""` (`app.js:7538`), the Resend id from the
  relay's `sendMail_` return (`relay:768`), flows into `confRow.id` (`app.js:7541`) and is written as
  `console_mail.id` by `supaMailRow` (`app.js:3934`, `id: rec.mid||rec.id`). Campaign: `sr.id` becomes `m.id`
  (`app.js:1543`). So `console_mail.id` = the Resend id for any send that captured one.
- **The column.** `console_mail.id` is the table's PRIMARY KEY: `id text primary key` (`docs/supabase-stage1.sql:60`).
- **Can a webhook update the row by matching id?** Yes, by primary key. A PostgREST upsert keyed on `id`
  (`resolution=merge-duplicates`) matching the Resend id would land on the exact row.
- **Existing update-by-id helper in the relay: partial.** The relay's only Supabase writer is `supaInsert_`
  (`relay:428`, section 4), a POST upsert (merge-duplicates), not a PATCH. An upsert of `{ id, status }` would
  update the matched row's status, but if no row with that id exists yet (the send-confirm has not landed) it
  would INSERT a near-empty row (`id`+`status` only). A dedicated PATCH-by-id (update only, never insert) helper
  is **ABSENT**.
- **One caveat on the key.** `console_mail.id` is the Resend id only when the send captured one; a row that never
  got a Resend id keeps its local `mid` (a UUID) as `id`. The webhook can match only the rows that hold the
  Resend id, which are exactly the ones a delivery/bounce event concerns.

## 3. STATUS VOCABULARY

- **The column is unconstrained text.** `status text` (`docs/supabase-stage1.sql:62`) - no `check`, no enum, no
  domain. So `delivered` / `bounced` / `complained` can be written additively; nothing at the column level
  rejects a new value. (`console_mail.status` is read across the app only as `sent` and the transient states;
  `supaMailRow` emits it verbatim, `app.js:3939`.)
- **But the view's bounce stage does NOT read `console_mail.status`.** The stage ladder derives a bounce solely
  from the `bounce` CTE, which reads `console_inbound`:

  ```
  bounce as ( select opp as slug, bool_or(bounce='hard') as hard, bool_or(bounce='soft') as soft
              from public.console_inbound where kind='auto' and bounce in ('hard','soft') group by opp )
  ```
  `docs/supabase-live-verified.sql:174-181`, consumed at the stage CASE `when coalesce(b.hard,false) then 'bounced'
  ... when coalesce(b.soft,false) then 'failed'` (`docs/supabase-live-verified.sql:217-218`).
- **So writing `console_mail.status='bounced'` ALONE would NOT surface as bounced on the card.** Worse, it would
  actively drop the row from the send count: `mail_sends` counts a row only when
  `m.status is null or m.status in ('', 'sent', 'copied', 'pending')` (`docs/supabase-live-verified.sql:69`), and
  `bounced` is not in that allowlist, so `sent_count` would decrease. The card would not read `bounced`; it would
  read whatever the reduced `sent_count` derives (possibly back to draft/live if it hits 0).
- **Therefore a card-visible bounce needs ONE of two things** (section: smallest path): either the webhook writes
  a `console_inbound` bounce row (the channel the view already reads, no view change), OR the view's `bounce` CTE
  is extended to also read `console_mail.status in ('bounced','complained')` (one view change). The
  `console_mail.status` write is still worth doing for ledger truth, but it is not sufficient on its own.

## 4. EXISTING SUPABASE WRITE FROM RELAY

**The relay already writes to Supabase with a service-role key** - the webhook would reuse this exact helper.

- `supaInsert_(table, rows)` (`relay:428-446`): a single PostgREST upsert. It reads `SUPABASE_URL` and
  `SUPABASE_SERVICE_KEY` from Script Properties (`relay:429-430`), POSTs to `<url>/rest/v1/<table>` with
  `apikey`/`Authorization: Bearer <service key>` and `Prefer: resolution=merge-duplicates,return=minimal`
  (`relay:433-440`). The service_role key bypasses RLS and "lives ONLY in this relay's Script Properties ...
  NEVER emitted" (`relay:418-419`).
- **What it writes today.** Only `console_inbound` and `console_hits`, from the inbox/opens mirror
  `supaMirrorLedger_` (`relay:495-496`). **It never writes `console_mail`** - that table is written by the browser
  (`app.js` `mailUpsert`). So a `console_mail` patch is a net-new TARGET, but not a net-new MECHANISM: the writer,
  the key, and the URL already exist.
- **Reuse for the webhook.** A bounce row is `supaInsert_('console_inbound', [ { id, opp, kind:'auto', bounce, ts,
    data } ])` - the same shape and table `supaMirrorLedger_` already writes (`relay:448-456` builds a
  console_inbound row). A `console_mail.status` update is `supaInsert_('console_mail', [ { id, status } ])`
  (upsert by PK). Both go through the one existing helper. A dedicated update-by-id PATCH helper is **ABSENT** (see
  section 2).

## 5. SIGNATURE VERIFICATION

Resend signs webhooks with svix headers (`svix-id`, `svix-timestamp`, `svix-signature`) over the raw body.

- **The Apps Script obstacle, load-bearing.** An Apps Script web app's `doPost(e)` does NOT expose HTTP request
  headers. The relay only ever reads `e.postData.contents` (the raw body, `relay:1036`) and `e.parameter` (query
  params, `relay:1011`); the `headerOf_` calls in the codebase parse the headers of a MAIL MESSAGE, not the HTTP
  request (`relay:558,574`). There is no `e.headers`. **So the svix signature headers cannot be read by the relay
  as-is, and true svix verification is not possible natively in this Apps Script endpoint.**
- **Where a check would sit.** Inside the new `resendWebhook_(d)`, first thing, before any write - the same place
  `authOk_` would sit for an authenticated op, but self-contained since the op is answered before `authOk_`
  (`relay:1076`).
- **Realistic Apps Script options** (design note only, no build):
  1. **Shared-secret capability in the URL or body.** Resend can POST to `/exec?key=<secret>` (or a body field);
     the handler compares it against a Script Property `RESEND_WEBHOOK_SECRET`. This follows the relay's own
     "the /exec URL is the capability" model (`relay:1063-1075`) and is Apps-Script-native. It authenticates the
     caller but is not cryptographic svix verification.
  2. **A verifying proxy in front.** A tiny function (e.g. a Cloudflare Worker) that reads the svix headers,
     verifies the signature against the signing secret, and forwards the verified body to the relay `/exec`. This
     gives true svix verification at the cost of one net-new hop.
- **The secret placement is settled either way:** the signing secret (or the shared secret) is a relay Script
  Property, exactly like `RESEND_KEY`, `GH_TOKEN`, and `SUPABASE_SERVICE_KEY` (`relay:418-419,429-430`), never in
  code and never emitted in a response.

---

## The smallest additive path

**Files touched:**
- `relay/thrive-relay.gs` - one new op. Add `if (op === 'resend_webhook') return json_(resendWebhook_(d));`
  between `page_publish` (`relay:1071`) and `authOk_` (`relay:1076`), plus the `resendWebhook_` function. It
  (a) verifies a shared secret against a Script Property (section 5, option 1), (b) maps the Resend event
  (`email.bounced` -> hard/soft, `email.complained`, `email.delivered`) to a write, and (c) writes through the
  EXISTING `supaInsert_` (`relay:428`): a `console_inbound` bounce row (`kind='auto'`, `bounce`, `opp` = the send
  row's slug) for a bounce/complaint, keyed by the Resend event id for idempotency.
- **Zero view lines for a card-visible bounce**, IF the webhook writes the bounce into `console_inbound`: the
  view's `bounce` CTE already reads it (`docs/supabase-live-verified.sql:174-181,217-218`).
- **One view line, OPTIONAL**, only if you want `console_mail.status='bounced'` itself to drive the card: extend
  the `bounce` CTE (or `mail_sends`) to read `console_mail.status`. Recommended to ALSO upsert
  `console_mail.status` for ledger truth even when routing the card signal through `console_inbound`, mindful that
  a `bounced` status drops the row from `mail_sends` (`...live-verified.sql:69`).

So the minimum is **one relay op + zero view lines** (bounce surfaced via `console_inbound`, reusing `supaInsert_`).
The fuller, truthful version is **one relay op + one view line** (so `console_mail.status` is the source of the
bounce and the ledger reads honestly).

## ABSENT list

1. **No webhook receiver / op** anywhere (`relay:1058-1097`).
2. **No relay write to `console_mail`** - `supaInsert_` targets only `console_inbound` and `console_hits`
   (`relay:495-496`); the browser writes `console_mail`.
3. **No update-by-id (PATCH) helper** - `supaInsert_` is an upsert-only writer (`relay:428-446`); an update that
   never inserts is not available.
4. **No HTTP request-header access in Apps Script** - `doPost(e)` reads only `e.postData.contents` and
   `e.parameter`, so native svix signature verification is not possible (`relay:1036,1011`).
5. **No delivered/bounced/complained vocabulary reconciled anywhere** - `console_mail.status` is unconstrained
   text (`docs/supabase-stage1.sql:62`) but is never written a delivery value, and the view's bounce stage reads
   `console_inbound` only, not `console_mail.status` (`docs/supabase-live-verified.sql:174-181,217-220`).
