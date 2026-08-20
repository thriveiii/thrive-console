/* P29 sign-in resilience test (Node, no browser).

   Proves the auth + read path is BOUNDED and fails loud, never hangs:
   - Part A lifts the REAL library/supabase.js into a vm sandbox with a controllable fetch and shrunk
     timers, and drives signIn / rest / refresh / getSession through a stalled call, a bad credential, a
     down service, and a healthy service, asserting each REJECTS with a typed error (or resolves) rather
     than awaiting forever.
   - Part B/C/D are source-structure assertions on supabase.js, gate.js, and the shipped bundle: every
     network call goes through the bounded wrapper; the "Signing in" button is always released and a
     transient failure is never throttled; and the 20s boot watchdog is present with a Retry / Sign out
     exit. */
const vm = require("vm"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const supaSrc = fs.readFileSync(path.join(ROOT, "library", "supabase.js"), "utf8");
const gateSrc = fs.readFileSync(path.join(ROOT, "library", "gate.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
const bundleSrc = fs.readFileSync(path.join(ROOT, "library", "console.html"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  if (cond) { console.log("PASS " + name); }
  else { fails++; console.log("FAIL " + name); if (detail !== undefined) console.log("     " + JSON.stringify(detail)); }
}

// ---- a sandbox that runs the REAL supabase.js with a controllable fetch and fast timers -------------
function makeEnv(fetchImpl, seed) {
  const store = Object.assign({ console_sb_url: "https://example.supabase.co", console_sb_anon: "anon-key" }, seed || {});
  const localStorage = {
    getItem: (k) => (k in store) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const win = {};
  const sandbox = {
    window: win, fetch: fetchImpl, AbortController: AbortController, localStorage: localStorage,
    console: console, JSON: JSON, encodeURIComponent: encodeURIComponent, TextEncoder: TextEncoder,
    // Shrink the 15s bound so a timeout test resolves in milliseconds, not seconds. A real request
    // (Promise.resolve) still wins the race; only a hung request reaches the (shrunk) abort.
    setTimeout: (fn, ms) => setTimeout(fn, ms > 50 ? 5 : ms), clearTimeout: clearTimeout,
    Date: Date, Object: Object, Array: Array, Error: Error, Promise: Promise, String: String, Number: Number
  };
  vm.createContext(sandbox);
  vm.runInContext(supaSrc, sandbox);
  return { S: win.ThriveSupa, store };
}
// a fetch that never resolves on its own; rejects with a real AbortError when its signal aborts
function hangingFetch() {
  return function (url, opts) {
    return new Promise(function (resolve, reject) {
      if (opts && opts.signal) opts.signal.addEventListener("abort", function () { var e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    });
  };
}
function makeRes(status, body) {
  const text = (typeof body === "string") ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status: status, text: () => Promise.resolve(text) };
}
function replyFetch(status, body) { return function () { return Promise.resolve(makeRes(status, body)); }; }
// A fetch that NEVER settles and IGNORES the abort signal entirely: the Safari signature the device saw,
// where AbortController.abort() does not reject the promise. Only the setTimeout race can bound this.
function deadFetch() { return function () { return new Promise(function () {}); }; }
// A fetch that records the (url, opts) it was called with, then replies.
function captureFetch(status, body) {
  const calls = [];
  const fn = function (url, opts) { calls.push({ url: url, opts: opts }); return Promise.resolve(makeRes(status, body)); };
  fn.calls = calls;
  return fn;
}

async function partA() {
  // A1/A2: a stalled auth POST REJECTS with a typed timeout, never hangs.
  {
    const { S } = makeEnv(hangingFetch());
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("A1 signIn REJECTS on a stalled auth call (never hangs)", !!caught);
    ck("A2 the rejection is typed as a timeout (err.kind === 'timeout')", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind, msg: caught.message });
  }
  // A3: a 400 (wrong credentials) is typed as auth, not a timeout.
  {
    const { S } = makeEnv(replyFetch(400, { error_description: "Invalid login credentials" }));
    let caught = null;
    try { await S.signIn("a@b.com", "bad"); } catch (e) { caught = e; }
    ck("A3 a 400 is a credential rejection (err.kind === 'auth')", !!(caught && caught.kind === "auth" && caught.status === 400), caught && { kind: caught.kind, status: caught.status });
  }
  // A4: a 503 (paused / down project) is typed as unavailable, so the gate can say so.
  {
    const { S } = makeEnv(replyFetch(503, { message: "service unavailable" }));
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("A4 a 5xx is the service being unavailable (err.kind === 'unavailable')", !!(caught && caught.kind === "unavailable"), caught && { kind: caught.kind, status: caught.status });
  }
  // A5: a healthy service signs in and stores the session.
  {
    const { S, store } = makeEnv(replyFetch(200, { access_token: "tok", refresh_token: "ref", expires_at: 9999999999, user: { id: "u1" } }));
    let ok = false, threw = false;
    try { const r = await S.signIn("a@b.com", "pw"); ok = !!(r && r.ok); } catch (e) { threw = true; }
    ck("A5 a healthy service signs in normally (no timeout, no throw)", ok && !threw);
    ck("A5b the session is stored on success", !!store["console_sb_session"] && S.signedIn() === true);
  }
  // A6: a stalled REST read REJECTS (bounded), so a board settle awaiting it degrades instead of hanging.
  {
    const { S } = makeEnv(hangingFetch());
    let caught = null;
    try { await S.rest("console_board", { query: "select=slug" }); } catch (e) { caught = e; }
    ck("A6 a stalled rest() read REJECTS with a timeout (the board never awaits forever)", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind });
  }
  // A7: refresh clears the session on a definitive 400 (invalid refresh token).
  {
    const { S, store } = makeEnv(replyFetch(400, { error: "invalid_grant" }), { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r", expires_at: 1 }) });
    const r = await S.refresh();
    ck("A7 refresh returns false on a definitive rejection", r === false);
    ck("A7b and clears the stale session (a corrupt token cannot persist)", !store["console_sb_session"]);
  }
  // A8: getSession heals an expired-but-refreshable token (returns true, updates the session).
  {
    const { S, store } = makeEnv(replyFetch(200, { access_token: "new", refresh_token: "r2", expires_at: 9999999999 }), { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: 1 }) });
    const good = await S.getSession();
    ck("A8 getSession heals an expired-but-refreshable token (true)", good === true);
    ck("A8b the stored token is the refreshed one", (JSON.parse(store["console_sb_session"] || "{}").access_token) === "new");
  }
  // A9: getSession on a hung refresh returns false (not usable now) rather than hanging.
  {
    const { S } = makeEnv(hangingFetch(), { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r", expires_at: 1 }) });
    const good = await S.getSession();
    ck("A9 getSession returns false on a hung refresh (never hangs)", good === false);
  }
  // A10: getSession with no session is a clean false.
  {
    const { S } = makeEnv(replyFetch(200, {}));
    const good = await S.getSession();
    ck("A10 getSession with no stored session is a clean false", good === false);
  }
}

function partB() {
  // Every network call in supabase.js goes through the bounded wrapper: the ONLY bare fetch( calls are the
  // two inside the fetchJSON / fetchT helpers themselves.
  const bare = (supaSrc.match(/\bfetch\(/g) || []).length;
  ck("B1 the only bare fetch() calls are the 2 timeout wrappers (all else is bounded)", bare === 2, { bare: bare });
  ck("B2 signIn uses the bounded fetchJSON", /async function signIn[\s\S]*?fetchJSON\(/.test(supaSrc));
  ck("B3 refresh uses the bounded fetchJSON", /async function refresh[\s\S]*?fetchJSON\(/.test(supaSrc));
  ck("B4 rest uses the bounded fetchJSON", /async function rest[\s\S]*?fetchJSON\(/.test(supaSrc));
  ck("B5 signOut uses the bounded fetchT", /async function signOut[\s\S]*?fetchT\(/.test(supaSrc));
  ck("B6 uploadAttachment uses the bounded fetchT", /async function uploadAttachment[\s\S]*?fetchT\(/.test(supaSrc));
  ck("B7 a stated default timeout constant exists (15s)", /FETCH_TIMEOUT_MS\s*=\s*15000/.test(supaSrc));
  ck("B8 the bound is enforced with an AbortController", /new AbortController\(\)/.test(supaSrc) && /\.abort\(\)/.test(supaSrc));
  ck("B9 a timeout produces a typed error (kind:'timeout')", /kind\s*=\s*"timeout"/.test(supaSrc));
  ck("B10 getSession is exported for the boot self-heal", /getSession:\s*getSession/.test(supaSrc));
}

function partC() {
  // gate.js: specific messages, always-released button, no throttle on a transient failure, self-heal.
  ck("C1 EN carries the three specific reasons (timeout/network/unavailable)",
    /op_err_timeout:/.test(gateSrc) && /op_err_network:/.test(gateSrc) && /op_err_unavailable:/.test(gateSrc));
  ck("C2 AR carries the three specific reasons too",
    (gateSrc.match(/op_err_timeout:/g) || []).length >= 2 && (gateSrc.match(/op_err_unavailable:/g) || []).length >= 2);
  // The button is restored to op_go UNCONDITIONALLY (before the ok/else branches), so "Signing in" is never the last word.
  ck("C3 the button is released before branching (never a permanent spinner)",
    /btn\.textContent = s\.op_go;\s*\n(\s*DIAG\([^\n]*\);\s*\n)?\s*if \(ok\)/.test(gateSrc));
  // A transient kind shows its specific message and does NOT throttle (opRecordFail is only in the final else).
  ck("C4 a transient failure is branched apart and shows a specific reason",
    /else if \(kind === "timeout" \|\| kind === "network" \|\| kind === "unavailable"\)/.test(gateSrc));
  const transientBlock = gateSrc.slice(gateSrc.indexOf('else if (kind === "timeout"'), gateSrc.indexOf("} else {", gateSrc.indexOf('else if (kind === "timeout"')));
  ck("C5 the transient branch does NOT throttle the operator (no opRecordFail)", transientBlock.indexOf("opRecordFail") < 0);
  // Boot self-heal for an expired stored session.
  ck("C6 an expired stored token triggers a bounded self-heal", /sessionExpired\(\)\)\s*\{\s*healExpiredThenStart\(\)/.test(gateSrc));
  ck("C7 the self-heal reveals on success, else clears once and shows the sign-in card",
    /async function healExpiredThenStart[\s\S]*?getSession\(\)[\s\S]*?finish\(\)[\s\S]*?clearOperatorSession\(\)[\s\S]*?buildGate\("lobby"\)/.test(gateSrc));
  ck("C8 a shown gate card marks the boot as not-stuck (__thriveBooted)", /window\.__thriveBooted = true/.test(gateSrc));
  // Visible diagnostic: the raw error text is surfaced on the card, so a non-timeout reason is never hidden.
  ck("C9 the operator card has a diagnostic element (#gateDiag)", /id="gateDiag"/.test(gateSrc));
  ck("C10 the failure is a STRUCTURED copyable block (stage / http / elapsed), not a generic line (P35)",
    /function p35Block/.test(gateSrc) && /raw = p35Block\(ex, kind\)/.test(gateSrc) && /"stage: "/.test(gateSrc) && /"elapsed: "/.test(gateSrc) && /"http: "/.test(gateSrc));
  ck("C11 the raw diagnostic is shown on failure (showDiag(raw))", /showDiag\(raw\)/.test(gateSrc));
  ck("C12 the diagnostic writes textContent only (no markup injection)", /function showDiag[\s\S]*?diag\.textContent =/.test(gateSrc) && !/gateDiag[\s\S]{0,80}innerHTML/.test(gateSrc));
  // P35: the exact server answer is captured verbatim and the boot session decision is logged, so the
  // never-before-captured auth failure reason is revealed on device.
  ck("C13 boot logs the session-restore vs cold-auth decision (P35)",
    /function p35BootLine/.test(gateSrc) && /p35BootLine\(\);/.test(gateSrc) && /session-restore, NO auth call/.test(gateSrc) && /cold auth/.test(gateSrc));
  ck("C14 a visible diagnostic panel is wired to window.__DIAG (P35)",
    /window\.__DIAG = window\.__DIAG \|\| \{ log: p35log \}/.test(gateSrc) && /function ensureDiagPanel/.test(gateSrc));
  ck("C15 supabase.js threads a diag observer and attaches it to the thrown/failed error (P35)",
    /fetchJSON\(url, opts, ms, diag\)/.test(supaSrc) && /err\.diag = diag/.test(supaSrc) && /ex\.diag = diag/.test(supaSrc));
  ck("C16 fetchJSON records stage, HTTP status, and the non-2xx body into diag (P35)",
    /diag\.stage = "response-received"; diag\.status = res\.status/.test(supaSrc) && /diag\.body = String\(text/.test(supaSrc) && /diag\.stage = "fetch-rejected"/.test(supaSrc));
  ck("C17 the request itself is unchanged (still the P34 apikey header shape)",
    /"apikey": c\.anon, "Authorization": "Bearer " \+ c\.anon, "Content-Type": "application\/json"/.test(supaSrc));
}

function partD() {
  // The shipped bundle carries the 20s boot watchdog with a Retry / Sign out exit.
  ck("D1 the bundle has a boot watchdog gated on __thriveBooted", /if\(window\.__thriveBooted\)return;/.test(bundleSrc));
  ck("D2 it fires at a 20s bound", /\},20000\);/.test(bundleSrc));
  ck("D3 the watchdog offers Retry (reload)", /wdRetry[\s\S]*?location\.reload\(\)/.test(bundleSrc));
  ck("D4 the watchdog offers Sign out (clear session + reload)", /wdOut[\s\S]*?removeItem\('console_sb_session'\)[\s\S]*?location\.reload\(\)/.test(bundleSrc));
  ck("D5 the watchdog panel is bilingual (EN + AR)", /The console is taking too long\./.test(bundleSrc) && /يستغرق الكونسول/.test(bundleSrc));
  ck("D6 the board's first paint clears the watchdog (app.js render sets __thriveBooted)", /window\.__thriveBooted = true/.test(appSrc));
}

/* ============ Part E: P31 setTimeout race + fresh-connection retry ============ */
async function partE() {
  // E1 is the crux: a fetch that NEVER settles and IGNORES abort (the device's Safari signature) is still
  // bounded, because the setTimeout race rejects at the timeout independent of the AbortController.
  {
    const { S } = makeEnv(deadFetch());
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("E1 signIn REJECTS via the setTimeout race even when fetch never settles AND ignores abort", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind });
  }
  // E2/E3: a fresh retry opens a new connection (nonce + no-store), so a wedged socket is not reused.
  {
    const cf = captureFetch(200, { access_token: "t", refresh_token: "r", expires_at: 9999999999, user: { id: "u" } });
    const { S } = makeEnv(cf);
    await S.signIn("a@b.com", "pw", { fresh: true });
    ck("E2 a fresh retry appends a cache-busting nonce to the auth URL", !!(cf.calls[0] && /[?&]_ts=\d+/.test(cf.calls[0].url)), cf.calls[0] && cf.calls[0].url);
    ck("E3 the auth call sets cache:'no-store'", !!(cf.calls[0] && cf.calls[0].opts && cf.calls[0].opts.cache === "no-store"));
  }
  // E4: a normal (non-retry) sign-in still works and does NOT add a nonce.
  {
    const cf = captureFetch(200, { access_token: "t", refresh_token: "r", expires_at: 9999999999, user: { id: "u" } });
    const { S } = makeEnv(cf);
    await S.signIn("a@b.com", "pw");
    ck("E4 a normal sign-in does NOT add a nonce (only retry opens a fresh connection)", !!(cf.calls[0] && !/_ts=/.test(cf.calls[0].url)));
  }
  // E5: a stalled REST read that ignores abort is bounded by the race too.
  {
    const { S } = makeEnv(deadFetch());
    let caught = null;
    try { await S.rest("console_board", { query: "select=slug" }); } catch (e) { caught = e; }
    ck("E5 a stalled rest() that ignores abort is bounded by the race (typed timeout)", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind });
  }
  // E6/E7: source structure. The bound is a Promise.race against a setTimeout, and abort is still called.
  ck("E6 the bound is a setTimeout RACE, not AbortController alone", /raceTimeout/.test(supaSrc) && /Promise\.race\(\[/.test(supaSrc) && /setTimeout\(/.test(supaSrc));
  ck("E7 abort is still called on timeout to free the socket", /ac\.abort\(\)/.test(supaSrc));
  // E8: gate offers a one-tap Retry that re-attempts with fresh=true.
  ck("E8 the gate offers a one-tap Retry (fresh connection)", /id="gateRetry"/.test(gateSrc) && /attempt\(true\)/.test(gateSrc) && /op_retry/.test(gateSrc));
  ck("E9 signIn passes the fresh flag through to the connection", /S\.signIn\(m, p, \{ fresh:/.test(gateSrc) && /fresh \? \("&_ts="/.test(supaSrc));
}

/* ============ Part F: P34 standard auth request shape (apikey HEADER, not query-param) ============
   GoTrue's token endpoint rejects a header-less, query-param-only apikey with "Invalid API key" (proven on
   device). The accepted shape, sent by every other call and by the official client, is the apikey HEADER
   plus Authorization: Bearer <anon> and Content-Type: application/json. P35 changes NOTHING about this. */
async function partF() {
  // F1-F4: the sign-in request carries the apikey HEADER (+ Authorization Bearer + JSON), NOT a query apikey.
  {
    const cf = captureFetch(200, { access_token: "t", refresh_token: "r", expires_at: 9999999999, user: { id: "u" } });
    const { S } = makeEnv(cf);
    await S.signIn("a@b.com", "pw");
    const call = cf.calls[0] || {};
    const h = (call.opts && call.opts.headers) || {};
    ck("F1 the auth request sends the apikey HEADER (accepted shape, not query-only)", h["apikey"] === "anon-key", h);
    ck("F2 it also sends Authorization: Bearer <anon> and Content-Type application/json",
      h["Authorization"] === "Bearer anon-key" && String(h["Content-Type"] || "").indexOf("application/json") >= 0, h);
    ck("F3 the anon key is NOT in the query string (the header carries it)", !/[?&]apikey=/.test(call.url || ""), call.url);
    ck("F4 the token URL carries grant_type=password", /grant_type=password/.test(call.url || ""));
  }
  // F5: refresh uses the same header shape, so both token grants authenticate the accepted way.
  {
    const cf = captureFetch(200, { access_token: "n", refresh_token: "r2", expires_at: 9999999999 });
    const { S } = makeEnv(cf, { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: 1 }) });
    await S.refresh();
    const call = cf.calls[0] || {};
    const h = (call.opts && call.opts.headers) || {};
    ck("F5 refresh also sends the apikey header (accepted shape)", h["apikey"] === "anon-key" && /grant_type=refresh_token/.test(call.url || ""), { h: h, url: call.url });
  }
  // F6/F7: source structure. authTokenPost sets the apikey / Authorization / JSON headers, and the token URL
  // builder does NOT append a query-param apikey.
  ck("F6 the token call sends the apikey + Authorization + JSON headers",
    /"apikey": c\.anon, "Authorization": "Bearer " \+ c\.anon, "Content-Type": "application\/json"/.test(supaSrc));
  ck("F7 the token URL builder does NOT append a query-param apikey", !/authTokenUrl[\s\S]{0,160}\?[^\n"]*apikey=/.test(supaSrc) && /function authTokenUrl\(c, grant, fresh\) \{\s*return c\.url \+ "\/auth\/v1\/token\?grant_type="/.test(supaSrc));
  // F8: still a healthy sign-in stores the session (behavior preserved through the shape).
  {
    const { S, store } = makeEnv(replyFetch(200, { access_token: "t", refresh_token: "r", expires_at: 9999999999, user: { id: "u1" } }));
    let ok = false; try { const r = await S.signIn("a@b.com", "pw"); ok = !!(r && r.ok); } catch (e) {}
    ck("F8 a healthy sign-in still stores the session with the header shape", ok && S.signedIn() === true && !!store["console_sb_session"]);
  }
}

partA().then(partE).then(partF).then(function () {
  partB(); partC(); partD();
  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
}).catch(function (e) { console.log("FAIL partA/partE threw"); console.log(String(e && e.stack || e)); process.exit(1); });
