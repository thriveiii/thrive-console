# Intake integrity: one mint, atomic batches, evidence-backed lanes

## The incident

A zip of opportunities was imported and every template activated. The board collapsed:

- never-sent cards landed in the **Sent** lane reading "0 يوم بلا حركة" (0 days without movement),
- the **Ready** lane zeroed,
- the header chip counts oscillated between paints (11 sent, then 9, then 11).

This was not one bug. It was a class of bug, closed here with five invariants, each enforced in code
and proven by a test that fails when the fix is reverted.

## The three roots (diagnosed, then quoted)

### Root 1, the phantom stamp: a never-sent record was written wearing `status:"sent"`

Four creation paths stamped a sent-status onto a record nobody had emailed. The manifest writer led,
and three more literals followed the same habit:

- `manifestEntry` defaulted the field: `status: rec.status || "sent"`.
- the editor's `record()` builder hardcoded `status:"sent"`.
- the unpublish path re-stamped `status: o.status || "sent"`.
- the manifest **export** defaulted the same: `status: o.status || "sent"`, so a never-sent card
  exported as sent and the phantom survived a round-trip through re-import.

Each of these was a page, not a send. A page has no send until a message is delivered.

**Fix (I1).** Every mint flows through `ThriveIntake.toRecord`, which produces the safe default shape
(`stage:""`, `published:false`, no `status`). The four literals no longer default to `"sent"`:
`manifestEntry` defaults `status: rec.status || ""`, the editor and unpublish literals drop the stamp,
and the export derives its status from evidence:

```js
// The exported manifest carries a card's TRUE status at export time, derived from evidence through
// effStage, never a blind status:"sent" default. A never-sent card exports no status.
function manifestStatusFor(o){
  const s = effStage(o);
  return LEGACY_DECLARED_STAGES[s] ? s : "";
}
```

### Root 2, the phantom send: the lane derivation fabricated a send from a bare stage word

Even when a record carried `stage:"sent"` (a legacy row, a corrupt import, the manifest default above),
the derivation invented a send out of that word. Two copies did it: `sendsFor` (app.js) and the
board-layer `sendInfo` (stage-model.js) each returned `{ count:1, ... declared:true }` when
`o.stage === "sent"`, with no ledger row and no manual contact behind it. `effStage` then read that
fabricated count and returned `"sent"`, and the card sat in the Sent lane forever.

**Fix (I2), the resilient one.** A lane is derived from a delivered send **record**, a mail ledger row
or a recorded manual contact, never from a declared word. The phantom branch is gone from both copies;
`sendsFor` now ends:

```js
// INVARIANT I2, evidence-backed lanes: a send is a delivered send RECORD, never a declared word. The old
// code fabricated a phantom send here from a bare stage==="sent" ... That backdoor is closed: no evidence,
// no send. effStage clamps such a record to Ready (a page exists) or Draft (none).
return { count:0, first:"", last:"" };
```

This makes the board **resilient**: even a persisted, corrupt `stage:"sent"` with no send record now
derives to Ready, not Sent. A fresh import or activation physically cannot reach the Sent lane.

### Root 3, the non-atomic batch: partial lanes and a mid-batch sync repaint

`writeImport` wrote each record individually with `saveDraft`, and each write scheduled a debounced sync
push (`scheduleSyncPush`, 4000 ms), whose round fired `onThriveSync` → a board render. So the board
repainted against a **partial** batch, some cards written, some not, and the counts oscillated as more
records landed between paints.

**Fix (I3).** The batch stages every record and commits them as **one** store transition. A batch depth
counter suppresses the sync push mid-batch, so no round fires against a partial store:

```js
const staged=[]; __batchDepth++;
try {
  for (/* each parsed entry */) { /* mint via ThriveIntake.toRecord, publish if hosting */ staged.push(rec); }
  commitDraftsBatch(staged);      // the ONE write: one store transition, one sync schedule
} finally { __batchDepth--; }
try { scheduleSyncPush(); } catch(_){}
```

`commitDraftsBatch` mirrors `saveDraft`'s merge semantics (update-in-place by slug, Supabase cache and
mirror per record) but calls `setDrafts` exactly once. And `scheduleSyncPush` returns early while
`__batchDepth > 0`, so the board renders once, after the whole batch, never in the middle of it.

## The five invariants

| # | Invariant | Enforced by | Fails-when-broken |
|---|-----------|-------------|-------------------|
| I1 | **One mint.** Every creation path uses `ThriveIntake.toRecord`; no literal stamps a phantom sent-status. | `toRecord` default shape; `manifestEntry`/editor/unpublish/export cleaned; `manifestStatusFor` derives export status. | Re-default `manifestEntry` to `\|\|"sent"` → I1 guards red. |
| I2 | **Evidence-backed lanes.** No page = Draft; page + no delivered send = Ready; Sent/Opened/Replied REQUIRE a real record. | Phantom-send branch removed from `sendsFor` and `sendInfo`; `effStage` clamps to live/draft without evidence. | Re-add the `stage==="sent"` phantom to `sendsFor` → the guard and the live "Ready not Sent" check red. |
| I3 | **Atomic batch.** Stage all writes, commit as one transition; no sync round or repaint mid-batch. | `commitDraftsBatch` (one `setDrafts`); `__batchDepth` guard in `scheduleSyncPush`. | Write per-item (`saveDraft`) or remove the guard → I3 guards red. |
| I4 | **One count pass.** Header chips and lane counts come from one build; chip N == lane N. | Render sets `data-count` and `data-count-tab` from the same `b.lanes[k].length`; `summary.counts[k]` is `lanes[k].length`. | Make `summary.counts.sent = lanes.sent.length + 1` → the equality check reds. |
| I5 | **Idempotent re-import.** Re-committing the same slug set mints nothing twice. | `commitDraftsBatch` updates an existing slug in place, never appends a second row. | Make `commitDraftsBatch` always append → the "never a second row" check reds. |

## THE REPRO (Thyab's device gate)

Upload three opportunities, activate all templates:

1. every card lands in **Ready** (published) or **Draft** (not), never **Sent**, no send happened;
2. the board paints **once**, after the whole batch, not per card;
3. the header chip count equals the lane count for every lane;
4. run the exact same import a **second** time, nothing is minted twice (I5).

The sandbox proves the wiring underneath this gate in `tools/intake_integrity_test.py` (I1–I5, each with
a source guard and a live check). The true device restore is Thyab's WebKit pass.

## §3, the persisted clamp (optional; the board is already correct on read)

Because I2 makes the board **resilient**, no migration is required: a stored `stage:"sent"` with no send
record already derives to Ready. `docs/supabase-intake-integrity.sql` only **aligns** the stored data
with that read view. It is additive and idempotent, touches `console_opps` and reads `console_mail`
only, and clears a phantom `sent`/`opened` stage **solely** where there is no send evidence anywhere (no
outbound mail ledger row, no recorded manual contact). It destroys nothing: send-backed stages and every
declared outcome (replied, won, lost, dropped, bounced, failed) are untouched. If you also ran
`supabase-lifecycle-legacy.sql`, run this one after it and do not re-run the legacy backfill.
