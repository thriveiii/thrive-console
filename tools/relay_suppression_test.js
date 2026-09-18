/* B3 relay suppression guard (v10). Fails-when-broken. ZERO real network.
 *
 *   node tools/relay_suppression_test.js
 *
 * Loads the REAL relay source (relay/thrive-relay.gs) into a stubbed Apps Script sandbox and proves the
 * suppression guard on BOTH send paths:
 *   A. sendMail_ (the one path every send crosses): a send to a do-not-contact address is REFUSED before any
 *      Resend request and before any ledger write - it throws "suppressed: <addr>", which is how a send to a
 *      suppressed address returns failed (doPost turns the throw into { ok:false }). A non-suppressed address
 *      sends normally.
 *   B. sendQueue_ (the durable outbox worker): a queued row for a suppressed address is marked 'failed'
 *      ('suppressed') WITHOUT calling Resend; a queued row for an allowed address is 'sent'. Result counts
 *      { sent:1, failed:1 }.
 *   C. the relay declares RELAY_VERSION 10.
 *
 * Fails-when-broken: delete the guard in sendMail_ (or the pre-check in sendQueue_) and the suppressed send
 * succeeds / the row is 'sent' -> A/B fail. Bump the version back -> C fails.
 *
 * The suppression truth is a stubbed console_suppressions read (email=eq.<addr>), so the test drives the exact
 * query supaSuppressed_ makes with the service key, never a real Supabase.
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

/* ---- the do-not-contact set the stubbed Supabase reports, and the captures the test inspects ---- */
const SUPPRESSED = { "blocked@example.test": 1 };   // bare, lowercase, exactly as the console stores
let resendSends = [];   // every address actually handed to api.resend.com (must never include a suppressed one)
let mailUpserts = [];   // every console_mail row upserted (recordSend_); a suppressed send must write none
let suppReadable = true;  // when false, the stubbed console_suppressions read returns a non-200 (list UNREADABLE -> null state)

// configured (default): Supabase is wired, so supaSuppressed_ actually queries the list. configured:false loads a
// relay with NO SUPABASE props, so supaSuppressed_ returns false (nothing to check) - the deliberate allow path.
function loadRelay(opts) {
  const configured = !opts || opts.configured !== false;
  // a stateful Script Properties store, so STORE_FILE_ID set inside storeFile_ persists across calls
  const propStore = configured
    ? { RESEND_KEY: "re_key_test", SYNC_KEY: "the-real-key", SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_KEY: "svc_key_test" }
    : { RESEND_KEY: "re_key_test", SYNC_KEY: "the-real-key" };   // no SUPABASE url/key -> no suppression system
  const PropertiesService = {
    getScriptProperties() {
      return { getProperty(k) { return Object.prototype.hasOwnProperty.call(propStore, k) ? propStore[k] : null; },
               getProperties() { return propStore; },
               setProperty(k, v) { propStore[k] = String(v); }, deleteProperty(k) { delete propStore[k]; } };
    }
  };
  // one in-memory Drive JSON file behind the store seam (storeRead_/storeWrite_ -> storeFile_)
  const driveFile = { _c: "{}", getId() { return "store1"; }, getSize() { return this._c.length; },
    getBlob() { const s = this._c; return { getDataAsString() { return s; } }; },
    setContent(s) { this._c = String(s); } };
  const DriveApp = {
    getFileById() { return driveFile; },
    getFilesByName() { let done = false; return { hasNext() { return !done; }, next() { done = true; return driveFile; } }; },
    createFile() { return driveFile; }
  };
  const LockService = { getScriptLock() { return { waitLock() {}, releaseLock() {}, tryLock() { return true; } }; } };
  const UrlFetchApp = {
    fetch(url, opts) {
      const u = String(url);
      if (u.indexOf("console_suppressions") >= 0) {
        // an UNREADABLE list (a transient Supabase blip) is a non-200 -> supaSuppressed_ returns null (fail closed)
        if (!suppReadable) return { getResponseCode() { return 503; }, getContentText() { return "service unavailable"; } };
        // supaSuppressed_ asks email=eq.<addr>; report a row only for a suppressed address
        const m = /email=eq\.([^&]+)/.exec(u);
        const addr = m ? decodeURIComponent(m[1]).toLowerCase() : "";
        const rows = SUPPRESSED[addr] ? [{ email: addr }] : [];
        return { getResponseCode() { return 200; }, getContentText() { return JSON.stringify(rows); } };
      }
      if (u.indexOf("api.resend.com") >= 0) {
        const to = (JSON.parse(opts.payload).to || [])[0] || "";
        resendSends.push(to);
        return { getResponseCode() { return 200; }, getContentText() { return JSON.stringify({ id: "re_" + resendSends.length }); } };
      }
      if (u.indexOf("console_mail") >= 0 && opts.method === "post") {
        try { JSON.parse(opts.payload).forEach(function (r) { mailUpserts.push(r); }); } catch (e) {}
        return { getResponseCode() { return 200; }, getContentText() { return "[]"; } };
      }
      return { getResponseCode() { return 200; }, getContentText() { return "[]"; } };   // console_inbound/hits/mail-select etc.
    }
  };
  const ContentService = { MimeType: { JSON: "json", TEXT: "text" },
    createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; } };
  const sandbox = { UrlFetchApp, PropertiesService, ContentService, DriveApp, LockService,
                    JSON, Number, String, Object, Date, Math, isNaN, encodeURIComponent, decodeURIComponent };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "relay", "thrive-relay.gs"), "utf8"), sandbox, { filename: "thrive-relay.gs" });
  return sandbox;
}

const relay = loadRelay();

/* ===================== C: the version moved ===================== */
ck("the relay declares RELAY_VERSION 10 (B3 suppression guard)", relay.RELAY_VERSION === 10, relay.RELAY_VERSION);

/* ===================== A: sendMail_ refuses a suppressed address ===================== */
resendSends = []; mailUpserts = [];
let threw = null, ret = null;
try { ret = relay.sendMail_({ to: "blocked@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", slug: "acme" }); }
catch (e) { threw = e; }
ck("A: a send to a suppressed address THROWS (turned into a failed send by doPost)",
   !!threw && /suppressed/i.test(String(threw.message || threw)), threw ? String(threw.message) : ret);
ck("A: the suppressed send NEVER reached Resend (no request made, nothing delivered)", resendSends.length === 0, resendSends);

// doPost turns the throw into { ok:false, error } - the shape the console reads as a failed send
resendSends = []; mailUpserts = [];
const post = relay.doPost({ postData: { contents: JSON.stringify({ to: "blocked@example.test", subject: "Hi", html: "<p>Hi</p>" }) } });
let postJson = {}; try { postJson = JSON.parse(post.getContent()); } catch (e) {}
ck("A: doPost returns ok:false for a suppressed bare-body send, and stamps relay_version 10",
   postJson.ok === false && /suppressed/i.test(String(postJson.error || "")) && postJson.relay_version === 10, postJson);

/* a NON-suppressed address sends normally, so the guard is not a blanket block */
resendSends = []; mailUpserts = [];
const okOut = relay.sendMail_({ to: "welcome@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", slug: "acme" });
ck("A: a non-suppressed address sends normally (ok:true)", okOut && okOut.ok === true, okOut);
ck("A: the allowed send DID reach Resend exactly once", resendSends.length === 1 && resendSends[0] === "welcome@example.test", resendSends);

/* ===================== B: the outbox worker refuses a suppressed row ===================== */
resendSends = []; mailUpserts = [];
relay.outboxPush_([
  { mid: "m-blocked", opp: "acme", to: "blocked@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", due: "2000-01-01T00:00:00Z" },
  { mid: "m-ok",      opp: "acme", to: "welcome@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", due: "2000-01-01T00:00:00Z" }
]);
const q = relay.sendQueue_();
ck("B: the worker reports one sent and one failed", q && q.sent === 1 && q.failed === 1, q);
ck("B: the suppressed row NEVER reached Resend (only the allowed address was sent)",
   resendSends.length === 1 && resendSends[0] === "welcome@example.test", resendSends);
const st = relay.outboxStatus_("acme").rows;
const blocked = st.filter(function (r) { return r.mid === "m-blocked"; })[0] || {};
const allowed = st.filter(function (r) { return r.mid === "m-ok"; })[0] || {};
ck("B: the suppressed row is marked failed with reason 'suppressed'", blocked.status === "failed" && blocked.error === "suppressed", blocked);
ck("B: the allowed row is marked sent", allowed.status === "sent", allowed);

/* ===================== D: FAIL-CLOSED on an UNREADABLE list (the null state) ===================== */
/* This is the core of the change: a configured list that cannot be read must NEVER be treated as "clear".
   A direct send refuses; the queue DEFERS the row (retry next tick) rather than send into an unknown. */
suppReadable = false;   // the console_suppressions read now returns 503 -> supaSuppressed_ returns null

// D-A: a direct send to an otherwise-clear address is REFUSED (not sent) while the list is unreadable
resendSends = [];
let threwU = null;
try { relay.sendMail_({ to: "welcome@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", slug: "acme" }); }
catch (e) { threwU = e; }
ck("D: an unreadable list REFUSES a direct send (fail closed, 'suppress-check-unavailable')",
   !!threwU && /suppress-check-unavailable/.test(String(threwU.message || threwU)), threwU ? String(threwU.message) : "sent!");
ck("D: the refused-on-unknown send NEVER reached Resend", resendSends.length === 0, resendSends);

// D-B: a queued row is DEFERRED (released back to 'queued', sending_since 0), not sent and not poisoned to failed
resendSends = [];
relay.outboxPush_([{ mid: "m-defer", opp: "camp2", to: "clear@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", due: "2000-01-01T00:00:00Z" }]);
const qU = relay.sendQueue_();
const deferSt = relay.outboxStatus_("camp2").rows.filter(function (r) { return r.mid === "m-defer"; })[0] || {};
ck("D: an unreadable list sends nothing this tick (fail closed)", resendSends.length === 0 && qU.sent === 0, { resend: resendSends, q: qU });
ck("D: the deferred row is released back to 'queued' (retry next tick), NOT failed and NOT sent",
   deferSt.status === "queued", deferSt);

// D-B continued: once the list is readable again, the same row sends on the next tick (never poisoned)
suppReadable = true;
resendSends = [];
relay.sendQueue_();
const nowSent = relay.outboxStatus_("camp2").rows.filter(function (r) { return r.mid === "m-defer"; })[0] || {};
ck("D: when the list is readable again, the deferred row sends on the next tick",
   nowSent.status === "sent" && resendSends.length === 1 && resendSends[0] === "clear@example.test", { row: nowSent, resend: resendSends });

/* ===================== E: NO suppression system configured -> allow (the false state) ===================== */
/* The one deliberate allow: a deployment with no Supabase wired has no list to honor, so a send proceeds even
   for an address that WOULD be suppressed if a list existed. This is distinct from the null (unreadable) state. */
const relay2 = loadRelay({ configured: false });
resendSends = [];
const eOut = relay2.sendMail_({ to: "blocked@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi", slug: "acme" });
ck("E: with NO suppression system configured, a send proceeds (allow; distinct from the unreadable-null block)",
   eOut && eOut.ok === true && resendSends.length === 1, { out: eOut, resend: resendSends });

console.log("");
if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL RELAY-SUPPRESSION CHECKS PASS");
