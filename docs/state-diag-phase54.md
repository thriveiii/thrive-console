# Read the true post-sign-in state on the device: a gated on-screen diagnostic (P54)

## Why a readout, not another fix

On the failing device, build `6bd68db9` (P52 relay-starvation fix + P53 render-race fix both landed), every
network request returns 200 (token, `console_settings` twice, `console_board`), the console shows zero
errors, and `manifest.json` is never requested. Yet the sign-step strip still reads `token:sent`. But the
strip is a proven-unreliable instrument: `reveal()` covers it at unlock, and the twice-seen `console_settings`
reads only fire AFTER `token:ok`, so the code did pass `token:ok`. We do not know the TRUE state, and the
board's real condition cannot be read from the strip.

A standalone page cannot read another tab's console state (no cross-tab access), so the only correct way to
read the true state on the iPad, with no DevTools, is a readout on the console page itself. This adds one,
gated behind `?diag=1` so it never appears in normal use.

## What it prints

`initStateDiag` (in `library/app.js`, run at `DOMContentLoaded`) appends a fixed on-screen panel ONLY when
the URL carries `diag=1` (`console.html?v=<build>&diag=1`, or `#...&diag=1`). It refreshes every second so a
photo taken any time after sign-in captures the live state. `textContent` only; it prints counts, flags and
marks, never an email or a token, and it starts no request and never touches auth, the reads, or the render
path. The lines:

- `signedIn` (from `ThriveSupa.signedIn()`)
- gate element present/removed, its computed `display`, and `html.gate-locked`
- `view-board` hidden
- `boardLanes` innerHTML length
- rendered `.tok` card count, and per-lane card counts
- `__renderGen`, `__boardViewReady`, `__boardView` row count, `__boardRows` (last server read)
- `__bootMark` and `__signMark`

It lives in `app.js` (a BUILD-hashed source), not the shell, so shipping it changes the build stamp
(`6bd68db9` -> `4da880d7`); the root redirect's `?v=<build>` therefore changes and the device fetches a fresh
page rather than a cached one.

## The discriminating read (iPad, `?diag=1`, after sign-in)

- **Gate overlay still `display != none` over a board with large `boardLanes` innerHTML and `.tok` count > 0**
  -> the board IS painted but the gate never hid. The fix is the reveal / gate teardown, not rendering.
- **`boardLanes` innerHTML small, `.tok` count 0, `__boardView` rows 0** -> the board truly did not render, or
  the read returned no rows. The fix is there (render path or the view read), and `__boardViewReady` plus
  `__boardRows` say which.

Report which pair the photo shows, and the next fix brief writes itself.

## Regression fence (held)

Not touched: auth, the request shape, the Supabase reads (all proven 200), the relay, RLS, the board render
and its adopt-empty safety, Lotus and the newsroom, Arabic/RTL. The panel is inert unless `?diag=1` is present
and never mutates state. The sign-step strip and its marks are kept.

## Evidence

- `verify.js` 35/35. Every `*_test.js` green (including the P52 `warmboot_sync_defer_test` and the P53
  `unlock_render_race_test`), apart from the pre-existing, unrelated `supabase_stage1` "no Lotus reference"
  (docs prose, identical on origin/main).
- New guard `state_diag_test.js` (D1 to D9): gated on `diag=1` with an early return, prints via `textContent`
  only, reads the render/adopt internals and the paint facts, refreshes on a tick, leaks no secret, and lives
  in a BUILD-hashed source so the stamp changes.
- `operator_gate_test` (real gate paint, session persist, sign-out) green: the panel is inert without
  `?diag=1`, so normal boot is unchanged.
- Shipped `console.html` isolation grep clean; no em dash in the diagnostic; Western numerals.

## How to use it (Thyab)

On the failing iPad, open `console.html?v=4da880d7&diag=1` (or add `&diag=1` to the URL), sign in, and
photograph the panel at the bottom of the screen. The panel's presence confirms the fresh build; its lines
say whether the board painted behind a stuck gate, or never rendered.
