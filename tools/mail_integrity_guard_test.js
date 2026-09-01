// mail-integrity-guard gate: fails-when-broken checks that an incomplete console_mail row is never written and
// never counted sent. Production held a phantom row (opp set, but empty id/to_addr/subject, status 'sent') that
// passed the opp-only guard and counted as a send; this widens the guard to the whole row at the single writer.
//
// Runs the REAL mailRowComplete (pure, extracted) and source-guards mailUpsert's filter/diverge/skip behavior.
// Pure Node, no browser. Run: node tools/mail_integrity_guard_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 200)); }
}
function fnSrc(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return "";
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}

// ---- run the REAL mailRowComplete over sample rows ----
const mrcSrc = fnSrc(app, "function mailRowComplete(");
ck("mailRowComplete is defined", !!mrcSrc);
const mailRowComplete = new Function(mrcSrc + "\nreturn mailRowComplete;")();

const full = { opp: "cozy-calico-books", id: "m1", to_addr: "buyer@x.test", subject: "The opening" };
ck("a complete row (opp,id,to_addr,subject) is accepted", mailRowComplete(full) === true);

// the exact production phantom: opp set, but empty id/to_addr/subject
ck("the production phantom (opp only, empty id/to_addr/subject) is REFUSED",
   mailRowComplete({ opp: "cozy-calico-books", id: "", to_addr: "", subject: "" }) === false);
["opp", "id", "to_addr", "subject"].forEach(function (f) {
  const row = Object.assign({}, full); row[f] = "";
  ck("a row missing " + f + " is refused", mailRowComplete(row) === false, row);
  const ws = Object.assign({}, full); ws[f] = "   ";
  ck("a row with whitespace-only " + f + " is refused", mailRowComplete(ws) === false, ws);
});
ck("an inbound-style row that carries all four still passes (to_addr=sender, subject='Re: ...')",
   mailRowComplete({ opp: "echo", id: "r1", to_addr: "sender@x", subject: "Re: Intro" }) === true);
ck("null / empty is refused (never a phantom)", mailRowComplete(null) === false && mailRowComplete({}) === false);

// ---- source-guard mailUpsert: filter to complete, record each refusal, skip the server when none remain ----
const mu = fnSrc(app, "async function mailUpsert(");
ck("mailUpsert filters through mailRowComplete before the server write",
   /mailRowComplete\(r\)/.test(mu), mu.slice(0, 200));
ck("a refused row is recorded on the diverge ledger (refused: incomplete row ...), never silently dropped",
   /supaRecordDiverge\("write", "console_mail", "refused: incomplete row /.test(mu), mu);
ck("an all-incomplete batch returns { skipped:true, incomplete:true } and never touches the server",
   /if\(!arr\.length\) return \{ skipped:true, incomplete:true \}/.test(mu), mu);
ck("only the complete rows (arr) are sent to ThriveSupa.upsert (never the raw input)",
   /ThriveSupa\.upsert\("console_mail", arr\)/.test(mu) && mu.indexOf('upsert("console_mail", all)') < 0, mu);
ck("the schema-drift retry is preserved (owner/actor migration behind still records)",
   /mailColMissing\(e\)/.test(mu) && /arr\.map\(stripOptionalMailCols\)/.test(mu), mu);

// ---- the guard is at the SINGLE chokepoint: every path funnels through mailUpsert ----
ck("the flush router writes console_mail through mailUpsert",
   /e\.t==="console_mail"\) await mailUpsert\(e\.rows\)/.test(app));
ck("supaConfirmMail writes through mailUpsert",
   /await mailUpsert\(\[row\]\)/.test(app));
ck("the reconcile/backfill writes through mailUpsert",
   /await mailUpsert\(\[supaMailRow\(/.test(app));

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
