# The wrapper, not the request: the AbortController signal (P50)

## The device-proven fact this acts on

On the same failing iPad, same origin, same network, `authtest.html` sent the exact request the console
sends (an `apikey` header + JSON POST to `/auth/v1/token`) and returned **400 invalid_credentials in
621ms**; the health GET returned **200 in 363ms**. Both bare fetches complete. That retires, with device
proof, every perimeter theory: the preflight completes, CORS is fine, the network is fine, Supabase is fine,
the request shape is fine. If any of those were the block, the bare probe would have hung too. It did not.

The page states its own reading: *"If a call here works, the delta is console code."* It worked. So the
fault is in the console's wrapper around the fetch, between `signIn` and `token:ok`. git compared the
request (URL, headers, body) and found it identical to last-good; git never compared the **wrapper**.
authtest calls `fetch` bare; the console calls it wrapped.

## Phase 1: the wrapper diff, quoted

**authtest.html, the bare call that works** (no wrapper at all):

```
var res = await fetch(url, opts);          // opts has NO signal
...
var body = await res.text();
```

**The console, `signIn` -> `authTokenPost` -> `fetchJSON`** (`library/supabase.js`):

```
async function signIn(...) {
  ... window.__signMark = "token:sent";
  var r = await authTokenPost(c, "password", {...});   // the one await between the marks
  ... typed-error check (synchronous) ...
  window.__signMark = "token:ok";
  setSession({...});                                    // AFTER token:ok
}
function authTokenPost(c, grant, payload, fresh) {
  return fetchJSON(url, { method:"POST", headers:{apikey, "Content-Type":"application/json"}, body, cache:"no-store" }, FETCH_TIMEOUT_MS);
}
async function fetchJSON(url, opts, ms) {
  var ac = newAbort(), o = Object.assign({}, opts||{});
  if (ac) o.signal = ac.signal;                         // <-- attaches an AbortController signal to the fetch
  var to = raceTimeout(ms);                             // <-- a setTimeout race
  var run = (async () => { var res = await fetch(url, o); var text = await res.text(); ... })();
  return await Promise.race([run, to.promise]);
}
```

The constructs the wrapper adds that authtest lacks: (1) `o.signal = ac.signal` (an AbortController signal
on the fetch), and (2) the `Promise.race` against a `setTimeout`. The body read `await res.text()` is in
authtest too, so it is not the delta.

## Phase 2: which of A/B/C the code shows

- **B (a post-fetch await/persist runs before `token:ok`): ruled out by the code.** `token:ok` is set
  BEFORE `setSession` (the P48 ordering), and P47 already removed the P39 storage verify-read. The only
  await before `token:ok` is `authTokenPost` itself. So no persist/storage step gates `token:ok`.
- **C (the race holds the flow): ruled out for a completing fetch.** authtest proves the fetch completes in
  621ms. On a completion, `run` wins `Promise.race` and returns; the race cannot hold a fetch that finished.
- **A (the AbortController signal): named.** `o.signal = ac.signal` is the ONLY construct authtest lacks
  that touches the fetch itself. The repo's own P31 note already records that on this device family
  *"AbortController.abort() does NOT reliably reject a fetch whose socket WebKit has wedged"* - WebKit's
  AbortController+fetch is the documented-unreliable construct, and it is exactly what the bare probe omits.

**The delta, in one sentence:** authtest sets its success right after a bare `fetch`; the console inserts an
AbortController signal onto that same fetch before awaiting it, and that signal is the one thing authtest
lacks.

## Phase 3: the fix, matching the shape that works

`authTokenPost` now issues the token call as a **bare fetch with no AbortController signal**, exactly like
authtest, via a new `noSignal` argument to `fetchJSON`:

```
function fetchJSON(url, opts, ms, noSignal) {
  var ac = noSignal ? null : newAbort(), o = Object.assign({}, opts||{});
  if (ac) o.signal = ac.signal;   // skipped for the auth token call
  ...
}
function authTokenPost(...) { return fetchJSON(url, {...}, FETCH_TIMEOUT_MS, true /* bare, no signal */); }
```

Only the auth token call is signal-free; `rest()` and `fetchT` are byte-identical (they still attach the
signal). The `setTimeout` race stays as the bound, and the P31 note is explicit that the race, not the
AbortController, is what actually guarantees the promise settles (*"the independent setTimeout wins the race
and rejects at ms REGARDLESS of whether the browser honors the abort"*). So dropping the signal loses only
the best-effort socket-abort, never the timeout guarantee: a genuine stall still fails loud with a working
Retry at 15s.

The request (URL, headers, body, `cache:no-store`) is unchanged and frozen. Nothing downstream changes:
`setSession`, `bearer()`, the gate's `finish()`, and the board load are untouched.

## Phase 4: evidence

- The vm-sandbox resilience suite confirms the auth path is STILL bounded without the signal: a dead fetch
  (ignores abort, never settles) still rejects `kind:"timeout"` at the bound (A1/A2), and a healthy service
  still signs in (A5). `verify.js` 35/35; the full bed is green apart from the pre-existing, unrelated
  `supabase_stage1` "no Lotus reference".
- New guard `signin_click_test` S7: the auth token POST is signal-free while a `rest()` read still carries
  its signal (proven fails-when-broken: re-attaching the signal reds S7 and only S7).
- Device-gated (Thyab), this build `7e38d639`, sign-step strip kept: one sign-in with the real password on
  the failing device. The strip advances `token:sent -> token:ok -> session -> board`, and the board loads.
  A wrong password returns a fast clear error, not a hang. Warm-session and expired-session paths still work.
  The strip is deleted only in the closing commit, after the board photograph exists.

## Why this is the one, after eight briefs

Every prior brief acted on a theory about a layer. This acts on a device-proven fact: the bare request
completes, the wrapped request hangs, and the only fetch-touching construct the wrapper adds and the bare
probe lacks is the AbortController signal - a construct the repo's own notes already flag as unreliable on
this device's WebKit. Remove it from the auth call, keep the timeout race that actually bounds the flow, and
match the shape that works.
