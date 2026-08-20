# Kill the auth preflight: sign in with a CORS-simple request (P32)

## Ground

The instrumented builds and the PR #194 investigation isolated the failure to the auth transport: the
sign-in POST to `/auth/v1/token` hangs in transit, the heartbeat keeps ticking (loop alive), and no
timeout ever fires. The auth call is a hand-built fetch with a custom `apikey` header and
`Content-Type: application/json`; a custom header plus a non-simple content type forces the browser to
send a **CORS preflight (`OPTIONS`) before the POST**. Because our timeout wraps the POST promise and the
`OPTIONS` never completes, neither P29's `AbortController` nor P31's race could end it. `/auth/v1/health`
(a simple GET, no preflight) returns instantly. It fails for all users on Wi-Fi and cellular, so it is
the request shape, not a network.

## Why not the official supabase-js client

The brief proposed the official `@supabase/supabase-js` client. It is vendorable (the 207 KB UMD build
pulls cleanly from npm). But its `signInWithPassword` sends `apikey`, `Authorization: Bearer`,
`Content-Type: application/json`, and `X-Client-Info` headers, so it triggers the **same** (in fact
heavier) CORS preflight. Swapping to it would not remove the hanging `OPTIONS`. Thyab chose, instead, to
**kill the preflight directly**: reshape the auth request so no preflight is sent at all. No 207 KB
dependency, no external script tag, and it is the exact thing the brief's title asked for.

## The fix: a CORS "simple request"

`supabase.js` now shapes the token call so the browser classifies it as a **simple request** and sends
**no `OPTIONS`**:

- The anon key rides in the **query string** (`?apikey=<anon>`), not a header.
- The body is a **plain string**, so `fetch` sets the CORS-safelisted `Content-Type:
  text/plain;charset=UTF-8`, and **no custom header is present**.
- `cache:"no-store"` and the `AbortController` signal are fetch options, not headers, so they do not
  reintroduce a preflight. A retry still appends a nonce (P31).

GoTrue accepts the `apikey` query param and parses the JSON body regardless of the `text/plain` content
type. Both token calls, `signIn` and `refresh`, use the one `authTokenPost` helper, so a boot refresh of
an expired token is preflight-free too.

The P31 timeout race and P29 visible-error surface and boot watchdog remain around the call, so if
GoTrue rejects the simple-request shape, sign-in **fails fast with a clear error and a one-tap Retry,
never hangs**.

### Scope, per the brief

- **Auth only.** `rest()` (data reads, e.g. `console_board`) still sends `apikey`/`Authorization` headers
  and is preflighted, but those reads returned fast all day, so they are left unchanged as the brief
  directs. Noted, not touched.
- `signOut`'s logout call still needs the `Authorization` header (it revokes a specific session), so it
  stays preflighted; it is bounded by the timeout and wrapped in try/catch, so it never hangs the UI, and
  it is not the reported failure. Noted, not changed.

## This is a genuine test (per the chosen condition)

A temporary verification panel is included in this build (top of the screen): it shows the build id, a
heartbeat, and, on sign-in, that the request is a CORS-simple request (so no `OPTIONS` by spec) with its
timing. JS cannot directly observe a preflight, so the **definitive on-device confirmation is the Network
tab showing NO `OPTIONS` row** for `/auth/v1/token`; the panel says so. If sign-in **still** hangs with
no preflight, then the hanging `OPTIONS` was not the cause and we look below fetch (socket/proxy). The
panel is temporary and a follow-up removes it once confirmed.

## Evidence

- **`tools/signin_resilience_test.js`** (Node), all pass:
  - *Part F* proves the shape: the sign-in request sets **no custom headers**, the anon key is in the
    query (`?apikey=`), the body is a plain JSON string (so `fetch` sets safelisted `text/plain`), and
    `refresh` uses the same no-header shape; source structure confirms the token POST object carries only
    `method`/`body`/`cache` and no `apikey`/`application/json` header. A healthy sign-in still stores the
    session through the new shape.
  - *Parts A/E* (kept): a stalled or abort-ignoring call still rejects via the P31 race (never hangs); a
    400 is `auth`, a 503 is `unavailable`; the one-tap Retry opens a fresh connection.
- **Gates:** `verify.js` 35/35, `arabic.py` green. No em dash; isolation grep clean; Western numerals.
  Full Node bed green except the pre-existing benign `supabase_stage1_test.js` "Lotus" reference (older
  docs; reproduces on `main`).

### Device-gated checks (Thyab runs, fresh stamp first)

1. On the same device/network that hangs today: sign-in completes and the board loads (screenshot the
   signed-in board with the new build id). The panel shows the simple request; the Network tab shows no
   `OPTIONS` row for `/auth/v1/token`.
2. Basel signs in successfully.
3. A wrong password returns a fast, clear error (not a hang), proving the shape is accepted and errors
   surface quickly.

## If sign-in STILL hangs

Then a no-preflight simple request also hangs, so the `OPTIONS` was not the cause and the block is below
fetch (socket/proxy/edge). The next probe is operational: confirm from a different account/device off
Thyab's networks whether sign-in works. If it works there, the block is local/operational; if it fails
everywhere, escalate to Supabase with a HAR. This build's panel makes that determination on-device.

## Do not (held)

The hand-built preflight-shaped auth fetch is gone; there is one auth path (the simple request). The data
`rest()` path is unchanged (auth only). The P31 race and P29 error surface and watchdog are kept around
the call. No DB, Lotus, or newsroom touched.
