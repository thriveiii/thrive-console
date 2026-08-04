# Gap report

WO-014 asked for this over a finished surface. The surface is not finished, and
the reason is the first thing in this file because it explains almost everything
else: **eight of the nine defects in the work order are not console bugs. They
are code that was written, reviewed, and never merged to the branch the site
serves.**

This report is written from evidence, most of it produced by the screen truth
harness (`tools/screen_truth.py`) run against two checkouts and compared.

---

## 0. The finding that reframes the round

`main` is what GitHub Pages serves. WO-013 delivered nine phases in nine pull
requests, stacked, each branched off the one before it. **Only phase 1 reached
`main`.** Phases 2 through 9 were merged into each other, and the tip of that
stack (`wo013-p9-memories`) was never merged up, so nothing above phase 1 is on
the served branch.

Proof, file by file, in `main` versus the stack tip:

| What | On `main` | On `wo013-p9-memories` |
|---|---|---|
| `library/kinds.js` (phase 2) | absent | present |
| `library/flows.js` (phase 6) | absent | present |
| `library/store.js` (phase 8) | absent | present |
| `docs/ARABIC.md` (phase 7) | absent | present |
| The Arabic lane headers | `فُتحت`, `رُدّ عليها` (old, passive) | `تم الفتح`, `ردود` (rewritten) |
| `i18n.js` `تم الإرسال` count | 0 | 7 |

The branches all still exist on the remote. Nothing is lost. **Merging
`wo013-p9-memories` into `main` recovers all of it in one step.**

### What that does to the nine defects in §2

The harness, run against `main` and against the WO-013 stack tip, settles which
defects are code and which are absence:

| §2 defect | Cause | Fixed by |
|---|---|---|
| 2.1 Arabic lane headers unchanged | phase 7 not on `main` | merge the stack |
| 2.3 the dual everywhere | phase 7 not on `main` | merge the stack, then phase 4 below |
| 2.7 the passive survives | phase 7 not on `main` | merge the stack |
| 2.9 number agreement | phase 7 not on `main` | merge the stack, then phase 4 below |
| 2.4 the empty `.` label | phase 3 not on `main` | merge the stack |
| 2.5 outreach does not ask | phase 3 not on `main` | merge the stack |
| 2.6 three empty rooms | phase 3 not on `main` | merge the stack |
| 2.8 screens with no exit | phases 5, 6 not on `main` | merge the stack |
| **2.2 the headline font** | **a real defect, on every branch** | **the two-line fix in §5** |

Eight of nine are the same defect wearing nine masks: the served branch is three
phases and a whole Arabic rewrite behind the work. Only 2.2 is a genuine bug that
survives on the stack tip too, and it is the one this round can fix in code.

### The measured proof

`tools/screen_truth.py`, identical harness, two checkouts, Arabic passive forms
counted on the rendered screen:

| Rule | `main` (served) | WO-013 stack tip |
|---|---|---|
| `arabic_passive` | **16 distinct, 48 appearances** | **0** |
| `arabic_dual` | 1 | 1 |

Sixteen passive forms are on the screen `main` serves. Zero are on the branch
where phase 7 landed. The rewrite works. It just is not deployed.

---

## 1. Assertion failures on the rendered screen

Full detail, per screen, element, language, and width, with a screenshot each, is
in `docs/SCREEN_TRUTH.md`, regenerated on every harness run. Against the WO-013
stack tip (the branch this round builds on) the harness reports, after
calibration:

- **`arabic_passive`: 0.** The phase-7 rewrite holds on the screen, not only in
  the source.
- **`arabic_font_fallback`: 0.** See §5: this rule cannot reproduce 2.2 in
  Chromium, so a zero here is not a clean bill for iOS.
- **`arabic_dual`: 1** distinct (`شخصين`, "two people", in a count phrase). A
  real one, and the target of §4 below: WO-013 rule 2 permitted the dual in a
  noun phrase, and this is the case that exception let through.
- **`untranslated`: 2** distinct, both opportunity slugs (`thrive-july`,
  `opened-co`) shown as link text. Content identifiers, not interface copy;
  reported, not counted as a defect.
- **`target_size`: 118** distinct sub-44px tap targets on the 390 viewport. This
  is real and it is large: the navigation, the language and lock buttons, and the
  card open controls are all 40px tall, under the 44px the work order sets on both
  axes. WO-012 set `min-height:40px` on `.tok-open`; it is 4px short. This is the
  same class of defect as the ten-pixel card body gate 7 missed, now measured.

The harness proves each of its seven assertion classes bites, by injecting one
synthetic defect of each class and confirming the rule fires
(`python3 tools/screen_truth.py --selftest`, 7 of 7).

---

## 2. Screens with no exit, or a slow response

Not built as a harness extension this round (that was §5 of the work order, a
phase not reached). What can be said from the walk: nothing threw on any of the
54 screens at any width in either language, so no screen crashed. The WO-013
stack carries the flow registry (`library/flows.js`) and the back control on
every window, which the §2.8 "no way out" report predates. On `main`, which has
neither, the exit defects are live. This is one more line in the "merge the
stack" column, and a full exit-and-responsiveness walk is the first deferred
item in §6.

---

## 3. WO-012 and WO-013 acceptance, re-verified against the served screen

The honest number the work order asked for. Every WO-013 phase reported its
acceptance lines green, and they were green **in the branch that phase built**.
Re-verified against what `main` actually serves:

- **WO-013 phase 1 (replies, store):** on `main`. Holds.
- **WO-013 phases 2 through 9:** **not on `main`.** Every acceptance line those
  eight phases reported green, roughly seventy-five lines by the phase tables in
  `docs/REVIEW_PACKET_2.md`, is **false against the served build.** Not because
  the work is wrong: because it is not there.

So the count of acceptance lines reported done and not true on the served site is
**about seventy-five, and the fix for all of them is one merge.** This is the
most useful number in this report, exactly as §9.3 predicted, and it is a
deployment fact, not a code fault.

WO-012 is fully merged and its lines hold on `main`.

---

## 4. The Arabic still owed, after the merge

Merging the stack fixes the passive and the headers. Two things in §2 and §7 are
genuinely new work on top of it, and are **not** done in this round:

- **The dual, banned entirely (§7.1).** The harness found `شخصين` surviving,
  because WO-013 rule 2 permitted the dual in a noun phrase. The stricter rule
  (no dual in interface copy, anywhere) and the structural fix (counted lines
  become `noun phrase: number`, which removes agreement from the problem at every
  value) are designed in the work order and not yet applied. Recommended as the
  next phase after the merge.
- **Number agreement in the chrome (§2.9).** Same structural fix. `رسالة متبقية
  اليوم 100` and its kin want the colon-and-number shape.

Both need Thyab's wording judgement on the review table, so they are raised, not
decided.

---

## 5. Defect 2.2, the headline font, and why the harness cannot see it

2.2 is real and it is the one bug this round can fix in code. The cause is a
display font stack with no Arabic face in it, so an Arabic headline falls through
to whatever the device supplies, which on iOS is a foreign-looking system face.

**The fix, two lines:**

```css
[dir="rtl"]{ --font-display: "Alyamama", sans-serif; }
```

**Why it is not proven here.** The harness measures the rendered Arabic width
against Alyamama and against a generic fallback. In headless Chromium, Alyamama
is embedded (`library/fonts.css`, base64) and resolves, so the metric reads
"Alyamama" and the rule stays silent on both `main` and the stack tip. The defect
lives specifically where Alyamama is **not** the resolved face, which is iOS
Safari falling through a stack that never named it. That environment is exactly
the one this sandbox cannot run (packet, every round: no iPad, no WebKit). So the
fix is correct and the check cannot confirm it. That is stated plainly rather
than presented as verified, and confirming it on a real iPad is the L4 line the
device section always carries.

---

## 6. Every check in the repository, classified

The root cause of the whole round is that checks read the source and the screen
shipped broken. So every check is classified by what it actually reads:

**Screen-level (reads the rendered page in a browser):**
`tools/screen_truth.py` (new, this round), `tools/version.py` (new),
`tools/visual.py`, `tools/gates.py`, `tools/wo002-render.py`,
`tools/audit-five-layers.py`.

**Source-level (reads files, never the screen):**
`tools/verify.js`, `tools/arabic.py`, `tools/flows.py`, `tools/walls.py`,
`tools/kinds.py`, `tools/lifecycle.py`, `tools/movement.py`, `tools/numbers.py`,
`tools/inbound.py`, `tools/channel.py`, `tools/editor.py`, `tools/backdrafts.py`,
`tools/import.py`, `tools/lane-truth.py`, `tools/locales.py`, `tools/mirror.py`,
`tools/version.js` (the relay half), `tools/wo002-data-safety.py`.

**Source-level checks that most need a screen-level counterpart, and now have
one:** the Arabic gate in `verify.js` and `arabic.py` (a passive on the screen is
now caught by `screen_truth.py`'s `arabic_passive`), and the target-size reasoning
in `gates.py` (the both-axes 44px measurement is now in `screen_truth.py`'s
`target_size`). The empty-label class that shipped a `.` three times is now a
screen-level rule (`empty_label`).

The lesson, recorded so it is not relearned: a rule about what a person sees is
verified on the rendered screen, or it is not verified.

---

## 7. What I would fix next, ordered

1. **Merge `wo013-p9-memories` into `main`.** One action. Recovers eight of the
   nine §2 defects and about seventy-five acceptance lines. Nothing else in this
   list matters until this is done, because everything else builds on a served
   branch that is three phases behind.
2. **Deploy relay v5** (the five taps in `docs/RELAY.md`) and confirm the version
   banner clears. Until then no reply arrives and no send leaves.
3. **Apply the 2.2 font fix** and confirm it on a real iPad. Two lines, one
   device check.
4. **The dual and the number agreement (§4 above),** with Thyab's wording.
5. **The full exit-and-responsiveness walk (§2 above),** extending the harness
   per the work order's phase 5.
6. **The sub-44px targets.** 118 of them, led by the 40px navigation and card
   controls. A single `min-height` correction reaches most.

Nothing outside this list was changed in this round. The two things built,
the version contract and the screen truth harness, are the two that were
genuinely missing and that hold regardless of the merge.
