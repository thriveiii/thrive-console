/* P53 unlock render-race contract (Node source contract).

   Live Chrome DevTools on the failing device, build f7c88b8b: after sign-in ALL 7 requests returned 200
   (token, console_settings x2, console_board, exec/echo), the console showed ZERO errors, and manifest.json
   was never requested. So the board did not fail on the network and did not hang on a fetch. It failed on a
   RENDER RACE: on unlock, fireThrive("unlock") fired multiple board renders at once, and the shell router
   re-showed the currently-visible view, which resets its DOM to the empty boot snapshot
   (el.innerHTML = snapshot[id]) and re-runs initBoard. The __renderGen guard lets only the last-started
   render paint; combined with the DOM reset, the board settled empty even though every read adopted rows.

   The fix, asserted here (each check reds if the fix is reverted):
   1. The shell unlock handler no longer unconditionally re-shows the current view. It marks the other
      started views stale (re-init on next navigation) and re-shows the current view ONLY if it never
      started (a deep link); a started, visible view is refreshed in place by its own unlock handler and is
      never reset.
   2. The immediate board render on unlock is deduplicated to ONE trigger: the dedicated board unlock handler
      (onThrive("unlock","board", renderBoard)). The supahydrate handler no longer also calls
      thriveBoardRefresh() in the same unlock tick (it keeps the deferred deep-hydrate refresh via
      supaEnsureHydrated).
   Auth, the request shape and the Supabase reads (all proven 200) are untouched. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const CONSOLE = read("library/console.html");
const BUNDLE = read("tools/bundle.js");
const APP = read("library/app.js");

let fails = 0;
function ck(n, cond) { if (cond) { console.log("PASS " + n); } else { fails++; console.log("FAIL " + n); } }

// Isolate the shell unlock handler body in the generated shell and in its source.
function shellBody(src) {
  const i = src.indexOf('onThrive("unlock","shell"');
  return i < 0 ? "" : src.slice(i, i + 1400);
}
const shConsole = shellBody(CONSOLE);
const shBundle = shellBody(BUNDLE);

// 1. The shell handler no longer resets/re-shows the current view unconditionally.
ck("U1 the shell unlock handler does NOT unconditionally re-show the current view (no bare show(current()))",
   shConsole.length > 0 && !/\n\s*show\(current\(\)\);/.test(shConsole));
ck("U2 the shell unlock handler re-shows the current view ONLY if it never started (deep-link first mount)",
   /if\(!\(cur in started\)\) show\(cur\);/.test(shConsole));
ck("U3 the shell handler still marks started views stale so they re-init on next navigation",
   /Object\.keys\(started\)\.forEach\(function\(k\)\{ stale\[k\] = 1; \}\);/.test(shConsole));
ck("U4 the fix is in the generator source (bundle.js), not only the generated file",
   shBundle.length > 0 && /if\(!\(cur in started\)\) show\(cur\);/.test(shBundle) && !/\n\s*show\(current\(\)\);/.test(shBundle));

// 2. Exactly one immediate board render on unlock: the dedicated board handler. supahydrate no longer paints.
ck("U5 the dedicated board unlock handler (the single immediate render) is present",
   /onThrive\("unlock","board",\(\)=>renderBoard\("unlock"\)\)/.test(APP));
const supa = (function () { const i = APP.indexOf('onThrive("unlock","supahydrate"'); return i < 0 ? "" : APP.slice(i, i + 900); })();
ck("U6 the supahydrate unlock handler no longer fires a competing immediate render (no window.thriveBoardRefresh() call in the tick)",
   supa.length > 0 && supa.indexOf("window.thriveBoardRefresh") < 0);
ck("U7 supahydrate keeps the deferred deep-hydrate refresh (supaEnsureHydrated)",
   /supaEnsureHydrated\(\);/.test(supa));
// The deep-hydrate refresh still repaints the board when the hydrate resolves (the sequenced final render).
ck("U8 supaEnsureHydrated repaints the board when the hydrate resolves (the final adopted-rows render)",
   /supaHydrate\(\)\.then\(function\(\)\{[\s\S]{0,160}thriveBoardRefresh\(\)/.test(APP));

// Hygiene on the touched region.
ck("U9 no em dash in the shell handler or the supahydrate handler",
   shConsole.indexOf("—") < 0 && supa.indexOf("—") < 0);

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
