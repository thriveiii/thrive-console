# The visual memory, stated as measurements

**Read at the start of every session.** Updated in the same pull request as the behaviour it
describes, never after.

The review named three visual failures: **too much margin, dryness, and breakage during
transitions.** This document makes each one measurable, because **a rule that cannot be measured
will be argued away.**

Every law here is checked by `tools/visual.py`. A law with no check is an opinion.

---

## Law 1. Density

> In the first screenful of any view, at 1440 by 900 and at 390 by 844, content boxes occupy **at
> least 25 percent** of the area.

Below that the screen is dry and the check fails. Measured as the union of the bounding boxes of
every content element intersecting the first screenful, divided by the viewport area.

**Why a floor rather than a ceiling:** a dry screen is not restraint, it is unfinished. Restraint is
what you do with the 25 percent, not an excuse to have less of it.

---

## Law 2. Margins

> No vertical gap between content blocks exceeds **96 pixels on desktop** or **64 on mobile**.
> Page padding comes from the token scale and nowhere else.

A gap larger than that is not breathing room, it is a missing element. The token scale is
`--s-1` through `--s-8`; a hand-written `padding: 37px` is a number nobody can reason about later.

---

## Law 3. Warmth

> Every view carries **at least three icon instances** and **at least one warm element**: a lane
> colour, an accent, or an illustrated empty state.

A view with none fails. This is the measurable form of "it feels dry": a screen of grey text in
grey boxes is not neutral, it is unfinished.

---

## Law 4. Empty states

> Every empty state has **an icon, a sentence, and exactly one action.**

Never a bare sentence in the middle of a black field. An empty state is the screen a person sees
most often on their first day, and it is the one most often left as a shrug.

Exactly one action, not zero and not three: zero is a dead end, and three is a menu pretending to
be guidance.

---

## Law 5. Transitions

> **No layout property animated. No text reflow during a transition. No scroll jump on open or
> close. No element that arrives after the surface it sits on.**

Animating `width`, `height`, `top` or `margin` makes the browser reflow every frame, and reflowing
text is text a person cannot read while it moves. Only `transform` and `opacity`.

An element arriving after its own surface is the flicker that makes a fast interface feel slow.

---

## Law 6. The baseline harness, which is the actual memory

> Capture a screenshot of **every view at 390, 768 and 1440, in both directions**, and commit them
> as baselines. Every later pull request diffs against them and attaches the changed images.

**Drift becomes visible instead of arguable, and "dryness" stops being an opinion.**

`tools/visual.py` writes to `shots/baseline/`. A later change that alters a view produces a
different image, and the diff is the evidence. Without baselines, every visual disagreement is two
people describing a screen from memory.

---

## How to run it

```
python3 tools/visual.py            # measure, and fail on a broken law
python3 tools/visual.py --baseline # re-capture the baselines, deliberately
```

Re-capturing is deliberate and separate, because a harness that silently updates its own baseline
has no memory at all.
