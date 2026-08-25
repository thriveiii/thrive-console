# GATE_BREACH: route the operator sign-in to the proven standalone page (brief P56)

## Decisive device evidence (build 0990dea0, the P55 paint-first build)

The on-screen diag strip read `boot board painted · build 0990dea0 · sign token:sent`, with the operator
stuck on the in-console operator card showing "Signing in" and a spinner, after dozens of attempts. Reading
it precisely:

- `build 0990dea0` and `boot board painted`: the P55 paint-first build is deployed and the black screen is
  cured (the board paints behind the gate).
- `sign token:sent`: `signIn` set `__signMark = "token:sent"` and never reached `token:ok`. The **in-console
  operator sign-in token POST hangs** (each attempt times out at the 15s bound, then Retry, repeated).

This is the same WebKit token-POST hang the whole week fought. It completes in ~250ms on the **standalone**
`authtest.html` / `gate.html` (a tiny page with no other console code running), and hangs in the **loaded**
console. BARE_GATE (P54) built the standalone `gate.html` for exactly this, but the operator is landing on
the in-console gate (a bookmarked `console.html`, or the in-console operator step after an expired/lapsed
session), so they never get the proven path.

## The fix

The **operator network sign-in** is routed to the proven standalone `gate.html`. The passcode stays
in-console (local PBKDF2, no network). Only the step that hangs, the token POST, moves to the clean page.

### `library/gate.js`
- `showOperatorStep` now calls `redirectToGate()` right after the no-Supabase guard and returns on redirect,
  so the in-console operator card (whose token POST hangs) is not the sign-in surface.
- `redirectToGate()` navigates to `../gate.html` (the standalone gate at the site root), guarded by:
  - `window.__gateNoRedirect` (a test / deliberate override keeps sign-in in-console), and
  - a **one-shot bounce guard** (`thrive_op_bounce`, a 20s localStorage timestamp): if the operator returns
    from `gate.html` and still lands on the operator step within 20s (the session mirror failed to carry),
    the redirect is suppressed and the in-console card is shown instead, so a mirror failure can never loop.
- `finish()` clears the bounce guard, so a resolved gate never blocks a later legitimate redirect.
- The in-console fallback card carries a visible link to the clean page (`op_clean_page`, EN + AR), so even
  in the fallback the operator can reach the proven path in one tap.

### `library/styles.css`
- `.gate-alt`: a small, visible, tappable link style for the clean-page link.

## Why this is the right fix

The evidence is unambiguous: the identical request completes on the standalone page and hangs in the loaded
console (page weight + memory pressure on a starved WebKit). Matching the request shape was already done
(P46/P50/GATE_V2) and did not help, because the difference is the **context**, not the request. The only
proven-working context is a standalone page, which is exactly what `gate.html` is. Routing the sign-in there,
with paint-first (P55) making the subsequent console transition immediate, is the smooth path in.

## Flow (no loop)

Cold / expired operator on `console.html` -> passcode (in-console) -> operator step -> redirect to
`gate.html` (presence is fresh, so `gate.html` shows its operator step directly) -> proven sign-in -> writes
the session mirror + presence -> `index.html?warm=1` -> the router forwards to `console.html` -> the console
reads the mirror (signed in) -> board. `finish()` clears the bounce guard. If the mirror fails to carry, the
next operator step within 20s shows the in-console fallback card (with the clean-page link) instead of
redirecting again.

## Prohibitions held

No change to the passcode crypto, the auth/session contract, the board, the relay, Lotus, the newsroom, keys,
RLS, or the DB. No new dependencies. No em dash. `op_clean_page` added to the existing gate STR in both
locales.

## Evidence

- New `tools/gate_breach_test.js` (Node source contracts, fails-when-broken): showOperatorStep routes to
  gate.html after the no-Supabase guard; `redirectToGate` targets `../gate.html` via `location.assign`,
  guarded by `__gateNoRedirect` and the one-shot bounce, and marks the bounce; the guard is a bounded 20s
  one-shot and `finish()` clears it; the fallback card carries the clean-page link in both locales; the link
  is styled; no empty catch or em dash introduced.
- `operator_gate_test` reconciled to set `window.__gateNoRedirect` (it exercises the in-console fallback card,
  the path shown when the redirect is suppressed or bounces).
- Reconciled `gate_v2_test` C7 to the P55 guard (`autoSyncTick`/`scheduleSyncPush` now also hold on
  `__boardPainted`): a pre-existing mismatch left by #218.
- `verify.js` 35/35, `arabic.py` 0 failed; Node auth cluster (`gate_breach_test`, `gate_bare_test`,
  `gate_v2_test`, `signin_resilience_test`, `session_integrity_test`, `state_diag_test`,
  `version_integrity_test`) green. Isolation grep 0 in `library/console.html`.
- Test-harness note: the local Playwright harness is intermittently returning empty output / non-zero exits
  in this environment (it ran `board_one_read_test` cleanly once, then degraded). The browser gate tests
  (`operator_gate_test` and the board suite) must be confirmed on CI, where the harness is fresh.

## Acceptance (device-gated)

1. Fresh build stamp on the failing iPad.
2. Enter the passcode: the operator step routes to `gate.html` (the clean page), sign-in completes, and the
   board loads. No 15s "Signing in" hang.
3. Three refreshes stay signed in (the warm-boot mirror path from P54/P55).
4. If the mirror fails to carry, the in-console card shows with the "open the clean sign-in page" link (no
   loop).
5. `?diag=1` shows the board painted and, after sign-in via the clean page, `has_access_token: true`.
