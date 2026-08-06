/* Prove the upload-batch parser, matcher and report against the REAL attached batch
   (READY_TO_SEND_BATCH06.md), then break it three ways and show the warnings fire by name.
   Pure logic, no DOM: this is the part the sandbox can and must prove.

   It runs the SAME pure core the editor runs (ThriveIntake.buildBatch), so what prints here is
   exactly what the editor's report shows: parse the sections, overlay any fenced json block by
   slug, match pages by slug (never by position), give a page with no section its own entry, and
   report. BATCH07 and its three HTML files were not attached with this brief, so the proof is on
   the attached BATCH06 (bullet format). The json-block path is proven by adding a real ```json
   block to the document text below. */
const fs = require("fs"), path = require("path");
const TI = require(path.join(__dirname, "../library/intake.js")).ThriveIntake;
const md = fs.readFileSync(path.join(__dirname, "fixtures/READY_TO_SEND_BATCH06.md"), "utf8");

const P = (n, h) => ({ name: n, html: h || "<!doctype html><h1>" + n + "</h1>" });
const all = [P("ludic.html"), P("wisebutterfly.html"), P("2faces.html")];

const yn = b => b ? " Y " : " . ";
function table(label, out) {
  const rep = out.report;
  console.log("\n=== " + label + " ===");
  if (out.jsonError) console.log("json block error: " + out.jsonError);
  console.log("slug            HTML MFST SUBJ BODY SEND  verdict / reason");
  rep.rows.forEach(r => {
    console.log(
      (r.slug + "                ").slice(0, 15) + " " +
      yn(r.hasPage) + " " + yn(r.hasManifest) + " " + yn(r.hasSubject) + " " + yn(r.hasBody) + " " + yn(r.hasSendTo) + "  " +
      (r.verdict === "matched" ? "matched" : ("WARNED: " + r.reasons.join(", "))));
  });
  console.log("summary: matched=" + rep.matched + " warned=" + rep.warned + " allMatched=" + rep.allMatched);
}

// 1. the real batch, all three pages present: three slugs, all five columns, all matched.
table("1. REAL BATCH06, all three pages present", TI.buildBatch(all, [md]));

// 2. remove one HTML file: a text with no page.
table("2. BROKEN: ludic.html removed (a text with no page)",
      TI.buildBatch([P("wisebutterfly.html"), P("2faces.html")], [md]));

// 3. add a fourth manifest entry with no file. Carried by a real fenced ```json block appended to
//    the document, which also proves the json-block anchor parses.
const withJson = md + "\n\n## Manifest entries\n\n```json\n" +
  '{ "slug": "spare-shop", "business": "Spare Shop", "template": "en-opp1", "sent_on": "2026-07-28", "location": "Vienna", "phone": "", "status": "sent" }\n' +
  "```\n";
table("3. BROKEN: a json manifest entry with no page (spare-shop)", TI.buildBatch(all, [withJson]));

// 4. duplicate a slug. A second document section pasted with the same /s/2faces- slug, the exact
//    shape that mistake takes: two opportunities that would both write to opp/2faces/.
const withDupe = md + "\n\n## 4 · 2 Faces Clothing Co. (Fairfax) · pasted a second time\n\n" +
  "- **Send to:** website contact form at 2faceonline.us (no public email, Tier B).\n" +
  "- **Page:** 2faces.html · slug `/s/2faces-` plus four random characters\n" +
  "- **Subject:** The 2 Faces crowd\n\n```\nHi John, second copy. [LINK]\n```\n";
table("4. BROKEN: two opportunities on one slug (2faces pasted twice)", TI.buildBatch(all, [withDupe]));

// 5. a slug already live in the manifest: would overwrite, warned not silently replaced.
table("5. an existing slug already live (would overwrite)", TI.buildBatch(all, [md], { existingSlugs: ["ludic"] }));

// 6. the json block as the structured source of truth: it overlays business/template/location onto
//    a matched section by slug, and the row stays matched.
const overlay = md + "\n\n## Manifest entries\n\n```json\n" +
  '{ "slug": "ludic", "business": "Ludic Lillian LLC", "template": "en-opp1", "location": "Fairfax, VA", "status": "sent" }\n' +
  "```\n";
const o6 = TI.buildBatch(all, [overlay]);
table("6. json block overlays structured fields on a matched slug", o6);
const ludic = o6.entries.find(e => (e.slug_hint || "") === "ludic");
console.log("overlay check: business=" + JSON.stringify(ludic.business) +
  " template=" + JSON.stringify(ludic.extra.template) +
  " from_json=" + !!ludic.from_manifest_json);
