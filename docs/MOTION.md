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
| `--t-slow` | `320ms` | Drawer open and close |
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

**Rule 2.1.** Translation is capped at `8px` for reveals and `12px` for the drawer content.
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

### 4.2 Drawer

```
scrim:   opacity 0 → 1,                    --t-quick, --e-standard
panel:   translateX(±16px → 0),
         opacity 0 → 1,                    --t-slow,  --e-enter
content: translateY(8px → 0), opacity 0 → 1, --t-base, --e-enter, delay 60ms
```

The panel enters from the inline-end edge. Use `translateX` with a sign derived from
`document.dir`, or better, use a CSS custom property set once at the root so the components
never branch.

On close, panel and scrim leave together at `--t-slow × 0.7` with `--e-exit`. The content does
not animate out separately. Leaving is one gesture.

**Focus.** On open, focus moves to the drawer's first interactive element. On close, focus
returns to the token that opened it. `Escape` closes. The scrim is clickable and closes.

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

Then restore opacity-only transitions at `--t-instant` for the view crossfade and the drawer,
because an instant hard cut between full-screen surfaces is disorienting even for people who
asked for less motion. Opacity is not what causes vestibular trouble. Travel is.

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
