/* P36 bare-metal grep gates (Node): the shipped build carries ZERO diagnostic layers, exactly one auth
   fetch path, and no window.fetch wrapper. Plus /authtest.html is a standalone probe with no console code. */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const shell = read("library/console.html");
const dist = read("dist/thrive-console.html");
const supa = read("library/supabase.js");
const gate = read("library/gate.js");
const bundle = read("tools/bundle.js");
const authtest = read("authtest.html");

let fails = 0;
function ck(n, c, d) { if (c) console.log("PASS " + n); else { fails++; console.log("FAIL " + n); if (d !== undefined) console.log("     " + String(d).slice(0, 200)); } }

// G1: window.fetch (or self.fetch) is NEVER reassigned anywhere in the shipped build.
const reassignRe = /(window|self|globalThis)\s*\.\s*fetch\s*=|(^|[^.\w])fetch\s*=\s*(function|async|\()/m;
for (const [name, src] of [["console.html", shell], ["dist", dist], ["supabase.js", supa], ["gate.js", gate]]) {
  ck("G1 no fetch reassignment in " + name, !reassignRe.test(src), (src.match(reassignRe) || [])[0]);
}

// G2: zero diagnostic/overlay strings in the shipped shell (inlined offline copy too).
const diagRe = /__DIAG|PREFLIGHT|__preflightDiag|p35diag|ensureDiagPanel|heartbeat: |CORS-SIMPLE|preflight check/i;
ck("G2 zero overlay/diagnostic strings in console.html", !diagRe.test(shell), (shell.match(diagRe) || [])[0]);
ck("G2b zero overlay/diagnostic strings in dist", !diagRe.test(dist), (dist.match(diagRe) || [])[0]);
ck("G2c bundle.js no longer emits the preflight panel", !/PREFLIGHT|__preflightDiag|preflight check/i.test(bundle));

// G3: exactly one auth fetch path. authTokenPost defined once, called by signIn once; token URL built once.
ck("G3 exactly one authTokenPost definition", (supa.match(/function authTokenPost\(/g) || []).length === 1);
ck("G3b signIn calls authTokenPost exactly once", (supa.match(/authTokenPost\(c, "password"/g) || []).length === 1);
ck("G3c the token URL is built in one place (authTokenUrl)", (supa.match(/function authTokenUrl\(/g) || []).length === 1 && (supa.match(/"\/auth\/v1\/token\?grant_type="/g) || []).length === 1);
ck("G3d the only bare fetch() calls are the 3 bounded wrappers (fetchJSON, fetchT, authFetchOnce)", (supa.match(/\bfetch\(/g) || []).length === 3, (supa.match(/\bfetch\(/g) || []).length);

// G4: signIn is minimal, wrapped only by the P31 race (fetchJSON) and P29 typed errors; no logging.
ck("G4 signIn has no logging/diag on the auth path", !/authDiag|__DIAG|\.diag =|diag\./.test(supa.slice(supa.indexOf("async function signIn"), supa.indexOf("async function signOut"))));
ck("G4b the P31 setTimeout race is intact (raceTimeout + Promise.race + setTimeout)", /function raceTimeout/.test(supa) && /Promise\.race\(\[run, to\.promise\]\)/.test(supa) && /setTimeout\(/.test(supa));
ck("G4c the P29 typed-error surface is intact (kind unavailable/auth)", /err\.kind = \(r\.res\.status >= 500\) \? "unavailable" : "auth"/.test(supa));

// G5: /authtest.html is a standalone probe: no <script src>, no imports, and it uses the header shape.
ck("G5 authtest.html loads no external/console script", !/<script[^>]+src=/.test(authtest) && !/console\.html|supabase\.js|import /.test(authtest));
ck("G5b authtest.html has both buttons (health GET + token POST)", /id="bHealth"/.test(authtest) && /id="bToken"/.test(authtest) && /\/auth\/v1\/health/.test(authtest) && /grant_type=password/.test(authtest));
ck("G5c authtest.html sends the same header shape (apikey + Authorization + JSON)", /"apikey": ANON/.test(authtest) && /"Authorization": "Bearer " \+ ANON/.test(authtest) && /application\/json/.test(authtest));
ck("G5d authtest.html prints status, body, error, elapsed", /status: /.test(authtest) && /body: /.test(authtest) && /ERROR: /.test(authtest) && /elapsed: /.test(authtest));

// G6: the shell registers NO service worker (it only unregisters any stale one).
ck("G6 no service worker is registered by the shell", !/serviceWorker\s*\.\s*register|\.register\(['"]/.test(shell), (shell.match(/serviceWorker[\s\S]{0,40}/) || [])[0]);
ck("G6b any stale service worker is actively unregistered", /getRegistrations/.test(shell) && /unregister/.test(shell));

// G7: no CSP/connect-src meta constrains the shell.
ck("G7 no CSP/connect-src meta in the shell", !/Content-Security-Policy|connect-src/i.test(shell));

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
