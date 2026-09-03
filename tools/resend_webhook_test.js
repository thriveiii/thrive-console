// resend-webhook gate: fails-when-broken proof of the Resend bounce webhook (defect B-2). It loads the REAL
// relay functions resendWebhook_, supaSelectMailById_ and supaInsert_ from relay/thrive-relay.gs into a
// sandbox that stubs ONLY the Apps Script boundary (props_ and UrlFetchApp), so the real classification,
// opp-resolution, row shape, idempotent id, secret gate, and never-throw contract all run for real.
//
// Pure Node. Run: node tools/resend_webhook_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const relay = fs.readFileSync(path.join(ROOT, "relay/thrive-relay.gs"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 220)); }
}
function fnSrc(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return "";
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(at, i);
}

// ---- the sandbox boundary: props_ (Script Properties) and UrlFetchApp (network) ----
const SECRET = "sekret-xyz";
let PROPS = { RESEND_WEBHOOK_SECRET: SECRET, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc" };
let MAIL = {};              // id -> { opp, to_addr } (a bare opp string is accepted and normalized), the console_mail read fixture
let WRITES = [];            // captured console_inbound upserts
let FORCE_READ_STATUS = 200, FORCE_READ_THROW = false, FORCE_WRITE_THROW = false;

function makeEnv() {
  const props_ = function () { return { getProperty: function (k) { return PROPS[k]; } }; };
  const UrlFetchApp = {
    fetch: function (url, opts) {
      const method = (opts && opts.method) || "get";
      if (method === "get") {
        if (FORCE_READ_THROW) throw new Error("network");
        // parse ?id=eq.<id>&select=opp,to_addr
        const m = /id=eq\.([^&]+)/.exec(url);
        const id = m ? decodeURIComponent(m[1]) : "";
        const rec = MAIL[id];
        const mrow = (rec == null) ? null : (typeof rec === "string" ? { opp: rec, to_addr: "" } : rec);
        const body = mrow ? JSON.stringify([mrow]) : "[]";
        return { getResponseCode: function () { return FORCE_READ_STATUS; }, getContentText: function () { return body; } };
      }
      // post -> console_inbound upsert
      if (FORCE_WRITE_THROW) throw new Error("network");
      WRITES.push({ url: url, rows: JSON.parse(opts.payload) });
      return { getResponseCode: function () { return 200; }, getContentText: function () { return ""; } };
    }
  };
  const src = fnSrc(relay, "function supaInsert_(") + "\n" +
              fnSrc(relay, "function supaSelectMailById_(") + "\n" +
              fnSrc(relay, "function resendWebhook_(") + "\n" +
              "return { resendWebhook_: resendWebhook_, supaSelectMailById_: supaSelectMailById_ };";
  return new Function("props_", "UrlFetchApp", src)(props_, UrlFetchApp);
}
const ENV = makeEnv();
function reset() { MAIL = {}; WRITES = []; FORCE_READ_STATUS = 200; FORCE_READ_THROW = false; FORCE_WRITE_THROW = false; }
function call(paramWhkey, event) { return ENV.resendWebhook_({ parameter: { op: "resend_webhook", whkey: paramWhkey } }, event); }

// ---- source guards (routing + placement) ----
ck("doPost selects op from d.op OR e.parameter.op (webhook routes by ?op=)",
   /var op = d\.op \|\| \(e && e\.parameter && e\.parameter\.op\) \|\| '';/.test(relay));
const dp = fnSrc(relay, "function doPost(");
ck("the resend_webhook branch is placed BEFORE authOk_ (a URL-is-capability op)",
   dp.indexOf("op === 'resend_webhook'") >= 0 && dp.indexOf("op === 'resend_webhook'") < dp.indexOf("authOk_(d.auth)"));
ck("resendWebhook_ writes only through the existing supaInsert_ (no new write path)",
   /supaInsert_\('console_inbound', \[row\]\)/.test(fnSrc(relay, "function resendWebhook_(")));
ck("the read helper is a GET selecting opp AND to_addr, limit 1, url-encoded id (one read, no second query)",
   /console_mail\?id=eq\.'\s*\+\s*encodeURIComponent\(id\)\s*\+\s*'&select=opp,to_addr&limit=1'/.test(fnSrc(relay, "function supaSelectMailById_(")) &&
   /method: 'get'/.test(fnSrc(relay, "function supaSelectMailById_(")));
ck("resendWebhook_ resolves the mail row ONCE and reads to_addr from it (no second query)",
   /supaSelectMailById_\(emailId\)/.test(fnSrc(relay, "function resendWebhook_(")) &&
   (fnSrc(relay, "function resendWebhook_(").match(/supaSelectMailById_\(/g) || []).length === 1 &&
   /to_addr: toAddr/.test(fnSrc(relay, "function resendWebhook_(")));

// ---- 1. secret gate ----
reset();
let r = call("wrong", { type: "email.bounced", data: { email_id: "snd_1" } });
ck("a wrong whkey is a benign 200 that writes NOTHING", r && r.ok === true && WRITES.length === 0, WRITES);
reset(); PROPS = Object.assign({}, PROPS); const savedSecret = PROPS.RESEND_WEBHOOK_SECRET; delete PROPS.RESEND_WEBHOOK_SECRET;
r = call("anything", { type: "email.bounced", data: { email_id: "snd_1" } });
ck("an ABSENT secret is a benign 200 that writes NOTHING (no default-open)", r && r.ok === true && WRITES.length === 0, WRITES);
PROPS.RESEND_WEBHOOK_SECRET = savedSecret;

// ---- 2. only bounce/complaint types ----
reset(); MAIL["snd_1"] = "acme";
r = call(SECRET, { type: "email.delivered", data: { email_id: "snd_1" } });
ck("email.delivered is a 200 no-op (only bounce/complaint are handled)", r.ok === true && WRITES.length === 0, WRITES);

// ---- 3. classification ----
reset(); MAIL["snd_1"] = "acme";
call(SECRET, { type: "email.bounced", created_at: "2026-09-03T00:00:00Z", data: { email_id: "snd_1", bounce: { type: "Permanent" } } });
ck("email.bounced Permanent -> bounce 'hard'", WRITES.length === 1 && WRITES[0].rows[0].bounce === "hard", WRITES[0]);
reset(); MAIL["snd_1"] = "acme";
call(SECRET, { type: "email.bounced", data: { email_id: "snd_1", bounce: { type: "Transient" } } });
ck("email.bounced Transient -> bounce 'soft'", WRITES[0].rows[0].bounce === "soft", WRITES[0]);
reset(); MAIL["snd_1"] = "acme";
call(SECRET, { type: "email.bounced", data: { email_id: "snd_1", bounce: { type: "Undetermined" } } });
ck("email.bounced unknown -> bounce 'hard' (surface, never hide)", WRITES[0].rows[0].bounce === "hard", WRITES[0]);
reset(); MAIL["snd_1"] = "acme";
call(SECRET, { type: "email.complained", data: { email_id: "snd_1" } });
ck("email.complained -> bounce 'hard' (a complaint must stop outreach)", WRITES[0].rows[0].bounce === "hard", WRITES[0]);

// ---- 4. row shape + opp resolution + idempotent id ----
reset(); MAIL["snd_9"] = { opp: "underdog-coffee-bread", to_addr: "underdogcoffeeandbread.shop@gmail.com" };
call(SECRET, { type: "email.bounced", created_at: "2026-09-03T01:02:03Z", data: { email_id: "snd_9", bounce: { type: "Permanent" } } });
const row = WRITES[0].rows[0];
ck("the row is console_inbound at kind='auto' (the view's bounce channel)", row.kind === "auto", row);
ck("the opp is resolved from console_mail by the Resend email id", row.opp === "underdog-coffee-bread", row);
ck("B-3.1: the row carries to_addr, resolved from the SAME console_mail row (the recipient this bounce belongs to)",
   row.to_addr === "underdogcoffeeandbread.shop@gmail.com", row);
ck("the id is deterministic: rb_<email_id>_<type> (idempotent on redelivery)", row.id === "rb_snd_9_email.bounced", row.id);
ck("the row carries a bounce + ts + up, and keeps the RAW event and type in data",
   row.bounce === "hard" && row.ts === "2026-09-03T01:02:03Z" && typeof row.up === "number" &&
   row.data && row.data.type === "email.bounced" && row.data.event && row.data.source === "resend_webhook", row);
ck("the write targets console_inbound", /\/rest\/v1\/console_inbound$/.test(WRITES[0].url), WRITES[0].url);

// ---- 5. unresolved opp: still writes a lossless null-opp row ----
reset(); // MAIL empty -> read returns []
call(SECRET, { type: "email.bounced", data: { email_id: "snd_unknown", bounce: { type: "Permanent" } } });
ck("an unresolvable opp still writes a row, with opp='' AND to_addr='' (lossless, never invented)",
   WRITES.length === 1 && WRITES[0].rows[0].opp === "" && WRITES[0].rows[0].to_addr === "" && WRITES[0].rows[0].bounce === "hard", WRITES[0]);

// a console_mail row with a null to_addr: opp resolves, to_addr stays '' (never invented)
reset(); MAIL["snd_2"] = { opp: "acme", to_addr: null };
call(SECRET, { type: "email.bounced", data: { email_id: "snd_2", bounce: { type: "Permanent" } } });
ck("a resolved opp with a null to_addr writes opp set and to_addr='' (never invented)",
   WRITES[0].rows[0].opp === "acme" && WRITES[0].rows[0].to_addr === "", WRITES[0]);

// ---- 6. never throws (a read or write failure is a silent 200) ----
reset(); MAIL["snd_1"] = "acme"; FORCE_READ_THROW = true;
r = call(SECRET, { type: "email.bounced", data: { email_id: "snd_1", bounce: { type: "Permanent" } } });
ck("a read failure never throws: 200, opp='' and to_addr='' (null read), row still written",
   r.ok === true && WRITES.length === 1 && WRITES[0].rows[0].opp === "" && WRITES[0].rows[0].to_addr === "", WRITES);
reset(); MAIL["snd_1"] = "acme"; FORCE_WRITE_THROW = true;
r = call(SECRET, { type: "email.bounced", data: { email_id: "snd_1", bounce: { type: "Permanent" } } });
ck("a write failure never throws out of the webhook: still returns 200", r && r.ok === true, r);

// ---- 7. the read helper on a non-200 returns null (no throw) ----
reset(); MAIL["snd_1"] = "acme"; FORCE_READ_STATUS = 500;
ck("supaSelectMailById_ returns null on a non-200 read", ENV.supaSelectMailById_("snd_1") === null);
reset(); MAIL["snd_1"] = { opp: "acme", to_addr: "a@acme.com" };
const got = ENV.supaSelectMailById_("snd_1");
ck("supaSelectMailById_ returns the {opp, to_addr} row on a 200 read",
   got && got.opp === "acme" && got.to_addr === "a@acme.com", got);

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
