/* Deterministic slug derivation: "&" reads as "and", so one business yields ONE slug, never a phantom.
 *
 * The bug: slugify dropped "&" (collapsed " & " to a single "-"), so "Gift & Gather" derived gift-gather
 * while the manifest carried the canonical gift-and-gather. The page slug and the manifest slug then
 * disagreed, applyJson could not merge them, and the review table showed TWO rows for one shop. The fix
 * makes "&" always read as "and" in both the match key (keyOf) and the slug (slugify), so a page and its
 * manifest entry resolve to the SAME identity and merge into one row.
 *
 * Pure logic, Node, exit code. Fails-when-broken: revert the "&"->"and" rule and the collapse check reds.
 */
const path = require("path");
const TI = require(path.join(__dirname, "../library/intake.js")).ThriveIntake;

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

// 1. deterministic derivation: every spelling of "Gift & Gather" yields the one canonical slug.
const canonical = "gift-and-gather";
[
  ["Gift & Gather", canonical],
  ["Gift&Gather", canonical],
  ["gift  &  gather", canonical],
  ["Gift and Gather", canonical],   // the already-spelled-out form matches too
  ["GIFT & GATHER", canonical],
].forEach(function (pair) {
  ck('slugify(' + JSON.stringify(pair[0]) + ') === "' + pair[1] + '"',
     TI.slugify(pair[0]) === pair[1], TI.slugify(pair[0]));
});

// the ampersand is a word, not a separator: the phantom form is never produced.
ck('slugify never yields the ampersand-dropped phantom "gift-gather"',
   TI.slugify("Gift & Gather") !== "gift-gather", TI.slugify("Gift & Gather"));

// other "&" businesses derive sensibly too (no dropped word, no double hyphen).
ck('slugify("Ben & Jerry\'s") === "ben-and-jerrys"',
   TI.slugify("Ben & Jerry's") === "ben-and-jerrys", TI.slugify("Ben & Jerry's"));

// 2. the collapse: a page entry (business "Gift & Gather", no slug_hint) and a manifest entry
//    (slug gift-and-gather) now resolve to ONE row, not two.
function rowsFor(pageBusiness, manifestSlug) {
  var pageEntry = { n: 1, business: pageBusiness, city: "", channel: "web", url: "giftgather.example",
    email: "", page_file: "giftgather.html", slug_hint: "", subject: "Hello", body: "Some text",
    extra: {}, warnings: [], file: { name: "giftgather.html", html: "<h1>" + pageBusiness + "</h1>" } };
  var entries = TI.applyJson([pageEntry], [{ slug: manifestSlug, business: pageBusiness, template: "en-opp1" }]);
  return TI.batchReport(entries, { existingSlugs: [] }).rows;
}
var rows = rowsFor("Gift & Gather", "gift-and-gather");
ck("a page + its manifest entry merge into ONE review row (no duplicate slug)", rows.length === 1, rows.map(r => r.slug));
ck("the surviving row is the canonical manifest slug, gift-and-gather",
   rows.length === 1 && rows[0].slug === "gift-and-gather", rows.map(r => r.slug));
ck("the surviving row carries no duplicate_slug warning",
   rows.length === 1 && rows[0].reasons.indexOf("duplicate_slug") < 0, rows[0] && rows[0].reasons);

// 3. determinism is stable: the same input twice yields the same slug (idempotent derivation).
ck("derivation is idempotent (same input -> same slug on re-run)",
   TI.slugify("Gift & Gather") === TI.slugify("Gift & Gather"));

// 4. a real duplicate (two entries genuinely on one slug) is still reported, not hidden by the merge.
var dupEntries = [
  { n: 1, business: "Solo Shop", slug_hint: "solo-shop", subject: "a", body: "b", extra: {}, warnings: [],
    file: { name: "solo.html", html: "<h1>Solo</h1>" } },
  { n: 2, business: "Solo Shop", slug_hint: "solo-shop", subject: "c", body: "d", extra: {}, warnings: [],
    file: { name: "solo2.html", html: "<h1>Solo</h1>" } },
];
var dupRows = TI.batchReport(dupEntries, { existingSlugs: [] }).rows;
ck("a genuine same-slug collision is still flagged duplicate_slug (the fix does not mask real dupes)",
   dupRows.length === 2 && dupRows.every(r => r.reasons.indexOf("duplicate_slug") >= 0),
   dupRows.map(r => r.slug + ":" + r.reasons.join("|")));

console.log("\n" + (fails ? (fails + " failed") : "ALL SLUG DERIVATION CHECKS PASS"));
process.exit(fails ? 1 : 0);
