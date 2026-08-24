/* P47 session contract, RECONCILED from the P39 suite (Node). P47 restored the sign-in path to its
   last-good (P31, 506334f) shape: setSession swallows a blocked write and returns nothing, signIn returns
   { ok, email } with no ephemeral field, and bearer() returns the anon key when there is no session and
   NEVER throws. The P39 guards (in-memory fallback, verify-and-report, the bearer session throw) were
   dropped on purpose, as the P47 build diff proved the freeze was not on this path. This suite asserts the
   RESTORED behavior, and is honest about the accepted trade: with storage blocked, a signed-in read falls
   back to the anon key (the last-good shape did not hold a memory session). The public-path and
   sign-out-returns-to-anon guarantees are unchanged and still asserted. */
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
  // S1: a normal sign-in persists durably and the first read carries the SESSION token (unchanged, holds).
  await (async function () {
    const store = makeStore(), rec = [];
    const S = load(store, stub(rec));
    const r = await S.signIn("op@thrive.test", "pw");
    ck("S1 sign-in returns ok (no ephemeral field in the last-good shape)", () => {
      assert(r.ok === true, "sign-in did not return ok");
      assert(!("ephemeral" in r), "the restored last-good signIn should not carry an ephemeral field");
    });
    ck("S1 session stored durably in localStorage", () => { assert(store.ls.getItem("console_sb_session") != null); });
    rec.length = 0;
    await S.rest("console_board", { query: "select=slug" });
    ck("S1 the post-sign-in read carries Bearer <session token>, never the anon key", () => {
      const a = authOf(rec[rec.length - 1]);
      assert(a === "Bearer " + ACCESS, "Authorization was: " + a);
      assert(a.indexOf(ANON) < 0, "anon key leaked into a signed-in read");
    });
  })();

  // S2: storage blocked. The last-good shape still SUCCEEDS the sign-in (it never failed on a storage
  // block), but it does NOT hold a memory session, so nothing persists and a later read falls back to
  // anon. This asserts the RESTORED behavior and the accepted P47 trade, not the dropped P39 guard.
  await (async function () {
    const store = makeStore(); store.blockWrites = true; const rec = [];
    const S = load(store, stub(rec));
    const r = await S.signIn("op@thrive.test", "pw");
    ck("S2 blocked storage: sign-in still returns ok (never fails on a storage block)", () => {
      assert(r.ok === true, "a storage-blocked sign-in should still resolve ok");
    });
    ck("S2 nothing was written to localStorage and no memory session is held (last-good shape)", () => {
      assert(store.ls.getItem("console_sb_session") == null, "a write leaked past the block");
      assert(S.signedIn() === false, "the last-good shape holds no in-memory session when storage is blocked");
    });
    rec.length = 0;
    await S.rest("console_board", { query: "select=slug" });
    ck("S2 with storage blocked, a read falls back to anon (the accepted P47 trade, honestly asserted)", () => {
      const a = authOf(rec[rec.length - 1]);
      assert(a === "Bearer " + ANON, "expected anon fallback, Authorization was: " + a);
    });
  })();

  // S3: the pre-sign-in PUBLIC path may legitimately use the anon key (RLS scopes it). Unchanged.
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

  // S5: the restored bearer() contract: return anon when there is no session, and NEVER throw. The P39
  // sign-in flag and typed session throw are gone by decision (source guard against their return).
  ck("S5 bearer() returns anon when signed out and never throws (last-good, no session flag)", () => {
    const src = fs.readFileSync(SUPA, "utf8");
    const b = src.slice(src.indexOf("function bearer("), src.indexOf("function bearer(") + 300);
    assert(!/__signInSeen/.test(b), "bearer() still consults a sign-in flag (P39 residue)");
    assert(!/kind = "session"|e\.kind = "session"/.test(b), "bearer() still throws a typed session error (P39 residue)");
    assert(/\?\s*s\.access_token\s*:\s*c\.anon|access_token\)\s*\?\s*s\.access_token\s*:\s*c\.anon/.test(b), "bearer() does not fall back to the anon key");
  });

  // S6: the restored setSession contract: a blocked write is swallowed (last-good), NOT verified and
  // reported. The P39 verify-and-ephemeral machinery is gone by decision (source guard against return).
  ck("S6 setSession is the last-good swallow-on-block form (no verify-readback, no ephemeral)", () => {
    const src = fs.readFileSync(SUPA, "utf8");
    const f = src.slice(src.indexOf("function setSession("), src.indexOf("function setSession(") + 300);
    assert(!/getItem\(SESSION_KEY\) === json/.test(f), "setSession still reads the write back to verify it (P39 residue)");
    assert(!/__sessionEphemeral/.test(f), "setSession still records an ephemeral session (P39 residue)");
    assert(/try \{ s \? localStorage\.setItem|catch \(e\) \{\}/.test(f), "setSession is not the last-good swallow form");
  });

  console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
  process.exit(fails === 0 ? 0 : 1);
})();
