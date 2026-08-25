/* BARE_GATE contract (brief P54), Node.

   BARE_GATE promotes the device-proven authtest path into a STANDALONE gate.html that owns the entire auth
   path with nothing from the console bundle loaded during it, and turns the root index.html into a
   session-aware router that carries the session across the gate.html -> index.html navigation through the
   storage mirror, with one silent token refresh as the storage-blocked fallback.

   Runtime (the REAL gate.html script, run in a vm sandbox against a controllable fetch):
   - signIn RETURNS the parsed session; the request shape is the frozen one (apikey + Content-Type only, NO
     Authorization, cache no-store, and a BARE fetch with no abort signal).
   - a 200 with an empty body gets ONE automatic identical retry after ~400ms; still-empty fails typed
     "empty"; an unparsable 200 fails typed "parse"; a BOM body parses; a tokenless 200 fails typed "auth".
   - window.__lastTokenDiag records the SHAPE (has_access_token boolean, redacted body_head), never a token.
   - the operator submit, on success, sets window.__memSession AND writes the localStorage mirror
     (console_sb_session + presence) and navigates to index.html?warm=1.

   Source contracts:
   - gate.html reads the token body via arrayBuffer + TextDecoder + BOM strip, bounded by a setTimeout race,
     with no AbortController; it loads NONE of the console bundle; no empty catch; EN + AR strings.
   - the root index router (tools/bundle.js + the generated index.html) is session-aware: warm -> console,
     no session -> gate.html, expired -> one bounded refresh (frozen shape) then console-or-gate.

   Fails-when-broken: adding "Authorization" to the gate.html token headers reds B2; dropping the 400ms
   retry reds B3/B4; binding index to console unconditionally (removing the toGate branch) reds S5. */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const GATE_HTML = fs.readFileSync(path.join(ROOT, "gate.html"), "utf8");
const BUNDLE = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + ((e && e.message) || e)); } }

function scriptOf(html) { const m = html.match(/<script>([\s\S]*?)<\/script>/); if (!m) throw new Error("no <script> found"); return m[1]; }
const GATE_JS = scriptOf(GATE_HTML);

/* A minimal but faithful DOM + platform stub, enough for the real gate.html script to load and for its
   auth path to run. getElementById auto-registers elements so dynamically injected inputs (pc/em/pw) resolve. */
function makeStore(block) {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (block) throw new Error("QuotaExceeded: storage blocked"); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }, has: k => m.has(k), _map: m };
}
function makeEl() {
  return { textContent: "", innerHTML: "", hidden: false, value: "", disabled: false,
    onsubmit: null, onclick: null,
    focus() {}, setAttribute() {}, addEventListener() {},
    classList: { add() {}, remove() {} } };
}
function makeSandbox(store, fetchImpl) {
  const els = {};
  const document = {
    getElementById: id => (els[id] || (els[id] = makeEl())),
    addEventListener() {}
  };
  const location = { _calls: [], assign(u) { this._calls.push(u); }, replace(u) { this._calls.push(u); }, set href(u) { this._calls.push(u); }, get href() { return ""; } };
  const sandbox = {
    document, localStorage: store, fetch: fetchImpl, location,
    setTimeout, clearTimeout, TextEncoder, TextDecoder,
    console: { log() {} }, _els: els
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GATE_JS, sandbox, { filename: "gate.html" });
  return sandbox;
}
function res(status, text) {
  const t = String(text);
  return { ok: status >= 200 && status < 300, status: status, statusText: "S",
    text: async () => t, arrayBuffer: async () => new TextEncoder().encode(t).buffer };
}
const GOOD = JSON.stringify({ access_token: "tok-9", refresh_token: "ref-9", expires_at: 9999999999, user: { id: "u9" } });

(async function () {
  // B1: signIn returns the parsed session.
  await (async () => {
    const sb = makeSandbox(makeStore(false), async () => res(200, GOOD));
    const s = await sb.signIn("op@t.test", "pw");
    ck("B1 signIn RETURNS the parsed session (access/refresh/expiry present)", () => {
      assert(s && s.access_token === "tok-9" && s.refresh_token === "ref-9" && s.expires_at === 9999999999, JSON.stringify(s));
    });
  })();

  // B2: the frozen request shape (apikey + Content-Type only, NO Authorization, cache no-store, no signal).
  await (async () => {
    let seen = null;
    const sb = makeSandbox(makeStore(false), async (url, opts) => { seen = { url: String(url), opts: opts }; return res(200, GOOD); });
    await sb.signIn("op@t.test", "pw");
    ck("B2 the frozen request shape: apikey + Content-Type, no Authorization, cache no-store, no abort signal", () => {
      assert(/\/auth\/v1\/token\?grant_type=password/.test(seen.url), "wrong endpoint: " + seen.url);
      assert(seen.opts.method === "POST", "not a POST");
      const h = seen.opts.headers || {};
      assert(h.apikey && h["Content-Type"] === "application/json", "header shape wrong: " + JSON.stringify(h));
      assert(!("Authorization" in h), "Authorization must NOT be sent on the token call");
      assert(seen.opts.cache === "no-store", "cache no-store missing");
      assert(!("signal" in seen.opts), "the token fetch must carry no abort signal");
    });
  })();

  // B3: an empty 200 body is retried ONCE after ~400ms and the retry signs in.
  await (async () => {
    let n = 0; const times = [];
    const sb = makeSandbox(makeStore(false), async () => { n++; times.push(Date.now()); return n === 1 ? res(200, "") : res(200, GOOD); });
    const s = await sb.signIn("op@t.test", "pw");
    ck("B3 an empty 200 body is retried once (~400ms later) and the retry signs in", () => {
      assert(n === 2, "expected exactly 2 token POSTs, got " + n);
      assert(times[1] - times[0] >= 350, "retry fired too early: " + (times[1] - times[0]) + "ms");
      assert(s && s.access_token === "tok-9", "the retry did not sign in");
    });
  })();

  // B4: empty twice -> typed "empty", after exactly 2 attempts (never a loop).
  await (async () => {
    let n = 0;
    const sb = makeSandbox(makeStore(false), async () => { n++; return res(200, ""); });
    let caught = null; try { await sb.signIn("op@t.test", "pw"); } catch (e) { caught = e; }
    ck("B4 a still-empty retry fails typed 'empty' after exactly 2 attempts", () => {
      assert(n === 2, "expected exactly 2 attempts, got " + n);
      assert(caught && caught.kind === "empty", "kind was: " + (caught && caught.kind));
    });
  })();

  // B5: an unparsable 200 body -> typed "parse".
  await (async () => {
    const sb = makeSandbox(makeStore(false), async () => res(200, "<!DOCTYPE html><p>hi</p>"));
    let caught = null; try { await sb.signIn("op@t.test", "pw"); } catch (e) { caught = e; }
    ck("B5 an unparsable 200 body fails typed 'parse'", () => { assert(caught && caught.kind === "parse", "kind was: " + (caught && caught.kind)); });
  })();

  // B6: a BOM-prefixed 200 body parses and signs in.
  await (async () => {
    const sb = makeSandbox(makeStore(false), async () => res(200, "﻿" + GOOD));
    const s = await sb.signIn("op@t.test", "pw");
    ck("B6 a BOM-prefixed body is stripped and parsed (sign-in succeeds)", () => { assert(s && s.access_token === "tok-9", "BOM body did not sign in"); });
  })();

  // B7: a tokenless 200 object -> typed "auth" with the body's message; a 5xx -> "unavailable".
  await (async () => {
    const sb = makeSandbox(makeStore(false), async () => res(200, JSON.stringify({ msg: "verification required" })));
    let caught = null; try { await sb.signIn("op@t.test", "pw"); } catch (e) { caught = e; }
    const sb2 = makeSandbox(makeStore(false), async () => res(503, JSON.stringify({ message: "paused" })));
    let c2 = null; try { await sb2.signIn("op@t.test", "pw"); } catch (e) { c2 = e; }
    ck("B7 a tokenless 200 fails typed 'auth' (body message); a 5xx fails typed 'unavailable'", () => {
      assert(caught && caught.kind === "auth" && /verification required/.test(caught.message), "auth case: " + (caught && caught.kind + " / " + caught.message));
      assert(c2 && c2.kind === "unavailable", "5xx case kind was: " + (c2 && c2.kind));
    });
  })();

  // B8: window.__lastTokenDiag records the SHAPE only (has_access_token boolean, redacted body_head, no token).
  await (async () => {
    const sb = makeSandbox(makeStore(false), async () => res(200, GOOD));
    await sb.signIn("op@t.test", "pw");
    ck("B8 __lastTokenDiag records the shape (has_access_token boolean, redacted body_head, NO token value)", () => {
      const d = sb.__lastTokenDiag;
      assert(d && d.has_access_token === true && typeof d.text_length === "number", "diag missing fields: " + JSON.stringify(d));
      assert(d.body_head.indexOf("tok-9") < 0 && d.body_head.indexOf("ref-9") < 0, "body_head leaked a token: " + d.body_head);
      assert(JSON.stringify(d).indexOf("tok-9") < 0, "the diag object leaked a token value");
    });
  })();

  // B9: the operator submit, on success, sets window.__memSession AND writes the mirror, then navigates to
  //     index.html?warm=1 (the cross-navigation carrier).
  await (async () => {
    const store = makeStore(false);
    const sb = makeSandbox(store, async () => res(200, GOOD));
    sb.showOperator();
    sb._els.em.value = "op@t.test"; sb._els.pw.value = "pw";
    sb.form.onsubmit({ preventDefault() {} });
    await new Promise(r => setTimeout(r, 120));
    ck("B9 a successful operator submit sets __memSession + the mirror and navigates to index.html?warm=1", () => {
      assert(sb.__memSession && sb.__memSession.access_token === "tok-9", "window.__memSession not set");
      const mirror = store.getItem("console_sb_session");
      assert(mirror && JSON.parse(mirror).access_token === "tok-9", "session mirror not written");
      assert(store.getItem("thrive_presence"), "presence mirror not written");
      assert(sb.location._calls.some(u => /index\.html\?warm=1/.test(u)), "did not navigate to index.html?warm=1: " + JSON.stringify(sb.location._calls));
    });
  })();

  // B10: a blocked-storage success surfaces a VISIBLE error (never a silent swallow) and does NOT navigate.
  await (async () => {
    const sb = makeSandbox(makeStore(true), async () => res(200, GOOD));
    sb.showOperator();
    sb._els.em.value = "op@t.test"; sb._els.pw.value = "pw";
    sb.form.onsubmit({ preventDefault() {} });
    await new Promise(r => setTimeout(r, 120));
    ck("B10 a mirror write failure is shown (visible diag) and does NOT navigate (never a silent swallow)", () => {
      assert(sb._els.err.hidden === false && sb._els.err.textContent, "no visible error on mirror failure");
      assert(!sb.location._calls.some(u => /index\.html/.test(u)), "navigated despite a failed mirror write");
    });
  })();

  // ---- source contracts -------------------------------------------------------------------------
  ck("S1 gate.html reads the token body via arrayBuffer + TextDecoder + BOM strip, bounded by a setTimeout race, with no abort signal attached to the fetch", () => {
    assert(/res\.arrayBuffer\(\)/.test(GATE_JS) && /new TextDecoder\("utf-8"\)/.test(GATE_JS), "explicit body read missing");
    assert(/charCodeAt\(0\) === 0xFEFF/.test(GATE_JS), "BOM strip missing");
    assert(/Promise\.race\(\[run, timer\]\)/.test(GATE_JS), "the setTimeout race bound is missing");
    // No abort signal is ATTACHED to the fetch (a comment may name AbortController; real code must not use it).
    assert(!/\.signal\s*=/.test(GATE_JS) && GATE_JS.indexOf("newAbort") < 0 && GATE_JS.indexOf("new AbortController") < 0, "gate.html attaches an abort signal to the token fetch");
  });
  ck("S2 gate.html binds success to signIn's return value, writes memory + mirror + presence, and navigates to index.html?warm=1; a mirror failure is visible", () => {
    assert(/sess = await signIn\(m, p\)/.test(GATE_JS), "does not await signIn's return value");
    assert(/ok = !!\(sess && sess\.access_token\)/.test(GATE_JS), "success not bound to the returned session");
    assert(/window\.__memSession = sess/.test(GATE_JS), "memory session not set");
    assert(/localStorage\.setItem\(SESSION_KEY, JSON\.stringify\(sess\)\)/.test(GATE_JS), "session mirror not written");
    assert(/location\.assign\("index\.html\?warm=1"\)/.test(GATE_JS), "does not navigate to index.html?warm=1");
    assert(/if\(!mirrored\)\{ showErr/.test(GATE_JS), "a mirror write failure is not surfaced visibly");
  });
  ck("S3 gate.html loads NONE of the console bundle (no external script; no console global invoked)", () => {
    // The design principle: one file owns the whole auth path with nothing from the bundle loaded during it.
    // Proven by there being no external <script src> (a head comment may name modules; nothing LOADS them),
    // and by no console runtime global being invoked from the gate.
    assert(!/<script[^>]+src=/i.test(GATE_HTML), "gate.html loads an external script");
    ["ThriveSupa", "initBoard", "renderBoard", "onGateUnlocked", "ThriveModel", "logActivity"].forEach(function (g) {
      assert(GATE_JS.indexOf(g) < 0, "gate.html invokes a console runtime global: " + g);
    });
  });
  ck("S4 no empty catch in gate.html and no em dash", () => {
    assert((GATE_JS.match(/catch\s*\((?:e|ex|x|e2)\)\s*\{\s*\}/g) || []).length === 0, "empty catch remains in gate.html");
    assert(GATE_HTML.indexOf(String.fromCharCode(0x2014)) < 0, "em dash in gate.html");
  });
  ck("S5 the root index router is session-aware: warm -> console, no session -> gate.html, expired -> refresh then console-or-gate", () => {
    // asserted on the GENERATED index.html (what actually ships) and on the bundle.js template (the source).
    [INDEX, BUNDLE].forEach(function (src, i) {
      const where = i === 0 ? "index.html" : "bundle.js";
      assert(/if\(warm\)\{ toConsole\(\); return; \}/.test(src), where + ": warm path missing");
      assert(/if\(!sess\|\|!sess\.access_token\)\{ toGate\(\); return; \}/.test(src), where + ": no-session bounce to gate missing");
      assert(/if\(!expired\(sess\)\)\{ toConsole\(\); return; \}/.test(src), where + ": live-session forward missing");
      assert(/grant_type=refresh_token/.test(src), where + ": the silent refresh is missing");
      assert(/function toGate\(\)\{ location\.replace\("gate\.html"\); \}/.test(src), where + ": toGate does not target gate.html");
    });
  });
  ck("S6 the index refresh uses the frozen shape (apikey + Content-Type, cache no-store) and the explicit body read", () => {
    [INDEX, BUNDLE].forEach(function (src, i) {
      const where = i === 0 ? "index.html" : "bundle.js";
      assert(/"apikey":ANON,"Content-Type":"application\/json"/.test(src), where + ": refresh header shape wrong");
      assert(/cache:"no-store"/.test(src), where + ": refresh cache no-store missing");
      assert(src.indexOf("Authorization") < 0, where + ": the router must not send Authorization");
      assert(/arrayBuffer/.test(src) && /TextDecoder/.test(src), where + ": explicit body read missing in the refresh");
    });
  });
  ck("S7 gate.html carries the existing gate strings in BOTH locales (en + ar)", () => {
    assert(/en:\s*\{/.test(GATE_JS) && /ar:\s*\{/.test(GATE_JS), "both locales not present");
    ["op_err_empty", "op_err_parse", "err_secure", "op_busy"].forEach(function (k) {
      assert((GATE_JS.match(new RegExp(k + ":", "g")) || []).length === 2, k + " not in both locales");
    });
  });

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
