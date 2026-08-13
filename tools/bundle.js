#!/usr/bin/env node
/* Build the console as one document, twice.
   Run:  node tools/bundle.js
     ->  library/console.html      the served shell: same document, assets linked and cached
     ->  dist/thrive-console.html  the offline copy: everything inlined, opens from a file

   Both are generated from library/*.html, which stay the source of every view. One shell means
   one editor and one composer in the document, which is what lets the opportunity window host
   them by moving the existing nodes instead of duplicating markup.

   Every page becomes a section of one document, the nav switches between them without a
   navigation, and each page's init runs the first time its section is shown. Styles, fonts,
   scripts and the logo are inlined, so the file works from a phone's Downloads folder with no
   server and no network. It is a real copy of the console, not a screenshot of it. */

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "library");
const read = p => fs.readFileSync(p, "utf8");

/* order matters: it is the reading order of the console itself */
const VIEWS = [
  { id: "board",     file: "board.html",     init: "initBoard",     key: "nav_board" },
  /* Labelled Insights, not Overview: it is the only screen that answers which message is
     working, which campaign moved, and who is paying attention, and a name that does not say
     so is a name nobody taps. */
  { id: "home",      file: "index.html",     init: "initHome",      key: "nav_insights" },
  { id: "library",   file: "library.html",   init: "initDashboard", key: "nav_library" },
  { id: "editor",    file: "editor.html",    init: "initEditor",    key: "nav_editor" },
  { id: "compose",   file: "compose.html",   init: "initCompose",   key: "nav_compose" },
  { id: "templates", file: "templates.html", init: "initTemplates", key: "nav_templates" },
  { id: "activity",  file: "activity.html",  init: "initActivity",  key: "nav_activity" },
  { id: "profile",   file: "profile.html",   init: "initProfile",   key: "nav_profile" },
  { id: "settings",  file: "settings.html",  init: "initSettings",  key: "nav_settings" },
];

/* ---- assets ---- */
const logo = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets/thrive-logo.png")).toString("base64");
const fontsCss = read(path.join(LIB, "fonts.css"));
const stylesCss = read(path.join(LIB, "styles.css"));
const css = fontsCss + "\n" + stylesCss;
const config = read(path.join(LIB, "config.js"));
const icons = read(path.join(LIB, "icons.js"));
const i18n = read(path.join(LIB, "i18n.js"));
const gate = read(path.join(LIB, "gate.js"));
const model = read(path.join(LIB, "stage-model.js"));
const life = read(path.join(LIB, "lifecycle.js"));
const intake = read(path.join(LIB, "intake.js"));
const supabase = read(path.join(LIB, "supabase.js"));
const numbers = read(path.join(LIB, "numbers.js"));
const inbound = read(path.join(LIB, "inbound.js"));
const kinds = read(path.join(LIB, "kinds.js"));
const drafts = read(path.join(LIB, "drafts.js"));
const flows = read(path.join(LIB, "flows.js"));
const store = read(path.join(LIB, "store.js"));
const app = read(path.join(LIB, "app.js"));

/* ---- cache busting: a content fingerprint per linked asset -----------------
   The served shell console.html LINKS these files by name, and GitHub Pages serves them cacheable,
   so Safari kept painting an old styles.css and app.js long after a deploy landed. Each link now
   carries ?v=<hash of that file's bytes>, computed here at build time from the same content the
   build reads. Change a file and its hash changes, so its URL changes and the browser must fetch
   it; leave a file alone and its hash is identical, so the URL is stable and the cache is used
   correctly. No hand-typed version to forget. The entry HTML itself (console.html) is served by
   Pages with a short max-age and an ETag, so it revalidates and always points at the current
   hashes. dist inlines everything, so it carries no external asset and needs no fingerprint. */
const fphash = s => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 10);
const FP = {
  "fonts.css": fphash(fontsCss), "styles.css": fphash(stylesCss),
  "config.js": fphash(config), "icons.js": fphash(icons), "i18n.js": fphash(i18n), "gate.js": fphash(gate),
  "stage-model.js": fphash(model), "lifecycle.js": fphash(life), "intake.js": fphash(intake),
  "supabase.js": fphash(supabase),
  "numbers.js": fphash(numbers), "inbound.js": fphash(inbound), "kinds.js": fphash(kinds),
  "store.js": fphash(store), "drafts.js": fphash(drafts), "flows.js": fphash(flows), "app.js": fphash(app)
};
const fp = f => f + "?v=" + FP[f];

/* ---- build marker: a deploy is verifiable at a glance, on the device -------------------------
   Merge is not deploy: a green Pages build and a stale-looking device are indistinguishable
   without a mark that says which code is being served. BUILD is a content signature of the whole
   shipped bundle, so it changes when any shipped source changes and is byte-identical when nothing
   did. That keeps re-bundling deterministic (no wall-clock stamp to make console.html churn) while
   giving the gate a value to print. Read it off the device gate footer and compare: same mark as
   the latest build means the device is current; an older mark means it is serving old bytes. */
const BUILD = crypto.createHash("sha256")
  .update([css, icons, i18n, gate, model, life, intake, supabase, numbers, inbound, kinds, drafts, flows, store, app].join("\x00"), "utf8")
  .digest("hex").slice(0, 8);

let published = {};
try { published = JSON.parse(read(path.join(LIB, "sync.json"))); } catch (e) {}

/* ---- pull each page's <main> out ---- */
function mainOf(file) {
  const html = read(path.join(LIB, file));
  const m = html.match(/<main class="wrap">([\s\S]*?)<\/main>/);
  if (!m) throw new Error("no <main> in " + file);
  return m[1];
}

/* Links between pages become view switches; the logo becomes the inlined data URI. */
function rewrite(html) {
  return html
    .replace(/href="board\.html"/g, 'href="#board"')
    .replace(/href="index\.html"/g, 'href="#home"')
    .replace(/href="library\.html([^"]*)"/g, 'href="#library$1"')
    .replace(/href="editor\.html"/g, 'href="#editor"')
    .replace(/href="compose\.html([^"]*)"/g, 'href="#compose$1"')
    .replace(/href="templates\.html([^"]*)"/g, 'href="#templates$1"')
    .replace(/href="activity\.html"/g, 'href="#activity"')
    .replace(/href="settings\.html"/g, 'href="#settings"')
    .replace(/\.\.\/assets\/thrive-logo\.png/g, logo);
}

const sections = VIEWS.map(v =>
  '<main class="wrap view" id="view-' + v.id + '" hidden>' + rewrite(mainOf(v.file)) + "</main>"
).join("\n");
const sectionsLinked = VIEWS.map(v =>
  '<main class="wrap view" id="view-' + v.id + '" hidden>' +
  rewrite(mainOf(v.file)).split(logo).join("../assets/thrive-logo.png") + "</main>"
).join("\n");

/* The opportunity window lives outside every view, because it opens from more than one of them
   and a fixed element inside a [hidden] view is a bug waiting to happen. It MOVES the existing
   editor and composer nodes into #modalHost, so the document holds exactly one of each.

   Five tabs, three of which this window renders itself and two of which it borrows. The three
   it renders sit beside #modalHost rather than inside it, so "did the window give back
   everything it borrowed" stays a question with a one line answer: is #modalHost empty.

   Why centred rather than pinned to an edge: the drawer was specified when this view was
   mostly a single action. It has become a workspace with several tabs, and a 580px column
   against the edge of a 1440px screen pushes the eye sideways while the board sits idle
   behind it. A centred surface is the correct shape for a workspace. */
const MODAL = `
<div class="modal-scrim" id="modalScrim" hidden></div>
<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" hidden>
  <header class="modal-head">
    <div class="modal-heading">
      <h2 class="modal-title" id="modalTitle"></h2>
      <span class="pill" id="modalState"></span>
    </div>
    <div class="modal-acts">
      <!-- Back exists everywhere, in a consistent position, and it mirrors by
           logical property rather than by a second rule. WO-013 §6.1. -->
      <button class="btn ghost sm modal-back" id="modalBack" type="button" data-icon="undo" data-i18n="mw_back">Back</button>
      <button class="btn ghost sm" id="modalOpen" type="button" data-icon="globe" data-i18n="mw_open_page">Open page</button>
      <button class="btn ghost sm" id="modalCopy" type="button" data-icon="link" data-i18n="mw_copy_link">Copy page link</button>
      <button class="modal-close" id="modalClose" type="button" data-icon="close" data-i18n="dw_close">Close</button>
    </div>
    <p class="modal-why" id="modalWhy" hidden></p>
  </header>
  <!-- We kept what you wrote. The band, and Discard beside it. §6.2. -->
  <div class="draft-band" id="draftBand" hidden></div>
  <nav class="modal-tabs" id="modalTabs" role="tablist">
    <button class="modal-tab on" role="tab" aria-selected="true"  data-tab="overview" data-icon="spark" data-i18n="mw_overview">Overview</button>
    <button class="modal-tab"    role="tab" aria-selected="false" data-tab="text"     data-icon="text" data-i18n="mw_text">Text</button>
    <button class="modal-tab"    role="tab" aria-selected="false" data-tab="page"     data-icon="page" data-i18n="mw_page">Page</button>
    <button class="modal-tab"    role="tab" aria-selected="false" data-tab="outreach" data-icon="send" data-i18n="mw_outreach">Outreach</button>
    <button class="modal-tab"    role="tab" aria-selected="false" data-tab="history"  data-icon="clock" data-i18n="mw_history">History</button>
  </nav>
  <div class="modal-body" id="modalBody">
    <div class="modal-panel" id="modalOverview"></div>
    <div class="modal-panel" id="modalText" hidden></div>
    <div class="modal-panel" id="modalOutreach" hidden></div>
    <div class="modal-panel" id="modalHistory" hidden></div>
    <div class="modal-host" id="modalHost"></div>
  </div>
</div>`;

/* Four destinations, not three. The numbers were reachable only from inside the Library after
   the reduction, which read as though they had been deleted. What you measure has to be one
   tap from where you work. */
const TOPBAR = ["board","home","library","profile","settings"];
const nav = VIEWS.filter(v => TOPBAR.indexOf(v.id) >= 0).map(v =>
  '<a href="#' + v.id + '" data-view="' + v.id + '" data-i18n="' + v.key + '"></a>'
).join("\n    ");

const GATE_HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8";

function build(inline){
const head = inline
  ? '<style>\n' + css + '\n.view[hidden]{display:none!important}\n</style>'
  : '<link rel="stylesheet" href="' + fp("fonts.css") + '">\n<link rel="stylesheet" href="' + fp("styles.css") + '">' +
    '\n<style>.view[hidden]{display:none!important}</style>';
const body = inline
  ? '<script>window.THRIVE_SYNC_JSON = ' + JSON.stringify(published) + ';</script>' +
    '\n<script>\n' + config + '\n</script>' +
    '\n<script>\n' + icons + '\n</script>\n<script>\n' + i18n + '\n</script>' +
    '\n<script>\n' + gate + '\n</script>' +
    '\n<script>\n' + model + '\n</script>\n<script>\n' + life + '\n</script>'+
    '\n<script>\n' + intake + '\n</script>'+
    '\n<script>\n' + supabase + '\n</script>'+
    '\n<script>\n' + numbers + '\n</script>'+
    '\n<script>\n' + inbound + '\n</script>'+
    '\n<script>\n' + kinds + '\n</script>'+
    '\n<script>\n' + store + '\n</script>'+
    '\n<script>\n' + drafts + '\n</script>'+
    '\n<script>\n' + flows + '\n</script>'+
    '\n<script>\n' + app + '\n</script>'
  : '<script src="' + fp("config.js") + '"></script>\n<script src="' + fp("icons.js") + '"></script>\n<script src="' + fp("i18n.js") + '"></script>\n<script src="' + fp("gate.js") + '"></script>' +
    '\n<script src="' + fp("stage-model.js") + '"></script>\n<script src="' + fp("lifecycle.js") + '"></script>' +
    '\n<script src="' + fp("intake.js") + '"></script>\n<script src="' + fp("supabase.js") + '"></script>'+
    '\n<script src="' + fp("numbers.js") + '"></script>'+
    '\n<script src="' + fp("inbound.js") + '"></script>\n<script src="' + fp("kinds.js") + '"></script>'+
    '\n<script src="' + fp("store.js") + '"></script>\n<script src="' + fp("drafts.js") + '"></script>'+
    '\n<script src="' + fp("flows.js") + '"></script>\n<script src="' + fp("app.js") + '"></script>';
const icon = inline ? logo : "../assets/thrive-logo.png";
const mark = inline ? logo : "../assets/thrive-logo.png";
const sections2 = inline ? sections : sectionsLinked;
const out = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<meta name="thrive-build" content="${BUILD}">
<title>Thrive Console</title>
<link rel="icon" href="${icon}">
<script>(function(){var d=document.documentElement;
/* ROOT B, first paint: set the reading direction at the app root from the stored language before any
   other script runs, so Arabic is right-to-left from the first frame and never depends on a later
   init succeeding. applyLang() stays the ongoing authority; this only removes the boot-order and
   deployed-build fragility that left the root LTR. Engine-independent (plain DOM), so it holds on
   WebKit as on Chromium. */
try{var __l=localStorage.getItem('thrive_lang');d.setAttribute('lang',__l==='ar'?'ar':'en');d.setAttribute('dir',__l==='ar'?'rtl':'ltr');}catch(e){}
function lock(){d.classList.add('gate-locked')}
try{if(sessionStorage.getItem('thrive_gate_v2')!=='${GATE_HASH}')lock()}catch(e){lock()}
setTimeout(function(){if(!d.classList.contains('gate-locked')||document.getElementById('thriveGate'))return;
var ar=false;try{ar=localStorage.getItem('thrive_lang')==='ar'}catch(e){}
var p=document.createElement('p');p.className='bootfail';
p.textContent=ar?'تعذّر تشغيل الكونسول. أعد تحميل الصفحة، وتحقق من الاتصال إن تكرر الأمر.'
:'The console could not start. Reload the page, and check your connection if it happens again.';
(document.body||d).appendChild(p)},6000)})();</script>
${head}
</head>
<body>
<noscript><p class="bootfail">This console needs JavaScript to run. <span dir="rtl">يحتاج هذا الكونسول إلى تفعيل JavaScript.</span></p></noscript>
<header class="top">
  <a class="brand" href="#board"><img src="${mark}" alt="Thrive" width="26" height="26" decoding="async"><b data-i18n="brand">Thrive Digital Solutions</b></a>
  <nav class="nav">
    ${nav}
    <button id="langbtn" class="langbtn">العربية</button>
  </nav>
</header>

${sections2}
${MODAL}

${body}
<script>
/* One document, eight views. Each init runs the first time its view is shown, which is exactly
   what the served console does per page load, and again whenever the view is asked for with
   DIFFERENT parameters, which is exactly what a second page load would do.

   That second half was missing, and it is why "use this template", "compose with this" and the
   Email button on a library card opened an empty screen: the destination was already started,
   so the parameters were never read. Re-running an init over a DOM that has already been wired
   would double every listener, so the view's markup is restored from the snapshot taken at boot
   first. A view is then exactly as freshly loaded as it would be on its own page. */
(function(){
  var VIEWS = ${JSON.stringify(VIEWS.map(v => ({ id: v.id, init: v.init })))};
  var started = {};      // id -> the parameter string it was started with
  var stale = {};        // ids that must run again even with the same parameters
  var snapshot = {};     // id -> its markup at boot, so a re-init starts clean

  function snap(){
    VIEWS.forEach(function(v){
      var el = document.getElementById("view-" + v.id);
      if(el) snapshot[v.id] = el.innerHTML;
    });
  }
  function query(){
    var h = location.hash || "", i = h.indexOf("?");
    return i >= 0 ? h.slice(i + 1) : "";
  }
  function current(){ return (location.hash||"").replace(/^#/,"").split("?")[0] || VIEWS[0].id; }

  function show(id){
    var found = VIEWS.some(function(v){ return v.id === id; });
    if(!found) id = VIEWS[0].id;
    // Going somewhere closes the sheet you were working in, and the sheet hands its view back.
    if(window.thriveModal && window.thriveModal.isOpen && window.thriveModal.isOpen())
      window.thriveModal.close(true);   // now, not after the transition: the view is needed here
    var host = document.getElementById("modalHost");
    VIEWS.forEach(function(v){
      var el = document.getElementById("view-" + v.id);
      if(!el) return;
      if(host && el.parentNode === host) return;   // the window owns this one right now
      el.hidden = (v.id !== id);
    });
    document.querySelectorAll(".nav a[data-view]").forEach(function(a){
      a.classList.toggle("active", a.getAttribute("data-view") === id);
    });
    var v = VIEWS.filter(function(x){ return x.id === id; })[0];
    var want = query();
    var need = !(id in started) || started[id] !== want || stale[id];
    if(v && need && typeof window[v.init] === "function"){
      var el = document.getElementById("view-" + id);
      // A restart, not a first start: put the markup back before wiring it again, so one
      // element never ends up with two of the same listener.
      if((id in started) && el && snapshot[id] != null){
        el.innerHTML = snapshot[id];
        if(typeof applyLang === "function") try{ applyLang(); }catch(e){}
      }
      started[id] = want; delete stale[id];
      try{ window[v.init](); }catch(e){ console.error(e); }
    }
    try{ window.scrollTo(0,0); }catch(e){}
  }
  /* Handing a view to something that is not the shell.
     The opportunity window borrows the composer and the editor by moving their nodes, and it
     re-runs their init every time a tab is entered. Over a DOM that init already wired, that is
     a SECOND set of listeners on every control in it, which on a composer means one click on
     Send sending twice. So the borrower asks for the view to be put back the way it was at
     boot first, exactly as this shell already does for itself, and the shell marks it stale so
     it re-inits when somebody navigates to it directly. */
  window.thriveViewReset = function(id){
    var el = document.getElementById("view-" + id);
    if(el && snapshot[id] != null){
      el.innerHTML = snapshot[id];
      if(typeof applyLang === "function") try{ applyLang(); }catch(e){}
    }
    stale[id] = 1;
  };
  window.addEventListener("hashchange", function(){ show(current()); });
  document.addEventListener("DOMContentLoaded", function(){
    snap();
    initLang();
    if(typeof initModal === "function") initModal();
    show(current());
    // A fresh unlock lands on the first view with its data already pulled. Registered like
    // every other listener, so it cannot displace the sync round or a view's own refresh.
    if(typeof onThrive === "function") onThrive("unlock","shell",function(){
      // Nothing was allowed to read data before the unlock, so everything already started
      // has to run again against the data it can finally see.
      Object.keys(started).forEach(function(k){ stale[k] = 1; });
      show(current());
    });
  });
})();
</script>
</body>
</html>
`;
return out;
}

function emit(file, inline){
  const html = build(inline);
  const dest = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  console.log("wrote " + file + "  (" + Math.round(html.length / 1024) + " KB)");
}
emit("library/console.html", false);
emit("dist/thrive-console.html", true);
