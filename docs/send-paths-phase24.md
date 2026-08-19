# Two explicit send paths: one brief to one owner, one campaign to dozens (P24)

The machinery for both a single send and a paced campaign already existed (P8's durable queue, jitter, warm
ramp, budget; P5's roster; P6's merge; P7's per-recipient preview). What the board did not do was **offer the
choice**: there was no clear path from "I have an offer" to "send it to one" versus "send it to dozens." P24
surfaces the two paths end to end. It builds **no new send machinery**: it wires the existing one system.

## What P24 adds

### One "Send", two explicit paths

- A single **Send** action, from any opportunity card (the card overview) and from the top bar (the board and
  Insights toolbars), opens a calm, explicit chooser: **فردي** (one recipient, this card's contact) versus
  **حملة** (many recipients, the roster). Each path is sized as a real decision, with a one-line description
  and the concrete fact under it (the recipient's address, or the roster count).
- **Single** goes straight to the composer (the Outreach tab), prefilled from the card's primary channel
  (P18). **Campaign** goes to the campaign screen when a roster of many already exists, or to the roster
  editor (P5, in Overview) first when it does not, so the operator builds the roster before sending. From
  there the existing flow is unchanged: personalize (P6), preview per recipient (P7), the paced queue (P8).
- From the top bar, with no card in context, the chooser first lists the sendable opportunities to pick from;
  from a card, the card's own Send passes the slug straight through. The chooser reuses the `.tw-scrim`
  dialog shell and the `.och-card` decision-card pattern; it is pure navigation.

### Deliverability, restated where the operator decides

- The campaign screen (beside **Start campaign**) shows **the campaign plan**: the jitter window
  (base..base+spread), today's budget (today's capacity / the daily budget), the warm-ramp cap, and the
  estimated finish (same day, or spread over N sending days). So a dozens-send is **visibly disciplined**, not
  a blast. `campaignPlan(o)` computes this WITHOUT side effects and WITHOUT randomness, from the SAME warm-cap
  and jitter constants the real scheduler uses, so what the operator reads is what the queue will run. Only the
  wall-clock finish is an estimate (the per-row gap is random within the stated band); the day boundaries and
  the deferred count are exact and are proven to agree with a real schedule.

### The lanes and the laws are unchanged, only fed

The aggregate stage, the per-recipient states, reply extraction to the Replied lane, and per-recipient opens
are all already law (D1, D2, R7). P24 proves them from the new entry points and changes none of them. There is
one compile, one `startCampaignQueue`, one `relaySend`; P24 adds a chooser that opens them, not a second of any.

## Evidence

- **`tools/send_paths_test.js` (Node, no browser):**
  - *Part A* lifts the real `campaignPlan` and `campaignSchedule` from `library/app.js` and proves the plan is
    honest: the jitter band is the stated seconds; 12 recipients under budget all send today; past the warm cap
    the overflow defers; a tight daily budget clamps today's capacity; and, for several roster sizes, the
    plan's day-of-last-row and deferred count **agree with a real schedule**. `campaignPlan` writes nothing.
  - *Part B* is a source audit proving P24 adds no send machinery: `openSendChooser` only navigates
    (`thriveModal.open`) and never calls `relaySend` / `startCampaignQueue` / `compile` / `pushOutbox`; the
    single path routes to the composer, the campaign path to the campaign screen (or the roster when none
    exists, never a bypass); exactly one compile, one queue, one relaySend remain; the plan is mounted on the
    campaign screen; the top-bar Sends open the chooser and the card overview offers an explicit Send.
- **`tools/send_paths_shots.py`:** a faithful static-mock gallery on the real `styles.css` and exact classes
  (`send-box`, `send-grid`, `send-card`, `cpl-panel`), EN + AR, at **three widths** (380 / 720 / 1120), proving
  the chooser stacks on a narrow phone and sits side by side on a tablet with no overflow, RTL clean, Western
  numerals isolated.
- **Gates:** `verify.js` 35/35, `arabic.py`, `flows.py` green. Isolation grep clean (only the benign
  `store.js:20` prose).

## The live end-to-end test (device-gated, Thyab runs it, fresh stamp first)

The Supabase project, the live relay, and a real mailbox are not reachable from the sandbox, so the two paths
are proven end to end on Thyab's device:

1. From a card, the **single** path sends one email prefilled correctly; the card advances lanes.
2. A **campaign of 12 test recipients** runs from roster to queue: jitter visible in the ledger timestamps,
   budget honored, pause and resume work, the device closed mid-run and sends continue (P8 law), every
   recipient one row, the aggregate card correct, and a test reply extracts to the Replied lane.
3. The chooser renders EN and AR at three widths with no overflow (also captured statically above).
4. No new send machinery: the grep proof above holds on the shipped bytes.

## Do not (held)

No second queue and no second composer: the chooser wires the existing one system. A campaign send never
bypasses the roster, the preview, or the paced queue. The deliverability numbers are not hidden; the operator
sees the discipline on the campaign screen.
