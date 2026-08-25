/* ---------- Supabase storage client (Stage 1: connection only, inert) ----------

   ISOLATION, the first rule (brief section 0). This client talks ONLY to the workspace's own Supabase
   project, "thrive-console", entered by the operator in Settings, and ONLY to tables prefixed console_.
   It never references any other Supabase project, its URL, its keys, or its tables, and it never touches
   the pre-existing experiment tables in the thrive-console project (the opp_ and jood_ ones). There is
   no hardcoded URL or key anywhere in this file: both come from Settings. The set of reachable tables is
   a fixed allow-list below, all console_ prefixed, and any other name is refused before a request is
   built, so a typo or a pasted foreign table name cannot be reached even by mistake.

   Stage 1 is connection only. This file defines the client, the row-shaped helpers (a page is ONE ROW,
   not a fragment of a shared JSON blob), and a real connection probe. Nothing in the console's read or
   write path calls it yet; the current localStorage-and-relay store is untouched. Stages 2 to 4 wire it
   in. The browser talks to Supabase directly over its REST endpoint (PostgREST) with the anon key and
   RLS; no server, no relay, in this path. */
;(function (global) {
  "use strict";

  var URL_KEY = "console_sb_url", ANON_KEY = "console_sb_anon";

  /* The baked-in default connection (library/config.js). Both values are public by design; RLS plus the
     operator sign-in protect the data, not their secrecy. A stored value overrides the baked default, so
     a deliberate change or a legacy device still works, but the baked default is always present, so a
     fresh or cleared device is never left without a connection. */
  function baked(k) { try { return (global.THRIVE_CONFIG && global.THRIVE_CONFIG[k]) || ""; } catch (e) { return ""; } }

  function cfg() {
    var url = "", anon = "";
    try { url = (localStorage.getItem(URL_KEY) || "").trim(); } catch (e) {}
    try { anon = (localStorage.getItem(ANON_KEY) || "").trim(); } catch (e) {}
    if (!url) url = String(baked("supaUrl") || "").trim();
    if (!anon) anon = String(baked("supaAnon") || "").trim();
    return { url: url.replace(/\/+$/, ""), anon: anon };
  }
  function setCfg(url, anon) {
    try {
      url = (url || "").trim().replace(/\/+$/, "");
      anon = (anon || "").trim();
      url ? localStorage.setItem(URL_KEY, url) : localStorage.removeItem(URL_KEY);
      anon ? localStorage.setItem(ANON_KEY, anon) : localStorage.removeItem(ANON_KEY);
      return true;
    } catch (e) { return false; }
  }
  function ready() { var c = cfg(); return !!(c.url && c.anon); }

  /* The only tables this console will ever touch, every one console_ prefixed. The client refuses any
     name not on this list, so any other project's tables and the pre-existing opp_ / jood_ experiment
     tables in this same project are unreachable by construction, not just by convention. */
  var TABLES = { console_opps: 1, console_pages: 1, console_templates: 1, console_mail: 1,
                 console_inbound: 1, console_hits: 1, console_settings: 1, console_comments: 1,
                 // console_board is the read-only board view (docs/supabase-board-view.sql): one
                 // server-computed stage per opp. Named console_ prefixed so the allow-list guarantee below
                 // (this console reaches only its own console_ objects) holds for the view exactly as it
                 // does for the tables. Reads only; there is no write path to a view.
                 console_board: 1 };
  function guardTable(t) {
    if (String(t).indexOf("console_") !== 0 || !TABLES[t]) {
      throw new Error("supabase: table not allowed (console_ only): " + t);
    }
    return t;
  }

  /* ---- Auth (Path A: Supabase Auth, single operator) --------------------------------------------
     The client is a fetch wrapper, not supabase-js, so the session is managed here explicitly. On
     sign-in the access token and refresh token are stored; every data call then carries the session
     JWT as the bearer instead of the anon key, and RLS scopes to the authenticated session. Until the
     operator removes the permissive `to anon` policy (the run-once step-5 SQL, after a device-green
     signed-in test), the anon key remains the working fallback, so nothing breaks in the meantime. The
     apikey header stays the anon key always, which Supabase requires even with a JWT. No secret is used
     as an access control; the token is a real session, refreshable and revocable. */
  var SESSION_KEY = "console_sb_session";
  /* GATE_V2 Part 3: the session lives in MEMORY first; localStorage is a best-effort mirror, never a
     decision input on the success path. The device diag proved this exact failure class: on storage-blocked
     WebKit a swallowed localStorage write left signedIn() false after a successful token grant, and every
     consumer that bound success to a storage read-back (the gate, bearer()) silently failed. P47 had removed
     the in-memory session; that removal is reversed here by decision. A mirror failure is never thrown and
     never silent: it is recorded to the bounded note ring below, which the ?diag=1 readout prints. */
  var __memSession = null;      // the PRIMARY session store (page-lifetime)
  var __mirrorOk = null;        // last mirror write: true / false / null (never attempted)
  function sbNote(tag, e) {
    try {
      var a = window.__authNotes = window.__authNotes || [];
      a.push(tag + ": " + ((e && e.message) || String(e)));
      if (a.length > 20) a.shift();
    } catch (x) { /* the note ring is the last resort; there is nowhere further to record */ }
  }
  function session() {
    if (__memSession) return __memSession;
    // Warm boot only: no memory session yet (fresh page load), so adopt the mirror if one survives.
    try { var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); if (s) __memSession = s; return s; }
    catch (e) { sbNote("session mirror read", e); return null; }
  }
  function setSession(s) {
    __memSession = s || null;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
      __mirrorOk = true;
    } catch (e) { __mirrorOk = false; sbNote("session mirror write", e); }
  }
  // Warm-boot routing only (which gate step to show). The LIVE sign-in success decision reads signIn's
  // return value, never this (GATE_V2 Part 2).
  function signedIn() { var s = session(); return !!(s && s.access_token); }
  function authEmail() { var s = session(); return (s && s.email) || ""; }
  function authUid() { var s = session(); return (s && s.uid) || ""; }   // the operator's Supabase user id, for per-operator prefs
  function bearer() { var s = session(); var c = cfg(); return (s && s.access_token) ? s.access_token : c.anon; }

  /* ---- P29 sign-in resilience: bounded fetch -----------------------------------------------------
     Every network call the auth and read path makes is BOUNDED by an AbortController. Without this an
     auth POST or a REST read that never returns leaves the UI awaiting forever (the "Signing in" hang):
     a paused free-tier project, a stalled response body, or a looping refresh becomes total paralysis.
     On timeout the promise REJECTS with a typed error (err.kind === "timeout"), never hangs. The body
     read runs inside the SAME timeout window, so a response whose headers arrived but whose body never
     finishes is bounded too. The default is stated here, never a magic literal at the call site. */
  var FETCH_TIMEOUT_MS = 15000;     // default bound for auth + REST calls (P29)
  var UPLOAD_TIMEOUT_MS = 60000;    // attachments can be large: a longer, but still finite, bound
  function timeoutError(ms) { var e = new Error("request timed out after " + ms + "ms"); e.kind = "timeout"; e.timeout = true; return e; }
  function taggedNetworkError(e) { if (e && !e.kind) e.kind = "network"; return e; }
  function newAbort() { try { return (typeof AbortController !== "undefined") ? new AbortController() : null; } catch (x) { return null; } }
  function wasAborted(ac, e) { return !!(e && (e.name === "AbortError" || (ac && ac.signal && ac.signal.aborted))); }
  /* P31: the timeout is a setTimeout-based RACE, not the AbortController alone. The device (build
     35060e6d) proved on three browsers that AbortController.abort() does NOT reliably reject a fetch
     whose socket WebKit has wedged: past 20s no abort ever fired. The independent setTimeout wins the
     race and rejects at ms REGARDLESS of whether the browser honors the abort, and the heartbeat proved
     timers keep running during the hang, so this bound WILL fire. We still call abort() to free the
     socket where the browser respects it; the race is what guarantees the promise settles. */
  function raceTimeout(ms) {
    var h = {};
    h.promise = new Promise(function (_, reject) { h.timer = setTimeout(function () { h.fired = true; reject(timeoutError(ms)); }, ms); });
    return h;
  }
  // fetch + body read under ONE timeout race. Returns { res, data, text }. Rejects with a typed timeout
  // error if the request OR the body read exceeds ms; a real network failure is tagged kind:"network".
  async function fetchJSON(url, opts, ms, noSignal) {
    ms = ms || FETCH_TIMEOUT_MS;
    // P50: `noSignal` builds the fetch WITHOUT an AbortController signal, to exactly match the bare fetch
    // authtest.html proved works on the failing iPad while the console (this wrapper) hung on the identical
    // request. The one construct authtest lacks and this wrapper adds to the fetch is `o.signal = ac.signal`;
    // WebKit's AbortController+fetch is documented-unreliable (see the P31 note above). The setTimeout race
    // below is the independent bound that actually guarantees the promise settles, so dropping the signal
    // loses only the best-effort socket-abort, never the timeout guarantee. rest()/fetchT are unaffected.
    var ac = noSignal ? null : newAbort(), o = Object.assign({}, opts || {});
    if (ac) o.signal = ac.signal;
    var to = raceTimeout(ms);
    var run = (async function () {
      var res = await fetch(url, o);
      var text = await res.text();
      var data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      return { res: res, data: data, text: text };
    })();
    try {
      return await Promise.race([run, to.promise]);
    } catch (e) {
      if (to.fired || wasAborted(ac, e)) { try { if (ac) ac.abort(); } catch (x) {} throw timeoutError(ms); }
      throw taggedNetworkError(e);
    } finally {
      clearTimeout(to.timer);
      // If the timeout won, the fetch may still be pending: abort it to free the socket, and swallow its
      // eventual rejection so it never surfaces as an unhandled rejection.
      if (to.fired) { try { if (ac) ac.abort(); } catch (x) {} }
      try { run.catch(function () {}); } catch (x) {}
    }
  }
  // fetch only (no body read) under one timeout race, for non-JSON paths (upload, logout). Same typed errors.
  async function fetchT(url, opts, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    var ac = newAbort(), o = Object.assign({}, opts || {});
    if (ac) o.signal = ac.signal;
    var to = raceTimeout(ms);
    var run = fetch(url, o);
    try { return await Promise.race([run, to.promise]); }
    catch (e) { if (to.fired || wasAborted(ac, e)) { try { if (ac) ac.abort(); } catch (x) {} throw timeoutError(ms); } throw taggedNetworkError(e); }
    finally { clearTimeout(to.timer); if (to.fired) { try { if (ac) ac.abort(); } catch (x) {} } try { run.catch(function () {}); } catch (x) {} }
  }

  /* GATE_V2 Part 1: the token-call body reader. The device diag proved a 200 token response that never
     became a session, so the token path stops trusting res.text()+blind JSON.parse and reads the body the
     explicit way: arrayBuffer -> TextDecoder, BOM stripped, trimmed, parsed inside try/catch with the raw
     text kept for the diag. Bare fetch (no AbortController signal, P50) under the P31 setTimeout race.
     Returns { res, text, data, parseFailed }; a parse failure or empty body is a FACT for the caller to
     branch on, never a silent null. Scoped to the auth token path; rest()/fetchT are untouched. */
  function sleepMs(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  async function authFetchOnce(url, opts, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    var o = Object.assign({}, opts || {});   // bare: the token fetch carries NO abort signal (P50)
    var to = raceTimeout(ms);
    var run = (async function () {
      var res = await fetch(url, o);
      var text = "";
      if (typeof res.arrayBuffer === "function") {
        var buf = await res.arrayBuffer();
        text = new TextDecoder("utf-8").decode(buf);
      } else {
        text = await res.text();   // non-browser test environments without arrayBuffer
      }
      if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip a leading BOM
      text = String(text || "").trim();
      var data = null, parseFailed = false;
      if (text) { try { data = JSON.parse(text); } catch (e) { parseFailed = true; } }
      return { res: res, text: text, data: data, parseFailed: parseFailed };
    })();
    try {
      return await Promise.race([run, to.promise]);
    } catch (e) {
      if (to.fired) throw timeoutError(ms);
      throw taggedNetworkError(e);
    } finally {
      clearTimeout(to.timer);
      // If the timeout won, the fetch may still settle later; note a late rejection, never surface it.
      try { run.catch(function (e2) { if (to.fired) sbNote("late token settle", e2); }); }
      catch (x) { sbNote("token settle attach", x); }
    }
  }

  /* P46 (regression revert): git forensics named the ONLY substantive change to this token call across the
     outage window. The last-known-working sign-in (5c9cefe, the anon-door commit, and the pre-P32 P29 build
     37cd7c3) sent exactly { "apikey": c.anon, "Content-Type": "application/json" }. P34 (a67056a) correctly
     restored the apikey HEADER after P32 had wrongly moved it to a query param, but it ALSO added
     "Authorization: Bearer <anon>", a header no version that ever signed in successfully carried. This
     restores the known-good header set (apikey + JSON content type), the smallest revert of the signIn
     token path and nothing else. The apikey header is what GoTrue actually requires (P34, proven on
     device); the Bearer-anon on an unauthenticated password grant is redundant and was the one delta from
     the working shape. There is ZERO instrumentation on this path: it is wrapped ONLY by the P31 setTimeout
     race (inside fetchJSON) and the P29 typed-error surface, both minimal. */
  function authTokenUrl(c, grant, fresh) {
    return c.url + "/auth/v1/token?grant_type=" + grant + (fresh ? ("&_ts=" + Date.now()) : "");
  }
  /* GATE_V2: the token-shape instrument is a PERMANENT organ (promoted from the P55 scaffolding). It
     records the SHAPE of the last token response to window.__lastTokenDiag, in memory only, with NO token
     value and NO logging: the body head redacts any access_token/refresh_token value and any JWT before
     slicing 40 chars. The ?diag=1 readout prints it. */
  function redactBody(t) {
    return String(t == null ? "" : t)
      .replace(/("?(?:access_token|refresh_token|token|id_token|provider_token)"?\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
      .replace(/eyJ[A-Za-z0-9._-]{6,}/g, "[REDACTED]");
  }
  function recordTokenDiag(grant, r, e) {
    try {
      var d;
      if (e) {
        d = { ok: false, threw: true, kind: (e && e.kind) || "error", message: (e && e.message) || String(e),
              status: (e && e.status) || null, grant: grant };
      } else {
        var text = (r && typeof r.text === "string") ? r.text : "";
        d = { ok: true, threw: false, grant: grant,
              status: (r && r.res && r.res.status) != null ? r.res.status : null,
              res_ok: !!(r && r.res && r.res.ok),
              typeof_data: typeof (r && r.data),
              has_access_token: !!(r && r.data && typeof r.data === "object" && r.data.access_token),
              text_length: text.length,
              body_head: redactBody(text).slice(0, 40) };
      }
      d.at = new Date().toISOString();
      window.__lastTokenDiag = d;
    } catch (x) { /* the recorder is the last resort; there is nowhere further to record */ }
  }
  async function authTokenPost(c, grant, payload, fresh) {
    // The request shape is FROZEN, proven by authtest.html on the failing device: apikey header + JSON POST,
    // no Authorization, cache no-store (P46), and a BARE fetch with no AbortController signal (P50). Only
    // the RESPONSE handling is GATE_V2: the explicit body read (authFetchOnce), and ONE automatic identical
    // retry after 400ms when a 200 arrives with an empty body. A still-empty retry is handed to signIn as a
    // fact (text_length 0), which fails VISIBLY as "empty response body", never as a generic auth error.
    var url = authTokenUrl(c, grant, fresh);
    var opts = {
      method: "POST",
      headers: { "apikey": c.anon, "Content-Type": "application/json" },
      body: JSON.stringify(payload), cache: "no-store"
    };
    var r;
    try { r = await authFetchOnce(url, opts, FETCH_TIMEOUT_MS); }
    catch (e) { recordTokenDiag(grant, null, e); throw e; }
    if (r.res.ok && r.text.length === 0) {
      await sleepMs(400);
      try { r = await authFetchOnce(url, opts, FETCH_TIMEOUT_MS); }
      catch (e2) { recordTokenDiag(grant, null, e2); throw e2; }
    }
    recordTokenDiag(grant, r, null);
    return r;
  }

  /* GATE_V2 Part 2: signIn returns the PARSED SESSION on success; the caller (the gate) binds success to
     this return value, never to a storage read-back. Storing the session (setSession, memory-primary with a
     best-effort mirror) is NOT a precondition of returning. Every failure is a typed, distinct throw the
     gate surfaces visibly: empty (a 200 with no body, after the automatic retry), parse (a 200 body that is
     not JSON), auth (a credential rejection, or a 200 object without a token), unavailable (5xx), and the
     transport's timeout/network. The strip marks stay until the closing commit (device photo shows token:ok). */
  async function signIn(email, password, opts) {
    opts = opts || {};
    var c = cfg(); if (!c.url || !c.anon) { var ce = new Error("supabase not configured"); ce.kind = "config"; throw ce; }
    try { window.__signMark = "token:sent"; } catch (e) { sbNote("strip mark", e); }
    var r = await authTokenPost(c, "password", { email: email, password: password }, opts.fresh);
    if (r.res.ok && r.text.length === 0) {
      // authTokenPost already retried once after 400ms; a still-empty 200 fails by its real name.
      var ee = new Error("empty response body"); ee.kind = "empty"; ee.status = r.res.status; throw ee;
    }
    if (r.res.ok && r.parseFailed) {
      var pe = new Error("response body could not be parsed"); pe.kind = "parse"; pe.status = r.res.status; throw pe;
    }
    var data = r.data;
    if (!r.res.ok || !data || typeof data !== "object" || !data.access_token) {
      var err = new Error((data && typeof data === "object" && (data.error_description || data.msg || data.message)) || ("HTTP " + r.res.status));
      err.status = r.res.status;
      // A 5xx (a paused project answers 503) is the service being unavailable, not a wrong password; a
      // 400/401/422 is a credential rejection. Typed so the gate says WHICH and never throttles a blip.
      err.kind = (r.res.status >= 500) ? "unavailable" : "auth";
      throw err;
    }
    try { window.__signMark = "token:ok"; } catch (e) { sbNote("strip mark", e); }
    var sess = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at,
                 email: email, uid: (data.user && data.user.id) || "", user: data.user || null };
    setSession(sess);   // memory-primary; the mirror is best-effort and never gates the return
    return sess;
  }
  async function signOut() {
    var c = cfg(), s = session();
    try { if (s && s.access_token) await fetchT(c.url + "/auth/v1/logout", { method: "POST", headers: { "apikey": c.anon, "Authorization": "Bearer " + s.access_token } }, FETCH_TIMEOUT_MS); } catch (e) { sbNote("logout", e); }
    setSession(null); return true;
  }
  async function refresh() {
    var c = cfg(), s = session(); if (!s || !s.refresh_token) return false;
    try {
      // The same standard header shape as sign-in, so a boot refresh of an expired token authenticates identically.
      var r = await authTokenPost(c, "refresh_token", { refresh_token: s.refresh_token }, false);
      if (r.res.ok && r.data && r.data.access_token) {
        setSession({ access_token: r.data.access_token, refresh_token: r.data.refresh_token, expires_at: r.data.expires_at, email: s.email, uid: s.uid || (r.data.user && r.data.user.id) || "" });
        return true;
      }
      // End the session ONLY on a definitive rejection: the refresh token is invalid or expired (400/401).
      // A transient failure (5xx, a proxy, a rate limit) keeps the session so a blip never ejects the operator.
      if (r.res.status === 400 || r.res.status === 401) setSession(null);
      return false;
    } catch (e) {
      // A timeout or network error is not a definitive rejection. Keep the session and let the next call
      // retry; the boot self-heal (getSession) decides whether an unusable-now session drops to sign-in.
      sbNote("refresh", e);
      return false;
    }
  }
  /* P29 boot self-heal check. Only called when the LOCAL access token has already expired, so it tries ONE
     bounded refresh. Returns true if the session is usable now (refreshed), false otherwise (definitively
     invalid, timed out, or errored). refresh() clears the session on a definitive 400/401; a false without
     a clear is a transient failure the boot self-heal still treats as "not usable now, drop to sign-in". */
  async function getSession() {
    var s = session(); if (!s || !s.access_token || !s.refresh_token) return false;
    try { return await refresh(); } catch (e) { sbNote("getSession", e); return false; }
  }

  /* One REST call to the operator's own PostgREST endpoint. It carries the session JWT when signed in,
     else the anon key. A 401 with a refresh token in hand refreshes once and retries; a persistent 401
     is surfaced as err.authRequired so the read layer can show an honest "sign in", never a blank. A
     non-2xx answer otherwise throws with the real message and status, never a false ok. */
  async function rest(table, opts) {
    opts = opts || {};
    var c = cfg();
    if (!c.url || !c.anon) throw new Error("supabase not configured");
    guardTable(table);
    var url = c.url + "/rest/v1/" + table + (opts.query ? ("?" + opts.query) : "");
    var headers = Object.assign({
      "apikey": c.anon,
      "Authorization": "Bearer " + bearer(),
      "Content-Type": "application/json"
    }, opts.headers || {});
    // Bounded (P29): a stalled read REJECTS with a typed timeout error, so a board settle awaiting this
    // read never hangs forever; the caller degrades to the local cache instead.
    var r = await fetchJSON(url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined
    }, FETCH_TIMEOUT_MS);
    if ((r.res.status === 401 || r.res.status === 403) && !opts._retried && session() && session().refresh_token) {
      if (await refresh()) return rest(table, Object.assign({}, opts, { _retried: true }));
    }
    if (!r.res.ok) {
      var err = new Error((r.data && r.data.message) || ("HTTP " + r.res.status));
      err.status = r.res.status; err.body = r.data;
      if (r.res.status === 401 || r.res.status === 403) err.authRequired = true;
      throw err;
    }
    return r.data;
  }

  /* Row-shaped helpers. A page is ONE ROW: console_pages.html is a text column, so a large page is a
     large row, and the browser store and the 400 KB relay JSON cap are no longer the ceiling. An
     opportunity is one row in console_opps. Upserts merge by primary key (slug), so a re-write updates
     in place, idempotently. These exist for Stages 2 to 4; nothing calls them in Stage 1. */
  function upsertPage(slug, html) {
    return rest("console_pages", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: [{ slug: slug, html: (html || "") }]
    });
  }
  function getPage(slug) {
    return rest("console_pages", { query: "slug=eq." + encodeURIComponent(slug) + "&select=slug,html" })
      .then(function (rows) { return (rows && rows[0]) || null; });
  }
  function upsertOpp(rec) {
    return rest("console_opps", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: [rec]
    });
  }
  function listOpps() { return rest("console_opps", { query: "select=*" }); }

  /* Stage 2 generic helpers, still behind the same console_ guard. upsert merges by primary key so a
     re-write updates in place (idempotent); del removes a row; listCol reads one column for the
     verification count and the missing-name comparison. rows may be one object or an array. */
  function upsert(table, rows) {
    return rest(table, {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: Array.isArray(rows) ? rows : [rows]
    });
  }
  function del(table, query) {
    return rest(table, { method: "DELETE", query: query, headers: { "Prefer": "return=minimal" } });
  }
  function listCol(table, col) {
    return rest(table, { query: "select=" + encodeURIComponent(col) })
      .then(function (rows) { return (rows || []).map(function (r) { return r[col]; }); });
  }

  /* ---- Storage (P23: attachments) ----------------------------------------------------------------
     The one and only bucket this console uploads to is "console-attachments" (public-read), created by
     docs/supabase-attachments.sql in this same project. Storage is orthogonal to the REST allow-list
     above (that guards PostgREST tables, not the object store), so the bucket name is pinned here as a
     constant and nothing else is reachable. An image is stored once, additively, under a slug-scoped
     path; its public URL is what the compiled mail references (path-by-URL, never inlined base64). The
     browser talks straight to the Storage REST endpoint with the session JWT (or the anon key), exactly
     as the data path does; RLS on storage.objects scopes the write. */
  var ATTACH_BUCKET = "console-attachments";
  function attachPublicUrl(path) {
    return cfg().url + "/storage/v1/object/public/" + ATTACH_BUCKET + "/" + String(path).split("/").map(encodeURIComponent).join("/");
  }
  // Upload one file to the attachments bucket under a slug-scoped, collision-free path. Returns
  // { path, url, name, type, size }. Throws with the real status on failure, never a false ok.
  async function uploadAttachment(file, slug, key) {
    var c = cfg();
    if (!c.url || !c.anon) throw new Error("supabase not configured");
    if (!file) throw new Error("no file");
    var safeSlug = String(slug || "unfiled").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unfiled";
    var safeName = String(file.name || "image").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
    var path = safeSlug + "/" + String(key || "k") + "-" + safeName;
    var url = c.url + "/storage/v1/object/" + ATTACH_BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/");
    var res = await fetchT(url, {
      method: "POST",
      headers: { "apikey": c.anon, "Authorization": "Bearer " + bearer(), "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
      body: file
    }, UPLOAD_TIMEOUT_MS);   // bounded (P29): a stalled upload rejects, never hangs
    if ((res.status === 401 || res.status === 403) && session() && session().refresh_token) {
      if (await refresh()) {
        res = await fetchT(url, {
          method: "POST",
          headers: { "apikey": c.anon, "Authorization": "Bearer " + bearer(), "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
          body: file
        }, UPLOAD_TIMEOUT_MS);
      }
    }
    if (!res.ok) {
      var t = ""; try { t = await res.text(); } catch (e) {}
      var err = new Error("storage upload failed: HTTP " + res.status + (t ? (" " + t) : ""));
      err.status = res.status; throw err;
    }
    return { path: path, url: attachPublicUrl(path), name: file.name || safeName, type: file.type || "", size: file.size || 0 };
  }

  /* A cheap read that proves the connection AND that the console_ tables exist. It returns a real
     reason on failure and never a false ok. */
  async function probe() {
    if (!ready()) return { ok: false, reason: "unconfigured" };
    try {
      await rest("console_opps", { query: "select=slug&limit=1" });
      return { ok: true };
    } catch (e) { return { ok: false, reason: (e && e.message) || "error", status: e && e.status }; }
  }

  global.ThriveSupa = {
    cfg: cfg, setCfg: setCfg, ready: ready, rest: rest, probe: probe,
    upsertPage: upsertPage, getPage: getPage, upsertOpp: upsertOpp, listOpps: listOpps,
    upsert: upsert, del: del, listCol: listCol,
    uploadAttachment: uploadAttachment, attachPublicUrl: attachPublicUrl, ATTACH_BUCKET: ATTACH_BUCKET,
    signIn: signIn, signOut: signOut, session: session, signedIn: signedIn,
    clearSession: function () { setSession(null); },
    sessionDiag: function () { return { mem: !!__memSession, mirrorOk: __mirrorOk }; },
    authEmail: authEmail, authUid: authUid, refresh: refresh, getSession: getSession,
    tables: function () { return Object.keys(TABLES); },
    URL_KEY: URL_KEY, ANON_KEY: ANON_KEY, FETCH_TIMEOUT_MS: FETCH_TIMEOUT_MS
  };
})(typeof window !== "undefined" ? window : this);
