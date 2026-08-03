# WO-012 review packet

Seven pull requests, one per phase, stacked. This is the reading order and the honest account.

It is written once, after the stack was finished and the whole suite was run over the tip, which
is why it contains two defects that no single phase could have found. Phases were built without
stopping between them, on your instruction, so this file does the work that the pause between
phases would otherwise have done.

---

## 1. Merge order

Each branch is cut from the one above it. **Merging out of order will conflict.**

| # | Phase | Branch | Base | Pull request |
|---|---|---|---|---|
| 1 | 2 · Vocabulary, symbols, and where a merge goes | `wo012-p2-vocab-icons` | `main` | #16 |
| 2 | 3 · The day's batch, from the real manifest | `wo012-p3-import` | `wo012-p2-vocab-icons` | #17 |
| 3 | 4 · Two language axes that never touch | `wo012-p4-locales` | `wo012-p3-import` | #18 |
| 4 | 5 · A card moves three ways | `wo012-p5-movement` | `wo012-p4-locales` | #19 |
| 5 | 6 · One definition per number | `wo012-p6-numbers` | `wo012-p5-movement` | #20 |
| 6 | 7 · The inventory and the ledger | `wo012-p7-inventory` | `wo012-p6-numbers` | #21 |
| 7 | 8 · Simplification | `wo012-p8-simplify` | `wo012-p7-inventory` | #22 |

Phase 1 is already on `main` as #15.

**Two of the seven carry a second commit.** Phase 4 and phase 5 each fix a defect that phase
introduced and that only the full-stack run could see. The fix sits in the pull request that
caused it, so every pull request in this stack is green on its own rather than green only at the
end. Section 4 says what they were.

---

## 2. Conformance, one table per phase

### Phase 2 · Vocabulary, symbols, and where a merge goes

| # | Check | Status |
|---|---|---|
| §2.1 | What publishes the served file, established with evidence | done |
| §2.2 | Written down where a person can find it | done, `docs/DEPLOY.md` |
| §2.3 | The served file compared byte for byte against a local build | **blocked**, proxy 403 |
| §3.1 | Zero bare "template" in English | done, 60 to 0 |
| §3.2 | Zero bare «قالب» in Arabic | done, 61 to 0 |
| §3.3 | One symbol set, defined once | done, 22 in one sprite |
| §3.4 | Every symbol carries explicit width and height | done, enforced by `verify` |
| §3.5 | Warmth limited to the three named things | done, no new colour |

7 of 8 done, 1 blocked.

### Phase 3 · The day's batch

| # | Check | Status |
|---|---|---|
| 1 | A zip of the day's batch is read in the browser | done |
| 2 | html, md and txt are read too | done |
| 3 | A discriminator that cannot mistake prose for a prospect | done, number plus middle dot |
| 4 | Pages matched to entries by name, never by position | done |
| 5 | Nothing written until a report has been shown | done |
| 6 | Unmatched pages and entries named, not counted | done |
| 7 | A duplicate slug asks, unchecked by default | done, per item |
| 8 | An unrecognised bullet key is kept rather than dropped | done |

8 of 8 done.

### Phase 4 · Two language axes

| # | Check | Status |
|---|---|---|
| 1 | `ui_lang` and `doc_lang` are separate fields | done |
| 2 | Nothing renamed; both additions additive | done |
| 3 | Two tabs per library, no combined view | done |
| 4 | A template with no locale is in neither tab | done, it is in the migration |
| 5 | The migration proposes and never assigns | done |
| 6 | The composer offers one locale, never a mixed row | done |
| 7 | The editor takes direction and typeface from the document | done |
| §7.3 | The editor is grouped rather than twelve loose fields | done, four groups |

8 of 8 done.

### Phase 5 · A card moves three ways

| # | Check | Status |
|---|---|---|
| 1 | A card moves by drag | done |
| 2 | A card moves by the overflow menu | done, built first |
| 3 | A card moves by keyboard, with announcements | done |
| 4 | All three paths reach the same guards | done, one `applyDrop` |
| 5 | A drop performs a lifecycle move, it does not set a lane | done |
| 6 | Illegal destinations absent rather than disabled | done |
| §5.2 | Manual order is device local and never syncs | done |
| 8 | WCAG 2.2 SC 2.5.7, a non-drag path exists | done |
| 9 | Undo on delete, carried from phase 1 | done, with the tombstone lifted |
| 10 | `retire_page` verifies the 404, carried from phase 1 | done, three answers |

10 of 10 done.

### Phase 6 · One definition per number

| # | Check | Status |
|---|---|---|
| 1 | One written definition per displayed quantity | done, `docs/NUMBERS.md` |
| 2 | One function per quantity, no surface computes locally | done |
| 3 | Every number carries its definition and source in the interface | done |
| 4 | Off channel sends count wherever email sends count | done |
| 5 | A rate is capped and shown with its denominator | done |
| 6 | No displayed number depends on a capped log | done, proven by truncating to 800 |
| 7 | A monthly rollup, never truncated | done, May reads 930 rather than 0 |
| 8 | Counts idempotent under a repeated sync | done |
| 9 | `QuotaExceededError` says what to do | done |
| 10 | A storage meter and a freshness guard before the eviction window | done, three days |
| 11 | A relay completeness check per key | done |

11 of 11 done.

### Phase 7 · The inventory

| # | Check | Status |
|---|---|---|
| 1 | Every file differing between the two branches counted | done, 37 |
| 2 | Every stranded feature located by function and by selector | done, four features |
| 3 | One row per user-visible capability | done, 25 rows |
| 4 | Every row from the old branch green on `main` | done, six of six |
| 5 | A stated reason the old branch must not be merged | done, two reasons, both measured |
| §2.4 | The defect sweep counted and located, nothing fixed | done, 9 checks, 2 real, 0 fixed |

6 of 6 done.

### Phase 8 · Simplification

| # | Check | Status |
|---|---|---|
| 1 | Four top level destinations, unchanged | done |
| 2 | One modal, one toast, one confirm path | done |
| 3 | One place per concept | done, `movePrompt` replaced two implementations |
| 4 | Dead interface strings removed and listed | done, 28 keys, 56 entries, all named |
| 5 | No capability removed | done, the ledger's 25 rows still green |
| 6 | Net fewer lines | done, 88 removed, 23 added |

6 of 6 done.

**Across the stack: 56 of 57 done, 1 blocked, 0 silently skipped.**

---

## 3. Carried forward, with final status

Everything ever recorded as open in this work order, and where it stands now.

| Item | Raised in | Final status |
|---|---|---|
| Manual contact recording, stranded on the old branch | §1 | **closed**, phase 1, rebuilt |
| The icon set, stranded | §1 | **closed**, phase 2, 22 symbols in a sprite |
| File import, html, md, txt and zip, stranded | §1 | **closed**, phase 3, rebuilt against the real manifest |
| Card dragging, stranded | §1 | **closed**, phase 5, rebuilt as a lifecycle move |
| "Template" means four things | Phase 1, finding 1 | **closed**, phase 2, 60 and 61 to zero |
| Numbers disagree | Phase 1, finding 2 | **closed**, phase 6, one function per quantity |
| WebKit evicts all storage after seven days | Phase 1, finding 3 | **closed as far as a web page can**, phase 6 |
| Where the served file comes from | Phase 1, blocking question | **closed**, phase 2, `docs/DEPLOY.md` |
| Undo on deletion | Phase 1, not implemented | **closed**, phase 5, with the tombstone lifted |
| `retire_page` does not verify the 404 | Phase 1, not implemented | **closed**, phase 5, three answers not two |
| The per-card overflow menu | Phase 1, not implemented | **closed**, phase 5, built before the drag |
| The attach box in the Text tab | Phase 1, standing rule 8 | **kept**, on your instruction; assertion not reverted |
| The `.mw-empty` assertion change | Phase 1 | **accepted**, on your instruction |
| §2.3, the byte comparison of the served file | Phase 2 | **still blocked.** See section 4 |
| A real file drop is not asserted in a browser | Phase 3 | **still open.** Playwright cannot synthesise a `DataTransfer` file drop; the picker path is asserted and shares code from `readDrop` onward |
| Nothing is auto-translated | Phase 4 | **deliberate.** A counterpart copies structure, not content. Yours to decide |
| Cross-lane keyboard reordering within the destination | Phase 5 | **still open.** Tab picks the lane, the card lands at its end; reordering is the menu's job |
| The rollup runs on first load, not on a schedule | Phase 6 | **still open.** A static page has no scheduler |
| Storage caps are by entry count, not by size | Phase 6 | **still open.** Named in `docs/NUMBERS.md` as the third answer and the one not built |
| `.frame` animates `width` | Phase 7 sweep | **located, deliberately unfixed** per §2.4 |
| `vh` on `.modal` | Phase 7 sweep | **located, deliberately unfixed** per §2.4. The one I would take next |
| Closing the old branch | §13 | **yours.** It is never merged, and I do not delete branches |

---

## 4. Blockers, and what was built instead

### The live host cannot be reached from here

**§2.3 asks for the served file compared byte for byte against a local build.** The sandbox proxy
answers `CONNECT tunnel failed, response 403` for `console.thriveiii.com`. This is not a
transient failure and no retry changes it.

**Built instead:** `docs/DEPLOY.md` establishes the deployment path from the Actions API rather
than from the served bytes: `dynamic/pages/pages-build-deployment`, event `dynamic`, 30 runs all
triggered by `main`. It also records the finding that mattered more than the comparison would
have, which is that `dist/` is gitignored and therefore **never served**: the shell that ships is
`library/console.html`. And it writes the four browser steps for a person who has never done it. Gate 10 rebuilds the shell from source and compares locally, which catches the failure mode
the byte comparison was there to catch: a source change that never reached the committed shell.

### Commit signatures cannot be verified locally

The signer available here supports `-Y sign` and not `-Y verify`, so `git verify-commit` and
`%G?` can never report `G` from this environment, whatever the signature says.

**Built instead:** every commit in the stack was checked for the presence of a `gpgsig` header
directly via `git cat-file`. All nine carry one. Verification against the allowed signers file is
something GitHub does and you can read on each commit page.

### Four commit messages carry check counts that are wrong

Not a blocker, and it is mine. Four commit bodies state how many checks their harness runs, and
four of those numbers are larger than the harness actually runs. Measured on the finished stack:

| Harness | The commit says | It actually runs |
|---|---|---|
| `tools/lifecycle.py` | 34 | **37** |
| `tools/import.py` | 40 | **38** |
| `tools/movement.py` | 30 | **27** |
| `tools/numbers.py` | 24 | **20** |

Every one of the four still reports **0 failed**, so no claim about a check passing is affected.
What was wrong is the count beside it, and a count nobody verified is exactly the kind of number
phase 6 exists to stop. Three of the four commit messages are corrected in this stack. The fourth
is `tools/lifecycle.py` in phase 1, which is already merged and cannot be corrected without
rewriting `main`, so it is recorded here instead.

The numbers in section 2 and in every pull request body are the measured ones.

### No iPad, and no WebKit

`/opt/pw-browsers` is Chromium only. Every render and layout claim in this stack was measured in
Chromium with touch emulation at 320, 390, 430, 768, 1024 and 1440 in both directions. **That is
supporting evidence and not a substitute.** Section 5 is the part you have to run.

### Two defects the full-stack run found, and what caused them

Neither was a blocker, but both belong here because they are what "do not stop between phases"
cost, and the cost is worth naming.

**The card body was 10 pixels wide on a touch device.** Phase 5 turned the card from one button
into a container with a body, an overflow control and a grip. Under a coarse pointer the two
controls are 44 wide each. The chrome costs 122px; the lane minimum was 132px, sized when the
card held nothing but a name. That left the body 10 pixels, so the business name was a sliver and
**a tap on the middle of a card opened the overflow menu instead of the opportunity.** On the
iPad, the primary gesture on the primary surface did not work. Gate 7 measured every control's
*height* and every control cleared 40, which is why it saw nothing. Fixed in phase 5's second
commit, with two new checks proven by putting the old number back.

**An Arabic reader could not use "Compose with".** Phase 4 filtered both template libraries by
locale, but the Templates page chose its locale from a variable hard initialised to `EN` while
the composer chose from the chrome. So an Arabic reader landed on the English library, tapped a
template, and arrived in a composer filtered to Arabic where the id matched nothing. The
drop-down stayed blank **and said nothing about why.** Fixed in phase 4's second commit: the tab
starts on the reader's own library, and an explicit `?etpl=` outranks the inference.

---

## 5. The six checks only you can run

An iPad, in Safari, on `console.thriveiii.com`. Each of these is something this environment
genuinely cannot answer, not something I skipped.

1. **Open a card and look at the bottom of the window.** Below 720 the opportunity window is a
   full height sheet capped by `88vh`. On iOS Safari the toolbar makes `100vh` taller than what
   is actually on screen, so the bottom of the sheet can sit under the toolbar. This is the
   defect phase 7 located and deliberately did not fix, and it is the most likely thing in the
   whole stack to be wrong on your device.

2. **Confirm the console you are looking at is the one just merged.** In Settings, check the
   build marker against the tip of `main`. Pages deploys from a branch and the shell is committed
   rather than built by CI, so a merge that did not include a rebuilt `library/console.html`
   serves the previous console with no error anywhere. §2.3 could not be performed from here.

3. **Sync, then check the completeness line in Settings.** It compares local record counts
   against the relay's, per key. It shipped broken twice before it was right and its failure mode
   looks exactly like a relay being down, so it deserves one look on the real relay.

4. **Drag a card between lanes with a finger.** 120ms of hold, the card lifts, the others part,
   the board auto scrolls near an edge. Then tap a card in the middle and confirm it opens the
   opportunity rather than the menu. Emulation is not a finger, and this is where that gap is
   widest.

5. **Import a real zip through the Files app.** The report has to appear before anything is
   written, and the unmatched pages and unmatched entries have to be named. The test drives the
   file picker, because Playwright cannot synthesise a real file drop.

6. **Copy a message from the Outreach tab.** Safari rejects a clipboard write reached after an
   `await`. There is an `execCommand` fallback and it is exercised in Chromium, which is not the
   browser that has the restriction.

---

## 6. What is not finished

The stack does what the work order asks and I would not call it done. Three things are true at
once. First, nothing in it has been on a real iPad, and the one defect I would most expect to
bite is the `88vh` cap on the opportunity window, which phase 7 located and §2.4 required me to
leave alone; it is the first thing I would take next and it is a small change. Second, the
storage answer is as complete as a web page can make it and that is still not complete: the
freshness band fires at three days and the meter tells you where the bytes are, but WebKit can
delete everything on that device after a quiet week and the relay remains the only durable copy,
so the honest statement is that the guard is good and the risk is not gone. Third, this run was
built without stopping between phases, and the two defects in section 4 are exactly what that
cost: both were introduced by a phase, both passed that phase's own suite, and both were only
visible once the whole stack ran together, which means the discipline that caught them was
running everything at the end rather than anything I did while building. They are fixed and their
checks exist, but I would not claim the same method would catch a third one. What I can say
precisely is this: 56 of 57 acceptance lines done, one blocked with its reason and its substitute
written down, nothing silently skipped, no storage key renamed or moved or deleted anywhere in
seven phases, and every capability on the old branch rebuilt and green so that branch can be
closed without losing anything.
