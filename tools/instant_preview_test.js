// F2 gate: fails-when-broken proof that the two gap preview surfaces render from the HELD html as a sandboxed
// srcdoc iframe (instant, deploy-independent), never from the live URL. Loads the REAL pageFrameIframe,
// libRowHtml (Library review row) and upWireActivate (drawer page section) from tools/board-upload.src.js.
//
// Proves:
//   - pageFrameIframe renders a sandboxed .lv-frame iframe whose srcdoc is the held html, tokens ({{...}})
//     preserved as-is (raw-template preview);
//   - the Library REVIEW row previews the page via that iframe, NOT an escaped <pre> source snippet;
//   - the drawer page section carries a #upPreview slot, and upWireActivate fills it from the STORED
//     console_pages html (pageReadHtml) via the same srcdoc iframe.
// Plus source guards for each site.
//
// Pure Node. Run: node tools/instant_preview_test.js
// Fails-when-broken: revert the Library review row to upFrame(...slice(0,320)) -> the review case fails;
// drop the #upPreview fill in upWireActivate -> the drawer case fails.

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const UPLOAD = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");

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

const TOKEN_HTML = "<h1>Offer</h1><img src='{{ASSET_BASE}}/opp/logo.png'>";

// sandbox for the sync renderers (pageFrameIframe, libRowHtml)
let READ_HTML, PV;   // pageReadHtml result; captured #upPreview element
function load() {
  const els = {};
  function el(id) { if (!els[id]) els[id] = { innerHTML: "", disabled: false, addEventListener: function () {}, getAttribute: function () { return null; } }; return els[id]; }
  const stubs = {
    t: function (k) { return k; },
    esc: function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    upWarnChips: function () { return ""; },
    upFrame: function (txt) { return '<div class="up-frame"><pre class="up-pre">' + txt + "</pre></div>"; },
    upPretty: function (s) { return s; },
    upActStatus: function () {}, upReverify: function () {},
    pageReadHtml: function () { return Promise.resolve(READ_HTML); },
    document: {
      getElementById: function (id) { var e = el(id); if (id === "upPreview") PV = e; return e; },
      querySelector: function () { return { getAttribute: function (k) { return k === "data-page-slug" ? "camp" : (k === "data-live" ? "1" : null); } }; }
    }
  };
  const names = Object.keys(stubs);
  const body =
    "var __upLive={}, __upVerifying={};\n" +
    fnSrc(UPLOAD, "function pageFrameIframe(") + "\n" +
    fnSrc(UPLOAD, "function libRowHtml(") + "\n" +
    fnSrc(UPLOAD, "function upWireActivate(") + "\n" +
    "return { pageFrameIframe:pageFrameIframe, libRowHtml:libRowHtml, upWireActivate:upWireActivate };";
  return new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
}
const U = load();

(async function () {
  // ---- source guards -------------------------------------------------------------------------------
  ck("pageFrameIframe renders a sandboxed .lv-frame srcdoc iframe (the reused editor/Library mechanism)",
     /<iframe class="lv-frame"[^>]*sandbox=""[^>]*srcdoc="/.test(fnSrc(UPLOAD, "function pageFrameIframe(")));
  ck("the Library review row previews the page via pageFrameIframe (not an escaped source snippet)",
     /pageFrameIframe\(r\.page\.html\)/.test(fnSrc(UPLOAD, "function libRowHtml(")) &&
     fnSrc(UPLOAD, "function libRowHtml(").indexOf("upFrame(String(r.page.html)") < 0);
  ck("the drawer page section carries a #upPreview slot",
     /id="upPreview"/.test(fnSrc(UPLOAD, "function uploadActivateHtml(")));
  ck("upWireActivate fills #upPreview from the stored html (pageReadHtml -> pageFrameIframe srcdoc)",
     /pageReadHtml\(pageSlug\)\.then\(function\(html\)\{ if\(html\) pv\.innerHTML = pageFrameIframe\(html\); \}/.test(fnSrc(UPLOAD, "function upWireActivate(")));

  // ---- behavior: pageFrameIframe --------------------------------------------------------------------
  var frame = U.pageFrameIframe(TOKEN_HTML);
  ck("pageFrameIframe is a sandboxed lv-frame iframe", /class="lv-frame"/.test(frame) && /sandbox=""/.test(frame) && /srcdoc="/.test(frame), frame);
  ck("the held html rides in srcdoc (escaped), so it renders from held HTML not the live URL", frame.indexOf("&lt;h1&gt;Offer&lt;/h1&gt;") >= 0, frame);
  ck("tokens ({{...}}) are preserved as-is (raw-template preview, no filling)", frame.indexOf("{{ASSET_BASE}}/opp/logo.png") >= 0, frame);

  // ---- behavior: Library review row previews the page, not source text ------------------------------
  var row = U.libRowHtml({ slug: "camp", title: "Camp", task: "", warnings: [], page: { html: TOKEN_HTML } }, 0);
  ck("the review row renders the page as an lv-frame iframe", row.indexOf('class="lv-frame"') >= 0, row);
  ck("...and NOT as a <pre> source snippet", row.indexOf("up-pre") < 0, row);
  var noPage = U.libRowHtml({ slug: "m", title: "M", task: "", warnings: [], page: null }, 1);
  ck("a row with no page html shows the empty state (no iframe)", noPage.indexOf("up-empty") >= 0 && noPage.indexOf("lv-frame") < 0, noPage);

  // ---- behavior: drawer preview filled from stored html --------------------------------------------
  READ_HTML = TOKEN_HTML; PV = null;
  U.upWireActivate("camp");
  await Promise.resolve(); await Promise.resolve();   // let the pageReadHtml microtask settle
  ck("upWireActivate fills the drawer #upPreview with the stored-html srcdoc iframe", PV && /class="lv-frame"/.test(PV.innerHTML) && PV.innerHTML.indexOf("&lt;h1&gt;Offer") >= 0, PV && PV.innerHTML);
  ck("...preserving tokens as-is", PV && PV.innerHTML.indexOf("{{ASSET_BASE}}/opp/logo.png") >= 0, PV && PV.innerHTML);

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
