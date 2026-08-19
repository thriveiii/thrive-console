/* P20 · R14 - one signature system, per sender, managed, never duplicated.

   The live defect: a sent email carried the closing block twice (a sender name + Thrive Digital Solutions
   + thriveiii.com, then again a second sign-off) above the compliance footer. Two sources wrote a closing.
   The fix makes the signature ONE saved text block per sender, appended exactly once by the compile path
   (brandWrap), with the legacy closing block and every template-embedded sign-off removed so a second
   closing is structurally impossible. The compliance footer (store.js POSTAL) stays separate, appended once.

   This runs the REAL R14 signature helpers and brandWrap, extracted verbatim from library/app.js and
   evaluated with a faithful per-actor store (profilePrefNS/setProfilePrefNS keyed on the signed-in actor),
   then composes the whole message the way the send path does: brandWrap(body, branded, sig) + the real
   store.js footer. It proves: signature once + footer once (EN and AR), two actors keep their own names
   over one fixed agency block, add/edit/delete/set-default persist per actor, the composer's read-only
   preview equals what is sent, and there is exactly ONE signature injection site in app.js. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const Store = require(path.join(ROOT, "library/store.js"));
const APP = fs.readFileSync(path.join(ROOT, "library/app.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 400)); }
}
function slice(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error("start marker not found: " + startMark);
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error("end marker not found: " + endMark);
  return src.slice(a, b);
}

// --- extract the pure R14 signature logic (module scope down to signatureForId, before the DOM helpers)
const sigBlock = slice(APP, "const AGENCY_NAME =", "function renderSignatures");
// --- extract brandWrap, the ONE closing/signature injection site
const brandWrap = slice(APP, "function brandWrap(", "\n/* email templates");

// --- a faithful per-actor store: profilePrefNS reads / setProfilePrefNS writes, keyed on currentActor()
const perActor = {};                 // actorId -> { "signature": {list,def}, ... }
let ACTOR = "uid-thyab";
const NAMES = { "uid-thyab": "Abdullah Thyab", "uid-agha": "Basel Agha" };
const AR_NAMES = { "uid-thyab": "عبدالله ذياب", "uid-agha": "باسل آغا" };

const sandbox = {
  console: console, Date: Date, Math: Math, JSON: JSON, String: String, Array: Array, Object: Object,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },   // empty legacy blob
  esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  currentActor: () => ACTOR,
  resolveOperator: (uid) => NAMES[uid] || "",
  getFromName: () => "Thrive",
  getLang: () => "en",
  profilePrefNS: (ns, dflt) => { const a = perActor[ACTOR] || {}; return (a[ns] !== undefined) ? a[ns] : dflt; },
  setProfilePrefNS: (ns, v) => { (perActor[ACTOR] = perActor[ACTOR] || {})[ns] = v; },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(sigBlock + "\n" + brandWrap +
  "\n;this.__api={ sigStore, sigList, sigById, sigDefault, sigAdd, sigUpdate, sigRemove, sigSetDefault," +
  " renderSignature, signatureFor, signatureForId, brandWrap, AGENCY_NAME, AGENCY_SITE };", sandbox);
const A = sandbox.__api;

// Compose a whole message the way the send path does: brandWrap(body, branded, sig) + the store footer.
function sendEmail(actor, bodyHtml, loc, branded) {
  ACTOR = actor;
  const sig = A.signatureFor(loc);                              // the ONE resolved signature, per actor+lang
  const wrapped = A.brandWrap(bodyHtml, !!branded, sig);        // the ONE injection site
  const footer = (loc === "AR") ? Store.footerHtml("ar") : Store.footerHtml("en");
  return wrapped + footer;
}
function countOccurrences(hay, needle) {
  let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n;
}

const AGENCY = A.AGENCY_NAME, SITE = A.AGENCY_SITE, POSTAL = Store.POSTAL;

// The signature's distinctive fingerprint in composed HTML: the agency name sitting directly above the
// site (AGENCY<br>SITE). The compliance footer names the company too (POSTAL = "...VA, USA"), legally and
// once, but never in that agency->site adjacency, so this counts the SIGNATURE block, not the footer.
const SIG_FP = AGENCY + "<br>" + SITE;

// 1. Signature once + footer once, English.
{
  const html = sendEmail("uid-thyab", "<p>Hi Deborah,</p><p>Congratulations on the new shop.</p>", "EN", false);
  ck("EN: the signature closing block appears exactly once (no second closing)", countOccurrences(html, SIG_FP) === 1, "count=" + countOccurrences(html, SIG_FP));
  ck("EN: the agency site appears exactly once", countOccurrences(html, SITE) === 1, "count=" + countOccurrences(html, SITE));
  ck("EN: the sender name appears exactly once", countOccurrences(html, "Abdullah Thyab") === 1, "count=" + countOccurrences(html, "Abdullah Thyab"));
  ck("EN: the compliance footer address appears exactly once", countOccurrences(html, POSTAL) === 1, "count=" + countOccurrences(html, POSTAL));
  ck("EN: the STOP compliance line is present once", countOccurrences(html, "STOP") === 1, "count=" + countOccurrences(html, "STOP"));
}

// 2. Signature once + footer once, Arabic (the delivered-email defect was seen in both languages).
{
  ACTOR = "uid-thyab"; perActor["uid-thyab"] = {};             // reset to reseed with the Arabic name
  A.sigUpdate(A.sigDefault().id, { name_ar: AR_NAMES["uid-thyab"] });
  const html = sendEmail("uid-thyab", "<p>مرحبًا ديبورا،</p><p>مبروك المتجر الجديد.</p>", "AR", false);
  ck("AR: the signature closing block appears exactly once (no second closing)", countOccurrences(html, SIG_FP) === 1, "count=" + countOccurrences(html, SIG_FP));
  ck("AR: the sender Arabic name appears exactly once", countOccurrences(html, AR_NAMES["uid-thyab"]) === 1, "count=" + countOccurrences(html, AR_NAMES["uid-thyab"]));
  ck("AR: the compliance footer address appears exactly once", countOccurrences(html, POSTAL) === 1, "count=" + countOccurrences(html, POSTAL));
  ck("AR: the Arabic STOP line (إيقاف) is present", html.indexOf("إيقاف") >= 0);
}

// 3. Two actors produce their OWN name over the SAME fixed agency block.
{
  perActor["uid-thyab"] = {}; perActor["uid-agha"] = {};       // fresh per-actor stores, each seeds from its operator name
  const thyab = (ACTOR = "uid-thyab", A.signatureFor("EN"));
  const agha  = (ACTOR = "uid-agha",  A.signatureFor("EN"));
  ck("actor A signature carries A's name", thyab.indexOf("Abdullah Thyab") >= 0, thyab);
  ck("actor B signature carries B's name", agha.indexOf("Basel Agha") >= 0, agha);
  ck("actor A does not carry actor B's name", thyab.indexOf("Basel Agha") < 0);
  ck("both signatures carry the identical fixed agency block", thyab.indexOf(AGENCY + "\n" + SITE) >= 0 && agha.indexOf(AGENCY + "\n" + SITE) >= 0);
  ck("the agency name is fixed, never per-user", thyab.indexOf(AGENCY) >= 0 && agha.indexOf(AGENCY) >= 0);
}

// 4. Add / edit / delete / set-default persist per actor.
{
  ACTOR = "uid-thyab"; perActor["uid-thyab"] = {};
  const before = A.sigList().length;
  const added = A.sigAdd("Abdullah Thyab", "عبدالله ذياب");
  ck("add: a new signature is stored", A.sigList().length === before + 1);
  ck("add: it persisted to the per-actor store", (perActor["uid-thyab"]["signature"].list || []).some((s) => s.id === added.id));
  A.sigUpdate(added.id, { name_en: "A. Thyab" });
  ck("edit: the name is updated in place", A.sigById(added.id).name_en === "A. Thyab");
  ck("edit: only the name changed; the agency block is not stored per-signature", A.sigById(added.id).name_en === "A. Thyab" && A.renderSignature(A.sigById(added.id), "EN").indexOf(AGENCY) >= 0);
  A.sigSetDefault(added.id);
  ck("set-default: the chosen signature becomes the default", A.sigDefault().id === added.id);
  ck("set-default: persisted", perActor["uid-thyab"]["signature"].def === added.id);
  const n = A.sigList().length;
  A.sigRemove(added.id);
  ck("delete: the signature is removed", A.sigList().length === n - 1 && !A.sigById(added.id));
  ck("delete: the default falls back to a surviving signature", !!A.sigDefault() && A.sigList().some((s) => s.id === A.sigDefault().id));
  // a signature added under actor A is invisible to actor B (per-actor isolation)
  ACTOR = "uid-agha";
  ck("a signature is private to its actor (B does not see A's list)", !A.sigList().some((s) => s.id === added.id));
}

// 5. Preview equals sent: the composer's read-only preview text is exactly what compile injects.
{
  ACTOR = "uid-thyab"; perActor["uid-thyab"] = {};
  const previewText = A.signatureForId(A.sigDefault().id, "EN");   // what the composer's #sigBox shows
  const sentHtml = A.brandWrap("<p>Body.</p>", false, previewText);
  const sigAsHtml = sandbox.esc(previewText).split("\n").join("<br>");
  ck("preview == sent: the injected signature is exactly the previewed text", sentHtml.indexOf(sigAsHtml) >= 0, previewText);
}

// 6. Exactly ONE signature injection site, and no template carries a sign-off.
{
  // brandWrap is the only function that appends the agency block into an outgoing body.
  const injectors = (APP.match(/AGENCY_NAME\s*\+\s*"\\n"\s*\+\s*AGENCY_SITE/g) || []);
  ck("renderSignature is the one place the agency block is assembled", injectors.length === 1, "assembly sites=" + injectors.length);
  // No email template body embeds a hand-typed sign-off (name + site) that would be a second closing.
  const tplBlock = slice(APP, "const ETPL_MONTHLY =", "const ETPL_SEED");
  ck("no ETPL_* template body embeds thriveiii.com as a sign-off", tplBlock.indexOf("thriveiii.com") < 0, tplBlock.slice(0, 120));
  ck("no ETPL_* template body embeds the agency name as a sign-off", tplBlock.indexOf(AGENCY) < 0);
  ck("no ETPL_* template body hardcodes a sender name (Abdullah Thyab)", tplBlock.indexOf("Abdullah Thyab") < 0 && tplBlock.indexOf("عبدالله ذياب") < 0);
  // The reply scaffold no longer scaffolds a "Best, Thrive Digital Solutions" closing. Strip comments first:
  // the code comment quotes the forbidden phrase precisely to forbid it, so only the executable code counts.
  const replyBlock = slice(APP, "function replyGreeting(", "\n}").replace(/\/\/[^\n]*/g, "");
  ck("the reply scaffold appends no sign-off (the signature is appended once by compile)", replyBlock.indexOf("Best,") < 0 && replyBlock.indexOf(AGENCY) < 0, replyBlock);
  // brandWrap has no invented name/site fallback closing any more.
  ck("brandWrap has no invented fallback closing (a body with no signature has no closing)", brandWrap.indexOf(AGENCY) < 0 && brandWrap.indexOf(SITE) < 0);
}

// 7. A body with no signature has NO fabricated closing (the old fallback source is gone).
{
  const html = A.brandWrap("<p>Body only.</p>", false, "");
  ck("no signature -> no agency block is fabricated", html.indexOf(AGENCY) < 0 && html.indexOf(SITE) < 0);
}

console.log("\n" + (fails ? ("FAILED: " + fails + " check(s)") : "ALL SIGNATURE-SYSTEM CHECKS PASS"));
process.exit(fails ? 1 : 0);
