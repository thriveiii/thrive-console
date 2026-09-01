// create-never-drops gate: fails-when-broken guard that a hosted create stages the card BEFORE attempting the
// publish, so a hosting failure (a member device with no GitHub token) lands the card as an unpublished draft
// instead of dropping it (Axiom 3). The runtime path is DOM/GitHub-coupled (publishOpp writes to GitHub), so the
// device is the real proof; this guard protects the source ORDER + the deferred-not-dropped handling from a revert.
//
// Pure Node, reads library/app.js. Run: node tools/create_never_drops_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 200)); }
}

// Isolate writeImport by balanced braces so the offsets below are within that one function.
function fnBody(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return "";
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}
let wi = fnBody(app, "async function writeImport(");
if (!wi) wi = fnBody(app, "function writeImport(");
ck("writeImport is present", !!wi);

const iStage = wi.indexOf("staged.push(rec)");
const iHost = wi.indexOf("if(it.host)");
const iPublish = wi.indexOf("publishOpp(");

ck("writeImport stages the record (staged.push(rec)) and attempts a host publish", iStage >= 0 && iHost >= 0 && iPublish >= 0);
ck("the card is STAGED BEFORE the host publish is attempted (a create never drops on hosting failure)",
   iStage >= 0 && iHost >= 0 && iStage < iHost, { iStage: iStage, iHost: iHost });
ck("the publish is attempted AFTER staging (publishOpp sits inside the it.host block, past the stage)",
   iPublish > iStage, { iStage: iStage, iPublish: iPublish });

// The publish sits in its own try/catch; the catch defers (unpublished draft), never drops, never counts failed.
const hostBlock = iHost >= 0 ? wi.slice(iHost, iHost + 900) : "";
ck("the host publish is wrapped in try/catch", /try\s*\{[\s\S]*publishOpp\([\s\S]*\}\s*catch\s*\(/.test(hostBlock), hostBlock.slice(0, 120));
ck("a hosting failure defers, not drops: rec.needs_hosting=true and rec.published=false",
   /rec\.needs_hosting\s*=\s*true/.test(hostBlock) && /rec\.published\s*=\s*false/.test(hostBlock), hostBlock);
ck("a hosting failure is NOT counted as a failed import (it is hosting_deferred)",
   /hosting_deferred/.test(hostBlock) && hostBlock.indexOf("tally.failed") < 0, hostBlock);
ck("the owner happy path still marks published on a successful publish (no regression)",
   /rec\.published\s*=\s*true;\s*tally\.hosted\+\+/.test(hostBlock), hostBlock);

// The outer per-item catch still counts REAL errors as failed (a store/record error, not a hosting shortfall).
ck("the outer per-item catch still counts a real error as tally.failed",
   /catch\(err\)\{\s*tally\.failed\+\+/.test(wi), "outer catch changed");

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
