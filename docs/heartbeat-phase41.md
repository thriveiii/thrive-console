# The heartbeat: when even the failsafe is silent, the silence is the datum (P41)

## Ground: what the 06135c86 run proves, coldly

The stamp advanced on the failing device (73cd9340 to 06135c86). Sign-in ran, the loader passed, the
screen went black, and the P40 surface produced NOTHING: no error panel, no watchdog panel. No false
success is claimed; the absence is the finding. A live failsafe registered first on the page cannot stay
silent through a 12-second black screen unless one of exactly three things is true:

- **A.** The black document never ran the failsafe at all: the post-sign-in step navigated to a document
  that is dead (a route resolving to an empty/cached shell, a script path that 404s there, a page the tag
  was never injected into). Timers, error hooks, and watchdogs die with the old document.
- **B.** The main thread is synchronously blocked: a tight loop after the data arrived (parse, merge, sort,
  render) freezes the tab, so `setTimeout` never fires (no watchdog), error events never dispatch (no
  panel), no network leaves (matches the edge log going silent after the 200s), and no paint occurs.
- **C.** The board painted dark on dark: a stylesheet break on the post-auth document renders content with
  no visible foreground. The failsafe correctly sees a painted state and stays silent by law.

## The zero-code discriminator (ten seconds, before anything else)

On the black screen, long-press and try to select text.
- **Text selects** -> branch C: the board is present and invisible; the fix is a CSS/scope defect on the
  post-auth document, no logic involved.
- **Nothing selects** -> branch A or B; the heartbeat below separates them.

## What was added: a visible heartbeat

`library/failsafe.js` now creates, at PARSE TIME on every document (before any other script), a one-line
strip at the top of the viewport (imperative DOM, own inline style, no app CSS, `textContent` only):

    boot <mark> · build <stamp>

It updates on every existing boot checkpoint, appends `· rows <n>` at payload-parsed (count only, never
content), and REMOVES itself 3 seconds after the "board painted" mark, so a healthy boot shows a brief line
and loses it (the P36 no-lingering-diagnostics spirit). It is temporary: deleted in the closing PR of this
outage.

It is driven off the P40 checkpoint globals via accessors on `window` (`__bootMark`, `__boardRows`,
`__bootPainted`), so every assignment the app already makes updates the strip and **no further app change
was needed**. Reads still return the stored value, so the P40 panel and watchdog behave exactly as before.

### What one photograph now decides, with no interpretation

- **No strip at all** on the black screen -> **branch A**: the dead document is the defect. The fix targets
  the post-sign-in navigation target (route, path casing, 404, stale cache shell).
- **Strip frozen at a mark** -> **branch B**: the frozen mark NAMES the step holding the thread (board
  request sent / response received / payload parsed / board painted). The fix is surgical at that step.
- **Strip reaches "board painted" and the screen is still black** -> **branch C**, confirmed by machine
  rather than by finger; CSS trace on that document.

The P40 watchdog and error panel are untouched.

## Evidence

- **`tools/failsafe_surface_test.js`** (Node, DOM-shimmed), all pass, fails-when-broken proven (neutering
  the mark accessor reds H2):
  - the heartbeat renders at parse time with the mark and build;
  - assigning `window.__bootMark` (the app's existing assignment) drives the strip, so a frozen strip names
    the branch-B step;
  - it appends `rows <n>` (count only) on `__boardRows`;
  - it self-removes 3s after the board paints;
  - it never contains a token value.
  - The P40 panel and watchdog cases still pass unchanged.
- Sample heartbeat (rows 0 case), captured from the harness: `boot payload parsed · build 06135c86 · rows 0`.
- **Gates:** `verify.js` 35/35 (incl. zero em dashes), `arabic.py` 0 failed, `bare_metal_auth` 0 failed,
  `session_integrity` / `signin_resilience` / `deploy_marker` / `fresh_code` all pass. Western numerals;
  shipped-shell isolation grep 0; the build stamp advances (67d16c40). Pre-existing benign exception:
  `supabase_stage1` "no Lotus reference".

### Device-gated (Thyab, fresh stamp first)

1. Confirm the new stamp on the failing device before any judgment; clear site data if it does not advance.
2. Attach the photograph of the strip (or its absence) to the PR thread; it selects the next fix. No fix is
   authored before the photograph exists.
3. Healthy desktop boot: the strip appears briefly, removes itself, no other pixel changes.

## Standing debt, still open

The read-only members SQL from P40 (information_schema first, then the operator's membership row for
38864a57-4d66-4525-a4a4-d83880c2ce63) has not been run. If BOARD ROWS prints 0, that SQL is the next step
and the fix is data, not client code.

## Do not (held)

Nothing is fixed here; reveal only. No token value or row content is printed (counts and marks only). The
P40 surfaces are untouched. The auth request, keys, DB, Lotus, and newsroom are untouched. Author only, not
merged, not released.
