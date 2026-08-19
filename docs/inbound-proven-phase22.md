# Inbound, proven and industry-grade (P22)

The concern: are replies truly arriving, completely and sustainably? The loop has worked once (Basel's
reply is in `console_inbound` and on the board), but "worked once" is not "complete." This phase proves the
loop, hardens it to the strongest current practice built on the console's own logic, and makes silence
detectable. Additive only; the reply extraction and the lane laws are unchanged – they are fed, not moved.

## The live inbound path, as found (relay v6, before this change)

The mechanism is a **fifteen-minute Gmail poll, not a webhook.** `scanInbox()` runs on a time trigger
(`installScanTrigger` → `everyMinutes(15)`). Each run searches `in:inbox -in:chats after:<yesterday>`,
attributes each new message, and appends to `store.inbound` (a JSON file on Drive) which the console syncs.

A reply's path: prospect replies to `hi@` or `hi+<slug>@thriveiii.com` → Gmail inbox → the next sweep reads
it → `attributeMessage_` joins it → `store.inbound` → the console pulls it (`inbound_get`, on every sync
heartbeat) → `ThriveInbound.mergeInbound` dedups by Gmail id → the board's server view places the card and
the child reply card extracts.

Attribution order, already recorded as `rule`: `tag` (Reply-To `hi+<slug>@`) → `thread` (In-Reply-To /
References vs a stored outbound Message-ID) → `sender` (from-address vs a known recipient) → `none`. Reply-To
plus-addressing already ships. Idempotency is by Gmail message id on both sides.

**Failure modes found, and what P22 closes:**
1. **The threading tier was unreliable.** `sendMail_` forwarded the console's headers but did not *guarantee*
   a Message-ID on the wire and did not return it, so a legacy caller (or any path that omitted the header)
   left the reply's In-Reply-To with nothing on our side to match. P22 makes it a guarantee.
2. **Silence was not surfaced on the board.** The sweep heartbeat existed in Settings but nothing on the
   board flagged a stalled poll. P22 adds it.
3. **No reconciliation.** The sweep counted found/added but never compared the mailbox against what is filed.
   P22 adds a read-only comparison and surfaces any gap loudly.

## What P22 builds

### Deterministic reply routing, guaranteed

- **`sendMail_` guarantees a Message-ID and returns it** (`messageId`). Whatever headers the console sent are
  forwarded verbatim; if none named a Message-ID the relay mints one on its own domain, so the wire message
  always carries a stable id the reply's In-Reply-To / References can be matched against. Reply-To remains the
  per-opportunity plus address (`hi+<slug>@`), the deterministic primary; References is the documented fallback
  when a mailbox strips the plus tag. Both paths are implemented and the active one is recorded per row.
- **The join basis is one vocabulary, one derivation, one precedence.** `ThriveInbound.joinBasis(rec)` is the
  single place a row's basis is decided – `plus-address`, `references`, `sender`, `subject-heuristic`,
  `manual`, or `unresolved` – each carrying a `deterministic` flag. The precedence is fixed and a
  DETERMINISTIC basis always outranks a HEURISTIC one for the same row:

  `plus-address` → `references` → `sender` → `subject-heuristic`

  so a reply matchable by both a deterministic and a heuristic join records the deterministic one (proven by
  a both-match fixture). `plus-address` and `references` are deterministic; `sender` and `subject-heuristic`
  are heuristic; a hand attachment is `manual` (certain, human); nothing matched is `unresolved`. Subject
  matching stays exactly where it was – the last automated rung – and is now flagged heuristic in provenance,
  never presented as certain. The `sender` tier is kept as its own basis rather than dropped: it joins real
  replies today and is deterministic-by-address, so it is recorded distinctly and marked heuristic.

### Completeness and self-monitoring

- **Idempotent sweep, heartbeat every run.** The sweep dedups by Gmail id (unchanged) and now stamps its
  interval (`everyMin`) and whether it hit its read cap (`capped`) onto the heartbeat.
- **Reconciliation** (`inbox_reconcile`, read-only): walks the same window, counts the messages that ARE
  replies, and compares that set against what is filed, by Gmail id. The gap is the count of replies the
  mailbox has that the store does not. It writes nothing; a sweep closes the gap.
- **Silence made visible on the board.** `inboundHealth()` reads the heartbeat and the reconciliation gap.
  A sweep older than three intervals shows a quiet **"inbound delayed"** badge; a capped sweep or a
  reconciliation gap shows a loud **"replies not filed"** badge (with its count). Beside the sync pill, the
  same lazy-badge pattern as the drift self-check.

### Thread integrity

- **The basis shows on the message.** In the thread (the one P12 renderer), a deterministic basis reads inline
  with a certain check; a heuristic basis is a tap-open disclosure that names itself a guess (`replyBasisHtml`,
  from the one `joinBasis`). An operator sees at a glance which replies are certain. No thread shows another
  opportunity's message: the join keys (the plus tag, the Message-ID) are unique per slug.

## The version contract

`RELAY_VERSION` moves to **7**; the response shape gained `messageId` on a send and `everyMin`/`capped`/`gap`
on the inbound signals. All of it is additive, so the console keeps **`REQUIRED_RELAY = 5`** exactly as P8
kept it for v6: a v5 relay still serves every request, single sends are unchanged, and the new inbound signals
simply do not appear until the relay is redeployed to v7 (the five-tap ritual in `docs/RELAY.md`). The
invariant `REQUIRED_RELAY <= RELAY_VERSION` holds.

## Evidence

- **`tools/inbound_proven.js` (Node, the real relay in a stubbed Apps Script sandbox + the pure client model)
  – the industry-grade spine, no browser:** a send guarantees and returns a Message-ID (a console-supplied
  one is preserved); attribution joins by plus-address and by the References header; the join basis is derived
  in one place with the fixed precedence, deterministic before heuristic, proven by a both-match fixture; the
  sweep is idempotent and writes a heartbeat with its interval and cap flag; reconciliation reports the gap
  and a sweep closes it; the `inbox_reconcile` op answers, versioned.
- **`tools/inbound_health_test.py` (browser, the reliable `threadListHtml` path):** a deterministic reply
  shows a certain inline basis, a heuristic reply a tap-open disclosure; the board shows the quiet delayed
  badge when the sweep is stale, the loud backlog badge when it is capped, and a counted backlog on a
  reconciliation gap.
- **`tools/inbound.py`:** its mock now stamps `relay_version` (a real relay always does; without it the
  console's version gate stops the sync before the inbound pull – the reason its inbound-load assertions were
  red). Its lane-move assertions, which tested the client Replied-derivation that P19/P20 deliberately deleted
  in favour of the server view, are reframed to the client guarantee P22 feeds: every reply resolves to its
  opportunity by its rule (the one resolver, `resolvedReplyOpp`).
- **Gates:** `verify.js` 35/35, `arabic.py`, `flows.py`, `perf_gate.py` green (ceilings raised with a P22
  note); `relay_handshake_test.py` and `version.js` green (the latter corrected to the P8+ `<=` invariant and
  the JSON GET it stubs). Isolation grep clean (only the benign `store.js:20` prose).

## The live full-loop test (device-gated, Thyab runs it)

The console's Supabase project and the live relay are not reachable from the sandbox, and no real mailbox is,
so the full loop is proven on Thyab's device:

1. Send to a real external inbox; reply from it. The reply lands in `console_inbound`, joins the correct
   opportunity with its basis shown, extracts the child card, and appears in the Replied lane. Repeat with an
   **edited subject**: it still joins, by plus-address or by References, never by subject guessing.
2. Replay the same inbound twice: one row, one card.
3. Kill the sweep once (disable the trigger): the board shows "inbound delayed". Restore it: the notice clears.

A caveat on the wire Message-ID: whether the recipient's In-Reply-To echoes the console's exact Message-ID
depends on the provider (Resend) honoring the custom header. The loop does not rest on it: `plus-address` is
the deterministic primary and is provider-proof (it is the Reply-To address); References is the fallback.
This is the one part only the device can confirm end to end.

## Do not (held)

Replies are never joined by subject except as the flagged last automated rung. Inbound failures are never
silent: the heartbeat and the reconciliation gap are on the board. The reply extraction and the lane laws are
unchanged – they are fed. There is one inbound store and one inbound path.
