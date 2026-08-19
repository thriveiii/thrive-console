/* P21 · the send moment, and the card's cumulative activity memory (R15).

   Two things live here, proven against the real library/app.js:

   1. THE SEND MOMENT. A confirmed outreach send never blocks the screen and never raises the generic
      unsaved-edits dialog: it shows an in-repo SVG confirmation (showSendMoment) and returns to the board by
      closing the modal DIRECTLY (bypassing the edit-only close guard). The dialog stays bound to edit flows.

   2. THE ACTIVITY TRAIL. cardActivity(slug) is the card's memory, newest-first. Sends and replies are DERIVED
      from the ledger (buildThread), never double-stored: a legacy 'email' activity row is dropped. Only
      genuinely new operations remain as activity rows. activityTrailHtml renders it, and a message entry
      expands IN PLACE through the ONE P12 bubble path (thSentBubble / thReplyBubble) - grep-proven, no copy.

   Structural invariants are grep-checked on the source; the model behaviour (derive, order, idempotency,
   render) runs the real cardActivity + activityTrailHtml extracted from app.js under a small stub harness. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const APP = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}
function slice(src, startMark, endMark) {
  const a = src.indexOf(startMark); if (a < 0) throw new Error("start not found: " + startMark);
  const b = src.indexOf(endMark, a); if (b < 0) throw new Error("end not found: " + endMark);
  return src.slice(a, b + endMark.length);
}
function count(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; }

// ---------------------------------------------------------------- 1. the send moment (structural)
ck("showSendMoment is defined", /function showSendMoment\(/.test(APP));
ck("the confirmation mark is an in-repo inline SVG (no external asset, no library)",
   /function sendMomentMark\(/.test(APP) && /<svg class="sm-mark"/.test(APP));
ck("the moment uses the localized line key send_moment_line", APP.indexOf('t("send_moment_line")') >= 0);
ck("returnToBoardAfterSend returns to the board by closing the modal DIRECTLY (no edit-close dialog)",
   /function returnToBoardAfterSend\(/.test(APP) && /window\.thriveModal\.close\(true\)/.test(APP));
// the outreach send tail: the moment is shown, and the send is NOT logged as a separate activity row
const sendTail = slice(APP, "recordSend(); renderQuota();", "window.__composeReady");
ck("a confirmed outreach send shows the send moment", sendTail.indexOf("showSendMoment(") >= 0, sendTail.slice(0, 120));
ck("the send is NOT double-written as an activity row (derived from the ledger instead)",
   sendTail.indexOf('logActivity("email"') < 0);
ck("the generic unsaved-edits dialog (askBeforeClose) is NOT invoked by the send path",
   sendTail.indexOf("askBeforeClose") < 0);

// ---------------------------------------------------------------- 2. one P12 render path (structural)
ck("renderMessageBody has exactly TWO call sites (thSentBubble + thReplyBubble) - one render path, no copy",
   count(APP, "renderMessageBody(msg)") === 3,   // the 2 call sites + the 1 function definition
   "occurrences=" + count(APP, "renderMessageBody(msg)"));
ck("the activity trail expands a message through the same P12 builders",
   /function activityTrailHtml\(/.test(APP) && APP.indexOf("thSentBubble(e)") >= 0 && APP.indexOf("thReplyBubble(e, slug)") >= 0);
ck("the History tab mounts the activity trail (renderHistory -> activityTrailHtml)",
   APP.indexOf('data-history-renderer", "renderHistory>activityTrailHtml') >= 0);

// ---------------------------------------------------------------- 3. per-user (actor-scoped) drafts (structural)
ck("the compose working-draft is per-actor (composeDraftGet / composeDraftSet read/write byActor[actor])",
   /function composeDraftGet\(/.test(APP) && /function composeDraftSet\(/.test(APP) && /cd\.byActor\[actor\]/.test(APP));
ck("persist, clear and restore all go through the per-actor draft helpers",
   APP.indexOf("composeDraftSet(slug, currentActor(), Object.assign") >= 0 &&
   APP.indexOf("composeDraftSet(slug, currentActor(), null)") >= 0 &&
   APP.indexOf("composeDraftGet(oppObj, currentActor())") >= 0);

// ---------------------------------------------------------------- 4. the model: derive, order, idempotency, render
// Extract the real cardActivity + activityTrailHtml (+ ACT_DERIVED / ACT_ICON) and run them with a stub harness.
const modelSrc = slice(APP, "var ACT_DERIVED=", "if(typeof window!==\"undefined\"){ window.activityTrailHtml=activityTrailHtml; window.cardActivity=cardActivity; }");
const THREAD = [   // oldest-first, as buildThread returns
  { kind:"sent", ts:"2026-08-01T10:00:00Z", to:"a@x", toName:"Deborah", subject:"Hello", actor:"uid-thyab" },
  { kind:"act",  ts:"2026-08-01T10:00:05Z", action:"email", detail:"a@x · Hello", actor:"uid-thyab" },  // legacy DOUBLE of the send
  { kind:"act",  ts:"2026-08-02T09:00:00Z", action:"draft_save", detail:"", actor:"uid-agha" },          // a genuine new op (edit)
  { kind:"reply",ts:"2026-08-03T08:00:00Z", from:"Deborah", subject:"Re: Hello", snippet:"yes", id:"r1" },
  { kind:"open", ts:"2026-08-02T12:00:00Z" }
];
const sandbox = {
  console: console, JSON: JSON, String: String, Array: Array, Object: Object, Math: Math,
  buildThread: () => THREAD.map(e => Object.assign({}, e)),
  tsMs: (v) => Date.parse(v) || 0,
  esc: (s) => String(s == null ? "" : s),
  ic: (n) => "<svg data-ic='" + n + "'></svg>",
  t: (k) => k,
  thWhen: (ts) => "<time>" + ts + "</time>",
  resolveOperator: (uid) => ({ "uid-thyab": "Abdullah Thyab", "uid-agha": "Basel Agha" }[uid] || ""),
  thSentBubble: (e) => "<li class='th-sent' data-bubble='msgBubble'>SENT:" + (e.subject || "") + "</li>",
  thReplyBubble: (r) => "<li class='th-reply' data-bubble='msgBubble'>REPLY:" + (r.subject || "") + "</li>",
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelSrc + "\n;this.__cardActivity=cardActivity; this.__trail=activityTrailHtml;", sandbox);
const cardActivity = sandbox.__cardActivity, trailHtml = sandbox.__trail;

const trail = cardActivity("madar");
ck("derive-not-double-store: the legacy 'email' activity row is dropped (the send is derived from the ledger)",
   trail.filter(e => e.kind === "act" && e.action === "email").length === 0);
ck("the ledger send itself is kept (one representation of the send)",
   trail.filter(e => e.kind === "sent").length === 1);
ck("the genuinely-new operation (draft_save / edit) is kept as an activity row",
   trail.filter(e => e.kind === "act" && e.action === "draft_save").length === 1);
ck("the trail is newest-first",
   trail.length >= 2 && Date.parse(trail[0].ts) >= Date.parse(trail[trail.length - 1].ts));

const html1 = trailHtml("madar");
ck("a send is a tappable trail entry that carries its actor",
   html1.indexOf('data-tr="sent"') >= 0 && html1.indexOf("Abdullah Thyab") >= 0);
ck("the edit entry carries its author (a second profile)",
   html1.indexOf("Basel Agha") >= 0);
ck("a message entry expands IN PLACE, and the expansion is the P12 bubble (thSentBubble/thReplyBubble output)",
   html1.indexOf('class="tr-expand"') >= 0 && html1.indexOf("SENT:Hello") >= 0 && html1.indexOf("REPLY:Re: Hello") >= 0);
ck("the trail self-identifies as activityTrailHtml", html1.indexOf('data-renderer="activityTrailHtml"') >= 0);

// idempotency: ten renders byte-identical
let stable = true; for (let i = 0; i < 10; i++) { if (trailHtml("madar") !== html1) { stable = false; break; } }
ck("ten reads are byte-identical (a stable, deterministic trail)", stable);

console.log("\n" + (fails ? ("FAILED: " + fails + " check(s)") : "ALL SEND-MOMENT / ACTIVITY CHECKS PASS"));
process.exit(fails ? 1 : 0);
