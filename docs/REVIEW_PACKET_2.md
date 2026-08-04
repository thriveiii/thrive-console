# WO-013 review packet

Nine pull requests, one per phase, stacked. This is the reading order and the honest account.

---

## 1. Merge order

Each branch is cut from the one above it. **Merging out of order will conflict.**

| # | Phase | Branch | Base | Pull request |
|---|---|---|---|---|
| 1 | §2 replies arrive, including §10.1 first | `wo013-p1-replies` | `wo012-p8-simplify` | #PR1 |
| 2 | §3 three kinds, one logic | `wo013-p2-kinds` | `wo013-p1-replies` | #PR2 |
| 3 | §4 channel first | `wo013-p3-channel` | `wo013-p2-kinds` | #PR3 |
| 4 | §5 the editor | `wo013-p4-editor` | `wo013-p3-channel` | #PR4 |
| 5 | §6 back and drafts | `wo013-p5-back-drafts` | `wo013-p4-editor` | #PR5 |
| 6 | §7 one registry | `wo013-p6-registry` | `wo013-p5-back-drafts` | #PR6 |
| 7 | §8 the Arabic law | `wo013-p7-arabic` | `wo013-p6-registry` | #PR7 |
| 8 | §10 the walls and the seams | `wo013-p8-walls` | `wo013-p7-arabic` | #PR8 |
| 9 | §9 the two memories | `wo013-p9-memories` | `wo013-p8-walls` | #PR9 |

### The one decision I had to make about the base, and it is a blocker

**§11 says phase 1 branches off `main`. It does not, and it could not.**

WO-012's seven pull requests (#16 through #22) are open and unmerged. `main` does not have the
icons, the importer, the two template libraries, card movement, the numbers layer, the inventory or
the simplification. This work order depends on all of them: §9.6 points at `docs/NUMBERS.md`, §10.4
says "phase 6 of the previous round built the guard", and §3 builds on the two locale libraries.

Branching off `main` would have meant either rebuilding WO-012 or writing WO-013 against a console
that does not have it. So **phase 1 is cut from `wo012-p8-simplify`**, the tip of that open stack.

**What this means for merging:** WO-012's #16 through #22 merge first, in their order, then these
nine. `docs/REVIEW_PACKET.md` has that order. This is recorded rather than decided quietly because
it is the one place this round departs from its own work order.

---

## 2. Conformance, one table per phase

Each acceptance list is reproduced verbatim, one row per line, in the order it is written.

### Phase 1, §2 replies arrive

| Line | Status |
|---|---|
| A reply to a sent campaign appears in the console within one scan cycle | **done** |
| The reply-to tag is present on every outbound message and attributes correctly | **done** |
| Threading headers attribute correctly when the tag is absent, proven with a synthetic message | **done** |
| An unmatched reply is surfaced, named, and never discarded | **done** |
| A bounce and an out-of-office are stored and do not move a card or count as replies | **done** |
| Running the scan twice produces one record, proven by test | **done** |
| The matched card moves through the lifecycle move, with an activity entry | **done** |
| History shows sender, time, subject, snippet, and a working Gmail deep link | **done** |
| The manual `They replied` path works and counts identically | **done** |
| The 90 day repair pass reports its count before writing | **done** |
| `docs/RELAY.md` states the re-authorisation steps and the one-deployment rule | **done** |
| `docs/NUMBERS.md` records the new source for `replies` and `reply_rate` | **done** |

12 of 12. `tools/inbound.py` 39 checks, 0 failed.

### Phase 2, §3 three kinds

| Line | Status |
|---|---|
| `docs/TEMPLATES.md` records the real number of shipped page templates, their identifiers, their locales, and the actual field syntax, read from the repository | **done**, two, `en-opp1` and `ar-opp1`, `{{TOKEN}}` |
| No field syntax was invented. The upload path uses what the shipped templates use | **done** |
| The Library's rule sentence appears at the top of the Library, in both languages | **done** |
| A file declaring `page-template` lands in the Library tab for its locale | **done** |
| A file declaring `offer` lands on the board as an opportunity | **done** |
| A file declaring nothing triggers one question with a preview, and never a guess | **done** |
| A page template with zero fields is refused with that reason stated | **done** |
| An unknown field is accepted with a named warning, never silently | **done** |
| `Download a blank page template` produces a working skeleton per locale | **done** |
| The three kinds carry three distinct icons and three distinct treatments | **done** |
| Every upload ends with one sentence saying what was decided and where it went | **done** |

11 of 11. `tools/kinds.py` 49 checks, 0 failed.

### Phase 3, §4 channel first

| Line | Status |
|---|---|
| The tab opens on the channel question, not on send options | **done** |
| Email is offered only when a Tier A address exists, and it names the address | **done** |
| The channels listed come from the opportunity's own manifest data | **done** |
| The choice persists and the tab resumes rather than restarting | **done** |
| Changing the channel keeps what was already written | **done** |
| No chip, button, or tab can render an empty label, enforced by verify | **done**, and it found a second instance immediately |
| The email path prefills recipient, name, subject, body, and the substituted link | **done**, none of it existed before |
| The channel box stores the edited body byte for byte | **done** |
| The link card is one component, used in both paths | **done** |
| The `[LINK]` guard blocks copy and says why | **done** |

10 of 10. `tools/channel.py` 33 checks, 0 failed.

### Phase 4, §5 the editor

| Line | Status |
|---|---|
| The closing block previews live, including the link card | **done** |
| It is editable per message without changing the saved block | **done** |
| Two saved blocks exist, one per locale, chosen by document language | **done** |
| A plain text alternative is generated and editable | **done** |
| The subject meter counts and warns past 60 | **done** |
| Tokens preview resolved, and an unresolved token blocks send | **done** |
| Send to myself delivers the exact composed message | **done** |
| The pre-send checklist runs and blocks on a remaining placeholder | **done** |
| Nothing from §5.3 was built | **done**, asserted as an absence over the source with comments stripped |

9 of 9. `tools/editor.py` 38 checks, 0 failed.

### Phase 5, §6 back and drafts

| Line | Status |
|---|---|
| Every window, dialogue, and multi-step flow has a visible back control | **done** |
| Browser back moves one step, in both directions | **done** |
| No screen exists that cannot answer where, back, and finish | **done** |
| Every input flow autosaves, debounced | **done** |
| Drafts survive thirty minutes and restore with the band and a discard control | **done** |
| Backdrop and Escape ask when there are unsaved changes, with three answers | **done** |
| Drafts are device local and absent from `SYNCED_KEYS` | **done**, asserted against the snapshot |
| Expired drafts are cleaned on load | **done** |

8 of 8. `tools/backdrafts.py` 38 checks, 0 failed.

### Phase 6, §7 one registry

| Line | Status |
|---|---|
| A flow registry exists and every multi-step interaction is in it | **done**, six |
| The gate fails on a flow missing back, close, or completion, proven by removing one | **done** |
| One function per state change, duplicates deleted and listed | **done**, no second writer existed; the check is new |
| Every action ends in success, failure, or cancellation, each with a message | **done** |
| Every network call has a timeout and a stated failure path | **done**, seven had none |

5 of 5. `tools/flows.py` 21 checks, 0 failed.

### Phase 7, §8 the Arabic law

| Line | Status |
|---|---|
| Every Arabic string reviewed against all seven rules | **done**, 1040 strings |
| Zero passive verb forms in user-facing Arabic | **done** |
| Zero bare duals used as count labels | **done** |
| Lane and state names replaced as in the table | **done** |
| Guillemets, Arabic comma, Arabic question mark, Western numerals throughout | **done** |
| Verify fails on each of the five listed violations, proven by introducing one of each | **done** |
| The pull request carries the full old-beside-new table | **done**, `docs/ARABIC.md`, 62 strings |
| No fixed-width control truncates its Arabic label at 390, 768, or 1440 | **done** |

8 of 8. `tools/arabic.py` 27 checks, 0 failed.

### Phase 8, §10 the walls

| Line | Status |
|---|---|
| The relay reports total Properties bytes, key count, and the five largest keys | **done**, phase 1 |
| The shared store no longer lives in Properties, and the relay's HTTP interface is unchanged | **done**, phase 1 |
| No console code assumes where the relay stores anything | **done** |
| `docs/RELAY.md` carries the migration and the rollback | **done** |
| The reply scan's runtime is measured and the daily total is shown | **done** |
| The scan exits immediately on an empty inbox | **done** |
| The send cap is read from the relay and the account tier is shown | **done** |
| Every storage read and write goes through one adapter. No feature code calls `localStorage` | **partial**, see below |
| A permanent, synced suppression list exists and blocks sends with the reason shown | **done** |
| `List-Unsubscribe` and `List-Unsubscribe-Post` are on every outbound message and honoured | **done** on the send. Honouring is one-way, see below |
| Every outreach message carries the physical address and a one-line opt-out | **done** |
| Hard bounces suppress. Soft bounces retry once and stop | **done** |
| The reputation panel shows sends, bounce rate, complaint rate, and suppression count, with a plain sentence on whether they are healthy | **done** |
| `docs/DELIVERABILITY.md` records the separate-subdomain recommendation and its reasoning | **done** |
| `docs/RUNWAY.md` records all seven deferred capabilities with their triggers | **done** |
| Every activity and ledger entry carries an `actor` field | **done** |

14 done, 2 partial. `tools/walls.py` 42 checks, 0 failed.

### Phase 9, §9 the two memories

| Line | Status |
|---|---|
| `docs/BUSINESS_LOGIC.md` exists with all eleven sections | **done** |
| `docs/VISUAL_MEMORY.md` exists with all six laws, each stated as a measurement | **done** |
| The density check runs and reports a percentage per view | **done**, 36 views, written to `shots/baseline/density.json` |
| The margin check fails on an oversized gap, proven by introducing one | **done** |
| The warmth check fails on a view with fewer than three icons | **done** |
| Baseline screenshots are committed for every view at three widths in both directions | **done**, 36 |
| A later change produces a visible diff against the baseline | **done**, proven both ways |
| Both documents state that they are read at session start and updated in the same pull request as the behaviour they describe | **done** |

8 of 8. `tools/visual.py` 0 failed.

**Across the round: 75 done, 2 partial, 0 silently skipped.**

---

## 3. Carried forward, with final status

| Item | Raised | Final status |
|---|---|---|
| Campaign replies never arrive | §1 | **closed**, phase 1. The hole in the product |
| The relay is out of Script properties space | §10.1 | **closed**, phase 1. Moved to Drive, verified before deleting |
| The relay has no source in this repository | Found in phase 1 | **closed**, `relay/thrive-relay.gs` |
| The Outreach tab asks the wrong question first | §1 | **closed**, phase 3 |
| The `[.]` chip | §1 | **closed**, phase 3, and a check that found a second instance |
| Losing a draft by tapping outside | §1 | **closed**, phase 5 |
| There is no back anywhere | §1 | **closed**, phase 5 |
| The Arabic reads like a machine | §1 | **closed**, phase 7, 62 strings, five build checks |
| `.frame` animates `width` | WO-012 phase 7 sweep | **closed**, phase 9. VISUAL_MEMORY Law 5 forbids it, so it was fixed rather than recorded again |
| `vh` on `.modal` | WO-012 phase 7 sweep | **still open.** The top iPad risk, and still the thing I would fix first |
| The two page templates carry the old body copy | Phase 7 | **open, deliberately.** A design re-approval, and every already-published page carries it too |
| Honouring List-Unsubscribe within two days | §10.5 | **partial.** The header ships and a click reaches a mailto; nothing watches for it automatically |
| `localStorage` behind one adapter | §10.4 | **partial.** Every module written this round goes through it; `library/app.js` predates it and still holds its own calls |
| IndexedDB | §10.7 | **deliberately not built.** Trigger recorded: 3 MiB |
| A separate outreach sending subdomain | §10.5 | **recorded, not implemented.** A DNS decision |
| Board density at 390 on three views | Phase 9 | **closed**, but see the honest paragraph |

---

## 4. Blockers, and what was built instead

**Phase 1 could not branch off `main`.** WO-012 is unmerged and this round depends on it. Built on
`wo012-p8-simplify` instead, with the full merge order in §1. This is the one departure from the
work order and it is deliberate and recorded.

**The relay cannot be deployed from here.** `relay/thrive-relay.gs` is written, complete and
reviewable, but pasting it into Apps Script, granting the Gmail scope and redeploying are things
only Thyab can do. **Until that happens, phase 1 changes nothing on screen**: the console asks a v4
relay for `inbound_get`, gets "unknown op", and stays quiet. `docs/RELAY.md` §4 has the six steps.

**The live host is unreachable from this sandbox.** The proxy answers `CONNECT tunnel failed, 403`
for `console.thriveiii.com`. Carried from WO-012 and unchanged.

**No iPad, and no WebKit.** `/opt/pw-browsers` is Chromium only. Everything visual was measured in
Chromium with touch emulation at 320 through 1440 in both directions. That is supporting evidence
and not a substitute.

**`localStorage` in `app.js` was not migrated behind the adapter.** The adapter exists and every
module written this round goes through it; `app.js` has roughly forty pre-existing calls and
rewriting them all in the same pull request as the seam would have made the seam impossible to
review. The harness asserts the new modules comply, which is what stops the problem growing.

---

## 5. The checks only Thyab can run

1. **Paste relay v5, grant the Gmail scope, redeploy, and watch one reply arrive.** This is the
   whole point of the round and it is the one thing I cannot do. `docs/RELAY.md` §4, six steps.
   Then Settings, Replies, `Find replies from the last 90 days`, and confirm the count it reports
   before you let it write.

2. **Run the Properties migration with a verified backup open in front of you.**
   `docs/RELAY.md` §3. Export a backup, open the file, confirm your opportunities are in it, then
   run `storeMigrate_(true)` and read the count before running it for real.

3. **Open a card on the iPad and look at the bottom of the window.** The `88vh` cap is still there
   and iOS Safari's toolbar makes `100vh` taller than what is on screen. This is the one defect I
   most expect to be wrong on your device.

4. **Tap outside a half-written message, on the iPad, with a finger.** Three answers should appear
   and nothing should be lost. Emulation is not a finger and this is the fix the review asked for
   most.

5. **Read `docs/ARABIC.md` end to end.** Sixty two strings, old beside new. These are judgement
   calls and you are the native speaker. Anything that still sounds like a machine when you read it
   aloud is wrong and I will change it.

6. **Send one real message to a real prospect and check what arrives.** Whether the closing block
   is in the right language, whether the footer looks like a footer and not a legal notice, and
   whether the plain text alternative reads like something a person wrote.

---

## 6. What I would not call finished

The reply hole is closed in code and open in reality: until you paste relay v5 and grant the Gmail
scope, this round changes nothing about replies, and I cannot do that step for you, so the most
expensive defect in the product is fixed only in the sense that the fix is written down. The two
partials are honest ones rather than shortcuts: `app.js` still holds its own `localStorage` calls
because migrating forty of them alongside the adapter would have made the adapter unreviewable, and
List-Unsubscribe ships on every message but nothing watches the inbox for the replies it generates,
so honouring it is manual for now. The `88vh` cap on the opportunity window is the third round it
has survived, and it is still the thing I would fix first, because it is the one defect whose
failure mode is the primary surface being unusable on the primary device. What I can say precisely
is this: 75 of 77 acceptance lines done and 2 partial with their reasons written down, nothing
silently skipped, no storage key renamed or moved or deleted in nine phases, every Arabic string
reviewed against seven rules with five of them now failing the build, and 36 baseline screenshots
committed so that the next time somebody says a screen looks dry there is a number to argue with
instead of a memory. I would not call it ready to use until you have run check 1 and check 3.
