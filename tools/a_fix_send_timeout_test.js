// A-fix gate: fails-when-broken proof that a slow-but-delivered board send is not a false failure. It loads the
// REAL sendOne from tools/board-send.src.js into a sandbox stubbing its board.html-scope deps, and drives:
//   - a normal relay success  -> { ok:true }, a status:'sent' console_mail row written;
//   - a TIMEOUT rejection      -> a status:'pending' row written AND { ok:true, confirming:true } (no revert);
//   - a non-timeout rejection  -> { ok:false }, NO row (a real failure stays a failure);
//   - relay non-2xx / ok:false -> { ok:false }.
// Plus source guards: the 20s send bound, its use at the relayPost call, and the pending-row write.
//
// Pure Node. Run: node tools/a_fix_send_timeout_test.js

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "tools/board-send.src.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 220)); }
}
function fnSrc(s, sig) {
  const at = s.indexOf(sig);
  if (at < 0) return "";
  let i = s.indexOf("{", at), depth = 0;
  for (; i < s.length; i++) { const c = s[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return s.slice(at, i);
}

// ---- the controllable relay + captured writes ----
let RELAY;                 // () => Promise, set per case
let LAST_TIMEOUT_MS;       // the 2nd arg relayPost was called with
let CONFIRMED;             // rows passed to confirmMail

function loadSendOne() {
  const stubs = {
    sendCompile: function () { return { to: "a@b.com", subject: "Hi", html: "<p>x</p>", text: "x", token: "tok_1", attachments: [] }; },
    sendIdem: function () { return "idem_1"; },
    newMessageId: function () { return "<mid@x>"; },
    outboundHeaders: function () { return {}; },
    REQUIRED_RELAY_L5: 5, FROM_EMAIL_L5: "from@x", fromName: function () { return "Thrive"; },
    relayPost: function (payload, timeoutMs) { LAST_TIMEOUT_MS = timeoutMs; return RELAY(); },
    confirmMail: function (row) { CONFIRMED.push(row); return Promise.resolve(); },
    isoNow: function () { return "2026-09-03T00:00:00Z"; },
    currentUid: function () { return "u1"; },
    // the module-level constant sendOne reads; the source guard below asserts the real file defines it as 20000.
    RELAY_SEND_TIMEOUT_MS: 20000
  };
  const names = Object.keys(stubs);
  const body = fnSrc(src, "function sendOne(") + "\nreturn sendOne;";
  const fn = new Function(names.join(","), body);
  return fn.apply(null, names.map(function (n) { return stubs[n]; }));
}
const sendOne = loadSendOne();
function reset() { LAST_TIMEOUT_MS = undefined; CONFIRMED = []; }
function call() { return sendOne("underdog", { cycle: "cy1" }, {}, { addr: "a@b.com" }, "single"); }

(async function () {
  // ---- source guards ----
  ck("RELAY_SEND_TIMEOUT_MS is defined at 20000 (a real bound over the 6s default)",
     /var RELAY_SEND_TIMEOUT_MS\s*=\s*20000;/.test(src));
  ck("the send passes RELAY_SEND_TIMEOUT_MS to relayPost (not the 6s default)",
     /relayPost\(payload,\s*RELAY_SEND_TIMEOUT_MS\)/.test(src));
  const so = fnSrc(src, "function sendOne(");
  ck("the timeout branch writes a status:'pending' row and returns confirming (not a failure)",
     /err\.kind\s*===\s*"timeout"/.test(so) && /status:"pending"/.test(so) && /confirming:true/.test(so), so.slice(-400));
  ck("a non-timeout rejection still returns { ok:false } (a real failure stays a failure)",
     /if\(!\(err && err\.kind === "timeout"\)\) return \{ ok:false/.test(so), so.slice(-500));

  // ---- 1. normal success: ok:true, a 'sent' row written ----
  reset(); RELAY = function () { return Promise.resolve({ res: { ok: true }, data: { ok: true, id: "snd_9" } }); };
  let r = await call();
  ck("a normal relay success returns { ok:true }", r && r.ok === true && !r.confirming, r);
  ck("...and writes a status:'sent' console_mail row", CONFIRMED.length === 1 && CONFIRMED[0].status === "sent" && CONFIRMED[0].opp === "underdog", CONFIRMED[0]);
  ck("...through the 20s bound (relayPost got RELAY_SEND_TIMEOUT_MS)", LAST_TIMEOUT_MS === 20000, LAST_TIMEOUT_MS);

  // ---- 2. TIMEOUT: a pending row is written, result is confirming (NOT a failure) ----
  reset(); RELAY = function () { var e = new Error("timed out"); e.kind = "timeout"; return Promise.reject(e); };
  r = await call();
  ck("a TIMEOUT returns { ok:true, confirming:true } (no revert, no red banner)", r && r.ok === true && r.confirming === true, r);
  ck("...and WRITES a status:'pending' row so reloadBoardData finds the send and the card sticks",
     CONFIRMED.length === 1 && CONFIRMED[0].status === "pending" && CONFIRMED[0].opp === "underdog" && CONFIRMED[0].to_addr === "a@b.com", CONFIRMED[0]);
  ck("...the pending row carries the same token/idem and the opp cycle (counts as this transit's send)",
     CONFIRMED[0].id === "tok_1" && CONFIRMED[0].cycle === "cy1" && CONFIRMED[0].data && CONFIRMED[0].data.idem === "idem_1", CONFIRMED[0]);

  // ---- 3. a non-timeout rejection is STILL a real failure, no row ----
  reset(); RELAY = function () { return Promise.reject(new Error("network")); };   // no .kind
  r = await call();
  ck("a network/aborted rejection stays { ok:false } (a real failure is not masked)", r && r.ok === false, r);
  ck("...and writes NO row", CONFIRMED.length === 0, CONFIRMED);

  // ---- 4. relay non-2xx and body ok:false are still failures ----
  reset(); RELAY = function () { return Promise.resolve({ res: { ok: false }, data: {} }); };
  r = await call();
  ck("a relay non-2xx returns { ok:false }", r && r.ok === false && CONFIRMED.length === 0, r);
  reset(); RELAY = function () { return Promise.resolve({ res: { ok: true }, data: { ok: false } }); };
  r = await call();
  ck("a relay body ok:false returns { ok:false }", r && r.ok === false && CONFIRMED.length === 0, r);

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
