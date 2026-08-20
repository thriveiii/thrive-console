# Sign-in resilience: never hang, always tell the truth (P29)

Sign-in hung forever on "Signing in". The trace (P22 diagnosis) showed the one thing the gate awaits is the
Supabase auth POST in `supabase.js` `signIn`, and that call had NO timeout and NO AbortController: when the
response never completed, the promise never settled, and the "Signing in" button state was the last word. A
transient auth condition (a paused free-tier project answering slowly, a stalled response body, a looping
refresh) became total paralysis.

This brief bounds every auth and read network call, releases the button on every outcome, self-heals a
corrupt or expired stored session, and adds a boot watchdog so there is always an exit. One concern: auth and
boot resilience. Additive only; nothing else changed.

## What was read first (per the brief, from the live files)

- **`library/supabase.js`** `signIn` / `refresh` / `rest` / `signOut` / `uploadAttachment`: each did a bare
  `await fetch(...)` with no timeout, so a stalled call awaited forever. `session()` / `setSession()` are
  localStorage only; there was no server-side session check.
- **`library/gate.js`** the operator step: the button is set to `op_busy` ("Signing in") at submit and
  restored to `op_go` after `await S.signIn(...)`. Because `signIn` could never settle, that restore was
  never reached. Every failure was funneled to one neutral message and the failure throttle.

## Build

### 1. Every auth + read call is bounded (`supabase.js`)

Two small wrappers put every network call under an `AbortController` with a stated default timeout
(`FETCH_TIMEOUT_MS = 15000`; uploads get a longer `UPLOAD_TIMEOUT_MS = 60000`):

- `fetchJSON(url, opts, ms)` bounds the request AND the body read under one timer, so a response whose
  headers arrived but whose body never finishes (the exact P22 stall) is bounded too. Used by `signIn`,
  `refresh`, `rest`.
- `fetchT(url, opts, ms)` bounds a non-JSON call (`signOut`, `uploadAttachment`).

On timeout the promise REJECTS with a typed error (`err.kind === "timeout"`), never hangs. `signIn` also
types its HTTP failures: a 5xx (a paused project answers 503) is `kind: "unavailable"`; a 400/401/422 is
`kind: "auth"`. So the gate can say WHICH, and a stalled `rest()` read now rejects, so a board settle
awaiting it degrades to the local cache instead of hanging.

### 2. The button is always released, with a specific reason (`gate.js`)

The operator submit now captures the error kind. The button is restored to "Sign in" on every path, so
"Signing in" can never be the last word. A transient service condition (timeout / network / unavailable) is
shown with its own message and is NOT counted as a failed attempt or throttled; the operator can retry at
once. A real credential rejection keeps the existing neutral message and throttle. New strings, EN + AR:
`op_err_timeout`, `op_err_network`, `op_err_unavailable`.

### 3. Stale-session self-heal on boot (`gate.js` + `supabase.js` `getSession`)

A fresh stored token reveals the board at once, with no network round trip, so warm-boot timing is
unchanged. Only an EXPIRED token (a local `expires_at` check, no network) pays a bounded validation: one
`getSession()` (a bounded refresh). If it heals, the board is revealed; if it times out, errors, or the
refresh token is rejected, the stale session is cleared ONCE and the operator sign-in card is shown. A
corrupt or expired token can never lock the app on a blank screen.

### 4. Boot watchdog (`tools/bundle.js`, shipped inline)

`window.__thriveBooted` is set the moment a gate card shows (`gate.js`) and on the board's first paint
(`app.js` `render`). If neither has happened within a bounded time (20s), the inline boot script replaces
the screen with a plain, self-contained panel: "The console is taking too long." with **Retry** (reload)
and **Sign out** (clear session + reload). It is inline-styled and depends on nothing, so it works even if
`styles.css` or `app.js` failed to load. There is always an exit, never an infinite spinner.

The relay/version banner and the owner-tier read remain non-blocking, as before; this brief only bounds the
auth path and adds the watchdog.

## Evidence

- **`tools/signin_resilience_test.js` (Node, no browser)** lifts the REAL `supabase.js` into a sandbox with
  a controllable fetch and shrunk timers, and proves, all pass:
  - *Part A* a stalled auth POST REJECTS as a typed timeout (never hangs); a 400 is `auth`, a 503 is
    `unavailable`; a healthy service signs in and stores the session; a stalled `rest()` read rejects (the
    board never awaits forever); `refresh` clears the session on a definitive 400; `getSession` heals an
    expired-but-refreshable token, returns false on a hung refresh, and is a clean false with no session.
  - *Part B* every network call in `supabase.js` is bounded (the only two bare `fetch(` calls are inside
    the wrappers), the 15s default is stated, the bound is an `AbortController`, and `getSession` is
    exported.
  - *Part C* the gate carries the three specific reasons (EN + AR), releases the button before branching,
    branches a transient failure apart and does NOT throttle it, and self-heals an expired token.
  - *Part D* the shipped bundle carries the 20s watchdog gated on `__thriveBooted`, with Retry / Sign out,
    bilingual, and the board paint clears it.
- **Gates:** `verify.js` 35/35, `arabic.py` green. No em dash; Western numerals; isolation grep clean on
  the shipped client.

### Device-gated live checks (Thyab runs, fresh stamp first)

1. Simulate a hung auth call (block `/auth/v1/token`): the button returns to an error state with a specific
   reason within the timeout, never spins forever.
2. Corrupt the stored session and reload: the app clears it once and shows the sign-in card, no hang.
3. Real sign-in still works normally and fast when the service is up.
4. Delay first paint past the bound: the watchdog panel appears; Retry and Sign out both work.
5. Ten normal sign-ins are unaffected; no regression to boot timing.

## Immediate operational check (outside code)

Confirm the Supabase project is Active, not Paused. Free-tier projects pause on idle and make the auth POST
hang; if Paused, Resume it and sign-in recovers immediately. This brief ensures that even when the service is
degraded, the console degrades gracefully instead of hanging.

## Do not (held)

No auth call or fetch is left without a bounded timeout (every one goes through `fetchJSON` / `fetchT`). The
sign-in button is never left busy on failure (released before branching, on every path). Boot is not blocked
on any non-auth read (only an already-expired token pays a bounded validation; a fresh token reveals at
once). No error is swallowed: the operator always sees the specific reason and a way forward (a retry, or the
watchdog's Retry / Sign out).
