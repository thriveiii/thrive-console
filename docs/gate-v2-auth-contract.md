# GATE_V2: the gate authentication contract, replaced with the device-proven path (brief P53 GATE_V2)

## The design principle

No new auth invention. The fetch path already PROVEN on the failing iPad by authtest.html is transplanted,
and gate success is bound to signIn's RETURN VALUE, never to a storage read-back. Storage becomes a
best-effort mirror, never a decision input on the success path. The two on-device diagnoses this answers:
the passcode loop (a swallowed localStorage presence write read back as "not unlocked"), and the sign-in
that never became a session (a 200 token response that never reached token:ok, with signedIn() bound to a
storage read-back one layer later).

## Part 1: the token body read (library/supabase.js)

`authFetchOnce` replaces the blind `res.text()` + JSON.parse for the token call only: the body is read via
`res.arrayBuffer()` and decoded with `TextDecoder("utf-8")` (with a `res.text()` fallback for non-browser
test environments), a leading BOM is stripped, the text is trimmed, and JSON.parse runs inside try/catch
with the raw text kept for the diag. A 200 with an EMPTY body gets ONE automatic identical retry after
400ms inside `authTokenPost`; a still-empty body fails as a typed `kind:"empty"` error named "empty
response body", and an unparsable 200 body fails as `kind:"parse"`, never as a generic auth error. The P31
setTimeout race still bounds every attempt; the P50 bare fetch (no AbortController signal) is kept. The
`window.__lastTokenDiag` shape instrument (status, res.ok, typeof data, has_access_token, text_length,
body_head with token values REDACTED) is now a PERMANENT organ.

## Part 2: success bound to the return value (gate.js + supabase.js)

`signIn` returns the parsed session `{ access_token, refresh_token, expires_at, email, uid, user }` on
success; storing it is NOT a precondition of returning. The gate's attempt() binds success to that value
(`sess = await S.signIn(...); ok = !!(sess && sess.access_token)`) and hands the session to `finish(sess)`;
the old storage read-back binding (`ok = S.signedIn()`) is deleted. Every failure branch surfaces distinct
visible text: bad credentials (throttled, neutral), empty body after retry (`op_err_empty`, Retry), parse
failure (`op_err_parse`, Retry), timeout / network / unavailable (unchanged, Retry). There is no empty
catch anywhere in gate.js or the auth section: every caught error lands in a bounded note ring
(`window.__gateNotes` / `window.__authNotes`) the diag prints. A crypto.subtle absence or failure at the
passcode step surfaces `err_secure` ("secure connection required"), never "wrong passcode", and is not
throttled.

## Part 3: in-memory session, storage as mirror (library/supabase.js)

`__memSession` is restored as the PRIMARY store (reversing P47's removal, which the device proved was the
mistake on storage-blocked WebKit). `setSession` sets memory first, then mirrors to localStorage inside
try/catch; a mirror failure sets `__mirrorOk=false` and is recorded to the note ring, never thrown, never
silent. `session()` returns the memory session, falling back to the mirror only on warm boot; `signedIn()`
is `!!session()` and remains for warm-boot routing only. `clearSession` is exported so the gate's
`clearOperatorSession` clears the MEMORY session too (sign-out and lobby drops stay correct).

## Part 4: the presence layer gets the same cure (gate.js)

Passcode presence is memory-first (`__memPresence`), with the localStorage stamp as a mirror; `idleMs()`
consults memory first. On a storage-blocked device the worst case becomes re-entering the passcode after a
full reload, never a same-session loop and never a lockout. Mirror write failures are visible in the diag
(`window.__presenceMirrorOk`).

## Part 5: the gate phase is silent (app.js)

`autoSyncTick` and `scheduleSyncPush` hold until `window.__gateRevealed`, which `reveal()` sets. Before the
gate resolves, the page performs ZERO relay/echo calls; version convergence still runs at boot before the
gate renders (failsafe.js, unchanged), and the boot watchdog stands down when the gate card shows
(unchanged). This completes P52: not just "after the board read", but "never during the gate phase at all".

## Part 6: the diag teardown block (app.js)

The ?diag=1 readout adds: gate step (passcode / operator / none), the gate error text, `memSession` and
`session mirror ok` and `presence mirror ok` (booleans only, never a value), the last note-ring entries, and
the permanent last-token-POST block (body_head).

## Prohibitions held

The request shape proven by authtest is untouched: apikey header + JSON POST, no Authorization, cache
no-store, no abort signal on the token call (guarded by gate_v2_test C8 and the retained resilience F-checks).
No new dependencies; no official supabase-js (ruled out, P49). No board, views, relay, Lotus, newsroom, keys,
RLS, or DB change. No em dash. EN and AR strings follow the existing gate STR structure.

## Evidence

- New `gate_v2_test.js`: V1 to V7 runtime (returned session; blocked-storage memory hold with the session
  bearer on reads; the 400ms empty retry, timed; still-empty types "empty" after exactly 2 attempts; parse
  failure types "parse"; BOM parses; tokenless 200 types "auth" with the body's message) and C1 to C10
  source contracts (return-value binding + finish(sess); zero empty catches; the secure-context surface;
  memory-first presence; clearSession; both locales; the silent gate phase; the frozen request shape; the
  permanent instrument; no em dash). Fails-when-broken proven: re-binding ok to signedIn() reds C1,
  restoring one empty catch reds C2, removing the reveal guard reds C7.
- Reconciled to the new contract: `session_integrity_test` (S2 now asserts the memory session HOLDS with
  storage blocked and reads carry the SESSION bearer, the exact device failure cured), `signin_click_test`
  (S1/S2/G1), `signin_resilience_test` (A5/F8, B1 to B3, arrayBuffer + TextDecoder in the harness),
  `bare_metal_auth_test` (G3d: 3 bounded wrappers), `state_diag_test` (body_head, both settle paths).
- `verify.js` 35/35, `arabic.py` 0 failed. Full JS bed green (the pre-existing `supabase_stage1` docs-prose
  failure is identical on origin/main). Browser gates: `operator_gate_test` (the REAL flow: passcode ->
  operator -> sign-in success via the returned session -> reveal -> warm-boot persistence via the mirror ->
  sign-out to the lobby) all pass; `board_one_read_test`, `board_server_stage_test`, `deploy_marker_test`,
  `fresh_code_test` all pass.

## Acceptance (device-gated, the only definitions of done)

1. Fresh build stamp confirmed on the failing iPad (merged is not deployed is not device-proven).
2. Photo: the loaded board on the failing iPad after sign-in.
3. Three consecutive refreshes stay signed in (the warm-boot mirror path).
4. Basel and Mohammed each sign in from their own devices; photo each.
5. ?diag=1 shows the last token POST with has_access_token true and text_length greater than 0.
