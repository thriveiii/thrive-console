# FOUNDATION BRIEF : three surfaces, one window. The build program.

For Claude Code, session after session, until root cutover. Thyab is the sole merge authority. English. Read this whole document before the first PR, then re-read the section for each PR before starting it.

Companion canon: `THREE_SURFACES_ONE_WINDOW.md` (settled, becomes IDENTITY.md section 13 in PR-1). Governing law: `docs/IDENTITY.md` sections 1 to 12. Governing engineering discipline: `CONSOLE_AXIOMS.md` (Axiom 3: upload never rejects for a missing field; Axiom 6: compute at the authority; Axiom 8: evidence before code, one PR one concern, Claude Code authors and Thyab merges; Axiom 9: additive SQL applied in Supabase before merge).

---

## 0. How to use this brief

**The shell, settled.** The whole program builds into the APP SHELL: `library/console.html` plus `library/app.js`, which the root `index.html` redirects to (`location.replace("./library/console.html?v="+BUILD)`), which renders the board itself (its own lanes), and which is where PRs #290 to #293 landed and were device-proven. There is a second file, `library/board.html` (a parallel board shell built from `board-*.src.js` via `tools/bundle.js`, carrying its own `drawerHtml`/`openDrawer`/`wireDrawer` and `board-send.src.js`). The root does NOT serve it. Do NOT anchor anything in `board.html`; its drawer and composer names do not exist in the app shell (verified: zero matches in `app.js`). Whether `board.html` is dead code to remove is a separate question for Thyab, out of scope here.


- One section below is one PR. Build them **in order**. Each PR is one concern. Do not fold two sections into one PR, and do not start a section before the previous one is merged and device-proven.
- Before writing a line, read the anchors listed under **Read first** for that PR. Confirm each anchor exists in the live file. If an anchor has moved or changed, stop and report; do not reconstruct from memory (Axiom 8).
- Every PR ships **both languages together**. Arabic is a primary interface, not a translation (law 7).
- Every PR runs the **Arabic gate** (section 9) and the **device proof** (section 10) before it is called done. Merged is not deployed is not device-proven.
- `app.js`, `styles.css`, `console.html` are fingerprinted into the shell. After any hand-edit, rebuild (`node tools/bundle.js`) so `?v=` and `version.json` move; the sole hand-edits must be the ones the section names, everything else is deterministic build output. Say so in the PR body.
- Report pre-existing test failures **by name**, verified to fail identically on clean `origin/main`, and never fix them inside a PR that is about something else.

## 1. What is settled (do not re-open)

- **Three surfaces and one window.** 01 Operations and Access (ruling), 02 Tasks (deciding), 03 Library (reading), and the centred window (law 3.6, 3.7). Anything else is a section inside one of them or an item in the account menu. A fourth surface requires rewriting IDENTITY.md section 2 diagnosis 1.
- **No second stylesheet.** Everything maps to `styles.css` tokens (IDENTITY.md section 11: "do not create a second stylesheet"). The `school.css` drafted earlier is withdrawn.
- **No actor colour (decision A1).** The actor signature is an avatar initial and a name. Colour stays with state (law 4.1, 4.4).
- **Performance lives on 01 (decision B).** The ruling strip carries today's four numbers; a collapsed Performance section at the bottom of 01 carries charts. No fourth surface.
- **Side strips are retired everywhere.** State is position (law 3.1). No coloured card edges, on any surface, in any language.
- **The relay is the single source of truth for sends.** The relay writes `console_mail` on Resend acceptance, keyed by the Resend id; the browser's own write merges into the same row (PR #293). Nothing in this program touches that path.
- **The approval gate.** A member uploads, activates, writes, and requests approval. A member never sends directly. The owner approves, sends, publishes, archives, deletes.
- **Numerals** are Western and set in `--font-lat`, in both languages, always (law 7).

## 2. The invariants every PR must keep

These are tested by the existing suites or by the guards each PR adds. Breaking one is a blocker.

1. **Derived, never stored** (law 3.4, gate G6). Lane, queue, badge, archive membership, usage counts, reach: all computed from `console_board`, `console_mail`, `console_inbound`, `console_hits`, `console_members`, `console_opps`. No view writes its own state.
2. **The write invariant.** Nothing reads "sent" while the server has no `console_mail` row. The "sending" and "unrecorded" states and the retry-record affordance stay exactly as they are.
3. **No lane hidden** (law 3.2). On any viewport the board scrolls horizontally; nothing collapses a lane.
4. **One window, borrowed nodes** (law 3.6, 3.7). The editor and the composer are moved into the window, never copied. A view handed to the window is reset to its boot markup before its init runs again.
5. **Context never breaks** (section 2 diagnosis 4). Switching surfaces keeps each surface's scroll. Opening the window from a surface returns to that surface at that scroll.
6. **The containment model** (styles.css): `html` and `body` clip horizontally, `.wrap` sets the equal margins, `.board` is the one element allowed to scroll horizontally.
7. **Transform and opacity only** for motion (law 8, gate G7), on the existing `--t-*` and `--e-*` scale.
8. **Three weights, existing radii** (law 5, gate G2).
9. **Colour has meaning** (law 4.1). No new colour without a row in the section 4 table in the same PR. Under A1, this program adds none.
10. **The Arabic law** (law 7) in full: logical properties, `--dir`, the weight map, isolated numerals, Gulf MSA copy, directional glyphs flip, no letter-spacing on Arabic.

## 3. The shared vocabulary (so PRs agree)

- **Surface**: one of 01, 02, 03. Selected by the segmented control; reflected in the URL hash `#ops`, `#tasks`, `#library`.
- **The window**: the centred opportunity workspace, law 3.6. Tabs in this order: Overview, Text, Page, Outreach, History. Below 720px it is a bottom sheet, same header, same tabs.
- **Reason**: why a row is in 02. Exactly five, in priority order: `reply_waiting`, `approval_requested`, `cannot_send`, `stalled`, `awaiting_activation`.
- **Actor**: the person who performed an action, resolved from `console_members` by uid. Rendered as `actorSig(uid)`: an avatar initial and a display name. Never a colour.
- **Signed**: a card, feed row, or activity line that carries its actor.
- **Ruling strip**: the one line of four numbers at the top of 01: sends today of 100, sends this month of 1000, replies waiting, stalled. Each is a link into 02.
- **Account menu**: Profile, Admin, Sign out (and Refresh if it stays manual). Demoted, never in the segmented control.

## 4. PR-1 : the window (law 3.6 and 3.7), and the canon amendment

**Concern.** The opportunity drawer becomes the centred window. This is already law (IDENTITY.md section 11 pre-decided it on August 2, 2026: "an edge panel is for one action; a centred window is for a workspace"). It is built first because it is the spine every surface opens.

**Read first.**
- `docs/IDENTITY.md` section 3.6 and 3.7 (the exact dimensions, the tab names, the borrowing rule) and section 11 (the drawer rule).
- `library/console.html`: the opportunity drawer markup (search the panel that renders SIGNALS, PRESENCE, MESSAGE, HOSTED PAGE, RECIPIENT EMAIL, ACTIONS, REPLY CONVERSATION, RECORD, NOTES, ACTIVITY; it is the surface shown in every "card" screenshot). Also the existing `modal-panel` nodes near lines 1287 to 1291: read what modal infrastructure already exists before adding any.
- `library/app.js` (the app shell, NOT board.html): the app shell generates its card-detail surface in JS. Find the live card-detail opener by evidence, not by the board-shell names (`drawerHtml`/`openDrawer`/`wireDrawer` do not exist here). Confirmed app-shell anchors: `buildOppPreview` and the `oppBar` nodes (`eoppbar`, `eopptext`, `eoppstatus`, `eoppPreview`) for the page preview and insert-link bar; `renderOppHtml` (renders the hosted opp page for preview/print); `composeState`, `preSendChecks`, `syncSendState` and the `eSend` handler (the composer the window borrows); `unrecordedNotice` and `cardUnrecorded` (the failed-send banner the window keeps). **Locate the actual card-detail drawer (the SIGNALS / PRESENCE / MESSAGE / HOSTED PAGE / RECIPIENT / ACTIONS / REPLY CONVERSATION / ACTIVITY panel) in `app.js` by reading it before you retire it.** If that panel cannot be found generated by `app.js` and appears to come from `board.html`, STOP and report: that would mean the live shell is not the app shell and the whole target must be re-decided first (Axiom 8).
- `library/i18n.js`: the keys for the drawer sections and actions; add the five tab keys in both languages (nouns, law 3.6).
- `library/styles.css`: `--panel`, `--panel-2`, `--el-modal`, `--t-page`, `--e-enter`, `--e-exit`, the `.modal-panel` rules if any.

**The change.**
- One component, `#oppWindow`: `min(920px, 92vw)` wide, `max-height 88vh`, equal margins, over a dimmed and blurred backdrop, header and tab strip fixed, only the body scrolls. Below `720px` the same component becomes a full-height bottom sheet (two sets of values, one component; law 3.6).
- Tabs: **Overview** (signals, presence, hosted page status, recipient, the role-gated actions, notes), **Text** (the borrowed composer: subject, body, recipient, signature, the exact-send preview), **Page** (the wide in-place preview of the hosted page in an iframe, `Widen`, and `Open full page` in a new tab; reuse `buildOppPreview`'s iframe, promoted from the insert-link bar to a tab), **Outreach** (the conversation: replies first, newest first, quoted history folded under a disclosure, `View as email` renders the message as an email client shows it, then the reply composer), **History** (the signed activity line: every event with its actor and time; opens deduplicated per recipient per the existing rule; self views excluded).
- **Borrowing** (law 3.7): the editor and composer nodes are moved into the window on open and returned on close; the view is reset to its boot markup before its init runs again; never two copies, never two listeners.
- **Role-gated actions** on Overview: owner sees Send, Approve and move to Ready, Archive, Delete; member sees Activate page, Request approval, Add justification, Archive. Gate by `currentActor()` role from `console_members`. This is the approval gate made visible; the server-side approval write (`approved_at`, `approved_by`) is unchanged.
- **Reply-first.** When the opportunity has an unanswered reply, the window opens on Outreach, with a one-line notice at the top of Overview too.
- **The failed-send banner** (`unrecordedNotice`) renders inside Overview unchanged, with its retry-record button.
- Opening the window from a card returns to the board at the same scroll on close (invariant 5).
- The drawer is retired: its markup removed, its open path redirected to the window. No dead code left behind.

**Canon amendment in this PR.** Append `THREE_SURFACES_ONE_WINDOW.md` as section 13 of `docs/IDENTITY.md`, verbatim, under the section 12 protocol. Add one line to section 3.6's rationale noting the tab-open rule for 02 (a Tasks row opens the window on the tab that matches its reason).

**Scope held.** No change to the board lanes, to the top bar, to sends, to the relay, to SQL. Tasks, Library, Access, the strip: later PRs.

**Tests.** A fails-when-broken source guard: the window component exists with the five tabs in order; the drawer markup is gone; the composer is moved not cloned (assert a single `#eSend` in the DOM after open and after close); the bottom-sheet rule below 720px; role gating renders the two action sets by role. Playwright: open a card at 1180 and at 390, both languages; assert the window at 1180 and the sheet at 390; assert only the body scrolls. Existing gates: `app_entry`, `library_publish`, `library_upload`, `send_confirmed`, `delivery_truth`, the mail guards from #292 and #293.

**Arabic gate** (section 9) and **device proof** (section 10), both languages, iPad and phone, owner and member.

## 5. PR-2 : the top bar, the segmented three, the account menu

**Concern.** Seven equal doors become three weighted surfaces and one demoted menu (section 2 diagnosis 1). The surfaces themselves are wired as empty-but-real destinations here; their content lands in PR-3 to PR-6.

**Read first.**
- `library/console.html`: the current top bar (the row with New message, Upload campaign, Library, Admin, Profile, Refresh, Sign out, the language switch, the quota text).
- `library/app.js`: the handlers behind each of those seven links; the language switch (it must set `dir` and `lang` on `<html>`, confirm it does, fix in this PR if it does not, because every Arabic rule keys off `[dir="rtl"]`); the view router if one exists; `syncQuota` or the equivalent that renders "n / 100 today".
- `library/styles.css`: `--panel-2`, `--t-base`, `--e-standard`, `--dir`, `--font-lat`, the `.wrap` margins.

**The change.**
- Top bar, in order: the Thrive mark (`./assets/thrive-logo.png`, the repo asset, never drawn), the segmented control `01 Operations and Access | 02 Tasks | 03 Library` with a sliding indicator (transform only), the quota pill, the language switch, the account menu (Profile, Admin, Sign out, and Refresh if it stays manual).
- Segment labels carry an architectural number in `--font-lat` and the name; the number is Western always. On narrow screens the control wraps into rows rather than scrolling, and the indicator moves in both axes.
- Surface switch: crossfade on `--t-base` `--e-standard`, opacity and transform only; each surface keeps its own scroll; the URL hash reflects the surface; refresh and back restore it.
- **Upload** and **New message** leave the top bar and become the two actions at the top of 01's board: Upload carries the gradient (the one primary action per screen, law 4.2), New message is secondary weight.
- Library moves to 03. Admin, Profile, Sign out move to the account menu.
- The Tasks segment shows a badge with the derived needs-me count (computed by the same function PR-3 will use; land the function here with the count only).

**Scope held.** 02 and 03 render their frames and their empty states only. No queue logic, no library content yet.

**Tests.** Source guard: exactly three segments; no top-bar link for Upload, New message, Library, Admin, Profile; the account menu holds the three demoted items; the hash router maps three surfaces. Playwright: switch surfaces, assert scroll preserved per surface, assert the hash, assert RTL mirroring of the control and the Western numerals in the segment labels.

## 6. PR-3 : 02 Tasks, the derived queue

**Concern.** The deciding surface: what needs me now.

**Read first.**
- `THREE_SURFACES_ONE_WINDOW.md` section 4 (the five reasons, their priority, the tab each opens).
- `library/app.js`: how the board reads `console_board` (the hydrate around `S.rest("console_board", ...)`), `cardUnrecorded`, the stall computation (`--stall-days` and wherever "days idle" is derived), the approval fields (`approved_at`, `approved_by`, the request-approval flag from Slice 1B if present), the reply attribution (`console_inbound` rows joined to the opp and whether a reply has been answered).
- `library/i18n.js`: add the five reason phrases in both languages, Gulf MSA in Arabic («رد بانتظارك», «طُلبت الموافقة», «لا يمكن الإرسال», «متوقّف», «بانتظار التفعيل»).

**The change.**
- `needsMe(store, actor)` returns the ordered queue: reason, opp, actor who created it, age, primary action. Pure function of the store plus the current actor's role and ownership. Nothing stored.
- Role-aware: owner sees approvals, replies, stalled across everything; member sees their own drafts needing a recipient or activation, and replies on cards they operate.
- Each row opens the window (PR-1) on the tab matching its reason: `reply_waiting` on Outreach, `cannot_send` on Text, `awaiting_activation` on Page, `approval_requested` and `stalled` on Overview.
- The badge from PR-2 reads `needsMe(...).length`.
- Empty state: one sentence, «لا شيء يحتاجك الآن» / "Nothing needs you right now".
- The ruling strip numbers (PR-6) will link into 02 filtered by reason; expose `#tasks?reason=...` now so the links have a target.

**Tests.** A pure-function test for `needsMe` with fixtures for each reason, each role, ordering, and the empty case (fails when broken). Playwright: a seeded reply-waiting card appears at the top of 02; selecting it opens the window on Outreach; answering removes the row without any write to a "done" flag.

## 7. PR-4 : 01 Access, the signed feed, and card signatures

**Concern.** Who may act, and the accountability trail. No operation is anonymous.

**Read first.**
- `library/app.js`: `console_members` read (the roster around the `id, name, email, role, active` mapping), `currentActor()`, the activity log (`logActivity` and its render), `supaMailRow` (the `actor` column), `writeImport` (where `created_by` is recorded), the board card render (where a signature will be added).
- `THREE_SURFACES_ONE_WINDOW.md` section 3.

**The change.**
- `actorSig(uid)`: resolves a uid through `console_members` to an initial and a display name; renders an avatar initial and the name. Under A1 it uses no colour. Unknown uid renders as an empty signature, never a guess.
- Every board card carries `actorSig(created_by)`. Every feed row and every History line in the window carries the actor of the action.
- **Access** section on 01: each member with role, what the role may do (owner: approve, publish, archive, delete; member: upload, activate, write, request approval), active flag, and their count of actions today (derived from `console_mail.actor` and the activity log).
- **The signed operations feed** on 01: the last N actions across the pipeline as prose rows that wrap at spaces, each with actor, verb, opportunity, time.

**Tests.** `actorSig` unit test (owner, member, unknown, Arabic display name). Source guard: no colour token is introduced for actors; cards render the signature; the feed rows are `.row-prose`-style flex rows with a wrapping sentence span so names never split mid-word (the defect seen on phone in the mockups).

## 8. PR-5 : 03 Library, templates and the operations archive

**Concern.** The reading surface: what do I have, what did I do. Two sub-views, never mixed.

**Read first.**
- `library/app.js`: the current Library view and its handlers (templates list, if any), the archived filter over opps, the archive/restore write (`archived` on `console_opps`), the R13 restore-or-import-as-new decision in `writeImport` (`it.decision`), the closed tray render (law 3.3).
- The kit templates in the repo (`en-opp1`, `ar-opp1`) and how a template is chosen at upload.

**The change.**
- Sub-view switch under one control: Templates | Operations archive.
- **Templates**: one card per template: name, language and direction, a live thumbnail (iframe, sandboxed), usage count derived from `console_opps`, and three actions: Preview (wide, in place), Open full (new tab), Use (starts Upload with that template). Owner adds and retires; members use.
- **Operations archive**: a dense list (law 9) of archived, won, lost, bounced opportunities; search by business, person, outcome, date; columns business, operated by (`actorSig`), outcome, signals (sends, opens, replies), closed date. Opening a row opens the window read-only on History. Restore is the only write; it clears `archived` and returns the card to the board, signed.
- The closed tray on the board (law 3.3) keeps its counts and links into this archive.

**Tests.** Source guard: two sub-views, no send action anywhere in 03, Restore writes only `archived`. Playwright: archive a card on 01, find it on 03, restore it, see it back on 01, all in both languages.

## 9. PR-6 : the ruling strip and the collapsed Performance section on 01 (decision B)

**Concern.** The home rules instead of reporting (section 2 diagnosis 2), and performance stays off the board (law 3.5).

**Read first.**
- `library/app.js`: the quota render, the counts the board already computes per lane, the stall computation, `needsMe` (PR-3).
- IDENTITY.md section 11 ("Charts: not on the board... the Overview surface").

**The change.**
- The ruling strip at the top of 01: sends today of 100, sends this month of 1000, replies waiting, stalled. Each number links into `#tasks?reason=...`. One line, `--fs-sm`, no chart.
- A collapsed **Performance** section at the bottom of 01, closed by default, opened on demand: sends, opens, replies over time, by week, derived from `console_mail`, `console_hits`, `console_inbound`. Charts render inside the section only; never on the board (law 3.5). Opens are deduplicated per recipient and self views excluded, matching the existing rule.
- The old Overview page, if it still exists as a separate view, is retired into this section. No fourth surface.

**Tests.** Source guard: no chart node inside `.board`; the strip has exactly four numbers each linking into 02; the section is collapsed by default. Playwright: the strip numbers equal the derived counts.

## 10. PR-7 : the seven-door residue and the relapse guard

**Concern.** Retire what the three surfaces replaced, and write the guard.

**Read first.** Every view or panel that PR-2 to PR-6 superseded: the old Overview page, the old Library view, any Activity page, the old drawer remnants, unused i18n keys, unused CSS.

**The change.**
- Remove superseded views, their routes, their i18n keys, their CSS. Refresh becomes automatic if the store already syncs; otherwise it stays as an account-menu item.
- Add a source guard that fails if a fourth top-level surface, a second segmented control, or a new top-bar link outside the account menu is ever added. The guard cites IDENTITY.md section 13.
- Update `docs/IDENTITY.md` section 2 diagnosis 1 with a one-line note that the top bar was reduced to three surfaces plus a menu on the date of this PR.

**Tests.** The relapse guard itself, plus the full gate set.

## 11. The Arabic gate (run for every PR, on device and in Playwright)

Run at 390, 820, 1180, 1366 in both `dir="ltr"` and `dir="rtl"`:

1. No Eastern numerals anywhere in rendered text (U+0660 to U+0669): zero.
2. No Arabic text node with computed `letter-spacing` other than normal: zero.
3. Every digit renders through `--font-lat` (Lato), never through the Arabic face.
4. Directional glyphs (send, reply, external, chevron) are mirrored in RTL; symmetric glyphs are not.
5. The segmented control, the window, the sheet, the feed rows, and the archive list mirror with logical properties; nothing is positioned by `left` or `right`.
6. Copy reads as Gulf MSA («سنرسل», «لديك», «رد بانتظارك»), never dialect in the UI and never English wearing Arabic.
7. Nothing overflows the viewport, no button wraps its own label, no name splits mid-word (assert `document.documentElement.scrollWidth <= innerWidth`, buttons under 44px tall, and `.sig` nowrap).

The mockup QA harness (`qa.py`, five widths, overflow and wrapped-button checks) is the model; port it into `tools/` as a Playwright test in PR-1 and extend it per PR.

## 12. The device proof (run for every PR, before it is called done)

Owner (Thyab) and member (Basel), iPad and phone, English and Arabic. Use real or neutral recipients only; never a personal Gmail (sender reputation).

- PR-1: open a card at 1180 (window) and 390 (sheet), both languages, both roles; the actions differ by role; the composer sends once and records once; the reply thread reads newest-first with quoted history folded; Open full page opens the hosted page.
- PR-2: the top bar shows three segments and a menu; switching keeps scroll; the hash restores after refresh; RTL mirrors the control.
- PR-3: a seeded reply appears at the top of 02; opening it lands on Outreach; answering clears it; the badge counts.
- PR-4: every card and feed row is signed with the right person; Access lists the three people with the right reach.
- PR-5: a template previews and opens full; archive, search, restore round-trips a card.
- PR-6: the four numbers match the board; the Performance section is collapsed by default and charts never appear on the board.
- PR-7: the removed views are unreachable; the guard test passes.

## 13. What must not happen (the guardrails)

- No second stylesheet. No new colour without a section 4 row. No actor colour. No side strips.
- No stored view state, no "done" flags on Tasks, no per-view caches that can drift.
- No copying the composer or the editor. Borrow and return.
- No hiding a lane, no hiding a button, no truncating a label to make a layout fit; scroll instead (law 3.2, gate G5).
- No layout-property animation. No new durations or easings.
- No touching the relay send path, `mailUpsert`, `supaConfirmMail`, `relaySend`, or `writeImport`'s stage-first order. They are proven and settled.
- No new top-bar link. No fourth surface.
- No inline base64 fonts into the shell; fonts stay self-hosted in `fonts.css`.
- No em dash in any copy, any language. Straight quotes in English, guillemets in Arabic. Western numerals.

## 14. Definition of done for the program (root cutover readiness)

Root cutover (`console.thriveiii.com` serves the new shell) happens only when all of these are true on device, both roles, both languages, iPad and phone:

1. PR-1 to PR-7 merged, each device-proven at the time of its merge.
2. The full pipeline smoke test (`SMOKE_TEST_CHECKLIST.md`) passes end to end on the new shell: upload, activate, write, request, approve, send (one `console_mail` row, Resend id, actor set), third-party open, reply, archive, restore.
3. The Arabic gate passes on the whole shell at all four widths.
4. The relapse guard passes.
5. `docs/IDENTITY.md` carries section 13 and the diagnosis 1 note, and every decision made along the way was written down with its reason.
6. Thyab has used the new shell for one full working day as owner, and Basel for one as member, with no report of a lost card, a lost send, or a hidden lane.

Then the old surface is retired and the root points at the new shell. That is the end of this program and the start of the next one.
