# BOOT_PAINT_FIRST: the index boot never holds a black screen (brief P55)

## The governing principle

No network call may hold the first board paint. After the gate hands off, the board paints FIRST from cache
and the mirror, synchronously, before any network; every boot network call is deferred until after paint and
time-boxed, so a hang degrades to a stale board plus a "reconnecting" note, never a black screen. This is the
gate's complete-or-fail-visibly philosophy (P54) applied to the post-gate boot.

## The defect (Defect B, isolated)

`renderBoard(trigger)` awaited `ensureManifest()` and then `readBoardViewRows()` (the console_board read)
BEFORE it ever called the synchronous `render()`. On a starved WebKit a boot read could hang, so `render()`
was never reached and the console stayed black after "Opening the Thrive Opportunity Library". This is not
auth (cured and device-proven in P54) and not the session (warm boot persists): a pre-paint await simply
never settled.

## Part 1: paint-first boot order (library/app.js, renderBoard)

renderBoard is reordered so the FIRST thing after the settle starts is the synchronous paint from local data:

1. `boardRepaint(myGen, trigger)` runs `render()` immediately from `manifestNow()` (the cached manifest) plus
   local drafts plus the last-adopted console_board map. build() is fully synchronous, so no network can hold
   this paint. `render()` sets `window.__boardPainted`.
2. If there is genuinely no local snapshot yet (a true cold start), `bootLoadingNote()` shows a visible
   "loading" state instead of the bare empty panel, never a black screen.
3. ONLY THEN does the hydrate run: the manifest (if not cached) and the console_board view read, each awaited
   but bounded (Part 2). On a successful read the settle adopts and repaints to the fresh stages. Because all
   reads return the same server view, the adopt is generation-independent: a successful read adopts and
   repaints even if a concurrent sync settle bumped the generation while we read (only a teardown drops it),
   so `await thriveBoardRefresh()` deterministically ends on the adopted view.

## Part 2: time-box every boot network call (BOOT_NET_TIMEOUT)

`bootNet(name, promise)` wraps every boot-path call in ONE hard timeout (`BOOT_NET_TIMEOUT`, 6s, one place).
On timeout the call rejects typed `boot-net-timeout`, the boot continues on the already-painted board, and the
call is retried by the ordinary sync round. No boot await is unbounded: a hung manifest.json or console_board
read resolves the settle in at most 6s with the board still painted plus a small "reconnecting" note.
`window.__bootNet[name]` records each call's outcome (ok / timeout / error / pending) and elapsed ms.

## Part 3: relay/echo fully deferred until after paint

`autoSyncTick` and `scheduleSyncPush` now hold on `window.__gateRevealed` AND `window.__boardPainted`
(GATE_V2 Part 5 extended). The relay/echo is a post-paint background concern only; it can never precede the
first paint, directly or transitively. `renderBoard` still releases the first automatic relay round at the end
of the settle (after the synchronous paint), exactly once.

## Part 4: a boot watchdog that guarantees a screen

One boot watchdog, armed on the gate handoff (`onThrive("unlock","bootwatchdog", armBootWatchdog)`): if
`window.__boardPainted` is not true within 8s, it forces the paint-from-local path
(`window.thriveBoardRefresh()`) and shows the "reconnecting" note. It fires at most once and only backstops
the (already synchronous) paint-first path; it does not stack a second watchdog on this path.

## Part 5: the diag boot block (?diag=1)

`initStateDiag` adds a boot block: `__boardPainted`, whether any relay/echo call fired before paint (should be
`no`; instrumented by `window.__relayBeforePaint`), and the list of boot-path net calls with each one's
outcome and elapsed ms (`window.__bootNet`). `__bootMark` and the GATE_V2 / `__lastTokenDiag` blocks are
untouched; this only ADDS the boot block, so a residual boot stall is self-naming in one photo.

## Part 6: no environment sniffing

The fix is structural, not conditional: there is no tab-count, battery, or WebKit-version logic. Paint-first
plus time-boxing make the boot robust on a starved WebKit without inspecting it.

## Prohibitions held

No change to the gate, the auth/session contract, board data content, relay message content, Lotus, the
newsroom, keys, RLS, or the DB. No new dependencies. No em dash. Two i18n keys were added in the existing
structure, EN and AR (`board_loading`, `board_recon`); `arabic.py` verifies parity.

## Evidence

- `board_one_read_test` reconciled to the paint-first contract and green: from an empty view map, one awaited
  settle paints the view counts (never a persisted Sent 0 while online); ten consecutive refreshes are
  identical (counts + paint hash, zero DIVERGED); a transient empty read never blanks a loaded board; the
  manifest-only card stays record-only. The one source assertion now reads "paints from local first, then
  reads console_board time-boxed (bootNet), adopts + repaints on the live generation."
- `board_server_stage_test` green. `render_orchestrator_test`'s source contract still holds (renderBoard keeps
  `const myGen=++__renderGen` and the generation guard).
- `verify.js` 35/35, `arabic.py` 0 failed. Node source-contract tests `warmboot_sync_defer_test`,
  `unlock_render_race_test`, `state_diag_test` green. Isolation grep (lotus / newsroom) is 0 in
  `library/console.html`.

## Acceptance (device-gated, the only definitions of done)

1. Fresh build stamp on the failing iPad.
2. Photo: the loaded board after sign-in, within a few seconds, no black screen.
3. Three refreshes: the board repaints from cache each time, then hydrates. No black screen on any refresh.
4. A hung relay/board read: the board still paints, a "reconnecting" note shows, no black screen.
5. Basel and Mohammed reach the board on their own devices; photo each.
6. `?diag=1` shows `__boardPainted: true`, no relay/echo call before paint, every boot call ok or
   background-retried (none pending-blocking).
