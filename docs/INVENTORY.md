# Inventory, and the ledger that lets the old branch be closed

Documentation only. No `.js`, `.css` or `.html` changed in this pull request.

This exists for one moment: closing `claude/thrive-console-github-pages-7la7zn` without merging
it. That cannot be done honestly unless somebody wrote down what was on it first, because "we
did not lose anything" is a claim, and a claim needs a list.

---

## 1. Branch and artifact inventory

| | `main` | `claude/thrive-console-github-pages-7la7zn` |
|---|---|---|
| Head | `3068c92`, 3 August 2026 | `4515adf`, 3 August 2026 |
| Its last commit | Merge of WO-012 phase 1 | "Add motion system documentation" |
| Files differing between them | 37 | |

The 37 files are: `Brain/REVIEW-LAYERS.md`, `README.md`, `docs/IDENTITY.md`, `docs/MOTION.md`,
`library/{activity,board,compose,console,editor,index,library,settings,templates}.html`,
`library/{app.js,i18n.js,icons.js,intake.js,lifecycle.js,stage-model.js,styles.css}`,
eight files under `shots/wo002/`, and
`tools/{audit-five-layers.py,bundle.js,gates.py,lane-truth.py,mirror.py,verify.js}` plus the
WO-002 harnesses.

### The four stranded features, by function and by selector

| Feature | Where it lives on the old branch |
|---|---|
| Manual contact recording | `recordOffChannelSend()` in `library/app.js`, with `channelOf`, `channelUrl`, `offChannelStamp`, `offChannelSends`. Selectors `#mwOff`, `#mwOffCh`, `#mwOffWhen`, `#mwOffNote`, `#mwOffDo` |
| File import (html, md, txt, zip) | `library/intake.js` (`parseBrief`, `matchPages`, `toRecord`, `readZip`, `readDrop`) plus `initIntake()` in `app.js`. Selectors `#intakeZone`, `#intakeFile`, `#intakeOut`, `.in-card`, `.in-warn` |
| Card dragging | `initBoardDrag()` in `app.js`, with `setLaneOrder`, `clearLaneOrder`, `ord` on the record and the sort in `stage-model.js`. Selectors `.tok-grip`, `.tok-ph`, `.tok.is-drag`, `body.is-dragging` |
| The icon set | `library/icons.js`, 31 symbols on a 24 grid, `thriveIcon()` and `applyIcons()`. Selectors `.ic`, `.has-ic`, `[data-icon]` |

### Why it must never be merged, and this is now two reasons

1. **It is built on a drawer that no longer exists.** Its `app.js` contains `initDrawer` and its
   `styles.css` contains the `.drawer*` block. WO-002 replaced both with the centred window.
   Merging would reintroduce an edge panel that IDENTITY Law 3.6 now forbids.

2. **It carries a pre-amendment copy of `docs/IDENTITY.md` and `docs/MOTION.md`.** Measured:
   `Law 3.6` appears **once** in `main`'s copy and **zero** times in the old branch's copy. A
   merge would silently undo WO-002 §3, which is the amendment that documents the window those
   same files are supposed to describe.

---

## 2. The capability ledger

One row per user-visible capability that exists anywhere today. **A row that is not green on
`main` at the end of this round is a regression, whatever any conformance table says.**

| Capability | Where it lives now | Survives on `main` | Carried by |
|---|---|---|---|
| Opening an opportunity | `initModal` in `app.js` | yes | WO-002, PR #13 |
| Editing a page | `initEditor`, Page tab | yes | WO-002 |
| Publishing | `publishOpp`, `finishPublish` | yes | pre-existing |
| Composing an email | `initCompose`, Outreach tab | yes | WO-002 |
| Sending | `#eSend`, relay | yes | pre-existing |
| The quota counter | `quotaUsage`, `recordSend` | yes | pre-existing |
| The activity log | `initActivity`, History tab | yes | pre-existing |
| The language switch | `initLang`, `setLang` | yes | pre-existing |
| The lock | `thriveLock`, gate | yes | pre-existing |
| Board lanes and counts | `stage-model.js`, `initBoard` | yes | pre-existing |
| The closed tray | `#boardTray` | yes | pre-existing |
| The library | `initDashboard` | yes | pre-existing |
| Insights | `initHome` | yes | pre-existing |
| Settings | `initSettings` | yes | pre-existing |
| Sync | `syncNow`, `doSyncRound` | yes | pre-existing |
| Backup export | `exportBackup` | yes | pre-existing |
| Backup import | `importBackup` | yes | pre-existing |
| Copy page link | `#modalCopy` | yes | WO-002 |
| **Manual contact recording** | old branch | **yes, rebuilt** | WO-012 phase 1, PR #15 |
| **File import, html** | old branch | **yes, rebuilt** | WO-012 phase 3 |
| **File import, md or txt** | old branch | **yes, rebuilt** | WO-012 phase 3 |
| **File import, zip** | old branch | **yes, rebuilt** | WO-012 phase 3 |
| **Card dragging within a lane** | old branch | **yes, rebuilt** | WO-012 phase 5 |
| **Card dragging across lanes** | old branch | **yes, rebuilt** | WO-012 phase 5 |
| **The icon set** | old branch | **yes, rebuilt** | WO-012 phase 2 |

**Rebuilt, not cherry-picked, and that distinction matters.** Every one of the six was written
again against the current model rather than lifted across. They are better than the originals in
ways the originals could not have been, because the lifecycle and the centred window did not
exist when the first versions were written:

- Manual contact recording now runs through `ThriveLifecycle` and refuses a body still carrying
  `[LINK]`. The old version would have recorded a broken message as sent.
- The importer now parses the real manifest with the numbered-heading discriminator and shows a
  report before writing. The old one used a looser heading rule and wrote immediately.
- Dragging now performs a lifecycle move with its guards and has a non-drag path beside it for
  WCAG 2.2 SC 2.5.7. The old one set a lane directly and had no keyboard path at all.
- The symbol set is 22 named symbols in a sprite with enforced `width` and `height`, not 31
  inline SVGs.

Two rows that existed on neither branch and are new: **undo on delete** and **retire_page
verifying the 404**, both WO-012 phase 5.

---

## 3. Deployment path

Established in `docs/DEPLOY.md`, in phase 2, with evidence from the Actions API. In short:

GitHub Pages deploying from a branch, using GitHub's own builder
(`dynamic/pages/pages-build-deployment`, event `dynamic`, 30 runs all triggered by `main`).
There is no workflow file, which is what "Deploy from a branch" produces.

**`dist/thrive-console.html` is never served.** `.gitignore` contains `dist/`, so Pages never
sees it. The served shell is `library/console.html`, generated by `tools/bundle.js` and committed
on purpose. **The one manual step is running the bundler**, which is why gate 10 rebuilds and
compares.

**Not verified from here:** the byte comparison of the served file against a local build. The
sandbox proxy refuses `console.thriveiii.com` with `CONNECT tunnel failed, response 403`.
`docs/DEPLOY.md` has the four browser steps a person performs instead.

---

## 4. Defect sweep

Counted and located. Nothing fixed in this pull request.

| # | Check | Found | Where |
|---|---|---|---|
| 1 | Listener recursion of the WO-002 kind | **0 unresolved** | 11 `lang` hooks; none calls `applyLang`. The one that did was fixed in WO-002 and the reason is in the code |
| 2 | `letter-spacing` or uppercase reaching Arabic | **0 unresolved** | 10 selectors carry a real `letter-spacing`; all 10 are reset under `[dir="rtl"]` |
| 3 | SVG without explicit `width` and `height` | **0** | enforced by `verify.js` since phase 2 |
| 4 | Physical CSS properties | **0** | no `left:`, `right:`, `margin-left`, `padding-right` or `text-align: left` |
| 5 | Animated layout properties | **1** | `styles.css` `.frame` animates `width` on the device toggle. Real, and it is the preview iframe rather than a surface the reader reads |
| 6 | `vh` on a full-height surface | **3** | `.frame` twice at `70vh`, `.modal` once at `max-height:88vh`. The modal is the one that matters on iOS, where the toolbar makes `vh` lie |
| 7 | Duplicated components | **0** | one `#modal`, one `#toast`, one `confirm` path |
| 8 | `console.log` outside a self-test guard | **0** | |
| 9 | Em dash | **0** | enforced by `verify.js` |

**The two that are real and unfixed**, both deliberately, because §2.4 says count and locate,
fix nothing:

- **`.frame` animates `width`.** It violates the rule in MOTION §3. It is the preview iframe
  switching between desktop and phone, so nothing the reader is reading reflows. Worth fixing,
  not worth fixing here.
- **`vh` on `.modal`.** On iOS Safari the toolbar makes `100vh` taller than the visible viewport,
  so `88vh` can exceed what is actually on screen. `dvh` with a `vh` fallback is the fix. This is
  the one item in this sweep I would fix first, and it is a genuine iPad risk rather than a
  theoretical one.
