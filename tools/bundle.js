#!/usr/bin/env node
/* Build the whole console into one downloadable HTML file.
   Run:  node tools/bundle.js  ->  dist/thrive-console.html

   Every page becomes a section of one document, the nav switches between them without a
   navigation, and each page's init runs the first time its section is shown. Styles, fonts,
   scripts and the logo are inlined, so the file works from a phone's Downloads folder with no
   server and no network. It is a real copy of the console, not a screenshot of it. */

"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "library");
const read = p => fs.readFileSync(p, "utf8");

/* order matters: it is the reading order of the console itself */
const VIEWS = [
  { id: "board",     file: "board.html",     init: "initBoard",     key: "nav_board" },
  { id: "home",      file: "index.html",     init: "initHome",      key: "nav_home" },
  { id: "library",   file: "library.html",   init: "initDashboard", key: "nav_library" },
  { id: "editor",    file: "editor.html",    init: "initEditor",    key: "nav_editor" },
  { id: "compose",   file: "compose.html",   init: "initCompose",   key: "nav_compose" },
  { id: "templates", file: "templates.html", init: "initTemplates", key: "nav_templates" },
  { id: "activity",  file: "activity.html",  init: "initActivity",  key: "nav_activity" },
  { id: "settings",  file: "settings.html",  init: "initSettings",  key: "nav_settings" },
];

/* ---- assets ---- */
const logo = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets/thrive-logo.png")).toString("base64");
const css = read(path.join(LIB, "fonts.css")) + "\n" + read(path.join(LIB, "styles.css"));
const i18n = read(path.join(LIB, "i18n.js"));
const gate = read(path.join(LIB, "gate.js"));
const model = read(path.join(LIB, "stage-model.js"));
const app = read(path.join(LIB, "app.js"));
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
    .replace(/href="templates\.html"/g, 'href="#templates"')
    .replace(/href="activity\.html"/g, 'href="#activity"')
    .replace(/href="settings\.html"/g, 'href="#settings"')
    .replace(/\.\.\/assets\/thrive-logo\.png/g, logo);
}

const sections = VIEWS.map(v =>
  '<main class="wrap view" id="view-' + v.id + '" hidden>' + rewrite(mainOf(v.file)) + "</main>"
).join("\n");

const TOPBAR = ["board","library","settings"];
const nav = VIEWS.filter(v => TOPBAR.indexOf(v.id) >= 0).map(v =>
  '<a href="#' + v.id + '" data-view="' + v.id + '" data-i18n="' + v.key + '"></a>'
).join("\n    ");

const GATE_HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8";

const out = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Thrive Console</title>
<link rel="icon" href="${logo}">
<script>(function(){var d=document.documentElement;function lock(){d.classList.add('gate-locked')}
try{if(sessionStorage.getItem('thrive_gate_v2')!=='${GATE_HASH}')lock()}catch(e){lock()}
setTimeout(function(){if(!d.classList.contains('gate-locked')||document.getElementById('thriveGate'))return;
var ar=false;try{ar=localStorage.getItem('thrive_lang')==='ar'}catch(e){}
var p=document.createElement('p');p.className='bootfail';
p.textContent=ar?'تعذّر تشغيل الكونسول. أعد تحميل الصفحة، وتحقق من الاتصال إن تكرر الأمر.'
:'The console could not start. Reload the page, and check your connection if it happens again.';
(document.body||d).appendChild(p)},6000)})();</script>
<style>
${css}
/* the single-file build stacks every page as a hidden view and shows one at a time */
.view[hidden]{display:none!important}
</style>
</head>
<body>
<noscript><p class="bootfail">This console needs JavaScript to run. <span dir="rtl">يحتاج هذا الكونسول إلى تفعيل JavaScript.</span></p></noscript>
<header class="top">
  <a class="brand" href="#home"><img src="${logo}" alt="Thrive" width="26" height="26" decoding="async"><b data-i18n="brand">Thrive Digital Solutions</b></a>
  <nav class="nav">
    ${nav}
    <button id="langbtn" class="langbtn">العربية</button>
    <button id="lockbtn" class="langbtn" onclick="window.thriveLock&&window.thriveLock()" data-i18n="lock_btn">Lock</button>
  </nav>
</header>

${sections}

<script>window.THRIVE_SYNC_JSON = ${JSON.stringify(published)};</script>
<script>
${i18n}
</script>
<script>
${gate}
</script>
<script>
${model}
</script>
<script>
${app}
</script>
<script>
/* One document, seven views. Each init runs once, the first time its view is shown, which is
   exactly what the served console does per page load. */
(function(){
  var VIEWS = ${JSON.stringify(VIEWS.map(v => ({ id: v.id, init: v.init })))};
  var started = {};
  function show(id){
    var found = VIEWS.some(function(v){ return v.id === id; });
    if(!found) id = VIEWS[0].id;
    VIEWS.forEach(function(v){
      var el = document.getElementById("view-" + v.id);
      if(el) el.hidden = (v.id !== id);
    });
    document.querySelectorAll(".nav a[data-view]").forEach(function(a){
      a.classList.toggle("active", a.getAttribute("data-view") === id);
    });
    var v = VIEWS.filter(function(x){ return x.id === id; })[0];
    if(v && !started[id] && typeof window[v.init] === "function"){
      started[id] = true;
      try{ window[v.init](); }catch(e){ console.error(e); }
    }
    try{ window.scrollTo(0,0); }catch(e){}
  }
  function current(){ return (location.hash||"").replace(/^#/,"").split("?")[0] || VIEWS[0].id; }
  window.addEventListener("hashchange", function(){ show(current()); });
  document.addEventListener("DOMContentLoaded", function(){
    initLang();
    show(current());
    // A fresh unlock lands on the first view with its data already pulled.
    var prev = window.onGateUnlocked;
    window.onGateUnlocked = function(){ if(typeof prev==="function") try{ prev(); }catch(e){} show(current()); };
  });
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
const dest = path.join(ROOT, "dist/thrive-console.html");
fs.writeFileSync(dest, out);
console.log("wrote " + path.relative(ROOT, dest) + "  (" + Math.round(out.length / 1024) + " KB)");
