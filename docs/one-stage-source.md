# Thrive Console · one source of stage everywhere, zero drift

A structural fix and a full reconciliation. Every line below is **HOLDS** (with the evidence that proves
it) or a **numbered finding** (with its fix and status). Every fix is additive and idempotent; no row is
deleted and no stage is overwritten. Author only; Thyab merges, runs the SQL, and confirms the stamp on
device (WebKit is the device gate; this proves the engine-independent facts).

Severity key: **BLOCKER** (unsafe to release) · **SERIOUS** (a card shows two different stages) · **MINOR**
(cosmetic or data completeness). Release is gated on no BLOCKER or SERIOUS open.

---

## The root, proven

Ludic Lillian is in the manifest (`library/manifest.json`) and renders as a card, but it has **no row in
console_opps**, so it has **no row in console_board** either. Two facts of the code make this a contradiction
before this PR:

- **The board** reads one authority. `laneOf` (stage-model.js) delegates to `hostEffStage`, which delegates
  to `boardViewStage`: the view's stage for a card it holds, else the record's own base. For Ludic (absent
  from the view) that base is **ready** (`isLive` is true for any manifest card: `!o._local || o.published`).
- **The card detail** read a *second* source. `renderOverview` (the State row), the modal header pill, and
  the closed-reply check each called **`effStage`**, a client re-derivation over the local mail, hits and
  inbound stores. With a local open and a local reply on Ludic's slug, `effStage` returned **opened** or
  **replied**.

So the same card read **ready** on the board and **opened / replied** in its detail. This was not specific
to Ludic: it was the structural gap in "list from the manifest, stage from the view" for **any** manifest
card the view does not hold.

---

## Section 2 · One stage source (the structural fix)

**HOLDS.** There is now exactly one stage authority, read on every operator-facing surface.

- **`resolvedStage(o)` -> `boardViewStage(o)`** is the single resolver (app.js). The board already routed
  through it (`laneOf` -> `hostEffStage` -> `boardViewStage`); the detail now does too.
- The three detail-stage reads are routed through it: the Overview **State row** (`renderOverview`), the
  modal **header pill** (`stamp`), and the **closed-reply** reopen check (`closedReplyNotice`). None reads
  `effStage` any longer, so the badge the operator reads in the modal is the same stage the board lane read.
- A card absent from the view renders **draft or ready** from its own `has_page` / `has_email` in **both**
  places, the same answer; it reads no opened / sent / replied from a second store.
- The board card's **reply glow** and **reply-count badge** are gated on the resolved lane (`tk.lane` is not
  draft or live), so a card the board calls ready never wears a reply decoration the lane denies.
- `effStage` (the local derivation) is retained only where it is not the operator's read of *this card's*
  board stage: the standalone reference page (which has no `boardViewStage`), the manifest export
  (`manifestStatusFor`), the follow-up predicate, the insights / library grid filter, and the group / chapter
  logic. Those are separate axes, not the board-vs-detail stage.

**Evidence:** `one_stage_source_test.py` seeds the exact Ludic case (a manifest card with a local send, open
and reply, absent from the view) and asserts the board lane and BOTH detail badges resolve to the same
string; it also proves the reply glow and badge are absent on the ready card, and that ten refreshes never
oscillate. Fails-when-broken: routing the Overview back through `effStage` reds the agreement checks (the
detail reads `replied` while the lane reads `live`).

Status: **HOLDS**, no BLOCKER or SERIOUS open in code.

---

## Section 1 · Three-way reconciliation (read-only, every mismatch reported)

`tools/reconcile.js` joins **manifest vs console_opps vs console_board** by slug (read-only, never writes).
`docs/supabase-stage-reconcile.sql` carries the DB-side hunts (Part A) and the additive fixes (Part B).

| # | Mismatch class | State | Fix |
|---|---|---|---|
| S1.1 | Manifest card missing from console_opps (**Ludic**) | **Finding (SERIOUS data), fix delivered** | The client fix already makes both surfaces agree (ready everywhere) with no data change. For completeness, Part B1 additively inserts `ludic-lillian` into console_opps (decision stated: it is a real opportunity, so it belongs in the view) `on conflict do nothing`, so the view carries it and computes its true stage. Deletes nothing. |
| S1.2 | console_opps row missing from console_board | **HOLDS by construction** | The view is `from console_opps o` with LEFT JOINs, so it emits exactly one board row per opps row: 1:1, an opps row can never be dropped. Part A1 / A2 confirm it read-only on a snapshot. |
| S1.3 | Slug differs in form between sources (gift-gather / Madar-school class) | **Finding (MINOR), diagnostic provided** | `reconcile.js` flags the Arabic school slug (`مدرسة-المدار-الدولية` for business `مدارس المدار الدولية`) for hand verification; Part A3 lists any `&`-dropped or non-canonical slug in console_opps. Which slug is canonical is a human judgement (Part B3): fold additively with the `slug-reconcile.sql` pattern once chosen. |
| S1.4 | Duplicate opportunities (one shop, two slugs) | **Diagnostic provided** | Part A4 lists same-business / different-slug pairs. The migration never guesses which is canonical (Part B2 / B3). |
| S1.5 | Orphans / empties | **HOLDS / left harmless** | Covered by `docs/supabase-hygiene-audit.sql` (mail no-opp, inbound no-opp). None surfaces on the board (it reads console_board, which requires an opp). Left in place; no silent delete. |

Manifest census (16 cards) is printed by `reconcile.js`; the only manifest-only anomaly is the Arabic school
slug (S1.3). Run `reconcile.js --opps opps.json --board board.json` with exported snapshots to enumerate the
missing-from-opps set precisely; Ludic is the known instance.

Status: **no BLOCKER.** S1.1 is the one SERIOUS data issue; its structural fix is in code and its data fix is
the additive SQL. It closes when Thyab runs `supabase-stage-reconcile.sql`.

---

## Section 3 · Full column and flow audit (HOLDS or finding)

| Table / flow | Check | State (evidence) |
|---|---|---|
| console_opps | slug canonical, no empty stage relied on (a bare `status:"sent"` is not a send) | HOLDS `intake_integrity_test`, `lifecycle_legacy_test` |
| console_mail | opp set, one status semantics, no empty opp on new writes | HOLDS `send_confirmed_test`, `send_once_test` |
| console_inbound | opp set on real replies, noise unlinked, subject-match link consistent | HOLDS `noise_classifier_test`, `reply_attach_test` |
| console_board | one row per real opp, stage total and monotonic, counts correct | HOLDS `board_one_read_test`, `board_calm_test` |
| Flow · create opportunity | new draft -> Draft lane, stage from the one source | HOLDS `new_opp_lock_test` |
| Flow · upload / activate page | page committed -> Ready, both surfaces read it | HOLDS `activate_regression`, `card_page_link_test` |
| Flow · send (confirmed write) | send -> Sent only on server confirm; else sending | HOLDS `send_confirmed_test`, `send_once_test` |
| Flow · receive reply (subject link) | reply resolves to its opp -> Replied lane | HOLDS `reply_attach_test`, `reply_surfaces_test` |
| Flow · open tracking | open after a send -> Opened (send-gated) | HOLDS `attribution_law_test`, `board_calm_test` |
| Flow · archive | archived card leaves the lanes | HOLDS `living_card_test` |
| Flow · close won / lost | terminus stands in both surfaces (declared wins) | HOLDS `outcome_control_test`, `lifecycle_legacy_test` |
| Board lane == detail state | the same resolved stage on both | HOLDS **`one_stage_source_test`** (this PR) |

Each flow moves the card through the correct lanes with the stage read from the one source; the bed runs each
and confirms. No open surface finding.

Status: **HOLDS.**

---

## Section 4 · Zero-error ledger

| Section | Verdict | Open item |
|---|---|---|
| 1 · Reconciliation | No BLOCKER; one SERIOUS data issue with its fix delivered | Thyab: run `supabase-stage-reconcile.sql` (Part A to see, then B1); optionally `reconcile.js` with snapshots |
| 2 · One stage source | HOLDS | Thyab: confirm the card State on device matches the board lane |
| 3 · Column / flow audit | HOLDS | - |
| Chips == headers == counts, 10 refreshes, EN + AR | HOLDS | `board_calm_test`, `board_one_read_test`, `one_stage_source_test` (10-refresh stability) |
| No card in two lanes / no lane-vs-detail disagreement | HOLDS | `one_stage_source_test` |

**Release readiness:** no BLOCKER and no SERIOUS finding is open **in code**. The one SERIOUS data issue
(S1.1, Ludic absent from console_opps) is reconciled at read time by the client fix today, and its data fix is
the additive SQL. After Thyab (a) merges this PR, (b) runs `supabase-stage-reconcile.sql`, and (c) confirms on
device that each card's detail State matches its board lane, the console meets the zero-error ledger.

Engine-independent facts here are proven by the test bed (71/71 green) and the gates; the final glyph order and
WebKit device behaviour remain Thyab's gate.
