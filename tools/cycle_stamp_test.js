// cycle-stamp gate: fails-when-broken proof that the LIVE served shell stamps console_mail.cycle and
// console_hits.cycle with the opp's CURRENT transit cycle, resolved by slug, and never invents one.
//
// Bug (JOURNEY_LEDGER_TRACE, section B): the served shell's supaMailRow/supaHitRow emitted no cycle, so every
// send/open was null-cycle; a cycled opp (opp.cycle set) then dropped its own sends from console_board because
// mail_sends counts only when (m.cycle = mo.cycle) OR both null. The opp's cycle was also not even readable
// (hydrate was select=slug,data; cycle is a top-level column). Option A: widen the hydrate + supaOppFromRow so
// the cycle reaches the in-memory opp, round-trip it in supaRowFromOpp, then stamp it at the two write sites.
//
// This runs the REAL supaMailRow, supaHitRow, supaOppFromRow and supaRowFromOpp extracted verbatim from
// app.js, over a stub getDraft. Pure Node. Run: node tools/cycle_stamp_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 220)); }
}
function fnSrc(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return "";
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}

// A shared stub store: the write sites resolve the opp by slug through getDraft.
let DRAFTS = {};
function getDraft(slug) { return DRAFTS[slug]; }
function hitKey(e) { return "hk:" + ((e && e.slug) || "") + ":" + ((e && e.ts) || ""); }

const supaMailRow = new Function("getDraft", fnSrc(app, "function supaMailRow(") + "\nreturn supaMailRow;")(getDraft);
// supaHitRow does NOT resolve by getDraft: an open keeps the cycle the hit itself carried (e.cycle, from the
// beacon), mirroring the relay. Only hitKey is needed.
const supaHitRow  = new Function("hitKey", fnSrc(app, "function supaHitRow(") + "\nreturn supaHitRow;")(hitKey);
const supaOppFromRow = new Function(fnSrc(app, "function supaOppFromRow(") + "\nreturn supaOppFromRow;")();
const supaRowFromOpp = new Function(fnSrc(app, "function supaRowFromOpp(") + "\nreturn supaRowFromOpp;")();

// ---- the reach: supaOppFromRow carries the top-level cycle column onto the in-memory opp ----
const opp = supaOppFromRow({ slug: "underdog-coffee-bread", data: { business: "Underdog" }, cycle: "cy_abc123" });
ck("supaOppFromRow carries the top-level cycle column onto the opp (the reach that was missing)", opp.cycle === "cy_abc123", opp);
const oppLegacy = supaOppFromRow({ slug: "legacy", data: { business: "L" }, cycle: null });
ck("a legacy opp (cycle null on the server) carries no cycle (stays null-able)", oppLegacy.cycle === undefined || oppLegacy.cycle === null, oppLegacy);

// ---- round-trip: supaRowFromOpp writes cycle top-level, never inside data ----
const row = supaRowFromOpp({ slug: "underdog-coffee-bread", business: "Underdog", cycle: "cy_abc123", html: "<p>x</p>" });
ck("supaRowFromOpp writes cycle as a TOP-LEVEL column (round-trips a served-client edit)", row.cycle === "cy_abc123", row);
ck("supaRowFromOpp does NOT duplicate cycle inside data (kept in its own column, like html)", row.data.cycle === undefined, row.data);
const rowLegacy = supaRowFromOpp({ slug: "legacy", business: "L" });
ck("supaRowFromOpp writes null cycle for an opp that has none (never invents one)", rowLegacy.cycle === null, rowLegacy);

// ---- the mail stamp: cycle = the opp's current cycle, by slug ----
DRAFTS = { "underdog-coffee-bread": { slug: "underdog-coffee-bread", cycle: "cy_abc123" }, "legacy": { slug: "legacy" } };
const mailCycled = supaMailRow({ mid: "m1", opp: "underdog-coffee-bread", to: "a@b.com", subject: "Hi", status: "sent", actor: "u1" });
ck("supaMailRow stamps the send with the opp's CURRENT cycle (fixes the dropped-send bug)", mailCycled.cycle === "cy_abc123", mailCycled);
ck("the mail row keeps its other columns intact (opp, to_addr, subject, actor)",
   mailCycled.opp === "underdog-coffee-bread" && mailCycled.to_addr === "a@b.com" && mailCycled.subject === "Hi" && mailCycled.actor === "u1", mailCycled);

const mailLegacy = supaMailRow({ mid: "m2", opp: "legacy", to: "a@b.com", subject: "Hi", status: "sent" });
ck("supaMailRow stamps null for an opp with no cycle (legacy null-null match holds, no regression)", mailLegacy.cycle === null, mailLegacy);

const mailUnloaded = supaMailRow({ mid: "m3", opp: "not-in-store", to: "a@b.com", subject: "Hi", status: "sent" });
ck("supaMailRow stamps null when the opp is not in the store (never invents a cycle)", mailUnloaded.cycle === null, mailUnloaded);

// ---- the hit stamp: cycle = the cycle the OPEN carried (e.cycle, the page's transit), NOT the opp's current
//      cycle. This is Axiom 4 (an open keeps the transit it was captured in) and mirrors the relay writer. ----
const hitCycled = supaHitRow({ slug: "underdog-coffee-bread", type: "open", ts: "2026-09-03T00:00:00Z", self: false, cycle: "cy_page7" });
ck("supaHitRow stamps the open with the cycle the hit carried (e.cycle, the page's transit at open time)", hitCycled.cycle === "cy_page7", hitCycled);
ck("the hit row keeps its other columns intact (slug, type, self)",
   hitCycled.slug === "underdog-coffee-bread" && hitCycled.type === "open" && hitCycled.self === false, hitCycled);
ck("supaHitRow does NOT use the opp's current cycle (a re-upload never re-scopes a past open, Axiom 4)",
   hitCycled.cycle !== "cy_abc123", hitCycled);
const hitLegacy = supaHitRow({ slug: "underdog-coffee-bread", type: "open", ts: "2026-09-03T00:00:00Z" });
ck("supaHitRow stamps null when the hit carried no cycle (old page, no thrive-cycle meta; never a guess)", hitLegacy.cycle === null, hitLegacy);

// ---- source guards ----
ck("the opp hydrate selects the cycle column (select=slug,data,cycle)", app.indexOf('"select=slug,data,cycle"') >= 0);
ck("supaMailRow emits a cycle key resolved from getDraft(rec.opp)", /getDraft\(rec\.opp\|\|""\)[\s\S]*cycle:_cycle/.test(fnSrc(app, "function supaMailRow(")));
ck("supaHitRow emits cycle from the hit event (e.cycle), mirroring the relay writer byte-for-byte",
   /cycle:\(e&&e\.cycle\)\|\|null/.test(fnSrc(app, "function supaHitRow(")) && fnSrc(app, "function supaHitRow(").indexOf("getDraft") < 0);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
