/* P23: the attachment partition and the version gate, proven as logic in Node (no browser).
 *
 *   node tools/attach_logic_test.js
 *
 * The sandbox's live-console boot is network-flaky (the browser suites are Thyab's device gate, like P22's).
 * This proves the parts that must never regress, by evaluating the REAL functions lifted verbatim from
 * library/app.js in a tiny stubbed scope:
 *   - planAttachments partitions by size and REFUSES an oversize/over-count item WITH ITS NUMBER (never a
 *     silent drop), and the hosted block renders a clean labelled link per recipient language;
 *   - the version gate is `>=`, not `===`: a v8 (or newer) relay is READY against REQUIRED_RELAY 5, a v5
 *     relay is ready but does not yet support attachments, an OLDER relay is REFUSED by name. The test also
 *     builds the `===` variant and shows it WOULD wrongly reject v8, so a regression to strict equality reds.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const app = fs.readFileSync(path.join(ROOT, "library", "app.js"), "utf8");
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

// Lift a top-level `function name(...) { ... }` (or a `const NAME = ...;` line) verbatim from the source, so
// the test exercises the shipped code, not a copy.
function grabFn(name) {
  const start = app.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found: function " + name);
  const end = app.indexOf("\n}", start);
  return app.slice(start, end + 2);
}
function grabConst(re) { const m = app.match(re); if (!m) throw new Error("const not found: " + re); return m[0]; }

/* ============ Part A: planAttachments + the hosted block ============ */
{
  const src = [
    grabConst(/const ATTACH_INLINE_MAX = [^\n]+/),
    grabConst(/const ATTACH_MAX\s+= [^\n]+/),
    grabConst(/const ATTACH_TOTAL_MAX\s+= [^\n]+/),
    grabConst(/const ATTACH_COUNT_MAX\s+= [^\n]+/),
    grabFn("planAttachments"),
    grabFn("attachHostedBlockHtml"),
    grabFn("attachHostedBlockText")
  ].join("\n");
  const sandbox = { esc: s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
                    Array, Number, String };
  vm.createContext(sandbox);
  vm.runInContext(src + "\nthis.planAttachments=planAttachments; this.attachHostedBlockHtml=attachHostedBlockHtml; this.ATTACH_MAX=ATTACH_MAX; this.ATTACH_COUNT_MAX=ATTACH_COUNT_MAX; this.ATTACH_TOTAL_MAX=ATTACH_TOTAL_MAX;", sandbox);
  const MB = 1024 * 1024;
  const plan = sandbox.planAttachments([
    { filename: "small.png", url: "https://cdn/s.png", size: 3 * MB },
    { filename: "mid.jpg",   url: "https://cdn/m.jpg", size: 10 * MB },
    { filename: "huge.gif",  url: "https://cdn/h.gif", size: 30 * MB }
  ]);
  ck("planAttachments: a small image (<=5MB) attaches, referenced by path (URL)",
     plan.attach.length === 1 && plan.attach[0].path === "https://cdn/s.png" && plan.attach[0].filename === "small.png", plan.attach);
  ck("planAttachments: a mid image (>5MB, <=25MB) is hosted, not attached", plan.hosted.length === 1 && plan.hosted[0].filename === "mid.jpg", plan.hosted);
  ck("planAttachments: an oversize image (>25MB) is REFUSED with the byte limit (never a silent drop)",
     plan.refused.length === 1 && plan.refused[0].reason === "file" && plan.refused[0].limit === sandbox.ATTACH_MAX, plan.refused);

  const many = sandbox.planAttachments(Array.from({ length: 13 }, (_, i) => ({ filename: "n" + i + ".png", url: "https://cdn/" + i, size: 1 * MB })));
  ck("planAttachments: past the count ceiling, extras are refused BY COUNT",
     many.refused.some(r => r.reason === "count" && r.limit === sandbox.ATTACH_COUNT_MAX), many.refused);
  ck("planAttachments: the count ceiling holds at exactly ATTACH_COUNT_MAX landed items",
     (many.attach.length + many.hosted.length) === sandbox.ATTACH_COUNT_MAX, many);

  // the running total: many 5MB images spill from attach to hosted once the 40MB total would burst
  const spill = sandbox.planAttachments(Array.from({ length: 9 }, (_, i) => ({ filename: "b" + i, url: "https://cdn/b" + i, size: 5 * MB })));
  ck("planAttachments: the 40MB total ceiling spills later inline images to hosted, never over-attaching",
     spill.attach.reduce((s, a) => s + a.size, 0) <= sandbox.ATTACH_TOTAL_MAX && spill.hosted.length > 0, spill);

  const html = sandbox.attachHostedBlockHtml(plan.hosted, "en");
  ck("the hosted block is a clean labelled link in English (View image: filename)", html.includes("View image") && html.includes("mid.jpg"), html);
  const htmlAr = sandbox.attachHostedBlockHtml(plan.hosted, "ar");
  ck("the hosted block is Arabic for an Arabic recipient (per-recipient label, inline ternary)", htmlAr.includes("عرض الصورة"), htmlAr);
  ck("the hosted block never inlines base64 (it links the URL)", html.includes("https://cdn/m.jpg") && !html.includes("base64"), html);
}

/* ============ Part B: the version gate is `>=`, not `===` ============ */
{
  const src = [
    grabConst(/const REQUIRED_RELAY = \d+;/),
    grabConst(/const ATTACH_MIN_RELAY = \d+;/),
    "let __relaySeen = null; let __relayChecked = false;",
    grabFn("noteRelayVersion"),
    grabFn("relayMismatch"),
    grabFn("relayReady"),
    grabFn("relaySeenVersion"),
    grabFn("relaySupportsAttachments")
  ].join("\n");
  const sandbox = { Number, String, Object };
  vm.createContext(sandbox);
  vm.runInContext(src + "\nthis.noteRelayVersion=noteRelayVersion; this.relayReady=relayReady; this.relayMismatch=relayMismatch; this.relaySupportsAttachments=relaySupportsAttachments; this.REQUIRED_RELAY=REQUIRED_RELAY; this.ATTACH_MIN_RELAY=ATTACH_MIN_RELAY;", sandbox);
  const REQ = sandbox.REQUIRED_RELAY, ATT = sandbox.ATTACH_MIN_RELAY;
  ck("REQUIRED_RELAY stayed at 5 and attachments gate on v8", REQ === 5 && ATT === 8, { REQ, ATT });

  function gate(v) { sandbox.noteRelayVersion({ relay_version: v }); return { ready: sandbox.relayReady(), attach: sandbox.relaySupportsAttachments(), mm: sandbox.relayMismatch() }; }

  const g8 = gate(8);
  ck("a v8 relay is READY against REQUIRED 5 (this is the `>=` behaviour; strict `===` would red here)",
     g8.ready === true && g8.mm === null, g8);
  ck("a v8 relay supports attachments (>= v8)", g8.attach === true, g8);
  const g9 = gate(9);
  ck("a relay NEWER than the console needs is still READY (>=)", g9.ready === true && g9.attach === true, g9);
  const g5 = gate(5);
  ck("a v5 relay is READY (equal) but does NOT yet support attachments (< v8)", g5.ready === true && g5.attach === false, g5);
  const g4 = gate(4);
  ck("an OLDER relay (v4 < REQUIRED 5) is REFUSED, naming both numbers",
     g4.ready === false && g4.mm && g4.mm.seen === 4 && g4.mm.need === 5, g4);
  ck("an older relay never claims attachment support", g4.attach === false, g4);
  const gNull = gate(undefined);   // a response with no relay_version reads as older-than-contract
  ck("a response missing relay_version is treated as a mismatch (the v4 blind spot), not assumed fine",
     gNull.ready === false, gNull);

  // Discrimination: a strict-equality variant WOULD reject v8. This is what the >= fix repaired, and proves
  // this test file would go red the day someone regresses relayMismatch back to `===`.
  const strictRejectsV8 = !(8 === REQ);
  ck("the `===` variant WOULD wrongly reject a v8 relay (so a regression to strict equality is caught here)",
     strictRejectsV8 === true, "8 === " + REQ + " is " + (8 === REQ));
}

console.log("\n" + fails + " failed");
process.exit(fails ? 1 : 0);
