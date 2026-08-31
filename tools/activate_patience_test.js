// Activate-patience gate: fails-when-broken checks that activation ends LIVE or a NAMED failure, never a
// permanent silent "publishing".
//
//   (a) a page that serves after a delay (404 then 200) resolves to live and stamps live_verified_at.
//   (b) a definitively dead page (persistent 404) ends in the NAMED dead state, not "publishing".
//   (c) reopening the drawer on an unconfirmed (un-live, no outcome) page re-verifies; a live page does not.
//   (d) once stamped live, a reload still renders live (live wins over any stale in-memory outcome).
//   + verifyLivePoll patience: default budget is many tries with a ramping (backoff) gap, not 8 x 3000.
//
// The REAL functions are extracted from source; only the browser/network deps are stubbed (verifyLive scripted,
// upDelay immediate, pageStampLive/refreshDrawer recorded). Pure Node. Run: node tools/activate_patience_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const upload = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function extractFn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}

// Shared mutable test state (the sandbox closes over these globals).
const STATE = {
  vseq: [],            // scripted verifyLive results (last one repeats)
  stamped: [],         // slugs pageStampLive was called with
  refreshed: [],       // slugs refreshDrawer was called with
  drawerSlug: null,    // __drawerSlug
  dom: null,           // the fake .up-act-sec section for upWireActivate
};

// A preamble providing every dep the extracted functions reference (kept OUT of extraction: the top-level vars
// __upLive/__upVerifying and the helpers upDelay/verifyLive/pageStampLive/etc.).
const PRE = `
var __upLive = {}, __upVerifying = {};
var __drawerSlug = null;
function upDelay(ms){ return Promise.resolve(); }                       // immediate: the poll runs fast in the test
function verifyLive(slug){ var q = STATE.vseq; return Promise.resolve(q.length > 1 ? q.shift() : q[0]); }
function pageStampLive(slug){ STATE.stamped.push(slug); return Promise.resolve(true); }
function reloadBoardData(){ return Promise.resolve(); }
function refreshDrawer(slug){ STATE.refreshed.push(slug); }
function upActStatus(){}
function esc(s){ return String(s == null ? "" : s); }
function t(k){ return k; }                                              // return the key so we can assert stateKey
var document = { querySelector: function(){ return STATE.dom; }, getElementById: function(){ return null; } };
`;

const FNS = ["verifyLivePoll", "upActivateBackground", "upReverify", "upWireActivate", "uploadActivateHtml"];
const bodies = FNS.map((n) => { const f = extractFn(upload, n); if (!f) throw new Error("missing " + n); return f; });
const sandbox = { STATE };
new Function("STATE",
  PRE + "\n" + bodies.join("\n") +
  "\n; this.__api = {" + FNS.join(",") + "}; this.__get = function(k){ return eval(k); }; this.__set = function(k,v){ eval(k+'=v'); };"
).call(sandbox, STATE);
const A = sandbox.__api;
const getUpLive = () => sandbox.__get("__upLive");
const setDrawerSlug = (s) => sandbox.__set("__drawerSlug", s);

const NOTOK = { ok: false, dead: false, status: 0 };
const DEAD = { ok: false, dead: true, status: 404 };
const OKR = { ok: true, dead: false, status: 200 };
const flush = () => new Promise((r) => setImmediate(r));
function reset() { STATE.vseq = []; STATE.stamped.length = 0; STATE.refreshed.length = 0; STATE.dom = null; const L = getUpLive(); Object.keys(L).forEach((k) => delete L[k]); }

(async function () {
  // ---- verifyLivePoll settles honestly (fixed small params so it runs instantly) ----
  reset(); STATE.vseq = [NOTOK, NOTOK, OKR];
  let r1 = await A.verifyLivePoll("s", 8, 5);
  ck("poll: 404 then 200 -> { ok:true }", r1.ok === true, JSON.stringify(r1));
  reset(); STATE.vseq = [DEAD];
  let r2 = await A.verifyLivePoll("s", 5, 5);
  ck("poll: persistent 404 -> { ok:false, dead:true } (named, not publishing)", r2.ok === false && r2.dead === true, JSON.stringify(r2));
  reset(); STATE.vseq = [NOTOK];
  let r3 = await A.verifyLivePoll("s", 5, 5);
  ck("poll: persistent non-404 error -> { ok:false, unconfirmed:true } (still checkable, not dead)", r3.ok === false && r3.unconfirmed === true && !r3.dead, JSON.stringify(r3));

  // ---- (a) a page that serves after a delay resolves live and stamps ----
  reset(); STATE.vseq = [DEAD, DEAD, OKR]; setDrawerSlug("op");
  await A.upReverify("pg", "op");
  ck("(a) 404 then 200 -> pageStampLive called (live persisted)", STATE.stamped.indexOf("pg") >= 0, JSON.stringify(STATE.stamped));
  ck("(a) after a live resolve the non-live outcome is cleared", !getUpLive()["pg"], JSON.stringify(getUpLive()));

  // ---- (b) a definitively dead page ends NAMED dead, never publishing ----
  reset(); STATE.vseq = [DEAD]; setDrawerSlug("op");
  await A.upReverify("pg", "op");
  ck("(b) persistent 404 -> outcome recorded as 'dead'", getUpLive()["pg"] === "dead", JSON.stringify(getUpLive()));
  ck("(b) a dead page was NOT stamped live", STATE.stamped.indexOf("pg") < 0, JSON.stringify(STATE.stamped));
  // and the render names it dead (up_state_dead), with a Re-check affordance - never up_state_publishing.
  const htmlDead = A.uploadActivateHtml("op", {}, { page: { slug: "pg" }, pageSlug: "pg" });
  ck("(b) the drawer renders up_state_dead, not up_state_publishing",
     htmlDead.indexOf(">up_state_dead<") >= 0 && htmlDead.indexOf("up_state_publishing") < 0, htmlDead);
  ck("(b) the dead state offers a Re-check button (up_reverify)", htmlDead.indexOf("up_reverify") >= 0 && htmlDead.indexOf('id="upReverify"') >= 0, htmlDead);

  // unconfirmed renders the 'still checking' state with a Re-check, not a permanent publishing.
  reset(); getUpLive()["pg"] = "unconfirmed";
  const htmlUnc = A.uploadActivateHtml("op", {}, { page: { slug: "pg" }, pageSlug: "pg" });
  ck("(b) an unconfirmed page renders up_state_checking (not publishing) with Re-check",
     htmlUnc.indexOf(">up_state_checking<") >= 0 && htmlUnc.indexOf("up_reverify") >= 0 && htmlUnc.indexOf("up_state_publishing") < 0, htmlUnc);

  // ---- (c) reopening the drawer on an un-live, no-outcome page re-verifies; a live page does not ----
  reset(); STATE.vseq = [OKR]; setDrawerSlug("op");
  STATE.dom = { getAttribute: function (k) { return k === "data-page-slug" ? "pg" : k === "data-live" ? "0" : null; } };
  A.upWireActivate("op");
  await flush(); await flush();
  ck("(c) opening an un-live page with no outcome re-verifies (poll ran, stamped on ok)", STATE.stamped.indexOf("pg") >= 0, JSON.stringify(STATE.stamped));

  reset(); STATE.vseq = [OKR]; setDrawerSlug("op");
  STATE.dom = { getAttribute: function (k) { return k === "data-page-slug" ? "pg" : k === "data-live" ? "1" : null; } };
  A.upWireActivate("op");
  await flush(); await flush();
  ck("(c) opening a LIVE page does NOT re-verify (no redundant poll/stamp)", STATE.stamped.indexOf("pg") < 0, JSON.stringify(STATE.stamped));

  // ---- (d) once stamped live, a reload still shows live (live wins over any stale outcome) ----
  reset(); getUpLive()["pg"] = "dead";   // a stale in-memory outcome must not override the durable truth
  const htmlLive = A.uploadActivateHtml("op", {}, { page: { slug: "pg", live_verified_at: "2026-08-31T00:00:00Z" }, pageSlug: "pg" });
  ck("(d) a page with live_verified_at renders up_state_live (durable truth wins)",
     htmlLive.indexOf(">up_state_live<") >= 0 && htmlLive.indexOf("up_state_dead") < 0, htmlLive);

  // ---- source guards: patience + backoff are real, not a 24s busy-poll ----
  ck("guard: default tries is many (>= 30), not 8", /tries = tries \|\| 30;/.test(upload), "default tries not raised");
  ck("guard: the gap ramps (backoff) and is capped, not a fixed 3000", /Math\.min\(cap, Math\.round\(base \* Math\.pow\(factor/.test(upload), "no backoff ramp");
  ck("guard: upActivateBackground records a NAMED outcome (never a silent publishing)",
     /__upLive\[slug\] = \(v && v\.dead\) \? "dead" : "unconfirmed"/.test(upload), "no named outcome on non-ok");
  ck("guard: wireDrawer calls upWireActivate (re-verify on drawer open)",
     fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8").indexOf("upWireActivate(slug)") >= 0, "wireDrawer does not wire upWireActivate");

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
