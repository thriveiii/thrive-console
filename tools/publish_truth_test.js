// F1 gate: fails-when-broken proof that a COMMITTED page is never shown RED for an async deploy that has not
// landed yet. Loads the REAL uploadActivateHtml (drawer badge), upReverify (drawer background re-check), and
// libReverifyPending/libStateOf (Library card) from tools/board-upload.src.js into a sandbox that stubs only
// the verify fetch (verifyLivePoll) and the boundary (pageStampLive, t, esc, document), so the real state
// mapping runs.
//
// Proves:
//   - a committed but not-yet-live page renders the NEUTRAL transitional badge (up_state_going_live, no "bad"
//     class), never RED up_state_dead, and offers Re-check;
//   - a live page renders green up_state_live;
//   - upReverify on a bounded MISS (even a 404/dead result) does NOT record a red state and does NOT stamp;
//     on ok it stamps live;
//   - libReverifyPending on a bounded MISS leaves the row "confirming" (never "fault"); on ok -> "live".
// Plus source guards: no RED dead/fault production remains; EN + AR transitional copy exists, no em dash.
//
// Pure Node. Run: node tools/publish_truth_test.js
// Fails-when-broken: restore libSetState(slug,"fault") on the miss path -> the Library miss case fails;
// restore stateCls "bad"/up_state_dead on the non-live drawer badge -> the drawer case fails.

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const UPLOAD = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
const BUNDLE = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 240)); }
}
function fnSrc(s, sig) {
  const at = s.indexOf(sig);
  if (at < 0) throw new Error("missing " + sig);
  let i = s.indexOf("{", at), depth = 0;
  for (; i < s.length; i++) { const c = s[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return s.slice(at, i);
}

// control + capture
let VERIFY;              // () => Promise<{ok,dead}>  the stubbed verify result
let STAMPED;             // slugs pageStampLive was called for
function load() {
  const stubs = {
    t: function (k) { return k; },                       // echo the i18n KEY so we can assert which state was chosen
    esc: function (s) { return String(s == null ? "" : s); },
    verifyLivePoll: function () { return VERIFY(); },
    pageStampLive: function (slug) { STAMPED.push(slug); return Promise.resolve(); },
    refreshDrawer: function () {},
    upActStatus: function () {},
    document: { getElementById: function () { return null; }, querySelector: function () { return null; } },
    up_page_h_unused: 0
  };
  const names = Object.keys(stubs);
  const body =
    "var __upLive={}, __upVerifying={}, __drawerSlug=null, __libPages=[], __libState={};\n" +
    fnSrc(UPLOAD, "function uploadActivateHtml(") + "\n" +
    fnSrc(UPLOAD, "function upReverify(") + "\n" +
    fnSrc(UPLOAD, "function libReverifyPending(") + "\n" +
    fnSrc(UPLOAD, "function libSetState(") + "\n" +
    fnSrc(UPLOAD, "function libStateOf(") + "\n" +
    fnSrc(UPLOAD, "function libStateCls(") + "\n" +
    fnSrc(UPLOAD, "function libStateKey(") + "\n" +
    "return { uploadActivateHtml:uploadActivateHtml, upReverify:upReverify, libReverifyPending:libReverifyPending, " +
    "libStateOf:libStateOf, setPages:function(a){ __libPages=a; }, libState:function(s){ return __libState[s]; }, " +
    "upLive:function(s){ return __upLive[s]; } };";
  return new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
}
const U = load();

(async function () {
  // ---- source guards (comment-stripped, so prose that names the old states does not trip them) -----
  var code = function (fn) { return fnSrc(UPLOAD, fn).replace(/\/\/[^\n]*/g, ""); };
  ck("the drawer badge maps non-live to the neutral transitional state (up_state_going_live), never dead",
     /var stateKey = live \? "up_state_live" : "up_state_going_live";/.test(UPLOAD) &&
     /var stateCls = live \? "ok" : "";/.test(UPLOAD));
  ck("the drawer badge code no longer has a RED up_state_dead / 'bad' branch",
     code("function uploadActivateHtml(").indexOf("up_state_dead") < 0 &&
     code("function uploadActivateHtml(").indexOf('"bad"') < 0);
  ck("libReverifyPending code no longer produces a RED 'fault' on a miss",
     code("function libReverifyPending(").indexOf('"fault"') < 0);
  ck("the background re-check code no longer records 'dead'/'unconfirmed' for a committed page",
     code("function upActivateBackground(").indexOf('"dead"') < 0 && code("function upActivateBackground(").indexOf('"unconfirmed"') < 0 &&
     code("function upReverify(").indexOf('"dead"') < 0 && code("function upReverify(").indexOf('"unconfirmed"') < 0);
  ck("transitional copy exists EN + AR (up_state_going_live), no em dash",
     (BUNDLE.match(/up_state_going_live:/g) || []).length === 2 && BUNDLE.indexOf("—") === -1);

  // ---- drawer badge behavior -----------------------------------------------------------------------
  var committedNotLive = { page: { live_verified_at: null }, pageSlug: "acme", opp: { data: { page_slug: "acme" } } };
  var html = U.uploadActivateHtml("acme", {}, committedNotLive);
  ck("a committed, not-yet-live page shows the transitional state (up_state_going_live)", html.indexOf("up_state_going_live") >= 0, html);
  ck("...and is NOT rendered RED (no 'up-state bad', no up_state_dead)", html.indexOf("up-state bad") < 0 && html.indexOf("up_state_dead") < 0, html);
  ck("...and offers a Re-check (upReverify button)", html.indexOf("upReverify") >= 0, html);
  var liveDetail = { page: { live_verified_at: "2026-09-13T00:00:00Z" }, pageSlug: "acme", opp: { data: { page_slug: "acme" } } };
  var htmlLive = U.uploadActivateHtml("acme", {}, liveDetail);
  ck("a live page shows green up_state_live", htmlLive.indexOf("up_state_live") >= 0 && htmlLive.indexOf("up-state ok") >= 0, htmlLive);

  // ---- upReverify: a bounded MISS is never a failure ----------------------------------------------
  STAMPED = []; VERIFY = function () { return Promise.resolve({ ok: false, dead: true }); };   // a 404/dead within budget
  await U.upReverify("acme", "acme");
  ck("upReverify on a 404/dead miss does NOT stamp and does NOT record a red state",
     STAMPED.length === 0 && U.upLive("acme") === undefined, { stamped: STAMPED, upLive: U.upLive("acme") });
  STAMPED = []; VERIFY = function () { return Promise.resolve({ ok: true }); };
  await U.upReverify("acme", "acme");
  ck("upReverify on ok stamps live", STAMPED.indexOf("acme") >= 0, STAMPED);

  // ---- libReverifyPending: a miss stays 'confirming', never 'fault' -------------------------------
  STAMPED = []; VERIFY = function () { return Promise.resolve({ ok: false, dead: true }); };
  U.setPages([{ slug: "camp", live_verified_at: null }]);
  await U.libReverifyPending(1, 1);
  ck("libReverifyPending on a miss leaves the row transitional (state stays 'confirming', not 'fault')",
     U.libStateOf({ slug: "camp", live_verified_at: null }) === "confirming" && U.libState("camp") !== "fault", U.libState("camp"));
  STAMPED = []; VERIFY = function () { return Promise.resolve({ ok: true }); };
  U.setPages([{ slug: "camp2", live_verified_at: null }]);
  await U.libReverifyPending(1, 1);
  ck("libReverifyPending on ok flips to 'live' and stamps", U.libState("camp2") === "live" && STAMPED.indexOf("camp2") >= 0, { st: U.libState("camp2"), stamped: STAMPED });

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
