/* The outgoing-mail footer shows the correct registered address, from one source, and never "Egypt".

   The footer was printing "Thrive Digital Solutions, Alexandria, Egypt" on live client mail. The cause
   was a hardcoded, simply-wrong constant (library/store.js POSTAL), not a country inferred from a city.
   Both the HTML footer and the plain-text alternative read that ONE constant, so correcting it once
   corrects every piece of outgoing mail. This runs the real library/store.js and composes the footer the
   same way the send path does (composedHtml + footerHtml, composedText + footerText).

   The sandbox cannot send through Resend, so the final confirmation is Thyab's send: the Resend preview
   shows the corrected footer. This proves the composed text the send path produces. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const Store = require(path.join(ROOT, "library/store.js"));

const CORRECT = "Thrive Digital Solutions, VA, USA";
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

// 1. One explicit source, holding the correct registered address.
ck("the single source (POSTAL) is the correct registered address", Store.POSTAL === CORRECT, Store.POSTAL);
ck("the single source never says Egypt", Store.POSTAL.indexOf("Egypt") < 0);

// 2. The HTML footer and the plain-text alternative both carry it, in both languages, never Egypt.
["en", "ar"].forEach(function (lang) {
  const h = Store.footerHtml(lang), tx = Store.footerText(lang);
  ck("the HTML footer (" + lang + ") shows the correct address", h.indexOf(CORRECT) >= 0, h);
  ck("the HTML footer (" + lang + ") never says Egypt", h.indexOf("Egypt") < 0);
  ck("the plain-text alternative (" + lang + ") shows the correct address", tx.indexOf(CORRECT) >= 0, tx);
  ck("the plain-text alternative (" + lang + ") never says Egypt", tx.indexOf("Egypt") < 0);
  // both footers derive from the one source
  ck("the HTML footer (" + lang + ") derives from POSTAL", h.indexOf(Store.POSTAL) >= 0);
  ck("the plain-text alternative (" + lang + ") derives from POSTAL", tx.indexOf(Store.POSTAL) >= 0);
});

// 3. Compose the whole message the way the send path does (app.js: composedHtml()+footerHtml, etc.).
const composedHtml = "<p>Hi Deborah,</p><p>Congratulations on the new shop.</p>";
const composedText = "Hi Deborah,\n\nCongratulations on the new shop.";
["en", "ar"].forEach(function (lang) {
  const fullHtml = composedHtml + Store.footerHtml(lang);
  const fullText = composedText + Store.footerText(lang);
  ck("the composed HTML email (" + lang + ") footer reads the correct address", fullHtml.indexOf(CORRECT) >= 0);
  ck("the composed HTML email (" + lang + ") never says Egypt", fullHtml.indexOf("Egypt") < 0);
  ck("the composed plain-text email (" + lang + ") footer reads the correct address", fullText.indexOf(CORRECT) >= 0);
  ck("the composed plain-text email (" + lang + ") never says Egypt", fullText.indexOf("Egypt") < 0);
});

// 4. The country is never inferred from a city name, and the wrong string appears nowhere in the
//    address-composing code. The word "Egypt" survives only inside the self test below, which names it
//    to forbid it; the composition code (the POSTAL constant and the footer builders) is Egypt-free.
const storeSrc = fs.readFileSync(path.join(ROOT, "library/store.js"), "utf8");
const composeCode = storeSrc.slice(0, storeSrc.indexOf("function selfTest"));
ck("the address-composing code (POSTAL + footer builders) never says Egypt", composeCode.indexOf("Egypt") < 0);
ck("mail composition has no city-to-country inference (no lookup keyed on a city name)",
   !/Alexandria[^"]*Egypt|city[^\n]*country|country[^\n]*Alexandria/i.test(composeCode));
// Across the shipped library, "Egypt" appears only inside a test guard that forbids it, never as data.
function walk(dir) {
  let out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f); const st = fs.statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) out = out.concat(walk(p)); }
    else if (/\.(js|html)$/.test(f)) out.push(p);
  }
  return out;
}
const egyptFiles = walk(path.join(ROOT, "library")).filter(function (p) {
  const src = fs.readFileSync(p, "utf8");
  if (p.endsWith("store.js")) return src.slice(0, src.indexOf("function selfTest")).indexOf("Egypt") >= 0;  // only the guard may name it
  return /Egypt/i.test(src);
}).map(function (p) { return path.relative(ROOT, p); });
ck("no shipped library file carries Egypt as data (only the store self-test names it to forbid it)", egyptFiles.length === 0, egyptFiles.join(", "));

// 5. The module's own self test (which now asserts the correct address and never Egypt) passes.
const st = Store.selfTest();
ck("ThriveStore.selfTest passes", st.pass, st.failures);

console.log("\n" + (fails ? ("FAILED: " + fails + " check(s)") : "ALL MAIL FOOTER CHECKS PASS"));
process.exit(fails ? 1 : 0);
