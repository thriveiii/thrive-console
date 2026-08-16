# Thrive Console · service-readiness audit

A whole-console consistency and cleanup pass. Not a redesign: every line below is **HOLDS** (with the
evidence that proves it) or a **numbered finding** (with its fix and status). Every fix is additive,
idempotent, and audited. Author only; Thyab merges, runs the SQL, and confirms the stamp and the thread
marker on device (WebKit is the device gate; this audit proves the engine-independent facts).

Severity key: **BLOCKER** (unsafe to release) · **SERIOUS** (wrong data or broken surface) · **MINOR**
(cosmetic or cleanup). Release to Mohammed and Basel is gated on no BLOCKER or SERIOUS open.

---

## Section 0 · The History renderer question (resolved)

**HOLDS (mounted renderer named at runtime).** The card History conversation (`#modalHistory`) is
rendered by exactly one component, **`threadListHtml`**, mounted by `renderHistory`. This is proven at
runtime, not by grep: `window.threadRendererReport()` walks the open History DOM and reports that the
element holding the reply text (`"Open in Gmail"` / `"matched by the subject"`) is owned by the
`data-renderer="threadListHtml"` container, with the visible **`thread v2 · renderHistory`** marker present.
`tools/thread_rebuild_test.py` asserts all of this on the current `main` build.

- **Served artifact:** the live path is `index.html → library/console.html?v=… → library/app.js?v=…`
  (fingerprinted; `dist/thrive-console.html` is gitignored and never served). `main`'s `library/app.js`
  carries the marker and the probe (merged in #158), so the served code is the edited code.
- **Device visibility is Thyab's gate.** If the `thread v2` marker is visible on a fresh WebKit build, the
  mounted renderer is confirmed correct and any remaining visual break is a polish item (the reply-bubble
  rebuild already merged in #157). If it is **absent** on a fresh build, the cause is a stale served asset
  (deploy/cache), not a second component - the runtime probe will name whatever is actually mounted.
- **Polish gate honored:** no History-conversation polish is attempted in this PR; it waits on the device
  marker confirmation, per the brief.

Status: **HOLDS**, pending Thyab's one on-device marker check.

---

## Section 1 · Data hygiene (read-only hunts, additive fixes)

Read-only diagnostics and additive, idempotent cleanup are in **`docs/supabase-hygiene-audit.sql`**
(Part A = SELECT hunts, Part B = additive cleanup, deletes nothing).

| # | Hunt | State | Fix |
|---|---|---|---|
| S1.1 | Duplicate / non-canonical slug (`gift-gather` vs `gift-and-gather`) | **Finding, fix in flight** | Slug derivation is now deterministic (`&` → `and` in `keyOf`/`slugify`) in **PR #159**; the stored phantom is folded (archived + `reconciled_into`, deletes nothing) by `docs/supabase-slug-reconcile.sql`. Hygiene A1 lists any other `&`-dropped phantom. |
| S1.2 | `console_inbound` noise (github / google / dmarc / no-reply) surfacing as replies | **HOLDS** | `inboundIsNoise` excludes `kind=auto`, `dmarc`, `google.com`/`github.com` hosts and no-reply; `resolvedReplyOpp` returns `""` for noise so it never subject-resolves. Proven by `noise_classifier_test`. Hunt A2 confirms zero noise carries an opp; B2 unlinks any that does, leaving the row in place. |
| S1.3 | Orphans/empties (mail no-opp, opp no-business, inbound no-opp no-send) | **HOLDS / left harmless** | None surface on the board (it reads `console_board`, which requires an opp). Hunts A3a-A3c list them; **left in place as harmless** by explicit decision (Part B3). No silent delete. |
| S1.4 | Duplicate opportunities (one shop, two slugs) | **Diagnostic provided** | Hunt A4 lists same-business/different-slug pairs. Which slug is canonical is a human judgement, so the migration does not guess (B4): fold with the same audited pattern once chosen. |

Status: **no BLOCKER/SERIOUS.** S1.1 is a SERIOUS data issue whose fix is delivered in #159 (source) + the
reconcile SQL (data); it closes when Thyab merges #159 and runs the two SQL files.

---

## Section 2 · Card and lane consistency

**HOLDS.** One server-computed stage, one board read, no client re-derivation.

- Every stage traces to `console_board`; `boardViewStage` is the sole authority; `baseStage` is inert when
  the view holds a card - `board_server_stage_test`.
- One guarded view read per settle; the board never paints empty while online; no Sent 0 signed-in -
  `board_one_read_test`, `board_calm_test`.
- No card in two lanes; chips equal lane headers equal counts - asserted across the board tests.
- Geometry at phone/iPad/desktop, EN and AR, multi-line Arabic titles, everything in its box, no overflow -
  `card_geometry_test`, `arabic_geometry_test`, `board_mail_rtl_test`, `phone_parity_test`.
- **Non-issue confirmed (per the brief):** the "Basel Issa" opportunity card lives in **Draft** (an
  opportunity with no page) and Basel's **reply** lives under مدارس المدار in **Replied**. These are two
  different objects and both are correct; they are not merged.

Status: **HOLDS**, no finding.

---

## Section 3 · Surface walk (HOLDS or finding per surface)

Each surface, its proof (engine-independent), and its state. Shots for the visual surfaces are in
`shots/audit/` (phone/desktop, EN/AR where the surface has both).

| Surface | Proof | State |
|---|---|---|
| Gate | `operator_gate_test`, `supabase_auth_test` | HOLDS |
| Board | `board_calm_test`, `board_one_read_test`, `card_geometry_test`, `arabic_geometry_test` | HOLDS |
| Card · Overview / Text / Page | `dialog_truth_test`, `view_invariant_test`, `card_page_link_test` | HOLDS |
| Outreach (compose) | `send_once_test`, `thread_editor_reuse_test` | HOLDS; composer simplified in #159 (calm by default, Options reveals the rest) |
| History (conversation) | `thread_structure_test`, `thread_rebuild_test`, `reply_body_rtl_test` | Renderer confirmed (Section 0); bubble rebuild merged in #157; device marker is Thyab's gate |
| Discussion | `comments_test` | HOLDS |
| Replies inbox | `reply_card_test`, `reply_surfaces_test`, `dark_inbox_test`, `noise_classifier_test` | HOLDS |
| Insights | `status_chips_test`, `render_orchestrator_test`, `board_calm_test` | HOLDS |
| Library | `launch_audit_test`, `phone_parity_test` | HOLDS |
| Settings | `settings_calm_test`, `baked_connection_test`, `relay_handshake_test` | HOLDS |
| Profile | `profile_test`, `profile_phase_b_test` | HOLDS |
| Template review table | `batch_report_test.js`, `slug_derivation_test.js` (#159), table shots | HOLDS; one row per real shop after #159 (`organic-allure`, `gift-and-gather`, `fleurs-de-lea`) |

Status: **HOLDS**, no open surface finding (History polish gated on the device marker, not a break here).

---

## Section 4 · Dead UI and dead code removed

| # | Item | Action |
|---|---|---|
| S4.1 | `replyComposerHtml` + `.th-reply-box`/`.th-reply-*` CSS - a bare-textarea reply composer replaced long ago by the full editor in reply mode | **Removed** (this PR). One composer for one job; `replyTarget`/`replyGreeting` (its only real logic) stay and are exercised through the mounted editor and `sendThreadReply`. `reply_editor_test` updated to assert it is retired. |
| S4.2 | `.mw-hist*` history-renderer CSS fossil | Already removed in #158; only an explanatory comment remains. |
| S4.3 | A handful of `th_reply_*` i18n strings the removed composer used | **Left in place** (harmless unused strings; removing risks EN/AR parity churn for no user-visible gain). Noted, not surfaced. |

**Unsynced indicator:** accurate and drains to zero; no silent dropped write. The confirmed-write path
enqueues durably before the POST and reconciles on success/diverge - `reply_sync_durability_test`,
`ledger_drift_test`, `send_confirmed_test`, and the `perf_gate` queue-drains check.

Status: **HOLDS**, dead components removed.

---

## Section 5 · Service-readiness ledger

| Section | Verdict | Open item |
|---|---|---|
| 0 · Renderer | HOLDS | Thyab: confirm `thread v2 · renderHistory` marker on a fresh WebKit build |
| 1 · Data hygiene | No BLOCKER/SERIOUS open in code | Thyab: merge #159; run `supabase-slug-reconcile.sql` + `supabase-hygiene-audit.sql` (Part A then B) |
| 2 · Card/lane | HOLDS | - |
| 3 · Surface walk | HOLDS | - |
| 4 · Dead code | HOLDS | - |

**Release readiness:** no BLOCKER and no SERIOUS finding is open **in code on `main`**. The one SERIOUS
data issue (S1.1 duplicate slug) has its source fix in **PR #159** and its data fix in the two audited SQL
files; it closes on merge + SQL run. Everything else HOLDS. After Thyab (a) merges #159, (b) runs the
reconcile + hygiene SQL, and (c) confirms the thread marker on device, the console is ready for service to
Mohammed and Basel.

Engine-independent facts here are proven by the test bed (70/70 green) and the gates; the final glyph order
and WebKit device behaviour remain Thyab's gate.
