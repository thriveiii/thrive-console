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
    appendChild(c) { this.children.push(c); return c; } };
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
  const win = {
    ThriveSupa: opts.supa,
    __bootMark: opts.mark, __boardRows: opts.rows, __bootPainted: opts.painted,
    addEventListener(ev, h) { (listeners[ev] = listeners[ev] || []).push(h); },
    dispatch(ev, obj) { (listeners[ev] || []).forEach(h => h(obj)); }
  };
  global.window = win; global.document = doc;
  global.localStorage = { getItem: k => (k in store ? store[k] : null) };
  global.setTimeout = (cb, ms) => { timers.push(cb); return timers.length; };
  // Evaluate a fresh copy of the IIFE against this environment.
  new Function(SRC)();
  return { win, doc, root, findById: id => findById(root, id), fireTimers: () => timers.forEach(cb => cb()) };
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

// 4. The watchdog fires only when the board never painted.
ck("watchdog fires the stall panel when the board never painted", () => {
  const env = makeEnv({ mark: "hydrate begun", rows: undefined, painted: false });
  env.win.__thriveFailsafeArm();
  env.fireTimers();
  const panel = env.findById("thriveFailsafe");
  assert(panel, "stall panel did not appear");
  assert(panel.textContent.indexOf("Console boot stalled") >= 0, "stall header missing");
  assert(panel.textContent.indexOf("Board rows: unknown") >= 0, "unknown rows should read 'unknown'");
});
ck("watchdog stays SILENT once the board painted (healthy boot ships no pixel)", () => {
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

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
