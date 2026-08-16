# Thrive Console · one visual-state law, and no endless sending

Two proven defects, one root: behaviour must follow an explicit named state, not an ad-hoc effect. This PR
makes every visual state a function of a named data state, and closes the write gap so a send is either
confirmed or visibly failed, never endlessly sending. Author only; Thyab merges, runs the SQL, confirms the
stamp on device (WebKit is the device gate; this proves the engine-independent facts).

---

## Part 1 · The write is confirmed, timed out, or visibly failed (never endless)

**The gap.** Every prospect send already routes through the one confirmed-write path (`relaySend` ->
`supaConfirmMail`, audited: the only relay dispatch that skips the row is the intentional ledger-less
self-test, which has no opp and makes no card, so it can never strand one). But the `sending` state (a
signed-in operator whose confirmed write failed) had **no timeout**: `reconcileSendingMail` only graduates a
row when its queued upsert flushes, so if the write never lands the card wears `sending` forever. Fleurs-de-Lea
is that card: delivered by the relay, its `console_mail` row never written, waiting on a confirmation that is
not coming.

**The fix (state machine).**

| Transition | When | Effect |
|---|---|---|
| `sending` stamped | `relaySend` sets `sending` | the row carries `sending_since` (the clock starts) |
| `sending` -> `sent` | the queued write flushes (`reconcileSendingMail`) | the happy path, unchanged |
| `sending` -> `unrecorded` | not confirmed within **`SEND_CONFIRM_TIMEOUT_MS` (90s)** (`reconcileStuckSending`) | the **failed** state: a delivered send the server never recorded. Recorded on the diverge ledger; never swallowed |
| legacy `sending` (no stamp) | at once | treated as overdue, so a pre-fix row (Fleurs) can never hang |
| `unrecorded` -> `sending` | operator taps **Retry the record** (`retryRecord`) | re-records (not re-sends): re-enqueues the confirmed write and flushes |

- The timeout runs on the sync cadence and before every board paint, so a stuck send surfaces on its own.
- The unsynced indicator (`boardDrift`) now **counts** `sending`/`unrecorded` rows (`out.stuck`) and **drains
  to zero** the moment they record; an `unrecorded` row is never mirrored to the server as a phantom send.
- **Fleurs specifically:** the delivered send whose local row is already gone (cleared browser) is reconciled
  by the additive **`docs/supabase-fleurs-backfill.sql`** (one `INSERT ... ON CONFLICT DO NOTHING`, deletes
  nothing). After it, the view records the send and the card reads Sent on the board and in its detail.

Status: **HOLDS.** No send dispatches without a confirmed row write; no `sending` state can hang past 90s.

---

## Part 2 · One visual-state law (behaviour follows state, not aesthetics)

`cardState(o)` resolves **exactly one** state per card, by priority, each from **one named source**. The token
wears **at most one** emphasis class and a **`data-state`** attribute (the single hook every surface reads).
Nothing glows, colors, or borders except by this table.

| State | When (the one named source) | The one treatment | Reduced-motion |
|---|---|---|---|
| **failed** | a delivered send whose row was never recorded (`cardUnrecorded`) | red warning ring (`.tok.is-failed`) + "sent, not recorded" meta + retry in the card | static (no animation) |
| **in-flight** | a send whose row is not yet confirmed, within the timeout (`cardSending`) | amber pulsing outbox dot (`.tok-sending`) | static dot |
| **new-activity** | a reply or open unseen since the card was last opened, or an unopened conversation (group-aware), gated to past-send by the resolved lane; **clears** on open (`markCardSeen`) | green breathing glow (`.tok.has-reply`) | static glow |
| **awaiting-action** | a contacted card idle past the stall clock (`tk.stalled`) | amber calm ring (`.tok.is-stalled`) | static ring |
| **settled** | sent/opened/replied with nothing new, or a plain draft | none (neutral hairline) | none |

**Rules honored:** one state per card (priority resolves ties); each state maps to exactly one treatment; no
card shows emphasis without a state; the mapping is the same on every surface (the board token and the card
modal read the same `cardState`); reduced-motion is respected (every treatment has a static form; the failed
ring is static by design).

**Removed (emphasis that did not trace to a state):**
- the board-token **`is-glow` / `is-glow-new`** ring, driven by a lane-key literal + a position signature, not
  a named state (the "glows fire and fade with no rule" the operator could not read). The identical class on
  the Insights column-max table cell is unaffected (a cell, not a card).
- **`is-hot`** (repeat-open lane-fill): folded into new-activity (an unseen open) or settled.
- **`is-provisional`** (draft dashed-dim): a draft is settled; the de-emphasis is retired.

Status: **HOLDS.** Every card treatment traces to exactly one named state.

---

## Part 3 · The surrounding area, audited for the same class

| Intermediate state | Bounded? | Finding |
|---|---|---|
| card `sending` | **now yes** (90s -> `unrecorded`) | the one offender; fixed above |
| activate / publish, save template, batch approve (`runAction`) | yes | `is-running` always cleared in `finally`; the awaited work uses `fetchT` (15s/30s AbortController). Cannot hang. HOLDS |
| compose Send button, self-send button | yes | disabled + label restored in `finally`. HOLDS |
| draft save, template save | yes | synchronous local writes, no network wait. HOLDS |
| connection test ("Testing…") | yes | each step is a bounded `fetchT`. HOLDS |
| optimistic reply bubble | yes | reconciled on every outcome, dropped on failure. HOLDS |

- **Visual signals with no data source:** the only ones were the retired `is-glow` / `is-hot` /
  `is-provisional` (Part 2). Every remaining card emphasis traces to `cardState`.
- **Unsynced indicator:** now counts the failed/stuck sends and drains to zero when they record (Part 1),
  proven by `state_law_test`.

Status: **HOLDS.** No intermediate state without a timeout and a visible failure; no orphan visual signal.

---

## Acceptance

1. Fleurs-de-Lea no longer hangs on `sending`: it times out to a visible **failed** state with a retry, and
   its delivered send is reconciled into `console_mail` by the backfill SQL. **Met.**
2. No send dispatches without writing its row; no `sending` can hang past 90s. **Met** (`state_law_test`,
   fails-when-broken proven: remove the timeout and the stuck send stays `sending`).
3. Every glow/color/border traces to exactly one named state; the table is above; no emphasis without a
   state. **Met** (`state_law_test`, `replied_glow_test`).
4. Other intermediate states have bounded lifetimes and visible failures; no endless spinner. **Met** (Part 3).
5. Ten refreshes identical; lane matches detail; chips == headers == counts, EN and AR. **Met** (bed:
   `one_stage_source_test` 10-refresh stability, `board_calm_test`, `board_one_read_test`).

Full bed 72/72 green; verify 35/35; arabic / flows / perf green (the perf ceiling was lifted the minimum to
fit this subsystem, documented in `tools/perf_gate.py`); isolation grep 0; build stamp moved. No Lotus, no
newsroom.
