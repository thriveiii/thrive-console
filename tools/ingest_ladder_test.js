/* P11 · The tolerant opportunity-ingest reader: the manifest contract (R8 opp.md) and the fallback ladder.
   Pure logic (the part the sandbox proves): drop the batch-13 shape (six opp/<slug>/index.html folders plus
   one aggregated research md) and prove all six resolve; then opp.md wins; a page alone is "needs message",
   never dropped; a legacy manifest.json still resolves; ten reads are byte-identical; there is no per-slug
   branch in the resolver. The live drop surface and the paste action are proven in ingest_surface_test.py. */
const fs = require("fs"), path = require("path");
const TI = require(path.join(__dirname, "../library/intake.js")).ThriveIntake;
const research = fs.readFileSync(path.join(__dirname, "fixtures/BATCH13_research_and_messages.md"), "utf8");

let fails = [];
function ck(n, c, d) { console.log((c ? "PASS " : "FAIL ") + n); if (!c) { fails.push(n); if (d !== undefined) console.log("      " + String(d).slice(0, 300)); } }

const P = (name, html) => ({ name, html: html || ("<!doctype html><title>" + name + "</title><h1>" + name + "</h1>") });
const SLUGS = ["river-sea-chocolates", "ludic-lillian", "wise-butterfly", "jamiyat-alsharq-lilhulwiat", "wander-wick-candles", "corner-bloom-studio"];
// the six folder pages, exactly the batch-13 shape: every page is opp/<slug>/index.html
function folderPages() { return SLUGS.map(s => P("opp/" + s + "/index.html")); }

// ---- Evidence 1: the exact batch-13 shape resolves all six via rung 3 (the research md) ----------
let out = TI.readBatch ? null : null;
out = TI.resolveBatch(folderPages(), [{ name: "BATCH13_research_and_messages.md", text: research }], []);
ck("batch 13: six opportunities, zero dropped", out.report.rows.length === 6, out.report.rows.length);
ck("batch 13: every opportunity resolves via the research md (rung 3)",
   out.report.rows.every(r => r.provenance === "research_md"), out.report.rows.map(r => r.slug + ":" + r.provenance));
ck("batch 13: zero 'no instruction entry' — every row is matched with send_to, subject and body",
   out.report.rows.every(r => r.verdict === "matched" && r.hasSendTo && r.hasSubject && r.hasBody),
   out.report.rows.map(r => r.slug + ":" + r.verdict).join(" "));
const rsc = out.report.rows.find(r => r.slug === "river-sea-chocolates").entry;
ck("batch 13: the send_to is the address the research md named (never invented)",
   rsc.email === "chantilly@riverseachocolates.com", rsc.email);
ck("batch 13: the subject is the one the research md named", rsc.subject === "The Reston shop, found", rsc.subject);
ck("batch 13: the body is carried verbatim, {{NAME}} token kept", /\{\{NAME\}\}/.test(rsc.body) && /Reston shop/.test(rsc.body), rsc.body.slice(0, 40));

// ---- an Arabic bundle parses, RTL business name intact, no mojibake -----------------------------
const arRow = out.report.rows.find(r => r.slug === "jamiyat-alsharq-lilhulwiat");
ck("an Arabic opportunity resolves and keeps its right-to-left business name intact",
   arRow && /[؀-ۿ]/.test(arRow.entry.business) && arRow.entry.email === "hello@sharqsweets.jo",
   arRow && arRow.entry.business);

// ---- Evidence 2: an opp.md beside index.html wins (rung 1) ---------------------------------------
const oppMd = ["slug: river-sea-chocolates", "business: River-Sea Chocolates", "kind: maker",
  "template: en-opp1", "location: Chantilly, VA", "send_to: chantilly@riverseachocolates.com",
  "subject: The Reston shop, found", "sent_on:", "---",
  "Hi {{NAME}}, the Reston shop, found. [LINK]"].join("\n");
let out2 = TI.resolveBatch([P("opp/river-sea-chocolates/index.html")],
  [{ name: "opp/river-sea-chocolates/opp.md", text: oppMd },
   { name: "BATCH13_research_and_messages.md", text: research }], []);
const r1 = out2.report.rows[0];
ck("opp.md beside index.html resolves via rung 1 and WINS over the research md",
   r1.provenance === "opp_md" && r1.entry.email === "chantilly@riverseachocolates.com" && r1.entry.subject === "The Reston shop, found",
   r1.provenance);

// ---- Evidence 3 (logic half): a folder with only index.html, no md anywhere -> "needs message" ---
let out3 = TI.resolveBatch([P("opp/lonely-maker/index.html", "<title>Lonely Maker</title><p>hello@lonelymaker.com</p>")], [], []);
let r3 = out3.report.rows[0];
ck("a page with a visible email but no md -> partial, body needs writing (rung 4), never dropped",
   r3.provenance === "page_partial" && r3.needs_message === true && r3.hasSendTo && !r3.hasBody, r3.provenance);
let out3b = TI.resolveBatch([P("opp/silent-shop/index.html", "<title>Silent Shop</title><p>nothing to reach here</p>")], [], []);
let r3b = out3b.report.rows[0];
ck("a page with nothing at all -> needs message (rung 5), the card is still created, never a dead end",
   r3b.provenance === "needs_message" && r3b.needs_message === true && out3b.report.rows.length === 1, r3b.provenance);

// ---- Evidence 4: a legacy manifest.json bundle still resolves (rung 2), no regression -------------
const mj = JSON.stringify([{ slug: "maya-makes", business: "Maya Makes", send_to: "maya@mayamakes.com",
  subject: "Hello Maya", body: "Hi {{NAME}}, hello. [LINK]" }]);
let out4 = TI.resolveBatch([P("opp/maya-makes/index.html")], [], [{ name: "manifest.json", text: mj }]);
const r4 = out4.report.rows[0];
ck("a legacy manifest.json entry resolves the opportunity (rung 2)",
   r4.provenance === "manifest_json" && r4.verdict === "matched" && r4.entry.email === "maya@mayamakes.com", r4.provenance);

// ---- Evidence 5: ten reads byte-identical; no per-slug branch in the resolver --------------------
function snap() {
  return JSON.stringify(TI.resolveBatch(folderPages(), [{ name: "BATCH13_research_and_messages.md", text: research }], [])
    .report.rows.map(r => [r.slug, r.provenance, r.verdict, r.hasSendTo, r.hasSubject, r.hasBody]));
}
const first = snap();
let same = true; for (let i = 0; i < 10; i++) { if (snap() !== first) same = false; }
ck("ten reads of the batch are byte-identical (deterministic)", same);

const src = fs.readFileSync(path.join(__dirname, "../library/intake.js"), "utf8");
const resolverBody = src.slice(src.indexOf("function resolveBatch"), src.indexOf("global.ThriveIntake ="));
ck("the resolver carries NO per-batch or per-slug branch (no batch/slug literal, no BATCH13)",
   !/batch\s*13|batch13|"river-sea|'river-sea|per-slug|specialCase|special_case/i.test(resolverBody) &&
   (src.match(/function resolveBatch/g) || []).length === 1);
ck("there is exactly ONE tolerant resolver (resolveBatch), one ladder",
   (src.match(/function resolveOne\(/g) || []).length === 1);

// ---- the flat legacy path (batch-06 shape) is unchanged by the new resolver ----------------------
const flat = "# B\n## 1 · Ludic Lillian (Fairfax) · maker\n- **Send to:** tis@ludiclillian.com\n- **Subject:** Hi\n```\nHi {{NAME}}. [LINK]\n```\n";
let out6 = TI.resolveBatch([P("ludic.html")], [{ name: "research.md", text: flat }], []);
ck("a flat page + research md (legacy batch-06 shape) still resolves and matches by name",
   out6.report.rows.length === 1 && out6.report.rows[0].verdict === "matched" && out6.report.rows[0].entry.email === "tis@ludiclillian.com",
   out6.report.rows[0] && out6.report.rows[0].verdict);

// ---- P15: the tolerant heading grammar recognises the real producer shapes (this was the batch-13 defect).
// The old pattern required a digit DIRECTLY followed by a separator, so `## 1) Name` (a close-paren after the
// digit, the shape the producer actually ships) matched nothing and every section fell through to notes: the
// batch resolved zero opportunities. One recogniser now accepts every shape a person writes. -----------------
const SHAPES = [
  ["## 1) River-Sea Chocolates – maker", "the number-with-paren shape the producer ships (broke batch 13)"],
  ["## 1. River-Sea Chocolates – maker", "a number with a trailing dot"],
  ["## 1 · River-Sea Chocolates · maker", "the middle-dot shape of the earlier batches"],
  ["## River-Sea Chocolates", "a plain name with no list marker at all"]
];
SHAPES.forEach(([head, why]) => {
  const md = head + "\n- **Send to:** chantilly@riverseachocolates.com\n```\nHi {{NAME}}. [LINK]\n```\n";
  const r = TI.parseManifest(md);
  const e = r.entries[0] || {};
  ck("heading shape parses to one opportunity — " + why,
     r.entries.length === 1 && e.business === "River-Sea Chocolates" && e.email === "chantilly@riverseachocolates.com",
     r.entries.length + " / " + JSON.stringify(e.business));
});

// ---- P15: the send-to + body gate, not the heading shape, decides opportunity-vs-note. A permissive heading
// would otherwise turn every "Market Assessment" / "Sources" / "Money at a glance" section into a phantom
// "needs message" card. A section with no destination and no message is a note, kept in note_text, never a row.
const pm = TI.parseManifest(research);
ck("the non-opportunity sections (Market Assessment, Sources, Money at a glance) are notes, not opportunities",
   pm.notes.length === 3 && !pm.entries.some(e => /Market Assessment|Sources|Money at a glance/.test(e.business)),
   pm.notes.map(n => n.heading).join(" | "));
ck("a note's content still survives into note_text (the pricing floor is not lost)",
   pm.note_text.indexOf("2,500") >= 0, pm.note_text.slice(0, 60));
const outNoOpp = TI.resolveBatch(
  [], [{ name: "research.md", text: "# B\n## Market Assessment\nUnsaturated cluster, no destination.\n\n## Sources\nThe Fairfax Girl, July 2026.\n" }], []);
ck("a research md of ONLY non-opportunity sections yields zero opportunity rows (no phantom cards)",
   outNoOpp.report.rows.length === 0, outNoOpp.report.rows.length);

// ---- P15: one recogniser, one splitter. The parser must not grow a second heading branch per batch format.
const isrc = fs.readFileSync(path.join(__dirname, "../library/intake.js"), "utf8");
ck("there is exactly ONE heading recogniser (HEAD_RE) and ONE section splitter (parseManifest)",
   (isrc.match(/var HEAD_RE\s*=/g) || []).length === 1 && (isrc.match(/function parseManifest\(/g) || []).length === 1);

console.log("\n" + (fails.length ? "FAILED: " + fails.join(", ") : "ALL INGEST LADDER CHECKS PASS"));
process.exit(fails.length ? 1 : 0);
