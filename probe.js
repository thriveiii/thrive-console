// probe.js - the opp.md blank-recipient probe (Axiom 8: run the LIVE parser over sample packages).
//
// Drives the real resolver (ThriveIntake.resolveBatch -> resolveOne) over two packages, each an index.html
// with NO email beside an opp.md that carries a Subject and a body:
//   S2  opp.md, recipient PRESENT  -> the message must resolve (subject + body), the qualifying path (no regression)
//   S3  opp.md, recipient EMPTY    -> the message must SURVIVE (subject + body) with needs_recipient true
//
// Before the fix, S3 loses the subject and body (the resolver discards a message with no recipient and builds a
// blank "needs message" card). After the fix, S3 keeps them. Fails-when-broken: exits non-zero if S3 is lost or
// S2 regresses.
//
// Usage: node probe.js [path/to/intake.js]   (default: library/intake.js)

const path = require("path");
const intakePath = path.resolve(process.argv[2] || "library/intake.js");
const TI = require(intakePath).ThriveIntake;

const INDEX = "<html><head><title>Demo Opportunity</title></head><body><h1>Demo Opportunity</h1></body></html>";
function oppMd(sendTo) {
  return [
    "Business: Demo Opportunity",
    "Subject: The demo opening",
    "Send to:" + (sendTo ? " " + sendTo : ""),
    "---",
    "Hi {{NAME}},",
    "",
    "This is the demo body.",
    "",
    "Thanks",
  ].join("\n");
}

// Resolve one package (an index.html + an opp.md in the same folder) and return the chosen entry.
function resolve(slug, sendTo) {
  const pages = [{ name: "opp/" + slug + "/index.html", html: INDEX }];
  const manifests = [{ name: "opp/" + slug + "/opp.md", text: oppMd(sendTo) }];
  const out = TI.resolveBatch(pages, manifests, []);
  return (out.entries || [])[0] || {};   // the resolved entries from resolveOne (one per opportunity slug)
}

function pres(x) { return x && String(x).trim() ? "PRESENT" : "LOST"; }

const s2 = resolve("demo-s2", "buyer@demo.test");
const s3 = resolve("demo-s3", "");

console.log("S2  opp.md, recipient PRESENT ->  " +
  (s2.email || s2.url ? "matched" : "NO RECIPIENT") + ", subject " + pres(s2.subject) + ", body " + pres(s2.body));
console.log("S3  opp.md, recipient EMPTY   ->  subject " + pres(s3.subject) + ", body " + pres(s3.body) +
  ", needs_recipient " + (s3.needs_recipient === true ? "true" : String(s3.needs_recipient)));

let fails = 0;
function ck(name, cond) { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) fails++; }
console.log("");
ck("S2 recipient present: subject + body resolve (no regression)", pres(s2.subject) === "PRESENT" && pres(s2.body) === "PRESENT" && !!(s2.email || s2.url));
ck("S2 recipient present: needs_recipient is false", s2.needs_recipient === false);
ck("S3 recipient empty: the WRITTEN message survives (subject + body kept)", pres(s3.subject) === "PRESENT" && pres(s3.body) === "PRESENT");
ck("S3 recipient empty: needs_recipient is true (the blank recipient is flagged, not the message dropped)", s3.needs_recipient === true);
ck("S3 recipient empty: no recipient was invented", !s3.email && !s3.url);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
