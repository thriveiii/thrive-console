# Capture the device evidence before the client swap (P49)

## Why this, and not the swap yet

P49 asked to apply P32 at last: replace the hand-built auth fetch with the official
`@supabase/supabase-js` client. Before spending a 207 KB vendored dependency on that, one fact in the
repo's own record has to be reckoned with. **P32's doc explicitly evaluated the official client and
rejected it for this exact reason** (`docs/no-preflight-auth-phase32.md`):

> But its `signInWithPassword` sends `apikey`, `Authorization: Bearer`, `Content-Type: application/json`,
> and `X-Client-Info` headers, so it triggers the same (in fact heavier) CORS preflight. Swapping to it
> would not remove the hanging `OPTIONS`.

So the official client is a NON-simple request too: it sends a CORS preflight (`OPTIONS`) exactly like the
hand-built fetch, only heavier. If the preflight is what hangs, the official client hangs the same way, and
the 207 KB swap buys nothing. If the preflight is NOT the block, then the request shape was never the
problem and the swap is again beside the point. Either way, the swap should not be built until we know
which world we are in.

The datum that settles it cannot be captured from the build sandbox (its proxy blocks the Supabase domain,
`connect_rejected` 403 on `ssqhwdzgegzqcjfcclmr.supabase.co`). It has to come from the device that hangs.

## The current request being tested (quoted from the live client)

`library/supabase.js`, the frozen (P47) shape the console builds today:

```
function authTokenPost(c, grant, payload, fresh) {
  return fetchJSON(authTokenUrl(c, grant, fresh), {
    method: "POST",
    headers: { "apikey": c.anon, "Content-Type": "application/json" },
    body: JSON.stringify(payload), cache: "no-store"
  }, FETCH_TIMEOUT_MS);
}
```

The `apikey` header plus a JSON content type make this a NON-simple request, so the browser sends an
`OPTIONS` preflight before the POST. The session it obtains is consumed downstream by `setSession` (writes
`console_sb_session`), `bearer()` (reads `access_token` from it), and the gate's `finish()`; none of that
changes in this PR.

## The probe (device-gated evidence, photographable)

`authtest.html` (repo root, standalone, zero console code, same origin and same anon key as the console) is
extended to answer one question on the failing device: **is the preflight the thing that hangs?** It runs
four bounded probes (each bounded at 12s, so a hang becomes a printed datum instead of an infinite spinner)
and prints a summary box to photograph:

- **P1 health GET** - a simple request, baseline reachability.
- **P2 token POST, console shape** - `apikey` header + JSON body. NON-simple, so a preflight is sent. This
  is the exact shape that hangs in the console.
- **P3 token POST, CORS-simple** - apikey in the query string, `text/plain` body, no custom header. A
  simple request, so NO preflight is sent.
- **P4 token POST, official-client shape** - `apikey` + `Authorization` + `Content-Type` + `X-Client-Info`.
  The heavier preflight the official `@supabase/supabase-js` sends.

### How to read it

- **P3 completes fast while P2 and P4 time out** -> the preflight is the block. The official client (P4's
  shape) hangs too, so the P49 swap would not help. The real fix is at the perimeter: the Supabase project's
  CORS config for the console origin, or a network device eating the `OPTIONS`. (Note the standing bind: P34
  found the CORS-simple path with apikey-in-query is rejected by GoTrue as "Invalid API key", so P3 may
  return a fast 401/400 rather than a real sign-in - that still proves the transport completes without a
  preflight, which is the point.)
- **P2 also completes** -> the hang is not the request shape at all, and neither the header revert (P46) nor
  a client swap was ever going to matter; the freeze is elsewhere (build/caching/boot, which P43/P48
  addressed) or intermittent.
- **All four time out including P1** -> the domain is unreachable from that device/network (a block below
  the app), and the next step is the network path, not the client.

## Running it on the iPad (Thyab)

1. Open `https://<the Pages host>/authtest.html` on the device and network that hangs today. Add `?t=1` (or
   hard-refresh) to bypass any cached copy, since this page is unversioned.
2. Tap **Run all probes**. Wait for all four to settle (at most ~48s total, since each is bounded at 12s).
3. Photograph the SUMMARY box. That single photo is the evidence.

## What this PR does and does not do

- Does: extend the standalone `authtest.html` probe. Nothing else. The console, `supabase.js`, `signIn`, the
  session model, the board, and the sign-step strip are untouched - auth stays exactly as it is on main.
- Does not: vendor the official client, change `signIn`, or touch the DB, keys, RLS, Lotus, or the newsroom.

## The decision the photo unlocks

If the photo shows P3 fast and P2/P4 hung, we have, for the first time, on-device proof that the preflight
is the block and that the official client cannot fix it, and the next brief is the perimeter (the Supabase
CORS allowed-origins for the console host, escalated with the request id from the Auth log). If instead P2
completes on the device, the client swap is off the table and the freeze is not the request. The 207 KB
dependency is only worth building if the evidence says it could actually change the outcome, and this probe
is how we find out cheaply first.
