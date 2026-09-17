// G1 gate: fails-when-broken proof of the centered opportunity window shell + mode selector, and that the card
// tap routes to it (not the drawer). Loads the REAL window functions (owModeSelectHtml / owRender / owSelectMode
// / openOppWindow / closeOppWindow) from tools/bundle.js's buildBoard block into a sandbox with a fake DOM, so
// the real open/select/close/routing logic runs. CSS centering/sizing and bottom-sheet are the device gate;
// this proves the behavior + wiring that must hold.
//
// Proves:
//   - openOppWindow(slug) reveals #owScrim (window), leaves the drawer #scrim untouched, and shows the mode
//     selector (both choices) with the tab strip hidden and the change-mode button hidden;
//   - selecting Mode A mounts an empty #owModeA (no tab strip); Mode B (G3) shows the tab strip + mounts the
//     Message/Page/Recipients/Preview panels and the one Commit, with the change-mode button; the mode can be
//     switched back to the selector;
//   - closeOppWindow hides the window;
//   - openOppWindow falls back to openDrawer if the shell node is absent (drawer stays callable).
// Plus source guards: markup + centered CSS + bottom-sheet + backdrop/Escape wiring + the card-tap route +
// no duplicated editor/preview/suppression code.
//
// Pure Node. Run: node tools/opp_window_shell_test.js
// Fails-when-broken: revert the card tap to openDrawer -> the route guard fails; drop the selector -> the
// selector cases fail; make the non-live path RED... (n/a here).

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const BUNDLE = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");
const BOARD = fs.readFileSync(path.join(ROOT, "library/board.html"), "utf8");

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

// ---- a fake DOM: persistent elements per id --------------------------------------------------------
let DREW;   // set true if the drawer fallback (openDrawer) was called
function load(shellPresent) {
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { id: id, hidden: true, innerHTML: "", textContent: "", scrollTop: 0, addEventListener: function () {} };
    return els[id];
  }
  if (!shellPresent) { els.__noOwScrim = true; }
  const documentStub = {
    getElementById: function (id) {
      if (id === "owScrim" && els.__noOwScrim) return null;   // simulate the shell being absent
      return el(id);
    },
    querySelectorAll: function () { return []; }               // owWireTabs iterates the tab buttons (none in this stub)
  };
  const stubs = {
    esc: function (s) { return String(s == null ? "" : s); },
    t: function (k) { return k; },                              // echo the i18n KEY
    findRow: function () { return { slug: "acme", business: "Acme Co" }; },
    openDrawer: function () { DREW = true; },
    document: documentStub
  };
  const names = Object.keys(stubs);
  // OW_TABS + __owTab are buildBoard vars (not functions); mirror them here like __owSlug/__owMode. The G3 Mode B
  // branch of owRender pulls in owTabsHtml/owModeBBodyHtml/owWireTabs/owModeBMount; owModeBMount's owMsgMount/
  // owPageMount/owCommitCampaign live in the src modules and stay typeof-guarded (skipped in this sandbox).
  const body =
    "var __owSlug=null, __owMode=null, __owTab='msg';\n" +
    "var OW_TABS=[{k:'msg',key:'ow_tab_msg'},{k:'page',key:'ow_tab_page'},{k:'recip',key:'ow_tab_recip'},{k:'preview',key:'ow_tab_preview'}];\n" +
    fnSrc(BUNDLE, "function owModeSelectHtml(") + "\n" +
    fnSrc(BUNDLE, "function owRender(") + "\n" +
    fnSrc(BUNDLE, "function owSelectMode(") + "\n" +
    fnSrc(BUNDLE, "function owTabsHtml(") + "\n" +
    fnSrc(BUNDLE, "function owModeBBodyHtml(") + "\n" +
    fnSrc(BUNDLE, "function owWireTabs(") + "\n" +
    fnSrc(BUNDLE, "function owModeBMount(") + "\n" +
    fnSrc(BUNDLE, "function openOppWindow(") + "\n" +
    fnSrc(BUNDLE, "function closeOppWindow(") + "\n" +
    "return { openOppWindow:openOppWindow, owSelectMode:owSelectMode, closeOppWindow:closeOppWindow };";
  var api = new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
  api._els = els;
  return api;
}

// ---- source guards ---------------------------------------------------------------------------------
ck("the centered window markup #oppWindow + #owScrim is present in the built shell",
   /id="owScrim"[^>]*class="ow-scrim"/.test(BOARD) && /id="oppWindow"[^>]*class="ow"/.test(BOARD) && /id="owBody"/.test(BOARD));
ck("the window CSS is centered at min(920px,92vw) / max-height 88vh with equal padding",
   /\.ow\{[^}]*width:min\(920px,92vw\)[^}]*max-height:88vh/.test(BOARD) && /\.ow-body\{[^}]*padding:20px/.test(BOARD));
ck("the backdrop is dimmed + blurred and only the body scrolls (fixed header + tabs)",
   /\.ow-scrim\{[^}]*backdrop-filter:blur/.test(BOARD) && /\.ow-body\{[^}]*overflow-y:auto/.test(BOARD) && /\.ow-head\{[^}]*flex:0 0 auto/.test(BOARD));
ck("it becomes a full-height bottom sheet under 720px",
   /@media \(max-width:720px\)\{[^@]*\.ow\{[^}]*height:92vh;border-radius:16px 16px 0 0/.test(BOARD));
ck("G5: the card tap routes UNCONDITIONALLY to the window detail-first (the drawer is retired - no fallback)",
   /var open=function\(\)\{ openOppWindow\(slug, ?"detail"\); \};/.test(BOARD) &&
   !/function openDrawer\(/.test(BOARD) && !/openDrawer\(/.test(BOARD));
ck("backdrop click + close button + change-mode + Escape are wired to close/switch the window",
   /ow\.addEventListener\("click", function\(e\)\{ if\(e\.target===ow\) closeOppWindow\(\)/.test(BOARD) &&
   /owc\.addEventListener\("click", function\(\)\{ closeOppWindow\(\)/.test(BOARD) &&
   /if\(e\.key==="Escape"\)\{ closeOppWindow\(\)/.test(BOARD));
ck("bilingual selector + header copy present EN + AR, no em dash",
   (BOARD.match(/ow_mode_a:/g) || []).length === 2 && (BOARD.match(/ow_pick:/g) || []).length === 2 &&
   BOARD.indexOf("رسالة بدون حملة") >= 0 && BOARD.indexOf("رسالة مع حملة") >= 0 && BOARD.indexOf("\u2014") === -1);
ck("G1 does not duplicate the shared editor/preview/suppression code (one copy each)",
   (BOARD.match(/function pageFrameIframe\(/g) || []).length === 1 &&
   (BOARD.match(/function editorHtml\(/g) || []).length === 1 &&
   (BOARD.match(/function loadSuppressions\(/g) || []).length === 1);

// ---- behavior: open -> selector -------------------------------------------------------------------
var U = load(true);
DREW = false;
U.openOppWindow("acme");
var scrim = U._els.owScrim, bodyEl = U._els.owBody, tabs = U._els.owTabs, chg = U._els.owChangeMode;
ck("openOppWindow reveals the window (#owScrim shown)", scrim.hidden === false, scrim.hidden);
ck("...it did NOT open the drawer (openDrawer never called; the drawer #scrim was never touched)",
   DREW === false && U._els.scrim === undefined);
ck("...the mode selector shows BOTH choices", bodyEl.innerHTML.indexOf("owPickA") >= 0 && bodyEl.innerHTML.indexOf("ow_mode_a") >= 0 && bodyEl.innerHTML.indexOf("ow_mode_b") >= 0, bodyEl.innerHTML);
ck("...the tab strip is hidden and change-mode is hidden on the selector", tabs.hidden === true && chg.hidden === true);
ck("...the title reflects the opp", U._els.owTitle.textContent === "Acme Co", U._els.owTitle.textContent);

// ---- behavior: Mode A -----------------------------------------------------------------------------
U.owSelectMode("a");
ck("Mode A mounts an empty #owModeA with NO tab strip", bodyEl.innerHTML.indexOf('id="owModeA"') >= 0 && tabs.hidden === true, bodyEl.innerHTML);
ck("...and the change-mode control is now shown", chg.hidden === false);

// ---- behavior: Mode B (G3) ------------------------------------------------------------------------
U.owSelectMode("b");
ck("Mode B shows the tab strip (Message/Page/Recipients/Preview) and mounts the panels",
   tabs.hidden === false && tabs.innerHTML.indexOf('data-ow-tab="page"') >= 0 &&
   bodyEl.innerHTML.indexOf('id="owMsgPanel"') >= 0 && bodyEl.innerHTML.indexOf('id="owPagePanel"') >= 0 &&
   bodyEl.innerHTML.indexOf('id="owCommit"') >= 0, { body: bodyEl.innerHTML, tabs: tabs.innerHTML });

// ---- behavior: switch back to selector, then close ------------------------------------------------
U.owSelectMode(null);
ck("switching mode back shows the selector again", bodyEl.innerHTML.indexOf("owPickA") >= 0 && tabs.hidden === true);
U.closeOppWindow();
ck("closeOppWindow hides the window", scrim.hidden === true);

// ---- behavior: with the shell node absent, openOppWindow is a safe no-op (the drawer is retired) --------
var U2 = load(false);
DREW = false;
U2.openOppWindow("acme");   // must not throw and must NOT reach the retired drawer
ck("openOppWindow is a safe no-op when #owScrim is absent (no drawer fallback - it is gone)", DREW === false);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
