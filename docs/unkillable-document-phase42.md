# One outage, two documents: wire the dying page, close the three silence gaps (P42)

## The in-repo evidence pass (recorded before any edit)

**1a, the tag census of `library/console.html` (repo, build 67d16c40).** Two stylesheets
(`fonts.css?v=`, `styles.css?v=`) and fifteen script srcs (`config, icons, i18n, gate, stage-model,
lifecycle, intake, supabase, numbers, inbound, kinds, store, drafts, flows, app`), all directory-relative,
each resolving against `/library/` to `/library/<file>`; every referenced file exists in the repo. No tag
duplicates the `library` segment, none escapes the path. The only `../` reference is the icon
(`../assets/thrive-logo.png` to `/assets/`), an image, not a script or stylesheet.

**The decisive census fact:** repo console.html at 67d16c40 ALREADY carries failsafe as its FIRST script,
INLINED by `tools/bundle.js` (P40), at line 12, before every other script. There is no
`<script src="failsafe.js">` tag, which is exactly why a grep of the live text for a failsafe TAG comes up
empty; the code itself is present inline. So the brief's wiring premise ("console.html does not load
failsafe.js") does not hold against the repo. If the failing device truly rendered this document, the
heartbeat renders at parse. A device with no strip is therefore executing a DIFFERENT document body (a
stale cached shell predating P40/P41) or an engine where the inline block did not run; the belt-and-braces
wiring below covers both, and the three gap closures matter regardless.

**1b, live verification.** Outbound HTTPS to console.thriveiii.com is blocked from the authoring container
(proxy refuses; every probe returns no connection). The five URLs to verify by hand (curl or browser),
expected 200 each: `/library/console.html`, `/library/failsafe.js`, `/library/app.js?v=<current>`,
`/library/styles.css?v=<current>`, `/index.html`. Every URL corresponds to a committed file, so if Pages
serves the repo, all five are 200.

**1c, the hidden class and its reveal line.** The shell is hidden by `gate-locked` on `<html>`:
`html.gate-locked .top, html.gate-locked .wrap { display:none !important }` (`library/styles.css:498`),
set by the head bootstrap when the passcode hash is absent. The line that reveals it in a healthy boot is
`document.documentElement.classList.remove("gate-locked")` (`library/gate.js:171`, inside `reveal()`).

**Also settled:** the "Opening the Thrive Opportunity Library" page is the ROOT `index.html` redirect; its
script carries query params and the hash to `./library/console.html?v=<BUILD>`. The post-sign-in step
itself does not navigate; sign-in happens ON console.html (the gate overlays it) and `finish()` reveals in
place.

## What was built

### Wiring (via `tools/bundle.js`, the generator of console.html)
- `failsafe.js` now has a content fingerprint and the linked shell emits
  `<script src="./failsafe.js?v=<hash>"></script>` immediately after the inline block: the INLINE copy
  runs at parse time and cannot 404; the TAG re-loads the same file so even a stale shell stripped of the
  inline still installs it. A new idempotence guard in failsafe.js (`window.__thriveFailsafeLoaded`) makes
  whichever copy runs second a no-op, so the pair can never double-register or double-paint.
- Every linked script and stylesheet tag is normalized to the ONE `./` convention (`./config.js?v=`,
  `./styles.css?v=`, ...), byte-identical resolution, no mixed styles. (Root-absolute was rejected: it
  would break any non-custom-domain preview; the brief allows either.)
- console.html, index.html, and dist are regenerated from this; the generator is the only way to edit
  console.html (repo law), which is why bundle.js is touched.

### `library/failsafe.js`, the three gap closures
- **GAP 1, resource errors.** A second error listener registered with `capture=true`. A 404ing script or
  stylesheet fires its error on the ELEMENT, which never reaches the bubble-phase window listener; capture
  sees it, and the panel prints `Resource failed: <resolved URL>` (URL only, never content), EN then AR.
  Plain uncaught errors keep the existing name/message/stack line; `shown` guards any double-fire.
- **GAP 2, the self-armed sentry.** On any document carrying the `thrive-build` meta, failsafe arms its
  OWN fallback timer (same WATCHDOG_MS) at parse time, no dependency on the app calling
  `__thriveFailsafeArm`. It stands down when anything legitimate painted: the board (`__bootPainted`) or an
  interactive gate card (`__thriveBooted`, set by gate.js the moment the sign-in card shows), so a
  signed-out operator reading the gate never sees it. The app-armed path remains; whichever fires first
  wins.
- **GAP 3, the reveal guarantee.** Whenever the panel fires, failsafe removes `gate-locked` from `<html>`
  (the class from evidence 1c), restores body scrolling, and drops any stranded gate overlay, so the
  static shell becomes visible. The panel itself is now a TOP SHEET (max-height 75vh) rather than a
  full-screen cover, so the revealed shell stays visible beneath it. Black is impossible by construction:
  either the app painted, or the shell plus the panel are visible.

Nothing else changes: P40 panel semantics, the P41 strip, the checkpoints, and healthy-boot invisibility
(beyond the strip's brief self-removing line) all stand.

## Evidence

- **`tools/failsafe_surface_test.js`** (Node, DOM-shimmed, capture-aware): 17 checks, all pass; the twelve
  P40/P41 cases unchanged, plus:
  - G1: a resource error dispatched capture-phase panels with the failing URL (EN + AR);
  - G2: a dead document that never arms still panels via the self-armed sentry; G2b: the sentry stands
    down over a healthy signed-out gate (`__thriveBooted`);
  - G3: the panel removes `gate-locked`, so the shell reveals;
  - G4: a second evaluation of the file (inline + tag) is a no-op: one strip, one panel.
- Deliberate-failure outputs (quoted in the PR body): the 404ing-script panel naming the URL with
  `gate-locked removed: true`, and the never-armed document panelling "Console boot stalled" while the
  booted-gate case stays silent. These are committed harness cases, not throwaway pages, so the proof
  re-runs in CI forever.
- **Gates:** `verify.js` 35/35 (incl. zero em dashes), `arabic.py` 0 failed, `bare_metal_auth` 0 failed,
  `session_integrity` / `signin_resilience` / `supabase_auth` / `deploy_marker` / `fresh_code` /
  `board_one_read` all pass. Western numerals; shipped-shell isolation grep 0; the stamp advances
  (a6a10b4b). Pre-existing benign exception: `supabase_stage1` "no Lotus reference".

### Device-gated (Thyab, fresh stamp first)

1. Confirm stamp a6a10b4b on the failing device; clear site data for console.thriveiii.com if it does not
   advance.
2. Sign in on the failing device: black is impossible. Photograph whichever appears: a populated board; the
   shell with the strip naming the frozen mark; a panel naming an error or a failed resource URL; or rows
   0, which routes to the standing members SQL.
3. Cold direct load of `/library/console.html`: the shell with its signed-out state, never black.
4. Healthy desktop boot: shell reveals normally, strip self-removes after paint.
5. Capture the five live URL statuses from 1b (blocked from the authoring container).

## Standing debt, unchanged

The read-only members SQL for operator 38864a57-4d66-4525-a4a4-d83880c2ce63 remains unrun and becomes the
immediate next step the moment any instrument prints rows 0.

## Do not (held)

Auth, keys, session logic, the DB, Lotus, and the newsroom untouched. Only failsafe.js and console.html
(via its generator bundle.js) changed; the test extends alongside. No token values, row content, or payload
printed anywhere: URLs, counts, and marks only. No victory declared from the desktop; the failing-device
photograph is the proof. Author only, not merged, not released.
