/* GATE_V2 contract (Node): the gate authentication contract, device-proven path.

   Runtime (real library/supabase.js against a controllable fetch):
   - signIn RETURNS the parsed session; success never depends on storage.
   - blocked storage: the memory session holds, signedIn() true, mirror failure recorded (sessionDiag).
   - a 200 with an empty body gets ONE automatic identical retry after 400ms; still-empty fails typed
     "empty" (visible as its own error, never a generic auth error).
   - a 200 body that is not JSON fails typed "parse"; a BOM-prefixed body parses.
   - a 200 JSON object without an access_token is a typed "auth" failure.

   Source contracts:
   - the gate binds success to signIn's return value (never signedIn()/storage read-back) and finish
     receives the session.
   - no empty catch anywhere in gate.js; the passcode step surfaces a crypto failure as "secure context
     required", never "wrong passcode".
   - presence is memory-first (the passcode loop cure); STR carries the new failure strings EN + AR.
   - Part 5: no relay call during the gate phase (autoSyncTick + scheduleSyncPush hold on __gateRevealed,
     which reveal() sets).
   - the frozen request shape is untouched (apikey + JSON, no Authorization, cache no-store, no signal). */
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const SUPA = path.join(ROOT, "library/supabase.js");
const GATE = fs.readFileSync(path.join(ROOT, "library/gate.js"), "utf8");
const APP = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");
const SUPASRC = fs.readFileSync(SUPA, "utf8");

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + (e && e.message || e)); } }

function makeStore(block) {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (block) throw new Error("QuotaExceeded: storage blocked"); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    has: k => m.has(k) };
}
function res200(text) {
  const t = String(text);
  return { ok: true, status: 200, statusText: "OK",
    text: async () => t,
    arrayBuffer: async () => new TextEncoder().encode(t).buffer };
}
function loadSupa(store, fetchImpl) {
  const win = { THRIVE_CONFIG: { supaUrl: "https://x.supabase.co", supaAnon: "anon-k" } };
  global.window = win; global.localStorage = store; global.THRIVE_CONFIG = win.THRIVE_CONFIG;
  global.AbortController = function () { this.signal = {}; this.abort = function () {}; };
  global.fetch = fetchImpl;
  delete require.cache[SUPA];
  require(SUPA);
  return win;
}
const GOOD = JSON.stringify({ access_token: "tok-9", refresh_token: "ref-9", expires_at: 9999999999, user: { id: "u9" } });

(async function () {
  // V1: signIn returns the parsed session.
  await (async () => {
    const win = loadSupa(makeStore(false), async () => res200(GOOD));
    const s = await win.ThriveSupa.signIn("op@t.test", "pw");
    ck("V1 signIn RETURNS the parsed session (access/refresh/expiry present)", () => {
      assert(s && s.access_token === "tok-9" && s.refresh_token === "ref-9" && s.expires_at === 9999999999, JSON.stringify(s));
    });
  })();

  // V2: blocked storage: memory session holds; mirror failure recorded; reads carry the session bearer.
  await (async () => {
    const calls = [];
    const win = loadSupa(makeStore(true), async (url, opts) => { calls.push({ url: String(url), headers: (opts && opts.headers) || {} }); return res200(String(url).indexOf("/auth/") >= 0 ? GOOD : "[]"); });
    const s = await win.ThriveSupa.signIn("op@t.test", "pw");
    await win.ThriveSupa.rest("console_board", { query: "select=slug" });
    ck("V2 blocked storage: session returned, memory holds, mirror failure recorded, reads carry the session bearer", () => {
      assert(s && s.access_token === "tok-9", "no session returned");
      assert(win.ThriveSupa.signedIn() === true, "memory session not held");
      const d = win.ThriveSupa.sessionDiag();
      assert(d.mem === true && d.mirrorOk === false, "sessionDiag wrong: " + JSON.stringify(d));
      const last = calls[calls.length - 1];
      assert(last.headers.Authorization === "Bearer tok-9", "read did not carry the session bearer: " + JSON.stringify(last.headers));
    });
  })();

  // V3: empty 200 body -> ONE automatic retry after ~400ms; retry succeeds -> sign-in succeeds.
  await (async () => {
    let n = 0; const times = [];
    const win = loadSupa(makeStore(false), async () => { n++; times.push(Date.now()); return n === 1 ? res200("") : res200(GOOD); });
    const s = await win.ThriveSupa.signIn("op@t.test", "pw");
    ck("V3 an empty 200 body is retried once (identical shape, ~400ms later) and the retry signs in", () => {
      assert(n === 2, "expected exactly 2 token POSTs, got " + n);
      assert(times[1] - times[0] >= 350, "retry fired too early: " + (times[1] - times[0]) + "ms");
      assert(s && s.access_token === "tok-9", "the retry did not sign in");
    });
  })();

  // V4: empty twice -> typed "empty", named message, and exactly 2 attempts (never a loop).
  await (async () => {
    let n = 0;
    const win = loadSupa(makeStore(false), async () => { n++; return res200(""); });
    let caught = null;
    try { await win.ThriveSupa.signIn("op@t.test", "pw"); } catch (e) { caught = e; }
    ck("V4 a still-empty retry fails typed 'empty' with the named message, after exactly 2 attempts", () => {
      assert(n === 2, "expected exactly 2 attempts, got " + n);
      assert(caught && caught.kind === "empty", "kind was: " + (caught && caught.kind));
      assert(/empty response body/.test(caught.message), "message was: " + (caught && caught.message));
    });
  })();

  // V5: a 200 body that is not JSON -> typed "parse".
  await (async () => {
    const win = loadSupa(makeStore(false), async () => res200("<!DOCTYPE html><p>sign in</p>"));
    let caught = null;
    try { await win.ThriveSupa.signIn("op@t.test", "pw"); } catch (e) { caught = e; }
    ck("V5 an unparsable 200 body fails typed 'parse' (never a generic auth error)", () => {
      assert(caught && caught.kind === "parse", "kind was: " + (caught && caught.kind));
    });
  })();

  // V6: a BOM-prefixed 200 body parses and signs in.
  await (async () => {
    const win = loadSupa(makeStore(false), async () => res200("﻿" + GOOD));
    const s = await win.ThriveSupa.signIn("op@t.test", "pw");
    ck("V6 a BOM-prefixed body is stripped and parsed (sign-in succeeds)", () => {
      assert(s && s.access_token === "tok-9", "BOM body did not sign in");
    });
  })();

  // V7: a 200 JSON object WITHOUT an access_token is a typed auth failure carrying the body's message.
  await (async () => {
    const win = loadSupa(makeStore(false), async () => res200(JSON.stringify({ msg: "verification required" })));
    let caught = null;
    try { await win.ThriveSupa.signIn("op@t.test", "pw"); } catch (e) { caught = e; }
    ck("V7 a tokenless 200 object fails typed 'auth' with the body's own message", () => {
      assert(caught && caught.kind === "auth", "kind was: " + (caught && caught.kind));
      assert(/verification required/.test(caught.message), "message was: " + (caught && caught.message));
    });
  })();

  // ---- source contracts -------------------------------------------------------------------------
  ck("C1 the gate binds success to signIn's RETURN VALUE and hands the session to finish(sess)", () => {
    assert(/sess = await S\.signIn\(m, p, \{ fresh: !!fresh \}\);/.test(GATE), "returned-session await missing");
    assert(/ok = !!\(sess && sess\.access_token\)/.test(GATE), "success not bound to the returned session");
    assert(/finish\(sess\);/.test(GATE), "finish does not receive the session");
    assert(!/ok = S\.signedIn/.test(GATE), "success still bound to a storage read-back");
  });
  ck("C2 no empty catch anywhere in gate.js (every failure lands in the gnote ring)", () => {
    assert((GATE.match(/catch \((e|ex|x)\) \{\}/g) || []).length === 0, "empty catches remain");
    assert(/function gnote\(tag, e\)/.test(GATE), "the gnote ring is missing");
  });
  ck("C3 a crypto failure surfaces 'secure context required', never 'wrong passcode', and is not throttled", () => {
    assert(/crypto\.subtle unavailable \(secure context required\)/.test(GATE), "the named crypto guard is missing");
    assert(/if \(cryptoErr\) \{[\s\S]{0,400}err\.textContent = s\.err_secure;/.test(GATE), "the passcode step does not surface err_secure");
    const block = GATE.slice(GATE.indexOf("if (cryptoErr) {"), GATE.indexOf("if (h === HASH) {"));
    assert(block.indexOf("recordFail") < 0, "a crypto failure is throttled as a wrong passcode");
  });
  ck("C4 presence is memory-first (the passcode-loop cure): markPresent sets the memory stamp, idleMs reads it first", () => {
    assert(/var __memPresence = 0;/.test(GATE), "no memory presence stamp");
    assert(/__memPresence = Date\.now\(\);/.test(GATE), "markPresent does not set the memory stamp");
    assert(/var at = __memPresence \|\| 0;/.test(GATE), "idleMs does not consult the memory stamp first");
  });
  ck("C5 clearOperatorSession clears the MEMORY session too (clearSession), not only the mirror", () => {
    assert(/S\.clearSession\) S\.clearSession\(\);/.test(GATE), "the memory session is not cleared");
    assert(/clearSession: function \(\) \{ setSession\(null\); \}/.test(SUPASRC), "supabase.js does not export clearSession");
  });
  ck("C6 STR carries the distinct failure strings in BOTH locales (empty / parse / secure)", () => {
    assert((GATE.match(/op_err_empty:/g) || []).length === 2, "op_err_empty not in both locales");
    assert((GATE.match(/op_err_parse:/g) || []).length === 2, "op_err_parse not in both locales");
    assert((GATE.match(/err_secure:/g) || []).length === 2, "err_secure not in both locales");
    assert(/kind === "empty" \? s\.op_err_empty : s\.op_err_parse/.test(GATE), "the gate does not surface the distinct strings");
  });
  ck("C7 Part 5: the gate phase is silent (autoSyncTick + scheduleSyncPush hold on __gateRevealed, and since P55 also on __boardPainted; reveal sets it)", () => {
    const tick = APP.slice(APP.indexOf("function autoSyncTick(){"), APP.indexOf("function autoSyncTick(){") + 500);
    assert(/if\(!window\.__gateRevealed( \|\| !window\.__boardPainted)?\) return;/.test(tick), "autoSyncTick does not hold on the reveal flag");
    const push = APP.slice(APP.indexOf("function scheduleSyncPush(){"), APP.indexOf("function scheduleSyncPush(){") + 400);
    assert(/if\(!window\.__gateRevealed( \|\| !window\.__boardPainted)?\) return;/.test(push), "scheduleSyncPush does not hold on the reveal flag");
    assert(/window\.__gateRevealed = true;/.test(GATE), "reveal() does not set the flag");
  });
  ck("C8 the frozen request shape is untouched (apikey + JSON, no Authorization, cache no-store, no signal on the token call)", () => {
    assert(/headers: \{ "apikey": c\.anon, "Content-Type": "application\/json" \}/.test(SUPASRC), "header shape changed");
    assert(/cache: "no-store"/.test(SUPASRC), "cache no-store dropped");
    const afo = SUPASRC.slice(SUPASRC.indexOf("async function authFetchOnce"), SUPASRC.indexOf("async function authFetchOnce") + 1600);
    assert(afo.indexOf("o.signal") < 0 && afo.indexOf("newAbort") < 0, "the token fetch attaches an abort signal again");
    assert(/arrayBuffer/.test(afo) && /TextDecoder/.test(afo) && /charCodeAt\(0\) === 0xFEFF/.test(afo), "the explicit body read (arrayBuffer + BOM strip) is missing");
  });
  ck("C9 the token-shape instrument is permanent (body_head, redaction) and the diag prints the gate-state block", () => {
    assert(/body_head: redactBody\(text\)\.slice\(0, 40\)/.test(SUPASRC), "body_head capture missing");
    assert(/gate step: /.test(APP) && /memSession: /.test(APP) && /presence mirror ok: /.test(APP), "the diag gate-state block is missing");
    assert(/sessionDiag: function \(\) \{ return \{ mem: !!__memSession, mirrorOk: __mirrorOk \}; \}/.test(SUPASRC), "sessionDiag export missing");
  });
  ck("C10 no em dash in the changed sources", () => {
    assert(GATE.indexOf("—") < 0 && SUPASRC.indexOf("—") < 0, "em dash found");
  });

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
