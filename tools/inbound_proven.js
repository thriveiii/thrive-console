/* P22, inbound proven: the industry-grade spine, proven by running the REAL relay source in a stubbed
 * Apps Script sandbox (the same technique as tools/version.js) plus the pure client model. No browser, so
 * no console-boot flakiness: this is the reliable half. The live full loop (send to a real external inbox,
 * reply from it) is device-gated and Thyab runs it; this proves the mechanism the loop depends on.
 *
 *   node tools/inbound_proven.js
 *
 * It proves, against library/inbound.js and relay/thrive-relay.gs as they ship:
 *   - a send GUARANTEES a Message-ID header and returns it, so a reply's In-Reply-To can be matched;
 *     a Message-ID the console already supplied is preserved, never overwritten
 *   - attribution joins by plus-address (the tag) and by the References header (the thread)
 *   - the join basis is derived in ONE place with a fixed precedence, deterministic before heuristic,
 *     and a reply matchable by BOTH a deterministic and a heuristic join records the deterministic one
 *   - the inbox sweep is idempotent (replay the same message, one record) and stamps a heartbeat every
 *     run (its time, its interval, whether it hit the read cap)
 *   - reconciliation compares the mailbox against what is filed and reports the gap, and a sweep closes it
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

/* ===================== the client model (pure) ===================== */
const Inbound = require(path.join(ROOT, "library", "inbound.js"));
const st = Inbound.selfTest();
ck("library/inbound.js passes its own attribution + basis self-test", st.pass, st.failures);

// The one derivation, agreeing with the relay's rule vocabulary and the client's tier vocabulary.
ck("joinBasis maps the relay rule 'tag' to plus-address (deterministic)",
   Inbound.joinBasis({ rule: "tag" }).basis === "plus-address" && Inbound.joinBasis({ rule: "tag" }).deterministic === true);
ck("joinBasis maps the relay rule 'thread' to references (deterministic)",
   Inbound.joinBasis({ rule: "thread" }).basis === "references" && Inbound.joinBasis({ rule: "thread" }).deterministic === true);
ck("joinBasis maps the relay rule 'sender' to sender (heuristic)",
   Inbound.joinBasis({ rule: "sender" }).basis === "sender" && Inbound.joinBasis({ rule: "sender" }).deterministic === false);
ck("joinBasis maps the client tier 'subject' to subject-heuristic (heuristic)",
   Inbound.joinBasis({ match_tier: "subject" }).basis === "subject-heuristic" && Inbound.joinBasis({ match_tier: "subject" }).deterministic === false);
// precedence: a reply matchable by BOTH records the deterministic one
ck("a reply matchable by plus-address AND references records plus-address",
   Inbound.joinBasis({ rule: "tag", match_tier: "header" }).basis === "plus-address");
ck("a reply matchable by references AND subject records references (deterministic wins)",
   Inbound.joinBasis({ rule: "thread", match_tier: "subject" }).basis === "references");
ck("a deterministic references beats a heuristic sender on the same row",
   Inbound.joinBasis({ rule: "sender", match_tier: "header" }).basis === "references");

/* ===================== the relay, in a stubbed GAS sandbox ===================== */

function loadRelay() {
  let STORE = {};                       // the Drive JSON, in memory
  let MAILBOX = [];                     // Gmail messages, newest last
  const sentPayloads = [];             // what UrlFetchApp.fetch was handed

  function mkMsg(o) {
    const raw = (o.headers || []).map(h => h[0] + ": " + h[1]).join("\r\n");
    return {
      getId: () => o.gid,
      getThread: () => ({ getId: () => o.threadId || ("t-" + o.gid) }),
      getFrom: () => o.from,
      getSubject: () => o.subject || "",
      getDate: () => new Date(o.ts || "2026-08-03T09:00:00Z"),
      getPlainBody: () => o.body || "",
      getRawContent: () => raw,
      getTo: () => o.to || "",
      getCc: () => o.cc || ""
    };
  }

  const ContentService = {
    MimeType: { JSON: "json", TEXT: "text", PLAIN_TEXT: "text/plain" },
    createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; }
  };
  const MimeType = { PLAIN_TEXT: "text/plain" };
  const props = { STORE_FILE_ID: "f1", RESEND_KEY: "re_key", SYNC_KEY: "the-real-key" };
  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(k) { return props[k] || null; },
        getProperties() { return props; },
        setProperty(k, v) { props[k] = v; }, deleteProperty(k) { delete props[k]; }
      };
    }
  };
  const LockService = { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } };
  const GmailApp = {
    search(q, start, max) { return MAILBOX.slice(0, max || 50).map(m => ({ getMessages: () => [m] })); }
  };
  const Utilities = {
    formatDate() { return "2026/08/02"; },
    getUuid() { return "uuid-1"; }
  };
  const UrlFetchApp = {
    fetch(url, opts) {
      sentPayloads.push(opts);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: "re_sent_1" }) };
    }
  };

  const sandbox = {
    ContentService, MimeType, PropertiesService, LockService, GmailApp, Utilities, UrlFetchApp,
    JSON, Number, String, Object, Date, Math, isNaN, Array, RegExp
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(ROOT, "relay", "thrive-relay.gs"), "utf8");
  vm.runInContext(src, sandbox, { filename: "thrive-relay.gs" });

  // Replace the Drive-backed store with the in-memory one (the live reference, so mutations persist).
  sandbox.storeRead_ = () => STORE;
  sandbox.storeWrite_ = (o) => { STORE = o; sandbox.storeRead_ = () => STORE; };

  return {
    sandbox,
    setStore: (o) => { STORE = o; sandbox.storeRead_ = () => STORE; },
    getStore: () => STORE,
    setMailbox: (list) => { MAILBOX = list.map(mkMsg); },
    sentPayloads
  };
}

const R = loadRelay();
const relay = R.sandbox;

ck("the relay declares RELAY_VERSION 7 (P22)", relay.RELAY_VERSION === 7, relay.RELAY_VERSION);

/* ---- the send guarantees a Message-ID and returns it ---- */
{
  const out = relay.sendMail_({ to: "owner@wise.example", subject: "A short page", html: "<p>hi</p>", slug: "wise-butterfly" });
  const payload = JSON.parse(R.sentPayloads[R.sentPayloads.length - 1].payload);
  const hdrId = payload.headers && payload.headers["Message-ID"];
  ck("a send returns a messageId", !!out.messageId && /^<c.+@thriveiii\.com>$/.test(out.messageId), out.messageId);
  ck("the wire payload carries that exact Message-ID header", hdrId === out.messageId, { hdrId, ret: out.messageId });
  ck("the Reply-To is the per-opportunity plus address", out.replyTo === "hi+wise-butterfly@thriveiii.com", out.replyTo);
  ck("the Resend id is returned separately from the Message-ID", out.id === "re_sent_1", out.id);
}
{
  // a Message-ID the console already supplied is preserved, never overwritten
  const supplied = "<cCONSOLEMINTED@thriveiii.com>";
  const out = relay.sendMail_({ to: "x@y.example", subject: "s", html: "<p>", slug: "two-faces", headers: { "Message-ID": supplied } });
  ck("a console-supplied Message-ID is preserved on the wire and returned", out.messageId === supplied, out.messageId);
}

/* ---- attribution joins by plus-address and by references ---- */
{
  R.setStore({
    state: {
      opps: [{ slug: "wise-butterfly" }, { slug: "two-faces" }],
      mail: [
        { direction: "out", opp: "wise-butterfly", to: "owner@wise.example", ts: "2026-08-01T10:00:00Z",
          mid: "m1", msgid: "<cSENT1@thriveiii.com>" },
        { direction: "out", opp: "two-faces", to: "team@twofaces.example", ts: "2026-08-01T10:00:00Z", mid: "m2" }
      ]
    },
    inbound: []
  });
  const known = { "wise-butterfly": 1, "two-faces": 1 };
  const mail = R.getStore().state.mail;

  const tagMsg = {
    getId: () => "g-tag", getThread: () => ({ getId: () => "t1" }),
    getFrom: () => "Owner <owner@wise.example>", getSubject: () => "Re: hello",
    getDate: () => new Date("2026-08-03T09:00:00Z"), getPlainBody: () => "sounds good",
    getRawContent: () => "To: hi+wise-butterfly@thriveiii.com", getTo: () => "hi+wise-butterfly@thriveiii.com", getCc: () => ""
  };
  const recTag = relay.attributeMessage_(tagMsg, mail, known);
  ck("a reply to the plus address joins by the tag (plus-address)", recTag && recTag.rule === "tag" && recTag.opp === "wise-butterfly", recTag);
  ck("that plus-address join is deterministic", Inbound.joinBasis(recTag).basis === "plus-address" && Inbound.joinBasis(recTag).deterministic === true);

  const refMsg = {
    getId: () => "g-ref", getThread: () => ({ getId: () => "t2" }),
    getFrom: () => "someone@elsewhere.example", getSubject: () => "Re: hello",
    getDate: () => new Date("2026-08-03T10:00:00Z"), getPlainBody: () => "interested",
    getRawContent: () => "In-Reply-To: <cSENT1@thriveiii.com>", getTo: () => "hi@thriveiii.com", getCc: () => ""
  };
  const recRef = relay.attributeMessage_(refMsg, mail, known);
  ck("a reply whose In-Reply-To echoes the sent Message-ID joins by the thread (references)",
     recRef && recRef.rule === "thread" && recRef.opp === "wise-butterfly", recRef);
  ck("that references join is deterministic", Inbound.joinBasis(recRef).basis === "references" && Inbound.joinBasis(recRef).deterministic === true);
}

/* ---- the sweep is idempotent and writes a heartbeat ---- */
{
  R.setStore({ state: { opps: [{ slug: "wise-butterfly" }], mail: [
    { direction: "out", opp: "wise-butterfly", to: "owner@wise.example", ts: "2026-08-01T10:00:00Z", msgid: "<cS1@thriveiii.com>" }
  ] }, inbound: [] });
  R.setMailbox([
    { gid: "g1", from: "owner@wise.example", subject: "Re: hello", to: "hi+wise-butterfly@thriveiii.com", body: "yes", headers: [] },
    { gid: "g2", from: "team@twofaces.example", subject: "Re: page", to: "hi@thriveiii.com", body: "maybe", headers: [["In-Reply-To", "<cS1@thriveiii.com>"]] }
  ]);
  const a = relay.scanInbox();
  const nAfterFirst = R.getStore().inbound.length;
  const b = relay.scanInbox();
  const nAfterSecond = R.getStore().inbound.length;
  ck("the first sweep files the mailbox replies", nAfterFirst === 2, nAfterFirst);
  ck("a second sweep of the same mailbox adds nothing (idempotent by gid)", nAfterSecond === 2, [nAfterFirst, nAfterSecond]);
  const scan = R.getStore().inboxScan;
  ck("every sweep writes a heartbeat with a timestamp", !!(scan && scan.ts), scan);
  ck("the heartbeat carries the sweep interval", scan && scan.everyMin === 15, scan && scan.everyMin);
  ck("the heartbeat carries whether the sweep hit its read cap", scan && scan.capped === false, scan && scan.capped);
}

/* ---- a capped sweep is reported ---- */
{
  relay.INBOX_MAX = 2;                 // force the cap with three waiting messages
  R.setStore({ state: { opps: [{ slug: "wise-butterfly" }], mail: [] }, inbound: [] });
  R.setMailbox([
    { gid: "c1", from: "a@x.example", subject: "Re", to: "hi+wise-butterfly@thriveiii.com", body: "1", headers: [] },
    { gid: "c2", from: "b@x.example", subject: "Re", to: "hi+wise-butterfly@thriveiii.com", body: "2", headers: [] },
    { gid: "c3", from: "c@x.example", subject: "Re", to: "hi+wise-butterfly@thriveiii.com", body: "3", headers: [] }
  ]);
  relay.scanInbox();
  ck("a sweep that reads as many messages as it is allowed reports capped=true", R.getStore().inboxScan.capped === true, R.getStore().inboxScan);
  relay.INBOX_MAX = 50;
}

/* ---- reconciliation reports the gap, and a sweep closes it ---- */
{
  R.setStore({ state: { opps: [{ slug: "wise-butterfly" }], mail: [] },
    inbound: [{ gid: "r1", opp: "wise-butterfly", rule: "tag" }] });   // only one of three filed
  R.setMailbox([
    { gid: "r1", from: "a@x.example", subject: "Re", to: "hi+wise-butterfly@thriveiii.com", body: "1", headers: [] },
    { gid: "r2", from: "b@x.example", subject: "Re", to: "hi+wise-butterfly@thriveiii.com", body: "2", headers: [] },
    { gid: "r3", from: "c@x.example", subject: "Re", to: "hi+wise-butterfly@thriveiii.com", body: "3", headers: [] }
  ]);
  const recon = relay.inboxReconcile_(2);
  ck("reconciliation counts the mailbox replies", recon.mailbox === 3, recon);
  ck("reconciliation reports the gap the store has not filed", recon.gap === 2, recon);
  ck("reconciliation names the missing message ids", recon.missing.indexOf("r2") >= 0 && recon.missing.indexOf("r3") >= 0, recon.missing);
  ck("reconciliation writes nothing to the store", R.getStore().inbound.length === 1, R.getStore().inbound.length);
  relay.scanInbox();                   // a real sweep files them
  const recon2 = relay.inboxReconcile_(2);
  ck("after a sweep, reconciliation finds no gap", recon2.gap === 0, recon2);
}

/* ---- the HTTP surface exposes the new ops, versioned ---- */
{
  function post(body) { return JSON.parse(relay.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()); }
  const rec = post({ op: "inbox_reconcile", auth: "the-real-key", days: 2 });
  ck("the inbox_reconcile op answers and carries relay_version", rec.relay_version === 7 && rec.ok === true, rec);
}

console.log("\n" + (fails ? fails + " failed" : "ALL INBOUND-PROVEN CHECKS PASS"));
process.exit(fails ? 1 : 0);
