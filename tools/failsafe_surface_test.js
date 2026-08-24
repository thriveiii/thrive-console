/* P40 failsafe surface (Node, DOM-shimmed). Proves the first-script reveal panel:
   - renders on an uncaught error AND on an unhandled rejection, with the checkpoint, row COUNT, and
     session PRESENCE, in EN and AR;
   - the boot watchdog fires only when the board never painted, and stays silent once it did;
   - it NEVER prints a token value or any row content (privacy law), counts and presence only;
   - a healthy boot renders no panel. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const SRC = fs.readFileSync(path.resolve(__dirname, "../library/failsafe.js"), "utf8");

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + (e && e.message || e)); } }

// A minimal DOM shim: enough for failsafe.js (createElement, appendChild, querySelector, textContent,
// setAttribute, style.cssText, addEventListener). Nodes remember their text so we can read the panel back.
function elem(tag) {
  return { tagName: tag, children: [], attrs: {}, style: {}, _text: "",
    set textContent(v) { this._text = String(v); }, get textContent() {
      return this._text + this.children.map(c => c.textContent).join(""); },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; } };
}
function makeEnv(opts) {
  opts = opts || {};
  const root = elem("html");
  const metas = { "thrive-build": opts.build || "abc12345" };
  const store = opts.store || {};
  const listeners = {};
  const timers = [];
  const doc = {
    documentElement: root,
    body: elem("body"),
    createElement: elem,
    querySelector(sel) {
      var m = /^meta\[name="([^"]+)"\]$/.exec(sel);
      if (m) return (metas[m[1]] != null) ? { getAttribute: () => metas[m[1]] } : null;
      if (sel === "#thriveFailsafe") return findById(root, "thriveFailsafe");
      return null;
    }
  };
  function findById(node, id) {
    if (node.id === id || (node.attrs && node.attrs.id === id)) return node;
    for (var c of node.children) { var r = findById(c, id); if (r) return r; }
    return null;
  }
  // Capture-aware listeners (P42): a window-targeted event reaches capture AND bubble listeners; a
  // resource error fired on an ELEMENT reaches only the capture listener, exactly as in a browser.
  const win = {
    ThriveSupa: opts.supa,
    __bootMark: opts.mark, __boardRows: opts.rows, __bootPainted: opts.painted, __thriveBooted: opts.booted,
    addEventListener(ev, h, cap) { (listeners[ev] = listeners[ev] || []).push({ h, cap: !!cap }); },
    dispatch(ev, obj) { (listeners[ev] || []).forEach(l => l.h(obj)); },
    dispatchResource(ev, obj) { (listeners[ev] || []).forEach(l => { if (l.cap) l.h(obj); }); }
  };
  root.classList = { _s: new Set(opts.locked ? ["gate-locked"] : []),
    add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } };
  global.window = win; global.document = doc;
  global.localStorage = { getItem: k => (k in store ? store[k] : null) };
  global.setTimeout = (cb, ms) => { timers.push(cb); return timers.length; };
  // Evaluate a fresh copy of the IIFE against this environment.
  new Function(SRC)();
  const findAny = id => findById(root, id) || findById(doc.body, id);
  return { win, doc, root, findById: id => findById(root, id), findAny, fireTimers: () => timers.forEach(cb => cb()) };
}

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.SECRET-TOKEN-VALUE.sig";

// 1. An uncaught error renders the panel with the checkpoint, count, and presence, EN + AR.
ck("error event renders the diagnostic panel with checkpoint + rows + session presence", () => {
  const env = makeEnv({ mark: "board response received", rows: 0, store: { console_sb_session: TOKEN } });
  env.win.dispatch("error", { error: { name: "TypeError", message: "t is not a function", stack: "TypeError\n    at render (app.js:120:5)" } });
  const panel = env.findById("thriveFailsafe");
  assert(panel, "no panel was created");
  const txt = panel.textContent;
  assert(txt.indexOf("TypeError: t is not a function") >= 0, "error name/message missing");
  assert(txt.indexOf("Checkpoint: board response received") >= 0, "checkpoint missing");
  assert(txt.indexOf("Board rows: 0") >= 0, "row count missing (mechanism A datum)");
  assert(txt.indexOf("Session in storage: present") >= 0, "session presence missing");
  assert(txt.indexOf("الخطأ:") >= 0 && txt.indexOf("المرحلة:") >= 0, "Arabic lines missing");
});

// 2. THE PRIVACY LAW: the panel never contains the token value or any row content, only counts/presence.
ck("the panel NEVER prints the session token value", () => {
  const env = makeEnv({ mark: "payload parsed", rows: 5, store: { console_sb_session: TOKEN } });
  env.win.dispatch("error", { error: { name: "Error", message: "boom", stack: "" } });
  const txt = env.findById("thriveFailsafe").textContent;
  assert(txt.indexOf(TOKEN) < 0, "the token LEAKED into the panel");
  assert(txt.indexOf("SECRET-TOKEN-VALUE") < 0, "token fragment leaked");
  assert(txt.indexOf("Board rows: 5") >= 0, "row COUNT should still show");
});

// 3. An unhandled promise rejection also renders the panel.
ck("unhandledrejection renders the panel", () => {
  const env = makeEnv({ mark: "board painted", rows: 3, store: {} });
  env.win.dispatch("unhandledrejection", { reason: { name: "RangeError", message: "bad", stack: "" } });
  const panel = env.findById("thriveFailsafe");
  assert(panel, "no panel on rejection");
  assert(panel.textContent.indexOf("Session in storage: null") >= 0, "absent session should read null");
});

// 4. P48: the boot-stall watchdog no longer lives in failsafe.js. The single watchdog is the head
// bootWatchdog (bundle.js). failsafe.js keeps __thriveFailsafeArm DEFINED as a safe no-op only because
// gate.js finish() still calls it; arming it must never render a stall panel from here.
ck("__thriveFailsafeArm is a safe no-op that renders no stall panel (P48 single head watchdog)", () => {
  const env = makeEnv({ mark: "hydrate begun", rows: undefined, painted: false });
  assert(typeof env.win.__thriveFailsafeArm === "function", "__thriveFailsafeArm must stay defined for gate.js");
  env.win.__thriveFailsafeArm();   // gate.js finish() calls this; it must not throw
  env.fireTimers();
  assert(!env.findById("thriveFailsafe"), "failsafe.js must not self-arm a stall panel any more");
});
ck("arming stays SILENT once the board painted (healthy boot ships no pixel)", () => {
  const env = makeEnv({ mark: "board painted", rows: 4, painted: true });
  env.win.__thriveFailsafeArm();
  env.fireTimers();
  assert(!env.findById("thriveFailsafe"), "panel rendered on a healthy boot");
});

// 5. A healthy boot with no error and no arm renders nothing at all.
ck("no error, no arm: no panel exists", () => {
  const env = makeEnv({ mark: "board painted", rows: 2, painted: true });
  assert(!env.findById("thriveFailsafe"), "a panel appeared with no trigger");
});

// 6. The panel is shown at most once (a later error does not stack a second panel).
ck("the panel renders at most once", () => {
  const env = makeEnv({ mark: "x", rows: 1 });
  env.win.dispatch("error", { error: { name: "E1", message: "one", stack: "" } });
  env.win.dispatch("error", { error: { name: "E2", message: "two", stack: "" } });
  let count = 0; (function walk(n){ if (n.id === "thriveFailsafe" || (n.attrs && n.attrs.id === "thriveFailsafe")) count++; n.children.forEach(walk); })(env.root);
  assert(count === 1, "expected exactly one panel, got " + count);
});

// ---- P41 heartbeat ----------------------------------------------------------------------------------

// H1: a heartbeat strip renders at PARSE TIME with "boot <mark> · build <stamp>".
ck("heartbeat renders at parse time with the mark and build", () => {
  const env = makeEnv({ mark: "gate resolved", build: "b7788990" });
  const hb = env.findAny("thriveHeartbeat");
  assert(hb, "no heartbeat strip at parse");
  assert(hb.textContent.indexOf("boot gate resolved") >= 0, "mark missing: " + hb.textContent);
  assert(hb.textContent.indexOf("build b7788990") >= 0, "build missing");
});

// H2: assigning window.__bootMark (the app's existing P40 assignment) updates the strip. Branch B: a
// frozen strip NAMES the blocked step.
ck("assigning __bootMark drives the heartbeat (frozen mark = branch B step name)", () => {
  const env = makeEnv({ mark: "gate resolved" });
  env.win.__bootMark = "payload parsed";
  assert(env.win.__bootMark === "payload parsed", "getter did not return the stored mark");
  assert(env.findAny("thriveHeartbeat").textContent.indexOf("boot payload parsed") >= 0, "strip did not follow the mark");
});

// H3: at payload-parsed the strip appends the row COUNT, never row content.
ck("heartbeat appends 'rows <n>' (count only) on __boardRows", () => {
  const env = makeEnv({ mark: "payload parsed" });
  env.win.__boardRows = 0;
  const t = env.findAny("thriveHeartbeat").textContent;
  assert(t.indexOf("rows 0") >= 0, "row count missing: " + t);
});

// H4: 3s after board-painted the strip removes itself (healthy boot shows a brief line and loses it).
ck("heartbeat self-removes after the board paints", () => {
  const env = makeEnv({ mark: "board request sent" });
  assert(env.findAny("thriveHeartbeat"), "strip should exist before paint");
  env.win.__bootPainted = true;   // schedules removal
  env.fireTimers();               // fire the 3s timer
  assert(!env.findAny("thriveHeartbeat"), "strip did not self-remove after paint");
});

// H5: the heartbeat NEVER contains a token value (only mark, build, count).
ck("heartbeat never contains a token value", () => {
  const env = makeEnv({ mark: "board painted", store: { console_sb_session: TOKEN } });
  env.win.__boardRows = 7;
  assert(env.findAny("thriveHeartbeat").textContent.indexOf(TOKEN) < 0, "token leaked into the heartbeat");
});

// ---- P42: the three silence gaps -------------------------------------------------------------------

// G1 (capture phase): a 404ing script fires error on the ELEMENT; only capture sees it. The panel names
// the failing URL, URL only, never content.
ck("G1 a resource error (capture phase) panels with the failing URL", () => {
  const env = makeEnv({ mark: "gate resolved", locked: true });
  env.win.dispatchResource("error", { target: { tagName: "SCRIPT", src: "https://console.thriveiii.com/library/app.js?v=deadbeef" } });
  const panel = env.findAny("thriveFailsafe");
  assert(panel, "no panel on a resource error");
  const t = panel.textContent;
  assert(t.indexOf("Resource failed: https://console.thriveiii.com/library/app.js?v=deadbeef") >= 0, "URL missing: " + t);
  assert(t.indexOf("تعذّر تحميل المورد") >= 0, "Arabic resource line missing");
});

// G2 (P48): the self-armed sentry that used to live in failsafe.js is REMOVED. failsafe.js no longer
// installs any boot-stall timer at parse time; the single watchdog is the head bootWatchdog (bundle.js).
// So even a dead document with nothing painted renders no stall panel FROM failsafe.js on a timer flush.
ck("G2 failsafe.js installs no self-armed stall timer (P48 single head watchdog)", () => {
  const env = makeEnv({ mark: undefined });   // nothing painted, app never arms
  env.fireTimers();
  assert(!env.findAny("thriveFailsafe"), "failsafe.js still self-arms a stall panel");
});
ck("G2b no stall panel over a healthy signed-out gate either (still true with no timer)", () => {
  const env = makeEnv({ booted: true });   // gate.js set __thriveBooted when the card showed
  env.fireTimers();
  assert(!env.findAny("thriveFailsafe"), "a stall panel fired over a healthy signed-out gate");
});

// G3 (reveal guarantee): when the panel fires, the gate-locked class is removed so the shell is visible
// beneath the top-sheet panel. Black is impossible by construction.
ck("G3 the panel removes gate-locked so the shell reveals beneath it", () => {
  const env = makeEnv({ mark: "hydrate begun", locked: true });
  assert(env.root.classList.contains("gate-locked"), "precondition: shell hidden");
  env.win.dispatch("error", { error: { name: "TypeError", message: "boom", stack: "" } });
  assert(env.findAny("thriveFailsafe"), "no panel");
  assert(!env.root.classList.contains("gate-locked"), "gate-locked was not removed: shell still hidden");
});

// G4 (idempotence): evaluating the file twice (inline + src tag) yields ONE strip and ONE listener set.
ck("G4 a second load of failsafe.js is a no-op (one strip, one listener set)", () => {
  const env = makeEnv({ mark: "gate resolved" });
  new Function(SRC)();   // second copy against the SAME window/document (the src tag after the inline)
  function countIn(id) {
    let c = 0;
    (function walk(n){ if (!n) return; if (n.id === id || (n.attrs && n.attrs.id === id)) c++; (n.children||[]).forEach(walk); })(env.root);
    (function walk(n){ if (!n) return; if (n.id === id || (n.attrs && n.attrs.id === id)) c++; (n.children||[]).forEach(walk); })(env.doc.body);
    return c;
  }
  assert(countIn("thriveHeartbeat") === 1, "expected exactly one heartbeat strip, got " + countIn("thriveHeartbeat"));
  env.win.dispatch("error", { error: { name: "E", message: "once", stack: "" } });
  assert(countIn("thriveFailsafe") === 1, "expected exactly one panel, got " + countIn("thriveFailsafe"));
});

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
