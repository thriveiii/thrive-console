// Transit-cycle isolation gate: fails-when-broken checks for the per-cycle marker.
//
// Operations is a TRANSIT, not a ledger. A re-upload reuses the console_opps row (merge-duplicates on slug) and
// the console_board view joins the append-only ledger by bare slug, so an OLD transit's sends/opens re-attach to
// the freshly uploaded card. The fix: a "cycle" id on the opp (bumped on every upload) and on each send/hit, and
// the view counts a ledger row only when (row.cycle = opp.cycle) OR (both null). This test reproduces that exact
// predicate on synthetic rows (so a drift in the view rule fails a case) AND source-checks that the client stamps
// the cycle on upload and send, and passes it through on the relay hit write.
//
// Pure Node, no network, no database. Run: node tools/transit_cycle_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

// ---- the view rule, transcribed verbatim from docs/supabase-live-verified.sql --------------------------------
// mail_sends:  and ((m.cycle = mo.cycle) or (m.cycle is null and mo.cycle is null))
// opens:       and ((h.cycle = ho.cycle) or (h.cycle is null and ho.cycle is null))
// This is the SAME predicate for both; a SQL null equality is never true, so model that faithfully: when either
// side is null the equality arm is false, and only the both-null arm can match.
function countsForCycle(rowCycle, oppCycle) {
  const eqArm = rowCycle != null && oppCycle != null && rowCycle === oppCycle; // (x = y): null on either side -> not true
  const bothNull = rowCycle == null && oppCycle == null;
  return eqArm || bothNull;
}

// Count opens for one opp given its cycle and a set of hit rows (each { cycle }).
function openCount(oppCycle, hits) {
  return hits.filter((h) => countsForCycle(h.cycle, oppCycle)).length;
}

// ---- (a) an opp on cycle B with only OLD (cycle A) hits shows 0 opens ------------------------------------------
const oldHits = [{ cycle: "A" }, { cycle: "A" }, { cycle: "A" }];
ck("(a) opp cycle=B, hits all cycle=A (old transit) -> 0 opens (no inheritance)",
   openCount("B", oldHits) === 0, "got " + openCount("B", oldHits));

// ---- (b) hits of the current cycle (B) count ------------------------------------------------------------------
const mixed = [{ cycle: "A" }, { cycle: "B" }, { cycle: "B" }, { cycle: null }];
ck("(b) opp cycle=B, hits mix A/B/null -> only the 2 cycle=B hits count",
   openCount("B", mixed) === 2, "got " + openCount("B", mixed));

// ---- (c) a legacy opp (cycle NULL) with NULL hits behaves exactly as today ------------------------------------
const legacyHits = [{ cycle: null }, { cycle: null }];
ck("(c) legacy opp cycle=null, hits cycle=null -> all count (unchanged from today)",
   openCount(null, legacyHits) === 2, "got " + openCount(null, legacyHits));
// and a legacy opp does NOT accidentally count a cycled hit (a later re-upload's stray hit)
ck("(c) legacy opp cycle=null does NOT count a cycled (non-null) hit",
   openCount(null, [{ cycle: "A" }]) === 0, "got " + openCount(null, [{ cycle: "A" }]));

// The same predicate governs mail_sends; assert it directly so a divergence in either CTE is caught.
ck("(a/b) send rule: an old-cycle send (A) does not count for a cycle-B opp",
   countsForCycle("A", "B") === false);
ck("(a/b) send rule: a current-cycle send (B) counts for a cycle-B opp",
   countsForCycle("B", "B") === true);
ck("(c) send rule: a null-null legacy send counts (unchanged)",
   countsForCycle(null, null) === true);

// ---- the view file actually carries this predicate (guard against a silent revert) ----------------------------
const view = fs.readFileSync(path.join(ROOT, "docs/supabase-live-verified.sql"), "utf8");
ck("view: mail_sends scopes by cycle ((m.cycle = mo.cycle) or both null)",
   /\(\(m\.cycle = mo\.cycle\) or \(m\.cycle is null and mo\.cycle is null\)\)/.test(view), "predicate missing in mail_sends");
ck("view: opens scopes by cycle ((h.cycle = ho.cycle) or both null)",
   /\(\(h\.cycle = ho\.cycle\) or \(h\.cycle is null and ho\.cycle is null\)\)/.test(view), "predicate missing in opens");
ck("view: the opp's cycle is exposed in the final select",
   /o\.cycle\s+as cycle/.test(view), "o.cycle not exposed");

// ---- the migration is additive-only (ADD COLUMN IF NOT EXISTS), no destructive statements ---------------------
const mig = fs.readFileSync(path.join(ROOT, "docs/sql/transit_cycle.sql"), "utf8");
["console_opps", "console_mail", "console_hits"].forEach((t) => {
  const re = new RegExp("alter table public\\." + t + "\\s+add column if not exists cycle text", "i");
  ck("migration: additive add of cycle on " + t, re.test(mig), "guarded add missing for " + t);
});
ck("migration: no destructive drop/delete/truncate",
   !/\b(drop\s+(table|column)|delete\s+from|truncate)\b/i.test(mig), "found a destructive statement");

// ---- (d) re-upload bumps the opp cycle to a NEW value ---------------------------------------------------------
const upload = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
// upCommit's oppUpsert must pass a freshly-generated cycle (upNewCycle), not a constant.
ck("(d) upCommit stamps a fresh cycle on (re-)upload (cycle:upNewCycle())",
   /oppUpsert\([^)]*cycle:\s*upNewCycle\(\)/.test(upload) || /cycle:\s*upNewCycle\(\)/.test(upload),
   "upCommit does not call upNewCycle()");
// upNewCycle must produce distinct ids across calls (so two uploads = two transits). Extract by balanced braces
// (the helper is a one-liner, so a lazy regex would over-match) and run it.
function extractFn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}
const fn = extractFn(upload, "upNewCycle");
ck("(d) upNewCycle is defined", !!fn, "helper not found");
if (fn) {
  const upNewCycle = new Function(fn + "\nreturn upNewCycle;")();
  const a = upNewCycle(), b = upNewCycle();
  ck("(d) upNewCycle yields a truthy id", !!a && typeof a === "string", String(a));
  ck("(d) two calls yield DISTINCT cycles (re-upload starts a clean transit)", a !== b, a + " vs " + b);
}

// ---- send stamps the opp's current cycle; relay hit passes the cycle through -----------------------------------
const send = fs.readFileSync(path.join(ROOT, "tools/board-send.src.js"), "utf8");
ck("send: mailRow stamps cycle from the board row (cycle:(row && row.cycle) || null)",
   /cycle:\s*\(row && row\.cycle\)\s*\|\|\s*null/.test(send), "mailRow does not stamp cycle");
const bundle = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");
ck("bundle: BOARD_QUERY selects cycle (so row.cycle reaches the send)",
   /select=[^"']*\bcycle\b/.test(bundle), "cycle not in BOARD_QUERY select");
const relay = fs.readFileSync(path.join(ROOT, "relay/thrive-relay.gs"), "utf8");
ck("relay: supaHitRow_ passes cycle through (cycle:(e && e.cycle) || null)",
   /cycle:\s*\(e && e\.cycle\)\s*\|\|\s*null/.test(relay), "hit row does not carry cycle");

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
