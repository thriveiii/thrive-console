// upload-never-drops gate: fails-when-broken proof that an upload whose slug collides with an ARCHIVED card
// is inserted as a fresh, suffixed NEW operation instead of being silently dropped (Axiom 3).
//
// Production bug (owner escalation): a zip of three opps whose slugs already existed as ARCHIVED cards was
// approved, matched in the preview with full messages, and then NONE were written to the board - in any lane.
// Root cause in writeImport: importPlan returns "decision" for an archived slug; with no explicit it.decision
// the row hit `else { tally.pending++; continue; }` and was written NOWHERE. The fix defaults the unresolved
// case to plan="new", which the loop already suffixes and un-archives, so a create is never dropped.
//
// This runs the REAL ThriveIntake.importPlan (from intake.js) AND the REAL decision+suffix+archived slice
// extracted verbatim from app.js, inside a one-iteration loop harness. If the branch reverts to continue, the
// harness sees the row skipped and fails. Pure Node. Run: node tools/upload_never_drops_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");
const intake = fs.readFileSync(path.join(ROOT, "library/intake.js"), "utf8");

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

// ---- 1. the REAL classifier: an archived slug is a "decision" (the precondition of the bug) --------------
const ipSrc = fnSrc(intake, "function importPlan(");
ck("ThriveIntake.importPlan is present in intake.js", !!ipSrc);
const importPlan = new Function(ipSrc + "\nreturn importPlan;")();
ck("importPlan returns 'decision' for an ARCHIVED slug (the case that used to drop)",
   importPlan("underdog-coffee-bread", { "underdog-coffee-bread": { archived: true, hasHistory: true } }) === "decision");
ck("importPlan returns 'new' for a slug that does not exist", importPlan("brand-new", {}) === "new");
ck("importPlan returns 'update_locked' for an ACTIVE slug that has history",
   importPlan("live-one", { "live-one": { archived: false, hasHistory: true } }) === "update_locked");

// ---- 2. run the REAL decision+suffix+archived slice from writeImport, verbatim -------------------------
const START = "let plan=ThriveIntake.importPlan(s, existing);";
const END = 'if(isNew || it.decision==="restore"){ rec.archived=false; } else { delete rec.archived; }';
const a = app.indexOf(START), b = app.indexOf(END);
ck("the decision/suffix/archived slice is locatable in writeImport", a >= 0 && b > a, { a: a, b: b });
const SLICE = app.slice(a, b + END.length);

// A one-iteration loop so the slice's own `continue` (the old drop) is observable: if it fires, _ran stays false.
const harness = new Function("ThriveIntake", "existing", "seen", "it", "e", "rec", "s",
  "var _ran=false,_plan,_isNew,_slug,_rec;\n" +
  "for(var _iter=0;_iter<1;_iter++){\n" + SLICE + "\n" +
  "_ran=true;_plan=plan;_isNew=isNew;_slug=s;_rec=rec;\n" +
  "}\n" +
  "return { ran:_ran, plan:_plan, isNew:_isNew, slug:_slug, rec:_rec };");

function runCase(decision) {
  const existing = { "underdog-coffee-bread": { archived: true, hasHistory: true } };
  const seen = {}; Object.keys(existing).forEach(function (k) { seen[k] = 1; });
  const it = { decision: decision, entry: { file: { html: "<p>x</p>" } } };
  const e = it.entry;
  const rec = { slug: "underdog-coffee-bread", business: "Underdog", published: false, stage: "", sent_on: null, outreach_text: "Hello", outreach_subject: "Hi" };
  // The old silent-drop branch does `continue` (and references `tally`, which this harness deliberately does not
  // provide). Either way the row does not complete: a throw is caught and reported as ran:false, so a revert
  // surfaces as a clean FAIL on the "not dropped" assertion rather than an uncaught crash.
  let out;
  try { out = harness({ importPlan: importPlan }, existing, seen, it, e, rec, rec.slug); }
  catch (err) { out = { ran: false, threw: String(err && err.message || err), rec: rec }; }
  out.existingUntouched = existing["underdog-coffee-bread"].archived === true;
  return out;
}

// The bug case: an archived-slug collision with NO explicit choice. It must now be WRITTEN as a fresh card.
const drop = runCase(undefined);
ck("an archived-slug row with NO choice is NOT dropped (the loop body ran to completion, no continue)", drop.ran === true, drop);
ck("...it resolves to plan='new' (a fresh operation, not pending)", drop.plan === "new", drop.plan);
ck("...the new card is SUFFIXED so it never overwrites the archived original (underdog-coffee-bread-2)",
   drop.slug === "underdog-coffee-bread-2", drop.slug);
ck("...the fresh card is un-archived, so it lands in Under Review (rec.archived === false)", drop.rec.archived === false, drop.rec);
ck("...the archived original is left untouched (still archived in existing)", drop.existingUntouched === true, drop);

// Control: an explicit "restore" choice still restores-and-updates in place (not suffixed, keeps the slug).
const restore = runCase("restore");
ck("restore still resolves to update_locked (an active slug with history) and keeps the slug", restore.ran === true && restore.plan === "update_locked" && restore.slug === "underdog-coffee-bread", restore);
ck("restore is an UPDATE in place, not a new card (isNew === false)", restore.isNew === false, restore);
ck("restore un-archives the card (rec.archived === false)", restore.rec.archived === false, restore.rec);

// Control: an explicit "new" choice behaves exactly as the defaulted case (same suffix, same un-archive).
const explicitNew = runCase("new");
ck("an explicit 'new' choice matches the default: suffixed, un-archived new card",
   explicitNew.plan === "new" && explicitNew.slug === "underdog-coffee-bread-2" && explicitNew.rec.archived === false, explicitNew);

// Control: a slug that does NOT collide still imports as a plain, UN-suffixed new card.
(function () {
  const existing = {};
  const seen = {};
  const it = { entry: { file: { html: "<p>x</p>" } } };
  const rec = { slug: "fresh-cafe", business: "Fresh", published: false, stage: "", sent_on: null };
  const out = harness({ importPlan: importPlan }, existing, seen, it, it.entry, rec, rec.slug);
  ck("a non-colliding slug imports as a plain new card, un-suffixed", out.ran === true && out.plan === "new" && out.slug === "fresh-cafe", out);
})();

// ---- 3. source guard: the unresolved branch is plan='new', and the silent-drop (continue) is gone ------
const wi = fnSrc(app, "async function writeImport(") || fnSrc(app, "function writeImport(");
const decBlock = wi.slice(wi.indexOf('if(plan==="decision")'), wi.indexOf('const isNew='));
ck("the unresolved decision branch defaults to plan='new'", /else\s*\{\s*plan="new";/.test(decBlock), decBlock);
ck("the silent drop is gone: no `tally.pending` increment and no `continue` in the decision block",
   decBlock.indexOf("tally.pending") < 0 && decBlock.indexOf("continue") < 0, decBlock);
ck("the explicit restore choice is preserved (d==='restore' still maps to update / update_locked)",
   /d==="restore"/.test(decBlock) && /update_locked/.test(decBlock), decBlock);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
