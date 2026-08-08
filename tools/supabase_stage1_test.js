/* Supabase Stage 1 proof, and the isolation proof, in Node against a mocked client.

   Proves: the client reads and writes only console_ tables and REFUSES anything else (the Lotus and the
   pre-existing opp_ / jood_ tables are unreachable by construction); a REST call carries the anon key and
   hits /rest/v1/console_...; a page is ONE ROW (console_pages, html a text column) and a large page is a
   large row, not a shared blob; the probe returns a real error and never a false ok; and Lotus is not
   referenced anywhere in the shipped code, by project name, key, or table (grep shows zero).

   The sandbox cannot run the live Supabase or WebKit, so the true migration is Thyab's device. This runs
   the real library/supabase.js against a mocked fetch and a stubbed localStorage. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

// ---- stub the browser globals the client uses -------------------------------
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
let lastReq = null, nextRes = { ok: true, status: 200, text: async () => "[]" };
global.fetch = async (url, opts) => { lastReq = { url, opts }; return nextRes; };
global.window = global;

require(path.join(ROOT, "library/supabase.js"));
const S = global.ThriveSupa;
ck("the client attaches (ThriveSupa present)", typeof S === "object" && typeof S.rest === "function");

// ---- config is Settings-driven, no hardcoded project ------------------------
ck("unconfigured by default (no baked-in URL or key)", !S.ready() && !S.cfg().url && !S.cfg().anon);
S.setCfg("https://demo.supabase.co/", "anon-key-123");
ck("configured after setCfg, trailing slash trimmed", S.ready() && S.cfg().url === "https://demo.supabase.co");

// ---- ONLY console_ tables are reachable; everything else is refused ---------
async function refuses(table) {
  try { await S.rest(table, {}); return false; } catch (e) { return /not allowed/.test(e.message); }
}
(async () => {
  ck("refuses a Lotus table name", await refuses("lotus_opps"));
  ck("refuses the pre-existing opp_ experiment table", await refuses("opp_leads"));
  ck("refuses the pre-existing jood_ experiment table", await refuses("jood_things"));
  ck("refuses a console_ name not on the allow-list", await refuses("console_secret"));
  ck("allows a console_ table on the allow-list", !(await refuses("console_opps")));

  // ---- a REST call carries the anon key and hits /rest/v1/console_... -------
  nextRes = { ok: true, status: 200, text: async () => "[]" };
  await S.listOpps();
  ck("REST url targets the console_opps table on the operator's project",
    lastReq.url === "https://demo.supabase.co/rest/v1/console_opps?select=*", lastReq.url);
  ck("REST call sends the anon key as apikey and bearer",
    lastReq.opts.headers.apikey === "anon-key-123" && lastReq.opts.headers.Authorization === "Bearer anon-key-123");

  // ---- a page is ONE ROW; a large page is a large row ----------------------
  const bigHtml = "<div>" + "x".repeat(500000) + "</div>";   // ~0.5 MB, far past the browser store and the 400 KB JSON cap
  nextRes = { ok: true, status: 201, text: async () => "" };
  await S.upsertPage("big-page", bigHtml);
  const body = JSON.parse(lastReq.opts.body);
  ck("upsertPage writes to console_pages", lastReq.url.indexOf("/rest/v1/console_pages") >= 0, lastReq.url);
  ck("a page is a single row (one element), keyed by slug", Array.isArray(body) && body.length === 1 && body[0].slug === "big-page");
  ck("the large page html rides in one text column, whole", body[0].html.length === bigHtml.length, body[0].html.length + " vs " + bigHtml.length);
  ck("upsert merges duplicates by slug (idempotent re-write)", /merge-duplicates/.test(lastReq.opts.headers.Prefer || ""));

  // ---- a failed write is a real error, never a false ok --------------------
  nextRes = { ok: false, status: 401, text: async () => JSON.stringify({ message: "permission denied" }) };
  let threw = null;
  try { await S.upsertOpp({ slug: "x" }); } catch (e) { threw = e; }
  ck("a non-2xx write throws with the real message and status", threw && threw.status === 401 && /permission denied/.test(threw.message));
  const pr = await S.probe();
  ck("probe returns a real failure reason, never a false ok", pr.ok === false && !!pr.reason, pr);
  nextRes = { ok: true, status: 200, text: async () => "[]" };
  const pr2 = await S.probe();
  ck("probe reports ok only on a real 2xx", pr2.ok === true);

  // ---- ISOLATION: Lotus is referenced nowhere in the shipped code ----------
  function walk(dir) {
    let out = [];
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f); const st = fs.statSync(p);
      if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) out = out.concat(walk(p)); }
      else if (/\.(js|html|css|sql|md|json)$/.test(f)) out.push(p);
    }
    return out;
  }
  const files = walk(path.join(ROOT, "library")).concat(walk(path.join(ROOT, "docs")), walk(path.join(ROOT, "tools")));
  const lotusHits = [];
  files.forEach(p => {
    const txt = fs.readFileSync(p, "utf8");
    // this test file names "Lotus" only inside string labels; skip itself
    if (p.endsWith("supabase_stage1_test.js")) return;
    if (/lotus|Lotus-?V?1/i.test(txt)) lotusHits.push(path.relative(ROOT, p));
  });
  ck("no Lotus reference anywhere in library, docs, or tools (project, key, or table)", lotusHits.length === 0, lotusHits.join(", "));

  // ---- ISOLATION: no hardcoded project URL or key in the client ------------
  const clientSrc = fs.readFileSync(path.join(ROOT, "library/supabase.js"), "utf8");
  ck("the client hardcodes no supabase project URL", !/https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i.test(clientSrc));
  ck("every reachable table in the client is console_ prefixed",
    (clientSrc.match(/console_[a-z]+/g) || []).length > 0 && !/["'](opp_|jood_)/.test(clientSrc));

  console.log("\n" + (fails ? ("FAILED: " + fails + " check(s)") : "ALL SUPABASE STAGE 1 CHECKS PASS"));
  process.exit(fails ? 1 : 0);
})();
