# The door before the house: gate-first boot, one diagnostic layer (P48)

## The defect, code-proven and independent of the sign-in freeze

P47 proved the sign-in REQUEST at HEAD is byte-identical to the last build that signed in, and nothing
executes between `token:sent` and `token:ok`, so the CODE of sign-in is not the regression. Separately,
the front-door audit found a real structural defect: `gate.js` ended with

```
if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); }
else { start(); }
```

`gate.js` runs as a `<script>` inside `<body>` before `app.js` (~874 KB), so `readyState` is `"loading"`
when it runs and `start()` is deferred to `DOMContentLoaded`, which does not fire until every later
script, `app.js` included, finishes parsing. **The login door waited for the whole application.** The
section markup is already parsed when `gate.js` runs, so the wait was pure overhead. This is worth fixing
whether or not it is the `token:sent` cause, and it plausibly explains the long black screen and the heavy
transition to the gate.

## The five changes (all through the generator, fully revertible)

1. **Root front door, no probe in the critical path.** `index.html` is now an immediate redirect:
   `<meta http-equiv="refresh" content="0; ...">` (JS-off fallback) and an inline `location.replace(...)`
   at once, with no `version.json` fetch and no 6s wait. `version.json` is still written and remains the
   in-shell P43 convergence net (failsafe.js fetches it from inside `console.html`), so a stale front door
   can no longer chain-pin the shell and the shell can still self-correct.
2. **Auth critical path split from the app critical path.** The early script order is now
   **config -> supabase -> gate**, then icons, i18n, stage-model, lifecycle, intake, numbers, inbound,
   kinds, store, drafts, flows, app. `supabase.js` moves before `gate.js` so the gate's dependency is
   satisfied without waiting on the app; the gate paints before the heavy modules load.
3. **DOMContentLoaded wait killed in `gate.js`.** `start()` runs immediately behind a `window.__gateStarted`
   double-init guard. The gate appears before `app.js`, not after it. This is the single most important
   line.
4. **Gate first paint, self-sufficient.** A small inline `<style id="gate-critical">` in the served
   `console.html` head, before the `fonts.css`/`styles.css` links, carries the minimal gate rules
   (background, `html.gate-locked` hiding, `#thriveGate`, card, logo, title/subtitle, inputs, buttons,
   error/diagnostic/note, build stamp) with a system font stack, so first paint never blocks on `fonts.css`
   (~327 KB) or `styles.css` (~201 KB). The full stylesheets still load and govern the final look.
5. **Diagnostics collapsed to one layer.** Removed: the duplicate external `<script src="failsafe.js">`
   (the inline copy runs at parse time and cannot 404; failsafe.js keeps its `__thriveFailsafeLoaded`
   idempotence guard); the redundant 6s `bootfail` timeout; the watchdog's "Sign out" button (it must never
   start a second auth state machine), leaving a Retry-only 20s boot watchdog that stands down on
   `__thriveBooted` and never replaces a healthy gate; and the two failsafe.js watchdog timers
   (`__thriveFailsafeArm`'s timeout and the self-armed sentry). `__thriveFailsafeArm` stays defined as a
   safe no-op because `gate.js finish()` still calls it. Kept: one build stamp, one version-convergence
   (P43), one boot watchdog, the single error/rejection/resource reveal panel, and the sign-step strip.

## The one deviation, kept and honest

The sign-step strip and `__signMark` stay one step longer: they are the instrument that tells us, on the
device, whether sign-in now advances past `token:sent`. **P47 (already merged) had removed the
`token:sent`/`token:ok` marks from the frozen `signIn`.** So this pass re-adds ONLY those two marks, as
weightless `window.__signMark` assignments around the awaited POST: they change no URL, header, body,
session, or token, and are exactly the instrumentation P48 keeps. The request P47 restored stays frozen
(`{ "apikey": c.anon, "Content-Type": "application/json" }`, same endpoint, same body). Everything else the
diagnostic collapse removes, goes now; the strip is deleted in the closing commit the moment a device photo
shows `token:ok`.

## The one boot-correctness fix the reorder required

Gate-first ordering means a WARM session resolves before `app.js` is parsed, so `finish()` runs while
`window.onGateUnlocked` is still undefined. Before P48, `start()` ran at `DOMContentLoaded` (after `app.js`),
so the unlock hook fired. To preserve that, `finish()` now leaves `window.__gateUnlockedPending = true` when
the hook is absent, and `app.js` drains it at the top of `startLiveSync` (DOMContentLoaded, where every
`onThrive("unlock",...)` handler is registered and the DOM exists). The warm-boot force-hydrate (P111), the
operator chip, and the name map fire exactly once on a warm boot, as they did before the reorder. This is
the only touch to `app.js` and it is boot wiring, not business logic.

## Regression fence (held)

Not touched: the Supabase URL, anon key, password-grant endpoint, request body, token/session model, and
auth semantics (P47's restored request is frozen; `signIn`'s only change is the two weightless strip marks);
the board, lifecycle, editor, composer, templates, contacts, batches, profile, settings, relay, RLS, the
passcode hash, operator credentials, business data, the one-document architecture, and Arabic/RTL behavior.
No separate login page.

## Evidence

- `verify.js` 35/35; `supabase_auth_test`, `operator_gate_test` (browser-driven, real gate paint),
  `deploy_marker_test` (browser-driven), `fresh_code_test`, `arabic`, and every `*_test.js` green.
- Reconciled to the new boot structure, honestly: `failsafe_surface_test` (no self-armed failsafe watchdog;
  `__thriveFailsafeArm` is a safe no-op), `version_integrity_test` (immediate root redirect, no front-door
  `fetch`), `signin_resilience_test` (Retry-only watchdog). New guards in `signin_click_test`: G5 (gate starts
  immediately, no DOMContentLoaded wait), G6 (a warm-boot unlock is never lost: gate leaves the pending flag,
  app.js drains it), G7 (signIn sets the token:sent/token:ok device instrument).
- Pre-existing, unrelated (identical on the origin/main baseline, confirmed via an isolated worktree):
  `supabase_stage1` "no Lotus reference"; `session_lifecycle_test.py`'s runtime sign-in step, which times out
  at the same line in this sandbox with or without P48.

## The isolation test this brief exists to enable (device-gated, Thyab)

Confirm a fresh stamp on the iPad first (this build is `b131c690`, not `86083c66`). Then one sign-in:

- Gate paints fast, no long black, no heavy transition -> the front-door defect is fixed (a real win
  regardless of what follows).
- Strip advances `token:sent -> token:ok -> board` -> the front door WAS the cause. Delete the strip in the
  closing commit.
- Strip still freezes at `token:sent` after all the noise is gone -> near-conclusive proof the fault is AFTER
  the door, at the Supabase/CORS perimeter, not in the client. We then pursue the perimeter with zero further
  client code, and it is the clean causal separation the week lacked.

## The lesson (permanent)

The door must not wait for the house. Auth UI keeps the smallest practical critical path. Repository size is
not page payload; measure the critical boot path. No nonessential network probe before the login surface.
Diagnostic instrumentation is temporary and scoped, but the LAST instrument is removed only after the fix is
device-proven, not before. One watchdog, not many. Generated files change through their generator. Do not
modify multiple suspected layers at once while a causal diagnosis is open, which is why auth stayed frozen
while the boot architecture was repaired.
