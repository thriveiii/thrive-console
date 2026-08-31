// Upload-extracts-cleanly gate: fails-when-broken checks for axiom #3 (the upload extracts html, IGNORES the
// rest, never rejects a valid file).
//
// Runs the REAL upBuildPlan (with its real zip reader upReadZip) on synthetic inputs, so a regression - re-adding
// the informational/orphan surfacing, letting a non-html file become a row, or miscounting - fails a case.
//   (a) a zip with 1 html + several md/txt/asset/manifest -> exactly 1 page row, ZERO informational/orphan.
//   (b) a bare .html file (no zip) -> exactly 1 page row.
//   (c) a page with no matching message -> the no_message note stays (operator completes it on the card).
//   (d) the matched count equals the html page count.
//   (e) message-matching is preserved: a text unit that carries Send to/subject/body still fills its page.
//   + source guards: the preview no longer renders up-info / up-orphans, and both inputs accept .html.
//
// Pure Node, no network, no browser. Run: node tools/upload_clean_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const upload = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function extractFn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}
function load(src, names, preamble) {
  const bodies = names.map((n) => { const f = extractFn(src, n); if (!f) throw new Error("missing " + n); return f; });
  const sandbox = {};
  new Function((preamble || "") + "\n" + bodies.join("\n") + "\n; Object.assign(this, {" + names.join(",") + "});").call(sandbox);
  return sandbox;
}

// The real dependency closure of upBuildPlan (its zip reader, parser, extractor, slug + token ranker).
const FNS = ["upBuildPlan", "upReadFiles", "upReadZip", "upFindEOCD", "upU16", "upU32", "upInflateRaw",
  "upParseSections", "upExtract", "upEmailFrom", "upFenceBody", "upSectionName", "upSlugify", "upPageSlug",
  "upBaseName", "upFirstHeading", "upNormTokens", "upRankTokens", "upPretty"];
const PRE = "var UP_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/;\n";
const U = load(upload, FNS, PRE);

// ---- a minimal STORED (method 0) zip encoder, so upReadZip's real walk runs without inflate -------------------
function u16(n){ return Buffer.from([n & 255, (n >> 8) & 255]); }
function u32(n){ return Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]); }
function makeZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  entries.forEach((e) => {
    const name = Buffer.from(e.name, "utf8"), data = Buffer.from(e.text, "utf8");
    const lh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    const cd = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name]);
    locals.push(lh); centrals.push(cd); offset += lh.length;
  });
  const localBuf = Buffer.concat(locals), cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cdBuf.length), u32(localBuf.length), u16(0)]);
  return Buffer.concat([localBuf, cdBuf, eocd]);
}
function zipFile(name, entries) {
  const buf = makeZip(entries);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { name: name, arrayBuffer: () => Promise.resolve(ab) };
}
function htmlFile(name, html) { return { name: name, text: () => Promise.resolve(html) }; }

const PAGE_HTML = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";

(async function () {
  // (a) one html + several non-page files in a zip -> exactly 1 row, no info/orphan.
  const dalat = zipFile("dalat.zip", [
    { name: "dalat_presentation.html", text: PAGE_HTML },
    { name: "SESSION_CLOSURE.md", text: "# Session Closure\nWrapped up the deck." },
    { name: "DALAT_SCHOOL_FACTS.md", text: "# Facts\n- founded 1990\n- 800 students" },
    { name: "design_1_b64.txt", text: "iVBORw0KGgoAAAANSUhEUgAA..." },
    { name: "design_2_b64.txt", text: "R0lGODlhAQABAIAAAAUEBA..." },
    { name: "_manifest.json", text: '{"slides":20,"theme":"dalat"}' },
  ]);
  const planA = await U.upBuildPlan([dalat]);
  ck("(a) 1 html + 5 md/txt/asset/manifest -> exactly 1 page row", planA.rows.length === 1, "rows=" + planA.rows.length);
  ck("(a) that row is the html page (slug from the .html)", planA.rows[0] && planA.rows[0].slug === "dalat-presentation", planA.rows[0] && planA.rows[0].slug);
  ck("(a) ZERO informational entries surfaced", !planA.informational || planA.informational.length === 0, JSON.stringify(planA.informational));
  ck("(a) ZERO orphan entries surfaced", !planA.orphanTexts || planA.orphanTexts.length === 0, JSON.stringify(planA.orphanTexts));

  // (b) a bare .html (no zip) -> exactly 1 page row.
  const planB = await U.upBuildPlan([htmlFile("acme.html", PAGE_HTML)]);
  ck("(b) a bare .html file -> exactly 1 page row", planB.rows.length === 1, "rows=" + planB.rows.length);
  ck("(b) the bare html row carries its slug", planB.rows[0] && planB.rows[0].slug === "acme", planB.rows[0] && planB.rows[0].slug);

  // (c) a page with no matching message keeps the no_message note.
  ck("(c) a page with no message shows the no_message note",
     planB.rows[0] && planB.rows[0].warnings.indexOf("no_message") >= 0, JSON.stringify(planB.rows[0] && planB.rows[0].warnings));

  // (d) the matched count equals the html page count (2 html + noise -> 2).
  const twoHtml = zipFile("two.zip", [
    { name: "acme.html", text: PAGE_HTML },
    { name: "beta-corp.html", text: PAGE_HTML },
    { name: "notes.md", text: "# just notes" },
    { name: "assets.txt", text: "blob" },
  ]);
  const planD = await U.upBuildPlan([twoHtml]);
  ck("(d) matched count == html page count (2 html, ignore 2 non-page) -> 2", planD.rows.length === 2, "rows=" + planD.rows.length);

  // (e) message-matching preserved: a consolidated text unit fills its page (units still built after the change).
  const msg = "## 1) Acme\n- Send to: hi@acme.com  Subject: The Acme opening\n\n```\nHi there, here is the body.\n```\n";
  const withMsg = zipFile("acme_with_msg.zip", [
    { name: "acme.html", text: PAGE_HTML },
    { name: "messages.md", text: msg },
    { name: "readme.md", text: "# Readme\nnot a message" },
  ]);
  const planE = await U.upBuildPlan([withMsg]);
  ck("(e) still exactly 1 page row (readme ignored, message is not a page)", planE.rows.length === 1, "rows=" + planE.rows.length);
  ck("(e) the message unit filled the page (email matched)", planE.rows[0] && planE.rows[0].email === "hi@acme.com", planE.rows[0] && JSON.stringify({e:planE.rows[0].email,s:planE.rows[0].subject}));
  ck("(e) a matched page has NO no_message note", planE.rows[0] && planE.rows[0].warnings.indexOf("no_message") < 0, JSON.stringify(planE.rows[0] && planE.rows[0].warnings));

  // ---- source guards: the surfacing is gone and the inputs accept a bare html ----------------------------------
  ck("guard: upResultHtml no longer renders the informational line (up-info)", upload.indexOf("up-info") < 0, "up-info still rendered");
  ck("guard: upResultHtml no longer renders the orphan line (up-orphans)", upload.indexOf("up-orphans") < 0, "up-orphans still rendered");
  ck("guard: upBuildPlan no longer collects informational", !/informational\.push/.test(upload), "informational.push remains");
  ck("guard: the count is plan.rows.length only", (upload.match(/var n = \(plan\.rows \|\| \[\]\)\.length;/g) || []).length >= 2, "count is not rows.length in both previews");
  ck("guard: both file inputs accept .zip,.html,.htm",
     (upload.match(/accept="\.zip,\.html,\.htm"/g) || []).length === 2, "accept not widened on both inputs");

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
