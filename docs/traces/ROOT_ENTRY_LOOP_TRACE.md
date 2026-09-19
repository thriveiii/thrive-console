# ROOT_ENTRY_LOOP_TRACE

Read-only trace of the full post-visit entry flow after the root flip (#316), and why entering
console.thriveiii.com auto-forwards to gate.html and takes several tries to get in. Every hop cited to
file:line. No code changes in this document.

## The full flow, hop by hop

1. **console.thriveiii.com/** is served `publish/index.html` (Netlify build `node tools/bundle.js`, publish =
   `publish`). index.html is the session router (generated from the rootIndex template in `tools/bundle.js`).

2. **index.html router** (`index.html`), one deferred hand-off `setTimeout(decide, 250)` (`index.html:282`):
   - `?stay=1` present -> return, manual launcher, no auto hand-off (`index.html:248`).
   - `decide()` (`index.html:260`):
     - `warm` (`?warm=1`) -> `toBoard()` (`index.html:262`).
     - no session (`!sess || !sess.access_token`) -> `toGate()` (`index.html:263`).
     - live session (not expired) -> `toBoard()` (`index.html:264`), no network.
     - **expired token -> a NETWORK REFRESH** (`index.html:265-278`): POST
       `/auth/v1/token?grant_type=refresh_token` with `sess.refresh_token`; on success writes the new session
       and `toBoard()`; on failure OR a 12s timeout (`index.html:266`) -> `toGate()`.
   - `toBoard()` = `location.replace("./library/board.html?v=BUILD" ...)` (`index.html:256`).
   - `toGate()` = `location.replace("gate.html?v=BUILD")` (`index.html:257`).
   - Session key: `console_sb_session` (`index.html:247`).

3. **gate.html** (the bare sign-in, its OWN inline script, does NOT load gate.js): on a completed sign-in it
   writes `console_sb_session` (`gate.html:285`, same key) then
   `location.assign("index.html?warm=1" + frag)` (`gate.html:295`). It never goes to console.html or board.html
   directly; it always returns through the index router with `warm=1`.

4. **index.html?warm=1** -> `decide()` -> `warm` branch -> `toBoard()` (`index.html:262`) -> board.html.

5. **board.html** `boot()` (`library/board.html:4974`), a dead end that NEVER navigates away:
   - not signed in -> `signinView()` in place (`library/board.html:4977`).
   - signed in, not expired -> `loadBoard()` (`library/board.html:4979`).
   - signed in, expired -> `connectingView()` then `refresh()` -> `loadBoard()` or `signinView()`
     (`library/board.html:4980-4981`).
   - Session key: `console_sb_session` (`library/board.html:408`); read at `:629`, written at `:633`.
   A grep of board.html for `location.replace/assign/href` to any URL returns nothing: board.html has zero
   outbound navigations. It cannot bounce to gate.html or loop.

## What is NOT the cause (ruled out)

- **Session key mismatch:** all three (index router, gate.html, board.html) use `console_sb_session`
  (`index.html:247`, `gate.html:285`, `library/board.html:408`). Not the cause.
- **board.html ejecting:** board.html `boot()` handles the unauthenticated case in place (`signinView`,
  `library/board.html:4977`) and never navigates. Not the cause.
- **failsafe.js second navigation:** failsafe.js (which can `location.replace(?vr=1)` on a stale build,
  `library/failsafe.js:215`) is NOT loaded by index.html (only mentioned in a comment, `index.html:17`) and
  console.html removed its tag (`library/console.html:24`). Not in the board path.
- **gate.js:** the legacy in-console gate, relative to `library/console.html` (`gateHref` -> `../gate.html`,
  `library/gate.js:408`). It runs only inside console.html (the app.js shell), reachable via the legacy
  console escape or a stale cache - not on the board entry path. Not the cause of the board-root loop.

## THE CAUSE: the router's own refresh fights board.html's refresh

The single toGate source on a returning, signed-in user is `decide()`'s **expired-token branch**
(`index.html:265-278`). This branch is legacy behavior from the console.html era, when the served shell
needed a valid access token to boot, so the router refreshed the token before handing off. Two problems now:

1. **Supabase refresh tokens are single-use (they rotate).** The router POSTs `grant_type=refresh_token` with
   the stored `refresh_token`; Supabase consumes it and issues a new one. board.html ALSO refreshes on its
   warm boot (`library/board.html:4980-4981`). Two independent refreshers on one rotating token: whichever
   runs second sees a consumed token and gets a definitive 400/401, and on the router side that path is
   `toGate()` (`index.html:277`). The result is a signed-in operator bounced to gate.html, and "several
   tries" while the rotation keeps invalidating.

2. **The router depends on the network to DECIDE where to send a signed-in user.** A slow refresh, a
   transient Supabase error, an offline blip, or the 12s timeout (`index.html:266`) all resolve to
   `toGate()` (`index.html:277-278`) - a network-fragile detour that sends an authenticated operator to the
   sign-in page. The router should not need the network at all to route a session that already exists;
   board.html already owns a robust, in-place, no-navigation refresh (`library/board.html:4980-4981`).

So: a signed-in root visit whose access token has expired does a router-level refresh that (a) can lose the
rotating token to board.html's refresh and (b) falls to gate.html on any network hiccup - the multi-try
gate bounce. A signed-in visit with a still-live token already lands on board in one hop (`index.html:264`);
the failure is specifically the expired-token network branch.

## The fix (implemented in the same PR, see the diff)

Make the router decide on session PRESENCE only and delegate the refresh to board.html (the one owner of the
rotating token):

- `warm` -> board (one hop).
- a session blob with an `access_token` (expired or not) -> board (one hop, no network); board.html refreshes
  in place if the token is stale, with no navigation and no loop.
- no session -> gate; gate -> `index.html?warm=1` -> board (never console.html).

This removes the router's network refresh entirely, so there is exactly one refresher (board.html), no
token-rotation race, no 12s timeout, and a signed-in root visit reaches board.html in ONE hop. Auth is not
weakened: board.html's device-proven bare-GoTrue refresh (`library/board.html:4980-4981`) still handles every
expired token, and a truly session-less visit still goes to the gate.
