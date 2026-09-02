// mail-dedup-key gate: fails-when-broken checks that the browser confirm write keys console_mail by the SAME
// primary key as the relay (the Resend id), so the two writers collapse to ONE row instead of duplicating.
//
// Production: one send produced two rows - the relay's (keyed by the Resend id snd_...) and the browser's (keyed
// by the local id, a UUID). supaMailRow keys id = rec.mid || rec.id (mid wins), so the browser wrote a different
// primary key. supaConfirmMail now forces row.id = rec.id (the Resend id) after supaMailRow. This runs the REAL
// supaMailRow and the fix logic, and source-guards supaConfirmMail. Pure Node. Run: node tools/mail_dedup_key_test.js

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

// ---- run the REAL supaMailRow + the confirm-path key fix over the production shape ----
const mrSrc = fnSrc(app, "function supaMailRow(");
ck("supaMailRow is defined", !!mrSrc);
const supaMailRow = new Function(mrSrc + "\nreturn supaMailRow;")();

// The exact confirm-row relaySend builds: it carries the LOCAL id (mid, a UUID) AND the Resend id (id: parsed.id).
const RESEND_ID = "snd_11m6y4f10jh02p";
const LOCAL_MID = "44a26e4c-6e66-4a07-8d5a-e8b1fd6d52d1";
const confRow = { mid: LOCAL_MID, id: RESEND_ID, opp: "dalat-opportunity-internal-ar", to: "abdullahthyab@gmail.com", subject: "He", status: "sent", actor: "op@x" };

// Before the fix: supaMailRow alone keys by mid (the local UUID) -> the duplicate.
const rawRow = supaMailRow(confRow);
ck("supaMailRow alone keys by the LOCAL mid (this is the source of the duplicate)", rawRow.id === LOCAL_MID, rawRow.id);

// The fix, applied exactly as in supaConfirmMail: force row.id = rec.id (the Resend id) when present.
function confirmKey(rec) { var row = supaMailRow(rec); if (rec && rec.id) row.id = rec.id; return row; }
const fixed = confirmKey(confRow);
ck("after the fix the browser row keys by the RESEND id (merges with the relay's row, not a duplicate)",
   fixed.id === RESEND_ID, fixed.id);
ck("the merged row still carries the other fields (opp, to_addr, subject) intact",
   fixed.opp === "dalat-opportunity-internal-ar" && fixed.to_addr === "abdullahthyab@gmail.com" && fixed.subject === "He", fixed);

// No Resend id (relay returned none): the override does not fire, so the row keeps its local key as a durable
// backup - and there is no relay twin to duplicate.
const noResend = confirmKey({ mid: LOCAL_MID, id: "", opp: "o", to: "a@b", subject: "s", status: "sent" });
ck("with no Resend id the row keeps its local key (durable backup, no relay twin to duplicate)", noResend.id === LOCAL_MID, noResend.id);

// ---- source-guard: the fix sits in supaConfirmMail, right after supaMailRow, before the enqueue ----
const scm = fnSrc(app, "async function supaConfirmMail(");
ck("supaConfirmMail forces row.id = rec.id (keys by the Resend id)", /if\(rec && rec\.id\) row\.id=rec\.id;/.test(scm), scm.slice(0, 400));
const iRow = scm.indexOf("var row=supaMailRow(rec);");
const iFix = scm.indexOf("row.id=rec.id;");
const iEnq = scm.indexOf('supaEnqueue({ op:"upsert", t:"console_mail"');
ck("the key fix is applied AFTER supaMailRow and BEFORE the durable enqueue (so the queued row is keyed too)",
   iRow >= 0 && iFix > iRow && iEnq > iFix, { iRow: iRow, iFix: iFix, iEnq: iEnq });

// Scope guard: the confirm return contract is untouched.
ck("the confirm return contract is unchanged (confirmed / noServer / signedOut still returned)",
   /return \{ confirmed:false, noServer:true \}/.test(scm) && /return \{ confirmed:false, signedOut:true \}/.test(scm) && /return \{ confirmed:true \}/.test(scm), scm);

// Companion consistency: reconcileSendingMail must match a 'sending' row by EITHER key (the local mid OR the
// Resend id), because the queued write is now keyed by the Resend id. Matching by mid alone would desync and
// graduate the row to 'sent' before the write lands (regressing the 'sending' outbox; caught by send_confirmed S2).
const rsm = fnSrc(app, "function reconcileSendingMail(");
ck("reconcileSendingMail matches by EITHER the local mid or the Resend id (not mid-first only)",
   /queuedIds\[idM\]\)\s*\|\|\s*\(idI && queuedIds\[idI\]\)/.test(rsm) && rsm.indexOf("var id=m.mid||m.id||") < 0, rsm);
ck("reconcileSendingMail graduates only when NEITHER key is still queued (the outbox is preserved until it lands)",
   /if\(\(idM\|\|idI\) && !stillQueued\)/.test(rsm), rsm);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
