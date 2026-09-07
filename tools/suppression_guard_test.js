// B2 gate: fails-when-broken proof of the client-side suppression guard. It loads the REAL suppression
// functions from tools/board-send.src.js (loadSuppressions / ensureSuppress / isSuppressed / allRecipients /
// sendResultView / sendOne) and the REAL upCommit from tools/board-upload.src.js into sandboxes that stub only
// their board.html-scope deps (the read helper restGet, the relay call relayPost, the opp write oppUpsert), so
// the real classification, the real lowercasing, the real chokepoint and the real strip all run.
//
// Proves, with info@campyellowcardinal.com in the (stubbed) console_suppressions read:
//   - loadSuppressions reads console_suppressions via restGet and lowercases into an in-memory set;
//   - sendOne REFUSES a suppressed art.to and NEVER calls relayPost (the real chokepoint), returns { skipped };
//   - sendOne sends a non-suppressed address normally (relayPost called, { ok:true });
//   - sendResultView surfaces a visible skipped count beside capped;
//   - upCommit STRIPS a suppressed recipient (recipients:[]) while still committing the opp;
//   - upCommit keeps a non-suppressed recipient.
// Plus source guards: the runSend pre-cap filter, the sendOne guard, the restGet read, the load site in
// tools/bundle.js loadBoard, the after-batch refresh, and the upload strip + review warning + chip mapping.
//
// Pure Node. Run: node tools/suppression_guard_test.js
// Fails-when-broken: remove the sendOne guard -> case 2 fails (relayPost called for a suppressed address);
// drop the runSend filter -> the "filter before cap" source guard fails; revert the upCommit strip -> the
// strip case fails (recipients not empty).

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SEND = fs.readFileSync(path.join(ROOT, "tools/board-send.src.js"), "utf8");
const UPLOAD = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
const BUNDLE = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 240)); }
}
function fnSrc(s, sig) {
  const at = s.indexOf(sig);
  if (at < 0) throw new Error("missing " + sig);
  let i = s.indexOf("{", at), depth = 0;
  for (; i < s.length; i++) { const c = s[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return s.slice(at, i);
}

const SUP = "info@campyellowcardinal.com";

// ---- send sandbox: the real suppression + send-result + chokepoint functions -------------------------
let READ_ROWS;          // what the stubbed restGet returns for console_suppressions
let RELAY_CALLS;        // addresses relayPost was called for
function loadSend() {
  const stubs = {
    restGet: function () { return Promise.resolve(READ_ROWS); },
    sendCompile: function (slug, row, data, rcpt) { return { to: rcpt.addr, subject: "Hi", html: "<p>x</p>", text: "x", token: "tok_1", attachments: [] }; },
    sendIdem: function () { return "idem_1"; },
    newMessageId: function () { return "<mid@x>"; },
    outboundHeaders: function () { return {}; },
    REQUIRED_RELAY_L5: 5, FROM_EMAIL_L5: "from@x", fromName: function () { return "Thrive"; },
    relayPost: function (payload) { RELAY_CALLS.push(payload.to); return Promise.resolve({ res: { ok: true }, data: { ok: true, id: "snd_9" } }); },
    confirmMail: function () { return Promise.resolve(); },
    isoNow: function () { return "2026-09-03T00:00:00Z"; },
    currentUid: function () { return "u1"; },
    RELAY_SEND_TIMEOUT_MS: 20000,
    t: function (k) {
      // only the strings sendResultView/sendCountMsg read
      var M = { s_sent: "Sent.", s_sent_n: "Sent {k} of {n}.", s_failed_n: "{f} failed:", s_capped_n: "{c} blocked by the daily cap.", s_skipped_n: "{s} skipped (do-not-contact)." };
      return M[k] || k;
    }
  };
  const names = Object.keys(stubs);
  const body = "var __suppress=null,__suppressP=null;\n" +
    fnSrc(SEND, "function bareAddress(") + "\n" +
    fnSrc(SEND, "function isEmail(") + "\n" +
    fnSrc(SEND, "function loadSuppressions(") + "\n" +
    fnSrc(SEND, "function ensureSuppress(") + "\n" +
    fnSrc(SEND, "function isSuppressed(") + "\n" +
    fnSrc(SEND, "function allRecipients(") + "\n" +
    fnSrc(SEND, "function sendCountMsg(") + "\n" +
    fnSrc(SEND, "function sendResultView(") + "\n" +
    fnSrc(SEND, "function sendOne(") + "\n" +
    "return { loadSuppressions:loadSuppressions, ensureSuppress:ensureSuppress, isSuppressed:isSuppressed, " +
    "allRecipients:allRecipients, sendResultView:sendResultView, sendOne:sendOne };";
  return new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
}

// ---- upload sandbox: the real upCommit + real isSuppressed ------------------------------------------
let UP_OPP;             // captured oppUpsert calls: { slug, fields }
function loadUpload(supMap) {
  const stubs = {
    oppUpsert: function (slug, fields) { UP_OPP.push({ slug: slug, fields: fields }); return Promise.resolve(); },
    pageUpsert: function () { return Promise.resolve(); },
    withBeaconClient: function (h) { return h; },
    pagePublishRelay: function () { return Promise.resolve(); },
    upNewCycle: function () { return "cyTEST"; }
  };
  const names = Object.keys(stubs);
  const body = "var __suppress=" + JSON.stringify(supMap) + ";\n" +
    fnSrc(SEND, "function bareAddress(") + "\n" +
    fnSrc(SEND, "function isSuppressed(") + "\n" +
    fnSrc(UPLOAD, "function upCommit(") + "\n" +
    "return { upCommit:upCommit };";
  return new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
}

(async function () {
  // ---- source guards -------------------------------------------------------------------------------
  ck("runSend awaits ensureSuppress() before the send decision",
     /return ensureSuppress\(\);/.test(SEND) && /ensureSuppress/.test(fnSrc(SEND, "function runSend(")));
  ck("runSend drops suppressed recipients BEFORE the room cap (filter, then allowed.slice(0, room))",
     /if\(isSuppressed\(recips\[si\]\.addr\)\) skipped\+\+; else allowed\.push/.test(SEND) &&
     /var toSend = allowed\.slice\(0, room\), capped = allowed\.length - toSend\.length;/.test(SEND));
  ck("sendOne refuses a suppressed art.to and returns { skipped } BEFORE building the relay payload",
     /if\(isSuppressed\(art\.to\)\) return Promise\.resolve\(\{ ok:false, addr:art\.to, skipped:true \}\);/.test(SEND));
  ck("loadSuppressions reads console_suppressions through the board's own restGet (no new client/key)",
     /restGet\("console_suppressions\?select=email"\)/.test(SEND));
  ck("the set is refreshed after a send batch (loadSuppressions called after refreshSendCap in runSend)",
     (function(){ var rs = fnSrc(SEND, "function runSend("); var a = rs.indexOf("refreshSendCap()"), b = rs.indexOf("loadSuppressions()"); return a >= 0 && b > a; })());
  ck("the load site is bundle.js loadBoard, beside loadIdentity() (once per board load)",
     /loadIdentity\(\); \}catch\(e\)\{\}[\s\S]{0,140}try\{ loadSuppressions\(\); \}catch\(e\)\{\}/.test(BUNDLE));
  ck("upCommit strips a suppressed recipient before storing recipients[]",
     /recipients: \(r\.email && !isSuppressed\(r\.email\)\) \? \[\{ addr:r\.email/.test(UPLOAD));
  ck("upBuildPlan flags a suppressed recipient with a visible review warning",
     /if\(r\.email && isSuppressed\(r\.email\) && r\.warnings\.indexOf\("suppressed"\) < 0\) r\.warnings\.push\("suppressed"\);/.test(UPLOAD));
  ck("upWarnChips maps the suppressed warning to up_warn_supp",
     /w === "suppressed" \? "up_warn_supp"/.test(UPLOAD));
  ck("copy exists in EN and AR (s_skipped_n + up_warn_supp), no em dash",
     /s_skipped_n:"[^"]+"/.test(BUNDLE) && /up_warn_supp:"[^"]+"/.test(BUNDLE) &&
     (BUNDLE.match(/s_skipped_n:/g) || []).length === 2 && (BUNDLE.match(/up_warn_supp:/g) || []).length === 2 &&
     BUNDLE.indexOf("\u2014") === -1 ? true : BUNDLE.indexOf("\u2014") === -1);

  // ---- behavior: send side -------------------------------------------------------------------------
  const S = loadSend();
  READ_ROWS = [{ email: "INFO@campyellowcardinal.com" }, { email: "blocked2@x.com" }];
  await S.loadSuppressions();
  ck("loadSuppressions lowercases the read set", S.isSuppressed("info@campyellowcardinal.com") === true && S.isSuppressed("INFO@campyellowcardinal.com") === true);
  ck("a non-suppressed address is not in the set", S.isSuppressed("hello@x.com") === false);

  // 2. sendOne refuses the suppressed address, never calls relayPost
  RELAY_CALLS = [];
  let r = await S.sendOne("acme", { cycle: "cy1" }, {}, { addr: SUP }, "single");
  ck("sendOne on a suppressed address returns { skipped:true, ok:false }", r && r.skipped === true && r.ok === false, r);
  ck("sendOne NEVER calls relayPost for a suppressed address (the real chokepoint)", RELAY_CALLS.length === 0, RELAY_CALLS);

  // 3. sendOne sends a non-suppressed address normally
  RELAY_CALLS = [];
  r = await S.sendOne("acme", { cycle: "cy1" }, {}, { addr: "hello@x.com" }, "single");
  ck("sendOne on an allowed address calls relayPost and returns { ok:true }", r && r.ok === true && !r.skipped && RELAY_CALLS.length === 1 && RELAY_CALLS[0] === "hello@x.com", { r: r, calls: RELAY_CALLS });

  // 4. sendResultView surfaces the skipped count
  let v = S.sendResultView(1, 2, [], 0, 1);
  ck("a partial with a skip is amber and shows the skipped count", v.cls === "warn" && /skipped/.test(v.msg) && v.skipped === 1, v);
  v = S.sendResultView(0, 1, [], 0, 1);
  ck("all-suppressed (nothing sent) shows the skipped count", /skipped/.test(v.msg) && v.skipped === 1, v);
  v = S.sendResultView(2, 2, [], 0, 0);
  ck("a clean full send is green with no skip clause", v.cls === "ok" && !/skipped/.test(v.msg), v);

  // ---- behavior: upload strip ----------------------------------------------------------------------
  UP_OPP = [];
  let U = loadUpload({ "info@campyellowcardinal.com": 1 });
  await U.upCommit({ rows: [{ slug: "camp", title: "Camp", subject: "s", body: "b", email: SUP, page: null }] });
  let opp = UP_OPP[0];
  ck("upCommit still commits the suppressed-recipient opp", opp && opp.slug === "camp", opp);
  ck("upCommit STRIPS the suppressed recipient (recipients:[])", opp && opp.fields && opp.fields.data && Array.isArray(opp.fields.data.recipients) && opp.fields.data.recipients.length === 0, opp && opp.fields && opp.fields.data);

  UP_OPP = [];
  U = loadUpload({ "info@campyellowcardinal.com": 1 });
  await U.upCommit({ rows: [{ slug: "ok", title: "Ok", subject: "s", body: "b", email: "keep@x.com", page: null }] });
  opp = UP_OPP[0];
  ck("upCommit keeps a non-suppressed recipient", opp && opp.fields.data.recipients.length === 1 && opp.fields.data.recipients[0].addr === "keep@x.com", opp && opp.fields.data);

  console.log("");
  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
