# Reveal the real auth failure, and the device split (P35)

Reveal-only. This build does not change the request, the key, the headers, or the P31/P29 safety net. It
makes the one thing we have never captured visible: the exact reason the cold-start auth POST fails, and
whether a device boots from a stored session (no auth call) or cold-authenticates.

## What it adds

1. **The exact failure, verbatim, on the sign-in card.** `supabase.js` threads an optional observer through
   `signIn` -> `authTokenPost` -> `fetchJSON`. It records, without touching the request:
   - `stage`: the last of `fetch-created` / `response-received` / `body-read` / `fetch-rejected` / `timeout`;
   - `error` name and message (e.g. `TypeError: Load failed`, `AbortError`);
   - `http` status + statusText **if a Response was received** (this separates "network never returned" from
     "got a 4xx/5xx"), and the first 200 chars of the body on a non-2xx (the GoTrue error);
   - `elapsed` ms from submit to failure.
   On any failure the observer is attached to the thrown error as `err.diag`; the gate formats it into a
   **copyable block** (`p35Block`) and shows it in `#gateDiag` (plain text, selectable, no markup injection).

2. **The boot session line.** At `start()`, `p35BootLine()` logs whether a stored Supabase session was found
   and whether boot used it (session-restore, no auth call) or fell through to the cold sign-in card. This
   confirms the iPad-vs-others split: the iPad, holding a session from before the outage, should read
   `session-restore, NO auth call`; a fresh device should read `cold auth ... POST /auth/v1/token`.

3. **A visible, copyable diagnostic panel.** `window.__DIAG` (already a guarded no-op call site in
   `supabase.js` and the gate) is made real: a fixed, selectable panel that receives the boot line, the
   existing auth breadcrumbs, and the failure block. So even on the iPad (where the sign-in card never
   shows) the boot decision is visible on the board.

The P31 timeout race and the P29 error surface are untouched; this only makes their message specific.

## What each captured stage will mean (so the next step is immediate)

- **`fetch-rejected`, `TypeError: Load failed`, no http status**: the browser aborted the connection to
  Supabase (TLS, HTTP/3, or the network path). Environmental, per device/network. Next step: network (VPN,
  disable HTTP/3, different route) and Supabase support with a HAR.
- **`body-read`, http 401 + a GoTrue body**: the key/auth is still rejected server-side despite the header;
  the body names why (bad key, disabled legacy key). A dashboard/key-system fix.
- **`body-read`, http 4xx/5xx other than 401**: GoTrue reached and responded; the body names the exact
  problem.
- **`timeout` at ~15s**: the request truly never returns; back to transport/network.

## Evidence

- **`tools/auth_diag_surface_test.py` (real Chromium)** drives a failing sign-in and reads the on-screen
  block:
  - a **401 with a GoTrue body** shows `stage: body-read`, `http: 401 Unauthorized`, the body
    (`Invalid API key`) verbatim, and `elapsed: ...ms`; the boot panel logged the cold-auth decision.
  - a **network reject** (`fetch` throws) shows `stage: fetch-rejected`, `TypeError: Load failed`, and
    `(no response received)`.
- **`tools/signin_resilience_test.js`** (Node): C10-C17 assert the structured block, the boot line, the
  wired `__DIAG` panel, the diag threading in `supabase.js`, and **C17: the request itself is unchanged**
  (still the P34 apikey-header shape). Part F updated to the correct P34 header shape (it had gone stale
  asserting the discredited P32 header-less shape). `supabase_auth_test.py` still green.
- **Gates:** `verify.js` 35/35, `arabic.py` green. Bundle deterministic.

## Device-gated (Thyab, fresh stamp first)

1. On a **failing device (not the iPad)**: attempt sign-in and screenshot the failure block (stage, error,
   http status if any, GoTrue body if any, elapsed). This is the fact we have never had.
2. On the **iPad**: screenshot the boot line showing the stored session was used (why it "works").
3. A **wrong password** on a working path returns a fast, specific credential block (real GoTrue error, not
   a generic string).

## Do not (held)

The request shape, the key, and the headers are unchanged (C17 + Part F). No second fix hypothesis is added.
The P31/P29 safety net is intact. No DB or foreign-project reference touched. This panel is temporary and is
removed in a follow-up once the ground-truth screenshot is captured, exactly as the P29 -> P31 build was.
