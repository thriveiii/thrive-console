// Stage-gate client gate: fails-when-broken checks that the client honors the approval gate (Axiom 6: no client
// stage math; the client stamps the approval and renders the stage the view returns).
//
//   - the "Approve" action (act "promote") stamps approved_at + approved_by (the actor), and NEVER writes stage.
//   - the "Back to review" action (act "revert") CLEARS approved_at, and NEVER writes stage.
//   - no onAction branch writes stage:"live" or stage:"draft" any more (the auto/manual stage math is gone).
//   - the draft label is renamed to "Under review" / «قيد المراجعة»; the engine value stays 'draft'.
//   - BOARD_QUERY selects approved_at / approved_by so the row carries the approval.
//   - runOppWrite runs an optional `after` follow-up between the patch and the board re-read (the approval note).
//
// Pure Node, no browser. Run: node tools/stage_gate_client_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const bundle = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

// The onAction slice for the two gate actions (from "if(act===\"promote\")" to the end of the revert line).
const at = bundle.indexOf('if(act==="promote")');
const seg = at >= 0 ? bundle.slice(at, at + 900) : "";

ck("the Approve action stamps approved_at + approved_by (the approver's uid)",
   /approved_at:at,\s*approved_by:by/.test(seg) && /var at = isoNow\(\), by = currentUid\(\);/.test(seg), seg);
ck("the Approve action NEVER writes stage (no client stage math on approve)",
   seg.indexOf('stage:"live"') < 0 && seg.indexOf("r.stage") < 0, seg);
ck("the Back-to-review action CLEARS approved_at (un-approve), never writes stage",
   /if\(act==="revert"\)\s*return runOppWrite\(slug, function\(r\)\{ r\.approved_at=null; r\.approved_by=null; \}, \{ approved_at:null, approved_by:null, up:m \}\)/.test(bundle),
   bundle.slice(bundle.indexOf('if(act==="revert")'), bundle.indexOf('if(act==="revert")') + 200));

// No onAction branch may write a pre-send stage any more (the auto-jump and the manual stage math are both gone).
const onAt = bundle.indexOf("function onAction(");
const onSeg = onAt >= 0 ? bundle.slice(onAt, onAt + 1600) : "";
ck("onAction writes no stage:'live' / stage:'draft' (Axiom 6: the view derives the pre-send stage)",
   onSeg.indexOf('stage:"live"') < 0 && onSeg.indexOf('stage:"draft"') < 0, onSeg);

// The optional approval note reuses the actor-carrying notes path.
ck("an optional approval note is recorded via addNote (carries actor + ts)",
   /note && note\.trim\(\)\) \? function\(\)\{ return addNote\(slug, note\.trim\(\)\)/.test(seg), seg);

// runOppWrite gained the `after` hook, run between the patch and the board re-read.
ck("runOppWrite accepts an `after` follow-up run before the board re-read",
   /function runOppWrite\(slug, optimistic, patch, after\)\{/.test(bundle) &&
   /return after \? Promise\.resolve\(\)\.then\(after\) : null;/.test(bundle), "runOppWrite after-hook missing");

// The rename: engine value stays 'draft'; only the label changes (EN + AR).
ck("the draft label is 'Under review' (EN)", /l_draft:"Under review"/.test(bundle), "EN l_draft not renamed");
ck("the draft label is «قيد المراجعة» (AR)", /l_draft:"قيد المراجعة"/.test(bundle), "AR l_draft not renamed");
ck("the engine still buckets a 'draft' lane (value unchanged, only the label)",
   /var LANES = \["draft","live"/.test(bundle) && /BOARD_LANES = \["draft","live"/.test(bundle), "draft engine value changed");

// The board row carries the approval columns so the card can render who approved.
ck("BOARD_QUERY selects approved_at and approved_by", /select=[^"']*\bapproved_at\b[^"']*\bapproved_by\b/.test(bundle), "approval columns not in BOARD_QUERY");

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
