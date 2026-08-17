/* The provable audit's MECHANICAL inventory. It derives the checklist from the source, never from memory:
 * every console_* column from the schema SQL, every render surface and card state from the code, and every
 * wired user action (button handler) from the code. It prints the lists and the counts, so completeness is
 * visible and Thyab can re-run it and get the same result. If a mechanically-derived item is not in the
 * audit ledger, the audit is incomplete.
 *
 *   node tools/audit_inventory.js            # human-readable report with counts
 *   node tools/audit_inventory.js --json     # machine-readable, for the ledger table
 *
 * Read-only. It parses files; it changes nothing.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = p => { try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch (e) { return ""; } };
const uniq = a => Array.from(new Set(a)).sort();

// ---- A. COLUMNS: every public console_* table, from the schema SQL (create table + alter add column) ----
function columns() {
  const sqlDir = path.join(ROOT, "docs");
  const files = fs.readdirSync(sqlDir).filter(f => f.endsWith(".sql")).map(f => "docs/" + f);
  const tables = {};   // table -> Set(columns)
  const put = (t, c) => { t = t.replace(/^public\./, ""); (tables[t] = tables[t] || new Set()).add(c); };
  for (const f of files) {
    const s = read(f);
    // create table [if not exists] [public.]console_x ( col type, ... \n);  - the closing paren is on its own
    // line, so anchor to "\n)" (a ")" inside an inline comment, e.g. "-- the id (gid)", must not end the body).
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(public\.)?(console_[a-z_]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = re.exec(s))) {
      const t = m[2];
      // one column per line: strip the inline "-- comment", take the first identifier token, skip constraints
      const body = m[3];
      body.split(/\n/).forEach(raw => {
        const line = raw.replace(/--.*$/, "").trim();
        if (!line) return;
        const c = line.split(/\s+/)[0].replace(/[(),]/g, "");
        if (c && /^[a-z_][a-z0-9_]*$/i.test(c) &&
            !/^(primary|foreign|unique|constraint|check|references|create|table)$/i.test(c)) put(t, c);
      });
    }
    // alter table [public.]console_x add column [if not exists] col type;
    const re2 = /alter\s+table\s+(public\.)?(console_[a-z_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((m = re2.exec(s))) put(m[2], m[3]);
  }
  const out = {};
  Object.keys(tables).sort().forEach(t => out[t] = uniq(Array.from(tables[t])));
  return out;
}

// ---- B. SURFACES: every render function + every card modal tab, from the code ----
function surfaces() {
  const app = read("library/app.js");
  const renders = uniq((app.match(/function\s+(render[A-Z][A-Za-z0-9]*)/g) || [])
    .map(x => x.replace("function ", "")));
  // the card modal tabs are opened by thriveModal.open(slug, "<tab>", ...): collect the literal tab names
  const tabs = uniq((app.match(/thriveModal\.open\([^,]+,\s*"([a-z]+)"/g) || [])
    .map(x => (x.match(/"([a-z]+)"$/) || [])[1]).filter(Boolean));
  // the top-level views (the SPA screens), from the console shell markup
  const html = read("library/console.html");
  const views = uniq((html.match(/id="view-[a-z]+"/g) || []).map(x => x.replace('id="view-', "").replace('"', "")));
  return { renders, tabs, views };
}

// ---- C. FLOWS: every wired user action (a click handler, a lifecycle move, a data-action) ----
function flows() {
  const app = read("library/app.js");
  // el("X").addEventListener("click", ...) and el(...).onclick: the id names the action
  const byId = uniq((app.match(/el\("([a-zA-Z0-9_]+)"\)[^;]*addEventListener\("click"/g) || [])
    .map(x => (x.match(/el\("([a-zA-Z0-9_]+)"\)/) || [])[1]).filter(Boolean));
  // the lifecycle moves: the terminal CLOSE_MOVES array literal + the promotion "primary" map keys
  const closeArr = (app.match(/const CLOSE_MOVES=\[([^\]]*)\]/) || ["", ""])[1];
  const closeMoves = (closeArr.match(/"([a-z_]+)"/g) || []).map(x => x.replace(/"/g, ""));
  const primBlock = (app.match(/const primary=\{([^}]*)\}/) || ["", ""])[1];
  const primMoves = (primBlock.match(/([a-z_]+):1/g) || []).map(x => x.replace(":1", ""));
  const moves = uniq(closeMoves.concat(primMoves));
  // data-<action> hooks bound in the board/modal (data-open-slug, data-reopen, data-retryrec, data-ovcopy...)
  const dataActs = uniq((app.match(/querySelectorAll\("\[data-([a-z-]+)\]"\)/g) || [])
    .map(x => (x.match(/data-([a-z-]+)/) || [])[1]).filter(Boolean));
  return { buttons: byId, moves, dataActions: dataActs };
}

// ---- D. VISUAL STATES: the one visual-state law + the emphasis classes it maps to ----
function states() {
  const app = read("library/app.js");
  // cardState returns exactly these state strings
  const st = uniq((app.match(/return "(failed|in-flight|new-activity|awaiting-action|settled)"/g) || [])
    .map(x => (x.match(/"([a-z-]+)"/) || [])[1]));
  // the STATE_CLASS map: state -> emphasis class
  const mapBlock = (app.match(/const STATE_CLASS = \{[^}]*\}/) || [""])[0];
  const emphasis = uniq((mapBlock.match(/"(is-[a-z]+|has-reply)"/g) || []).map(x => x.replace(/"/g, "")));
  return { states: st, emphasisClasses: emphasis };
}

const inv = { columns: columns(), surfaces: surfaces(), flows: flows(), states: states() };
const colCount = Object.values(inv.columns).reduce((n, c) => n + c.length, 0);
const counts = {
  console_tables: Object.keys(inv.columns).length,
  columns: colCount,
  render_surfaces: inv.surfaces.renders.length,
  modal_tabs: inv.surfaces.tabs.length,
  spa_views: inv.surfaces.views.length,
  flow_buttons: inv.flows.buttons.length,
  lifecycle_moves: inv.flows.moves.length,
  data_actions: inv.flows.dataActions.length,
  visual_states: inv.states.states.length,
  emphasis_classes: inv.states.emphasisClasses.length,
};

if (process.argv.indexOf("--json") >= 0) { console.log(JSON.stringify({ counts, inventory: inv }, null, 2)); process.exit(0); }

console.log("=".repeat(78));
console.log("MECHANICAL AUDIT INVENTORY  (derived from schema + code, not memory)");
console.log("=".repeat(78));
console.log("\nCOUNTS: " + Object.entries(counts).map(([k, v]) => k + "=" + v).join("  "));
console.log("\n-- A. COLUMNS (" + counts.columns + " across " + counts.console_tables + " console_* tables) --");
Object.entries(inv.columns).forEach(([t, cols]) => console.log("  " + t + " (" + cols.length + "): " + cols.join(", ")));
console.log("\n-- B. SURFACES --");
console.log("  render functions (" + inv.surfaces.renders.length + "): " + inv.surfaces.renders.join(", "));
console.log("  modal tabs (" + inv.surfaces.tabs.length + "): " + inv.surfaces.tabs.join(", "));
console.log("  SPA views (" + inv.surfaces.views.length + "): " + inv.surfaces.views.join(", "));
console.log("\n-- C. FLOWS --");
console.log("  button handlers (" + inv.flows.buttons.length + "): " + inv.flows.buttons.join(", "));
console.log("  lifecycle moves (" + inv.flows.moves.length + "): " + inv.flows.moves.join(", "));
console.log("  data-action hooks (" + inv.flows.dataActions.length + "): " + inv.flows.dataActions.join(", "));
console.log("\n-- D. VISUAL STATES --");
console.log("  states (" + inv.states.states.length + "): " + inv.states.states.join(", "));
console.log("  emphasis classes (" + inv.states.emphasisClasses.length + "): " + inv.states.emphasisClasses.join(", "));
console.log("\n" + "=".repeat(78));
