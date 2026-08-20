# Session integrity: never read as anon after a successful sign-in (P39)

## Ground: the failure traced to two lines

The whole investigation (P32 through P38) converged here. Sign-in itself succeeds: `POST /auth/v1/token`
returns 200 and the gate completes. But the post-auth reads then come back EMPTY, not blocked: a browser
`GET /rest/v1/console_board` with the anon key returns `[]` fast, because after the anon door was closed
(`docs/supabase-auth-remove-anon.sql`) anon has no policy on the console tables and `console_board` is a
`security_invoker` view granted to `authenticated` only. So anon legitimately sees zero rows, the board
has nothing to paint, and a signed-in console with an empty dataset reads as a stuck sign-in.

Two lines made that state silent and permanent:
1. `setSession` swallowed a storage failure: `try { localStorage.setItem(...) } catch {}`. If the browser
   blocks storage (Safari ITP, private mode, partitioning, Lockdown), the session is never stored, yet
   `signIn` still resolves ok.
2. `bearer()` fell back to the anon key whenever `session()` was null. Every subsequent read then went out
   as anon, got `[]` from RLS, and nothing reported it.

This phase makes that state impossible and self-evident. It does not change the auth request, the key, or
the DB policies (all proven correct); it is purely session integrity on the client.

## The decisive datum (device, one minute), still to be recorded

The brief gates the fix on one on-device reading, taken immediately after a "successful" sign-in on the
failing device: `localStorage.getItem('console_sb_session')`.
- **null** ⇒ storage is blocked; mechanism 1 confirmed, and this build is the fix.
- **an access_token present** ⇒ re-run the read with `Authorization: Bearer <that token>` + `apikey:
  <anon>`. **Rows** ⇒ the console was not attaching the token on the failing GET (still mechanism 1, at the
  header). **Still `[]`** ⇒ the view/RLS returns empty for the authenticated operator, and the remaining
  fix is server-side (`console_board` view/grants), NOT this build.

This build implements mechanism 1 (the expected case). Its four changes are also mandated unconditionally
by the brief's own "Do not" list (never swallow a storage failure; never let a post-sign-in read fall back
to anon; never paint an empty board without saying why), so they are correct session-integrity hardening
regardless of which mechanism the datum ultimately selects. If the datum comes back "still `[]` with the
real token", a separate server-side change is required and this build is necessary but not sufficient.

## What changed

All in `library/supabase.js`, plus a small honesty change in `library/app.js` and the gate notice.

1. **`setSession` no longer swallows; it verifies.** It writes, reads the key back, and only then reports
   success. If the write did not land, the session is held in an in-tab memory variable and marked
   `__sessionEphemeral`, and `setSession` returns `false` so the caller can surface the reason. Clearing
   (`null`) drops both copies and always succeeds.
2. **In-memory fallback.** `session()` reads durable storage first (the cross-tab, survives-reload source
   of truth) and falls back to the in-tab copy only when storage is empty or unreadable. So a blocked store
   never reads as "no session": the operator keeps working in that tab, degraded, instead of facing an
   empty board. Working degraded beats an empty board, so a blocked persist is NOT a failed sign-in; only a
   rejected token fails.
3. **`bearer()` never silently downgrades.** Once a sign-in has occurred in this tab (`__signInSeen`), a
   read with no session is a defect, not an anon read: `bearer()` throws a typed `kind:"session"` error
   instead of substituting the anon key. The anon key is valid ONLY on the pre-sign-in public path; after
   sign-out the tab returns to that path and anon is allowed again.
4. **Empty-state honesty.** The board already renders one of three states and never paints black:
   `boardAuth` (sign in), `boardEmpty` (no data yet), or `boardLanes`. This phase maps a session-lost read
   error to the sign-in prompt (`supaHydrate`'s catch now treats `e.sessionLost` like `authRequired`), so a
   session that dropped mid-use shows "sign in again", not the misleading "no data yet".
5. **The ephemeral notice.** When a sign-in could not be persisted, the gate shows a persistent, dismissible
   one-line notice (EN + AR) that the session lives in this tab only and will not survive a reload. It is
   appended outside the gate so it survives the reveal, and is `textContent` only so the message cannot
   inject markup.

## Evidence

- **`tools/session_integrity_test.js`** (Node), all pass, fails-when-broken proven (reverting `bearer()` to
  the silent anon fallback reds S5):
  - **S1**: a normal sign-in persists durably, is not ephemeral, and the first post-sign-in read carries
    `Bearer <session token>`, never the anon key.
  - **S2**: with storage blocked, sign-in still works for the tab (in-memory), is flagged ephemeral,
    `signedIn()` is true, nothing is written to localStorage, and the read STILL carries the token, never
    anon.
  - **S3/S4**: a read before sign-in, and after sign-out, uses the anon key (the public path) and does not
    throw.
  - **S5/S6**: `bearer()` consults `__signInSeen` and throws `kind:"session"` rather than using anon;
    `setSession` reads the write back to verify it and records an ephemeral session on failure.
- **Gates:** `verify.js` 35/35, `arabic.py` 0 failed, `signin_resilience` 0 failed, `bare_metal_auth` 0
  failed, `supabase_auth` all pass (its stale source-grep for the old `bearer()` one-liner was updated to
  the new no-downgrade contract), `deploy_marker`/`fresh_code`/`board_one_read` pass. No em dash; Western
  numerals; shipped-shell isolation grep 0. Pre-existing benign exception: `supabase_stage1` "no Lotus
  reference" (older docs prose; reproduces on `main`).

### Device-gated checks (author to run, fresh stamp first)

1. On the failing phone: sign-in either lands on a populated board, or (storage blocked) works for the tab
   with the ephemeral notice shown. No silent empty board, no spinner, no black screen.
2. In a private window (storage blocked deliberately): the ephemeral notice appears and the tab works.
3. A signed-in read carries `Authorization: Bearer <session token>`; the anon key is never sent after
   sign-in (covered by the test).
4. Basel signs in and sees the board.

## Do not (held)

No storage failure is swallowed anywhere. No post-sign-in read falls back to the anon key. An empty board
now always says why (sign in vs no data yet). The auth request shape, the key, the DB policies, Lotus, and
the newsroom are untouched. Author only, not merged, not released.
