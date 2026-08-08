/* Prove the upload-batch WRITE against the REAL attached batch (READY_TO_SEND_BATCH06.md): every
   template it confirms is persisted, each with its own text, and a re-import updates in place rather
   than duplicating. The parser and report here are the real pure core (ThriveIntake.buildBatch and
   toRecord, the exact functions the editor calls). The persist loop below is a faithful mirror of
   library/app.js approveBatch, line for line: the same storable filter, the same idempotent slug map
   (a slug already in the store updates in place, an in-batch duplicate gets a numeric suffix), the
   same lifecycle-preserving overlay on re-import, and the same merge-by-slug that saveDraft does. The
   two things this Node proof cannot run are the browser's saveDraft (localStorage) and publishOpp
   (GitHub); those are exercised by the editor itself and, for the store, by tools/batch_write_gate.py
   in Chromium. This proves the logic the sandbox can and must prove: confirmed count equals written
   count, and no opportunity is created empty. */
const fs = require("fs"), path = require("path");
const TI = require(path.join(__dirname, "../library/intake.js")).ThriveIntake;
const md = fs.readFileSync(path.join(__dirname, "fixtures/READY_TO_SEND_BATCH06.md"), "utf8");
const P = (n, h) => ({ name: n, html: h || "<!doctype html><h1>" + n + "</h1>" });

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

/* mirror of saveDraft: merge by slug into an in-memory store. */
function saveInto(store, rec) {
  rec = Object.assign({}, rec);
  const i = store.findIndex(x => x.slug === rec.slug);
  if (i >= 0) store[i] = Object.assign({}, store[i], rec); else store.push(rec);
}

/* mirror of app.js approveBatch's persist loop. Returns { store, saved, hosted, incomplete }. */
function writeBatch(out, store) {
  store = store || [];
  const rows = out.report.rows;                       // storable() is "every row", so no filter drops one
  const existing = {}; store.forEach(o => { if (o && o.slug) existing[o.slug] = true; });
  const seen = {}; Object.keys(existing).forEach(k => seen[k] = 1);
  let saved = 0, hosted = 0, incomplete = 0;
  rows.forEach(r => {
    const e = r.entry;
    const rec = TI.toRecord(e, { today: "2026-08-07" });
    let s = rec.slug;
    if (seen[s] && !existing[s]) { let j = 2; while (seen[s + "-" + j]) j++; s = s + "-" + j; }
    rec.slug = s; seen[s] = 1;
    const willHost = !!r.hasPage;                      // hostable(r) === r.hasPage
    if (existing[s]) { delete rec.published; delete rec.stage; delete rec.sent_on; }
    if (willHost) { hosted++; }                        // publishOpp in the browser; counted here
    saveInto(store, rec);
    saved++;
    if (!e.subject && !e.body) incomplete++;
  });
  return { store: store, saved: saved, hosted: hosted, incomplete: incomplete };
}

function textOf(store, slug) { const r = store.find(x => x.slug === slug); return r ? (r.outreach_text || "") : "(absent)"; }

// 1. The real BATCH06: three templates, none with a page in the package (the device's shape). Every
//    one is stored, and every one carries its own body text. Confirmed three, written three.
const b1 = TI.buildBatch([], [md]);
const w1 = writeBatch(b1);
console.log("\n=== 1. REAL BATCH06, three templates, zero pages: store all, keep text ===");
ck("report confirms 3 templates", b1.report.rows.length === 3, b1.report.rows.length);
ck("write persists 3 (confirmed count equals written count)", w1.saved === 3, w1.saved);
ck("nothing hosted (no page in the package)", w1.hosted === 0, w1.hosted);
w1.store.forEach(r => console.log("   stored " + (r.slug + "            ").slice(0, 16) +
  " text=" + JSON.stringify((r.outreach_text || "").slice(0, 22)) + " subject=" + JSON.stringify((r.outreach_subject || "").slice(0, 16))));
ck("every stored template carries non-empty body text", w1.store.every(r => (r.outreach_text || "").length > 0));
ck("none stored empty of both text and subject", w1.store.every(r => (r.outreach_text || r.outreach_subject)));
ck("all three business names survive", w1.store.filter(r => r.business).length === 3);

// 2. One page matches (ludic). It is hosted AND stored with text; the other two are stored with text,
//    page pending. Still three written, three with text.
const b2 = TI.buildBatch([P("ludic-lillian.html")], [md]);
const w2 = writeBatch(b2);
console.log("\n=== 2. one page matched: host the paged one, store all three with text ===");
ck("write persists 3", w2.saved === 3, w2.saved);
ck("exactly one is hosted (the matched page)", w2.hosted === 1, w2.hosted);
ck("the two page-pending rows still carry their text",
   w2.store.filter(r => (r.outreach_text || "").length > 0).length === 3, w2.store.map(r => r.slug + ":" + (r.outreach_text || "").length));

// 3. A genuinely text-less template is stored but NAMED incomplete, not reported as all-present.
const stripped = md.replace(/```[\s\S]*?```/, "```\n\n```").replace(/\*\*Subject:\*\*[^\n]*/i, "**Subject:** ");
const b3 = TI.buildBatch([], [stripped]);
const w3 = writeBatch(b3);
console.log("\n=== 3. a template with its text removed: stored, flagged incomplete ===");
ck("still persists every row", w3.saved === b3.report.rows.length, w3.saved + "/" + b3.report.rows.length);
ck("at least one row is flagged incomplete (no text), not hidden", w3.incomplete >= 1, w3.incomplete);
ck("a no_text row is reported by name", b3.report.rows.some(r => r.reasons.indexOf("no_text") >= 0 || (!r.hasSubject && !r.hasBody)));

// 4. Re-import the same batch into the store from run 1: updates in place, no duplicate slugs, and
//    an already-published lifecycle is not knocked back to draft.
const store4 = w1.store.map(r => Object.assign({}, r));
store4.forEach(r => { r.published = true; r.stage = "sent"; r.sent_on = "2026-07-01"; });  // pretend they went live
const before = textOf(store4, store4[0].slug);
const w4 = writeBatch(b1, store4);
console.log("\n=== 4. re-import the same batch: update in place, keep lifecycle ===");
ck("store still holds 3 records, not 6 (idempotent identity)", w4.store.length === 3, w4.store.length);
const slugs4 = w4.store.map(r => r.slug);
ck("no slug is duplicated or suffixed on re-import", new Set(slugs4).size === 3 && slugs4.every(s => !/-\d+$/.test(s)), slugs4.join(","));
ck("an already-sent record keeps published=true (lifecycle not reset)", w4.store.every(r => r.published === true));
ck("an already-sent record keeps its stage (not knocked back to draft)", w4.store.every(r => r.stage === "sent"));
ck("the text is still present after re-import", textOf(w4.store, w4.store[0].slug).length > 0 && before.length > 0);

console.log("\n" + (fails ? ("FAILED: " + fails + " check(s)") : "ALL CHECKS PASS"));
process.exit(fails ? 1 : 0);
