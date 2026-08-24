# The regression hunt: git names the line between token:sent and token:ok (P46)

## Ground

Sign-in freezes in the browser at the strip mark `sign token:sent` and never reaches `token:ok`. A
raw `curl` of the same `/auth/v1/token` endpoint succeeds, because curl bypasses the application's
own JavaScript and the browser's CORS machinery. So the fault is between the two marks the P44 click
path already draws, in the code the browser runs and curl does not. This phase used git, not
instrumentation, to name the exact line that changed, then made the smallest revert that line allows.

## Phase 1: the read-only forensics (verdict before a single fix line)

### 1. signIn() verbatim, the two marks named

`library/supabase.js`, the sign-in path between the marks:

```
207    signMark("token:sent");
208    var r = await authTokenPost(c, "password", { email: email, password: password }, opts.fresh);
       ... typed-error branch on a non-ok / tokenless response ...
218    signMark("token:ok");
```

Between `token:sent` (207) and `token:ok` (218) there is exactly **one** await (208), and it awaits
**only** the network: `authTokenPost` returns the `fetchJSON` promise and nothing else is awaited.
The token call cannot hang forever regardless: `fetchJSON` is wrapped by the P31 setTimeout race and
rejects at `FETCH_TIMEOUT_MS = 15000`. Nothing but the network sits between the two marks.

### 2. The token-request path: hand-built fetch, not supabase-js

`authTokenPost` builds the request by hand and hands it to `fetchJSON`. It is not the official
`@supabase/supabase-js` client. Its single job is a POST with an `apikey` header and a JSON body.

### 3. git log of the token call across the outage window

`git log -L` over `authTokenPost` in `library/supabase.js`, newest first:

| commit  | phase | change to the token call |
| ------- | ----- | ------------------------ |
| 1beb95d | P36   | comment only (bare-metal narrative), header set unchanged |
| a2a4ea3 | P35   | comment only, header set unchanged |
| **a67056a** | **P34** | **restored the `apikey` HEADER and ALSO added `Authorization: Bearer <anon>`** |
| 6aa4b52 | P32   | moved the apikey to a query param (CORS-simple), no `apikey` header at all |

`git log -S 'Authorization": "Bearer " + c.anon' -- library/supabase.js` names **a67056a (P34)** as
the sole commit that introduced that Authorization header on this token call. It is the one
substantive delta to the token request between the last-known-working build and today.

### 4. The decisive artifact: signIn token headers, known-good vs today

The last build that signed operators in without this freeze was **5c9cefe** ("close the open anon
door", the Path A auth commit). Its token POST, verbatim:

```
headers: { "apikey": c.anon, "Content-Type": "application/json" },
```

P34 (a67056a) changed that to:

```
headers: { "apikey": c.anon, "Authorization": "Bearer " + c.anon, "Content-Type": "application/json" },
```

The `Authorization: Bearer <anon>` header is present in **no** version of this client that ever
signed a person in. It is the single delta the diff isolates between the known-good shape and today.

## Phase 2: the smallest possible revert

The diff named one line. This phase reverts exactly that line and nothing else:

```
- headers: { "apikey": c.anon, "Authorization": "Bearer " + c.anon, "Content-Type": "application/json" },
+ headers: { "apikey": c.anon, "Content-Type": "application/json" },
```

The `apikey` header stays: GoTrue requires it (P34 proved on device that a header-less, query-param
apikey is rejected as "Invalid API key"; P32's CORS-simple reshape is what P34 correctly undid). Only
the redundant `Authorization: Bearer <anon>` on an unauthenticated password grant is dropped, back to
the exact header set every working build sent. One commit, one concern. The DB, keys, RLS, and every
other request path (`rest`, `signOut`, uploads, the refresh grant) are untouched.

## Phase 3: proof before the word "fixed"

### Regression guard (in the bed, permanent)

`tools/signin_click_test.js` gains two runtime scenarios against a mocked 200 token response:

- **S5** asserts `signIn` reaches `token:ok` (the browser freeze never did).
- **S6** asserts the captured token POST carries the known-good header set: `apikey` present,
  `Content-Type: application/json` present, and **no** `Authorization` header. Re-adding the reverted
  header reds S6 and only S6 (proven fails-when-broken). This exact regression cannot ship silently
  again.

Two P34-era suites that were written to lock the Authorization header IN were reconciled to the
known-good shape, since they encoded the regression as a contract: `tools/supabase_auth_test.py` (the
sign-in POST does NOT send an Authorization header) and `tools/signin_resilience_test.js` (C15, F2,
F6). The full gate bed is green (the one standing exception, `supabase_stage1` "no Lotus reference",
predates this branch and is unrelated to auth).

### Device proof (the arbiter, pending on the iPad)

Confirm the fresh build stamp on the iPad (Thyab), sign in once, and photograph the failsafe strip
advancing past `sign token:sent` to `token:ok` and the board. Only that photograph earns the word
"fixed".

## The honest caveat

git names the Authorization header as the one delta, and reverting to a proven-working shape is the
correct smallest move the diff allows. But the revert is **not proven causal**:

- P42's 04:49:57Z capture recorded the current header shape returning **200** from
  `/auth/v1/token`, so the header is not an unconditional failure.
- The await between the marks is bounded at 15s and cannot hang forever, so a permanent freeze at
  `token:sent` is not fully explained by this header alone.
- `apikey` is itself a non-simple header, so removing `Authorization` reduces the header set but does
  **not** by itself eliminate the CORS preflight (P32's thesis). The preflight surface shrinks; it is
  not removed.
- P45 raised the project's own network perimeter as an unexamined layer.

So this ships as the smallest revert to the last-known-working header set, with a permanent guard, and
the iPad photograph decides. **If `token:sent` still freezes on device, the revert did not address the
true line: return to Phase 1 and widen the blame past signIn into gate.js and app.js.**
