# Kill the auth preflight: sign in through the official client (P33)

## Root cause, isolated by elimination

Across P29 and P31 the sign-in hang survived every bound we put on it, and the instrumented build
(35060e6d) proved why on three browsers: the panel reached `fetchJSON: fetch sent, awaiting response` and
stopped there forever, while the heartbeat kept ticking and no timeout line ever appeared. The auth call
was a hand-built `POST` to the token endpoint with a custom `apikey` header and a JSON content type. That
shape forces the browser to issue a **CORS `OPTIONS` preflight before the POST**. When the preflight does
not return, the POST is never sent, so the POST promise is never even created, and both P29's
`AbortController` and P31's `setTimeout` race, which wrap that promise, have nothing to bound. A simple GET
to `/auth/v1/health` (no custom header, no preflight) returned instantly on the same device and network.
Sign-in failed for every operator, on Wi-Fi and on cellular.

## The fix: one auth path, through the official client

The hand-built token fetch is **removed entirely**. Sign-in and token refresh now go through the official
`@supabase/supabase-js` client (`signInWithPassword` / `refreshSession`), so there is exactly one auth
transport, maintained by Supabase rather than by us.

- **Vendored, pinned, unmodified.** The client is the official UMD build, vendored byte-for-byte at
  `library/vendor/supabase-js.min.js` (v2.112.3, sha256 `ec004176…4b3847d`). External scripts are not
  loaded by this console, so the build is committed to the repo and shipped from our own origin. Its bytes
  are part of the cache-busting fingerprint and the `BUILD` signature, so a swapped-in build can never be
  served silently. It is loaded **before** `supabase.js` in both bundles, and inlined into the offline
  `dist` copy so that file stays self-contained.
- **Session handling is unchanged downstream.** The client is created with `persistSession:false`,
  `autoRefreshToken:false`, `detectSessionInUrl:false`. The console keeps its own `console_sb_session`
  key exactly as before: on a successful `signInWithPassword` / `refreshSession` we map the returned
  session into the existing `setSession()` (access token, refresh token, expiry, email, uid). Everything
  that reads the session, `bearer()`, `rest()`, the gate, is untouched.
- **The P31 safety net stays around the client call.** The client call is wrapped in the same
  `setTimeout` race (`withTimeout` → `raceTimeout` → `Promise.race`). If the client's own request hangs,
  the race still **rejects at the 15s bound with a typed timeout**, so the "Signing in" state is released
  and the gate shows the reason, never an infinite spinner. A retry (`opts.fresh`) rebuilds the client so
  it opens a new connection rather than reusing a wedged one. P29's error surface and the boot watchdog are
  unchanged.
- **Typed errors, so the gate can speak.** A `5xx` from the client is `unavailable` (a paused project
  answers 503); a `4xx` is `auth` (a wrong password, fast and clear); a status-0 retryable fetch error is
  `network`. The gate offers Retry only where retrying can help, and never throttles a wrong password as if
  it were a service blip.

Only the auth transport changed. `rest()` and the whole DB path still use the bounded `fetchJSON` /
`fetchT` helpers exactly as before; nothing about the database, storage, or the tables moved.

## The honest caveat (raised twice, accepted)

The official client sends the same `apikey` header, a `Bearer` authorization, an `X-Client-Info` header,
and a JSON content type, so it triggers the **same CORS preflight** the hand-built fetch did. If the
hanging `OPTIONS` truly is the cause, this transport can preflight too. What this change buys regardless:

1. **One maintained auth path.** The request shaping, retries, and error typing are Supabase's own code,
   not a bespoke fetch we hand-tuned. If the preflight is fixable at the client layer, this is the layer
   that fixes it.
2. **The bound still fires.** The P31 race wraps the client call, so even a preflight hang is released at
   15s with a typed timeout and a working Retry. The infinite spinner cannot return; the worst case is a
   fast, honest "timed out" with a retry, not a dead screen.

If sign-in still hangs on device after this, the preflight `OPTIONS` is confirmed as the cause and the next
step is operational (a network/proxy/edge path that drops the preflight to the Supabase domain), not more
client code. The instrumented build localized this to the auth transport; this brief makes the transport
the official one and keeps it bounded.

## Evidence

- **`tools/signin_resilience_test.js` (Node, no browser)** lifts the real `supabase.js` into a vm sandbox
  with a **fake `window.supabase` client** and shrunk timers. 60 checks, all pass, including the crux:
  - **A1/A2/E1** `signIn` REJECTS via the setTimeout race when the client call **never settles** (the
    device signature), typed `timeout`. **A3** a 400 is `auth` (status 400); **A4** a 503 is `unavailable`;
    **A4b** a status-0 client error is `network`. **A5** a healthy client signs in and the mapped session
    (token, email, uid) is stored.
  - **E4** the auth path **never touches `window.fetch`** (the sandbox's fetch throws if called): one auth
    path, through the client. **E2/E3** a fresh retry rebuilds the client (a new connection); a normal
    sign-in reuses it. **A11** the client is created with `persistSession:false` so the console keeps its
    own session.
  - **B1/B1b** prove the hand-built token endpoint and any `grant_type` request are **gone** from the
    client (fails-when-broken: re-introducing a token URL turns both red). **B5** `rest()` still uses the
    bounded `fetchJSON` (DB path untouched).
  - **F1–F5** the vendored build is real (exposes `createClient`), read + fingerprinted + part of the
    `BUILD` signature by `bundle.js`, loaded before `supabase.js`, inlined into `dist`, and exempted from
    the copy gate.
- **Gates:** `verify.js` 35/35, `arabic.py` green. No em dash in Thrive copy (the vendored third-party
  build is exempted from the copy scan by stripping its bytes wherever embedded, so it ships unmodified);
  Western numerals; isolation grep clean on the shipped client. Full Node bed green except the pre-existing
  benign `supabase_stage1_test.js` isolation-string check (it flags older merged docs and test-assertion
  strings; the same set reproduces on `main`, and this change adds nothing to it).

### Device-gated checks (Thyab runs, fresh stamp first)

1. On the device/network that hangs today: sign-in either completes, or within ~15s the card shows a
   typed reason with a working Retry. The infinite spinner is gone.
2. A wrong password returns a **fast, clear** error (not a timeout, not a hang).
3. A healthy sign-in still completes and lands on the board; the session persists and `rest()` reads work.
4. The build stamp matches the latest deploy (confirm current code is being served).

## Do not (held)

The hand-built token fetch is not merely bypassed, it is deleted: there is one auth transport. `rest()` and
the DB path are untouched. The vendored build is the unmodified official artifact, no fork, pinned by hash.
The P31 race and P29 error surface still wrap the auth call, so nothing can hang. No DB or foreign-project
reference touched. No error is swallowed: the raw reason stays visible on failure.
