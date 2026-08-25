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

## Acceptance (device-gated)

1. Fresh build stamp on the failing iPad.
2. Sign in and pass both gates on a marginal connection: the console paints its gate/boot frame promptly
   instead of holding the index splash. No permanent "Opening the Thrive Opportunity Library..." freeze.
3. The board arrives fully styled (no flash of unstyled content).
4. `?debug=paint` and the build stamp still work (the shell is otherwise unchanged).
