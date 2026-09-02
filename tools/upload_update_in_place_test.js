// upload-update-in-place gate: fails-when-broken proof of the settled model - an upload matches an
// opportunity by its STABLE slug and updates it IN PLACE, always. One slug = one public link = one card,
// forever; a re-upload is the SAME opportunity (synced + un-archived), never a new slug, suffix, or duplicate.
//
// Two coupled parts, both proven here with REAL code:
//   Part 1 - the classifier SEES every opportunity. oppExistingMeta folds in __supa.opps (the full server
//            list, incl. archived rows pruned from the manifest), so a slug the manifest forgot is not
//            invisible. Proven by running the REAL oppExistingMeta over a fake __supa with an empty manifest.
//   Part 2 - a known slug is "update" in place: keeps its slug (no suffix), is un-archived, and the uploaded
//            subject/body are synced onto it. Proven by running the REAL importPlan and the REAL writeImport
//            classify+update slice, extracted verbatim from the source, in a harness.
//
// Pure Node. Run: node tools/upload_update_in_place_test.js

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

// ---- Part 2a: the REAL importPlan is two outcomes only ----------------------------------------------
const ipSrc = fnSrc(intake, "function importPlan(");
ck("ThriveIntake.importPlan is present", !!ipSrc);
const importPlan = new Function(ipSrc + "\nreturn importPlan;")();
ck("importPlan: an UNKNOWN slug is 'new'", importPlan("nobody", {}) === "new");
ck("importPlan: a KNOWN active slug is 'update' (in place)", importPlan("x", { x: { archived: false, hasHistory: false } }) === "update");
ck("importPlan: a KNOWN ARCHIVED slug is 'update' too (no 'decision', no restore question)",
   importPlan("x", { x: { archived: true, hasHistory: true } }) === "update");
ck("importPlan: a KNOWN slug WITH history is 'update' too (no 'update_locked')",
   importPlan("x", { x: { archived: false, hasHistory: true } }) === "update");
ck("importPlan source no longer emits 'decision' or 'update_locked'",
   ipSrc.indexOf('"decision"') < 0 && ipSrc.indexOf("update_locked") < 0, ipSrc);

// ---- Part 1: the REAL oppExistingMeta folds in __supa.opps (the pruned-archived case) ----------------
const metaSrc = fnSrc(app, "function oppExistingMeta(");
ck("oppExistingMeta is present", !!metaSrc);
ck("oppExistingMeta folds in the full hydrated server list (__supa.opps)", metaSrc.indexOf("__supa.opps") >= 0, metaSrc);
const makeMeta = new Function("__supa", "hasLedgerHistory", metaSrc + "\nreturn oppExistingMeta;");

// A slug archived days ago and pruned from manifest.json: absent from mergedOpps (records=[]), present in the
// hydrated server list with archived inside its data.
const prunedSupa = { opps: [{ slug: "underdog-coffee-bread", archived: true }, { slug: "open-to-being", archived: true }] };
const metaPruned = makeMeta(prunedSupa, function () { return false; })([]);   // empty manifest/drafts
ck("a slug pruned from the manifest but known to the server IS seen by the classifier",
   !!metaPruned["underdog-coffee-bread"] && !!metaPruned["open-to-being"], Object.keys(metaPruned));
ck("...its true archived value is read from the server row (archived lives inside data)",
   metaPruned["underdog-coffee-bread"].archived === true, metaPruned["underdog-coffee-bread"]);
ck("...and importPlan therefore classifies the re-upload as 'update', not a drop or a duplicate",
   importPlan("underdog-coffee-bread", metaPruned) === "update");

// Precedence: the caller's reconciled record wins on a shared slug; __supa only fills the gap.
const metaShared = makeMeta({ opps: [{ slug: "shared", archived: true }] }, function () { return false; })(
  [{ slug: "shared", archived: false }]);   // local record says un-archived (fresher)
ck("precedence: a shared slug keeps the caller's reconciled archived value, not the server's",
   metaShared["shared"].archived === false, metaShared["shared"]);

// A brand-new slug the system does not know at all stays 'new'.
const metaEmpty = makeMeta({ opps: [] }, function () { return false; })([]);
ck("a slug in neither the manifest nor the server is still 'new'", importPlan("fresh-cafe", metaEmpty) === "new");

// ---- Part 2b: run the REAL writeImport classify+update slice, verbatim -------------------------------
const START = "const plan=ThriveIntake.importPlan(s, existing);";
const END = 'liftTomb("opp", s);';
const wi = fnSrc(app, "async function writeImport(") || fnSrc(app, "function writeImport(");
const a = wi.indexOf(START), b = wi.indexOf(END);
ck("the classify+update slice is locatable in writeImport", a >= 0 && b > a, { a: a, b: b });
const SLICE = wi.slice(a, b + END.length);

// One-iteration loop so any re-introduced `continue` (a drop) is observable as ran:false.
const harness = new Function("ThriveIntake", "existing", "rec", "e", "s", "liftTomb",
  "var _ran=false,_plan,_isNew;\n" +
  "for(var _i=0;_i<1;_i++){\n" + SLICE + "\n_ran=true;_plan=plan;_isNew=isNew;\n}\n" +
  "return { ran:_ran, plan:_plan, isNew:_isNew };");

function runSlice(existingMap, recIn) {
  const rec = Object.assign({}, recIn);
  const e = { file: { html: "<p>x</p>" } };
  let out;
  try { out = harness({ importPlan: importPlan }, existingMap, rec, e, rec.slug, function () {}); }
  catch (err) { out = { ran: false, threw: String(err && err.message || err) }; }
  out.rec = rec;
  return out;
}

// The bug case, now healed: a known (archived) slug, re-uploaded with a message.
const upd = runSlice(metaPruned, {
  slug: "underdog-coffee-bread", outreach_subject: "Fresh coffee", outreach_text: "Come by",
  published: true, stage: "sent", sent_on: "2026-01-01"
});
ck("a known slug is NOT dropped (the body ran to completion, no continue)", upd.ran === true, upd);
ck("...it is classified 'update' (matched in place)", upd.plan === "update" && upd.isNew === false, upd);
ck("...it KEEPS its slug (no suffix, the public link is stable)", upd.rec.slug === "underdog-coffee-bread", upd.rec.slug);
ck("...it is UN-ARCHIVED, so it returns to the board (rec.archived === false)", upd.rec.archived === false, upd.rec);
ck("...the uploaded subject and body are SYNCED onto the card (not discarded)",
   upd.rec.outreach_subject === "Fresh coffee" && upd.rec.outreach_text === "Come by", upd.rec);
ck("...its lifecycle fields are left to the stored card (published/stage/sent_on deleted from the update)",
   upd.rec.published === undefined && upd.rec.stage === undefined && upd.rec.sent_on === undefined, upd.rec);

// A genuinely new slug still creates a fresh card, un-archived, keeping its message.
const created = runSlice(metaEmpty, { slug: "brand-new", outreach_subject: "S", outreach_text: "B", published: true });
ck("a new slug is created (isNew), un-archived, un-suffixed, message intact",
   created.ran === true && created.isNew === true && created.rec.slug === "brand-new" &&
   created.rec.archived === false && created.rec.outreach_subject === "S", created.rec);
ck("a new create keeps its minted lifecycle (published NOT deleted on a create)", created.rec.published === true, created.rec);

// ---- source guards: no 'decision', no suffix-on-collision, no silent drop ----------------------------
ck("writeImport no longer branches on 'decision'", wi.indexOf('"decision"') < 0 && wi.indexOf("it.decision") < 0, wi.slice(0, 60));
ck("writeImport no longer suffixes a slug on collision (no `s+\"-\"+k`)", !/s\s*\+\s*"-"\s*\+\s*k/.test(wi), wi);
ck("writeImport no longer drops a row (no `tally.pending`, no `continue` in the classify path)",
   wi.indexOf("tally.pending") < 0 && SLICE.indexOf("continue") < 0, SLICE);
ck("the unreachable imp_pending line is gone from importResultMsg",
   app.indexOf('boardText(getLang(),"imp_pending"') < 0);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
