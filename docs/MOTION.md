# Motion system

The console should move the way a good native application moves: enough that nothing ever
teleports, little enough that you never wait for it.

The target feeling is **quiet**. A person using this twenty times a day should feel that the
interface is responsive and continuous, and should never once think about an animation.

---

## 1. The scale

Five durations. Nothing outside this scale.

| Token | Value | Used for |
|---|---|---|
| `--t-instant` | `90ms` | Hover, focus ring, press feedback, colour change on a small object |
| `--t-quick` | `160ms` | State change on one object: a token gaining a stall ring, a count updating |
| `--t-base` | `240ms` | View crossfade, tray expand, token moving between lanes |
| `--t-slow` | `320ms` | Reserved. The opportunity window uses `--t-base`, see 4.2 |
| `--t-page` | `420ms` | Reserved. Nothing currently uses it. Do not spend it casually |

Three easings. Nothing outside this set.

| Token | Curve | Used for |
|---|---|---|
| `--e-standard` | `cubic-bezier(.2,.7,.2,1)` | Everything by default. Already the console's `--ease` |
| `--e-enter` | `cubic-bezier(.16,1,.3,1)` | Something arriving. Fast start, long soft settle |
| `--e-exit` | `cubic-bezier(.4,0,1,1)` | Something leaving. Leaving should not linger |

**Rule 1.1.** No easing may overshoot. No `cubic-bezier` with a value above 1 on the second or
fourth parameter. No spring. No bounce.

**Rule 1.2.** Exit is always shorter than enter for the same object. Waiting for something to
finish leaving is the most common way an interface feels slow.

## 2. What may move

Only two properties: `transform` and `opacity`. Plus `border-color`, `background-color`, and
`box-shadow` on small objects at `--t-instant`.

**Rule 2.1.** Translation is capped at `8px` for reveals and `10px` for the opportunity window.
Large travel reads as theatre.

**Rule 2.2.** Scale is capped between `0.98` and `1.0`. Anything more and the object appears to
change size rather than to arrive.

**Rule 2.3.** Rotation is not used anywhere except the existing logo mark, which already spins
on a 22 second loop and is paused when the tab is hidden. Leave it exactly as it is.

## 3. What may never move

`width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding`, `font-size`.

These trigger layout on every frame, they drop frames on the iPad, and they make the text
inside them reflow while a person is trying to read it. Any effect that seems to need them can
be rebuilt with `transform`, and if it truly cannot, it is the wrong effect.

The one permitted exception is `max-height` on the closed tray, because the tray's content
height is unknown and a wrong fixed height is worse than one layout pass. Use `overflow:
hidden` with a generous `max-height`, `--t-base`, and `--e-standard`.

## 4. The named transitions

### 4.1 View change

A crossfade with a small rise. Not a slide.

```
out: opacity 1 → 0, translateY(0 → -6px),  --t-base × 0.6, --e-exit
in:  opacity 0 → 1, translateY(6px → 0),   --t-base,       --e-enter
```

The outgoing view starts leaving immediately, the incoming view starts at 40% of the base
duration so the two overlap. Scroll position resets to top on the incoming view, as it already
does today.

The rationale for a fade rather than a slide: the board, the library, and settings are not a
stack with a forward and a back. They are places. Sliding implies a hierarchy that does not
exist, and it forces a direction decision in RTL that has no correct answer.

### 4.2 The opportunity window

```
backdrop: opacity 0 → 1,                     --t-quick, --e-enter
window:   opacity 0 → 1,
          translateY(10px → 0),
          scale(.985 → 1),                   --t-base,  --e-enter
```

On close, backdrop and window leave together at 70% of their enter duration with `--e-exit`.
Leaving is one gesture. There is no separate content transition: the window is one object.

Only `transform` and `opacity` are animated. Never `width`, `height`, `top`, `left`, `margin`,
`padding`, or `font-size`, per §3. Those are laid out, and animating a laid-out property makes
the browser recompute the page on every frame while the reader watches.

There is no slide from an edge, no spring, and no easing that overshoots. The window is not
arriving from somewhere: it is becoming present where the reader is already looking. Ten pixels
of lift is enough to say so, and it removes the direction decision that a horizontal slide
forces in RTL and answers wrongly half the time.

The bottom sheet below `720px` uses this same transition unchanged. Its resting position is the
bottom edge; it does not slide up from beyond it.

**Focus.** On open, focus moves to the window's first interactive element. On close, focus
returns to the card that opened it. `Escape` closes. The backdrop is clickable and closes. Body
scroll is locked while it is open and the scroll position is restored on close, because fixing
the body is what actually holds on iOS and fixing it costs the position.

**Why this replaced the drawer**, kept because the reason outlives the rule. The drawer was
specified when the opportunity view was mostly a single action, and for a single action an edge
panel is right: it is close to the card you came from and it leaves the board visible. The view
became a workspace with several tabs. A 580px column pinned to the edge of a 1440px screen
pushes the eye sideways while the board sits idle behind it, and the problem grows with every
tab added: the column cannot widen without becoming the screen, and the content cannot narrow
without becoming a phone layout on a desktop. The generalisation: **an edge panel is for one
action, a centred window is for a workspace.**

### 4.3 Token moving between lanes (FLIP)

Never teleport a token. When a stage change moves a token to another lane:

1. **First:** record `getBoundingClientRect()` for the token before the DOM change.
2. **Last:** apply the DOM change and record the new rect.
3. **Invert:** set `transform: translate(dx, dy)` with no transition, forcing the token to
   appear where it was.
4. **Play:** on the next frame, clear the transform with `--t-base` and `--e-standard`.

While travelling, the token is raised: `z-index` above its lane and a soft shadow that fades
out over the same duration. Lane counts update at `--t-quick` and do so at the *start* of the
move, so the destination is already correct when the token lands.

### 4.4 Token entrance on first render

Staggered fade and rise, but capped hard:

- The first three tokens per lane animate, `24ms` apart.
- Every token after the third appears at full opacity with no delay.

The stagger exists to make a full board feel composed rather than dumped. Beyond three items
it stops reading as composition and starts reading as waiting.

### 4.5 Stall ring

When a token crosses the stall threshold during a session, the amber ring fades in over
`--t-quick`. It does not pulse. A permanent pulse is an alarm that never stops, and an alarm
that never stops gets ignored.

### 4.6 Closed tray

`max-height` and `opacity` over `--t-base`, `--e-standard`. The chevron rotates 180 degrees
over `--t-quick`. This is the single permitted rotation outside the logo.

### 4.7 Toast

The existing toast already rises 10px and fades over 250ms. Retokenise it to `--t-base` and
`--e-enter`, and change nothing else. It was already right.

## 5. Reduced motion

```css
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{
    animation-duration:1ms !important;
    animation-iteration-count:1 !important;
    transition-duration:1ms !important;
    scroll-behavior:auto !important;
  }
}
```

Then restore opacity-only transitions: `--t-instant` for the view crossfade, and `--t-quick`
for the opportunity window, which is the larger surface and needs the longer of the two to read
as a change rather than a flicker. An instant hard cut between full-screen surfaces is
disorienting even for people who asked for less motion. Opacity is not what causes vestibular
trouble. Travel is, so the transform is what goes.

The console already pauses the logo spin when the tab is hidden via `html.tab-hidden`. Keep
that, and extend the same idea: do not run entrance staggers for a view the user cannot see.

## 6. Performance rules

- Add `will-change: transform, opacity` only for the duration of a move, and remove it on
  `transitionend`. A permanent `will-change` costs memory on every token and helps nothing.
- The board must hold 60fps with 60 tokens on an iPad. If it does not, reduce the number of
  animating elements, never the duration.
- The existing `content-visibility: auto` on `.card` is a good pattern. Apply the equivalent to
  lanes that are scrolled out of view, but never to a lane that is currently animating.
- Never animate the backdrop filter on the sticky header. Blur is expensive per frame.

## 7. Review test

Watch each transition once at normal speed, then once at 4x slowdown in devtools.

- At normal speed, you should not be able to describe what moved. You should only feel that
  nothing jumped.
- At 4x, nothing should overshoot, nothing should still be moving after the rest has settled,
  and nothing should be sliding across more than a small fraction of the screen.

If a transition is impressive at 4x, it is too much at 1x.
