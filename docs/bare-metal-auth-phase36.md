# Bare metal: one clean auth path, zero diagnostics, one standalone repro (P36)

## Ground

Across P32 through P35 the sign-in path accreted three diagnostic layers on top of the auth call: a
build-time preflight verification panel emitted by `bundle.js`, a P35 in-gate diagnostic block
(`ensureDiagPanel` / `__DIAG` / stage breadcrumbs) in `gate.js`, and diagnostic threading through
`fetchJSON` / `authTokenPost` / `signIn` in `supabase.js`. None of these was a `window.fetch` wrapper
(the shipped build never reassigned `fetch`), but together they made it hard to say, at a glance, that
exactly one code path performs the auth request and nothing observes or reshapes it.

P34 already established the root cause and the fix: GoTrue's token endpoint requires the `apikey` as a
**header**, and #197 restored it. This phase does not change the request. It strips the scaffolding down
to bare metal so the working auth path is the only thing left, and adds one standalone page that
reproduces the exact request outside all console code.

## What was removed

- **`bundle.js`**: the entire build-time preflight verification panel `<script>` block (the one that
  created `#__preflightDiag`, `window.__DIAG`, and a heartbeat `setInterval`). The shipped shell no
  longer carries it.
- **`gate.js`**: the P35 diagnostic block (`ensureDiagPanel`, `p35log`, `__diagLines`, `window.__DIAG`,
  `p35BootLine`, `p35Block`) and the `DIAG(...)` helper and its call sites. `attempt()`'s catch reverts
  to the minimal typed-error message; `showDiag`'s slice reverts from 900 back to 200 chars.
- **`supabase.js`**: the diagnostic parameter threaded through `fetchJSON` and `authTokenPost`, the
  `authDiag()` and `nowMs()` helpers, and the try/catch-with-diag around the sign-in call. `signIn` is
  now minimal: one `authTokenPost`, one typed-error branch, one `setSession`.
- **`styles.css`**: `.gate-diag` reverts to its pre-P35 single-line form.
- Deleted the P35 artifacts: `tools/auth_diag_surface_test.py` and `docs/auth-diagnostic-phase35.md`.

## The one auth path

`signIn` calls `authTokenPost` once. `authTokenPost` builds the URL in one place (`authTokenUrl`) and
sends the standard, proven header shape:

```
apikey: <anon>
Authorization: Bearer <anon>
Content-Type: application/json
```

with a JSON body and `cache:"no-store"`. It is still wrapped by exactly the two safety layers the brief
keeps:

- **P31 setTimeout race** (`raceTimeout` + `Promise.race([run, to.promise])`): a stall rejects at 15s,
  it never hangs.
- **P29 typed-error surface**: a 5xx is `unavailable`, anything else is `auth`; the gate shows a specific
  message and a one-tap Retry.

`refresh` uses the same `authTokenPost` helper, so a boot refresh of an expired token authenticates
through the identical header shape.

## The standalone repro: `/authtest.html`

A single self-contained page at the repo root, roughly 40 lines, carrying **zero console code** (no
`<script src>`, no shared module, the URL and public anon key inlined literally). Two buttons:

1. **health GET** to `/auth/v1/health` with the `apikey` header.
2. **token POST** to `/auth/v1/token?grant_type=password` with the full header shape and a deliberately
   wrong password.

Each prints `status`, `body` (first 500 chars), `error` (name + message), and `elapsed` ms. It is the
discriminator: if a call here works but the console hangs, the delta is console code; if a call here
hangs too, the block is domain-level (service worker, CSP, network), not the console.

## Service worker and CSP audit

- **Service worker**: the shell registers **none**. It only calls `getRegistrations()` and
  `unregister()` to evict any stale worker from an earlier build. So no worker can intercept the auth
  fetch.
- **CSP**: there is **no** `Content-Security-Policy` or `connect-src` meta in the shell, so no policy
  constrains the auth origin.

Both are asserted by the grep gates below, not just stated here.

## Evidence

- **`tools/bare_metal_auth_test.js`** (Node), all pass (grep gates on the shipped build):
  - **G1**: `window.fetch` (and `self`/`globalThis`.fetch) is never reassigned in `console.html`, `dist`,
    `supabase.js`, or `gate.js`.
  - **G2**: zero diagnostic/overlay strings (`__DIAG`, `PREFLIGHT`, `__preflightDiag`, `ensureDiagPanel`,
    `CORS-SIMPLE`, `preflight check`) in `console.html` and in the inlined `dist`; `bundle.js` no longer
    emits the preflight panel.
  - **G3**: exactly one `authTokenPost` definition, called once by `signIn`; the token URL is built in one
    place; the only bare `fetch()` calls in `supabase.js` are the two timeout wrappers.
  - **G4**: the sign-in path has no logging/diag; the P31 race and P29 typed-error surface are intact.
  - **G5**: `authtest.html` loads no external/console script, has both buttons, sends the same header
    shape, and prints status/body/error/elapsed.
  - **G6/G7**: no service worker registered (stale ones unregistered); no CSP/connect-src meta.
- **`tools/signin_resilience_test.js`** (Node): reverted to the minimal typed-error assertions; new
  bare-metal checks confirm `gate.js` carries no `p35`/`__DIAG`/`DIAG`, `supabase.js` carries no
  `authDiag`/`__DIAG`/`diag`, and the auth request is the minimal standard header shape. 0 failed.
- **Gates**: `verify.js` 35/35, `arabic.py` green. No em dash; Western numerals; shipped-shell isolation
  grep 0. Full Node bed green except the pre-existing benign `supabase_stage1_test.js` "Lotus" reference
  (older docs prose; reproduces on `main` with this change stashed).

### Device-gated checks (Thyab runs, fresh stamp first)

1. Open `/authtest.html` on the device that fails today. Tap health GET, then token POST. Record status
   and elapsed for each. A fast, clear response on both means the transport and the request shape are
   fine and the delta is console code; a hang on either means a domain-level block.
2. On the console: a real sign-in returns a session and loads the board; a wrong password returns a fast,
   clear error, not a hang.

## Do not (held)

No new diagnostic layer was added; the three prior layers are gone. The key, headers, and DB path are
untouched (the header shape is exactly #197's). The P31 race and P29 error surface are kept, minimal.
No Lotus, no newsroom. The iPad stays signed in.
