/* P23: the relay carries attachments, verbatim, and adds nothing.
 *
 *   node tools/relay_attach_test.js
 *
 * Part A loads the REAL relay source into a stubbed Apps Script sandbox and calls sendMail_ with an
 * attachments array, capturing the exact payload handed to Resend. It proves the courier forwards the
 * { filename, path } items untouched, that a text-only send carries none (unchanged), and that the version
 * moved to v8. Part B is a static read of the queue path (outboxPush_ / sendQueue_) carrying attachments.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 300)); }
}

/* ===================== Part A: sendMail_ in a stubbed GAS sandbox ===================== */

let captured = null;   // the request object handed to UrlFetchApp.fetch, captured for inspection
function loadRelay() {
  const UrlFetchApp = {
    fetch(url, opts) {
      captured = { url: url, opts: opts, payload: JSON.parse(opts.payload) };
      return { getContentText() { return JSON.stringify({ id: "re_test_1" }); }, getResponseCode() { return 200; } };
    }
  };
  const PropertiesService = {
    getScriptProperties() {
      return { getProperty(k) { return k === "RESEND_KEY" ? "re_key_test" : (k === "SYNC_KEY" ? "the-real-key" : null); },
               getProperties() { return {}; }, setProperty() {}, deleteProperty() {} };
    }
  };
  const ContentService = {
    MimeType: { JSON: "json", TEXT: "text" },
    createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; }
  };
  const sandbox = { UrlFetchApp, PropertiesService, ContentService, JSON, Number, String, Object, Date, Math, isNaN };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "relay", "thrive-relay.gs"), "utf8"), sandbox, { filename: "thrive-relay.gs" });
  return sandbox;
}

const relay = loadRelay();

ck("the relay declares RELAY_VERSION 8 (attachments)", relay.RELAY_VERSION === 8, relay.RELAY_VERSION);

// A send WITH attachments: each { filename, path } must reach Resend verbatim, nothing added, nothing lost.
const atts = [
  { filename: "poster.png", path: "https://proj.supabase.co/storage/v1/object/public/console-attachments/thrive/a1-poster.png", contentType: "image/png", size: 1234 },
  { filename: "menu.jpg",   path: "https://proj.supabase.co/storage/v1/object/public/console-attachments/thrive/a2-menu.jpg",   contentType: "image/jpeg", size: 4321 }
];
captured = null;
const out = relay.sendMail_({ to: "basel@shop.example", subject: "Hello", html: "<p>Hi</p>", text: "Hi", slug: "thrive", attachments: atts });
ck("the send succeeded", out && out.ok === true, out);
ck("Resend received an attachments array of the same length",
   captured && Array.isArray(captured.payload.attachments) && captured.payload.attachments.length === 2, captured && captured.payload.attachments);
ck("each attachment is forwarded verbatim (filename + path)",
   captured && captured.payload.attachments[0].filename === "poster.png"
   && captured.payload.attachments[0].path === atts[0].path
   && captured.payload.attachments[1].path === atts[1].path, captured && captured.payload.attachments);
// The courier adds nothing: no base64 content field is invented, only the URL path the console sent.
ck("the relay never inlines base64 (no `content` field it did not receive)",
   captured && captured.payload.attachments.every(a => a.content === undefined), captured && captured.payload.attachments);

// A text-only send is unchanged: no attachments key at all, exactly as before P23.
captured = null;
relay.sendMail_({ to: "x@y.example", subject: "s", html: "<p>h</p>", text: "h", slug: "thrive" });
ck("a text-only send carries no attachments key (unchanged)", captured && captured.payload.attachments === undefined, captured && Object.keys(captured.payload));

/* ===================== Part B: the queue path carries attachments (static) ===================== */

const gs = fs.readFileSync(path.join(ROOT, "relay", "thrive-relay.gs"), "utf8");
ck("outboxPush_ carries attachments onto each queued row", /outboxPush_[\s\S]{0,900}attachments:/.test(gs), "");
ck("sendQueue_ hands row.attachments to sendMail_", /attachments:\s*row\.attachments/.test(gs), "");
ck("sendMail_ forwards d.attachments to the Resend payload", /d\.attachments[\s\S]{0,80}payload\.attachments\s*=\s*d\.attachments/.test(gs), "");

console.log("\n" + fails + " failed");
process.exit(fails ? 1 : 0);
