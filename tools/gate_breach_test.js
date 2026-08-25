/* GATE_BREACH contract (brief P56), Node source guards.

   Device evidence (build 0990dea0, ?diag strip "sign token:sent", "Signing in" stuck): the in-console
   operator sign-in token POST HANGS on the failing WebKit, while the same request completes in ~250ms on the
   standalone gate.html (the authtest-proven path) where no other console code competes. GATE_BREACH routes
   the network sign-in to gate.html: the passcode stays in-console (local crypto, no network), and only the
   operator sign-in runs on the clean page, which writes the session mirror and returns to the console. A
   one-shot bounce guard prevents a mirror that fails to carry from looping. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const GATE = fs.readFileSync(path.join(ROOT, "library/gate.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "library/styles.css"), "utf8");

let fails = 0;
function ck(n, cond) { if (cond) { console.log("PASS " + n); } else { fails++; console.log("FAIL " + n); } }

const op = GATE.slice(GATE.indexOf("function showOperatorStep(wrap)"), GATE.indexOf("function showOperatorStep(wrap)") + 900);

ck("G1 showOperatorStep routes the network sign-in to gate.html: it calls redirectToGate() and returns on redirect, AFTER the no-Supabase guard",
   /if \(!S\) \{ finish\(\); return; \}/.test(op)
   && /if \(redirectToGate\(\)\) return;/.test(op)
   && op.indexOf("if (redirectToGate()) return;") > op.indexOf("if (!S) { finish(); return; }"));

ck("G2 redirectToGate targets ../gate.html via location.assign, guarded by __gateNoRedirect and the one-shot bounce, and marks the bounce",
   /function redirectToGate\(\)/.test(GATE)
   && /if \(window\.__gateNoRedirect\) return false;/.test(GATE)
   && /if \(opBouncedRecently\(\)\) return false;/.test(GATE)
   && /markOpBounce\(\);/.test(GATE)
   && /location\.assign\(gateHref\(\)\)/.test(GATE)
   && /function gateHref\(\) \{ return "\.\.\/gate\.html"; \}/.test(GATE));

ck("G3 the bounce guard is a bounded (20s) one-shot in localStorage, and finish() clears it so a resolved gate never blocks a later redirect",
   /var t = parseInt\(localStorage\.getItem\(OP_BOUNCE\) \|\| "0", 10\); return !!\(t && \(Date\.now\(\) - t\) < 20000\);/.test(GATE)
   && /localStorage\.setItem\(OP_BOUNCE, String\(Date\.now\(\)\)\);/.test(GATE)
   && /function finish\(sess\) \{\s*\n\s*try \{ clearOpBounce\(\);/.test(GATE));

ck("G4 the in-console fallback card carries the clean-page link, and op_clean_page is in BOTH locales",
   /<a class="gate-alt" href="' \+ gateHref\(\) \+ '">' \+ s\.op_clean_page \+ "<\/a>"/.test(GATE)
   && (GATE.match(/op_clean_page:/g) || []).length === 2);

ck("G5 the clean-page link is styled (a visible, tappable link) in styles.css",
   /\.gate-alt\{/.test(CSS));

ck("G6 no empty catch introduced and no em dash in the changed sources",
   (GATE.match(/catch \((?:e|ex|x)\) \{\}/g) || []).length === 0
   && GATE.indexOf(String.fromCharCode(0x2014)) < 0 && CSS.indexOf(String.fromCharCode(0x2014)) < 0);

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
