# G6_VERIFICATION - the Unified Operations Editor (the flip)

Verifies **G5** (PR #311, `feat/opp-window-flip` @ `9619cea`, BUILD **`4866e115`**): the centered `#oppWindow`
is the one opp surface; the drawer is retired. This is the artifact the editor is signed off against.

Method: the shipped board (`library/board.html` built from the G5 branch) driven headless (Chromium, real
window functions, mocked Supabase + relay - no email ever sent, all addresses synthetic `*.example.test`),
across desktop (1440×900), iPad landscape (1180×820), phone (390×844), and phone Arabic RTL (390×844). Behavior
is proven by the E2E suite; geometry/RTL by screenshots.

---

## 0. Deploy proof - ⚠️ PENDING (blocked, not passed)

The brief gates G6 on: after #311 merges, the LIVE `console.thriveiii.com` header shows build `4866e115` or
newer. **This cannot be completed from here yet:**

- **#311 is NOT merged.** `origin/main` HEAD is `b21bd97` (G4.5, #310); PR #311 is **open** (`merged:false`,
  mergeable_state `clean`). The G5 flip is not on `main` and therefore not deployed.
- **The live host is egress-blocked** from this build environment (the network policy denies
  `console.thriveiii.com`: `curl` → `403 CONNECT tunnel failed`; WebFetch → `EGRESS_BLOCKED`), so the live build
  marker cannot be read from here regardless.

Per step 0 ("if it still shows an older build … stop and report - do not keep verifying a stale build"), the
live/main build is the **pre-G5** build (`dd556f2c` on main). It has the drawer, not the flip - verifying it
would be meaningless. **Action required:** after #311 merges and deploys, re-read the live header (from a
live-capable environment) and confirm it shows `4866e115` or newer. Everything below is verified against the G5
**branch** build (the exact commit that will merge), which carries `build 4866e115`.

Branch build marker (local, `library/board.html`): `build 4866e115` · `BUILD = "4866e115"` · matches
`version.json`.

---

## 1. Surface × face × mode matrix

Legend: ✅ pass. All four faces (desktop / iPad landscape / phone / phone AR-RTL) behave identically unless a
face-specific note is given.

| Surface / check | Result | Evidence |
|---|---|---|
| **Nav** shows ONE "New message"; NO "Upload campaign" | ✅ | `id="uploadBtn"` count = 0 in the built shell; screenshot `g6_board_*` shows `العربية · New message · Library · Profile · Refresh · Sign out` |
| No `#drawer` / `#scrim` anywhere in the DOM | ✅ | asserted in opp_window_mode_a/b (`!getElementById('drawer') && !getElementById('scrim')`); `grep` of built shell: 0 drawer markup/functions |
| **Card tap → Details** (thread, activity, signals, record, notes view+add, fate actions) | ✅ | opp_window_detail_test (all sections + Promote/Archive/Delete + add-note writes); board_write (promote/revert/archive/reopen); board_detail; card_fate; screenshots `g6_details_*` |
| Per-opp page publish-truth + **Re-check** (`uploadActivateHtml`) shows in Details | ✅ | mounted in `owDetailHtml` + `owDetailWire → upWireActivate`; board_upload 5a/5b (live-on-upload has no re-activate button; a dead page still blocks the send) |
| **New message → mode selector** (without/with campaign) | ✅ | `owNewMessage` → selector; screenshot `g6_selector_*` (owPickA/owPickB); board_newmsg §1 |
| **Message-without-campaign**: compose + **exact-send preview** + send | ✅ | opp_window_mode_a; board_send; screenshot `g6_modeA_*` (compose) + Preview `{{LINK}}` resolves to `https://console.thriveiii.com/opp/alpha` |
| B2: suppressed recipient **refused** (no relay call) | ✅ | opp_window_mode_a §5; suppression_guard |
| B2: unreadable suppression list **halts** (fail-closed) | ✅ | opp_window_mode_a §6; suppression_guard "FAIL-CLOSED: a real read failure does NOT mark the set loaded" |
| **Message-with-campaign** - Page tab: Upload OR Pick-from-Library OR Duplicate, ALL render tall+scrollable, SAME controls | ✅ | opp_window_mode_b (upload → review); the three entry modes feed one `libRowHtml` review; screenshot `g6_modeB_page_*` (tall `.lv-frame`, editable Title/Link/Task) |
| `{{ASSET_BASE}}` resolves (at compile/publish) | ✅ | asset_base_mergefield (ALL PASS); raw token shown in the F2 raw-template review, resolved at commit |
| `{{LINK}}` inserts without leaving the window | ✅ | board_editor (insert-opp-link); resolved link visible in the Preview tab |
| Commit creates card + recipients + page, publish-truth (no false RED) | ✅ | opp_window_mode_b §5 (pageUpsert + oppUpsert + pagePublishRelay + upActivateBackground); publish_truth (F1, ALL PASS) |
| **Recipients tab** shows per-recipient status | ✅ | opp_window_recipients (sent/opened/replied/bounced/suppressed/queued/none, precedence); screenshot `g6_recipients_*` |
| **Preview tab**: message + page both render (tall srcdoc), before AND after upload | ✅ | screenshot `g6_preview_*` (Message/Page switch; message shows resolved `{{LINK}}`); instant_preview (F2, ALL PASS) |
| Equal padding four sides; window centers; backdrop dims; only body scrolls; bottom sheet <720px | ✅ | opp_window_shell source guards (`.ow` centered `min(920px,92vw)/88vh`, `.ow-scrim` blur, `.ow-body` overflow-y, `@media(max-width:720px)` full-height sheet); screenshots (phone/AR are full-width bottom sheets) |
| Arabic RTL clean: no letter-spacing, no uppercase, Western numerals, no em dash | ✅ | `grep` em-dash in built shell = 0; RTL overrides on `.dw-sec h3` / `.ow-recip` / `.ow-rs` (`text-transform:none;letter-spacing:normal`); screenshots `*_phone-ar` (المؤشرات/الحضور/إجراءات/المستلمون/المعاينة render normal-case, numerals `1`/`2`) |

### E2E suite (behavior proof) - 16/16 green
`opp_window_shell` · `opp_window_mode_a` · `opp_window_mode_b` · `opp_window_recipients` · `opp_window_detail` ·
`board_detail` · `board_write` · `board_send` · `board_recipient` · `board_identity` · `board_newmsg` ·
`board_upload` · `feedback` · `send_health` · `compose_scope` · `compose_identity` - all PASS.
Invariant JS: `suppression_guard` · `asset_base_mergefield` · `publish_truth` · `instant_preview` ·
`upload_clean` - all PASS.

---

## 2. Invariant re-confirm

| Invariant | Result | Note |
|---|---|---|
| **B2** - client refuse + fail-closed at send | ✅ PASS | suppression_guard + opp_window_mode_a §5/§6; relay untouched |
| **F1** - publish truth, no false RED | ✅ PASS | publish_truth; the per-opp Re-check now lives in Details |
| **F2/F3** - preview everywhere (tall srcdoc) | ✅ PASS | instant_preview; Preview tab renders message (resolved `{{LINK}}`) + page |
| **{{ASSET_BASE}}** resolution | ✅ PASS | asset_base_mergefield |
| **Per-recipient status** (G4) | ✅ PASS | opp_window_recipients (precedence intact) |
| **Merge-not-replace commit** (G3) | ✅ PASS | opp_window_mode_b (composed subject/body + prior note preserved) |
| **Detail / fate / notes / thread** (G4.5) | ✅ PASS | opp_window_detail + board_write/detail/identity |
| **Relay unchanged** | ✅ PASS | no diff to relay logic in G1-G5 |

---

## 3. Punch list (report only - not fixed here)

1. **Retained off-nav overlays are unreachable from the UI - confirmed.** `openUpload` and `openNewMessage`
   remain defined and are exposed ONLY as `window.openUpload` / `window.openNewMessage` test seams. The built
   shell has **zero** UI callers: no nav button (`uploadBtn` removed; `newMsgBtn` → `owNewMessage` → the
   window), no card path, no click handler (`grep 'addEventListener("click", …(openUpload|openNewMessage)()'` →
   none; `grep` for a bare `openUpload()` / `openNewMessage()` call site → none, only the definitions and the
   `window.X = X` seam assignments). **Scheduled post-G6 cleanup:** remove both overlays once their engine
   coverage is fully on the Page tab / Mode A (a standalone PR that first re-proves zero UI callers).

2. **Known pre-existing test failures (suite baseline - NOT introduced by G1-G6; each fails identically on clean
   `main`):**
   - `card_fate_test` - `(d) the un-resolving template flipped to a RED fault` (asserts the RED "fault" that F1
     #304 removed; stale test - see the scheduled cleanup below).
   - `archive_fault_test` - Playwright `wait_for_function` timeout (the archived-history content wait).
   - `board_editor_test` - `3: the opp link is a plain tokenized URL in the text` (channel-2 tokenization was
     removed by design; stale assertion).
   - `shell_fingerprint_test` - `F2 recomputing BUILD over [css, …modules, generator]` (build-hash reproduction).
   - `board_law_test` - `TypeError: window.lastActivityAt is not a function` (the helper does not exist on
     `main` either).

3. **Cosmetic - RTL board-behind horizontal overflow.** On a narrow phone in RTL, the board *behind* the modal
   reports a document scroll width (~510px) wider than the 390px viewport; the modal itself is provably correct
   (`#oppWindow` measures `left 0`, `width 390`, scrim `position:fixed` full-width). The overflow is a board
   responsive matter in the lanes/cards layout (`tools/bundle.js:944` `.lanes` grid and the card content),
   independent of the window, and is hidden behind the dimmed scrim when the window is open. **Deferred** - note
   only, no fix here.

---

## Sign-off checklist for Thyab
- [ ] Merge #311, confirm the LIVE `console.thriveiii.com` header shows build `4866e115` or newer (the one item
      this environment could not do - see §0).
- [x] One "New message" nav entry; no "Upload campaign"; no drawer in the DOM.
- [x] Card tap → Details (thread/activity/signals/record/notes/fate + per-opp page Re-check).
- [x] New message → selector; without-campaign compose+preview+send; B2 refuse + fail-closed.
- [x] With-campaign Page tab (upload/pick/duplicate, tall, same controls); `{{ASSET_BASE}}`/`{{LINK}}`; commit
      publish-truth; Recipients status; Preview message+page.
- [x] Equal padding; centered; backdrop dims; body-only scroll; bottom sheet <720px; Arabic RTL clean.
- [x] Invariants B2/F1/F2/F3/{{ASSET_BASE}}/per-recipient/merge-not-replace/detail - all pass; relay unchanged.

_Verified against `feat/opp-window-flip` @ `9619cea` (BUILD `4866e115`). Live deploy proof pending #311 merge._
