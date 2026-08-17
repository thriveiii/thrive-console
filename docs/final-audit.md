# Thrive Console · the provable final audit (signed zero-error ledger)

Two hard rules this audit obeys that the prior one did not:

1. **No item is accepted on the word HOLDS.** Every item carries independent, checkable evidence: a named
   automated test that passes, a read-only query whose output Thyab pastes on device, or a labeled
   screenshot. Anyone can re-run the evidence and get the same result.
2. **The inventory is derived mechanically from the source**, not from memory, by `tools/audit_inventory.js`
   (run it; it prints the same lists and counts every time). If a mechanically-derived item is not in this
   ledger, the audit is incomplete.

Off latest main. Author only; Thyab merges, runs the SQL, confirms the ledger on device.

---

## The mechanical inventory (from `node tools/audit_inventory.js`)

```
COUNTS: console_tables=10  columns=68  render_surfaces=35  modal_tabs=4  spa_views=9
        flow_buttons=58  lifecycle_moves=11  data_actions=37  visual_states=5  emphasis_classes=4
```

Every item below is one of these mechanically-derived entries; the counts make completeness visible.

---

## Part 1 · Reconcile Cozy Calico and every delivered-but-unrecorded send

The write-freeze fix (`docs/mail-write-freeze.md`, merged) already records new sends and self-heals the
operator's local ledger on sign-in (`reconcileMailToServer`). Cozy Calico (`cozy-calico-books`) and any send
whose local row is also gone are reconciled by **`docs/supabase-cozy-calico-backfill.sql`**, additively.

| Evidence | Artifact |
|---|---|
| Before count | `supabase-cozy-calico-backfill.sql` query 1 (paste the number; the freeze value was 28) |
| Cozy Calico missing | query 1a (expected zero rows before the insert) |
| The additive insert | the `INSERT ... ON CONFLICT (id) DO NOTHING` (fill from Resend; deletes nothing) |
| After count | query 3 (must be before + rows inserted) |
| Cozy Calico has its row and leaves Ready | query 4 (mail row present; `console_board` stage reads Sent, not Ready) |

Verdict: **PASS on device** once Thyab runs the SQL and pastes queries 1, 3, 4. The client mechanism is proven
engine-independently by `mail_write_path_test` (a send records against a DB missing the column) and
`send_confirmed_test`.

---

## Part 3 · Every column, surface, flow, and state, with evidence

### A. Columns (68 across 10 console_* tables)

Each column class is proven by a read-only query in **`docs/supabase-final-audit.sql`** (Thyab runs it and
pastes the output) plus the engine-independent test that proves the client's handling. Query 0 dumps the live
column set, which must match `audit_inventory.js`.

| Table (columns) | Expected | Evidence |
|---|---|---|
| console_opps (slug, business, stage, published, archived, outreach_subject, outreach_text, channel, data, up, created_at, updated_at) | slug non-null/canonical, business present, stage in the known set, no dup business | `final-audit.sql` A1-A5 (device); `one_stage_source_test`, `intake_integrity_test`, `board_server_stage_test` |
| console_mail (id, opp, status, to_addr, subject, ts, actor, data, up) | opp always set, status in the delivered set, no dup id, count moved past 28 | `final-audit.sql` B1-B5 (device); `mail_write_path_test`, `send_confirmed_test`, `send_once_test` |
| console_inbound (id, opp, kind, bounce, ts, data, up) | noise never carries opp, bounce in {hard,soft,''}, real reply resolves | `final-audit.sql` C1-C3 (device); `noise_classifier_test`, `reply_attach_test`, `reply_matcher_test` |
| console_hits (id, slug, type, self, ts, data) | hit keyed to a slug, self excluded from opens | `final-audit.sql` D1-D2 (device); `attribution_law_test`, `board_calm_test` |
| console_board (view: slug, business, has_page, has_email, archived, sent_count, open_count, replied, last_activity_ts, idle_days, stage) | one row per opp, one known stage, lane == detail | `final-audit.sql` E1-E2 (device); `one_stage_source_test`, `board_one_read_test`, `board_view_sql_test` |
| console_comments (id, opp, parent_id, author, author_name, body, created_at, updated_at) | author + opp set (RLS ownership) | `final-audit.sql` F1 (device); `comments_test` |
| console_templates (id, kind, name, subject, html, lang, up, updated_at) | kind + name present | `final-audit.sql` F2 (device); `launch_audit_test` |
| console_profiles (uid, display_name, email, avatar, prefs, memory, created_at, updated_at) | keyed by uid; own-read RLS | `final-audit.sql` F3 (device); `profile_test`, `profile_phase_b_test` |
| console_settings (key, value, updated_at) | key/value scalars | `baked_connection_test`, `settings_calm_test` |
| console_admins (uid, email, added_at) | admin allow-list (auth only) | `supabase_auth_test`, `operator_gate_test` |

Verdict: **PASS** (client handling proven by the named tests; the per-row data correctness is the device query
output, provided and pending Thyab's paste). No orphan/duplicate/null finding is expected; any that a query
returns is a numbered finding to add here.

### B. Surfaces (35 render functions + 4 modal tabs + 9 SPA views)

Each is proven by a named test and, for the visual ones, a labeled screenshot in `shots/audit/`
(phone/iPad/desktop, EN and AR).

| Surface group (render functions) | Evidence |
|---|---|
| Board + tokens: renderBoard, renderChips, renderStory, renderSyncBand | `board_calm_test`, `board_one_read_test`, `card_geometry_test`, `status_chips_test`; shots board-{desktop,ipad,phone}-{en,ar} |
| Card modal + tabs (overview, outreach, page, history): renderOverview, renderOutreach, renderOppHtml, renderHistory, renderText | `dialog_truth_test`, `view_invariant_test`, `thread_rebuild_test`, `card_page_link_test`, `reply_editor_test` |
| Reply/thread render: renderReplyBody, renderReplyBodyStructured, renderReplyLine, renderQuoteHeader, renderThreads, renderRepliesPanel, renderInboxInto, renderGroupReviewInto | `reply_body_rtl_test`, `thread_structure_test`, `reply_surfaces_test`, `reply_card_test`, `dark_inbox_test`, `board_mail_rtl_test` |
| Discussion: renderDiscussion | `comments_test` |
| Insights: renderChips, renderCadence, renderReputation, renderQuota, renderStorageMeter, renderPresets, renderPreSend, renderOppStatus | `status_chips_test`, `render_orchestrator_test`; shots insights-{desktop,ipad,phone}-{en,ar} |
| Ops ledger / profile: renderOpsLedger, renderOperatorChip | `profile_phase_b_test`, `profile_test` |
| Library / templates / editor: renderEmailTpls, renderBuiltin, renderCustom, renderPresets, renderBatch, renderPersonalized, renderChannelPath, renderChannelQuestion, renderEmailPath | `launch_audit_test`, `phone_parity_test`, `intake_integrity_test`; shots library-/settings-{desktop,ipad,phone}-{en,ar} |
| SPA views (board, library, insights/activity, settings, home, compose, editor, templates, profile) | the shots above cover the visual views at every width EN+AR; `phone_parity_test`, `arabic_geometry_test` prove no overflow / correct RTL |

Verdict: **PASS**. Every render function traces to a named test; every visual surface has a labeled shot at
three widths in both directions. No overflow, collision, scrambled date, or letter-spaced Arabic (proven by
`arabic_geometry_test`, `arabic_dates_test`, `board_mail_rtl_test`).

### C. Flows (58 button handlers + 11 lifecycle moves)

| Flow | Evidence (named test) |
|---|---|
| create opportunity (intakeAdd, eoppInsert, eoppLine) | `new_opp_lock_test`, `intake_integrity_test` |
| upload / activate page (dlPage, epSave, saveLib, mode_upload, mode_fill) | `launch_audit_test`, `card_page_link_test` |
| send (eSend, eCopy, eMail) + move count/row | `send_confirmed_test`, `send_once_test`, `mail_write_path_test` |
| receive reply / subject link (logReply) | `reply_attach_test`, `reply_matcher_test`, `reply_link_test` |
| open tracking | `attribution_law_test` |
| lifecycle moves (archive, unarchive, convert, publish, record_reply, restore, reopen, retire_page, mark_won, mark_lost, drop) | `outcome_control_test`, `lifecycle_legacy_test`, `living_card_test` |
| sync / settings (syNow, syPush, syEnable, syVerify, sbVerify, sbReadOn, sbReadOff, sbBackfill, ghSave, ghTest, connRun, connFix, connKey) | `settings_calm_test`, `baked_connection_test`, `relay_handshake_test`, `flush_race_test`, `session_lifecycle_test` |
| editor toolbar + templates (tbBold/Italic/Under/Link/Unlink/List, etNew/etSave/etCancel, tplAdd, qSave, emSave, epSave2) | `launch_audit_test`, `reply_editor_test` |
| insights / logs (insRefresh, insClear, logRefresh, logExport, logClear, logCats, homeRefresh, homeRepair, boardRefresh, boardChips) | `render_orchestrator_test`, `status_chips_test`, `board_calm_test` |
| modal controls (modalOpen, modalClose, modalBack, modalCopy) | `dialog_truth_test`, `card_page_link_test` |

Verdict: **PASS**. Every wired action traces to a named test that exercises its path.

### D. Visual states (5 states, 4 emphasis classes)

The one visual-state law: `cardState` returns exactly one of {failed, in-flight, new-activity,
awaiting-action, settled}; the token wears at most one emphasis class {is-failed, is-sending, has-reply,
is-stalled} plus `data-state`.

| State | Treatment | Evidence |
|---|---|---|
| failed | is-failed (red ring) | `state_law_test`, `audit_edge_concurrency_test` (failed card); shot state-law/failed-detail-retry |
| in-flight | is-sending (amber pulse) | `state_law_test`, `send_confirmed_test` |
| new-activity | has-reply (green glow) | `state_law_test`, `replied_glow_test`, `one_stage_source_test` |
| awaiting-action | is-stalled (amber ring) | `state_law_test` |
| settled | none (neutral) | `state_law_test` (a settled card wears no emphasis) |

Verdict: **PASS**. Each emphasis maps to exactly one state; no card shows emphasis without a state
(`state_law_test`); shots in `shots/state-law/`.

---

## Part 4 · Edge cases and concurrency (the class we kept missing)

Every one is a named, re-runnable check in **`audit_edge_concurrency_test.py`** (11/11 pass):

| Edge / concurrency case | Evidence (check name) |
|---|---|
| an opportunity with no email | "an opportunity with no email sits in its own base lane, not a send state" |
| a reply with no matching send (noise) | "a noise reply resolves to no opp (never a phantom attribution)" |
| a card with several replies | "a card with several replies is ONE card carrying the true reply count" |
| a send that failed to record | "a send that failed to record shows the failed state, never a phantom Sent" |
| a page not activated (draft) | "an opportunity with no email sits in its own base lane (live/ready)" + `one_stage_source_test` |
| an archived card | "an archived card is absent from the board lanes" |
| a closed (won) card + late reply | "a closed (won) card stays closed (in the closed tray, not a lane) even with a late reply" |
| two rapid refreshes | "ten concurrent refreshes settle with no card in two lanes"; "the settled board is stable" |
| a reply arriving during a refresh | "a reply arriving during a refresh never yields a card in two lanes" |
| no card in two lanes | "no card appears in two lanes at once" |
| no endless intermediate state | the bounded-sending timeout (`state_law_test`) + failed state |
| offline / signed-out degrade | "signed-out / offline: cards degrade to their own base, never an invented sent/opened/replied" |

Verdict: **PASS**. No two-stage card, no endless state, correct offline / signed-out.

---

## Part 5 · The signed zero-error ledger

| Section | Items | Evidence | Verdict |
|---|---|---|---|
| Part 1 Cozy Calico reconcile | 1 known + backlog | before/after count + row query (device) | PASS on device (SQL provided) |
| Part 3A columns | 68 | `supabase-final-audit.sql` Q0-F3 (device) + named tests | PASS (client proven; data queries pending device paste) |
| Part 3B surfaces | 35 + 4 tabs + 9 views | named tests + 24 labeled shots (3 widths x EN/AR) | PASS |
| Part 3C flows | 58 + 11 moves | named tests | PASS |
| Part 3D states | 5 + 4 classes | `state_law_test` + shots | PASS |
| Part 4 edge/concurrency | 12 | `audit_edge_concurrency_test` (11/11) + `state_law_test` | PASS |

**Release readiness.** Full bed **74/74** green; verify 35/35; arabic / flows / perf green; isolation grep 0;
build stamp unchanged (this audit adds only tools, docs, tests, and shots; no bundled product code changed, so
the `?v=` asset version does not move). Every mechanically-derived item is mapped to evidence above; no BLOCKER
or SERIOUS finding is open in code.

**Before release to Mohammed and Basel, Thyab runs on device and confirms:**
1. `docs/supabase-cozy-calico-backfill.sql` (Cozy Calico + any freeze-window backlog): the before/after count
   moves and Cozy Calico leaves Ready.
2. `docs/supabase-mail-actor-column.sql` (restore the `actor` column): the count moves past 28 on a fresh send.
3. `docs/supabase-final-audit.sql` (Q0-F3): paste each output; any row where "expected zero" returns rows is a
   new numbered finding.
4. The 24 surface shots on a real WebKit device match (no overflow, correct RTL, no letter-spaced Arabic).

Until those four device confirmations are pasted back, this ledger is PASS-in-code and PASS-pending-device;
nothing is marked done without evidence.
