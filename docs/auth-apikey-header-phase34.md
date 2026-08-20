# Restore the required apikey header on the sign-in call (P34)

## Root cause, confirmed on device

Sign-in failed with an instant `{"message":"Invalid API key"}`, not a hang. Transport was never the
problem. The cause was the request **shape**: P32 (the "kill the preflight" experiment, which had reached
`main`) sent the anon key **only in the query string** (`/auth/v1/token?apikey=<anon>`) with **no headers**,
to make the request a CORS "simple" request that skips the OPTIONS preflight. **GoTrue's token endpoint does
not honor a query-param-only apikey**, it rejects it as "Invalid API key."

Proven, not assumed:
- A direct browser GET to `/auth/v1/token?apikey=<the correct anon key>` returned **instantly** with
  "Invalid API key", same query-only shape, correct key, fast rejection. So it is the shape, not the key
  value and not the transport.
- The anon key was verified **character-for-character identical** to the dashboard's anon public key (ref
  `ssqhwdzgegzqcjfcclmr`, role `anon`, unexpired). The key was never the problem.
- Every request that works, the old hand-built code, the official `supabase-js` client, and even P32's
  **own `rest()`**, sends the apikey as a **header** (`apikey: <anon>`, plus `Authorization: Bearer` and
  a JSON content type). Only the auth call had lost it.

The earlier "transport hangs / CORS preflight" thread was a wrong turn: a direct probe proved the preflight
answers instantly, so it was never the cause.

## The fix

Restore the standard Supabase auth request shape on the sign-in (and refresh) call, exactly what `rest()`
and the official client send:

```
POST /auth/v1/token?grant_type=password
headers: apikey: <anon>
         Authorization: Bearer <anon>
         Content-Type: application/json
body:    {"email":…, "password":…}
```

- The apikey moves back into the **header**; the `&apikey=` query param is dropped.
- This reintroduces the CORS OPTIONS preflight, now **proven harmless**, which is the correct trade.
- Only the auth transport changed. `signIn`'s typed-error logic (5xx → `unavailable`, else `auth`),
  `setSession`, `rest()`, storage, and the DB path are untouched.

**Safety net kept:** the call still goes through `fetchJSON`, which wraps it in the **P31 setTimeout race**
(a stalled request rejects at the 15s bound, never hangs) and the **P29 typed-error surface** (the gate
releases "Signing in" and shows the specific reason with a one-tap Retry). A wrong password returns a fast,
clear `auth` error.

## Evidence

- **`tools/supabase_auth_test.py` (real Chromium)**, all checks pass, including a new **regression guard**
  that records the exact headers the sign-in POST sent and asserts:
  - the sign-in POST sends the **apikey HEADER** (not query-param-only),
  - it sends **`Authorization: Bearer <anon>`**,
  - it sends **`Content-Type: application/json`**.
  Plus the existing behavior: a healthy sign-in stores a session and carries `Bearer <jwt>` on the next
  read; a wrong password throws a fast credential error; refresh-and-retry, sign-out, and the signed-out
  empty-read gap fixes all hold.
- **Fails-when-broken:** reverting to the header-less, query-param-only shape turns all three header
  assertions **red**, so the guard permanently blocks a repeat of the P32 regression.
- **Gates:** `verify.js` 35/35, `arabic.py` green. `supabase.js` carries no functional `apikey=` query
  param (the only two occurrences are in the explanatory comment). Bundle deterministic.

## Verify before merge (device)

1. A real sign-in returns a session and lands on the board (no "Invalid API key").
2. A wrong password returns a **fast, clear** error, not a hang, not "Invalid API key."
3. The gate build stamp matches the deploy (confirm the current bytes are served).

## Do not (held)

Only the sign-in/refresh transport changed. `rest()` and the DB/storage path are untouched. The P31 race
and P29 error surface still wrap the auth call. The apikey stays a header on every call, as GoTrue requires.
No DB, no foreign-project reference, no error swallowed.
