"use strict";
// ===================================================================================================
// F1 LIVE PAGE SERVING for /opp/<slug> from console_pages.
//
// Old pages are served as static committed files at opp/<slug>/index.html (the old engine committed them
// via ghPutFile, library/app.js:3530). The new console's upload writes the page html to console_pages.html
// only (board-upload.src.js pageUpsert), and nothing served it, so activate/verify-live always 404d. This
// function closes that gap: it reads the SAME column the upload writes (console_pages.html by slug) and
// returns it as a real /opp/<slug> page.
//
// It is reached ONLY through a NON-FORCED redirect (/opp/* -> this function, status 200) in netlify.toml, so
// it fires only when no static file matches. Committed opp/<slug>/index.html pages keep serving statically
// and untouched; this function serves only db-only uploaded pages.
//
// Safety: it reads ONLY console_pages.html (select=html), with the anon key that is public by design
// (library/config.js supaUrl/supaAnon, the same pair the board bakes at bundle.js:1084). The opp page is
// public by design, so exposing its html is intended; no other table or column is read. RLS permits the
// anon SELECT on console_pages (docs/supabase-auth-policies.sql:21). A missing slug, a missing row, a db
// error, or a thrown fetch all return a CLEAN 404/500 - never a hang.
// ===================================================================================================
const fs = require("fs");
const path = require("path");

// The beacon tag, byte-identical to the old engine's BEACON_TAG (library/app.js:3493), and withBeacon's
// injection rule (library/app.js:3494-3502): insert before </body>, else before </html>, else append; and
// no-op if the page already carries beacon.js. So an uploaded page records opens exactly like a committed
// one, keeping console_hits visit tracking whole. The "</" + "script>" split mirrors the source.
var BEACON_TAG = '<script src="/beacon.js" defer></' + 'script>';
function withBeacon(html){
  var h = String(html || "");
  if(!h.trim()) return h;
  if(/beacon\.js/.test(h)) return h;
  if(/<\/body\s*>/i.test(h)) return h.replace(/<\/body\s*>/i, BEACON_TAG + "\n</body>");
  if(/<\/html\s*>/i.test(h)) return h.replace(/<\/html\s*>/i, BEACON_TAG + "\n</html>");
  return h + "\n" + BEACON_TAG;
}

// The slug is the first path segment after /opp/. On a non-forced rewrite Netlify keeps the original request
// path in event.path (/opp/<slug>); the ?slug=:splat query is a belt-and-suspenders fallback.
function slugFromPath(p){
  var m = String(p || "").match(/\/opp\/([^\/?#]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function cleanSlug(s){ return String(s || "").replace(/[?#].*$/, "").replace(/\/.*$/, "").trim(); }

// The Supabase URL + anon key, both public by design. Env wins (Netlify config and the test); else parse the
// committed library/config.js so the function reuses exactly what the board uses with zero extra setup.
function readConfig(){
  var url = process.env.SUPABASE_URL || "";
  var anon = process.env.SUPABASE_ANON_KEY || "";
  if(url && anon) return { url: url, anon: anon };
  var candidates = [
    path.join(__dirname, "config.js"),                       // included_files copies it beside the function
    path.join(process.cwd(), "library", "config.js"),
    path.join(__dirname, "..", "..", "library", "config.js")
  ];
  for(var i = 0; i < candidates.length; i++){
    try{
      if(!fs.existsSync(candidates[i])) continue;
      var txt = fs.readFileSync(candidates[i], "utf8");
      url = url || (txt.match(/supaUrl\s*=\s*"([^"]+)"/) || [])[1] || "";
      anon = anon || (txt.match(/supaAnon\s*=\s*"([^"]+)"/) || [])[1] || "";
      if(url && anon) break;
    }catch(e){}
  }
  return { url: url, anon: anon };
}

var HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" };
function notFound(){
  return { statusCode: 404, headers: HTML_HEADERS,
    body: '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Not found</title><p style="font-family:sans-serif;color:#888;padding:40px">This page is not live.</p>' };
}
function serverError(){
  return { statusCode: 500, headers: HTML_HEADERS,
    body: '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Error</title><p style="font-family:sans-serif;color:#888;padding:40px">The page could not be loaded.</p>' };
}

exports.handler = async function(event){
  try{
    var slug = slugFromPath((event && event.path) || "");
    if(!slug && event && event.queryStringParameters) slug = cleanSlug(event.queryStringParameters.slug);
    if(!slug) return notFound();

    var cfg = readConfig();
    if(!cfg.url || !cfg.anon) return serverError();

    // Read ONLY console_pages.html for this one slug. No other table, no other column.
    var api = cfg.url.replace(/\/+$/, "") + "/rest/v1/console_pages?slug=eq." +
              encodeURIComponent(slug) + "&select=html&limit=1";
    var res;
    try{
      res = await fetch(api, { headers: { apikey: cfg.anon, Authorization: "Bearer " + cfg.anon, Accept: "application/json" } });
    }catch(e){ return serverError(); }
    if(!res || !res.ok) return serverError();

    var rows;
    try{ rows = await res.json(); }catch(e){ return serverError(); }
    if(!Array.isArray(rows) || !rows.length) return notFound();
    var html = rows[0] && rows[0].html;
    if(!String(html == null ? "" : html).trim()) return notFound();       // an absent or blank page is dead

    return { statusCode: 200, headers: HTML_HEADERS, body: withBeacon(String(html)) };
  }catch(e){
    return serverError();
  }
};

// Exported for the function unit test (zero real network); never a hang, always a clean 404/500 on trouble.
exports.withBeacon = withBeacon;
exports.slugFromPath = slugFromPath;
exports.readConfig = readConfig;
exports.BEACON_TAG = BEACON_TAG;
