# A_TRACE.md

READ-ONLY trace of Defect A: the false "Sent 0 of 1. 1 failed: <addr>" banner and card revert in the
board shell. No build, no source edits, no SQL, no live send. Every claim is cited to
`tools/board-send.src.js` (and its shared `library/board.html` scope) on origin/main (`62137df`), or the
live relay. **ABSENT** where a fact lives only in the deployed relay (Code.gs), not in the repo. No fix is
applied; the smallest truthful path is at the end.

## Context (proven this session, not re-derived)

The card-revert root was a cycle mismatch in `console_board` (a null send-cycle against a non-null opp
cycle). The view now counts null-cycle records as current, so a recorded send sticks in Sent/Opened. The
remaining artifact is the "Sent 0 of 1. 1 failed: <addr>" banner that still appeared on SOME attempts even
though those opps hold a `console_mail status='sent'` row (the email left and was recorded).

---

## 1. FAILURE BRANCHES

`sendOne` (`tools/board-send.src.js:323-347`) POSTs one recipient and resolves `{ok:true}` or `{ok:false}`.
There are exactly THREE `{ok:false}` returns, all at or before the relay-acceptance boundary:

- **`tools/board-send.src.js:332`** - `if(!r.res.ok) return { ok:false, addr:art.to };`
  Cause: the relay HTTP response is **not 2xx**.
- **`tools/board-send.src.js:334`** - `if(d && d.ok===false) return { ok:false, addr:art.to };`
  Cause: the relay body is 2xx but says **`ok:false`** (a Resend reject or a relay-side error).
- **`tools/board-send.src.js:343`** - the promise-rejection handler:
  `}, function(){ return { ok:false, addr:art.to }; });`
  Cause: `relayPost` (`authFetchOnce`) **rejected** - a **timeout** (tagged `err.kind="timeout"`,
  `library/board.html:480`), an aborted body read, or a network error. The handler inspects nothing; every
  rejection becomes `{ok:false}`.

A fourth outcome is NOT a failure: a post-acceptance **confirm-write** failure returns **`{ok:true,
confirming:true}`** (`tools/board-send.src.js:341-342`), so a failed `console_mail` write does not fail or revert
the card (the email already left).

**All three `{ok:false}` reach the banner + revert.** In `runSend`, the result is bucketed
`res.ok ? sent.push : failed.push` (`tools/board-send.src.js:378-379`). For a one-recipient opp a `{ok:false}`
leaves `sent.length === 0`, and:
```
if(sent.length === 0 && snap){ replaceRow(slug, snap); try{ renderBoard(__data); }catch(x){} }
```
`tools/board-send.src.js:387` - the card is reverted to the pre-send snapshot (`snap`, captured at
`tools/board-send.src.js:372`), and `sendResultView(0, 1, failed, capped)` (`:388`) produces the red
"Sent 0 of 1. 1 failed" string. Confirmed: every `{ok:false}` from `sendOne` yields the banner and the revert
through the `sent.length === 0` path at line 387.

## 2. NO DEDUPE

`sendOne` has **no prior-idem / duplicate guard**. It computes the idempotency key
(`var idem = sendIdem(slug, art.to, art.subject, art.html)`, `tools/board-send.src.js:325`), puts it on the
payload (`idempotencyKey:idem`, `:328-329`), and POSTs **unconditionally** (`relayPost(payload)`, `:331`).
There is no lookup of an existing `console_mail` row, no `status==="sent"` short-circuit, nothing between the
key and the POST (the only `merge-duplicates` in the file is the server-side upsert Prefer on the confirm
write, `tools/board-send.src.js:292-294` - a row dedup, not a send guard). So a **re-tap re-POSTs the same
`idempotencyKey`** and maps the relay's response straight to `{ok}`/`{ok:false}`.

**Contrast, `app.js relaySend`** (the app-shell path). It DOES guard:
```
const prior=findMailRowByIdem(idem);
// A completed send never sends again: refused by name...
if(prior && prior.status==="sent" && getMailLog().some(m=> m && m.idem===idem && m.status==="sent"))
  return { status:"duplicate", idem:idem, msgid:prior.msgid||msgid, id:prior.id||"" };
```
`library/app.js:7512-7516` (with `findMailRowByIdem` at `library/app.js:6753`, `relaySend` at
`library/app.js:7500`). A completed prior send returns `status:"duplicate"` and **does not re-POST, does not
fail, and does not revert**. The board shell has no equivalent, so the same second tap that the app shell
absorbs as a no-op, the board shell sends again and then judges by the relay's reply.

## 3. RELAY DUPLICATE RESPONSE

What the relay returns for a **repeated** `idempotencyKey` determines whether a re-tap becomes `{ok:false}`
(section 1) or `{ok:true}`. This is decided in the deployed relay, and the deployed relay is **Code.gs**, not
guaranteed to match `relay/thrive-relay.gs` - so it is **ABSENT** from the repo and needs one live capture.

- Repo-side expectation (for reference only): the repo relay forwards the key to Resend -
  `if (d.idempotencyKey) headers['Idempotency-Key'] = String(d.idempotencyKey)`
  (`relay/thrive-relay.gs:841`, comment `:837`), and Resend dedupes a repeat and returns 2xx with the
  original id. If the deployed relay behaves the same, a re-tap returns **`ok:true`** and would NOT fail. The
  false-failure-on-re-tap theory therefore REQUIRES the deployed relay to answer a repeat with a **non-2xx**
  or **`ok:false`** instead.
- **Needed live capture:** open DevTools -> Network, and deliberately send an ALREADY-sent opp a SECOND time.
  Record the relay response (status code and JSON body) for the repeated `idempotencyKey`. That single
  capture resolves whether a duplicate re-tap is the false-failure source, or whether only the timeout
  (section 4) is.

## 4. TIMEOUT BOUND

- **`FETCH_TIMEOUT_MS = 6000`** (`library/board.html:287`). `authFetchOnce` uses
  `var ms = timeoutMs || FETCH_TIMEOUT_MS` (`library/board.html:484-485`) and, on expiry, rejects with an
  error tagged `e.kind="timeout"` (`timeoutError`, `library/board.html:480`).
- **`relayPost` in `sendOne` passes NO `timeoutMs`** (`relayPost(payload)`, `tools/board-send.src.js:331`;
  `relayPost` accepts an optional bound, `:306-310`). So the send inherits the default **6s** bound. A relay
  round-trip longer than 6s (an Apps Script cold start on a phone network) rejects, hits the section-1 line
  343 handler, and becomes `{ok:false}` - even though Resend may already have accepted and delivered.
- **In-file precedent that line 343 ignores.** The page-publish path treats a timeout as "likely landed,
  confirm in background", NOT a failure:
  `if(e && e.kind === "timeout"){ ok++; published.push(r.slug); ... }` (`tools/board-upload.src.js:351`, and
  again `:772`). `sendOne`'s rejection handler (`tools/board-send.src.js:343`) does not make that
  distinction - it returns `{ok:false}` for a timeout exactly as for a hard network error, so a slow-but-
  delivered send is judged failed and reverted.

## 5. POST-FIX SURFACE

With the view now counting null-cycle sends as current, a send that WROTE a `console_mail` row sticks: after
`sendOne`, `runSend` re-reads server truth (`reloadBoardData()`, `tools/board-send.src.js:385`) before it
renders, so a recorded send is reflected from the server. The revert only fires when `sent.length === 0`
(`:387`), i.e. when `sendOne` returned `{ok:false}`.

So the ONLY remaining false-failure surface is a send that **DELIVERED but returned `{ok:false}`**, which is
exactly two cases, both landing on line 343 or 332/334 and then the line 387 revert:

- **A duplicate re-tap** (section 2 + 3): the first send delivered and wrote the row; the second tap re-POSTs
  the same key and, IF the deployed relay answers a repeat with non-2xx / `ok:false`, becomes `{ok:false}` ->
  banner + local revert, while the first send's `status='sent'` row still exists. (Gated on the section-3
  live capture.)
- **A genuine >6s timeout** (section 4): Resend accepted and delivered, but the relay reply exceeded the 6s
  bound, so `authFetchOnce` rejected -> line 343 `{ok:false}` -> banner + revert. Here this attempt wrote no
  row (it returned before `confirmMail`), so the "row exists" observation points at the duplicate case; the
  timeout case is a delivered-but-unrecorded false failure.

Confirmed: with the cycle relax in place, these two (duplicate re-tap, and a real timeout) are the whole
remaining false-failure surface. Both are "the email went out, but `sendOne` returned `{ok:false}`."

---

## ABSENT list

1. **The deployed relay's response to a repeated `idempotencyKey`** - decided in Code.gs, not verifiable from
   the repo. Needs one DevTools Network capture of a deliberate second send of an already-sent opp
   (section 3).
2. **A board-shell dedupe lookup** - there is no `findMailRowByIdem` equivalent in `board.html`'s scope for
   `sendOne` to consult before POSTing (section 2); whether one can be added cheaply depends on what the
   board already holds locally.
3. **Whether the deployed relay writes any `console_mail` row itself** - the repo relay does not (the browser
   `confirmMail` writes it), but the deployed relay's behavior on the send path is Code.gs, so a delivered-
   but-unrecorded timeout cannot be confirmed from the repo alone.

## The smallest truthful fix path (described, not applied)

The one change that removes the larger, unconditional false failure, mirroring an existing in-file pattern:

- **`tools/board-send.src.js:343`** - in `sendOne`'s rejection handler, branch on the error like the page-
  publish path already does (`tools/board-upload.src.js:351,772`): when `err && err.kind === "timeout"`,
  return a NON-failing result (e.g. `{ ok:true, addr:art.to, confirming:true }`, the same shape the confirm-
  write-failure path already returns at `:342`) instead of `{ok:false}`. Then `runSend` keeps the card in
  Sent and shows the amber "confirming" note rather than reverting and printing red. A timeout is "likely
  delivered, confirm on the next board read", exactly as the upload path treats it. One handler, one file.

Two smaller follow-ons, each gated by evidence, not needed for the timeout fix:

- **A duplicate short-circuit in `sendOne`** (mirror `library/app.js:7512-7516`): before `relayPost` at
  `tools/board-send.src.js:331`, if a prior `console_mail` row for this `idem` is already `sent`, resolve a
  `{ok:true, duplicate:true}` and skip the POST. Gated by ABSENT #2 (a board-side idem lookup) and ABSENT #1
  (whether the relay's repeat response is even the culprit).
- **A revert guard in `runSend`** (`tools/board-send.src.js:385-387`): since `reloadBoardData()` has already
  re-read server truth by line 387, skip `replaceRow(slug, snap)` when the reloaded `__data` now shows this
  slug as sent - so a card the server already records is never locally reverted even if this attempt returned
  `{ok:false}`.

The minimal truthful fix is the first bullet alone (the line 343 timeout branch); it needs no live capture
and no new lookup, and it retires the timeout half of the surface immediately.
