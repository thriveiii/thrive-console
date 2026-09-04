# A_FIX.md

Fix for Defect A: the false-failure revert on delivered sends in the board shell
(`tools/board-send.src.js` -> `library/board.html`). One PR. Ground truth: Resend shows every real send
Delivered, so any card that reverted or printed "1 failed" was the console diverging from Resend.

## Root cause (from A_TRACE)

`sendOne` gave the relay only the 6s default bound (`relayPost(payload)` with no `timeoutMs`,
`board-send.src.js:331`), but the Apps Script relay legitimately completes slower (cold start + Resend + the
302 body hop). The 6s cut-off rejected, `sendOne` returned `{ok:false}`, and `runSend` reverted the card and
printed red, even though the email had left. The line-343-only idea from A_TRACE was NOT sufficient on its
own: on success `runSend` trusts `reloadBoardData()` and does not re-apply `stage=sent`, so a timeout branch
that returns `{ok:true}` WITHOUT writing a row still reverts on reload (the view finds no send). The row must
exist.

## What changed (this PR)

### Change 1 (primary): give the relay send a real bound

- Added, near `SEND_GAP_MS`: `var RELAY_SEND_TIMEOUT_MS = 20000;` (`tools/board-send.src.js`). The Apps
  Script cold start plus Resend plus the 302 body hop needs far more than 6s; `page_publish` already uses a
  longer bound for the same reason (per the `relayPost` comment). Normal sends finish in a second or two, so
  this only extends the wait on a genuinely slow call.
- `sendOne` now calls `relayPost(payload, RELAY_SEND_TIMEOUT_MS)` (was `relayPost(payload)`).

This alone converts today's false failures into real successes: the relay answers `ok:true`, `confirmMail`
writes the `status:'sent'` row, `runSend` re-reads server truth, the card sticks in Sent, and it matches the
Delivered row in Resend. No red banner.

### Change 2 (safety net for the rare >20s tail): write a pending row on timeout

- `sendOne`'s rejection handler now takes the error and branches on `err.kind === "timeout"`
  (`board.html:480` tags a timeout). On a timeout it writes the SAME `console_mail` row but with
  `status:'pending'` (the view's `mail_sends` counts `''`, `sent`, `copied`, and `pending`), then returns
  `{ ok:true, addr, confirming:true }`. Because a pending row now exists, `reloadBoardData()` finds the send
  and the card stays in Sent with an amber confirming note, even when the relay reply never arrives. A
  genuine non-delivery later flips via the bounce webhook.
- Every OTHER rejection (network error, aborted body) still returns `{ ok:false }` and writes no row: a real
  failure stays a real failure. The two relay-side failures (non-2xx, body `ok:false`) are unchanged.

Nothing else changed: the optimistic UI, the per-recipient loop, the send cap, the confirm-write success and
its confirm-failure limbo, the revert condition (`sent.length === 0`), the view, and the cycle stamp are all
as they were.

## What remains gated (Change 3, NOT coded)

The duplicate re-tap (A_TRACE sections 2, 3, 5). `sendOne` has no dedupe guard, so a second tap on an
already-sent opp re-POSTs the same `idempotencyKey`. Whether that second POST returns a failure depends on
how the DEPLOYED relay (Code.gs) answers a repeated `idempotencyKey`, which is not verifiable from the repo.
This PR does NOT touch it. It is gated on one DevTools Network capture: send an already-sent opp a second
time and record the relay status + body. If the repeat is answered non-2xx / `ok:false`, the follow-up is an
`app.js`-style guard (`findMailRowByIdem`, `library/app.js:6753`, mirrored from `library/app.js:7512-7516`): a
completed prior send under the same idem resolves as success, no re-POST, no revert. With Change 1 in place,
a legitimately slow send is no longer a false failure, so the duplicate case is the only remaining surface.

## Tests

- `tools/a_fix_send_timeout_test.js` loads the REAL `sendOne` into a sandbox (stubbing its board.html-scope
  deps) and asserts: a normal success writes a `status:'sent'` row and returns `{ok:true}` through the 20s
  bound; a timeout writes a `status:'pending'` row and returns `{ok:true, confirming:true}` (no revert); a
  non-timeout rejection stays `{ok:false}` with no row; and relay non-2xx / body `ok:false` stay failures.
  **Proven fails-when-broken:** dropping the `RELAY_SEND_TIMEOUT_MS` argument fails 2 checks; reverting the
  timeout branch to a hard failure fails 4. All 14 pass restored.
- `tools/board_send_test.py` (the existing board-send gate) passes.

## Build and verify

- Sole hand-edit: `tools/board-send.src.js`. `library/board.html` is the deterministic
  `node tools/bundle.js` output that carries the change (`RELAY_SEND_TIMEOUT_MS`, the timeout branch, the
  pending row). The app-shell outputs (`console.html`, `app.html`, `version.json`, BUILD `baa03970`) are
  unchanged - their inputs were not touched - so this PR leaves them alone.
- Device verify: `node tools/bundle.js`, deploy, then send one fresh opp. The card lands and STAYS in
  Sent/Opened, matching a Delivered row in Resend, with no red banner.
