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

  function cfg() {
    try {
      return {
        url: (localStorage.getItem(URL_KEY) || "").trim().replace(/\/+$/, ""),
        anon: (localStorage.getItem(ANON_KEY) || "").trim()
      };
    } catch (e) { return { url: "", anon: "" }; }
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
                 console_inbound: 1, console_hits: 1, console_settings: 1 };
  function guardTable(t) {
    if (String(t).indexOf("console_") !== 0 || !TABLES[t]) {
      throw new Error("supabase: table not allowed (console_ only): " + t);
    }
    return t;
  }

  /* One REST call to the operator's own PostgREST endpoint. A non-2xx answer throws with the real
     message and status, so a failed write is a real error the caller must handle, never a false ok. */
  async function rest(table, opts) {
    opts = opts || {};
    var c = cfg();
    if (!c.url || !c.anon) throw new Error("supabase not configured");
    guardTable(table);
    var url = c.url + "/rest/v1/" + table + (opts.query ? ("?" + opts.query) : "");
    var headers = Object.assign({
      "apikey": c.anon,
      "Authorization": "Bearer " + c.anon,
      "Content-Type": "application/json"
    }, opts.headers || {});
    var res = await fetch(url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined
    });
    var text = await res.text();
    var data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      var err = new Error((data && data.message) || ("HTTP " + res.status));
      err.status = res.status; err.body = data; throw err;
    }
    return data;
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
    tables: function () { return Object.keys(TABLES); },
    URL_KEY: URL_KEY, ANON_KEY: ANON_KEY
  };
})(typeof window !== "undefined" ? window : this);
