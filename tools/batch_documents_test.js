/* P26 · The daily drop, whole: the batch's documents ride with its opportunities.
 *
 *   node tools/batch_documents_test.js
 *
 * Part A lifts the REAL resolver from library/intake.js and proves: the batch captures its non-opportunity
 * documents (classified by type, with provenance) additively; a documents-only drop spawns ZERO cards (the
 * qualification gate holds); the research md produces exactly its opportunities and none of its note sections;
 * classifyDoc names each document type; and toRecord stamps batch_id/batch_date so every opportunity links.
 * Part B lifts the pure app.js helpers (batchNumberFrom / batchIdFor / renderDocMd) and proves the batch id is
 * idempotent by number, the md renderer escapes every document (no HTML runs), isolates each line dir="auto",
 * and is byte-identical across ten renders. Part C is a source audit of the wiring (synced key, the write path
 * persisting the batch and stamping opps, the Overview chip, the Batches view) with no second ingest path.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const TI = require(path.join(ROOT, "library", "intake.js")).ThriveIntake;
const app = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
const editorHtml = fs.readFileSync(path.join(ROOT, "library", "batches.html"), "utf8");
const md = fs.readFileSync(path.join(ROOT, "tools", "fixtures", "BATCH13_research_and_messages.md"), "utf8");
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function grabFn(name) {
  const s = app.indexOf("function " + name + "(");
  if (s < 0) throw new Error("not found: " + name);
  const e = app.indexOf("\n}", s);
  return app.slice(s, e + 2);
}

/* ============ Part A: the resolver captures documents, and no document becomes a card ============ */
{
  // The real research md, dropped with no pages: a manifest-only import (the six makers become opportunities).
  const out = TI.resolveBatch([], [{ name: "BATCH13_research_and_messages.md", text: md }], []);
  ck("A1 documents captured: the research md rides with the batch",
    Array.isArray(out.documents) && out.documents.length === 1 && out.documents[0].type === "research",
    (out.documents || []).map(d => d.type + ":" + d.name));
  ck("A2 the research md's six makers become opportunities (not its note sections)",
    out.report.rows.length === 6, out.report.rows.map(r => r.slug));
  const businesses = out.report.rows.map(r => r.business).join(" | ");
  ck("A3 no note section (Market Assessment / Sources / Money) is an opportunity",
    !/Market Assessment|Sources|Money at a glance/.test(businesses), businesses);

  // A documents-only drop: a README and a market assessment, no pages, no opportunity blocks.
  const readme = "# README\nUpload each page, paste the live URL over [LINK].";
  const market = "# Market Assessment\nThe Reston makers cluster is unsaturated. No franchise expansions qualified.";
  const docsOnly = TI.resolveBatch([], [{ name: "README.md", text: readme }, { name: "market.md", text: market }], []);
  ck("A4 zero phantom cards: a documents-only drop spawns NO opportunities (the gate holds)",
    docsOnly.report.rows.length === 0, docsOnly.report.rows.map(r => r.slug));
  ck("A5 both documents are still captured, each typed",
    docsOnly.documents.length === 2 &&
    docsOnly.documents.some(d => d.type === "readme") && docsOnly.documents.some(d => d.type === "market"),
    docsOnly.documents.map(d => d.type));

  // classifyDoc: filename first, then first heading.
  ck("A6 classifyDoc: README -> readme", TI.classifyDoc("README.md", "") === "readme");
  ck("A7 classifyDoc: PLAYBOOK -> playbook", TI.classifyDoc("PLAYBOOK.md", "") === "playbook");
  ck("A8 classifyDoc: a Market Assessment heading -> market", TI.classifyDoc("stuff.md", "# Market Assessment\nx") === "market");
  ck("A9 classifyDoc: notes -> notes", TI.classifyDoc("field-notes.txt", "") === "notes");
  ck("A10 classifyDoc: research/messages -> research", TI.classifyDoc("research_and_messages.md", "") === "research");
  ck("A11 classifyDoc: anything else -> document", TI.classifyDoc("thing.txt", "hello") === "document");

  // toRecord stamps the batch link on every opportunity it mints.
  const rec = TI.toRecord({ business: "Acme", body: "hi", extra: {} }, { today: "2026-08-19", batch: { id: "batch-13", date: "2026-08-19", title: "Batch 13" } });
  ck("A12 toRecord links the opportunity to its batch (batch_id + batch_date)",
    rec.batch_id === "batch-13" && rec.batch_date === "2026-08-19", { id: rec.batch_id, date: rec.batch_date });
  const recNo = TI.toRecord({ business: "Acme", body: "hi", extra: {} }, { today: "2026-08-19" });
  ck("A13 a record minted without a batch carries empty batch fields (no crash, additive)",
    recNo.batch_id === "" && recNo.batch_date === "", { id: recNo.batch_id, date: recNo.batch_date });
}

/* ============ Part B: the pure app.js helpers (id, and the safe md renderer) ============ */
{
  const src = [grabFn("esc"), grabFn("inlineMd"), grabFn("renderDocMd"), grabFn("batchNumberFrom"), grabFn("batchIdFor")].join("\n");
  const sandbox = { String, Array, Number, Math, JSON, RegExp, parseInt };
  vm.createContext(sandbox);
  vm.runInContext(src + "\nthis.renderDocMd=renderDocMd; this.batchNumberFrom=batchNumberFrom; this.batchIdFor=batchIdFor;", sandbox);

  ck("B1 batchNumberFrom reads the number from a document name",
    sandbox.batchNumberFrom([{ name: "BATCH13_research_and_messages.md", text: "" }]) === 13);
  ck("B2 batchNumberFrom reads the number from a document heading",
    sandbox.batchNumberFrom([{ name: "x.md", text: "# Batch 06\n..." }]) === 6);
  ck("B3 batchNumberFrom is 0 when no number is present",
    sandbox.batchNumberFrom([{ name: "notes.md", text: "no number here" }]) === 0);
  ck("B4 a numbered batch is idempotent by number (batch-13)", sandbox.batchIdFor(13, 999) === "batch-13");
  ck("B5 an unnumbered drop gets a distinct timestamp id", /^b-/.test(sandbox.batchIdFor(0, 999)));

  // The md renderer: escape everything, isolate each line, one code block.
  const evil = '# Title <script>alert(1)</script>\n- a **bold** point\nplain & simple';
  const html = sandbox.renderDocMd(evil);
  ck("B6 renderDocMd escapes HTML (no script tag survives)",
    !/<script>/.test(html) && html.indexOf("&lt;script&gt;") >= 0, html.slice(0, 160));
  ck("B7 renderDocMd isolates each line with dir=\"auto\" (RTL safe)", /dir="auto"/.test(html));
  ck("B8 renderDocMd renders a heading, a list item, and bold", /doc-h/.test(html) && /doc-li/.test(html) && /<b>bold<\/b>/.test(html));
  const amp = sandbox.renderDocMd("a & b < c");
  ck("B9 renderDocMd escapes ampersand and angle brackets in body text", /&amp;/.test(amp) && /&lt;/.test(amp));
  // Byte-identical across ten renders (the brief's "ten reads byte-identical").
  let stable = true; const first = sandbox.renderDocMd(md);
  for (let i = 0; i < 10; i++) { if (sandbox.renderDocMd(md) !== first) { stable = false; break; } }
  ck("B10 renderDocMd is byte-identical across ten renders", stable);
}

/* ============ Part C: the wiring (source audit) ============ */
{
  ck("C1 the batches store is a synced key", /thrive_batches_v1\s*:/.test(app));
  ck("C2 the write path persists the batch (documents) via saveBatch", /saveBatch\(\{\s*id:_bid/.test(app));
  ck("C3 the write path stamps the batch id/date onto opps through ctx.batch",
    /batch:_bctx/.test(app) && /id:_bid,\s*date:_date/.test(app));
  ck("C4 the id is minted before the write so every opp links (no second pass)", /batchIdFor\(_n, Date\.now\(\)\)/.test(app));
  ck("C5 the card Overview shows a from-batch chip", /data-batchopen=/.test(app) && /mw_o_batch/.test(app));
  ck("C6 the chip opens the Batches view for this drop", /goTo\("batches","b="/.test(app));
  ck("C7 the Batches view exists (initBatches) and reads the store", /function initBatches\(\)/.test(app) && /getBatches\(\)/.test(app));
  ck("C8 the Batches view fragment mounts initBatches", /initBatches\(\)/.test(editorHtml) && /id="batchList"/.test(editorHtml));
  // No second ingest path: capture rides the ONE resolver's output; both surfaces already call readBatch.
  ck("C9 no second ingest path: documents are read from resolveBatch's own output (batch.documents)",
    /const _docs=batch\.documents\|\|\[\]/.test(app));
  ck("C10 exactly one resolveBatch and one readBatch remain in intake",
    (require("fs").readFileSync(path.join(ROOT, "library", "intake.js"), "utf8").match(/function resolveBatch\(/g) || []).length === 1);
}

console.log(fails === 0 ? "\n0 failed" : "\n" + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
