# Defer the warm-boot relay round: the sign-in freeze was a connection-pool race (P52)

## The device-proven root cause

Safari Web Inspector on the failing console page (build 7e38d639), plus git, settled it. The auth token
POST completes in 548ms: authentication is not the hang. What hangs are the three post-auth Supabase reads
issued right after it, `console_settings`, `console_settings`, `console_board`, all from `supabase.js:124`,
which sit as spinners and never return. Above them in the waterfall are the console's Apps Script relay
calls (the `exec` to `script.google.com` redirecting to the `echo` on `script.googleusercontent.com`), each
taking 1 to 5 seconds, all fired through `app.js`'s one relay wrapper `fetchT`.

The mechanism: on a WARM session the passcode sync credential (`syncAuth`) persists in `localStorage`, so
`startLiveSync` fired `syncNow` at `DOMContentLoaded`, before and independent of the operator's Supabase
sign-in. `syncNow` runs `doSyncRound`, a chain of slow Apps Script calls (state_get, state_put, hits_get,
inbound_get, outbox_status). Those slow cross-host connections occupied WebKit's connection budget while the
operator signed in, so the post-auth Supabase reads queued behind them and never got a socket. Because
`token:ok` is only reached after `signIn` returns and the board reads resolve, the sign-step strip stayed at
`token:sent` even though auth had already succeeded.

git dates the collision precisely. The warm-boot relay round is old: `doSyncRound` and the
`if(syncAuth()) syncNow()` boot trigger both landed 2026-08-01 (`24bffb3`, `c3ff1ae`). What is new is that
the console only started issuing a Supabase board read into that same window on 2026-08-14/15 (`7ecd341`,
`19203be`, "the board reads one server-computed stage"), which also placed a `console_board` read INSIDE
`doSyncRound`, interleaved between two relay POSTs. Before that, the board hydrated from local and sync
state with no cross-host read to lose the connection race. The freeze began exactly when the Supabase read
path started competing with the pre-existing relay polling.

## The fix, one concern, two changes

Auth is untouched. The request, keys, RLS, and request shape are all proven fine and frozen. This change
only reorders WHEN the relay polling starts.

1. **The first automatic relay round waits for the board read.** `startLiveSync` no longer fires `syncNow`
   or arms the 60s interval at `DOMContentLoaded`. Every automatic trigger (the boot attempt, the unlock
   hook, the interval) now routes through `autoSyncTick`, which HOLDS the first round until `firstSyncMayRun`
   is true: the `console_board` read has resolved (`__boardViewReady`) when that read is the authority, or
   there is no such read to compete with (the Supabase read path is off), whichever applies. `renderBoard`
   releases the held round once the board has painted (the settle), idempotently. A bounded 20s fallback
   guarantees background sync is never permanently disabled if the read never lands; in the healthy path the
   board read now resolves in well under a second because nothing is competing, so the settle release always
   fires first.

2. **The board read leaves the relay chain.** The `console_board` re-read that ran inside `doSyncRound`
   (interleaved between the slow Apps Script POSTs) is removed. The same heartbeat freshness is preserved by
   moving the re-read into the board render settle: `onThriveSync` fires the `"sync"` hook AFTER the round's
   relay calls complete, and `renderBoard` now re-reads the view on the `sync`, `unlock`, and manual-refresh
   triggers (in addition to the unconditional first-ever read), generation-guarded and adopt-empty-safe. The
   read stands alone and never interleaves with the relay chain again.

## Regression fence (held)

Not touched: the Supabase URL, anon key, password-grant endpoint, request body, token/session model, and
auth semantics; RLS; the board's stage computation and its adopt-empty safety; the relay endpoint, credential
and request shapes; Lotus and the newsroom; the one-document architecture; and Arabic/RTL behavior. The
sign-step strip and its `token:sent`/`token:ok` marks are kept through this PR, so the device can confirm the
strip now advances to `token:ok` and the board.

## Evidence

- `verify.js` 35/35. Every `*_test.js` green (`signin_click`, `signin_resilience`, `bare_metal_auth`,
  `session_integrity`, and the rest), apart from the pre-existing, unrelated `supabase_stage1` "no Lotus
  reference" (docs prose, fails identically on origin/main).
- New guard `warmboot_sync_defer_test.js` (W1 to W10): the eager boot round is gone, every automatic trigger
  routes through `autoSyncTick`, `firstSyncMayRun` holds on `__boardViewReady`, the bounded fallback exists,
  `renderBoard` releases after the paint, and `doSyncRound` no longer reads the board. Proven fails-when-broken:
  reintroducing the eager `syncNow` reds W1/W2, and re-inserting the `readBoardView` into `doSyncRound` reds W8.
- Reconciled to the relocated re-read: `board_one_read_test.py` and `board_server_stage_test.py` (both 0
  failed, live sections included), `arabic` 0 failed, `operator_gate_test` (real gate paint) all pass,
  `canonical_store_test`, `board_law_test`, `board_calm_test` all pass.
- Shipped client isolation grep clean: `console.html` has zero lotus/newsroom (the one dist hit is the
  long-standing benign `store.js:20` prose, unchanged here). No em dash in the changed sources. Western
  numerals.

## The device evidence gate (Thyab; fresh stamp first)

Confirm the fresh build stamp on the iPad, then one sign-in on the previously failing device:

- The strip advances `token:sent -> token:ok -> board`, and the board loads (photograph it).
- In Web Inspector, the `console_settings` and `console_board` reads COMPLETE instead of spinning.
- Basel and Mohammed sign in.

## The lesson (permanent)

Auth-critical cross-host reads must not share the boot window with slow background polling. Start background
relay work only after the session's essential reads have resolved and the surface has painted. A read added
to a hot path years after the polling that shares its connection budget is a collision waiting for the
slowest network to expose it; measure WHEN each request fires, not only whether it is correct.
