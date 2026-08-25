/* P47 click-path contract, RECONCILED from the P44 suite (Node). P47 restored the sign-in path to its
   last-good (P31, 506334f) shape: signIn no longer sets window.__signMark steps, and the gate no longer
   wraps signIn in a hard 15s Promise.race. The P47 build diff proved the request is byte-identical to the
   build that signed in, so the instrumentation was dropped and the path returned to that shape. This suite
   now asserts the RESTORED behavior:
   - a healthy sign-in resolves ok and signedIn() is true (runtime);
   - a blocked-storage sign-in still resolves ok, never throws (runtime, last-good shape);
   - the token POST carries the known-good header set (apikey + JSON, NO Authorization) (runtime);
   - the failsafe strip machinery (P42/P43, retained) still renders a mark and its stall panel (runtime);
   - the gate awaits signIn directly (no hard race, no step marks), always releases the button, and routes
     a transient failure to Retry (source contract: the click handler lives in a DOM closure). */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const SUPA = path.join(ROOT, "library/supabase.js");
const FS_SRC = read("library/failsafe.js");
const GATE = read("library/gate.js");
const APP = read("library/app.js");
const SUPA_SRC = read("library/supabase.js");

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + (e && e.message || e)); } }

// ---- runtime: signIn resolves cleanly ---------------------------------------------------------------
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
    if (captured) captured.push({ url: String(url), headers: (opts && opts.headers) || {}, hasSignal: !!(opts && opts.signal) });
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
    const r = await win.ThriveSupa.signIn("op@t.test", "pw");
    ck("S1 a healthy sign-in RETURNS the parsed session (GATE_V2) and signedIn() is true", () => {
      assert(r && r.access_token === "tok-1", "sign-in did not return the session: " + JSON.stringify(r));
      assert(win.ThriveSupa.signedIn() === true, "signedIn() is not true after a healthy sign-in");
    });
  })();

  await (async () => {
    const win = loadSupa(makeStore(true));   // storage throws on every write
    let threw = false, r = null;
    try { r = await win.ThriveSupa.signIn("op@t.test", "pw"); } catch (e) { threw = true; }
    ck("S2 blocked storage: sign-in still returns the session AND the memory session holds (GATE_V2)", () => {
      assert(threw === false, "a storage-blocked sign-in threw");
      assert(r && r.access_token === "tok-1", "a storage-blocked sign-in did not return the session");
      assert(win.ThriveSupa.signedIn() === true, "the memory-primary session is not held with storage blocked");
    });
  })();

  // P46 header guard (retained through the P47 restore): the token POST must carry the KNOWN-GOOD header
  // set (apikey + Content-Type) and NOT the "Authorization: Bearer <anon>" header that P34 added and that
  // no version which ever signed in successfully sent. This request shape is what P47's diff proved is
  // byte-identical to the last-good build, so the guard stays.
  await (async () => {
    const cap = [];
    const win = loadSupa(makeStore(false), cap);
    await win.ThriveSupa.signIn("op@t.test", "pw");
    const tok = cap.find(r => r.url.indexOf("/auth/v1/token?grant_type=password") >= 0);
    ck("S3 the token POST carries the known-good header set (apikey + JSON, NO Authorization)", () => {
      assert(tok, "no token POST was captured");
      assert(tok.headers.apikey === "anon-k", "apikey header missing/wrong: " + JSON.stringify(tok.headers));
      assert(tok.headers["Content-Type"] === "application/json", "Content-Type header missing");
      assert(!("Authorization" in tok.headers), "the reverted Authorization header is back on the token call");
    });
    // P50: the auth token fetch is BARE (no AbortController signal), matching authtest.html, which returned
    // fast on the iPad where this wrapped call hung. The signal is the one fetch-touching construct authtest
    // lacked; WebKit's AbortController+fetch is documented-unreliable. A rest() read still carries a signal,
    // so the change is scoped to the auth token path only.
    await win.ThriveSupa.rest("console_board", { query: "select=slug" });
    const rd = cap.find(r => r.url.indexOf("/rest/v1/") >= 0);
    ck("S7 the auth token POST is signal-free (P50) while rest() still carries its abort signal", () => {
      assert(tok && tok.hasSignal === false, "the auth token fetch still attaches an AbortController signal");
      assert(rd && rd.hasSignal === true, "the rest() read lost its abort signal (change leaked past the auth path)");
    });
  })();

  // ---- runtime: failsafe strip + stall panel (P42/P43 machinery, retained) --------------------------
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
    env.win.__signMark = "read:sent";
    ck("S4 the failsafe strip renders a live mark", () => {
      const hb = env.find("thriveHeartbeat");
      assert(hb, "no strip");
      assert(hb.textContent.indexOf("read:sent") >= 0, "mark missing: " + hb.textContent);
    });
    env.win.__signMark = "read:sent";
    env.win.__thriveSignStall("hard stall for the test");
    ck("S5 the stall panel names the LAST mark and keeps the gate on screen", () => {
      const p = env.find("thriveFailsafe");
      assert(p, "no stall panel");
      assert(p.textContent.indexOf("Sign-in stalled") >= 0, "headline missing");
      assert(p.textContent.indexOf("last step: read:sent") >= 0, "last step not named: " + p.textContent);
      assert(env.body.children.indexOf(env.gateEl) >= 0, "the gate was removed: the operator lost the retry form");
    });
  })();

  // ---- source contracts: the restored gate wiring (attempt() lives in a DOM closure) ----------------
  ck("G1 the gate binds success to signIn's RETURN VALUE (GATE_V2), no hard race, no step marks", () => {
    assert(/sess = await S\.signIn\(m, p, \{ fresh: !!fresh \}\);/.test(GATE), "the direct awaited signIn is missing");
    assert(/ok = !!\(sess && sess\.access_token\)/.test(GATE), "success is not bound to the returned session");
    assert(!/ok = S\.signedIn/.test(GATE), "success is still bound to a storage read-back (signedIn())");
    assert(!/Promise\.race\(\[S\.signIn\(/.test(GATE), "the P44 hard race around signIn is still present");
    assert(!/__signMark/.test(GATE), "the P44 step marks are still present in the gate");
    assert(!/kind === "stall"/.test(GATE), "the stall branch is still present in the gate");
  });
  ck("G2 the button state is always released and a transient failure routes to Retry, not the throttle", () => {
    assert(/busy = false; email\.disabled = pass\.disabled = false; btn\.textContent = s\.op_go;/.test(GATE), "the button is not unconditionally released");
    assert(/kind === "timeout" \|\| kind === "network" \|\| kind === "unavailable"/.test(GATE), "the transient/Retry branch is missing");
    assert(/showRetry\(true\)/.test(GATE), "Retry is not offered on a transient failure");
  });
  ck("G3 a rejection captures the raw error text (kind + message [+ status]), the last-good diagnostic", () => {
    assert(/raw = \(kind \|\| "error"\) \+ ": " \+ \(\(ex && ex\.message\) \|\| String\(ex\)\)/.test(GATE), "the last-good raw diagnostic is missing");
    assert(!/"at " \+ step \+ " · "/.test(GATE), "the P44 step prefix is still in the diagnostic");
  });
  ck("G4 the board read still carries its checkpoints where the read happens (failsafe strip input)", () => {
    assert(/__signMark="read:sent"/.test(APP) && /__signMark="read:ok"/.test(APP), "read marks missing in app.js");
  });
  // P48 gate-first boot: gate.js must not wait for DOMContentLoaded (that waited for app.js), and must
  // start immediately behind a double-init guard.
  ck("G5 the gate starts immediately (no DOMContentLoaded wait), guarded against double init", () => {
    assert(!/addEventListener\("DOMContentLoaded", start\)/.test(GATE), "the gate still waits for DOMContentLoaded");
    assert(/window\.__gateStarted/.test(GATE) && /start\(\);/.test(GATE), "the guarded immediate start() is missing");
  });
  // P48: gate-first means a WARM session resolves before app.js defines onGateUnlocked, so finish() must
  // leave a pending flag and app.js must drain it, or the warm-boot unlock hydrate (P111) is silently lost.
  ck("G6 a warm-boot unlock is never lost: gate leaves __gateUnlockedPending and app.js drains it", () => {
    assert(/__gateUnlockedPending = true/.test(GATE), "gate.js finish() does not record a pending unlock");
    assert(/__gateUnlockedPending\b[\s\S]{0,120}onGateUnlocked\(\)/.test(APP), "app.js does not drain the pending unlock");
  });
  // P48 device instrument (the one temporary diagnostic kept until a device photo shows token:ok): signIn
  // sets the token:sent and token:ok strip marks. These are weightless window assignments, no request change.
  ck("G7 signIn sets the token:sent and token:ok strip marks (the kept device instrument)", () => {
    assert(/__signMark = "token:sent"/.test(SUPA_SRC), "token:sent mark missing from signIn");
    assert(/__signMark = "token:ok"/.test(SUPA_SRC), "token:ok mark missing from signIn");
  });

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
