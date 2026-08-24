# The board painted blank: an unlock render race, not a network hang (P53)

## The device evidence that isolated it

Chrome DevTools on the failing device, build `f7c88b8b` (the P52 build), after one sign-in:

- **All seven requests returned 200**: the token preflight, the token POST (1.8 KB), `console_settings` twice,
  `console_board`, and the relay `exec`/`echo`. The P52 connection fix held: the post-auth Supabase reads no
  longer hang.
- **The console showed zero errors.** No throw at render time.
- **`manifest.json` was never requested.** So the one unbounded fetch (`loadManifest`) named as the last hang
  candidate is not involved.

So the board did not fail on the network and did not hang on a fetch. Every read succeeded and adopted its
rows, yet the board settled blank. That leaves exactly one mechanism: a render race on unlock.

## The mechanism

On sign-in, `fireThrive("unlock")` fires several board renders in the same tick, and the shell router does
something destructive among them:

- the app-level board handler: `onThrive("unlock","board", ()=>renderBoard("unlock"))`;
- the `supahydrate` handler, which called `thriveBoardRefresh()` immediately (a second render) on top of
  kicking the deep hydrate;
- the **shell router** (generated from `tools/bundle.js`), whose unlock handler marked every started view
  stale and called `show(current())`. For the currently-visible board that path **resets the view DOM to its
  empty boot snapshot** (`el.innerHTML = snapshot[id]`) and re-runs `initBoard`.

`renderBoard` guards concurrent renders with a single `__renderGen` counter: each render bumps it and any
render that is no longer the latest returns early WITHOUT painting. With three renders interleaving and the
shell resetting the DOM mid-flight, the surviving render either lands into a container that was just wiped, or
a non-painting (superseded) render is the last to touch the board. Net: reads adopt rows, but the board is
left showing the empty boot snapshot. The sign-step strip, covered by `reveal()` at unlock, keeps its last
painted mark, which read as `token:sent` even though sign-in had completed.

## The fix, one concern, off latest main

Auth, the request shape, the Supabase reads (all proven 200) and the relay are untouched. This only changes
how the board is re-rendered on unlock.

1. **The shell no longer resets the visible view on unlock (`tools/bundle.js`).** The unlock handler still
   marks the other started views stale so each re-inits cleanly on its next navigation, but it re-shows the
   current view ONLY if it never started (a deep link straight into it, a clean first mount with no reset). A
   started, visible view is refreshed in place by its own unlock handler and is never wiped:
   `Object.keys(started).forEach(function(k){ stale[k]=1; }); if(!(cur in started)) show(cur);`.
2. **One immediate board render on unlock (`library/app.js`).** The `supahydrate` handler no longer also
   calls `thriveBoardRefresh()` in the unlock tick. The dedicated board handler
   (`onThrive("unlock","board", renderBoard)`) is the single immediate render; `supaEnsureHydrated` still
   provides the deferred deep-hydrate refresh when the hydrate resolves (`supaHydrate().then(... thriveBoardRefresh())`),
   which is the sequenced final render that paints the adopted rows.

With no DOM reset and one immediate render, the board handler's `renderBoard("unlock")` reads `console_board`,
adopts, and paints into a stable container; the later deep-hydrate refresh repaints the same board. The
`__renderGen` guard now only ever settles on a render that actually paints.

## Regression fence (held)

Not touched: the Supabase URL, anon key, password-grant endpoint, request body, token/session model, and auth
semantics; RLS; the relay; the board's stage computation and its adopt-empty safety; Lotus and the newsroom;
Arabic/RTL. The sign-step strip and its `token:sent`/`token:ok` marks are kept through this PR.

## Evidence

- `verify.js` 35/35. Every `*_test.js` green, including the P52 `warmboot_sync_defer_test`, apart from the
  pre-existing, unrelated `supabase_stage1` "no Lotus reference" (docs prose, identical on origin/main).
- New guard `unlock_render_race_test.js` (U1 to U9): the shell no longer re-shows the current view
  unconditionally (guarded on `!(cur in started)`), still marks other views stale, the fix is in the
  generator source not only the generated file, one immediate board render survives, and the deep-hydrate
  refresh remains. Proven fails-when-broken: restoring the bare `show(current())` reds U1/U2.
- Browser gate paint green: `operator_gate_test` (real gate paint, session persist, sign-out),
  `board_one_read_test` (ten refreshes, no oscillation, transient-empty safety, all 0 failed).
- Shipped `console.html` isolation grep clean; no em dash in the changed shell and supahydrate regions;
  Western numerals.

## Device evidence gate (Thyab; fresh stamp first)

Confirm the fresh build stamp on the iPad, then one sign-in on the failing device:

- The board paints with its rows and lanes (photograph the loaded board with data).
- In Network, all reads stay 200.
- Basel and Mohammed sign in.

## The lesson (permanent)

One surface, one render owner. A view that has its own in-place refresh handler must not also be reset and
re-initialized by a shell router in the same event; concurrent renders behind a single generation guard are
safe only if none of them wipes the DOM the winner paints into. When a network fix unmasks a UI-layer race,
the next failure is measured in render order, not milliseconds.
