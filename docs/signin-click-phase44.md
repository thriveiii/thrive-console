# The one path we never watched: instrument and hard-timeout the sign-in click (P44)

## The honest reframe

Every instrument shipped so far (P40 panel, P41 heartbeat, P42 reveal, P43 convergence) watches the BOOT
path: page load, hydrate, board paint. The "Signing in" hang lives in the CLICK path: button pressed,
signIn() awaited, token POST, session persist, navigate. That path had ZERO instrumentation, which is why
five briefs moved the boot symptoms and none touched the button. Two facts fix the direction: switching
networks changed nothing (evidence against interception, for a client-side stall), and the server has
logged the token POST returning 200, so the hang is signIn() never SETTLING after the token, on a later
await the click path owns. This brief does not claim a cure; it makes the click path speak and makes a
silent hang impossible.

## What was built

1. **Step marks.** `window.__signMark` is assigned at each existing step, in order: `click` (gate),
   `token:sent`, `token:ok`, `session:persist`, `session:ok` or `session:ephemeral` (signIn),
   `read:sent`, `read:ok` (the board view read), `navigate` (gate, before finish()). Assignments only.
   The failsafe strip renders the mark live (`· sign <mark>`), and a sign-in click re-shows the strip
   even after a healthy boot removed it, so the progression is visible on the device with no inspector.
2. **Hard timeout.** The gate races the WHOLE click path (`Promise.race([S.signIn(...), stall])`) against
   an independent 15s timer. On firing: the typed `stall` kind routes to the TRANSIENT branch (button
   re-enabled, label restored, specific message, one-tap Retry, no credential throttle), and the failsafe
   panel is raised via `window.__thriveSignStall`, printing "Sign-in stalled" with the LAST `__signMark`
   reached plus the standard storage/ephemeral datums. The stall panel KEEPS the gate on screen beneath it
   (a new `keepGate` mode of the reveal), because the operator needs the form to retry.
3. **No swallowed rejection.** The gate's catch now prefixes every visible diagnostic with the step in
   flight (`at <step> · <kind>: <message> (HTTP n)`), so a rejection names WHERE, not just what. Ordinary
   credential rejections keep the calm gate error; only a stall raises the panel.
4. **The persist bound, stated honestly.** The brief's leading suspect was P39's setSession verify-read
   awaiting forever on partitioned storage. Reading the code: **setSession is SYNCHRONOUS** (localStorage
   set + read-back); there is no await there that could hang, so the imagined unbounded await does not
   exist. What CAN be made safer was: the persist step is now wrapped so even a THROWING storage engine
   resolves as `session:ephemeral` (in-memory, P39's fallback) rather than propagating, so the persist
   step can neither hang nor reject. If an engine ever blocked inside the synchronous call itself (a
   frozen main thread), no in-JS timeout could preempt it, and the strip frozen at `session:persist`
   names it, which is exactly the reading the brief wants.

Nothing else changes: auth request shape, keys, RLS, DB, the silent failsafe, and P43 convergence are
untouched.

## Evidence

- **`tools/signin_click_test.js`** (Node), all pass, fails-when-broken proven (removing the stall-panel
  call reds G2):
  - S1 a healthy sign-in walks `token:sent, token:ok, session:persist, session:ok` in order (runtime);
  - S2 blocked storage resolves `session:ephemeral`, never hangs or throws (runtime);
  - S3 the strip renders the sign mark live (runtime);
  - S4 the stall panel names the LAST step and keeps the gate on screen (runtime);
  - G1-G4 the gate's click/navigate marks, the hard 15s race with typed `stall`, the Retry routing, the
    step-prefixed diagnostic, and the read marks (source contracts; `attempt()` lives in a DOM closure).
- The deliberate-failure render, captured from the harness (the exact screen a stalled device shows):

      STRIP: boot start · build 38330906 · sign session:persist
      PANEL: Sign-in stalled · توقّف تسجيل الدخول
             Error: SignInStalled: last step: session:persist · hard 15s race fired
             Build: 38330906 · Session in storage: present
      gate kept on screen: true

- **Bed green:** `verify.js` 35/35, `arabic.py` 0, `failsafe_surface` 0, `version_integrity` 0,
  `signin_resilience` 0 (its C4/C10 assertions reconciled to the stall kind and the step-prefixed
  diagnostic), `session_integrity` / `bare_metal_auth` / `deploy_marker` / `fresh_code` / `supabase_auth`
  all pass. No em dash; Western numerals; isolation grep 0; stamp advances (38330906).

## Device-gated (Thyab, fresh stamp first; P43 convergence should make the stamp automatic)

1. Confirm the strip shows the new stamp on the failing device.
2. Press Sign in. One of three, each photographed: (a) the board loads, filling that P43 matrix cell;
   (b) the strip advances through the sign marks and stops, naming the culprit step; (c) the 15s stall
   fires: button re-enabled, panel names the last step. The photograph selects the true fix; if it stops
   at `session:persist` with storage blocked, the bounded persist in this PR plus (if needed) a
   server-side session strategy is the cure, and the guessing ends because the step is named.

## What this brief is and is not

Not a claim to cure sign-in. What P44 guarantees: the next attempt CANNOT hang silently; it either signs
in, or it says, on the device, in one word, which step never returned. That word is what P45 targets.

## Do not (held)

Auth request shape, keys, RLS, Lotus, newsroom untouched. No user-facing ritual. The silent failsafe and
P43 convergence stay. No cure claimed; only that the sign-in path now reports its stall. Author only, not
merged, not released.
