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
  { id: "contacts",  file: "contacts.html",  init: "initContacts",  key: "nav_contacts" },
  { id: "library",   file: "library.html",   init: "initDashboard", key: "nav_library" },
  { id: "editor",    file: "editor.html",    init: "initEditor",    key: "nav_editor" },
  { id: "compose",   file: "compose.html",   init: "initCompose",   key: "nav_compose" },
  { id: "templates", file: "templates.html", init: "initTemplates", key: "nav_templates" },
  { id: "activity",  file: "activity.html",  init: "initActivity",  key: "nav_activity" },
  { id: "batches",   file: "batches.html",   init: "initBatches",   key: "nav_batches" },
  { id: "oversight", file: "oversight.html", init: "initOversight", key: "nav_oversight" },
  { id: "profile",   file: "profile.html",   init: "initProfile",   key: "nav_profile" },
  { id: "settings",  file: "settings.html",  init: "initSettings",  key: "nav_settings" },
];

/* ---- assets ---- */
const logo = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets/thrive-logo.png")).toString("base64");
const fontsCss = read(path.join(LIB, "fonts.css"));
const stylesCss = read(path.join(LIB, "styles.css"));
const css = fontsCss + "\n" + stylesCss;
const config = read(path.join(LIB, "config.js"));
/* BARE_GATE (brief P54): the root index becomes a session-aware router that can perform ONE silent token
   refresh with the frozen request shape before it ever loads the console bundle. It needs the connection
   values, sourced HERE from config.js so they never drift from the baked default the console itself uses. */
const SUPA_URL = (config.match(/supaUrl\s*=\s*"([^"]+)"/) || [])[1] || "";
const SUPA_ANON = (config.match(/supaAnon\s*=\s*"([^"]+)"/) || [])[1] || "";
if (!SUPA_URL || !SUPA_ANON) throw new Error("bundle: could not read supaUrl/supaAnon from config.js for the index router");
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
/* P40: the failsafe reveal surface. Inlined as the FIRST script on every page (both builds), before any
   module, so it registers its error listeners with zero dependency on an asset fetch and can speak even
   when everything else fails to load. */
const failsafe = read(path.join(LIB, "failsafe.js"));

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
  "store.js": fphash(store), "drafts.js": fphash(drafts), "flows.js": fphash(flows), "app.js": fphash(app),
  "failsafe.js": fphash(failsafe)
};
// P42: one path convention for every linked tag. The explicit "./" prefix resolves byte-identically to
// the old bare form against /library/, but every tag now states its convention rather than assuming the
// document's directory; no tag on the page is left under a mixed style.
const fp = f => "./" + f + "?v=" + FP[f];

/* ---- build marker: a deploy is verifiable at a glance, on the device -------------------------
   Merge is not deploy: a green Pages build and a stale-looking device are indistinguishable
   without a mark that says which code is being served. BUILD is a content signature of the whole
   shipped bundle, so it changes when any shipped source changes and is byte-identical when nothing
   did. That keeps re-bundling deterministic (no wall-clock stamp to make console.html churn) while
   giving the gate a value to print. Read it off the device gate footer and compare: same mark as
   the latest build means the device is current; an older mark means it is serving old bytes.

   SHELL_IN_THE_HASH: the fingerprint MUST include the shell TEMPLATE, not only the module sources.
   The served console.html is assembled by THIS generator (the head with its stylesheet links, the
   inline critical CSS, the boot order, the index router). A change to that assembly changes the bytes
   the device runs but touches no module, so a module-only hash leaves BUILD unchanged. The index router
   then points at console.html?v=<same BUILD>, and every device that cached the previous shell keeps
   serving it: a correct shell fix that never reaches the device. That is exactly what stranded the
   operators on the index splash after a shell-only first-paint fix. Folding this file's own source into
   the hash makes any change to how the shell is built bump BUILD, so the versioned URL changes and the
   new shell is fetched. The recipe is part of the product's identity. */
const GENERATOR_SRC = fs.readFileSync(__filename, "utf8");
const BUILD = crypto.createHash("sha256")
  .update([css, icons, i18n, gate, model, life, intake, supabase, numbers, inbound, kinds, drafts, flows, store, app, failsafe, GENERATOR_SRC].join("\x00"), "utf8")
  .digest("hex").slice(0, 8);
/* The deploy time, baked here at build time (never read at runtime). BUILD says WHICH code is live;
   BUILT_AT says WHEN it was built, so a capture from the device is labeled with both. This is the one
   value that is not a pure content signature: a re-bundle stamps a new time, so console.html carries its
   own build time. The determinism guard (deploy_marker_test) masks this stamp and still proves that
   nothing ELSE churns between re-bundles. UTC, second precision, so it reads the same in every timezone. */
const BUILT_AT = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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
    <button class="modal-tab"    role="tab" aria-selected="false" data-tab="discussion" data-icon="channel" data-i18n="mw_discussion">Discussion</button>
  </nav>
  <div class="modal-body" id="modalBody">
    <div class="modal-panel" id="modalOverview"></div>
    <div class="modal-panel" id="modalText" hidden></div>
    <div class="modal-panel" id="modalOutreach" hidden></div>
    <div class="modal-panel" id="modalHistory" hidden></div>
    <div class="modal-panel" id="modalDiscussion" hidden></div>
    <div class="modal-host" id="modalHost"></div>
  </div>
</div>`;

/* Four destinations, not three. The numbers were reachable only from inside the Library after
   the reduction, which read as though they had been deleted. What you measure has to be one
   tap from where you work. */
const TOPBAR = ["board","home","contacts","library","batches","profile","settings"];
const nav = VIEWS.filter(v => TOPBAR.indexOf(v.id) >= 0).map(v =>
  '<a href="#' + v.id + '" data-view="' + v.id + '" data-i18n="' + v.key + '"></a>'
).join("\n    ");

const GATE_HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8";

/* P48 critical gate CSS. The gate is the first boot boundary and must paint a correct login card WITHOUT
   waiting on fonts.css (~327 KB) or styles.css (~201 KB). This minimal, self-sufficient block is emitted
   into the head of the SERVED (non-inline) build only; the offline (inline) build already inlines all CSS
   and needs nothing here. It is a faithful subset of the gate selectors in styles.css, with literal colour
   values (the CSS custom properties live in styles.css, not yet loaded at this moment) and a SYSTEM font
   stack so first paint never blocks on a webfont. It is placed BEFORE the fonts/styles links, so once the
   full stylesheet loads its equal-specificity rules (later in document order) win and govern the final
   look; this block only rules the pre-stylesheet frame. This is a boot correction, not a redesign.

   BOOT_FIRST_PAINT: the two heavy stylesheets below are loaded NON-render-blocking (media="print", flipped
   to media="all" on load), with a <noscript> render-blocking fallback for JS-off. A render-blocking
   <link rel="stylesheet"> withholds the document's FIRST paint until the sheet has fully downloaded and
   parsed; fonts.css + styles.css together are ~528 KB, so on a marginal connection the console never
   reaches first paint, and the browser keeps showing the PREVIOUS document (the root index splash) with no
   way forward. Detaching them from the paint path lets this inline critical block paint the gate/boot frame
   the moment the HTML arrives; the full sheets swap in when they can. The board reveal is gated on app.js
   (~890 KB, requested from the end of body in parallel), which is far larger than styles.css, so the styles
   are in force well before any board is shown: no flash of unstyled content in practice. */
const criticalGateCss =
  'html,body{background:#0a0a0c}' +
  'body{margin:0;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif}' +
  'html.gate-locked .top,html.gate-locked .wrap{display:none!important}' +
  '#thriveGate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:22px;' +
  'background:radial-gradient(1200px 600px at 50% -10%,rgba(150,133,202,.18),transparent 60%),#0a0a0c}' +
  '.gate-card{width:100%;max-width:360px;background:#111116;border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:30px 26px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.55)}' +
  '.gate-logo{width:40px;height:40px;display:block;margin:0 auto 14px}' +
  '.gate-title{font-size:20px;font-weight:800;color:#fff;margin:0 0 6px}' +
  '.gate-sub{font-size:13px;color:#9ca3af;margin:0 0 18px}' +
  '.gate-input{width:100%;background:#16161d;border:1px solid rgba(255,255,255,.10);border-radius:10px;color:#fff;padding:12px 14px;font-size:15px;font-family:inherit;outline:none;text-align:center;letter-spacing:.02em}' +
  '.gate-input:focus{border-color:#9685CA}' +
  '.gate-btn{width:100%;margin-top:12px;padding:12px 18px;border:0;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;color:#15121b;' +
  'background:linear-gradient(120deg,#72BECE,#5D7FB7,#9685CA,#EE8C9D,#A78CA7,#71BFCC);box-shadow:0 8px 24px rgba(150,133,202,.28);font-family:inherit}' +
  '.gate-btn.ghost{color:#d1d5db;background:transparent;box-shadow:none;border:1px solid rgba(255,255,255,.10);margin-top:8px}' +
  '.gate-err{color:#EE8C9D;font-size:12.5px;font-weight:700;margin:12px 0 0}' +
  '.gate-diag{color:#9ca3af;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:6px 0 0;line-height:1.4;word-break:break-word;direction:ltr;text-align:start}' +
  '.gate-note{color:#9ca3af;font-size:11.5px;margin:16px 0 0;line-height:1.5}' +
  '.gate-build{color:#6b7280;font-size:11px;margin:12px 0 0;opacity:.75;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
  '.gate-build bdi{unicode-bidi:isolate}' +
  '.build-stamp{position:fixed;inset-block-end:6px;inset-inline-end:8px;z-index:5;pointer-events:none;font:10px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#6b7280;opacity:.42;letter-spacing:.02em;white-space:nowrap;max-inline-size:96vw;overflow:hidden;text-overflow:ellipsis}' +
  '.build-stamp bdi{unicode-bidi:isolate}';

function build(inline){
const head = inline
  ? '<style>\n' + css + '\n.view[hidden]{display:none!important}\n</style>'
  : '<style id="gate-critical">' + criticalGateCss + '</style>' +
    '\n<link rel="stylesheet" href="' + fp("fonts.css") + '" media="print" onload="this.media=\'all\'">' +
    '\n<link rel="stylesheet" href="' + fp("styles.css") + '" media="print" onload="this.media=\'all\'">' +
    '\n<noscript><link rel="stylesheet" href="' + fp("fonts.css") + '"><link rel="stylesheet" href="' + fp("styles.css") + '"></noscript>' +
    '\n<style>.view[hidden]{display:none!important}</style>';
// P48 boot order: config -> supabase -> gate load and run BEFORE the heavy app modules, so the login
// door paints as the first boot boundary rather than after app.js (~874 KB) finishes parsing. gate.js'
// dependencies (config's THRIVE_CONFIG, supabase's ThriveSupa) are satisfied before gate runs; every
// module below is still present exactly once, only reordered.
const body = inline
  ? '<script>window.THRIVE_SYNC_JSON = ' + JSON.stringify(published) + ';</script>' +
    '\n<script>\n' + config + '\n</script>' +
    '\n<script>\n' + supabase + '\n</script>' +
    '\n<script>\n' + gate + '\n</script>' +
    '\n<script>\n' + icons + '\n</script>\n<script>\n' + i18n + '\n</script>' +
    '\n<script>\n' + model + '\n</script>\n<script>\n' + life + '\n</script>'+
    '\n<script>\n' + intake + '\n</script>'+
    '\n<script>\n' + numbers + '\n</script>'+
    '\n<script>\n' + inbound + '\n</script>'+
    '\n<script>\n' + kinds + '\n</script>'+
    '\n<script>\n' + store + '\n</script>'+
    '\n<script>\n' + drafts + '\n</script>'+
    '\n<script>\n' + flows + '\n</script>'+
    '\n<script>\n' + app + '\n</script>'
  : '<script src="' + fp("config.js") + '"></script>\n<script src="' + fp("supabase.js") + '"></script>\n<script src="' + fp("gate.js") + '"></script>' +
    '\n<script src="' + fp("icons.js") + '"></script>\n<script src="' + fp("i18n.js") + '"></script>' +
    '\n<script src="' + fp("stage-model.js") + '"></script>\n<script src="' + fp("lifecycle.js") + '"></script>' +
    '\n<script src="' + fp("intake.js") + '"></script>'+
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
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="thrive-build" content="${BUILD}">
<meta name="thrive-built-at" content="${BUILT_AT}">
<!-- P40/P42/P48: the failsafe reveal surface, FIRST script, before any module. Registers global error and
     unhandledrejection listeners (bubble AND capture, so a 404ing resource speaks too) and the P41
     heartbeat/sign-step strip; a healthy boot ships no lingering pixel from it. P48: this is now the ONE
     failsafe copy. The inline block runs at parse time and cannot 404, so the duplicate external
     <script src="failsafe.js"> is gone; failsafe.js keeps its window.__thriveFailsafeLoaded idempotence
     guard regardless, so nothing can double-register or double-paint. -->
<script>
${failsafe}
</script>
<!-- The shell must always re-fetch the current asset references so a new deploy is never served as old
     bytes. GitHub Pages sets its own short HTML cache we cannot override with a header, so these are the
     in-our-control best effort; the load-bearing guarantee is the versioned redirect in the root index.html
     (console.html?v=BUILD) plus every asset carrying ?v=<content hash>. -->
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>Thrive Console</title>
<link rel="icon" href="${icon}">
<script>(function(){var d=document.documentElement;
/* ROOT B, first paint: set the reading direction at the app root from the stored language before any
   other script runs, so Arabic is right-to-left from the first frame and never depends on a later
   init succeeding. applyLang() stays the ongoing authority; this only removes the boot-order and
   deployed-build fragility that left the root LTR. Engine-independent (plain DOM), so it holds on
   WebKit as on Chromium. */
try{var __l=localStorage.getItem('thrive_lang');d.setAttribute('lang',__l==='ar'?'ar':'en');d.setAttribute('dir',__l==='ar'?'rtl':'ltr');}catch(e){}
/* Cause 1 insurance: no service worker is registered by this console, but if a stale one was ever
   installed (a past experiment, another app on the same origin) it could pin old bytes forever. Unregister
   any that exist, so old code can never be served from a worker cache. */
try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){try{r.unregister();}catch(e){}});}).catch(function(){});}}catch(e){}
function lock(){d.classList.add('gate-locked')}
try{if(sessionStorage.getItem('thrive_gate_v2')!=='${GATE_HASH}')lock()}catch(e){lock()}
/* P48 single watchdog: the redundant 6s bootfail timeout was removed (it competed with the one watchdog
   below). This 20s bootWatchdog is now the ONLY head watchdog. If nothing interactive has painted within
   the bound, it replaces the screen with a plain panel that offers a way out, so a degraded service (a
   paused project, a stalled read) is never an infinite spinner. window.__thriveBooted is set by the gate
   the moment a sign-in card shows, and by the board's first paint (app.js render); the watchdog fires only
   when neither has happened. P48: Retry-only, so it never starts a second auth/sign-out state machine.
   Self-contained and inline-styled so it works even if styles.css or app.js failed to load. */
setTimeout(function(){if(window.__thriveBooted)return;
var war=false;try{war=localStorage.getItem('thrive_lang')==='ar'}catch(e){}
try{var wg=document.getElementById('thriveGate');if(wg&&wg.parentNode)wg.parentNode.removeChild(wg);}catch(e){}
try{var wb=document.querySelector('.bootfail');if(wb&&wb.parentNode)wb.parentNode.removeChild(wb);}catch(e){}
try{d.classList.remove('gate-locked');}catch(e){}
var wt=war?'يستغرق الكونسول وقتًا أطول من المعتاد.':'The console is taking too long.';
var ws=war?'تحقّق من اتصالك، ثم أعد المحاولة.':'Check your connection, then retry.';
var wr=war?'إعادة المحاولة':'Retry';
var W=document.createElement('div');W.id='bootWatchdog';W.setAttribute('dir',war?'rtl':'ltr');
W.setAttribute('style','position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0a0a0c;color:#e5e7eb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center');
/* P48: Retry only. The watchdog must never start a second auth/sign-out state machine, so the former
   "Sign out" button and its handler are gone; Retry simply reloads. */
W.innerHTML='<div style="max-width:22rem"><p style="font-size:1.05rem;font-weight:600;margin:0 0 .4rem">'+wt+'</p><p style="opacity:.75;margin:0 0 1.2rem">'+ws+'</p><div style="display:flex;gap:.6rem;justify-content:center"><button id="wdRetry" type="button" style="padding:.6rem 1.1rem;border-radius:.5rem;border:0;background:#71BFCC;color:#04252b;font-weight:600;cursor:pointer">'+wr+'</button></div></div>';
(document.body||d).appendChild(W);
try{document.getElementById('wdRetry').addEventListener('click',function(){location.reload();});}catch(e){}
},20000);})();</script>
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
<!-- Part 2: the always-visible build stamp. Baked here at build time (BUILD is the content signature,
     BUILT_AT the deploy time), never read at runtime. Thyab glances at the bottom corner and knows in one
     second which code is live and when it was built; every device capture is now labeled. Low contrast and
     pointer-events:none, so it never obstructs the board. The values are ASCII and isolated in a bdi run so
     the Arabic layout cannot reorder them. -->
<div class="build-stamp" aria-hidden="true">build <bdi class="mono-iso">${BUILD}</bdi> · <bdi class="mono-iso">${BUILT_AT}</bdi></div>

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

  // P27: owner-only views. A member (or any not-yet-owner session) is refused, including a direct hash
  // navigation, and the URL is corrected to the board so it can never rest on an owner-only route. The
  // real boundary is the database (RLS on console_members); this is the honest UI half of it. ownerOK
  // fails CLOSED (owner status must be explicitly true), so a view is never shown before the role is known.
  var OWNER_ONLY = { oversight:1 };
  function ownerOK(){ try{ return !!(window.isOwnerMember && window.isOwnerMember()); }catch(e){ return false; } }
  function ownerResolved(){ try{ return !!(window.ownerTierResolved && window.ownerTierResolved()); }catch(e){ return false; } }
  function show(id){
    var found = VIEWS.some(function(v){ return v.id === id; });
    if(!found) id = VIEWS[0].id;
    // Owner-only routing. Refuse outright ONLY once the role is resolved-and-not-owner: correct the URL to the
    // board so it can never rest on an owner-only route. While the role is still resolving (a slow or failed
    // roster read), do NOT bounce -- let the view through to its own init, which awaits the role and
    // self-refuses if this turns out to be a member. So a possible owner is never briefly kicked to the board.
    if(OWNER_ONLY[id] && !ownerOK() && ownerResolved()){
      id = VIEWS[0].id; try{ if((location.hash||"").replace(/^#/,"").split("?")[0]==="oversight") location.replace("#"+VIEWS[0].id); }catch(e){}
    }
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
  // P27: once the role is known (loaded async after sign-in), re-evaluate the current route so an owner who
  // deep-linked or clicked into an owner-only view lands correctly, and install the owner-only nav link.
  window.thriveOwnerRecheck = function(){ try{ if(OWNER_ONLY[current()]) show(current()); }catch(e){} };
  window.addEventListener("hashchange", function(){ show(current()); });
  document.addEventListener("DOMContentLoaded", function(){
    snap();
    initLang();
    if(typeof initModal === "function") initModal();
    show(current());
    // A fresh unlock lands on the first view with its data already pulled. Registered like
    // every other listener, so it cannot displace the sync round or a view's own refresh.
    if(typeof onThrive === "function") onThrive("unlock","shell",function(){
      // Nothing was allowed to read data before the unlock, so every view that initialized while signed out
      // must run again against the data it can finally see. Mark them all stale so each re-inits cleanly on
      // its NEXT navigation. But do NOT re-show the CURRENTLY visible view here: on sign-in the operator lands
      // on the board, and re-showing a started view resets its DOM to the empty boot snapshot
      // (innerHTML = snapshot) and races the board's own in-place unlock render (renderBoard), which is what
      // left the board blank after every read returned 200. The current view is refreshed in place by its own
      // unlock handler; only a view that never started (a deep link straight into it) is shown now, and that
      // is a clean first mount with no reset.
      var cur = current();
      Object.keys(started).forEach(function(k){ stale[k] = 1; });
      if(!(cur in started)) show(cur);
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

/* Part 1, the load-bearing cache fix: the root redirect carries the build id, so a new deploy points the
   browser at console.html?v=<new BUILD>, a URL it has never cached, and it must fetch the fresh shell (and
   through it the fresh, content-hashed assets). GitHub Pages caches this tiny HTML for a short window we
   cannot header-override, so the meta cache directives are best effort on top; the version in the redirect
   is what guarantees a merged-and-deployed build is the build that runs. Generated here so BUILD is always
   current, never a hand-typed version to forget. */
const rootIndex = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>Thrive</title>
<!-- BARE_GATE (brief P54): the root is a session-aware router. The meta refresh (JS-off fallback) still
     fires at 0s straight to console.html?v=BUILD (a JS-off device that is already signed in reveals from
     the mirror; a fresh one meets the in-console gate), and the inline JS below decides at once, with NO
     version.json probe in the critical path:
       - just returned from a successful bare-gate sign-in (?warm=1): forward to the console;
       - a live operator session in the mirror: forward to the console (no network on the warm path);
       - an expired session: ONE silent bounded token refresh with the frozen request shape, then forward
         on success, else bounce to gate.html;
       - no session at all: bounce to gate.html (the proven auth path), never a black screen.
     The in-shell P43 convergence (failsafe.js fetches version.json inside console.html) stays the stale
     shell safety net; the console's own boot still reads the mirror and heals its session too. -->
<meta http-equiv="refresh" content="0; url=./library/console.html?v=${BUILD}">
<link rel="icon" href="./assets/thrive-logo.png">
<style>html,body{margin:0;background:#0a0a0c;color:#9ca3af;font-family:-apple-system,Segoe UI,Roboto,sans-serif;height:100%}
.c{height:100%;display:flex;align-items:center;justify-content:center;gap:12px}
img{width:26px;height:26px;animation:s 22s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
a{color:#71BFCC}</style></head>
<body><div class="c"><img src="./assets/thrive-logo.png" alt=""><span>Opening the <a href="./library/console.html?v=${BUILD}">Thrive Opportunity Library</a>…</span></div>
<script>(function(){/* BARE_GATE router. Session-aware, no version.json probe in the critical path. Query
  params (minus any stale v/vr/warm) and the hash carry across to the console, so ?debug=paint survives. */
  var BUILD="${BUILD}", URL_BASE="${SUPA_URL}", ANON="${SUPA_ANON}";
  var SESSION_KEY="console_sb_session", PRESENCE="thrive_presence";
  var q=(location.search||"").replace(/^\\?/,"").split("&").filter(function(p){return p&&p.indexOf("v=")!==0&&p.indexOf("vr=")!==0&&p.indexOf("warm=")!==0;}).join("&");
  var warm=/[?&]warm=1(&|$)/.test(location.search||"");
  function toConsole(){ location.replace("./library/console.html?v="+BUILD+(q?("&"+q):"")+(location.hash||"")); }
  function toGate(){ location.replace("gate.html"); }
  function readSess(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||"null"); }catch(e){ return null; } }
  function expired(s){ try{ if(!s||!s.expires_at) return false; return (Number(s.expires_at)*1000) < (Date.now()-5000); }catch(e){ return false; } }
  var sess=readSess();
  if(warm){ toConsole(); return; }                                  // just signed in through the bare gate
  if(!sess||!sess.access_token){ toGate(); return; }                // no session: the bare gate owns sign-in
  if(!expired(sess)){ toConsole(); return; }                        // live session: forward, no network
  // Expired token: ONE silent bounded refresh (frozen shape, arrayBuffer + TextDecoder read). Success
  // re-mirrors and forwards; a failure or timeout bounces to the bare gate, never the console operator card.
  var done=false, timer=setTimeout(function(){ if(done) return; done=true; toGate(); }, 12000);
  var opts={method:"POST",headers:{"apikey":ANON,"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({refresh_token:sess.refresh_token})};
  fetch(URL_BASE+"/auth/v1/token?grant_type=refresh_token",opts).then(function(res){
    var read=(typeof res.arrayBuffer==="function")?res.arrayBuffer().then(function(b){return new TextDecoder("utf-8").decode(b);}):res.text();
    return read.then(function(t){ return {ok:res.ok,text:t}; });
  }).then(function(r){
    if(done) return; done=true; clearTimeout(timer);
    var t=String(r.text||"").replace(/^\\uFEFF/,"").trim(), d=null; try{ d=t?JSON.parse(t):null; }catch(e){}
    if(r.ok && d && d.access_token){
      try{ localStorage.setItem(SESSION_KEY, JSON.stringify({access_token:d.access_token,refresh_token:d.refresh_token,expires_at:d.expires_at,email:sess.email,uid:sess.uid||((d.user&&d.user.id)||"")})); localStorage.setItem(PRESENCE,String(Date.now())); }catch(e){}
      toConsole();
    } else { toGate(); }
  }).catch(function(){ if(done) return; done=true; clearTimeout(timer); toGate(); });
})();</script></body></html>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), rootIndex);
console.log("wrote index.html  (redirect -> console.html?v=" + BUILD + ")");

/* P43: the version authority. One tiny JSON, written by the SAME step that stamps the build, fetched
   with cache:"no-store" by every entry document at boot. It is how a document discovers it is stale:
   the served build is the truth, the baked stamp is the claim, and a mismatch forces one revalidating
   reload. Kept beside index.html at the site root so both entry documents reach it relatively. */
fs.writeFileSync(path.join(ROOT, "version.json"), JSON.stringify({ build: BUILD, builtAt: BUILT_AT }) + "\n");
console.log("wrote version.json  ({build: " + BUILD + "})");
