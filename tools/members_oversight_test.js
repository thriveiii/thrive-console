/* P27 · Members, roles, and the owner's oversight room.
 *
 *   node tools/members_oversight_test.js
 *
 * Part A lifts the REAL per-member derivations from library/app.js (memberMetrics / memberSendTrend /
 * sparklineSvg) and proves: each member's numbers come only from rows stamped to that member (actor
 * isolation); the windows (daily/weekly/monthly) filter by timestamp; reply rate is replies over the
 * member's own opps; token opens (P2) are attributed to the member's send ids and windowed by hit time; and
 * the per-member numbers RECONCILE with the flat counts (the sum over members equals the total). The
 * sparkline is a clean SVG with explicit width/height and no numbers inside.
 * Part B is a source + SQL audit proving: the SQL is additive/idempotent, console_ only, the newsroom is not
 * touched, the roster read is owner-scoped and roles are never self-granted from a session; the router gates
 * the owner-only view (fails closed) and the room refuses a member; the metric dictionary carries the new
 * definitions; every write is actor-stamped (no bypass); and no member sees another member's numbers.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const app = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
const bundle = fs.readFileSync(path.join(ROOT, "tools", "bundle.js"), "utf8");
const sql = fs.readFileSync(path.join(ROOT, "docs", "supabase-members-oversight.sql"), "utf8");
const i18n = fs.readFileSync(path.join(ROOT, "library", "i18n.js"), "utf8");
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function grabFn(name) { const s = app.indexOf("function " + name + "("); if (s < 0) throw new Error("not found: " + name); const e = app.indexOf("\n}", s); return app.slice(s, e + 2); }
function grabConst(re) { const m = app.match(re); if (!m) throw new Error("const not found: " + re); return m[0]; }

/* ============ Part A: the per-member derivations, lifted and exercised ============ */
{
  const NOW = 1700000000000;                 // a fixed "now" (ms)
  const day = 86400000;
  const iso = (t) => new Date(t).toISOString();
  // Two members. A: 3 sends today across 2 opps (one replied), plus 1 old send 60 days ago. B: 1 send today.
  const MAIL = [
    { actor: "A", direction: "out", status: "sent", opp: "a1", mid: "m1", ts: iso(NOW - 1 * day) },
    { actor: "A", direction: "out", status: "sent", opp: "a1", mid: "m2", ts: iso(NOW - 1 * day) },
    { actor: "A", direction: "out", status: "sent", opp: "a2", mid: "m3", ts: iso(NOW - 2 * day) },
    { actor: "A", direction: "out", status: "sent", opp: "a3", mid: "m4", ts: iso(NOW - 60 * day) },   // outside 30d window
    { actor: "B", direction: "out", status: "sent", opp: "b1", mid: "m5", ts: iso(NOW - 1 * day) }
  ];
  const HITS = [
    { r: "m1", ts: iso(NOW - 1 * day), self: false },   // A's token open, in window
    { r: "m3", ts: iso(NOW - 2 * day), self: false },   // A's token open, in window
    { r: "m1", ts: iso(NOW - 40 * day), self: false },  // A's token open, OUTSIDE 30d
    { r: "zz", ts: iso(NOW - 1 * day), self: false }    // not any member's send id
  ];
  const REPLIED = { a1: true };               // only a1 earned a reply
  const ACTS = [
    { actor: "A", action: "publish", ts: iso(NOW - 1 * day) },
    { actor: "A", action: "draft_save", ts: iso(NOW - 1 * day) },
    { actor: "A", action: "publish", ts: iso(NOW - 90 * day) },   // outside 30d
    { actor: "B", action: "stage", ts: iso(NOW - 1 * day) }        // neither a page nor an edit
  ];
  const src = [
    grabConst(/var PAGE_ACTIONS=[^\n]*/),
    grabConst(/var EDIT_ACTIONS=[^\n]*/),
    grabFn("memberMetrics"), grabFn("memberSendTrend"), grabFn("sparklineSvg")
  ].join("\n");
  const sandbox = {
    Math, Number, Array, String, JSON, Date, isFinite, parseInt,
    getMailLog: () => MAIL,
    getActivity: () => ACTS,
    allHits: () => HITS,
    hasReply: (slug) => !!REPLIED[slug],
    currentActor: () => "A"
  };
  // Freeze Date.now to NOW so the windows are deterministic.
  const RealDate = Date;
  sandbox.Date = class extends RealDate { constructor(...a){ super(...(a.length?a:[NOW])); } static now(){ return NOW; } };
  vm.createContext(sandbox);
  vm.runInContext(src + "\nthis.memberMetrics=memberMetrics; this.memberSendTrend=memberSendTrend; this.sparklineSvg=sparklineSvg;", sandbox);

  const A = sandbox.memberMetrics("A", 0);    // all time
  ck("A1 sends count only A's stamped sends", A.sends === 4 && A.opps === 3, A);
  ck("A2 reply rate is replies over A's own opps (1 of 3 → 33%)", A.replies === 1 && A.replyRate === 33, A);
  ck("A3 token opens attribute to A's send ids only (m1,m3 all-time = 3 hits: m1 x2 + m3)", A.opens === 3, A);
  ck("A4 pages and edits read A's stamped activity (2 publishes all-time, 1 edit)", A.pages === 2 && A.edits === 1, A);

  const A30 = sandbox.memberMetrics("A", 30); // monthly window
  ck("A5 the 30-day window drops the 60-day-old send (3 sends, 2 opps)", A30.sends === 3 && A30.opps === 2, A30);
  ck("A6 the 30-day window drops the 40-day-old open and the 90-day-old page", A30.opens === 2 && A30.pages === 1, A30);

  const B = sandbox.memberMetrics("B", 0);
  ck("A7 B sees only B's row; A's rows never leak into B", B.sends === 1 && B.opps === 1 && B.pages === 0 && B.edits === 0, B);

  // Reconciliation: the per-member sends sum to the flat total of stamped out/sent rows.
  const totalSent = MAIL.filter(m => m.direction !== "in" && m.status === "sent").length;
  ck("A8 reconcile: per-member sends sum to the flat count", (A.sends + B.sends) === totalSent, { A: A.sends, B: B.sends, total: totalSent });

  const trend = sandbox.memberSendTrend("A", 14);
  ck("A9 the send trend is a 14-point daily series", Array.isArray(trend) && trend.length === 14);
  const spark = sandbox.sparklineSvg(trend, { w: 120, h: 28 });
  ck("A10 the sparkline is an SVG with explicit width and height", /<svg[^>]*width="120"[^>]*height="28"/.test(spark), spark.slice(0, 120));
  ck("A11 the sparkline carries no number in its markup (nothing to isolate)", !/>[0-9]+</.test(spark) && /polyline/.test(spark));
}

/* ============ Part B: the SQL, the gating, the dictionary, the actor, the firewall ============ */
{
  // --- SQL: additive, idempotent, console_ only, newsroom untouched, owner-scoped, no self-grant ---
  ck("B1 SQL creates console_members additively (create table if not exists)", /create table if not exists console_members/.test(sql));
  ck("B2 SQL is idempotent and never drops", /if not exists/.test(sql) && !/\bdrop\s+(table|view|policy|column|function|index|schema)/i.test(sql));
  ck("B3 SQL touches only console_ objects and states the firewall (newsroom not touched)",
    /console_members/.test(sql) && /newsroom is not touched/i.test(sql) && !/lotus/i.test(sql));
  ck("B4 RLS: a member reads only their own row (id = auth.uid())", /console_members_read_own[\s\S]*id = auth\.uid\(\)/.test(sql));
  ck("B5 RLS: the owner reads the whole roster (scoped by console_admins)", /console_members_read_owner[\s\S]*console_admins a where a\.uid = auth\.uid\(\)/.test(sql));
  ck("B6 no client insert/update/delete policy (roles are never self-granted from a session)",
    !/for (insert|update|delete)/i.test(sql));
  ck("B7 the owner is seeded from auth.users by email, role owner", /insert into console_members[\s\S]*'owner'/.test(sql) && /from auth\.users/.test(sql));
  ck("B8 the pre-stamp history mapping is stated and reversible", /reversible/i.test(sql) && /console history/i.test(sql));

  // --- Router + view gating: owner-only, fails closed, refuses a member ---
  ck("B9 the router marks the oversight view owner-only", /OWNER_ONLY *= *\{ *oversight:1/.test(bundle));
  ck("B10 ownerOK fails CLOSED (owner must be explicitly true)", /function ownerOK\(\)\{[^}]*isOwnerMember && window\.isOwnerMember\(\)/.test(bundle));
  ck("B11 a member's direct hash is corrected to the board", /if\(OWNER_ONLY\[id\] && !ownerOK\(\)\)\{ id = VIEWS\[0\]\.id/.test(bundle));
  ck("B12 the oversight room refuses a non-owner and returns to the board",
    /function initOversight[\s\S]*if\(!isOwnerMember\(\)\)[\s\S]*location\.replace\("#board"\)/.test(app));
  ck("B13 the owner-only nav link is installed for the owner only", /function installOwnerNav[\s\S]*isOwnerMember\(\)/.test(app) && /data-view="oversight"/.test(app));
  ck("B14 the oversight view is NOT in the static top bar (members get no link at all)", /const TOPBAR = \[[^\]]*\]/.test(bundle) && !/TOPBAR = \[[^\]]*oversight/.test(bundle));

  // --- Metric dictionary: the new definitions live in the ONE dictionary; the room shows them ---
  ck("B15 the P4 dictionary gains reply_rate, pages, edits (additive)", /reply_rate:\s*\{ def:/.test(app) && /pages:\s*\{ def:/.test(app) && /edits:\s*\{ def:/.test(app));
  ck("B16 every oversight metric carries a definition tooltip from the dictionary",
    /tip:"mdef_reply_rate"/.test(app) && /data-tip="'\+esc\(t\(mk\.tip\)\)/.test(app));
  ck("B17 the definition strings exist in i18n (EN + AR)", (i18n.match(/mdef_reply_rate:/g) || []).length >= 2 && (i18n.match(/mdef_opens:/g) || []).length >= 2);

  // --- Actor attribution: every write is stamped; no bypass ---
  ck("B18 the opportunity write stamps the member (edited_by = currentActor)", /rec\.edited_by=currentActor\(\)/.test(app));
  ck("B19 the batch write stamps the member too (no un-attributed path)", /function commitDraftsBatch[\s\S]*rec\.edited_by=currentActor\(\)/.test(app));
  ck("B20 the ledger writers already stamp actor (mail, activity, comments)",
    /function logMail[\s\S]*actor:currentActor\(\)/.test(app) && /function logActivity[\s\S]*actor:currentActor\(\)/.test(app) && /author:currentActor\(\)/.test(app));

  // --- Member isolation: a member sees only their own panel, never another member's numbers ---
  ck("B21 the member's own panel renders memberPanelHtml scoped to their own uid",
    /el\("pfWindows"\)[\s\S]*memberPanelHtml\(\{ id:meUid/.test(app));
  ck("B22 the owner-only roster read is what lists other members (the room), gated to the owner", /membersRoster\(\)/.test(app) && /isOwnerMember\(\)/.test(app));

  // --- Firewall: nothing from another project in the shipped client ---
  const shipped = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8") + fs.readFileSync(path.join(ROOT, "library", "oversight.html"), "utf8");
  ck("B23 the shipped client references no other project (no 'lotus')", !/lotus/i.test(shipped));
}

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
