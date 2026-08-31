// Activate-on-upload + edge-mark + no-reactivate. Fails-when-broken; synthetic only.
//
// (a) a campaign upload with a page publishes inline (pagePublishRelay called; slug in published[]); a text-only
//     row (no page html) is untouched (no publish).
// (b) a text-only opp (has_email && !has_page) renders the text-only edge class (card-msg).
// (c) a page-bearing opp (has_page) renders the rich-page edge class (card-offer).
// (d) upSendLiveGate does NOT block a live page and allows a transient failure, but still blocks a 404/410.
// (e) the retired copy keys (up_reactivate / up_state_draft / s_not_live) no longer appear in the built board.
//
// Functions are extracted from source and driven with stubs; build guards read the emitted board.html.
// Run: node tools/activate_upload_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const upload = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
const bundle = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");
const board = fs.readFileSync(path.join(ROOT, "library/board.html"), "utf8");

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
function load(src, names, preamble) {
  const bodies = names.map((n) => { const f = extractFn(src, n); if (!f) throw new Error("missing " + n); return f; });
  const sandbox = {};
  new Function((preamble || "") + "\n" + bodies.join("\n") + "\n; Object.assign(this, {" + names.join(",") + "});").call(sandbox);
  return sandbox;
}

// ---- (a) upCommit publishes a page row inline; a text-only row is untouched ---------------------
const calls = { publish: [] };
const UP_PRE =
  "var __pub = [];\n" +
  "function oppUpsert(){ return Promise.resolve(); }\n" +
  "function pageUpsert(){ return Promise.resolve(); }\n" +
  "function withBeaconClient(h){ return h; }\n" +
  "function pagePublishRelay(slug, html){ __pub.push(slug); return Promise.resolve(); }\n";
const U = load(upload, ["upCommit"], UP_PRE + "\nvar __getpub = function(){ return __pub; };");
// Re-load exposing __pub via a getter on the sandbox.
const Uenv = (function () {
  const sandbox = {};
  new Function(UP_PRE + extractFn(upload, "upCommit") + "\nObject.assign(this, { upCommit: upCommit, pub: function(){ return __pub; } });").call(sandbox);
  return sandbox;
})();
const pageRow = { slug: "acme-co", title: "Acme", subject: "Hi", body: "hello", email: "buyer@synthetic.test", page: { html: "<p>page</p>" } };
const textRow = { slug: "msg-note", title: "Note", subject: "Hi", body: "just text", email: "x@synthetic.test", page: null };

Uenv.upCommit({ rows: [pageRow, textRow] }).then(function (res) {
  ck("(a) a campaign page row publishes inline (pagePublishRelay called for the page slug)",
     Uenv.pub().indexOf("acme-co") >= 0, Uenv.pub());
  ck("(a) the published[] result carries the page slug for the background verify/stamp",
     (res.published || []).indexOf("acme-co") >= 0, res);
  ck("(a) a text-only row (no page html) is NOT published (untouched)",
     Uenv.pub().indexOf("msg-note") < 0, Uenv.pub());
  ck("(a) both rows still write their opp (ok count is 2)", res.ok === 2, res);

  // ---- (b)+(c) the card edge class from the SAME source expression cardHtml uses ------------------
  const m = bundle.match(/var edge = ([^;]+);/);
  ck("(c) cardHtml computes an edge class from the view fields", !!m, "no edge expr");
  if (m) {
    const edge = new Function("row", "return (" + m[1] + ");");
    ck("(c) a page-bearing card (has_page) gets the rich-page edge (card-offer)", edge({ has_page: true }) === " card-offer", edge({ has_page: true }));
    ck("(b) a text-only opp (has_email, !has_page) gets the text-only edge (card-msg)", edge({ has_email: true, has_page: false }) === " card-msg", edge({ has_email: true, has_page: false }));
    ck("(b/c) a card with neither is plain (no edge)", edge({}) === "", JSON.stringify(edge({})));
  }

  // ---- (d) upSendLiveGate: live allows, transient allows, 404/410 blocks -------------------------
  function gate(scripted) {
    const pre =
      "var __q = " + JSON.stringify(scripted) + ";\n" +
      "function verifyLive(){ return Promise.resolve(__q.length>1 ? __q.shift() : __q[0]); }\n" +
      "function upDelay(){ return Promise.resolve(); }\n";
    const G = load(upload, ["upSendLiveGate"], pre);
    return G.upSendLiveGate("acme-co", { source: "upload" });
  }
  const OK = { ok: true, dead: false, status: 200 };
  const DEAD = { ok: false, dead: true, status: 404 };
  const TRANSIENT = { ok: false, dead: false, status: 0 };
  return Promise.all([
    gate([OK]).then(() => "allow", (e) => "block:" + (e && e.__kind)),
    gate([TRANSIENT]).then(() => "allow", (e) => "block:" + (e && e.__kind)),
    gate([DEAD]).then(() => "allow", (e) => "block:" + (e && e.__kind)),
    gate([TRANSIENT, DEAD]).then(() => "allow", (e) => "block:" + (e && e.__kind))
  ]).then(function (r) {
    ck("(d) a live page sends", r[0] === "allow", r[0]);
    ck("(d) a transient GET no longer blocks (page is live on upload) - allowed", r[1] === "allow", r[1]);
    ck("(d) a 404/410 dead page still blocks (deadlink)", r[2] === "block:deadlink", r[2]);
    ck("(d) a transient that resolves to 404 on retry blocks (deadlink)", r[3] === "block:deadlink", r[3]);
    ck("(d) 'notlive' is gone: no path denies with notlive", upload.indexOf('deny("notlive")') < 0);

    // ---- (e) retired copy keys are gone from the built board ------------------------------------
    ck("(e) up_reactivate no longer appears in the built board.html", board.indexOf("up_reactivate") < 0);
    ck("(e) up_state_draft no longer appears in the built board.html", board.indexOf("up_state_draft") < 0);
    ck("(e) s_not_live no longer appears in the built board.html", board.indexOf("s_not_live") < 0);
    ck("(e) the re-activate button #upActBtn no longer appears in the built board.html", board.indexOf("upActBtn") < 0);
    // build guard: the edge CSS is present
    ck("the edge CSS (.card.card-offer / .card.card-msg) is emitted", /\.card\.card-offer\{/.test(board) && /\.card\.card-msg\{/.test(board));

    console.log("");
    if (fails) { console.log(fails + " FAILED"); process.exit(1); }
    console.log("ALL PASS");
  });
}).catch(function (e) { console.log("FAIL harness threw: " + (e && e.stack || e)); process.exit(1); });
