"use strict";
// F1 LIVE PAGE SERVING unit test (the netlify/functions/opp function, zero real network).
//
// A stateful mock of the Supabase REST endpoint stands in for the network: a map of slug -> html. The
// function handler is imported and driven directly. Asserts:
//   1. a slug present in console_pages returns 200 with its html AND the beacon injected (before </body>);
//   2. a page that already carries beacon.js is NOT double-injected (withBeacon idempotent);
//   3. a slug absent from console_pages returns 404 (which verify-live treats as dead);
//   4. a blank html row returns 404 (an empty page is not live);
//   5. a db error / non-ok / thrown fetch returns a clean 500, never a hang;
//   6. the GET reads ONLY console_pages.html (select=html) for the one slug, no other table or column;
//   7. the injected beacon tag is byte-identical to the old engine's BEACON_TAG (library/app.js:3493);
//   8. the netlify.toml redirect for /opp/* is NON-FORCED (status 200, no force = true), so static wins.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
process.env.SUPABASE_URL = "https://example-supabase.example.test";
process.env.SUPABASE_ANON_KEY = "anon.test.key";

const fn = require(path.join(ROOT, "netlify", "functions", "opp.js"));

let fails = 0;
function ck(name, cond, detail){
  console.log((cond ? "PASS " : "FAIL ") + name);
  if(!cond){ fails++; if(detail !== undefined) console.log("      " + String(detail).slice(0, 400)); }
}

// ---- stateful mock of the Supabase REST endpoint (never a real request) ----------------------------
let PAGES = {};                 // slug -> html
let REQUESTS = [];              // every requested URL, to prove what columns/tables are read
let MODE = "ok";               // "ok" | "neterr" (throw) | "http500" (non-ok)
function makeRes(bodyObj, ok, status){
  return { ok: ok !== false, status: status || 200, json: async function(){ return bodyObj; } };
}
global.fetch = async function(url){
  REQUESTS.push(String(url));
  if(MODE === "neterr") throw new Error("network down");
  if(MODE === "http500") return makeRes(null, false, 500);
  const m = String(url).match(/slug=eq\.([^&]+)/);
  const slug = m ? decodeURIComponent(m[1]) : "";
  const rows = Object.prototype.hasOwnProperty.call(PAGES, slug) ? [{ html: PAGES[slug] }] : [];
  return makeRes(rows, true, 200);
};

function ev(pathStr){ return { path: pathStr, queryStringParameters: {} }; }
async function run(){
  const EXPECT_TAG = '<script src="/beacon.js" defer></' + 'script>';

  // Seed: a plain page (no beacon) and a page that already carries the beacon.
  PAGES = {
    "acme-co": "<!doctype html><html><head><title>Acme Co</title></head><body><h1>Acme Co</h1></body></html>",
    "already-beaconed": '<!doctype html><html><body><h1>Fresh Labs</h1><script src="/beacon.js" defer></' + 'script></body></html>',
    "blank-page": "   "
  };

  // ===== 1: present slug returns 200 + html + beacon before </body> =====
  MODE = "ok"; REQUESTS = [];
  let r = await fn.handler(ev("/opp/acme-co"));
  ck("1: a present slug returns 200", r.statusCode === 200, r.statusCode);
  ck("1: the body carries the page html", r.body.indexOf("<h1>Acme Co</h1>") >= 0);
  ck("1: the beacon tag was injected", r.body.indexOf(EXPECT_TAG) >= 0, r.body.slice(-120));
  ck("1: the beacon sits just before </body>", /<script src="\/beacon\.js" defer><\/script>\n<\/body>/.test(r.body), r.body.slice(-120));
  ck("1: Content-Type is text/html", (r.headers["Content-Type"] || "").indexOf("text/html") >= 0, r.headers);

  // ===== 6: the GET reads ONLY console_pages.html for that one slug =====
  ck("6: the request hit console_pages with select=html", REQUESTS.length === 1 && /\/rest\/v1\/console_pages\?slug=eq\.acme-co&select=html/.test(REQUESTS[0]), REQUESTS);
  ck("6: no other table was read", !REQUESTS.some(function(u){ return /console_opps|console_mail|console_inbound|console_hits|console_templates|console_settings|console_members|console_profiles/.test(u); }), REQUESTS);
  ck("6: no wildcard select (only html column)", !REQUESTS.some(function(u){ return /select=\*/.test(u); }), REQUESTS);

  // ===== 2: a page that already carries the beacon is NOT double-injected =====
  r = await fn.handler(ev("/opp/already-beaconed"));
  const count = (r.body.match(/beacon\.js/g) || []).length;
  ck("2: an already-beaconed page keeps exactly one beacon (idempotent)", r.statusCode === 200 && count === 1, count);

  // ===== 3: an absent slug returns 404 =====
  r = await fn.handler(ev("/opp/does-not-exist"));
  ck("3: an absent slug returns 404", r.statusCode === 404, r.statusCode);

  // ===== 4: a blank html row returns 404 =====
  r = await fn.handler(ev("/opp/blank-page"));
  ck("4: a blank page returns 404 (not live)", r.statusCode === 404, r.statusCode);

  // ===== 5: db error / non-ok / thrown fetch => clean 500, never a hang =====
  MODE = "http500";
  r = await fn.handler(ev("/opp/acme-co"));
  ck("5: a non-ok db response returns a clean 500", r.statusCode === 500, r.statusCode);
  MODE = "neterr";
  r = await fn.handler(ev("/opp/acme-co"));
  ck("5: a thrown fetch returns a clean 500 (no hang)", r.statusCode === 500, r.statusCode);
  MODE = "ok";

  // a missing slug (no /opp/<slug>) is a clean 404
  r = await fn.handler(ev("/opp/"));
  ck("5: a missing slug returns 404", r.statusCode === 404, r.statusCode);

  // ===== 7: the beacon tag is byte-identical to the old engine BEACON_TAG (app.js:3493) =====
  const appjs = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
  const mTag = appjs.match(/const BEACON_TAG=('.*?'\+'.*?'|".*?");/);
  ck("7: app.js defines BEACON_TAG", !!mTag, mTag && mTag[0]);
  // eslint-disable-next-line no-eval
  const appTag = mTag ? eval(mTag[1].replace(/^const BEACON_TAG=/, "")) : null;
  ck("7: the function tag equals the old engine tag", fn.BEACON_TAG === EXPECT_TAG && fn.BEACON_TAG === appTag, { fn: fn.BEACON_TAG, app: appTag });

  // ===== 8: the /opp/* redirect is NON-FORCED (static files win) =====
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  const block = (toml.match(/\[\[redirects\]\][\s\S]*$/) || [""])[0];
  ck("8: a redirect maps /opp/* to the function at status 200",
     /from\s*=\s*"\/opp\/\*"/.test(block) && /to\s*=\s*"\/\.netlify\/functions\/opp/.test(block) && /status\s*=\s*200/.test(block), block);
  ck("8: the redirect is NON-FORCED (no force = true), so static pages win", !/force\s*=\s*true/.test(block), block);
  ck("8: the functions directory is declared", /\[functions\][\s\S]*directory\s*=\s*"netlify\/functions"/.test(toml), true);

  console.log("\n" + (fails ? ("FAILED: " + fails + " check(s)") : "ALL SERVE-PAGES CHECKS PASS"));
  process.exit(fails ? 1 : 0);
}
run().catch(function(e){ console.log("FAIL harness threw: " + (e && e.stack || e)); process.exit(1); });
