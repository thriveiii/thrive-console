# Which brief is the bully: the build-to-build diff, and the restore it earned (P47)

## The reframe

Seven briefs named a mechanism each by reasoning (storage, black screen, mixed builds, click path,
perimeter, header) and shipped a fix plus a test that proved that mechanism's contract. The beds went
green while the door stayed shut. P47 stops hunting the mechanism and isolates the regression by build:
the last build that demonstrably signed in is in git, so the answer is a diff between two builds, not a
theory. And a green bed measures conformance to the last brief, not an open door. Only the device
photograph counts.

## Phase 1: the last-good build

The header timeline across the outage window (verbatim from `git show`):

| build | commit | token POST header | URL |
| --- | --- | --- | --- |
| P29 | a0f2573 | `{apikey, Content-Type}` | `?grant_type=password` |
| P31 | **506334f** | `{apikey, Content-Type}` | `+ &_ts` fresh nonce |
| P32 | 9837ef5 | apikey moved to a query param (broke: "Invalid API key") | `&apikey=` |
| P34 | 4e6d961 | `{apikey, Authorization: Bearer anon, Content-Type}` | header restored, Bearer added |
| P39-P42 | | same P34 shape | |
| P46 | 470162d | `{apikey, Content-Type}` (Bearer reverted) | back to the P31 shape |

**The last build before the auth request was ever restructured is 506334f (P31).** The a6a10b4b board
render (the P42 stamp) was, by P43's own note, a warm-cache paint of pre-P39 JavaScript, not proof that
P42's code signed in, so the true last-own-JS-sign-in reference is the pre-P32 build, i.e. P31. P31
predates the P44 `__signMark` steps, so there was no `token:sent`/`token:ok` yet; its sign-in was:

```
async function signIn(email, password, opts) {
  opts = opts || {};
  var c = cfg(); if (!c.url || !c.anon) { ... throw ce; }
  var authUrl = c.url + "/auth/v1/token?grant_type=password" + (opts.fresh ? ("&_ts=" + Date.now()) : "");
  var r = await fetchJSON(authUrl, {
    method: "POST", headers: { "apikey": c.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password }), cache: "no-store"
  }, FETCH_TIMEOUT_MS);
  var data = r.data;
  if (!r.res.ok || !data || !data.access_token) { ... typed err ... throw err; }
  setSession({ access_token: data.access_token, ... });   // SYNCHRONOUS
  return { ok: true, email: email };
}
```

Build the URL, one bounded POST, a typed-error check, a synchronous `setSession`, return. No marks, no
`__memSession`, no ephemeral branch, no `bearer()` throw.

## Phase 2: the whole-path diff (`506334f..HEAD -- library/`, plus config)

Between `token:sent` and `token:ok` the only executed code at HEAD is `await authTokenPost(...)`. Every
input to that request was diffed:

| element | P31 | HEAD (P46) | verdict |
| --- | --- | --- | --- |
| token URL | `?grant_type=password[&_ts]` | identical | same |
| headers | `{apikey, Content-Type}` | identical | same |
| body / cache | `{email,password}`, `no-store` | identical | same |
| `fetchJSON` + timeout race | `FETCH_TIMEOUT_MS` | unchanged | same |
| `cfg()` | | unchanged | same |
| `config.js` (project URL + anon key) | | **not in the diff** | same |

Every P39 change (`setSession` returns-bool, `__memSession`, `__sessionEphemeral`, the `bearer()` throw)
and every P44 change (marks, the 15s `Promise.race`, stall routing) sits **after** `token:ok`, or wraps
the call in a race that rejects and shows a panel. None sits between the two marks. The P43 convergence
`location.replace` is a boot-time one-shot that stands down on matching builds and reloads (never
freezes) if it fires.

**The build diff exonerates the sign-in request path.** The browser at HEAD sends a byte-identical
request to the one the last-good build sent. Nothing the diff covers can hold the flow at `token:sent`.
So the freeze is outside the diffed code: the CORS preflight on the `apikey` header (present identically
in both builds; curl never sends it), the project or perimeter state (P45), or a served-build vs source
mismatch. That is why every green bed coexisted with a shut door: the beds test the code, and the code
is not what changed.

## Phase 4: the restore it earned (the falsifiable door test)

No single change sits on the freeze path, so there was nothing to revert as a targeted unit. The action
taken (agreed with Thyab: restore AND read the perimeter) is the nuclear restore: the sign-in path is
returned to its last-good (P31) shape verbatim, keeping only the P43 boot convergence and the P40/P42
failsafe reveal net (both untouched), and dropping the P39/P44 sign-in-path churn.

- `library/supabase.js`: `session`, `setSession`, `bearer`, `signIn`, `signOut` restored to the P31
  form. `bearer()` returns the session JWT else the anon key, and never throws. `setSession` swallows a
  blocked write. `signIn` is one bounded POST, a typed-error check, a synchronous persist, and a return
  of `{ ok, email }`. The `authTokenUrl`/`authTokenPost` helpers stay (they build the byte-identical
  request and `refresh()` uses them); `sessionEphemeral` is removed from the export.
- `library/gate.js`: the operator click handler awaits `signIn` directly (no outer `Promise.race`, no
  step marks, no stall branch), always releases the button, and routes a transient failure to Retry. The
  P39 ephemeral notice and its i18n string are removed. `finish()` keeps its P40 watchdog arm (the
  failsafe net, not sign-in churn).
- `library/app.js`, `library/failsafe.js`: untouched. The board-read checkpoints and the failsafe strip
  and P43 convergence are retained.

This trades the instruments for the door that provably opened. It is falsifiable: if the iPad still
freezes at `token:sent` with the last-good code running, that is proof the fault is not code.

### The accepted trade

Dropping P39 reintroduces its documented risk: a sign-in whose storage is blocked (private mode) no
longer holds an in-memory session, so a later read falls back to the anon key and may return an empty,
RLS-filtered board. This is the last-good behavior, and it is the price of returning to the shape that
worked. The tests assert this honestly rather than pretending the guard is still there.

### The bed, reconciled (green measures the restore, not a guarantee we removed)

Four suites encoded the P39/P44 contracts and were reconciled to the restored last-good shape:
`session_integrity_test.js` (the last-good session contract, incl. the anon-fallback trade),
`signin_click_test.js` (a healthy sign-in resolves ok; no marks; no gate race), `signin_resilience_test.js`
(C4/C10 to the last-good transient branch and raw diagnostic), and `supabase_auth_test.py` (bearer is the
last-good form, no session throw). The full gate bed is otherwise green. Two pre-existing conditions are
unrelated to P47: `supabase_stage1` "no Lotus reference" (predates this branch), and
`session_lifecycle_test.py`'s runtime sign-in step, which times out identically on the origin/main
baseline in this sandbox (an environment timeout, not a P47 regression). `operator_gate_test.py`'s
"no embedded password" check, which fails on origin/main because of a "wrong password:" comment
false-positive, now passes (the comment was rephrased).

## Phase 5: proof, the only arbiter, and the perimeter to read in parallel

**Device (Thyab).** Confirm a fresh stamp on the iPad (not d94b111f; this build is 86083c66), sign in
once, and photograph the failsafe strip. `token:sent` no longer exists as a mark in this build, so the
last-good strip shows the boot and read marks; the acceptance is the board painting after one sign-in.
If it still freezes on sign-in, the restore did not open the door, which is itself the proof that the
fault is not in the client code, and the next step is the perimeter, not another client theory.

**Perimeter (in parallel, needs the Supabase dashboard, which this session cannot reach).** Read, in the
project ssqhwdzgegzqcjfcclmr:
1. Project status: is it paused or over a quota (a paused GoTrue answers slowly or 503, which a browser
   can experience as a hang the 15s bound then ends).
2. Auth settings: the allowed redirect and site URLs, and whether the console origin
   (console.thriveiii.com) is in the allowed CORS origins, so the browser's preflight `OPTIONS` on the
   `apikey` header is answered rather than left to time out.
3. Any network restrictions or bans: a banned IP or a rate limit on the auth endpoint would reject or
   stall the browser while curl from a different network succeeds.

Whichever opens the door wins; the restore also rules the client code in or out for good.
