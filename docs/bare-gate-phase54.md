# BARE_GATE: the device-proven authtest path promoted into the real gate (brief P54)

## The design principle

One file owns the entire auth path, with nothing from the console bundle loaded during it. `gate.html` is a
standalone same-origin page. It performs passcode + email/password sign-in using the pristine native fetch
and the frozen request shape proven to complete on the failing iPad by `authtest.html` (400 in 253ms), reads
the token body via arrayBuffer + TextDecoder, and on success writes the session to memory AND a best-effort
localStorage mirror, then navigates to `index.html`, which boots the console and reads the session from the
mirror. This is an escalation path, not a diagnosis: it transplants the exact page already proven to complete
auth on the device and makes it the gate. It ships only if the P53/V2 sign-in still hangs after a
correctly-captured attempt; until then the PR stays open and unmerged.

## Part 1: gate.html, the standalone gate

`gate.html` is self-contained: inline CSS (brand `#07070b`, Lato with a system fallback, the in-repo asterisk
mark), no import of `app.js`, the model, the views, the relay, or `supabase.js`, and it invokes no console
runtime global. The connection values and the passcode verifier are the same public-by-design values
`library/config.js` bakes and `authtest.html` carries, kept literal so the page shares zero console code.

- Passcode step: PBKDF2-SHA256 at 120,000 iterations against the same `GATE_SALT` and `HASH` the console gate
  uses; a match derives and mirrors the sync and vault credentials and the presence stamp, then advances to
  the operator step. A missing `crypto.subtle` surfaces `err_secure` ("secure connection required"), never
  "wrong passcode".
- Operator step: the single inline auth function IS authtest's proven body. The request shape is frozen
  (apikey header + JSON POST, NO Authorization, `cache: "no-store"`, and a BARE fetch with no
  AbortController signal), bounded by an independent `setTimeout` race. The body is read via
  `arrayBuffer` + `TextDecoder`, a BOM is stripped, trimmed, and `JSON.parse` runs inside try/catch with the
  raw text kept. A 200 with an empty body gets ONE automatic identical retry after 400ms; a still-empty body
  fails typed `empty`, an unparsable 200 fails typed `parse`, a tokenless 200 or a 4xx fails typed `auth`, a
  5xx fails typed `unavailable`, and the transport contributes `timeout` / `network`. `window.__lastTokenDiag`
  records the SHAPE only (status, `res.ok`, `has_access_token` boolean, `text_length`, redacted `body_head`),
  never a token value.
- On success: `window.__memSession` is set AND the localStorage mirror is written
  (`console_sb_session` + `thrive_presence`); a mirror write failure is surfaced visibly and the page does
  NOT navigate (never a silent swallow). Otherwise it navigates to `index.html?warm=1`.
- Every failure surfaces visible typed text; there is no empty catch (both last-resort recorders carry the
  same intent comment the console's `gnote` / `sbNote` rings do). EN and AR strings are the existing gate STR.

## Part 2: index.html, the session-aware router

The root becomes a router (generated from the `rootIndex` template in `tools/bundle.js`, with the connection
values sourced from `config.js` so they never drift). No `version.json` probe sits in the critical path. The
meta refresh still fires at 0s to the current shell as the JS-off fallback, and the inline JS decides at once:

1. `?warm=1` (just returned from a successful bare-gate sign-in): forward to the console.
2. A live operator session in the mirror: forward to the console, with no network on the warm path.
3. An expired token: ONE silent bounded refresh with the frozen request shape (arrayBuffer + TextDecoder
   read); success re-mirrors and forwards, a failure or timeout bounces to `gate.html`.
4. No session at all: bounce to `gate.html`, the proven auth path, never a black screen.

## The cross-navigation session carry

Because `gate.html` and `index.html` are separate documents, an in-memory-only session does not survive the
navigation. The carrier across the hop is the storage mirror (proven writable on this device). If a future
device is genuinely storage-blocked, the fallback is the silent token refresh on the index boot; this is
acceptable because on this device storage works, and the refresh path covers the blocked case without a
lockout. The in-console gate (unchanged) stays the fallback: a device that somehow reaches the console
without a mirror still meets it.

## Prohibitions held

Request shape frozen. No new dependencies, no supabase-js. No em dash. Existing i18n strings, EN and AR. No
change to the board, the relay, Lotus, the newsroom, keys, RLS, or the DB. The console bundle is byte
identical (only the build timestamp restamps; the BUILD hash is unchanged, so the console `?v=` cache stays
valid and the change lives entirely at the two entry documents).

## Evidence

- New `tools/gate_bare_test.js`: B1 to B10 runtime (the REAL `gate.html` script run in a vm sandbox against a
  controllable fetch: returned session; the frozen request shape with no Authorization and no abort signal;
  the timed 400ms empty retry; typed empty / parse / auth / unavailable; BOM parses; `__lastTokenDiag` shape
  only; the operator submit writes memory + mirror + presence and navigates to `index.html?warm=1`; a
  blocked-storage success is shown and does NOT navigate) and S1 to S7 source contracts (the explicit body
  read, the return-value binding, no empty catch, the self-contained page, the session-aware router in both
  the generated `index.html` and the `bundle.js` template, the frozen-shape refresh, both locales).
  Fails-when-broken proven: adding Authorization to the gate token headers reds B2; removing the no-session
  bounce reds S5.
- Reconciled to the new contract: `version_integrity_test` V2 (the front door is a session-aware router, no
  version.json probe) and `fresh_code_test` (a fresh no-session visit lands on `gate.html`; a mirrored
  session forwards to the versioned shell).
- `verify.js` 35/35, `arabic.py` 0 failed. `operator_gate_test` (the in-console GATE_V2 flow, unchanged) all
  pass. `deploy_marker_test` passes. The isolation grep (lotus / newsroom) is 0 in `library/console.html`.

## Acceptance (device-gated, the only definitions of done)

1. Fresh stamp on the failing iPad.
2. Photo of the loaded board after sign-in via `gate.html`.
3. Three refreshes stay signed in (the warm-boot mirror path).
4. Basel and Mohammed each sign in from their own devices; photo each.
5. `?diag=1` on the console shows the last token POST with `has_access_token: true` and `text_length > 0`.
