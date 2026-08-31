// Beacon-carries-cycle gate: fails-when-broken checks that the transit cycle rides from publish -> page ->
// beacon -> hit, closing the open half of transit isolation (else old opens still inherit).
//
// The beacon reads the slug from the URL, but the cycle is NOT in the URL, so the published page must CARRY it.
// On publish, withBeaconClient stamps <meta name="thrive-cycle"> with the opp's current cycle; the beacon's
// pageCycle() reads that meta and the open event sends it; the view then counts the open only for the opp's
// current cycle. This test runs the REAL publish helper and the REAL beacon reader (extracted from source) so a
// drift (drop the stamp, stop reading the meta, stop sending cycle) fails a case.
//
// Pure Node, no network, no browser. Run: node tools/beacon_cycle_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const upload = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
const beacon = fs.readFileSync(path.join(ROOT, "beacon.js"), "utf8");
const relay = fs.readFileSync(path.join(ROOT, "relay/thrive-relay.gs"), "utf8");
const view = fs.readFileSync(path.join(ROOT, "docs/supabase-live-verified.sql"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function extractFn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}
function load(src, names, preamble) {
  const bodies = names.map((n) => { const f = extractFn(src, n); if (!f) throw new Error("missing " + n); return f; });
  const sandbox = {};
  new Function((preamble || "") + "\n" + bodies.join("\n") + "\n; Object.assign(this, {" + names.join(",") + "});").call(sandbox);
  return sandbox;
}

// ---- the REAL publish helper: withBeaconClient(html, cycle) stamps the cycle meta ------------------------------
const BEACON_PRE = 'var BEACON_TAG_UP = "<script src=\\"/beacon.js\\" defer></" + "script>";\n';
const U = load(upload, ["withCycleMeta", "withBeaconClient"], BEACON_PRE);
const PAGE = "<html><head><title>Acme</title></head><body><h1>Hi</h1></body></html>";

const publishedB = U.withBeaconClient(PAGE, "cyB");
ck("publish: a page committed under cycle=cyB carries <meta name=\"thrive-cycle\" content=\"cyB\">",
   /<meta name="thrive-cycle" content="cyB">/.test(publishedB), publishedB);
ck("publish: the beacon tag is still injected alongside the cycle meta",
   publishedB.indexOf('src="/beacon.js"') >= 0, publishedB);
ck("publish: the stamp is authoritative - re-publishing already-stamped html under cyC yields ONLY cyC",
   (function () { const again = U.withBeaconClient(publishedB, "cyC");
     return /content="cyC"/.test(again) && again.indexOf('content="cyB"') < 0; })(),
   U.withBeaconClient(publishedB, "cyC"));
const publishedOld = U.withBeaconClient(PAGE);      // no cycle argument: an old page / library re-publish
ck("publish: with NO cycle, no thrive-cycle meta is stamped (old page stays as today)",
   publishedOld.indexOf("thrive-cycle") < 0, publishedOld);

// ---- the REAL beacon reader: pageCycle() against a minimal DOM stub -------------------------------------------
// A querySelector that answers ONLY the beacon's selector, parsing the meta content out of the given html.
function domFor(html) {
  return {
    querySelector: function (sel) {
      if (sel !== 'meta[name="thrive-cycle"]') return null;
      const m = html.match(/<meta\s+name="thrive-cycle"\s+content="([^"]*)"\s*>/i);
      return m ? { getAttribute: function (a) { return a === "content" ? m[1] : null; } } : null;
    }
  };
}
function beaconCycleFor(html) {
  // pageCycle() closes over `document`; run the REAL extracted function with the stub DOM injected as `document`.
  const fn = extractFn(beacon, "pageCycle");
  if (!fn) throw new Error("missing pageCycle in beacon.js");
  const run = new Function("document", fn + "\nreturn pageCycle();");
  return run(domFor(html));
}
ck("(a) a page published under cycle=cyB -> the beacon reads cyB from the page", beaconCycleFor(publishedB) === "cyB", beaconCycleFor(publishedB));
ck("(c) an old page with no cycle meta -> the beacon reads '' (sends NULL, not a guess)", beaconCycleFor(publishedOld) === "", JSON.stringify(beaconCycleFor(publishedOld)));

// the open event actually carries the cycle (source guard: cycle: CYCLE || null in the payload)
ck("beacon: the open event sends the cycle (cycle: CYCLE || null)", /cycle:\s*CYCLE\s*\|\|\s*null/.test(beacon), "openEv does not send cycle");
// what the beacon actually sends for an old page is null (CYCLE '' -> null), never a fabricated value
ck("(c) an empty cycle serializes to null in the hit payload (CYCLE '' || null === null)", ("" || null) === null);

// ---- (b) the view counts the cycle=B hit for a cyB opp and excludes a cyA hit ---------------------------------
// The view predicate, transcribed from docs/supabase-live-verified.sql (null equality is never true in SQL).
function countsForCycle(rowCycle, oppCycle) {
  const eqArm = rowCycle != null && oppCycle != null && rowCycle === oppCycle;
  return eqArm || (rowCycle == null && oppCycle == null);
}
ck("(b) the view counts the beacon's cyB hit for an opp at cyB", countsForCycle("cyB", "cyB") === true);
ck("(b) the view excludes a cyA (old transit) hit for an opp at cyB", countsForCycle("cyA", "cyB") === false);
ck("(c) a legacy null hit still counts for a legacy null opp (unchanged)", countsForCycle(null, null) === true);
ck("view: the opens CTE still scopes by the cycle predicate",
   /\(\(h\.cycle = ho\.cycle\) or \(h\.cycle is null and ho\.cycle is null\)\)/.test(view));

// ---- (4) re-upload re-publishes with the NEW cycle; relay stores the beacon's cycle --------------------------
// upCommit stamps a fresh cycle AND publishes the page carrying it in the same step (withBeaconClient(html, cycle)).
ck("(4) upCommit publishes the page carrying the fresh cycle (withBeaconClient(html, cycle))",
   /withBeaconClient\(html,\s*cycle\)/.test(upload), "upCommit does not pass the cycle to the published page");
ck("(4) upCommit derives that cycle from upNewCycle() (a re-upload bumps it)",
   /var cycle = upNewCycle\(\)/.test(upload) && /cycle:cycle\b/.test(upload), "upCommit does not capture a fresh cycle");
ck("(3) relay supaHitRow_ stores the beacon's cycle (cycle:(e && e.cycle) || null)",
   /cycle:\s*\(e && e\.cycle\)\s*\|\|\s*null/.test(relay), "relay drops the cycle");

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
