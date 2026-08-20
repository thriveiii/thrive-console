/* Sign-in resilience test (Node, no browser). P29 + P31 + P33.

   Proves the ONE auth path is BOUNDED and fails loud, never hangs, and that it now runs through the
   official @supabase/supabase-js client, not a hand-built token fetch:
   - Part A lifts the REAL library/supabase.js into a vm sandbox with a FAKE window.supabase client and a
     controllable fetch (for rest) and shrunk timers, and drives signIn / rest / refresh / getSession
     through a stalled call, a bad credential, a down service, and a healthy service, asserting each
     REJECTS with a typed error (or resolves) rather than awaiting forever.
   - Part E is the P31 crux carried to P33: a client call that NEVER settles is still bounded by the
     setTimeout race; a retry rebuilds the client (a fresh connection); a normal call reuses it; the
     auth path never touches window.fetch.
   - Part B/C/D are source-structure assertions on supabase.js, gate.js, and the shipped bundle: the
     hand-built token fetch is gone, sign-in and refresh go through the client wrapped in the race, the
     "Signing in" button is always released, a transient failure is never throttled, the boot watchdog
     is present.
   - Part F proves the vendoring wiring: the official build is vendored unmodified, pinned in the bundle,
     loaded before supabase.js, inlined into the offline copy, and exempted from the copy gate. */
const vm = require("vm"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const supaSrc = fs.readFileSync(path.join(ROOT, "library", "supabase.js"), "utf8");
const gateSrc = fs.readFileSync(path.join(ROOT, "library", "gate.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
const bundleSrc = fs.readFileSync(path.join(ROOT, "library", "console.html"), "utf8");
const bundleJsSrc = fs.readFileSync(path.join(ROOT, "tools", "bundle.js"), "utf8");
const verifySrc = fs.readFileSync(path.join(ROOT, "tools", "verify.js"), "utf8");
const vendorSrc = fs.readFileSync(path.join(ROOT, "library", "vendor", "supabase-js.min.js"), "utf8");
// dist/ is a generated, gitignored artifact: present after `node tools/bundle.js`, absent on a bare
// checkout. Read it defensively so the whole suite does not crash when the offline copy has not been built.
let distSrc = null;
try { distSrc = fs.readFileSync(path.join(ROOT, "dist", "thrive-console.html"), "utf8"); } catch (e) {}

let fails = 0;
function ck(name, cond, detail) {
  if (cond) { console.log("PASS " + name); }
  else { fails++; console.log("FAIL " + name); if (detail !== undefined) console.log("     " + JSON.stringify(detail)); }
}

// ---- a sandbox that runs the REAL supabase.js with a FAKE official client and controllable fetch ------
function makeEnv(fetchImpl, seed, supa) {
  const store = Object.assign({ console_sb_url: "https://example.supabase.co", console_sb_anon: "anon-key" }, seed || {});
  const localStorage = {
    getItem: (k) => (k in store) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const win = {};
  // The vendored official client is exposed as the global `supabase`. Inject a fake so ensureClient()
  // finds it. Set BEFORE running supabase.js is unnecessary (the client is created lazily), but harmless.
  if (supa) win.supabase = supa;
  const sandbox = {
    window: win, fetch: fetchImpl, AbortController: AbortController, localStorage: localStorage,
    console: console, JSON: JSON, encodeURIComponent: encodeURIComponent, TextEncoder: TextEncoder,
    // Shrink the 15s bound so a timeout test resolves in milliseconds, not seconds. A real call
    // (Promise.resolve) still wins the race; only a hung call reaches the (shrunk) timeout.
    setTimeout: (fn, ms) => setTimeout(fn, ms > 50 ? 5 : ms), clearTimeout: clearTimeout,
    Date: Date, Object: Object, Array: Array, Error: Error, Promise: Promise, String: String, Number: Number
  };
  vm.createContext(sandbox);
  vm.runInContext(supaSrc, sandbox);
  return { S: win.ThriveSupa, store };
}

// ---- a FAKE official supabase-js client, driven by handlers, recording its calls -----------------------
// handlers.signIn(creds) and handlers.refresh(arg) each return a Promise of { data, error } (or a
// never-settling promise, to simulate the hang). createClient records its options and a rebuild count.
function makeClient(handlers) {
  handlers = handlers || {};
  const calls = { createClient: 0, createOpts: null, signIn: [], refresh: [] };
  const client = {
    auth: {
      signInWithPassword: function (creds) {
        calls.signIn.push(creds);
        return handlers.signIn ? handlers.signIn(creds) : Promise.resolve(authErr(500, "no handler"));
      },
      refreshSession: function (arg) {
        calls.refresh.push(arg);
        return handlers.refresh ? handlers.refresh(arg) : Promise.resolve(authErr(400, "no handler"));
      }
    }
  };
  const supa = { createClient: function (url, anon, opts) { calls.createClient++; calls.createOpts = opts; return client; } };
  return { supa: supa, calls: calls };
}
// A successful GoTrue session, in the shape signInWithPassword / refreshSession return.
function okSession(over) {
  over = over || {};
  const user = { id: over.uid || "u1", email: over.email || "a@b.com" };
  return { data: { session: {
    access_token: over.access_token || "tok", refresh_token: over.refresh_token || "ref",
    expires_at: over.expires_at || 9999999999, user: user
  }, user: user }, error: null };
}
// An AuthApiError-shaped rejection: a typed { status, message } error, no session.
function authErr(status, message) { return { data: { session: null, user: null }, error: { status: status, message: message || ("HTTP " + status) } }; }
// resolvers: reply with a value; hang forever (never settles, the device's Safari signature).
function reply(v) { return function () { return Promise.resolve(v); }; }
function hang() { return function () { return new Promise(function () {}); }; }
// A fetch that must NOT be called: the auth path is the client, never window.fetch. Throws if touched.
function noFetch() { return function () { throw new Error("window.fetch must not be called on the auth path"); }; }
// fetch helpers for the rest() path (rest still uses the bounded fetchJSON).
function hangingFetch() {
  return function (url, opts) {
    return new Promise(function (resolve, reject) {
      if (opts && opts.signal) opts.signal.addEventListener("abort", function () { var e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    });
  };
}
function deadFetch() { return function () { return new Promise(function () {}); }; }
function makeRes(status, body) {
  const text = (typeof body === "string") ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status: status, text: () => Promise.resolve(text) };
}

async function partA() {
  // A1/A2: a stalled client sign-in REJECTS with a typed timeout, never hangs.
  {
    const cl = makeClient({ signIn: hang() });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("A1 signIn REJECTS on a stalled client call (never hangs)", !!caught);
    ck("A2 the rejection is typed as a timeout (err.kind === 'timeout')", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind, msg: caught.message });
  }
  // A3: a 400 (wrong credentials) is typed as auth, not a timeout.
  {
    const cl = makeClient({ signIn: reply(authErr(400, "Invalid login credentials")) });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    let caught = null;
    try { await S.signIn("a@b.com", "bad"); } catch (e) { caught = e; }
    ck("A3 a 400 is a credential rejection (err.kind === 'auth')", !!(caught && caught.kind === "auth" && caught.status === 400), caught && { kind: caught.kind, status: caught.status });
  }
  // A4: a 503 (paused / down project) is typed as unavailable, so the gate can say so.
  {
    const cl = makeClient({ signIn: reply(authErr(503, "service unavailable")) });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("A4 a 5xx is the service being unavailable (err.kind === 'unavailable')", !!(caught && caught.kind === "unavailable"), caught && { kind: caught.kind, status: caught.status });
  }
  // A4b: a status-0 retryable fetch error (network) is typed as network, not a bad password.
  {
    const cl = makeClient({ signIn: reply(authErr(0, "Failed to fetch")) });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("A4b a status-0 client error is a network fault (err.kind === 'network')", !!(caught && caught.kind === "network"), caught && { kind: caught.kind, status: caught.status });
  }
  // A5: a healthy service signs in and stores the session (mapped out of the client's returned session).
  {
    const cl = makeClient({ signIn: reply(okSession({ access_token: "tok", uid: "u1", email: "a@b.com" })) });
    const { S, store } = makeEnv(noFetch(), null, cl.supa);
    let ok = false, threw = false;
    try { const r = await S.signIn("a@b.com", "pw"); ok = !!(r && r.ok); } catch (e) { threw = true; }
    ck("A5 a healthy service signs in normally (no timeout, no throw)", ok && !threw);
    ck("A5b the session is stored on success", !!store["console_sb_session"] && S.signedIn() === true);
    ck("A5c the stored session carries the mapped token, email, uid",
      (function () { var s = JSON.parse(store["console_sb_session"] || "{}"); return s.access_token === "tok" && s.email === "a@b.com" && s.uid === "u1"; })());
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
    const cl = makeClient({ refresh: reply(authErr(400, "invalid_grant")) });
    const { S, store } = makeEnv(noFetch(), { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r", expires_at: 1 }) }, cl.supa);
    const r = await S.refresh();
    ck("A7 refresh returns false on a definitive rejection", r === false);
    ck("A7b and clears the stale session (a corrupt token cannot persist)", !store["console_sb_session"]);
  }
  // A8: getSession heals an expired-but-refreshable token (returns true, updates the session).
  {
    const cl = makeClient({ refresh: reply(okSession({ access_token: "new", refresh_token: "r2" })) });
    const { S, store } = makeEnv(noFetch(), { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: 1 }) }, cl.supa);
    const good = await S.getSession();
    ck("A8 getSession heals an expired-but-refreshable token (true)", good === true);
    ck("A8b the stored token is the refreshed one", (JSON.parse(store["console_sb_session"] || "{}").access_token) === "new");
  }
  // A9: getSession on a hung refresh returns false (not usable now) rather than hanging.
  {
    const cl = makeClient({ refresh: hang() });
    const { S } = makeEnv(noFetch(), { console_sb_session: JSON.stringify({ access_token: "old", refresh_token: "r", expires_at: 1 }) }, cl.supa);
    const good = await S.getSession();
    ck("A9 getSession returns false on a hung refresh (never hangs)", good === false);
  }
  // A10: getSession with no session is a clean false.
  {
    const cl = makeClient({});
    const { S } = makeEnv(noFetch(), null, cl.supa);
    const good = await S.getSession();
    ck("A10 getSession with no stored session is a clean false", good === false);
  }
  // A11: the auth client is created ONCE per sign-in with persistSession:false (the console owns its own
  // session key), autoRefreshToken:false, detectSessionInUrl:false.
  {
    const cl = makeClient({ signIn: reply(okSession()) });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    await S.signIn("a@b.com", "pw");
    const o = cl.calls.createOpts && cl.calls.createOpts.auth;
    ck("A11 the client is created with persistSession:false (console keeps its own session)", !!(o && o.persistSession === false), cl.calls.createOpts);
    ck("A11b autoRefreshToken:false and detectSessionInUrl:false (no background client state)", !!(o && o.autoRefreshToken === false && o.detectSessionInUrl === false));
  }
}

/* ============ Part E: P31 setTimeout race carried to the official client (P33) ============ */
async function partE() {
  // E1 is the crux: a client call that NEVER settles (the device's Safari signature) is still bounded,
  // because the setTimeout race rejects at the timeout independent of the client's own fetch.
  {
    const cl = makeClient({ signIn: hang() });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    let caught = null;
    try { await S.signIn("a@b.com", "pw"); } catch (e) { caught = e; }
    ck("E1 signIn REJECTS via the setTimeout race even when the client never settles", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind });
  }
  // E2: a fresh retry REBUILDS the client (createClient called again) so it opens a new connection rather
  // than reusing a wedged one; a normal retry would have reused the cached client.
  {
    const cl = makeClient({ signIn: reply(okSession()) });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    await S.signIn("a@b.com", "pw");                 // first: builds the client
    await S.signIn("a@b.com", "pw", { fresh: true }); // retry: rebuilds it
    ck("E2 a fresh retry rebuilds the client (a new connection, not a wedged one)", cl.calls.createClient === 2, { createClient: cl.calls.createClient });
  }
  // E3: a normal (non-fresh) second sign-in REUSES the client (createClient not called again).
  {
    const cl = makeClient({ signIn: reply(okSession()) });
    const { S } = makeEnv(noFetch(), null, cl.supa);
    await S.signIn("a@b.com", "pw");
    await S.signIn("a@b.com", "pw");
    ck("E3 a normal sign-in reuses the client (only a retry opens a fresh connection)", cl.calls.createClient === 1, { createClient: cl.calls.createClient });
  }
  // E4: the auth path NEVER touches window.fetch (the whole point of P33: no hand-built request).
  {
    const cl = makeClient({ signIn: reply(okSession()) });
    let threw = false;
    const { S } = makeEnv(noFetch(), null, cl.supa);
    try { await S.signIn("a@b.com", "pw"); } catch (e) { threw = true; }
    ck("E4 sign-in never calls window.fetch (one auth path, through the client)", threw === false);
  }
  // E5: a stalled rest() that ignores abort is bounded by the race too (the fetch path keeps its P31 bound).
  {
    const { S } = makeEnv(deadFetch());
    let caught = null;
    try { await S.rest("console_board", { query: "select=slug" }); } catch (e) { caught = e; }
    ck("E5 a stalled rest() that ignores abort is bounded by the race (typed timeout)", !!(caught && caught.kind === "timeout"), caught && { kind: caught.kind });
  }
  // E6: source structure. The client call is wrapped in a Promise.race against a setTimeout (raceTimeout).
  ck("E6 the auth bound is a setTimeout RACE (withTimeout -> raceTimeout -> Promise.race)",
    /function withTimeout/.test(supaSrc) && /raceTimeout/.test(supaSrc) && /Promise\.race\(\[/.test(supaSrc) && /setTimeout\(/.test(supaSrc));
  // E7: rest/fetch path still calls abort() to free the socket where the browser honors it.
  ck("E7 the fetch path still calls abort() to free the socket", /ac\.abort\(\)/.test(supaSrc));
  // E8: gate offers a one-tap Retry that re-attempts with fresh=true.
  ck("E8 the gate offers a one-tap Retry (fresh connection)", /id="gateRetry"/.test(gateSrc) && /attempt\(true\)/.test(gateSrc) && /op_retry/.test(gateSrc));
  // E9: signIn threads the fresh flag through to a client rebuild.
  ck("E9 signIn threads fresh through to a client rebuild", /S\.signIn\(m, p, \{ fresh:/.test(gateSrc) && /ensureClient\(!!opts\.fresh\)/.test(supaSrc));
}

function partB() {
  // The hand-built auth token fetch is GONE: no token endpoint, no grant_type anywhere in the client.
  ck("B1 the hand-built token endpoint is gone (no /auth/v1/token in the client)", !/auth\/v1\/token/.test(supaSrc));
  ck("B1b no grant_type request is built anywhere (one auth path)", !/grant_type/.test(supaSrc));
  // Exactly one auth transport: sign-in and refresh go through the official client, wrapped in the race.
  ck("B2 signIn goes through the official client (signInWithPassword), wrapped in the race",
    /async function signIn[\s\S]*?withTimeout\([\s\S]*?signInWithPassword\(/.test(supaSrc));
  ck("B3 refresh goes through the official client (refreshSession), wrapped in the race",
    /async function refresh[\s\S]*?withTimeout\([\s\S]*?refreshSession\(/.test(supaSrc));
  ck("B4 the client is built from the vendored global (global.supabase.createClient)",
    /function ensureClient[\s\S]*?global\.supabase\.createClient\(/.test(supaSrc));
  ck("B4b ensureClient asks for persistSession:false (the console owns its own session)",
    /persistSession:\s*false/.test(supaSrc));
  // rest / signOut / uploads keep the bounded fetch path (P33 touched only the auth transport).
  ck("B5 rest uses the bounded fetchJSON (DB path untouched)", /async function rest[\s\S]*?fetchJSON\(/.test(supaSrc));
  ck("B6 signOut uses the bounded fetchT", /async function signOut[\s\S]*?fetchT\(/.test(supaSrc));
  ck("B7 uploadAttachment uses the bounded fetchT", /async function uploadAttachment[\s\S]*?fetchT\(/.test(supaSrc));
  // The only bare fetch() calls are the two timeout wrappers themselves (auth no longer uses fetch).
  const bare = (supaSrc.match(/\bfetch\(/g) || []).length;
  ck("B8 the only bare fetch() calls are the 2 timeout wrappers (auth uses the client, not fetch)", bare === 2, { bare: bare });
  ck("B9 a stated default timeout constant exists (15s)", /FETCH_TIMEOUT_MS\s*=\s*15000/.test(supaSrc));
  ck("B10 a timeout produces a typed error (kind:'timeout')", /kind\s*=\s*"timeout"/.test(supaSrc));
  ck("B11 getSession is exported for the boot self-heal", /getSession:\s*getSession/.test(supaSrc));
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
  ck("C10 the catch captures the raw error text (kind + message [+ status])",
    /raw = \(kind \|\| "error"\) \+ ": " \+ \(\(ex && ex\.message\)/.test(gateSrc) && /raw \+= " \(HTTP " \+ ex\.status/.test(gateSrc));
  ck("C11 the raw diagnostic is shown on failure (showDiag(raw))", /showDiag\(raw\)/.test(gateSrc));
  ck("C12 the diagnostic writes textContent only (no markup injection)", /function showDiag[\s\S]*?diag\.textContent =/.test(gateSrc) && !/gateDiag[\s\S]{0,80}innerHTML/.test(gateSrc));
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

/* ============ Part F: the vendoring wiring (P33) ============ */
function partF() {
  // F1: the official build is vendored and exposes createClient (a real UMD, not a stub).
  ck("F1 the official client is vendored (exposes createClient, real size)", /createClient/.test(vendorSrc) && vendorSrc.length > 100000, { bytes: vendorSrc.length });
  // F2: bundle.js reads the vendored file and pins its bytes in the fingerprint AND the BUILD signature.
  ck("F2 bundle.js reads the vendored file", /read\(path\.join\(LIB, "vendor", "supabase-js\.min\.js"\)\)/.test(bundleJsSrc));
  ck("F2b the vendored bytes are fingerprinted (cache-busted)", /"vendor\/supabase-js\.min\.js":\s*fphash\(supavendor\)/.test(bundleJsSrc));
  ck("F2c the vendored bytes are part of the BUILD signature (a swap is never silent)", /intake,\s*supavendor,\s*supabase,/.test(bundleJsSrc));
  // F3: the shipped shell loads the vendor BEFORE supabase.js, so global.supabase exists first.
  {
    const iv = bundleSrc.indexOf("vendor/supabase-js.min.js");
    const is = bundleSrc.indexOf("supabase.js?v=");
    ck("F3 console.html loads the vendor script BEFORE supabase.js", iv >= 0 && is >= 0 && iv < is, { vendor: iv, supabase: is });
  }
  // F4: the offline copy INLINES the vendored build, so it is self-contained (opens from a file). dist is
  // a generated artifact; if it has not been built yet this check is inconclusive rather than a failure.
  if (distSrc == null) { console.log("SKIP F4 (dist not built; run node tools/bundle.js to verify the offline inline)"); }
  else ck("F4 the offline dist inlines the vendored build (self-contained)", /createClient/.test(distSrc));
  // F5: verify.js exempts ONLY the vendored bytes from the copy scan (unmodified build ships), by stripping
  // the vendored blob wherever it is embedded rather than deleting anything from the file.
  ck("F5 verify.js exempts the vendored library from the copy scan", /library\/vendor/.test(verifySrc) && /VENDOR_SRC/.test(verifySrc));
}

partA().then(partE).then(function () {
  partB(); partC(); partD(); partF();
  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
}).catch(function (e) { console.log("FAIL partA/partE threw"); console.log(String(e && e.stack || e)); process.exit(1); });
