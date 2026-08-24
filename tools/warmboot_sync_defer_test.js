/* P52 boot-contention contract (Node source contract).

   Live Web Inspector + git proved the sign-in freeze: auth completes in ~548ms, but the post-auth Supabase
   reads (console_settings, console_board) are starved of WebKit connections by the warm-boot relay polling.
   syncNow fired at DOMContentLoaded on a warm session (the passcode sync credential persists), launching the
   slow Apps Script relay chain (1-5s per call) that occupied the connection pool while the cross-host reads
   queued and never returned; token:ok is set only after those reads resolve, so the strip stayed at
   token:sent. The board's Supabase read was also issued from INSIDE doSyncRound, interleaved between two
   relay POSTs.

   The fix, asserted here (each check reds if the fix is reverted):
   1. startLiveSync no longer fires syncNow (or arms the interval) directly at DOMContentLoaded; every
      automatic trigger routes through autoSyncTick, which HOLDS the first round until the board read settles.
   2. firstSyncMayRun gates the first round on the console_board read having resolved (__boardViewReady) when
      that read is the authority, runs at once when no such read competes, and has a bounded fallback so sync
      is never permanently disabled.
   3. renderBoard releases the held first round AFTER the board has painted (the settle), idempotently.
   4. doSyncRound no longer issues the console_board read; the periodic server re-read is relocated to the
      board render settle (renderBoard re-reads on the sync/unlock/refresh heartbeat), so it never interleaves
      with the relay round's Apps Script calls.
   The auth request, keys, RLS and request shape are untouched (proven fine); this only reorders WHEN the
   relay polling starts. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(n, cond) { if (cond) { console.log("PASS " + n); } else { fails++; console.log("FAIL " + n); } }

const sls = app.split("function startLiveSync(){")[1].split("\ndocument.addEventListener(\"DOMContentLoaded\", startLiveSync);")[0];
const dsr = app.split("async function doSyncRound(ep, auth){")[1].split("\n}")[0];
const rb  = app.split("async function renderBoard(trigger)")[1].split("function render(trigger, source)")[0];

// 1. The eager boot round is gone; every automatic trigger goes through autoSyncTick.
ck("W1 startLiveSync no longer fires the eager warm-boot round (no direct `if(syncAuth()) syncNow()`)",
   !/if\(syncAuth\(\)\)\s*syncNow\(\);/.test(sls));
ck("W2 the unlock hook and the 60s interval both route through autoSyncTick (not a raw syncNow)",
   /onThrive\("unlock","sync",autoSyncTick\)/.test(sls)
   && /setInterval\(function\(\)\{ if\(!document\.hidden\) autoSyncTick\(\); \}, 60000\)/.test(sls)
   && !/syncNow\(\)/.test(sls));   // startLiveSync itself never calls syncNow directly anymore
ck("W3 startLiveSync attempts the first round through autoSyncTick (which holds itself until the board read settles)",
   /\n\s*autoSyncTick\(\);\s*\/\//.test(sls));

// 2. The gate: first round waits on the console_board read, runs when nothing competes, bounded fallback.
ck("W4 firstSyncMayRun holds until the console_board read resolves when that read is the authority",
   /function firstSyncMayRun\(\)\{[\s\S]*?return !!__boardViewReady;/.test(app)
   && /if\(!boardViewIsAuthority\(\)\) return true;/.test(app));
ck("W5 a bounded fallback guarantees sync is never permanently disabled",
   /__firstSyncFallback/.test(app)
   && /setTimeout\(function\(\)\{ __firstSyncFallback=true; autoSyncTick\(\); \}, 20000\)/.test(sls)
   && /if\(__firstSyncFallback\) return true;/.test(app));
const ast = app.split("function autoSyncTick(){")[1].split("\n}")[0];
ck("W6 autoSyncTick fires the first round exactly once (guarded by __firstAutoSyncDone), then runs on the normal cadence",
   /if\(!__firstAutoSyncDone\)\{ if\(!firstSyncMayRun\(\)\) return; __firstAutoSyncDone=true; \}/.test(ast)
   && /if\(syncAuth\(\)\) syncNow\(\);/.test(ast));

// 3. renderBoard releases the held round after the board paints, idempotently.
ck("W7 renderBoard releases the first automatic round AFTER the paint (the settle), idempotently",
   /try\{ if\(!__firstAutoSyncDone\) autoSyncTick\(\); \}catch\(_\)\{\}/.test(rb));

// 4. doSyncRound no longer reads the board; the re-read is relocated to the render settle.
ck("W8 doSyncRound no longer issues the interleaved console_board read (readBoardView removed from the round)",
   !/readBoardView\(\)/.test(dsr));
ck("W9 the periodic server re-read is relocated to the board settle (sync/unlock/refresh heartbeat)",
   /var __reread = \(trigger==="sync" \|\| trigger==="unlock" \|\| trigger==="thriveBoardRefresh"\);/.test(rb)
   && /if\(boardViewIsAuthority\(\) && \(!__boardViewReady \|\| __reread\)\)\{/.test(rb));

// Hygiene: no em dash in the touched source region (the isolation grep is enforced repo-wide elsewhere).
ck("W10 no em dash in the changed sync/board region",
   sls.indexOf("—") < 0 && rb.indexOf("—") < 0);

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
