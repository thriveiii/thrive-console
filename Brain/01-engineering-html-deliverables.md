# Thrive Technical Reference: Building Polished HTML Deliverables (RTL, Animated, Client-Facing)

Abstracted, project-agnostic engineering knowledge distilled from a multi-round HTML presentation build.
Purpose: start future builds from an advanced baseline and skip the battles below.

---

## 1. Build architecture: script is the source of truth, not the output

- Author the deliverable as an **idempotent Python build script** (`build_vN.py`) that reads assets and emits the final HTML. Never hand-edit the giant output file directly; edit the script and rebuild. This prevents drift and makes every change reproducible.
- For a heavy existing file (base64 images inflate it to MBs), **decompose the body into top-level blocks** with a depth-aware tag scanner, save each block, then reassemble in the desired order. Whole-section replacement is far safer than string-anchored micro-edits.
- Keep `<head>` (fonts, base CSS, design tokens) stable; inject new component CSS as a single appended `<style id="vN">` before `</head>` so you never fight the existing cascade.
- Work in **stages** (assets → CSS → sections → reviews). Long single scripts risk one bug wiping the run; staged edits + rebuild + verify is resilient and survives context limits.

## 2. Programmatic visual QA beats eyeballing

Treat rendering correctness as testable, not visual. Run a Playwright/Chromium audit every build:

- **Horizontal overflow:** for every element, flag `rect.right > viewportWidth+1 || rect.left < -1`. Also compare `documentElement.scrollWidth` vs `clientWidth`.
- **Containment:** verify absolutely-positioned children stay within their container bounds (e.g., ring nodes inside the ring) with a small tolerance.
- **Aspect ratios:** assert `width/height` of media boxes (e.g., 0.5625 for 9:16, 1.78 for 16:9).
- **Responsive structure:** read `getComputedStyle(el).gridTemplateColumns` and assert column counts collapse correctly per breakpoint.
- **Image load:** assert every `img.naturalWidth > 0`.
- **Measure at REST:** scroll the target into view, then wait for reveal/transition animations to settle (~1.5–2s) before measuring. Mid-animation measurements produce false positives (e.g., a reveal `translateY` momentarily pushes an element out of bounds).
- Route-abort external domains (`page.route('**youtube**', r=>r.abort())`) to keep audits fast and offline.

## 3. RTL is a coordinate-system minefield

- **Logical vs physical insets:** in RTL, `inset-inline-start` = physical **right**, `inset-inline-end` = physical **left**. This silently inverts markers/fills. When a value has a fixed physical side, use physical `left`/`right` and verify at rest.
- **Gradients do not flip in RTL.** `linear-gradient(90deg / to right)` still runs left→right regardless of `dir`. To make low→high read right→left, use `to left` explicitly and align scale labels accordingly.
- **Play triangles:** a CSS-border play glyph must use physical `border-left` (colored left border → points **right** ▶). Logical `border-inline-start` points left in RTL (looks broken/backwards).
- **Tooltip/label near an edge:** anchor it to the marker with physical `right`/`left` and give it its own background pill so it stays readable and never overflows a narrow gap. Prefer placing delta labels *inside* the colored fill at its boundary rather than in the (possibly tiny) empty remainder.

## 4. CSS cascade traps that cost real time

- **Reveal-on-scroll transform clobbers centering.** A `.rise{transform:translateY(22px)}` (and its `.in{transform:none}`) will override an element's own `transform:translate(-50%,-50%)`. Never put the reveal class on an absolutely-centered element; animate a **wrapper** instead.
- **Media query vs later plain rule.** Media queries add no specificity. A plain `.x{grid-template-columns:1fr 1fr}` declared *after* a `@media(max-width){.x{...:1fr}}` will win at all widths. Put responsive overrides **after** the base rule (or raise specificity).
- **Grid fixed-height + `place-items:center` stretches rows.** With `align-content` defaulting to stretch, two short items in a tall grid get pushed apart (unexpected large gap). Use `display:flex;flex-direction:column;justify-content:center;gap:Npx` for tight centered stacks.

## 5. Responsive grid distribution (avoid the lonely last item)

- `repeat(auto-fit, minmax(Xpx, 1fr))` fills each row (auto-fit collapses empty tracks and stretches items).
- Tune `X` against your item count and target container width: avoid layouts where `itemCount % columns == 1` (a single stretched/lonely item on the last row). For N=11, choose `X` so the widest breakpoint fits all 11 in one row and narrower ones wrap to rows of ≥3.
- A right-clustered flex row in RTL leaves the physical-left side empty; a grid that fills the track width fixes it.

## 6. Embedded video (YouTube/Shorts) the robust way

- **Sandboxed app previews block external embeds.** The in-app preview runs pages in a sandbox that forbids YouTube iframes: the poster shows, the video won't load. This is environment, not code. Verify in a real browser (Safari/Chrome) or via the direct link.
- **Facade pattern, click-to-load only.** Keep a lightweight poster always visible; inject the real `<iframe>` on click/Enter. **Never auto-swap** poster→iframe on scroll: if the embed fails, the auto-injected iframe renders a black box. Manual click means the poster never disappears unexpectedly.
- **Always provide a visible direct link** (`youtube.com/shorts/{id}` or `watch?v=`) as a guaranteed fallback that works everywhere.
- **Aspect + params:** Shorts are 9:16, use a `aspect-ratio:9/16` container. Embed URL: `youtube.com/embed/{id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`. Autoplay needs `mute=1` or a user gesture; a fresh click-injected iframe with `autoplay=1` is honored.
- You cannot confirm pixel playback in an offline/sandboxed build env. Confirm the **mechanism** instead: click → assert an `iframe` with the correct `src` was injected and the request fired.

## 7. Arabic / RTL typography and copy QA

- No `letter-spacing` on Arabic (it breaks cursive joins); scope any letter-spacing to Latin only. No uppercase on Arabic.
- Quotation: Arabic guillemets «...» only; straight double quotes only in English. Numerals: Western (123) by default for commercial work; Eastern (١٢٣) only for fully-Arabic institutional/government deliverables.
- **Automate copy gates** on the emitted text (strip base64/SVG/style/script first):
  - em-dash count must be 0 (banned).
  - piled passive-voice detection: regex `[يت]ُ[\u0621-\u064A]{2,}` surfaces `يُفعل`-family tokens; whitelist only deliberate locked phrases.
  - Eastern-digit leak: `[٠-٩]`.
  - straight-quote-in-Arabic and foreign-reference scans (e.g., currency/global terms that break a local pitch).
- Run **three review layers** every build and report each: (1) correctness (banned patterns, grammar, numerals), (2) fluency/eloquence (stiffness, redundancy, connectors), (3) consistency (terminology, numbers/dates, register, jargon removal).

## 8. Asset integrity under filename collisions

- Client uploads frequently reuse auto-generated names (e.g., the same filename for different images), so a later upload **overwrites** the earlier on disk. Symptom: "I can't capture the image you sent."
- **Lock critical assets immediately** into uniquely-named snapshots (write base64 to `design_x_b64.txt`) so subsequent uploads can't clobber them.
- When the visual tool is unreliable, **fingerprint images by average pixel color** (top strip / center) to identify subject (e.g., blue-dominant top = sky/facade; warm = indoor). Confirm dimensions/aspect to disambiguate.
- Keep a `links.txt` (or equivalent) of every reference URL the client provides, in the archive, then reuse it instead of re-asking.

## 9. Standard verify-gate checklist (run before every hand-off)

1. `python3 build.py` succeeds; output size sane.
2. Tag balance for `section/div/ul/li/svg/a/style/script` (open == close).
3. `node --check` on the extracted `<script>`.
4. No leaked placeholders (`__X__`), no `src=""`, no dead `href="#"` where a real link is expected.
5. Copy gates: em-dash 0, passive whitelist only, no Eastern digits, guillemets present, no foreign refs.
6. Geometry at ≥3 widths (phone / tablet / desktop): overflow 0, containment ok, aspect ratios ok, grids collapse.
7. Interaction functional tests: tabs toggle, scroll-triggered fills add their class and reach correct proportions, click handlers inject/route correctly, all links resolve to real targets.

## 10. Data-viz micro-pattern: the "smart combined bar"

Encoding two related numbers in one bar is more compact than two parallel bars:
- Track full width = reference value (e.g., market price).
- Colored fill = your value (`fill% = your/reference`).
- The un-filled remainder = the delta (saving). Put the delta label as a small pill **inside the fill at its inner boundary** with its own translucent background, so it is always legible regardless of gap size and never cramped.
- Animate `width` from 0 to `--w` on scroll-into-view for a confident reveal.

## 11. Playwright/Node test hygiene

- Heredoc + template-literal quote collisions (using `'` inside a backtick string) silently break Node with "Unexpected end of input". Keep console strings simple; build them with `+` concatenation, avoid nesting quote types.
- f-string + inline SVG/JS: a missing closing quote inside a generated SVG path cascades into a Python "unterminated string literal". When generating markup via helper functions, keep the SVG argument a single well-closed string; prefer a helper that injects attributes rather than `.replace()` with escaped quotes.

## 12. Runtime resilience: content must never be trapped invisible

The single worst failure in a client-facing page is a blank or half-empty screen because one animation hook did not fire. Reveal-on-scroll is an enhancement, never the thing that decides whether content exists. Build it belt-and-suspenders:

- **Reveal failsafe triad.** (1) IntersectionObserver adds `.in`/`.visible` and unobserves. (2) On `load`, sweep every not-yet-revealed element and reveal any already inside (or just above) the viewport (`rect.top < innerHeight*1.05`), so above-the-fold content is never waiting on a scroll that will not happen. (3) A hard `setTimeout(revealAll, ~3000)` reveals everything regardless. If the observer silently fails (old engine, error earlier in the script), the page still fully renders.
- **`.js` guard, first line of `<head>`.** `<script>document.documentElement.classList.add('js')</script>`. Scope the hidden/offset reveal state behind `html.js .rv{...}`. A no-JS render, or one where the script throws before setup, then shows all content at rest instead of a permanently invisible page. Progressive enhancement, not JS-dependence.
- **Loader dismissal is double-guaranteed.** Hide on `load` (with a small delay for polish) AND an absolute fallback timeout that hides it "no matter what" (~2.5s). A splash that can get stuck is strictly worse than no splash.
- **Single-fire guards on expensive animation.** Count-ups and one-shot sequences use a boolean flag plus `unobserve` so a re-entering element cannot restart or double-run them.
- **Passive scroll listeners always** (`{passive:true}`) for progress, nav, and rails. Never do layout-thrashing work synchronously on every scroll event.
- **Honor `prefers-reduced-motion`.** Gate non-essential motion and ship a static resting state for users who ask for it.

## 13. Scroll-UX kit (house-standard components, reuse verbatim)

- **Reading progress ring.** Fixed circular SVG, `stroke-dasharray = circumference = 2*pi*r`. Drive `stroke-dashoffset = C*(1-p)` where `p = scrollTop / (scrollHeight - clientHeight)` clamped to 0..1. Rotate the SVG `-90deg` so it fills from the top.
- **Mobile rail fallback.** Below ~820px, hide the ring (it reads as clutter on a narrow screen) and show a thin vertical rail whose inner fill `height = p*100%`. Same signal, less furniture.
- **Top progress bar variant.** Cheapest option: set a CSS var `--progress` from JS and let CSS paint the width. Use when a ring is too heavy for the piece.
- **Scroll-spy nav.** IntersectionObserver with `rootMargin:'-30% 0px -50% 0px'` so a section only counts as "current" once it crosses the middle band of the viewport; toggle `.active` on the matching anchor. This avoids the flicker you get when sections are marked active at their very top edge.
- **Smart nav hide/show.** Compare current vs last `scrollY`; add `.hidden` past a small threshold when scrolling down, remove when scrolling up. Keeps the chrome out of the way without ever hiding actual content.
- **Count-up numbers.** `requestAnimationFrame` tween (`p = (ts - start)/duration`), target from `data-count` and optional `data-suffix`, fired once at IO threshold ~0.3. Always rAF, never `setInterval`.
- **Anchor blips / scroll-to dots.** Interactive markers that call `scrollIntoView({behavior:'smooth',block:'start'})` on a `data-go` target. Make them real `<button>`s so they are focusable and keyboard-operable.

## 14. Self-contained shell: tokens plus embedded fonts

- **The `:root` token set is the house floor.** Minimum contract every deliverable inherits: a surface ramp (`--bg`, `--panel`), an ink ramp (`--ink`, `--ink-2`, `--ink-3`), the brand palette, one signature `--grad`, a single `--ease` (one cubic-bezier reused everywhere), and `--pad` via `clamp()` for fluid gutters. One shared easing and spacing scale is what makes a piece read as "designed" rather than "assembled".
- **Embed fonts as `@font-face` base64 woff2, `font-display:swap`,** one face per weight actually used. Payoff: fully offline, no external font CDN, no FOUT from a slow host, no deploy-collision with the assets domain, and the brand face (Lato / Alyamama / itfGhroob) is locked into the file. Cost is file size, which is acceptable for a single-file client deliverable.
- **`<meta name="robots" content="noindex,nofollow">`** on private client deliverables, so a forwarded link never gets indexed.

## 15. Arabic numeral formatting is a function, not a find-and-replace

The numerals rule (Western by default, Eastern only for fully-Arabic institutional or government work) needs a real formatter the moment a number is dynamic (counters, computed totals, percentages). Swapping 0-9 for the Eastern glyphs alone is wrong, because the separators change too.

- Digits: 0-9 to ٠١٢٣٤٥٦٧٨٩ (U+0660..U+0669).
- Decimal point to ٫ (U+066B), thousands separator to ٬ (U+066C), percent sign to ٪ (U+066A).
- The formatter runs on **display values only**. Western digits stay inside identifiers, codes, phone numbers, URLs, and English fragments even inside an Arabic document.
- A JS counter that must show Eastern digits has to run **every frame's value** through the converter, not only the final number.

```js
// display-only Arabic numeral formatter
const AR = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
function toArabic(str){
  return String(str)
    .replace(/[0-9]/g, d => AR[+d])
    .replace(/\./g, '٫')   // decimal
    .replace(/,/g, '٬')    // thousands
    .replace(/%/g, '٪');   // percent
}
```

## 16. Signature motion vocabulary (abstracted, reusable)

- **Radar sweep.** A rotating `conic-gradient` layer masked into a thin ring: `mask: radial-gradient(circle, #000 0 49.4%, transparent 49.8%)`. The mask turns a filled cone into a sweeping arc riding a ring.
- **Ripple pulses.** Absolutely-centered circles animating `transform:scale()` toward 0 opacity, staggered with `animation-delay`, for a live "scanning" feel.
- **Glow blips.** Small dots with a `box-shadow` glow and a breathing-opacity keyframe; as `<button>`s they double as scroll anchors.
- **Slow mark turn.** `animation: turn 40s linear infinite` on the logo, so the brand asterisk reads alive without pulling focus.
- **Discipline.** Motion is slow (multi-second) and staggered, never fast or simultaneous. One or two signature motions per piece, everything else still. This is the motion equivalent of the "Syne 800 for display moments only" restraint.

## 17. Template as a contract (reusable masters)

- **A master carries its own header contract** in an opening comment: version plus date, standing decisions (for example "NO PHOTOS by standing decision"), a `[BRACKETED_SLOT]` inventory, a pointer to its guide file, and a pre-send gate line ("never send before: gates pass, Tier A email sighted, 3-width screenshot QA, zero em dashes"). The template teaches its own rules to whoever fills it next.
- **One master, many fills.** Keep slots explicit and greppable (`[BRACKETED_SLOT]`) so the build script can assert none are left unfilled (this feeds the verify-gate "no leaked placeholders" check).
- **Version masters like code** (v2.3) with a one-line changelog comment, so lineage stays legible across sessions and models.

## 18. Client-side gating is UX, not security

A gate that reveals content after an action (a passphrase, a click, a role choice) is an experience layer, never a real security boundary. Anything shipped to the browser is readable by anyone with the file, including base64 assets and any "encrypted" payload plus the key needed to open it.

- Use gates for pacing and focus (reveal one act at a time), not to protect data.
- If content is genuinely sensitive, it does not belong in a static client-side file at all; keep it server-side behind real auth.
- Model role and capability as plain data (a capability matrix keyed by role) so the gating logic stays legible and auditable, and never confuse "hidden in the UI" with "not present in the payload".

---

### One-line summary
Author from a rebuildable script; verify geometry and copy programmatically at rest across breakpoints; respect RTL's physical-vs-logical inversions and non-flipping gradients; make content resilient (reveal failsafes, `.js` guard, guaranteed loader dismissal) so nothing is ever trapped invisible; ship a self-contained shell (design tokens plus embedded fonts) with the house scroll-UX kit and a real Arabic numeral formatter; use facade+link for video; lock assets against name collisions; treat client-side gates as UX not security; and gate every hand-off with an automated checklist.
