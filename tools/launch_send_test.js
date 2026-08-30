// Launch-ready send gate: fails-when-broken checks for the three launch-send fixes.
//
// (a) The send live-gate (upSendLiveGate) blocks ONLY on a definitive dead page (404/410). A page proven
//     live before (console_board.has_page) is not aborted by a single transient GET; a page never verified
//     live still blocks. It retries a transient failure once.
// (b) "إدراج رابط الفرصة" wraps a selection as [text]({{LINK}}); bodyParasHtml renders [text](url) as an <a>
//     anchor (not a naked URL) after html-escaping; no-selection still inserts a bare {{LINK}}.
// (c) The plain-text part shows the phrase with its URL: toPlainText downgrades [text](url) to "text (url)".
//
// Pure Node, no network, no browser. Functions are extracted from source and run on fixtures, so any drift
// (revert the wrap, drop the retry, block on a transient, stop rendering the anchor) fails a case.
// Run: node tools/launch_send_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const send = fs.readFileSync(path.join(ROOT, "tools/board-send.src.js"), "utf8");
const upload = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
const editor = fs.readFileSync(path.join(ROOT, "tools/board-editor.src.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

function extractFn(src, name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}
// Load named functions into a sandbox, injecting a `preamble` of shared deps (esc, MF_LINK, stubs).
function load(src, names, preamble) {
  const bodies = names.map((n) => { const f = extractFn(src, n); if (!f) throw new Error("missing " + n); return f; });
  const sandbox = {};
  new Function((preamble || "") + "\n" + bodies.join("\n") + "\n; Object.assign(this, {" + names.join(",") + "});").call(sandbox);
  return sandbox;
}

// The board's exact esc, and MF_LINK, so extracted send helpers behave identically to the bundle.
const ESC = 'function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c]; }); }\n';
const MFLINK = 'var MF_LINK = "{{"+"LINK}}";\n';

// ---- (b) + (c) render + plain from the SAME source helpers the send path uses ------------------
const S = load(send, ["mdLinksHtml", "bodyParasHtml", "toPlainText"], ESC);
const LINK = "https://console.thriveiii.com/opp/acme";
// Post-substitution body: the operator selected "the Del Ray opening" and embedded the opp link on it.
const embedded = "See the Del Ray opening for details.".replace(
  "the Del Ray opening", "[the Del Ray opening](" + LINK + ")");

const html = S.bodyParasHtml(embedded);
ck("(b) the embedded phrase renders as an <a> anchor (not a naked URL)",
   html.indexOf('<a href="' + LINK + '" target="_blank" rel="noopener">the Del Ray opening</a>') >= 0, html);
ck("(b) the anchor is the ONLY raw HTML: the visible text is the phrase, the URL rides in href",
   html.indexOf(">the Del Ray opening<") >= 0 && html.indexOf(LINK + "</a>") < 0, html);

const naked = S.bodyParasHtml("Just visit " + LINK + " today.");
ck("(b) a body with a plain URL and NO [text](url) stays naked (no anchor injected)",
   naked.indexOf("<a ") < 0 && naked.indexOf(LINK) >= 0, naked);

// A hostile scheme must NOT become a link (only http(s)/mailto linkify).
const evil = S.bodyParasHtml("[click](javascript:alert(1))");
ck("(b) a non-http(s)/mailto target is left as plain text (no javascript: anchor)",
   evil.indexOf("<a ") < 0, evil);

const plain = S.toPlainText(embedded, "");
ck("(c) the plain-text part shows the phrase WITH its URL: 'the Del Ray opening (" + LINK + ")'",
   plain.indexOf("the Del Ray opening (" + LINK + ")") >= 0, plain);

// ---- (b) editor: selection wraps as [sel]({{LINK}}); no selection inserts bare {{LINK}} ---------
// The exact token-building line from edInsertLink, exercised directly (fails if it reverts to a bare token).
const edSrc = extractFn(editor, "edInsertLink") || "";
const m = edSrc.match(/var token = ([^;]+);/);
ck("(b) editor builds the token from the selection", !!m, edSrc.slice(0, 200));
if (m) {
  const tokenExpr = m[1];
  const build = new Function("sel", MFLINK + "return (" + tokenExpr + ");");
  ck("(b) selecting text yields [text]({{LINK}})", build("the Del Ray opening") === "[the Del Ray opening]({{LINK}})", build("the Del Ray opening"));
  ck("(b) no selection inserts the bare {{LINK}} token (naked token stays optional)", build("") === "{{LINK}}", build(""));
}

// ---- (b) CLEAN LINK: the sent body link is the bare /opp/<slug> with NO ?r= tail ----------------
// The channel-2 ?r= tokenization rewrite is removed; the body link is whatever mergeFieldsInto substitutes for
// {{LINK}} (= liveUrl(pageSlug)), clean. Source guard first, so the rewrite cannot silently come back.
ck("(b) the ?r= page-link rewrite is gone from board-send.src.js (no split(base).join(tokd))",
   send.indexOf("split(base).join(tokd)") < 0 && !/"r="\s*\+\s*encodeURIComponent\(token\)/.test(send));
const LINK_PRE =
  'var SITE_L5="console.thriveiii.com", OPP_PATH_L5="/opp/";\n' +
  'var MF_BIZ="{{"+"BIZ}}", MF_LINK="{{"+"LINK}}", MF_MONTH="{{"+"MONTH}}";\n';
const L = load(send, ["liveUrl", "mergeFieldsInto"], LINK_PRE);
const clean = L.liveUrl("acme");
ck("(b) liveUrl is the bare short form with no query", clean === "https://console.thriveiii.com/opp/acme" && clean.indexOf("?") < 0, clean);
// A naked {{LINK}} body substitutes to the clean URL, no ?r=.
const nakedLink = L.mergeFieldsInto("Visit {{" + "LINK}} today.", "Lina", { business: "Acme", link: clean, month: "" });
ck("(b) a {{LINK}} body substitutes to the clean /opp/<slug>, NO ?r= tail", nakedLink.indexOf(clean) >= 0 && nakedLink.indexOf("?r=") < 0, nakedLink);
// An embedded [text]({{LINK}}) becomes [text](clean) then <a href=clean>, still no ?r=.
const embLink = L.mergeFieldsInto("[the Del Ray opening]({{" + "LINK}})", "", { business: "", link: clean, month: "" });
const embLinkHtml = S.bodyParasHtml(embLink);
ck("(b) an embedded [text]({{LINK}}) renders <a href=clean> with NO ?r= tail",
   embLinkHtml.indexOf('<a href="' + clean + '"') >= 0 && embLinkHtml.indexOf("?r=") < 0, embLinkHtml);

// ---- (a) the send live-gate: block only on 404/410, retry a transient, allow a proven-live page --
// upSendLiveGate depends on verifyLive, upDelay, findRow. We inject stubs: verifyLive returns a scripted
// queue of results, findRow decides whether the page was proven live, upDelay is instant.
function runGate(scripted, wasLive) {
  const q = scripted.slice();
  const preamble =
    "var __q = " + JSON.stringify(scripted) + ";\n" +
    "function verifyLive(){ return Promise.resolve(__q.length>1 ? __q.shift() : __q[0]); }\n" +
    "function upDelay(){ return Promise.resolve(); }\n" +
    "function findRow(){ return { has_page: " + (wasLive ? "true" : "false") + " }; }\n";
  const G = load(upload, ["upWasVerifiedLive", "upSendLiveGate"], preamble);
  return G.upSendLiveGate("acme", { source: "upload" });
}
const DEAD = { ok: false, dead: true, status: 404 };
const TRANSIENT = { ok: false, dead: false, status: 0 };
const OK = { ok: true, dead: false, status: 200 };

(async function () {
  // proven-live page, live right now -> allowed
  let r1 = await runGate([OK], true).then(() => "allow", (e) => "block:" + (e && e.__kind));
  ck("(a) a live page sends", r1 === "allow", r1);

  // proven-live page, a single transient GET (twice, since it retries once) -> allowed, not aborted
  let r2 = await runGate([TRANSIENT], true).then(() => "allow", (e) => "block:" + (e && e.__kind));
  ck("(a) a proven-live card is NOT aborted by a transient GET (retries, then allows)", r2 === "allow", r2);

  // any page returning a definitive 404 -> blocked as deadlink, even if it was proven live before
  let r3 = await runGate([DEAD], true).then(() => "allow", (e) => "block:" + (e && e.__kind));
  ck("(a) a definitive 404/410 blocks as deadlink (even a once-live page)", r3 === "block:deadlink", r3);

  // never-verified page, only transient responses -> blocked (nothing ships to an unproven link)
  let r4 = await runGate([TRANSIENT], false).then(() => "allow", (e) => "block:" + (e && e.__kind));
  ck("(a) a never-verified page still blocks on a transient (notlive), nothing ships unproven", r4 === "block:notlive", r4);

  // transient first, then a 404 on the retry -> blocked as deadlink
  let r5 = await runGate([TRANSIENT, DEAD], true).then(() => "allow", (e) => "block:" + (e && e.__kind));
  ck("(a) a transient that resolves to 404 on retry blocks as deadlink", r5 === "block:deadlink", r5);

  // a non-upload opp passes straight through (unchanged)
  const Gpass = load(upload, ["upWasVerifiedLive", "upSendLiveGate"],
    "function verifyLive(){ return Promise.reject(new Error('should not be called')); }\nfunction upDelay(){return Promise.resolve();}\nfunction findRow(){return null;}\n");
  let r6 = await Gpass.upSendLiveGate("x", { source: "manual" }).then(() => "allow", () => "block");
  ck("(a) a non-upload opp passes straight through (gate unchanged for manual sends)", r6 === "allow", r6);

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
