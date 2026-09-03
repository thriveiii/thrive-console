# BRANCH_SWEEP_INVENTORY.md

READ-ONLY inventory of open branches and PRs in `thriveiii/thrive-console`. No deletion, no merge, no
build, no edits. Snapshot date: 2026-09-03. `origin/main` HEAD: `de7de93`.

## Method and the one fact that governs the reading

The repo merges PRs by **squash**. A squash-merge rewrites the branch's commits into one new commit on
`main`, so the original branch still shows `ahead > 0` against `main` even though its CONTENT is fully in
`main`. Therefore `git` ahead/behind CANNOT distinguish "merged" from "open" here; **the GitHub PR state is
the authority.** There is also no `.gitattributes`, so `library/app.js` and the other sources merge as TEXT
(not binary).

By that authority the open set is exactly twelve items:

- **5 open PRs** (GitHub `state=open`): #257, #242, #228, #219, #209.
- **7 branches pushed this session with NO PR** (author-only, PR left to Thyab): `cycle-stamp`,
  `opp-window`, `upload-update-in-place`, `upload-never-drops`, `journey-ledger-trace`, `send-truth-trace`,
  `b2-webhook-trace`.

The other **166** of the 178 `claude/*` branches have no open PR; under the squash workflow their content is
in `main` (merged) or their PR was closed. They are bucketed in aggregate as MERGED/CLOSED, not row-by-row
(distinguishing merged-vs-closed for each would need a per-branch PR lookup, out of scope for this sweep).

A note on the build-output collision that recurs below: every branch that ran `node tools/bundle.js`
rewrote the five fingerprinted artifacts (`index.html`, `library/app.html`, `library/board.html`,
`library/console.html`, `version.json`). Two such branches always "conflict" on those five files, because
each rebuilt to a different `BUILD` hash. That conflict is NOT a source conflict; it is resolved by taking
`main`'s artifacts and rebuilding. Wherever a row says "conflicts (build output only)", the hand-edited
SOURCE applied cleanly and only these five artifacts collided.

---

## A. The 5 open PRs (GitHub authoritative)

| PR | Branch | Base | Ahead/Behind main | Source files (non-artifact) | Live source? | Merge state | Purpose (title) | Last commit |
|---|---|---|---|---|---|---|---|---|
| **#257** | `claude/thrive-console-new-message` | main | 1 / 85 | `tools/board-editor.src.js`, `tools/board-newmsg.src.js`, `tools/board_detail_test.py`, `tools/board_newmsg_test.py`, `tools/bundle.js` | Yes - the PARALLEL board shell (`board-*.src.js` -> `board.html`, not served) | conflicts (build output only) | New message: the editor as a standalone process, send with or without a link (E1) | 2026-08-27 |
| **#242** | `claude/thrive-console-github-pages-7la7zn` | main | 11 / 104 | `cap-orbit/*` (9), `gate.html`, `library/engine-probe.html`, `library/failsafe.js`, `netlify.toml`, `tools/bundle.js`, `tools/storage_safe_test.py` | Yes - `gate.html`, `failsafe.js`, `netlify.toml` are served | conflicts (build output only) | Old-engine outage: engine-probe + storage-safe root fix | 2026-08-26 |
| **#228** | `claude/thrive-console-inline-css-probe` | main | 1 / 131 | `docs/console-entry-outage.md`, `library/styles.css`, `tools/bundle.js`, `tools/first_paint_test.py` | Yes - `styles.css` is served source | conflicts (build output only) | CSS_INLINE + CONSOLE_PROBE: remove the last CSS fetch | 2026-08-25 |
| **#219** | `revert-218-claude/thrive-console-boot-paint-first` | main | 38 / 132 | `docs/boot-paint-first-phase55.md`, `library/app.js`, `library/i18n.js`, `tools/board_one_read_test.py` | **Yes - `library/app.js`, `i18n.js`** | conflicts (build output only) | Revert "BOOT_PAINT_FIRST: the post-gate boot never holds a black screen (P55)" | 2026-08-25 |
| **#209** | `claude/thrive-console-p49-official-client` | main | 20 / 132 | `authtest.html`, `docs/auth-preflight-probe-phase49.md` | Marginal - `authtest.html` is a diagnostic page | conflicts (build output only) | P49: capture the device evidence first, before the official-client swap | 2026-08-24 |

All five are 85 to 132 commits behind `main` and 8 to 10 days old. None are 30+ days old, so none meet the
STALE bucket's literal threshold, but all are heavily superseded (the console has merged 85+ PRs past them).

## B. The 7 session branches pushed with no PR

| Branch | Base | Ahead/Behind main | Source files (non-artifact) | Live source? | Merge state vs main | Purpose (first commit) | Last commit |
|---|---|---|---|---|---|---|---|
| `claude/thrive-console-cycle-stamp` | main | 1 / 1 | `library/app.js`, `tools/cycle_stamp_test.js`, `tools/mail_dedup_key_test.js` | **Yes - `library/app.js`** | **clean** (no conflict at all) | stamp cycle on the live send and hit writes (Option A) | 2026-09-03 |
| `claude/thrive-console-opp-window` | main | 3 / 17 | `library/app.js`, `library/i18n.js`, `docs/IDENTITY.md`, `docs/FOUNDATION_BRIEF.md`, `docs/SMOKE_TEST_CHECKLIST.md`, `tools/window_conformance_test.py`, `tools/arabic_gate_test.py` | **Yes - `library/app.js`, `i18n.js`** | conflicts (build output only); source clean | PR-1: the window, ratified against law 3.6 and 3.7, and the canon amendment | 2026-09-02 |
| `claude/thrive-console-upload-update-in-place` | main | 1 / 3 | `library/app.js`, `library/intake.js`, `tools/upload_update_in_place_test.js` | **Yes - `library/app.js`, `intake.js`** | conflicts (build output only); source clean | upload matches by stable slug and updates in place (supersedes #295) | 2026-09-02 |
| `claude/thrive-console-upload-never-drops` | main | 2 / 10 | `library/app.js`, `tools/upload_never_drops_test.js` | **Yes - `library/app.js`** | conflicts (build output only) vs main; **SOURCE conflict vs upload-update-in-place** | upload always inserts a new operation, never a silent drop (this is PR #295) | 2026-09-02 |
| `claude/thrive-console-journey-ledger-trace` | main | 1 / 3 | `docs/JOURNEY_LEDGER_TRACE.md` | No - docs only | clean | trace: card journey ledger (L1) + template/library reality, read-only | 2026-09-02 |
| `claude/thrive-console-send-truth-trace` | main | 1 / 0 | `docs/SEND_TRUTH_TRACE.md` | No - docs only | clean | trace: send-truth and delivery-truth (defect B), read-only | 2026-09-03 |
| `claude/thrive-console-b2-webhook-trace` | main | 1 / 0 | `docs/B2_WEBHOOK_TRACE.md` | No - docs only | clean | trace: Resend delivery-truth reconciliation (defect B-2), read-only | 2026-09-03 |

## C. Cross-check of the LIVE-CODE branches against current `origin/main`

The four live-code session branches all touch `library/app.js`. Verified by pairwise 3-way merge
(`git merge-tree`), naming the overlap by file:

- **`cycle-stamp`** edits `supaMailRow` / `supaHitRow` / `supaOppFromRow` / `supaRowFromOpp` / the opp
  hydrate (app.js ~3905-4520). Its change **still applies to current `main` with zero conflict** (even the
  build output matches, because it was cut from the newest `main`). Disjoint from the other three: pairwise
  merges with `upload-update-in-place` and `opp-window` are **source-clean** (no `app.js` conflict).
- **`upload-update-in-place`** edits `oppExistingMeta` / `writeImport` / `importPlan` (app.js ~4633-4720 +
  `intake.js`). **Source-clean against `main`** and against `cycle-stamp` and `opp-window`. It **supersedes
  `upload-never-drops`**: its own commit says so, and both edit the same `writeImport` branch, so they
  **conflict in `library/app.js`** (verified) - they cannot both land.
- **`opp-window`** edits the window / send-bar path and `i18n.js` (disjoint region). **Source-clean** against
  `main`, `cycle-stamp`, and `upload-update-in-place`.
- **`upload-never-drops`** (PR #295's branch) is the **superseded** one. It is the only pair that produces a
  real `library/app.js` conflict, and the conflict is against its own replacement (`upload-update-in-place`).

Net: `cycle-stamp`, `upload-update-in-place`, and `opp-window` are mutually independent in source and each
applies to `main`; only their regenerated build artifacts collide, so each needs a rebuild after any other
lands. `upload-never-drops` is dead work replaced by `upload-update-in-place`.

For the 5 old open PRs, the same build-output collision is present, and each is 85-132 commits behind, so a
merge today would require a rebuild and a review against a `main` that has moved far past their premise.

---

## D. Buckets (every open item classified into exactly one)

### MERGED (content in `main`; branch is a squash-merge leftover, safe to delete the pointer)

| Item | Evidence |
|---|---|
| ~166 other `claude/*` branches (178 total minus the 12 open) | No open PR (GitHub `state=open` returns only the 5 in section A). Under the squash workflow their merged content is in `main`; `git ahead>0` is a squash artifact. Not individually verified merged-vs-closed - a per-branch PR lookup would separate the few closed-without-merge from the merged, but none are open. |

### DOCS-ONLY (trace/report `.md`, no live-source risk; merge or close is equally safe)

| Branch | Evidence |
|---|---|
| `claude/thrive-console-journey-ledger-trace` | one file: `docs/JOURNEY_LEDGER_TRACE.md`; merges clean |
| `claude/thrive-console-send-truth-trace` | one file: `docs/SEND_TRUTH_TRACE.md`; merges clean |
| `claude/thrive-console-b2-webhook-trace` | one file: `docs/B2_WEBHOOK_TRACE.md`; merges clean |

### LIVE-CODE OPEN (touches served source; needs a keep/close decision)

| Branch / PR | Live source touched | Evidence |
|---|---|---|
| `cycle-stamp` (no PR) | `library/app.js` | clean against `main`; source-disjoint from the other live branches |
| `opp-window` (no PR) | `library/app.js`, `library/i18n.js` | source-clean; build-output conflict only |
| `upload-update-in-place` (no PR) | `library/app.js`, `library/intake.js` | source-clean; supersedes #295 |
| `upload-never-drops` (no PR, = PR #295 lineage) | `library/app.js` | superseded by `upload-update-in-place` (real `app.js` conflict) |
| PR **#257** `new-message` | `board-*.src.js` (parallel shell) | 85 behind; build-output conflict only |
| PR **#242** `github-pages-7la7zn` | `gate.html`, `failsafe.js`, `netlify.toml` | 104 behind |
| PR **#228** `inline-css-probe` | `library/styles.css` | 131 behind |
| PR **#219** `revert-218-boot-paint-first` | `library/app.js`, `library/i18n.js` | 132 behind; a revert PR |
| PR **#209** `p49-official-client` | `authtest.html` (diagnostic) | 132 behind |

### STALE (no commits in 30+ days AND superseded)

| Item | Evidence |
|---|---|
| (none) | The oldest open item (#209) is 2026-08-24, ~10 days old. Nothing open is 30+ days idle, so the STALE bucket is empty by its literal rule. The 5 old PRs are superseded but under 30 days, so they sit in LIVE-CODE OPEN above with the supersession noted. |

---

## E. Per LIVE-CODE branch: safe to close / must review / must rebase

- **`cycle-stamp`** - MUST REVIEW (then merge). It is the only live branch that is fully clean against
  current `main`, source and build output. No rebase needed today.
- **`upload-update-in-place`** - MUST REVIEW (then merge with a rebuild). Source-clean; only the build
  artifacts need regenerating on merge. It is the live version of the upload fix.
- **`opp-window`** - MUST REVIEW (then merge with a rebuild). Source-clean; build artifacts regenerate on
  merge. Large surface (the window), so the review is the real gate, not the mechanics.
- **`upload-never-drops`** - SAFE TO CLOSE. Superseded by `upload-update-in-place`, with which it conflicts
  in `library/app.js`; landing it would re-introduce the withdrawn suffix-and-decision approach.
- **PR #257 `new-message`** - MUST REVIEW or CLOSE. 85 commits behind and targets the parallel `board-*.src`
  shell that the root does not serve; if its intent already landed elsewhere it is a close candidate,
  otherwise it must be rebased before merge.
- **PR #242 `github-pages-7la7zn`** - MUST REBASE if kept. 104 behind and touches the served root
  (`gate.html`, `failsafe.js`, `netlify.toml`); it cannot merge as-is and needs a review against today's root.
  (Note: this branch name is also the session's designated dev branch, but this PR is older, separate work.)
- **PR #228 `inline-css-probe`** - MUST REBASE if kept. 131 behind, edits `styles.css`; strong close
  candidate if the CSS-fetch removal already shipped.
- **PR #219 `revert-218-boot-paint-first`** - MUST REVIEW intent, likely CLOSE. A 132-behind revert PR whose
  target has almost certainly been re-decided since; merging a stale revert into today's `app.js` is risky
  and needs a human call on whether the revert is still wanted.
- **PR #209 `p49-official-client`** - SAFE TO CLOSE (evidence-capture PR). 132 behind; it captured device
  evidence before a swap that has long since happened. Only `authtest.html` + a doc, no lasting source.

**No action taken. Inventory only.**
