# BOOT_FIRST_PAINT: the console must reach first paint on a marginal connection

## Device evidence

After signing in and passing both gates (the passcode and the operator sign-in), the operator was stranded
FOREVER on the root index splash ("Opening the Thrive Opportunity Library..."), unable to reach the app.
This is a distinct failure from the earlier black screen (cured by P55 paint-first) and the operator token
hang (routed to the standalone gate by P56): here the session is valid, but the transition into the console
never completes.

## The diagnosis, precisely

The root `index.html` is a session-aware router. On the warm and live paths it calls, at once,
`location.replace("./library/console.html?v=BUILD")`. A navigation does not repaint until the NEW document
reaches its first paint; until then the browser keeps showing the PREVIOUS document. So while console.html
is loading, the screen the operator sees is still the index splash.

console.html's `<head>` carried two RENDER-BLOCKING stylesheets:

    <link rel="stylesheet" href="./fonts.css?v=...">    (~327 KB, self-hosted base64 fonts)
    <link rel="stylesheet" href="./styles.css?v=...">   (~201 KB, the app stylesheet)

A render-blocking `<link rel="stylesheet">` withholds the document's FIRST paint until the sheet has fully
downloaded and parsed. Together these are ~528 KB. On the failing iPad's marginal / airplane-mode-adjacent
connection, that download never completes, so console.html never reaches first paint, so the browser never
swaps away from the index splash. The console was, in effect, painting-blocked behind half a megabyte of CSS
that the connection could not deliver.

The head already carried a self-sufficient inline `<style id="gate-critical">` block that can paint the
gate/boot frame with a system font stack and literal colours. It could not help, because the two
render-blocking links after it blocked the paint anyway.

## The fix

Load the two heavy stylesheets NON-render-blocking, leaving the inline critical block to paint the frame the
moment the HTML arrives:

    <link rel="stylesheet" href="./fonts.css?v=..." media="print" onload="this.media='all'">
    <link rel="stylesheet" href="./styles.css?v=..." media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="./fonts.css?v=..."><link rel="stylesheet" href="./styles.css?v=..."></noscript>

`media="print"` takes the sheet off the screen paint path (the browser still downloads it, but it no longer
blocks first paint); `onload="this.media='all'"` flips it back to screen the instant it finishes, so the full
styles apply. Because the swapped-in rules sit later in document order than the inline critical block and at
equal specificity, they win and govern the final look, exactly as the render-blocking links did. The
`<noscript>` fallback keeps the sheets render-blocking when scripting is off (where `onload` cannot run).

This changes only the SERVED build (`tools/bundle.js`, the non-inline branch of `build()`). The offline
`dist/thrive-console.html` still inlines all CSS into the head and carries no external stylesheet link.

### No flash of unstyled content in practice

The board is revealed by `app.js` (~890 KB), requested from the end of the body in parallel with the two
sheets. styles.css (~201 KB) is far smaller and is applied well before app.js has downloaded, parsed, and run
to the point of revealing a board. So the operator never sees an unstyled board; they see, in order: the
styled gate/boot frame (inline critical CSS, immediate), then the fully styled console. The only thing the
async load can defer briefly is the webfont swap, for which the critical block already declares a system
fallback stack.

## Why this is the right fix

The stranding was a first-paint problem, not an auth, session, board, or data problem. Nothing about the
board content, the gate, the auth contract, the relay, Lotus, the newsroom, keys, RLS, or the DB is touched.
The change is one emit in the bundler: the same two stylesheets, same URLs, same order, same cascade
outcome, detached from the paint-blocking path so the console can paint on a connection that cannot deliver
528 KB before the operator gives up.

## Evidence

`tools/first_paint_test.py` (browser, fails-when-broken) proves it at the engine level:

- Source: the served console.html loads both sheets `media="print" onload="this.media='all'"`, keeps a
  `<noscript>` fallback, keeps the inline `gate-critical` block before the links, and the offline dist has
  zero external stylesheet links.
- Scenario A (the cure): with BOTH stylesheets hung (the route never responds, simulating the marginal
  connection), console.html still reaches `first-contentful-paint` within a short bound, and the sheet links
  are still `media="print"` at that moment, proving the paint came from the inline frame, not from the
  sheets slipping in.
- Scenario B (styles still apply): on a normal load both links end at `media="all"` (their `onload` swap
  fired) and a styles.css-only token (`:root --bg`) is in effect, proving the full stylesheet governs the
  page after the swap.

Fails-when-broken confirmed: reverting the two links to render-blocking makes Scenario A's
first-contentful-paint never fire while the sheets hang (`fcp_ms: 0`) and the test goes red, reproducing the
exact device symptom.

Gates: `verify.js` 35/35, `arabic.py` 0 failed. Auth/version Node cluster green (`version_integrity_test`,
`gate_v2_test`, `gate_breach_test`, `gate_bare_test`, `failsafe_surface_test`, `session_integrity_test`,
`signin_resilience_test`, `state_diag_test`, `warmboot_sync_defer_test`). `fresh_code_test.py` green (the
live shell still boots, forwards on a live session, and shows the build stamp). Isolation grep for
lotus/newsroom is 0 in `library/console.html`.

## Prohibitions held

No change to the gate, the auth/session contract, the board data, the views, the relay message content,
Lotus, the newsroom, keys, RLS, or the DB. No new dependencies. No em dash. Generated files
(`library/console.html`, `dist/thrive-console.html`, `index.html`, `version.json`) regenerated only via
`node tools/bundle.js`. Western numerals throughout.

## The delivery gap: why the correct fix did not reach the device (follow-up)

After the first-paint fix merged and Pages deployed it, the operator (and the whole team) were STILL stranded
on the index splash. The fix was correct but was not being delivered, for a deployment-integrity reason:

`BUILD` (the content signature the whole cache-busting system depends on) was computed over the module
sources plus css ONLY, not over the shell template that `tools/bundle.js` assembles. The first-paint fix
changed how the shell is built (the stylesheet link tags), but touched no module, so `BUILD` stayed
identical (`a1c92c04`, the same as the previous deploy). The root `index.html` router therefore kept
pointing at `console.html?v=a1c92c04`, the exact URL under which every device had already cached the OLD
render-blocking shell. GitHub Pages serves `console.html` with a short max-age and an ETag, so a device that
held the old shell (especially on a marginal or airplane-adjacent connection that serves from cache without
revalidating) kept running it. The versioned-URL cache-bust, the load-bearing guarantee that a deploy
reaches the device, never fired for a shell-only change.

### The fix

`BUILD` now folds the generator's own source (`tools/bundle.js`) into the hash, so any change to how the
shell is assembled bumps `BUILD`, changes every versioned URL, and forces a fresh fetch of the shell. The
recipe is part of the product's identity. Re-bundling stays deterministic (the generator source is stable
across runs), so the determinism guard (`deploy_marker_test`) still holds. This deploy's `BUILD` changed to
a fresh value, so the async-CSS shell is force-delivered to every device on next load.

### Evidence (delivery)

`tools/shell_fingerprint_test.js` (Node, fails-when-broken) recomputes `BUILD` the way the generator does and
proves: the generator reads its own source into the hash input; the recomputation equals the shipped
`version.json` build; a shell-only change to the generator produces a DIFFERENT build (the cache-bust fires);
omitting the generator yields a different value than shipped (it is genuinely included); a runtime-module
change still changes `BUILD` (module coverage preserved); and the index router and shell both stamp the
shipped build so the versioned URL tracks the fingerprint. If someone drops the generator from the hash,
the shell-only-change check goes red.

### Immediate operator workaround (no deploy wait)

Because the already-deployed `console.html` at the OLD version URL is the async-CSS shell, a device can reach
it right now by discarding the stale cached copy: open the site in a Private/Incognito tab, or clear the
site's website data (Settings, Safari, Advanced, Website Data, remove console.thriveiii.com), then reload.
Once the new `BUILD` deploys, this is unnecessary; the new versioned URL fetches the fresh shell on its own.

## INDEX_RESILIENCE: the root can never strand the operator (follow-up)

Even after the fingerprint fix force-delivered the new shell, operators stayed on the root index splash
("Opening the Thrive Opportunity Library...", tab stuck at "Loading") in a private tab with cleared cache.
The index fetched fine (its splash rendered), but the hand-off to the next document never committed. Two
defects, both in `index.html`:

1. **A racing double navigation.** The index fired a `0s` meta refresh to `console.html` AND the JS router's
   `location.replace` at the same moment: two top-level navigations at once, a state WebKit can hang on. That
   matches the evidence exactly (index paints every time, the hand-off hangs every time).
2. **No way out.** While a hand-off hangs the browser keeps the index visible but suspends its JS, so any
   timer-based escape never fires. There was nothing tappable to retry with.

### The fix

- The `0s` meta refresh is removed. The JS router is now the SINGLE hand-off, deferred a beat so first paint
  lands first. One top-level navigation, never a meta+JS race.
- The escapes are STATIC HTML painted at first paint: a sign-in-page link (`gate.html`), a direct console
  link, and a menu link. Tapping an `<a>` is a browser action, not a page-script action, so these work even
  while a hung hand-off has suspended the document's JS. A fresh navigation or retry often clears an
  intermittent WebKit hang the first attempt stalled on.
- `?stay=1` suppresses the auto hand-off, turning the root into a reliable manual launcher
  (`console.thriveiii.com/?stay=1`): the 5 KB index always loads, and the operator taps their way in.

The router decision is unchanged (warm/live forward to the shell, no session to `gate.html`, expired token
one bounded refresh), and the happy path still auto-navigates (session to console, no session to gate),
proven in a browser.

### Evidence (index resilience)

`tools/index_watchdog_test.py` (source + browser, fails-when-broken): the meta refresh is gone; the static
escapes are in the markup and reach `gate.html` and the console; the router is a single deferred navigation
honoring `?stay=1`; under `?stay=1` the index does not auto-navigate and the escape row is visible; tapping
the sign-in escape reaches `gate.html`. `version_integrity_test` V2 reconciled to the single-navigation
router (asserts the meta refresh is absent, the deferred hand-off and `?stay=1` guard are present, and the
static escapes exist).

## BOARD_WATCHDOG: the post-gate black board must speak (follow-up)

Once the operators could pass the gate (the strip read "boot gate resolved · build 9c5e952f"), a NEW failure
appeared: the shell header painted but the board area stayed BLACK, with no way out. The board is painted by
app.js (~890 KB, the last and largest script); on a marginal connection it arrives slowly or not at all. The
head watchdog was supposed to catch this, but it keyed on `window.__thriveBooted`, which `gate.js` sets the
instant the gate resolves. So once the gate passed, the watchdog thought the boot had succeeded and never
fired, and the black board was silent.

The fix re-keys the watchdog on `window.__boardPainted` (set ONLY by the board's first paint, app.js render),
and keeps it silent while a gate sign-in card is on screen (the operator is signing in, not stuck). It is now
two-phase so the wait is never a silent void: a gentle "loading the board" indicator (with the spinning
logo) at 5s, then a Retry panel at 18s naming the connection. Self-contained and inline, so it works even if
styles.css or app.js never loaded.

Evidence: `tools/board_watchdog_test.py` (browser, fails-when-broken) aborts app.js so the board never paints
and proves the loading indicator then the Retry panel appear after the gate resolves, and that both stay
silent once `__boardPainted` is set. `signin_resilience_test` part D reconciled to the board-keyed two-phase
watchdog. (The deeper cause remains the connection: 890 KB cannot arrive on a dead link. The watchdog turns
a confusing black void into a clear, actionable state, and a retry on a recovered connection gets the board.)

## BOARD_WAIT: the wait is never covered, never interrupted, never auto-reloaded (regression fix)

The BOARD_WATCHDOG above (#225) was itself a regression, and the worst of this sequence. Audit of the
merges after the last working build (`9c5e952f`, where the operator got in) found exactly two: #224
(gate.html restyle, cosmetic, cleared) and #225 (the watchdog). #225's mechanics on a slow connection:

- at 5s a FULL-SCREEN overlay (`inset:0`) covered the entire working interface with a "loading" screen
  (the "fake interface" the operators reported);
- at 18s a second full-screen Retry panel replaced the screen, and its only exit was `location.reload()`;
- the reload CANCELED the in-flight ~890 KB app.js download and restarted the whole ~1.7 MB first load
  from zero.

So any connection needing more than 18 seconds for the first load could NEVER finish: an infinite reload
loop. That is why entry worked before #225 (the same slow load simply completed after 30 to 60 seconds,
uninterrupted) and became impossible after it, on WiFi and cellular alike.

The law now baked into the shell: the wait is NEVER covered, NEVER interrupted, and NEVER reloaded by the
page's own hand. One small non-blocking banner at the bottom edge (`#boardWait`) says the load is slow and
STILL GOING, offers a Retry the operator may choose, removes nothing, covers nothing, and clears itself the
instant the board paints. Keyed on `__boardPainted`, silent at the gate, armed at 8s and re-armed at 25s.

Evidence: `tools/board_watchdog_test.py` rewritten to the BOARD_WAIT contract: with app.js aborted, the
banner appears, the viewport center stays free (`elementFromPoint`), and past the old 18s deadline a window
marker proves NO self-reload happened and nothing replaced the screen; with `__boardPainted` set the banner
never appears. `signin_resilience_test` part D reconciled, and D2 goes red if anyone reintroduces a
full-screen overlay, a gate removal, or a fail deadline into the wait path.

## STYLES_ALWAYS_APPLY: measured weights, and the async swap that rendered the console unstyled

A device capture on build `7e0ade8d` showed the console as RAW UNSTYLED HTML: the brand as a purple
underlined link, the language control as a bare pill, black below. That is styles.css never being applied.

Cause: the P54 first-paint change loaded BOTH sheets with `media="print" onload="this.media='all'"`. That
swap only becomes a screen stylesheet if the `onload` fires. When it does not fire on WebKit, the sheet
stays a print stylesheet forever and the interface is never styled. There is no timeout and no recovery.

The measurement that settles the trade (gzip, what the device actually downloads):

| asset | raw | gzip | in critical path? |
|---|---|---|---|
| app.js | 890,601 | 286,038 | yes (paints the board) |
| fonts.css | 327,517 | **247,678** | was yes; now NO |
| i18n.js | 216,497 | 63,186 | yes |
| styles.css | 201,415 | **51,698** | yes (blocking again) |
| console.html | 94,733 | 27,290 | yes |

styles.css is only ~52 KB gzipped, so making it async bought almost nothing and risked everything.
fonts.css is ~248 KB gzipped (base64 font faces barely compress), is the single heaviest item after app.js,
and is purely decorative. The weights invert the original decision.

The law now:

- **styles.css is a NORMAL blocking stylesheet.** The interface is ALWAYS styled. There is no swap to fail,
  so the unstyled-forever mode is gone by construction, not by timing.
- **fonts.css leaves the boot entirely.** It is appended by script AFTER the window load event, when the
  board already has what it needs. Until it lands the console renders in the system stack declared by
  styles.css, which is a complete, correct interface.

Net: the critical CSS path drops from ~300 KB to ~52 KB gzipped, an 83% cut, AND the failure mode is
eliminated. The gate-critical inline block still paints the gate before styles.css lands.

Evidence: `tools/first_paint_test.py` rewritten to this contract. With app.js AND fonts.css both blocked
(the worst realistic case) the page is still fully styled (`--bg`/`--ink` live) and the brand carries no
default underline, which is the exact device symptom; no `media="print"` exists anywhere; and on a healthy
load the webfont sheet is attached only after load.

## Acceptance (device-gated)

0. If still stranded on the splash: open `console.thriveiii.com/?stay=1` (the manual launcher) and tap
   "Sign-in page". The root itself always loads; this is the guaranteed way in while a hang is intermittent.
1. Fresh build stamp on the failing iPad (the new `BUILD`, not `a1c92c04`).
2. Sign in and pass both gates on a marginal connection: the console paints its gate/boot frame promptly
   instead of holding the index splash. No permanent "Opening the Thrive Opportunity Library..." freeze.
3. The board arrives fully styled (no flash of unstyled content).
4. `?debug=paint` and the build stamp still work (the shell is otherwise unchanged).
5. A device that was stranded reaches the console after the new `BUILD` deploys, without needing to clear
   its cache (the changed versioned URL forces the fresh shell).

---

# CONSOLE_ENTRY_DIAG (BRIEF 0) - instrument the entry, change nothing else

This section fixes nothing. It exists because a week of fixes has been aimed at a symptom that carries no
information: on the operators' iPad and iPhone, `library/console.html` does not become usable, and the
screen is black. A black screen is produced identically by at least five different failures:

| what actually happened | what the operator sees |
|---|---|
| the request never returns (stalled) | black |
| headers return, no body byte follows | black |
| the body starts and is cut short | black |
| a stale or transformed copy arrives with status 200 | black |
| the document arrives whole and the device cannot paint it | black |

Every previous brief had to GUESS which of these it was, and a guess that is wrong ships a fix for a
failure that is not happening. That is the actual root of the week: not a missing fix, but a missing
measurement. This brief adds the measurement.

## Part 1 - the byte-and-hash probe

A control on the front door (`Test console file`) fetches `library/console.html` and prints, in order:

- `headers arrived` yes/no, with elapsed time and the HTTP status
- `content-type` and `content-length` (or `not sent`)
- `first body byte` yes/no, with elapsed time
- `full body terminated` yes/no, with elapsed time
- `bytes received` (exact count) and `sha-256` of exactly those bytes
- `expected bytes` / `expected sha-256`, read from `version.json`
- one `VERDICT` line

It streams the response through `body.getReader()` precisely so that the three transfer stages can be told
apart; a plain `arrayBuffer()` collapses all of them into one boolean. Where `body` is not a stream, it
falls back to `arrayBuffer()` and says so (`not measurable (no stream)`) rather than inventing a value.

Three hard constraints, all of them consequences of the Stage 6/7 law:

- **no reload, no navigation, no AbortController.** The reload lockout of PR #225 was caused by a timer
  that acted. This one only prints: at 30s, if no header has arrived, it writes `no response after 30s`
  and stops. The in-flight request is left alone; if it completes at 40s, the probe reports that too.
- **it is armed by a click and by nothing else.** Nothing in the boot path touches it. `tools/version_integrity_test.js`
  V2 enforces this: the router block may not read `version.json`, and the only other reader in the front
  door must be this probe, wired to a click, never to a timer.
- **it reads only.** It never redirects, so a failed probe cannot itself become a way to get stuck.

## Part 2 - version.json publishes what was built

`version.json` now carries `consoleBytes` and `consoleSha256`, read from `library/console.html` on disk
AFTER the bundle writes it. A 200 response proves nothing on its own. The published size and digest are
what turn "the file arrived" from an assumption into a comparison.

## Part 3 - paint-safe mode

`?paint=safe` sets `html.paint-safe` from the FIRST script in the head, before any stylesheet has decided
anything, and the critical inline block neutralizes `filter`, `backdrop-filter`, `animation` and
`transition` everywhere. `&svg=off` additionally hides `svg`, and is a separate, inactive-by-default rule.

The census that motivated it found exactly two paint-heavy constructs in the FIRST VIEWPORT:

| location | construct | why it matters |
|---|---|---|
| `styles.css:85` `.top` | `backdrop-filter: blur(8px)` over `rgba(10,10,12,.85)`, sticky | a live blur of everything scrolling under the header |
| `styles.css:910-911` `.board.board-settle` | `filter: blur(7px)` to `blur(0)` animation over the whole board, `will-change: opacity, filter` | a full-container filter animation on the largest element on screen |

The three scrim blurs (`:429`, `:2178`, `:2854`) are modal-only and never in the first viewport. The shipped
shell contains zero `<svg>` and zero `<use>` (icons are injected by JS after app.js), which is exactly why
`svg=off` is a separate toggle rather than part of paint-safe.

Paint-safe is a DIAGNOSTIC, not a fix. If the console opens under `?paint=safe` and not without it, that is
the first hard evidence that the failure is compositing, not delivery, and a proper fix gets its own brief.

## Part 4 - two static entry links

`Normal console` and `Paint-Safe console` are plain anchors painted in the markup. Tapping a link is a
browser action, not a page-script action, so they remain usable even if a hung hand-off suspends the front
door's JavaScript. They label themselves, so the device session needs no instructions.

## Part 5 - the shell is inside the build signature

`BUILD` hashes `GENERATOR_SRC` (the bundler's own source) alongside the assets, so a shell-only edit like
this one moves the build id. Without that, a shell change would ship under an unchanged id and every
cached document would keep serving the old shell: the exact reason the fixes of P55 and P56 never reached
a device before #222.

## Evidence

`tools/console_entry_diag_test.py` refuses to accept the probe on its word. Every claim is tested twice,
once against a healthy file and once against a damaged one, because an instrument that reports "intact"
unconditionally is worse than no instrument:

| check | healthy | damaged |
|---|---|---|
| transfer stages | all three yes | (n/a) |
| byte count | equals `version.json` | equals the truncated length |
| sha-256 | equals `version.json` | (n/a) |
| verdict | `INTACT` | must NOT say intact; must name both numbers |
| paint-safe | blur present without the flag | `none` with the flag |

Fails-when-broken proof: shifting `consoleBytes` by 7 and disabling the paint-safe selector turned five
checks red across both halves of the suite.

## The device session (2 taps)

1. Open `console.thriveiii.com/?stay=1`, tap `Test console file`, read the VERDICT.
2. Tap `Paint-Safe console`.

That yields the three answers a week of guessing could not: does the file arrive, does it arrive intact,
and can the device paint it.

## Acceptance (device-gated)

1. The probe prints a complete report on the failing device, including a VERDICT line.
2. The report distinguishes delivery failure from paint failure without ambiguity.
3. `Paint-Safe console` either opens the console or does not, and either outcome is decisive.
4. Nothing in the boot path changed: no reload, no overlay, no watchdog deadline, no auth, routing,
   data, or relay change.
