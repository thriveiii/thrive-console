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
ck("D7 no secret is printed into the panel: no email, no session/token VALUE read (only the boolean flag + redacted shape)",
   body.indexOf("authEmail") < 0 && body.indexOf(".access_token") < 0 && body.indexOf("c.anon") < 0
   && body.indexOf("supaAnon") < 0 && body.indexOf("bearer(") < 0 && body.indexOf("session().") < 0);
ck("D8 it lives in app.js (a BUILD-hashed source) so shipping it changes the build stamp / busts the cache",
   /function initStateDiag\(\)/.test(APP));
ck("D9 no em dash in the diagnostic",
   body.indexOf("—") < 0);

// P55: the panel prints the last token-POST shape (from window.__lastTokenDiag) and the gate error state.
ck("D10 the panel prints the gate error state (op_err/timeout visibility)",
   /getElementById\("gateErr"\)/.test(body) && /gate error: /.test(body));
ck("D11 the panel prints the last token-POST shape fields (status, res.ok, typeof data, has_access_token, text_length, body_shape) and the throw branch",
   /__lastTokenDiag/.test(body) && /res\.ok=/.test(body) && /typeof data=/.test(body)
   && /has_access_token=/.test(body) && /text_length=/.test(body) && /body_shape: /.test(body)
   && /THREW/.test(body));

// P55: the capture lives in supabase.js authTokenPost, records shape only (no token value, no logging).
const SUPA = fs.readFileSync(path.join(ROOT, "library/supabase.js"), "utf8");
const rec = (function () { const i = SUPA.indexOf("function recordTokenDiag"); return i < 0 ? "" : SUPA.slice(i, i + 1200); })();
ck("D12 authTokenPost records the response shape to window.__lastTokenDiag and hands back the SAME result/rejection",
   /window\.__lastTokenDiag = d;/.test(SUPA)
   && /return p\.then\(function \(r\) \{ recordTokenDiag\(grant, r, null\); return r; \},\s*function \(e\) \{ recordTokenDiag\(grant, null, e\); throw e; \}\);/.test(SUPA));
ck("D13 the capture stores NO token value (only a boolean has_access_token) and redacts the body preview",
   rec.length > 0 && /has_access_token: !!\(r && r\.data && typeof r\.data === "object" && r\.data\.access_token\)/.test(rec)
   && /function redactBody/.test(SUPA) && /\[REDACTED\]/.test(SUPA)
   && rec.indexOf("d.access_token =") < 0 && rec.indexOf("token: r.data") < 0);
ck("D14 the capture does no logging (no console.* in the recorder)",
   rec.length > 0 && rec.indexOf("console.") < 0);

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
