# WO-002 · amendments for IDENTITY.md and MOTION.md

**Why this file exists.** WO-002 §3 requires amending `IDENTITY.md` and the `MOTION.md` §4.2
transition in the same pull request. Neither file is in this repository. `git log --all
--diff-filter=A` across the whole history returns nothing for either name, and the code
references them only by section number (`IDENTITY §6.2`, `§9.1`, `§3.3`, `§4.4`). They live in
the board package, outside this repo.

Inventing their surrounding content would be worse than leaving them alone: the section numbers
the code cites would stop pointing at the sections they name. So the replacement text is written
here, in full, ready to paste, and §3 is reported as **blocked** rather than done.

Add the two files to the repository and this text goes into them in the next pull request.

---

## 1. IDENTITY.md · the opportunity surface

Replace the paragraph describing the opportunity drawer with this.

> **The opportunity surface is a centred window.**
>
> Opening an opportunity opens one window in the middle of the screen, over a dimmed board, with
> five tabs: Overview, Text, Page, Outreach, History. It is `min(920px, 92vw)` wide, capped at
> `88vh` tall, with equal margins on all four sides. Its header and its tab strip are fixed;
> only its body scrolls. Below 720px it becomes a full height sheet on the bottom edge with the
> same header and the same tabs. It is not a second component, only a second set of values.
>
> It never appears at an edge. It borrows the editor and the composer by moving their nodes into
> itself rather than copying their markup, so the document holds exactly one of each and one set
> of listeners, and it returns them the moment anything else needs them.

## 2. IDENTITY.md · extension protocol

Add this decision, with its reason. A rule without its reason gets overridden by the next person
who does not know why it existed.

> **2 August 2026 · the opportunity drawer became a centred window.**
>
> The drawer was specified when the opportunity view was mostly a single action, and for a single
> action an edge panel is right: it is close to the card you came from and it leaves the board
> visible. The view has since become a workspace with several tabs.
>
> A 580px column pinned to the edge of a 1440px screen pushes the eye sideways while the board
> sits idle behind it, and the problem grows with every tab added: the column cannot widen without
> becoming the screen, and the content cannot narrow without becoming a phone layout on a desktop.
> A centred surface is the correct shape for a workspace, and it is the shape the console uses
> from here.
>
> The rule this generalises: **an edge panel is for one action, a centred window is for a
> workspace.** When a surface grows a second tab, ask which one it has become.

## 3. MOTION.md §4.2 · the transition

Replace the drawer transition with this. Durations and easings are the existing tokens; nothing
new is introduced.

> **§4.2 The opportunity window**
>
> ```
> Enter
>   backdrop   opacity 0 to 1                       --t-quick  --e-enter
>   window     opacity 0 to 1
>              translateY(10px) to 0
>              scale(.985) to 1                     --t-base   --e-enter
>
> Exit
>   backdrop and window leave together, at 70% of their enter duration, on --e-exit.
> ```
>
> Only `transform` and `opacity` are animated. Never `width`, `height`, `top`, `left`, `margin`,
> `padding`, or `font-size`: those are laid out, and animating a laid-out property makes the
> browser recompute the page on every frame while the reader watches.
>
> There is no slide from an edge, no spring, and no easing that overshoots. The window is not
> arriving from somewhere; it is becoming present where you are already looking. Ten pixels of
> lift is enough to say so.
>
> Under `prefers-reduced-motion: reduce` the transform is dropped and the opacity fade is kept at
> `--t-quick`. Travel is what causes vestibular trouble, not opacity, and a hard cut between two
> full surfaces is its own kind of disorienting even for a reader who asked for less motion.
>
> The bottom sheet under 720px uses this same transition unchanged. Its resting position is the
> bottom edge; it does not slide up from beyond it.
