/* P39 session integrity (Node). Proves the two guards that make a lost session impossible and loud:
   - setSession no longer swallows a storage failure; it verifies the write and reports ephemeral.
   - A read after sign-in NEVER carries the anon key (the silent RLS-empty board is impossible).
   Plus: the in-memory fallback keeps the tab working when storage is blocked, the public path still
   uses anon before sign-in and after sign-out, and the bearer guard throws kind:"session" (source). */
const fs = require("fs"), path = require("path"), assert = require("assert");
const SUPA = path.resolve(__dirname, "../library/supabase.js");

const URL_BASE = "https://example.supabase.co";
const ANON = "anon-key-xyz";
const ACCESS = "session-access-token-abc";

let fails = 0;
function ck(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { fails++; console.log("FAIL " + n + "\n     " + (e && e.message || e)); } }

// A togglable localStorage: blockWrites=true makes setItem throw, as Safari private/ITP/Lockdown does.
function makeStore() {
  const m = new Map(); const s = { blockWrites: false };
  s.ls = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (s.blockWrites) throw new Error("QuotaExceeded: storage blocked"); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear()
  };
  return s;
}

// Load a FRESH copy of the module against a fresh window/localStorage/fetch, so each case starts clean.
function load(store, fetchStub) {
  const win = {};
  win.THRIVE_CONFIG = { supaUrl: URL_BASE, supaAnon: ANON };   // baked() reads THRIVE_CONFIG off the module's global (window)
  global.window = win;
  global.localStorage = store.ls;
  global.THRIVE_CONFIG = win.THRIVE_CONFIG;
  global.fetch = fetchStub;
  global.AbortController = global.AbortController || function () { this.signal = {}; this.abort = function () {}; };
  delete require.cache[SUPA];
  require(SUPA);
  return win.ThriveSupa;
}

// A fetch stub that records every request and answers auth 200 (with a session) and REST 200 [].
function stub(rec) {
  return async function (url, opts) {
    rec.push({ url: String(url), headers: (opts && opts.headers) || {} });
    if (String(url).indexOf("/auth/v1/token") >= 0) {
      const body = JSON.stringify({ access_token: ACCESS, refresh_token: "refresh-1", expires_at: 9999999999, user: { id: "uid-1" } });
      return { ok: true, status: 200, statusText: "OK", text: async () => body };
    }
    return { ok: true, status: 200, statusText: "OK", text: async () => "[]" };
  };
}
function authOf(req) { return (req.headers.Authorization || req.headers.authorization || ""); }

(async function () {
  // S1: a normal sign-in persists durably, is not ephemeral, and the first read carries the SESSION token.
  await (async function () {
    const store = makeStore(), rec = [];
    const S = load(store, stub(rec));
    const r = await S.signIn("op@thrive.test", "pw");
    ck("S1 sign-in ok and not ephemeral", () => { assert(r.ok === true); assert(r.ephemeral === false); assert(S.sessionEphemeral() === false); });
    ck("S1 session stored durably in localStorage", () => { assert(store.ls.getItem("console_sb_session") != null); });
    rec.length = 0;
    await S.rest("console_board", { query: "select=slug" });
    ck("S1 the post-sign-in read carries Bearer <session token>, never the anon key", () => {
      const a = authOf(rec[rec.length - 1]);
      assert(a === "Bearer " + ACCESS, "Authorization was: " + a);
      assert(a.indexOf(ANON) < 0, "anon key leaked into a signed-in read");
    });
  })();

  // S2: storage blocked. Sign-in still works for the tab (in-memory), is ephemeral, and reads carry the token.
  await (async function () {
    const store = makeStore(); store.blockWrites = true; const rec = [];
    const S = load(store, stub(rec));
    const r = await S.signIn("op@thrive.test", "pw");
    ck("S2 blocked storage: sign-in ok and flagged ephemeral", () => { assert(r.ok === true); assert(r.ephemeral === true); assert(S.sessionEphemeral() === true); });
    ck("S2 nothing was written to localStorage, yet signedIn() is true (in-memory)", () => {
      assert(store.ls.getItem("console_sb_session") == null, "a write leaked past the block");
      assert(S.signedIn() === true, "the in-memory fallback did not hold the session");
    });
    rec.length = 0;
    await S.rest("console_board", { query: "select=slug" });
    ck("S2 the read STILL carries Bearer <session token>, never anon, with storage blocked", () => {
      const a = authOf(rec[rec.length - 1]);
      assert(a === "Bearer " + ACCESS, "Authorization was: " + a);
      assert(a.indexOf(ANON) < 0, "anon key leaked into a signed-in read");
    });
  })();

  // S3: the pre-sign-in PUBLIC path may legitimately use the anon key (RLS scopes it).
  await (async function () {
    const store = makeStore(), rec = [];
    const S = load(store, stub(rec));
    await S.rest("console_board", { query: "select=slug" });
    ck("S3 a read BEFORE sign-in uses the anon key (public path)", () => {
      assert(authOf(rec[rec.length - 1]) === "Bearer " + ANON);
    });
  })();

  // S4: after sign-out the tab returns to the public path; a read uses anon again and does NOT throw.
  await (async function () {
    const store = makeStore(), rec = [];
    const S = load(store, stub(rec));
    await S.signIn("op@thrive.test", "pw");
    await S.signOut();
    rec.length = 0;
    let threw = false; try { await S.rest("console_board", { query: "select=slug" }); } catch (e) { threw = true; }
    ck("S4 after sign-out a read uses anon again and does not throw", () => {
      assert(threw === false, "a post-sign-out read threw");
      assert(authOf(rec[rec.length - 1]) === "Bearer " + ANON);
    });
  })();

  // S5: the guard exists in source: bearer() throws kind:"session" after sign-in rather than using anon.
  ck("S5 bearer() refuses to downgrade to anon after sign-in (throws kind:'session')", () => {
    const src = fs.readFileSync(SUPA, "utf8");
    const b = src.slice(src.indexOf("function bearer("), src.indexOf("function bearer(") + 400);
    assert(/__signInSeen/.test(b), "bearer() does not consult the sign-in flag");
    assert(/kind = "session"|kind: "session"/.test(b) || /e\.kind = "session"/.test(b), "bearer() does not throw a typed session error");
  });

  // S6: setSession does not swallow, verifies the write, and reports failure (source guard).
  ck("S6 setSession verifies the write and does not swallow a failure", () => {
    const src = fs.readFileSync(SUPA, "utf8");
    const f = src.slice(src.indexOf("function setSession("), src.indexOf("function setSession(") + 500);
    assert(/getItem\(SESSION_KEY\) === json/.test(f), "setSession does not read the write back to verify it");
    assert(/__sessionEphemeral = true/.test(f), "setSession does not record an ephemeral (in-memory only) session");
  });

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
