# FINDINGS: Sentinel Sweep 5, THE GREAT AUDIT

Method change, not another patch. The count/lane oscillation has survived three targeted fixes (read
reconstruction, queue drain, the atomic-batch intake brief), which means the aim was wrong: the root is
systemic. This audit maps the state, instruments the paint, proves the root, and proposes a grouped
closure plan. NO FIX beyond the instrumentation is written here. A feature freeze holds until the BLOCKER
and SERIOUS findings are closed and re-verified on device.

The only code in this PR is the Layer 1 paint instrumentation (a flag, an overlay, a stamp) plus its test;
everything else is this ledger, the state map, and the read-only SQL hunts.

---

## The oscillation root, in one paragraph (proven by Layer 0, captured by Layer 1)

The board has **no single derived model per user-visible state, and no serialized render**. Four
accessors, `getDrafts` (app.js:2257), `getMailLog` (app.js:4114), `getInbound` (app.js:1638), and
`allHits` (app.js:406), each independently choose between the localStorage authority and the `__supa`
Supabase read-cache on **every call**, via `supaReadable()`. `syncMergeApply` writes only localStorage
(app.js:1565), while `__supa` refreshes only on a hydrate, so the two authorities hold different row sets
between events. On top of that, `render()` (app.js:7322) is an unserialized `async` function that roughly
twenty triggers call directly, with no generation token and no in-flight guard; `window.thriveBoardRefresh`
is raw `render` (app.js:7601). At sign-in, unlock, hydrate, and each sync round the triggers fan out into
three or more paints in quick succession, the immediate local paint (app.js:1358), the post-hydrate
Supabase paint (app.js:2704), and a post-sync paint (app.js:1899), each reading a different store state.
Because each `render()` awaits `build()` which awaits `mergedOpps()` which awaits `loadManifest()`, the
paints resolve in nondeterministic order, and the last build to resolve writes the DOM regardless of which
was launched from the fresher store. The counts therefore bounce, and can settle on the staler value. This
is why the three earlier fixes did not close it: none unified the authority selection, none serialized the
renders, and none gave the board one derived model consumed by every surface. With `?debug=paint` on,
Thyab's capture will show two consecutive stamps carrying the same trigger family but a different `src=`
(local vs supa-hydrated) and a different `hash`, naming the reader that diverged. The findings ledger
below numbers this root as **F1 + F2** and groups its full family into one closure brief.

---

## Layer 1: the instrumentation (the audit's only diff)

`ThrivePaintDebug` (app.js, near line 273) stamps every board paint when the flag is on, and is a strict
no-op otherwise. Turn it on with `?debug=paint` in the URL or `localStorage.thrive_debug_paint="1"`.

Each paint prints to the console and to a small fixed overlay:

```
[paint#7] board trigger=doSyncRound src=supa(hydrated)+local lanes={"draft":2,"live":3,"sent":9,"opened":1,"replied":0} hash=1a2f3c  DIVERGED from #6 (was 3d4e5f, trigger onGateUnlocked)
```

- **trigger** is read from the call stack, so it names the function that caused the paint.
- **src** is the authority the read resolved against (`local`, `supa(flag)`, `supa(hydrated)+local`).
- **lanes** is the per-lane count of the one derived model the board just built.
- **hash** is a content hash of that model (lane membership plus `summary.counts`).
- **DIVERGED** fires when two consecutive paints carry different hashes, and names the prior paint's
  trigger and hash, so the oscillation stops being a ghost.

The stamp only observes the one model the board already built; it reads no store and writes nothing. Proof
in `tools/paint_debug_test.py`: the stamp is a no-op with the flag off (no overlay, no console line, no
recorded stamp), and with the flag on two differing paints stamp, the second is flagged DIVERGED, and the
trigger is named from the stack. Thyab reproduces on the iPad with the flag on and pastes the two stamped
paints; that capture is the root evidence.

---

## The findings ledger

Severity: BLOCKER (the oscillation, ships nothing until closed), SERIOUS (correctness or security, closes
before the freeze lifts), POLISH (hygiene, tracked, not freeze-gating). Layer in brackets.

### F1 [L0] BLOCKER: multiple authorities behind one accessor
`getDrafts` returns `__supa.opps` when `supaReadFlagOn() && supaOn() && __supa.hydrated && !__supa.degraded`,
else `getDraftsLocal()` (app.js:2259-2263). `getMailLog` (app.js:4114), `getInbound` (app.js:1638), and
`allHits` (app.js:406) do the same authority pick per call. `syncMergeApply` writes only localStorage
(app.js:1565); `__supa` updates only on hydrate. The two stores drift, and the accessor's choice can flip
between paints. **Root hypothesis:** the board answers "how many opportunities exist, and in what stage"
from two different stores depending on the moment of the call. This is half the oscillation.

### F2 [L0] BLOCKER: no render serialization, no single snapshot
`render()` (app.js:7322) is async, re-derives everything, and is invoked directly by ~20 triggers
(app.js:7595-7597, 1351-1358, 1899, 2704, 881, 1810, 1839, 2809, 3503, 6245, and more) with no debounce,
no generation token, no in-flight guard. `thriveBoardRefresh` is raw `render` (app.js:7601). The unlock and
sync fan-outs fire three or more paints, and the last async `build()` to resolve writes the DOM
regardless of launch order. **Root hypothesis:** two paints land out of order and the visually-second
paint can carry the older snapshot's counts. F1 and F2 together are THE oscillation.

### F3 [L0] SERIOUS: a single build mixes a snapshot with live global re-reads
`hostEffStage` uses `ctx.opens` and `ctx.mail` snapshotted at `build()` entry (stage-model.js:74-98), but
`global.effStage` then re-reads `getInbound()` and `getMailLog()` live for `hasReply`, `isGroupOpp`, and
`bounceFor` (app.js:683-687, 758, 672). **Root hypothesis:** within one build a card's send/open evidence
and its reply/group/bounce evidence are read at different instants and possibly different authorities, so a
card can flip lane between two builds even without a store change.

### F4 [L0] SERIOUS: 3-second TTL caches vs a fresher store
`opensMap` (app.js:482), `openTimes` (app.js:501), and `sendIndex` (app.js:529) each cache for 3 seconds.
`supaHydrate` invalidates them, but `syncMergeApply` invalidates only sends (via `setMailLog`), not opens.
**Root hypothesis:** a paint under 3 seconds after a change reads stale cached opens/sends; the next paint
recomputes, moving a card between sent, opened, and stalled.

### F5 [L0] SERIOUS: two definitions of "a send"
`stage-model.js` `sendInfo` counts only `sent` and `copied` (stage-model.js:118). `app.js` `sendIndex`
counts `sent`, `copied`, and `pending` (app.js:539). The board's sent-vs-live gate uses the first; the
opens-window `outreachOpens` uses the second. **Root hypothesis:** for a card whose only send is `pending`,
the two rules disagree (live by one, sent by the other), and the card flips as the pending send resolves.

### F6 [L0] POLISH: board and card modal derive independently
The modal reads `rec=(await mergedOpps()).find(...)` and `effStage(rec)` at open time (app.js:9422, 9310,
9359), a different snapshot from the board's last paint. The state pill can name a stage different from the
lane the card sits in. Second-order symptom of F1/F2.

### F7 [L0] POLISH: Library pipeline is a cached snapshot
`initDashboard` caches `state.data = await mergedOpps()` once at init (app.js:2901) and refreshes only on
specific events (app.js:3140), while the board rebuilds every render. The two surfaces can show different
stage counts.

### F8 [L0] POLISH: Insights opens vs board opens read different sources
Insights aggregates `getHits()` (local only, app.js:7113); the board uses `allHits()` (the supa/remote
union, app.js:406). Opens counts can differ between the two surfaces.

### F9 [L2] SERIOUS (needs ratification): the presence model is 3/10, not 30/45
There is no 30 and no 45 threshold in the presence model. `needsFollowup` flags at 3 days (app.js:1334);
`STALL_DAYS = 10` (stage-model.js:32) drives the stalled chip and subtitle. The `30` in the selfTest is a
fixture age; the `45` is an SMTP 4xx regex in inbound.js. **Root hypothesis:** either the code thresholds
are wrong or the "30/45" spec is stale. This needs Thyab's ruling on which is authoritative before any
change; no fix proposed.

### F10 [L2] POLISH: "one minting path" is not literally singular
The import path mints only through `ThriveIntake.toRecord`, and no literal stamps a phantom status (the
load-bearing invariant HOLDS). But the editor's `record()` (app.js:3413) and `makeOfferOpportunity`
(app.js:6545) build record object literals and call `saveDraft` directly, bypassing `toRecord`. Correctness
is preserved; only the singular-path claim is inaccurate.

### F11 [L2] POLISH (latent): a dead second send entry bypasses quota
`sendThreadReply` (app.js:4786) is a second entry into `relaySend` that does not call `recordSend()` and
does not check quota. It currently has zero callers (the live thread-reply UI uses the composer's
`replyCtx` path, which counts). No deployed violation; a finding only if it is ever wired to a control.

### F12 [L2] POLISH (edge): manual reply-attach can derive Replied without a ledger send
`effStage` checks `hasReply` before the send gate, and a manually attached inbound row can set `opp` on a
never-sent card, deriving `replied` with no send record. Ordering stays correct (replied outranks opened);
flag as an edge, not a lane-count bug.

### F13 [L3] SERIOUS: activity is local-only, so the operations ledger is not durable cross-device
There is no `console_activity` table anywhere in the schema. `logActivity` writes only to the localStorage
`thrive_activity_v1` key, with no Supabase mirror. The Phase B operations ledger derives its non-send
actions (moves, comments, pages) from this local log, so on a fresh device only the mail-send rows
reconstruct; every move, close, and page action is device-local. **Root hypothesis:** per-operator
activity attribution is not durable, which undercuts the "full operations ledger" the profile promises
across devices.

### F14 [L3] data hunts to run (findings pending live data)
`docs/supabase-sweep5-hunts.sql` carries seven read-only SELECT hunts, authored against the confirmed
schema, for Thyab to run: (1) a stage claiming a send with no send record, (2) a child whose parent is
absent, (3) a slug disagreeing with its data mirror, (4) an inbound row pointing at a missing opp, (5) a
visit attributed with no send, (6) an actor-less send (with the note that activity is not in the DB at
all, F13), (7) a profile without a display name. Each non-empty result is a finding; corrections will be
PROPOSED as additive idempotent SQL once this ledger is ratified. Nothing is run in this brief.

### F15 [L5] SERIOUS: per-operator prefs are cross-operator readable and writable
`console_settings` RLS is `for all to authenticated using (true) with check (true)` (supabase-stage1.sql:95,
supabase-auth-policies.sql:40). Per-operator preferences still ride this table under the key
`op_prefs:<uid>` (app.js:1015, 1022, 1038), in parallel with the owner-scoped `console_profiles` that was
built to replace it. **Concrete risk:** a second authenticated operator can read `op_prefs:<other-uid>`
(language, board-column order) and can upsert to overwrite or corrupt it. The sensitive fields (signature,
memory) already live in the scoped `console_profiles`, so the exposure is limited, but the legacy shared
path is still live and should be retired.

### F16 [L6] POLISH: never-deregistered sync listeners re-read on every heartbeat
`onThrive` registers listeners but there is no `offThrive` (app.js:1397-1398). After a screen is visited,
its `sync` listener stays registered, so the 60-second heartbeat runs each previously-visited screen's
`render()` and its `mergedOpps()` even when that DOM is absent. Wasted reads per heartbeat; also relevant to
F1/F2 as extra background derivations. The board's own listener lifecycle belongs to the orchestrator that
closes F1/F2.

### F17 [L6] POLISH: runMove schedules the sync push twice
`runMove` triggers `scheduleSyncPush` once implicitly through `setDrafts` and once explicitly (app.js
~8663). The debounce coalesces them, so it is harmless, but redundant.

### F18 [L6] SERIOUS: silent profile and pref save failures
Three action and init-path Supabase writes swallow their failure with `.catch(function(){})`, bypassing the
diverge ledger: `console_settings` prefs upsert (app.js:1038), and two `console_profiles` upserts for the
display name and signature (app.js:1072, 1087), plus the prefs load fallback (app.js:1024). An operator can
edit their profile, see no error, and have the write silently fail with only local state holding it. The
board-data write path is not affected (it goes through the durable queue and `supaRecordDiverge`); the
profile and pref writes are the ones that vanish quietly.

### Layer 4 (surface integrity): HOLDS, with the known persisters re-verified
A programmatic overflow and horizontal-scroll scan across every surface (board, home/Insights, library,
profile, settings) at three widths (390, 834, 1280) in English and Arabic found **no page-level overflow**.
The one wide element (the Insights comparison table row at 889px) sits inside `.logwrap`, which is
`overflow-x:auto` (styles.css:343), so it scrolls within its own box on a phone rather than clipping the
page (`html`/`body` are `overflow-x:clip`, styles.css:73-74). The three known persisters are re-verified
present: the sign-in interstitial guard (`authRequired` + `supaEnsureHydrated`, app.js:1413-1421, from the
signin-board fix), the message-body frame wrap (`overflow-wrap:anywhere`, styles.css:158-159, 254, 279,
from the body-frame fix), and the Arabic date and number isolation (`<bdi>` composer, app.js:1205-1222,
from the isolation fix). Screenshots for the record are under `shots/sweep5/`. A pixel-level visual pass of
every surface in both languages remains Thyab's device walk; this layer reports the overflow and
known-persister triage as HOLDS and defers the pixel audit to the device gate.

### Invariants that HOLD (Layer 2, for the record)
Send exactly once with true outcome (tools/send_once_test.py), evidence-backed lanes
(intake_integrity_test.py, reply_derivation_test.py, view_invariant_test.py), the attribution law
(attribution_law_test.py), batch atomicity (intake_integrity_test.py I3/I4), lifecycle terminus
(lifecycle_legacy_test.py), quota counted once per delivery (send_once_test.py D6), comments stamped with
the real actor (comments_test.py), the two-tier gate at RLS (the client carries no admin literal; the
owner tier is a `console_admins` row check), and the reconstruction counter anchored at zero
(reply_child_reconstruction_test.py). Each verifies on the deployed render path, not a helper in
isolation.

---

## The proposed closure plan (awaiting ratification)

Grouped by shared root, one root per brief, ordered by blast radius. No closure brief is written before
Thyab ratifies this ledger. Unrelated findings are kept in separate briefs, never merged.

### Brief A (BLOCKER, largest blast radius): one render orchestrator, one derived model, one snapshot
Closes F1, F2, F3, F4, F5, F6, F7, F8, F16. This is the oscillation. One orchestrator owns the board's
state: it takes a single store snapshot (one authority chosen once per paint, not per accessor), passes
that snapshot through the whole derivation so `effStage` never re-reads a global mid-build (folds the
`hasReply`, `isGroupOpp`, and `bounceFor` inputs into `ctx`), reconciles the one definition of a send
(F5), serializes renders behind a generation token so the last-launched build wins and stale builds are
discarded, and every surface (board, chips, pipeline, modal, library, insights) consumes that one model.
The orchestrator also owns the board listener lifecycle (F16). The Layer 1 instrumentation stays on
through the fix as the acceptance oracle: after the fix, no two consecutive paints for one state may
DIVERGE.

### Brief B (SERIOUS): durable per-operator activity
Closes F13. Add a `console_activity` table plus a Stage-4 mirror and hydrate, so the operations ledger and
per-operator attribution reconstruct on any device, matching the mail ledger. Additive schema, run by
Thyab.

### Brief C (SERIOUS): scope per-operator prefs to their owner
Closes F15. Move `op_prefs` fully into the owner-scoped `console_profiles` (which already exists) and stop
reading and writing them on the team-shared `console_settings`. Additive; retires a legacy path.

### Brief D (SERIOUS): surface silent profile and pref write failures
Closes F18. Route the profile and pref Supabase writes through the durable queue and the diverge ledger (or
the action-runner outcome surface), so a failed save is visible and recoverable, never swallowed.

### Brief E (SERIOUS, blocked on ratification): ratify the presence model thresholds
Closes F9. Thyab rules whether the presence model is 3/10 (the code) or 30/45 (the spec text); the brief
then aligns the losing side to the winner. No change until the ruling.

### Data corrections (after the hunts): additive idempotent SQL
After Thyab runs `docs/supabase-sweep5-hunts.sql`, each non-empty hunt (F14) becomes a proposed additive
idempotent correction, one root per script, never run in this brief.

### POLISH, tracked, not freeze-gating (each its own small change, never merged together)
F10 (route the editor and offer mints through `toRecord`), F11 (remove or guard the dead `sendThreadReply`),
F12 (add a send floor to a manual reply-attach), F17 (drop the redundant `scheduleSyncPush` in `runMove`).
These are unrelated to each other and to the briefs above; each is a small independent change addressed
after the BLOCKER and SERIOUS work.

---

## The freeze

No feature brief (profiles Phase C, classification, forwarding, or anything new) is written until the
BLOCKER (F1, F2) and every SERIOUS finding (F3, F4, F5, F9, F13, F15, F18) are closed and re-verified on
device with the paint instrumentation on. The oscillation closes first.
