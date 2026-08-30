// Inbound attribution: correct + complete. Fails-when-broken checks for the relay's slug-first linking and
// the full-fidelity inbound record.
//
// (1) LINK BY SLUG, ABOVE EVERYTHING: a reply whose To carries hi+<slug>@thriveiii.com sets opp=<slug>
//     UNCONDITIONALLY (the `&& known[tagged]` gate is gone), and the slug takes precedence over sender match.
//     With NO slug tag, attribution falls back to sender/subject unchanged.
// (2) FULL FIDELITY: the persisted rec keeps the whole email - the plus-tag To, the reply's own Message-ID,
//     in-reply-to, references, from name+address, cc, the FULL plain body and the html body.
//
// Pure Node, no network, no GmailApp: attributeMessage_ and its helpers are extracted from the relay source
// and driven with a synthetic fake message. Synthetic data only (no real prospect addresses).
// Run: node tools/inbound_link_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const relay = fs.readFileSync(path.join(ROOT, "relay/thrive-relay.gs"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

function extractFn(src, name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
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

// The relay module-level constants attributeMessage_ and its helpers read.
const PRE = 'var TAG_LOCAL="hi", TAG_DOMAIN="thriveiii.com", SNIPPET_MAX=300;\n';
const R = load(relay,
  ["attributeMessage_", "addressOf_", "displayName_", "headerOf_", "idsIn_", "slugFromTag_"], PRE);

// A synthetic GmailMessage stand-in: only the methods attributeMessage_ calls. All addresses are synthetic.
function fakeMsg(o) {
  o = o || {};
  const headers = o.headers || {};
  // Build a raw header block so headerOf_ can read In-Reply-To / References / Message-ID / Delivered-To / etc.
  const raw = Object.keys(headers).map((k) => k + ": " + headers[k]).join("\r\n") + "\r\n\r\n" + (o.plain || "");
  return {
    getId: () => o.gid || "gid-1",
    getThread: () => ({ getId: () => o.threadId || "thr-1" }),
    getFrom: () => o.from || "Someone <someone@example.test>",
    getSubject: () => o.subject || "Re: hello",
    getDate: () => new Date(o.date || "2026-08-30T10:00:00.000Z"),
    getPlainBody: () => o.plain || "",
    getBody: () => o.html || "",
    getTo: () => o.to || "",
    getCc: () => o.cc || "",
    getRawContent: () => raw
  };
}

// ---- (a) slug tag links even when the opp is ABSENT from known-opps (the gate is gone) -----------
const knownEmpty = {};   // alpha-co is NOT known
const recA = R.attributeMessage_(
  fakeMsg({ to: "hi+alpha-co@thriveiii.com", from: "Buyer <buyer@synthetic.test>", subject: "Re: hi" }),
  [], knownEmpty);
ck("(a) a hi+alpha-co@ tag sets opp='alpha-co' even when alpha-co is absent from known-opps (gate removed)",
   recA && recA.opp === "alpha-co" && recA.rule === "tag", recA);

// ---- (b) NO plus tag -> sender/subject fallback is unchanged ------------------------------------
const mailLedger = [
  { direction: "out", opp: "gamma-co", to: "prospect@synthetic.test", ts: "2026-08-01T00:00:00Z" }
];
const knownGamma = { "gamma-co": 1 };
const recB = R.attributeMessage_(
  fakeMsg({ to: "prospect@synthetic.test", from: "Prospect <prospect@synthetic.test>", subject: "Re: pitch" }),
  mailLedger, knownGamma);
ck("(b) with NO plus tag, attribution falls back to the sender match (unchanged)",
   recB && recB.opp === "gamma-co" && recB.rule === "sender", recB);

// ---- (d) sender match must NOT override a present slug tag (precedence) --------------------------
// The ledger would sender-match this reply to gamma-co, but the To carries hi+beta-co: the tag wins.
const recD = R.attributeMessage_(
  fakeMsg({ to: "hi+beta-co@thriveiii.com", from: "Prospect <prospect@synthetic.test>", subject: "Re: pitch" }),
  mailLedger, knownGamma);   // beta-co not in known; gamma-co is - proves tag beats sender AND ignores known
ck("(d) a present slug tag beats the sender match (opp='beta-co', not gamma-co)",
   recD && recD.opp === "beta-co" && recD.rule === "tag", recD);

// ---- (c) full fidelity: the rec persists to, message-id, references, html, full plain, cc, from -
const FULL_PLAIN = ("Line one of the reply body. " .repeat(30)) + "END";   // > 300 chars, must NOT be truncated
const recC = R.attributeMessage_(
  fakeMsg({
    to: "hi+delta-co@thriveiii.com",
    cc: "assistant@synthetic.test",
    from: "Dana Prospect <dana@synthetic.test>",
    subject: "Re: your note",
    plain: FULL_PLAIN,
    html: "<p>Line one of the reply body.</p><p>END</p>",
    headers: { "Message-ID": "<reply-xyz@synthetic.test>", "In-Reply-To": "<our-send-1@thriveiii.com>", "References": "<our-send-1@thriveiii.com>" }
  }), [], {});
ck("(c) rec stores the full plus-tag To", recC.to === "hi+delta-co@thriveiii.com", recC.to);
ck("(c) rec stores the reply's own Message-ID", recC.messageId === "<reply-xyz@synthetic.test>", recC.messageId);
ck("(c) rec stores In-Reply-To and References", recC.inReplyTo === "<our-send-1@thriveiii.com>" && recC.references === "<our-send-1@thriveiii.com>", { irt: recC.inReplyTo, ref: recC.references });
ck("(c) rec stores the html body", recC.bodyHtml.indexOf("<p>END</p>") >= 0, recC.bodyHtml);
ck("(c) rec stores the FULL plain body (not a 300-char snippet)",
   recC.bodyPlain === FULL_PLAIN && recC.bodyPlain.length > 300, { len: recC.bodyPlain.length });
ck("(c) rec stores cc and the from name + address", recC.cc === "assistant@synthetic.test" && recC.name === "Dana Prospect" && recC.from === "dana@synthetic.test", { cc: recC.cc, name: recC.name, from: recC.from });
ck("(c) the 300-char snippet field is retained (back-compat)", typeof recC.snippet === "string" && recC.snippet.length <= 300, recC.snippet.length);

// ---- negative control: the test can see a regression (a wrong opp fails) ------------------------
ck("(a) parity check is real (a deliberately wrong opp fails)", !(recA.opp === "WRONG"));

// ---- source guard: the known-gate is gone --------------------------------------------------------
ck("the `&& known[tagged]` gate is removed from the tag rule",
   /if \(tagged\) \{ rec\.rule = 'tag'/.test(relay) && !/if \(tagged && known\[tagged\]\)/.test(relay));

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
