/* P54 on-screen state diagnostic contract (Node source contract).

   The sign-step strip is a proven-unreliable instrument (reveal() covers it at unlock), so the true
   post-sign-in board state must be readable on the device from a photo, with no DevTools. initStateDiag
   prints that state, gated behind ?diag=1 so it never shows in normal use. This asserts the contract:
   gated, reads the required fields, textContent only, leaks no secret, and lives in app.js (in the BUILD
   hash) so shipping it changes the build stamp and the device fetches a fresh page. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const APP = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(n, cond) { if (cond) { console.log("PASS " + n); } else { fails++; console.log("FAIL " + n); } }

const i = APP.indexOf("function initStateDiag()");
const body = i < 0 ? "" : APP.slice(i, APP.indexOf("\ndocument.addEventListener(\"DOMContentLoaded\", initStateDiag);", i));

ck("D1 the diagnostic exists and is wired to DOMContentLoaded",
   body.length > 0 && /document\.addEventListener\("DOMContentLoaded", initStateDiag\);/.test(APP));
ck("D2 it is GATED behind diag=1 and returns early otherwise (never shows in normal use)",
   /indexOf\("diag=1"\) < 0\) return;/.test(body));
ck("D3 it prints via textContent only (no innerHTML write on the panel)",
   /dp\.textContent\s*=/.test(body) && !/dp\.innerHTML\s*=/.test(body));
ck("D4 it reads the render/adopt internals: __renderGen, __boardViewReady, __boardView row count",
   /__renderGen/.test(body) && /__boardViewReady/.test(body) && /Object\.keys\(__boardView\)\.length/.test(body));
ck("D5 it reads the paint facts: gate display/element, gate-locked, view-board hidden, boardLanes innerHTML length, rendered .tok count",
   /getComputedStyle\(g\)\.display/.test(body) && /gate-locked/.test(body)
   && /view-board hidden/.test(body) && /innerHTML\.length/.test(body)
   && /querySelectorAll\("#view-board \.tok"\)\.length/.test(body));
ck("D6 it refreshes so a photo any time after sign-in is live (setInterval tick)",
   /setInterval\(tick, 1000\)/.test(body));
ck("D7 no secret is printed into the panel (no email, token, or anon key in the readout)",
   body.indexOf("authEmail") < 0 && body.indexOf("access_token") < 0 && body.indexOf("c.anon") < 0
   && body.indexOf("supaAnon") < 0 && body.indexOf(".token") < 0);
ck("D8 it lives in app.js (a BUILD-hashed source) so shipping it changes the build stamp / busts the cache",
   /function initStateDiag\(\)/.test(APP));
ck("D9 no em dash in the diagnostic",
   body.indexOf("—") < 0);

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
