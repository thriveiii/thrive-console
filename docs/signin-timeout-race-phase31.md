# The sign-in fix, grounded in the diagnostic (P31)

## Ground: what the instrumented build (35060e6d) proved on device

The visible diagnostic panel gave ground truth on three browsers (Thyab on iPad, iPhone, Chrome; Basel
too). On sign-in the log reached exactly:

```
submit clicked
awaiting S.signIn(...)
signIn: sending fetch -> https://<proj>.supabase.co/auth/v1/token
fetchJSON: fetch sent, awaiting response      <- STOPS HERE
heartbeat: 21+ (loop alive)                    <- keeps ticking
```

Three certain facts, all from the screen:

1. The heartbeat kept ticking, so the main thread was NOT synchronously blocked. Not a code freeze, not
   a P27 unlock-handler block.
2. The fetch to `/auth/v1/token` was sent and the response never returned. It hangs in transit.
3. Past 20 seconds, NO `ABORTED (timeout fired)` line appeared. P29's `AbortController` did not fire on
   this hung fetch in Safari; the 15s bound never took effect.

So there are two real defects: the auth fetch hangs (transport), and `AbortController` alone does not
reliably abort a hung fetch in this browser.

## The fix (belt and suspenders)

1. **Independent timeout race, not only AbortController** (`supabase.js` `fetchJSON` / `fetchT`). The
   fetch is now run under `Promise.race([run, raceTimeout(ms)])`, where `raceTimeout` is a plain
   `setTimeout` that rejects with a typed timeout error at the bound (default 15s). The race guarantees
   `signIn` rejects at the bound EVEN IF the browser ignores the abort signal on a stuck socket. The
   heartbeat proved timers keep running during the hang, so the `setTimeout` WILL fire. `AbortController`
   is still created and `abort()` is still called on timeout to free the socket where the browser honors
   it; the race is what guarantees the promise settles. A late rejection from the abandoned fetch is
   swallowed so it never surfaces as an unhandled rejection.
2. **On timeout:** reject typed (`kind:"timeout"`), release the button (P29), show the specific message
   plus the raw diagnostic on the card (P29), and offer a **one-tap Retry** (`#gateRetry`) that
   re-attempts immediately.
3. **Retry with a fresh connection** (`supabase.js` `signIn(email, pass, { fresh })`). The auth call
   always sets `cache:"no-store"`; a retry additionally appends a nonce (`&_ts=<now>`) so the browser
   opens a new request rather than reusing a wedged HTTP/2 stream or a buffered intermediary, a known
   cause of exactly this hang.
4. **Kept:** the boot watchdog and the visible error surface from P29. This brief makes the timeout
   actually fire; P29's UX around it stays.

The diagnostic overlay (commit 99d8224) is reverted in this PR; the shipped build no longer shows it.

## Transport investigation (reported, not assumed)

Read live: the auth call is `POST /auth/v1/token?grant_type=password` with headers `apikey` (the anon
key) and `Content-Type: application/json`, body a JSON credential, no `credentials` mode, no `keepalive`.

- Because it sends a **custom header (`apikey`) and a non-simple `Content-Type` (`application/json`)**,
  the browser issues a **CORS preflight `OPTIONS`** before the POST. This is standard for Supabase auth
  from a browser and normally succeeds; it is not removable without breaking the API (the `apikey` header
  is required, and the JSON content type is what the endpoint expects). So there is no offending header
  to strip. It IS, however, the most likely thing hanging in transit: if the `OPTIONS` preflight to the
  Supabase domain does not return (a wedged keep-alive connection, a proxy, an edge issue), the POST is
  never sent and the whole call hangs, exactly matching the panel stopping at "fetch sent."
- No `credentials:"include"` and no `keepalive` are set, so neither is a Safari-specific trigger here.

The race bounds the symptom regardless of the transport cause; the retry's fresh connection is aimed
squarely at a wedged keep-alive/preflight socket.

## Evidence

- **`tools/signin_resilience_test.js` (Node, no browser)** lifts the real `supabase.js` with a
  controllable fetch and shrunk timers. All pass, including the crux:
  - **E1** `signIn` REJECTS via the setTimeout race even when the fetch **never settles and ignores
    abort** (the exact device signature), proving the race bounds it where `AbortController` did not.
  - E2/E3 a fresh retry appends a nonce and sets `cache:"no-store"`; E4 a normal sign-in adds no nonce;
    E5 a stalled `rest()` that ignores abort is bounded too; E6/E7 the bound is a `Promise.race` against
    a `setTimeout` and `abort()` is still called; E8/E9 the gate offers a one-tap Retry that threads
    `fresh` through to the connection.
  - Part A still proves a healthy sign-in completes fast and stores the session; a 400 is `auth`, a 503
    is `unavailable`.
- **Gates:** `verify.js` 35/35, `arabic.py` green. No em dash; Western numerals; isolation grep clean on
  the shipped client. Full Node bed green except the pre-existing benign `supabase_stage1_test.js`
  "Lotus" reference (older docs; reproduces on `main`).

### Device-gated checks (Thyab runs, fresh stamp first)

1. On the same device/network that hangs today: sign-in either completes, or within ~15s the card shows
   "timeout" with the raw reason and a working Retry. The infinite spinner is gone. Screenshot the
   timeout firing (proves the race works where AbortController did not).
2. Retry after a timeout uses a fresh connection (nonce + no-store visible in the request) and can
   succeed without a full reload.
3. A healthy sign-in still completes fast, unaffected.
4. The diagnostic overlay is gone from the shipped build.
5. Basel confirms sign-in works or fails-fast on his device too.

## If sign-in still hangs after this

If the setTimeout race is present (E1 proves it in the bundle) and sign-in STILL never times out, the
hang is below `fetch` (the browser or network refusing to release the socket, or a proxy). At that point
the answer is operational, not more client code: try a different network, confirm the Supabase project
URL resolves, and check whether an `OPTIONS` preflight to the Supabase domain returns. The instrumented
build localized this to the auth transport; this brief bounds it; anything beyond is infrastructure.

## Do not (held)

`AbortController` is never relied on alone; the `setTimeout` race is the real bound (E1). The diagnostic
overlay is not in the shipped build (reverted). No DB, Lotus, or newsroom touched. No error is swallowed:
the raw reason stays visible on timeout.
