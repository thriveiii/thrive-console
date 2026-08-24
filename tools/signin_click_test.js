/* P44 the sign-in click path speaks (Node). Every prior instrument watched the BOOT; the "Signing in"
   hang lives in the CLICK path. Proves:
   - signIn() sets the ordered __signMark steps and reaches session:ok on a healthy run (runtime);
   - a blocked-storage run reaches session:ephemeral, never hangs on the persist (runtime);
   - the failsafe strip renders the sign mark live and re-shows after removal (runtime);
   - __thriveSignStall panels "Sign-in stalled" naming the LAST step reached, keeping the gate (runtime);
   - the gate's hard 15s race, its typed "stall" kind, its Retry routing, and the step-in-diagnostic are
     present (source contract: attempt() lives in a DOM closure, so its wiring is asserted at source). */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const SUPA = path.join(ROOT, "library/supabase.js");
const FS_SRC = read("library/failsafe.js");
const GATE = read("library/gate.js");
const APP = read("library/app.js");

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + (e && e.message || e)); } }

// ---- runtime: signIn marks --------------------------------------------------------------------------
function makeStore(block) {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (block) throw new Error("storage blocked"); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); } };
}
function loadSupa(store, captured) {
  const win = { THRIVE_CONFIG: { supaUrl: "https://x.supabase.co", supaAnon: "anon-k" } };
  global.window = win; global.localStorage = store; global.THRIVE_CONFIG = win.THRIVE_CONFIG;
  global.AbortController = function () { this.signal = {}; this.abort = function () {}; };
  global.fetch = async (url, opts) => {
    if (captured) captured.push({ url: String(url), headers: (opts && opts.headers) || {} });
    return { ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ access_token: "tok-1", refresh_token: "r-1", expires_at: 9999999999, user: { id: "u1" } }) };
  };
  delete require.cache[SUPA];
  require(SUPA);
  return win;
}

(async function () {
  await (async () => {
    const win = loadSupa(makeStore(false));
    const seen = [];
    Object.defineProperty(win, "__signMark", { set: v => seen.push(v), get: () => seen[seen.length - 1] });
    await win.ThriveSupa.signIn("op@t.test", "pw");
    ck("S1 a healthy sign-in walks token:sent, token:ok, session:persist, session:ok in order", () => {
      assert.deepStrictEqual(seen, ["token:sent", "token:ok", "session:persist", "session:ok"], JSON.stringify(seen));
    });
  })();

  await (async () => {
    const win = loadSupa(makeStore(true));   // storage throws on every write
    const seen = [];
    Object.defineProperty(win, "__signMark", { set: v => seen.push(v), get: () => seen[seen.length - 1] });
    const r = await win.ThriveSupa.signIn("op@t.test", "pw");
    ck("S2 blocked storage: the persist step resolves session:ephemeral, never hangs or throws", () => {
      assert(r.ok === true && r.ephemeral === true, "sign-in should succeed ephemeral");
      assert(seen[seen.length - 1] === "session:ephemeral", "last mark: " + seen[seen.length - 1]);
    });
  })();

  // P46 regression guard: against a mocked 200 token response, signIn MUST reach token:ok, and the token
  // POST must carry the KNOWN-GOOD header set — apikey + Content-Type, and NOT the "Authorization: Bearer
  // <anon>" header that P34 (a67056a) added and that no version which ever signed in successfully sent.
  // This exact regression (an extra header on the token call) can never ship silently again.
  await (async () => {
    const cap = [];
    const win = loadSupa(makeStore(false), cap);
    const seen = [];
    Object.defineProperty(win, "__signMark", { set: v => seen.push(v), get: () => seen[seen.length - 1] });
    await win.ThriveSupa.signIn("op@t.test", "pw");
    const tok = cap.find(r => r.url.indexOf("/auth/v1/token?grant_type=password") >= 0);
    ck("S5 signIn reaches token:ok on a mocked 200 (the regression could not reach it)", () => {
      assert(seen.indexOf("token:ok") >= 0, "token:ok never reached; marks: " + JSON.stringify(seen));
    });
    ck("S6 the token POST carries the known-good header set (apikey + JSON, NO Authorization)", () => {
      assert(tok, "no token POST was captured");
      assert(tok.headers.apikey === "anon-k", "apikey header missing/wrong: " + JSON.stringify(tok.headers));
      assert(tok.headers["Content-Type"] === "application/json", "Content-Type header missing");
      assert(!("Authorization" in tok.headers), "the reverted Authorization header is back on the token call");
    });
  })();

  // ---- runtime: failsafe strip + stall panel --------------------------------------------------------
  function elem(t){return {children:[],attrs:{},style:{},_text:"",set textContent(v){this._text=String(v)},get textContent(){return this._text+this.children.map(c=>c.textContent).join("\n")},setAttribute(k,v){this.attrs[k]=v},appendChild(c){this.children.push(c);c.parentNode=this;return c},removeChild(c){var i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);}};}
  function loadFailsafe() {
    const root = elem("html");
    root.classList = { _s:new Set(["gate-locked"]), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, contains(c){return this._s.has(c)} };
    const body = elem("body");
    const gateEl = elem("div"); gateEl.id = "thriveGate"; gateEl.parentNode = body; body.children.push(gateEl);
    global.window = { addEventListener(){}, __thriveBooted: true };
    global.document = { documentElement: root, body: body, createElement: elem,
      getElementById: id => (id === "thriveGate" ? gateEl : null),
      querySelector: s => /meta/.test(s) ? { getAttribute: () => "beefcafe" } : null };
    global.localStorage = { getItem: () => null };
    global.setTimeout = cb => 1;
    global.location = { pathname: "/library/console.html", search: "", hash: "", replace(){} };
    global.fetch = undefined;   // convergence stands down; not under test here
    new Function(FS_SRC)();
    const find = id => body.children.concat(root.children).find(c => c.id === id);
    return { win: global.window, root, body, gateEl, find };
  }

  (function () {
    const env = loadFailsafe();
    env.win.__signMark = "token:sent";
    ck("S3 the strip renders the sign mark live", () => {
      const hb = env.find("thriveHeartbeat");
      assert(hb, "no strip");
      assert(hb.textContent.indexOf("sign token:sent") >= 0, "sign mark missing: " + hb.textContent);
    });
    env.win.__signMark = "session:persist";
    env.win.__thriveSignStall("hard 15s race fired");
    ck("S4 the stall panel names the LAST step and keeps the gate on screen", () => {
      const p = env.find("thriveFailsafe");
      assert(p, "no stall panel");
      assert(p.textContent.indexOf("Sign-in stalled") >= 0, "headline missing");
      assert(p.textContent.indexOf("last step: session:persist") >= 0, "last step not named: " + p.textContent);
      assert(env.body.children.indexOf(env.gateEl) >= 0, "the gate was removed: the operator lost the retry form");
    });
  })();

  // ---- source contracts: the gate wiring (attempt() lives in a DOM closure) -------------------------
  ck("G1 the gate marks click and navigate, and races the WHOLE click path at a hard 15s", () => {
    assert(/__signMark = "click"/.test(GATE), "click mark missing");
    assert(/__signMark = "navigate"/.test(GATE), "navigate mark missing");
    assert(/Promise\.race\(\[S\.signIn\(/.test(GATE), "the hard race around signIn is missing");
    assert(/e\.kind = "stall"/.test(GATE) && /15000/.test(GATE), "typed stall at 15s missing");
    assert(/clearTimeout\(stallTimer\)/.test(GATE), "the stall timer is never cleared");
  });
  ck("G2 a stall routes to the failsafe panel and to Retry, never the credential throttle", () => {
    assert(/kind === "stall"[^]*__thriveSignStall/.test(GATE), "stall does not raise the panel");
    assert(/kind === "unavailable" \|\| kind === "stall"/.test(GATE), "stall is not in the transient/Retry branch");
  });
  ck("G3 every rejection carries the step in its visible diagnostic", () => {
    assert(/"at " \+ step \+ " · "/.test(GATE), "the step prefix is missing from the raw diagnostic");
  });
  ck("G4 the read marks join the sequence where the board read already happens", () => {
    assert(/__signMark="read:sent"/.test(APP) && /__signMark="read:ok"/.test(APP), "read marks missing in app.js");
  });

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
