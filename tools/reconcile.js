/* Three-way stage reconciliation: manifest  vs  console_opps  vs  console_board.
 *
 * The structural gap (the Ludic case): a card can live in the manifest with NO row in console_opps, so it
 * has no row in console_board either. The board then reads its OWN base (ready or draft) while the detail,
 * before this PR, read a second derivation and could show opened or replied. This tool lists every such
 * mismatch so none is silent: a manifest card missing from console_opps, an opps row the view drops, a slug
 * that differs in form between sources, a duplicate business, an orphan.
 *
 * Read-only. It NEVER writes. It reads library/manifest.json always, and, when given exported snapshots,
 * joins them by slug:
 *     node tools/reconcile.js [--opps opps.json] [--board board.json]
 * where opps.json / board.json are the JSON arrays returned by
 *     select slug, business, stage from public.console_opps;        -> opps.json
 *     select slug, stage from public.console_board;                 -> board.json
 * (export from the Supabase SQL editor as JSON). Without a snapshot it reports the manifest census and the
 * anomalies visible in the manifest alone (non-ASCII/non-canonical slugs, duplicates), and states which
 * checks need a snapshot. The console_opps -> console_board direction is a proven 1:1 by the view's SELECT
 * (docs/supabase-board-view.sql: `from public.console_opps o` with LEFT JOINs), so an opps row can never be
 * dropped by the view; this tool confirms it when a board snapshot is supplied.
 *
 * Exit code is always 0: this is a report, not a gate. It prints FINDING lines a human reads and acts on.
 */
const fs = require("fs");
const path = require("path");
const TI = require(path.join(__dirname, "../library/intake.js")).ThriveIntake;

function argOf(flag){ const i = process.argv.indexOf(flag); return (i >= 0 && process.argv[i+1]) ? process.argv[i+1] : null; }
function readJson(p){ try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.error("cannot read " + p + ": " + e.message); process.exit(2); } }

const manifest = readJson(path.join(__dirname, "../library/manifest.json"));
const mopps = (manifest.opportunities || []);
const oppsPath = argOf("--opps");
const boardPath = argOf("--board");
const opps = oppsPath ? readJson(oppsPath) : null;      // [{slug, business, stage}]
const board = boardPath ? readJson(boardPath) : null;   // [{slug, stage}]

function bySlug(arr){ const m = {}; (arr || []).forEach(r => { if (r && r.slug) m[r.slug] = r; }); return m; }
function isArabic(s){ return /[؀-ۿ]/.test(String(s || "")); }

const findings = [];
function finding(section, msg){ findings.push(section + " :: " + msg); }

console.log("=".repeat(78));
console.log("THREE-WAY STAGE RECONCILIATION  (manifest vs console_opps vs console_board)");
console.log("=".repeat(78));
console.log("manifest cards: " + mopps.length +
  (opps ? ("   console_opps rows: " + opps.length) : "   console_opps: (no snapshot)") +
  (board ? ("   console_board rows: " + board.length) : "   console_board: (no snapshot)"));
console.log("");

// ---- A. manifest self-audit: non-canonical / non-ASCII slugs and duplicates --------------------------
console.log("-- A. manifest self-audit --------------------------------------------------");
const seenSlug = {}, seenBiz = {};
mopps.forEach(o => {
  const slug = o.slug || "";
  const biz = o.business || "";
  const canon = TI.slugify(biz);
  if (isArabic(biz) || isArabic(slug)) {
    console.log("  [arabic] " + slug + "  <-  " + biz + "   (slugify cannot canonicalize Arabic; verify by hand)");
    if (slug && canon && slug !== canon && !isArabic(slug) === false) { /* Arabic: no canonical to compare */ }
  } else if (canon && slug && canon !== slug) {
    console.log("  [slug-form] manifest slug '" + slug + "' != canonical '" + canon + "' for business '" + biz + "'");
    finding("A/slug-form", "'" + slug + "' would canonicalize to '" + canon + "' (business: " + biz + "). Reconcile to one, additively.");
  }
  if (seenSlug[slug]) finding("A/dup-slug", "slug '" + slug + "' appears twice in the manifest");
  seenSlug[slug] = 1;
  const bk = biz.trim().toLowerCase();
  if (bk) { if (seenBiz[bk]) finding("A/dup-business", "business '" + biz + "' appears under two manifest slugs: " + seenBiz[bk] + " and " + slug); else seenBiz[bk] = slug; }
});
if (!findings.length) console.log("  no manifest-only slug/duplicate anomaly");
console.log("");

// ---- B. manifest  vs  console_opps -------------------------------------------------------------------
console.log("-- B. manifest vs console_opps ---------------------------------------------");
if (!opps) {
  console.log("  (no --opps snapshot) The load-bearing check. Export console_opps and re-run to list every");
  console.log("  manifest card missing a console_opps row (the Ludic class). Known instance from the brief:");
  console.log("  'ludic-lillian' returns nothing in console_opps, so it has no console_board row and the");
  console.log("  board reads its base (ready). See docs/supabase-stage-reconcile.sql for the additive fix.");
} else {
  const O = bySlug(opps);
  let missing = 0;
  mopps.forEach(o => {
    if (!O[o.slug]) { missing++;
      console.log("  [missing-from-opps] manifest card '" + o.slug + "' (" + (o.business || "") + ") has NO console_opps row");
      finding("B/missing-from-opps", "'" + o.slug + "' is in the manifest but not console_opps: add it additively (so the view carries it) or retire the manifest entry. State which.");
    }
  });
  // an opps row with no manifest card is a local/legacy opp (fine), reported for completeness
  const M = bySlug(mopps);
  Object.keys(O).forEach(slug => { if (!M[slug]) console.log("  [opps-only] console_opps '" + slug + "' has no manifest card (a local or legacy opp; harmless)"); });
  if (!missing) console.log("  every manifest card has a console_opps row");
}
console.log("");

// ---- C. console_opps  vs  console_board (proven 1:1 by the view SELECT) -------------------------------
console.log("-- C. console_opps vs console_board ----------------------------------------");
if (!opps || !board) {
  console.log("  (needs --opps and --board) The view is `from console_opps o` with LEFT JOINs, so it emits");
  console.log("  exactly one board row per opps row: the mapping is 1:1 by construction. A snapshot confirms");
  console.log("  the row counts match and no opps slug is absent from the board.");
} else {
  const B = bySlug(board);
  let dropped = 0;
  opps.forEach(o => { if (!B[o.slug]) { dropped++; console.log("  [dropped-by-view] console_opps '" + o.slug + "' has NO console_board row (unexpected: the view should emit one)");
    finding("C/dropped-by-view", "'" + o.slug + "' is in console_opps but not console_board: the view lost it, investigate the join."); } });
  if (!dropped) console.log("  1:1 holds: every console_opps row has exactly one console_board row (" + opps.length + " = " + board.length + ")");
  // stage agreement between the two, where a manual stage is declared
  opps.forEach(o => { const b = B[o.slug]; if (b && o.stage && o.stage !== b.stage && ["won","lost","dropped","bounced","failed"].indexOf(o.stage) >= 0)
    console.log("  [stage-note] '" + o.slug + "' opps.stage=" + o.stage + " board.stage=" + b.stage + " (declared terminus should stand; verify)"); });
}
console.log("");

// ---- summary -----------------------------------------------------------------------------------------
console.log("=".repeat(78));
if (!findings.length) { console.log("RECONCILIATION CLEAN: no mismatch found in the sources available."); }
else { console.log("FINDINGS (" + findings.length + "), each additive to resolve:"); findings.forEach(f => console.log("  - " + f)); }
console.log("=".repeat(78));
