// B2 gate: fails-when-broken proof of the FAIL-CLOSED client-side suppression guard. It loads the REAL
// functions from tools/board-send.src.js (loadSuppressions / ensureSuppress / suppressUnavailable / isSuppressed
// / allRecipients / sendResultView / sendOne / runSend) and the REAL upCommit from tools/board-upload.src.js
// into sandboxes that stub only their board.html-scope deps (the read wrapper authFetchOnce, the relay call
// relayPost, the opp write oppUpsert, the board read/render helpers), so the real load, the real chokepoint,
// the real strip and the real fail-closed block all run.
//
// Proves, with info@campyellowcardinal.com the suppressed address:
//   - a 200 read (even an EMPTY list) is a valid load and does NOT block; the set lowercases;
//   - FAIL-CLOSED: when the console_suppressions read has NEVER succeeded, runSend halts the batch - zero
//     sends, zero relay calls - with the visible block message (s_suppress_unavail);
//   - a cached SUCCESSFUL load stays valid: a later failed refresh does not block a subsequent send;
//   - runSend drops a suppressed recipient before the cap (relay never called for it) with a visible skip;
//   - sendOne refuses a suppressed art.to and never calls relayPost (the real chokepoint);
//   - upCommit STRIPS a suppressed recipient (recipients:[]) while still committing the opp.
//
// Pure Node. Run: node tools/suppression_guard_test.js
// Fails-when-broken: revert loadSuppressions to fail-open (set __suppress={} on error) -> the fail-closed
// block case fails (runSend sends on an empty set); remove the sendOne guard -> the chokepoint case fails;
// revert the upCommit strip -> the strip case fails.

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SEND = fs.readFileSync(path.join(ROOT, "tools/board-send.src.js"), "utf8");
const UPLOAD = fs.readFileSync(path.join(ROOT, "tools/board-upload.src.js"), "utf8");
const BUNDLE = fs.readFileSync(path.join(ROOT, "tools/bundle.js"), "utf8");

let fails = 0;
function ck(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) { fails++; if (detail !== undefined) console.log("      " + String(detail).slice(0, 260)); }
}
function fnSrc(s, sig) {
  const at = s.indexOf(sig);
  if (at < 0) throw new Error("missing " + sig);
  let i = s.indexOf("{", at), depth = 0;
  for (; i < s.length; i++) { const c = s[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } }
  return s.slice(at, i);
}

const SUP = "info@campyellowcardinal.com";

// ---- send sandbox: the REAL load + suppression + result + chokepoint + runSend --------------------------
// Controlled per case by these outer vars (the stubs read them by closure):
let AUTH_OK;            // does the stubbed console_suppressions read return 200?
let AUTH_ROWS;          // the rows a 200 read returns (an empty [] is a valid, non-blocking load)
let CUR_RECIPS;         // data.recipients the opp read returns to runSend
let RELAY_CALLS;        // every address relayPost was actually called for
function loadSend() {
  const stubs = {
    // the do-not-contact read wrapper (loadSuppressions uses authFetchOnce, NOT the best-effort restGet)
    authFetchOnce: function () { return AUTH_OK ? Promise.resolve({ res: { ok: true, status: 200 }, data: AUTH_ROWS }) : Promise.resolve({ res: { ok: false, status: 500 }, data: null }); },
    URL_BASE: "https://x.supabase.co", ANON: "anon", bearer: function () { return "tok"; },
    session: function () { return null; }, refresh: function () { return Promise.resolve(false); },
    // sendOne deps
    sendCompile: function (slug, row, data, rcpt) { return { to: rcpt.addr, subject: "Hi", html: "<p>x</p>", text: "x", token: "tok_" + rcpt.addr, attachments: [] }; },
    sendIdem: function () { return "idem_1"; }, newMessageId: function () { return "<mid@x>"; }, outboundHeaders: function () { return {}; },
    REQUIRED_RELAY_L5: 5, FROM_EMAIL_L5: "from@x", fromName: function () { return "Thrive"; },
    relayPost: function (payload) { RELAY_CALLS.push(payload.to); return Promise.resolve({ res: { ok: true }, data: { ok: true, id: "snd_9" } }); },
    confirmMail: function () { return Promise.resolve(); }, isoNow: function () { return "2026-09-03T00:00:00Z"; },
    currentUid: function () { return "u1"; }, RELAY_SEND_TIMEOUT_MS: 20000,
    // runSend env
    findRow: function (slug) { return { slug: slug, cycle: "cy1", sent_count: 0 }; },
    drawerActsDisabled: function () {}, renderBoard: function () {}, replaceRow: function () {},
    oppReadData: function () { return Promise.resolve({ recipients: CUR_RECIPS, outreach_subject: "S", outreach_text: "B" }); },
    sendBudget: function () { return Promise.resolve({ dayLeft: 100, monthLeft: 1000, dayUsed: 0, monthUsed: 0 }); },
    sendMode: function () { return "single"; }, upDelay: function () { return Promise.resolve(); }, SEND_GAP_MS: 0,
    refreshDrawer: function () {}, refreshSendCap: function () {}, redInto: function () {}, root: {}, reloadBoardData: function () { return Promise.resolve(); },
    t: function (k) {
      var M = { s_sending: "...", s_no_recip: "NORECIP", s_no_msg: "NOMSG", s_cap: "CAP", s_dead_link: "DEAD", err: "ERR",
        s_failed: "FAILED", s_suppress_unavail: "SUPPRESS_BLOCK",
        s_sent: "Sent.", s_sent_n: "Sent {k} of {n}.", s_failed_n: "{f} failed:", s_capped_n: "{c} blocked by the daily cap.", s_skipped_n: "{s} skipped (do-not-contact)." };
      return M[k] || k;
    }
  };
  const names = Object.keys(stubs);
  const body =
    "var __writing=false, __act={}, __drawerSlug=null, __data={rows:[]};\n" +
    "var __suppress=null, __suppressLoaded=false, __suppressInFlight=false, __suppressP=null;\n" +
    fnSrc(SEND, "function bareAddress(") + "\n" +
    fnSrc(SEND, "function isEmail(") + "\n" +
    fnSrc(SEND, "function loadSuppressions(") + "\n" +
    fnSrc(SEND, "function ensureSuppress(") + "\n" +
    fnSrc(SEND, "function suppressUnavailable(") + "\n" +
    fnSrc(SEND, "function isSuppressed(") + "\n" +
    fnSrc(SEND, "function allRecipients(") + "\n" +
    fnSrc(SEND, "function sendCountMsg(") + "\n" +
    fnSrc(SEND, "function sendResultView(") + "\n" +
    fnSrc(SEND, "function sendOne(") + "\n" +
    fnSrc(SEND, "function runSend(") + "\n" +
    "return { loadSuppressions:loadSuppressions, ensureSuppress:ensureSuppress, suppressUnavailable:suppressUnavailable, " +
    "isSuppressed:isSuppressed, sendResultView:sendResultView, sendOne:sendOne, runSend:runSend, act:function(s){ return __act[s]; } };";
  return new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
}

// ---- upload sandbox: the real upCommit + real isSuppressed ------------------------------------------
let UP_OPP;
function loadUpload(supMap) {
  const stubs = {
    oppUpsert: function (slug, fields) { UP_OPP.push({ slug: slug, fields: fields }); return Promise.resolve(); },
    pageUpsert: function () { return Promise.resolve(); }, withBeaconClient: function (h) { return h; },
    pagePublishRelay: function () { return Promise.resolve(); }, upNewCycle: function () { return "cyTEST"; }
  };
  const names = Object.keys(stubs);
  const body = "var __suppress=" + JSON.stringify(supMap) + ", __suppressLoaded=true;\n" +
    fnSrc(SEND, "function bareAddress(") + "\n" +
    fnSrc(SEND, "function isSuppressed(") + "\n" +
    fnSrc(UPLOAD, "function upCommit(") + "\n" +
    "return { upCommit:upCommit };";
  return new Function(names.join(","), body).apply(null, names.map(function (n) { return stubs[n]; }));
}

(async function () {
  // ---- source guards -------------------------------------------------------------------------------
  ck("loadSuppressions reads console_suppressions via authFetchOnce (a 200/empty is distinguishable from a failure)",
     /console_suppressions\?select=email/.test(SEND) && /authFetchOnce\(url/.test(fnSrc(SEND, "function loadSuppressions(")));
  ck("FAIL-CLOSED: a real read failure does NOT mark the set loaded (no fail-open empty set)",
     /if\(!r\.res\.ok\)\{ throw new Error\("HTTP "\+r\.res\.status\); \}/.test(SEND) &&
     !/__suppress = __suppress \|\| \{\}/.test(SEND));
  ck("a 200 read (even empty) marks the set loaded and valid",
     /__suppress = m; __suppressLoaded = true;/.test(SEND));
  ck("ensureSuppress short-circuits a cached good set and (re)tries otherwise",
     /if\(__suppressLoaded\) return Promise\.resolve\(__suppress\);/.test(SEND));
  ck("runSend blocks the batch when the set is unavailable (suppress_block), before sendBudget/any send",
     /suppressUnavailable\(\)\)\{ var eb=new Error\("suppression unavailable"\); eb\.__kind="suppress_block"; throw eb; \}/.test(SEND) &&
     /kind==="suppress_block"\) \? t\("s_suppress_unavail"\)/.test(SEND));
  ck("runSend drops suppressed recipients BEFORE the room cap (filter, then allowed.slice(0, room))",
     /if\(isSuppressed\(recips\[si\]\.addr\)\) skipped\+\+; else allowed\.push/.test(SEND) &&
     /var toSend = allowed\.slice\(0, room\), capped = allowed\.length - toSend\.length;/.test(SEND));
  ck("sendOne refuses a suppressed art.to and returns { skipped } BEFORE building the relay payload",
     /if\(isSuppressed\(art\.to\)\) return Promise\.resolve\(\{ ok:false, addr:art\.to, skipped:true \}\);/.test(SEND));
  ck("the set is refreshed after a send batch (loadSuppressions called after refreshSendCap in runSend)",
     (function(){ var rs = fnSrc(SEND, "function runSend("); var a = rs.indexOf("refreshSendCap()"), b = rs.indexOf("loadSuppressions()"); return a >= 0 && b > a; })());
  ck("the load site is bundle.js loadBoard, beside loadIdentity() (once per board load)",
     /loadIdentity\(\); \}catch\(e\)\{\}[\s\S]{0,180}loadSuppressions\(\)\.catch/.test(BUNDLE));
  ck("upCommit strips a suppressed recipient before storing recipients[]",
     /recipients: \(r\.email && !isSuppressed\(r\.email\)\) \? \[\{ addr:r\.email/.test(UPLOAD));
  ck("upBuildPlan flags a suppressed recipient with a visible review warning",
     /if\(r\.email && isSuppressed\(r\.email\) && r\.warnings\.indexOf\("suppressed"\) < 0\) r\.warnings\.push\("suppressed"\);/.test(UPLOAD));
  ck("upWarnChips maps the suppressed warning to up_warn_supp",
     /w === "suppressed" \? "up_warn_supp"/.test(UPLOAD));
  ck("copy exists in EN and AR (s_suppress_unavail, s_skipped_n, up_warn_supp), no em dash",
     (BUNDLE.match(/s_suppress_unavail:/g) || []).length === 2 && (BUNDLE.match(/s_skipped_n:/g) || []).length === 2 &&
     (BUNDLE.match(/up_warn_supp:/g) || []).length === 2 && BUNDLE.indexOf("\u2014") === -1);

  // ---- FAIL-CLOSED: a never-loaded set halts runSend with zero sends and zero relay calls -----------
  let S = loadSend();
  AUTH_OK = false; AUTH_ROWS = null; CUR_RECIPS = [{ addr: "a@b.com" }]; RELAY_CALLS = [];
  ck("the set starts unavailable before any successful load", S.suppressUnavailable() === true);
  let res = await S.runSend("acme");
  ck("FAIL-CLOSED: runSend on a never-loaded set sends NOTHING (sent 0, cls bad)", res && res.sent === 0 && res.cls === "bad", res);
  ck("FAIL-CLOSED: runSend calls the relay ZERO times when the set is unavailable", RELAY_CALLS.length === 0, RELAY_CALLS);
  ck("FAIL-CLOSED: the visible message is the block copy (s_suppress_unavail), not a generic failure", res && res.msg === "SUPPRESS_BLOCK", res);
  ck("FAIL-CLOSED: the drawer status reflects the block", (function(){ var a = S.act("acme"); return a && a.cls === "bad" && a.msg === "SUPPRESS_BLOCK"; })());

  // ---- a 200 EMPTY read is a valid load: the send proceeds (empty list blocks nobody) --------------
  S = loadSend();
  AUTH_OK = true; AUTH_ROWS = []; CUR_RECIPS = [{ addr: "a@b.com" }]; RELAY_CALLS = [];
  res = await S.runSend("acme");
  ck("a 200 EMPTY suppression read does NOT block: the send goes out", res && res.sent === 1 && RELAY_CALLS.length === 1 && RELAY_CALLS[0] === "a@b.com", { res: res, calls: RELAY_CALLS });

  // ---- a good load with the suppressed address: runSend drops it, relay never called for it --------
  S = loadSend();
  AUTH_OK = true; AUTH_ROWS = [{ email: "INFO@campyellowcardinal.com" }]; CUR_RECIPS = [{ addr: SUP }]; RELAY_CALLS = [];
  res = await S.runSend("acme");
  ck("runSend drops the suppressed recipient: zero relay calls, a visible skip, nothing sent", RELAY_CALLS.length === 0 && res && res.sent === 0 && res.skipped === 1 && /skipped/.test(res.msg), { res: res, calls: RELAY_CALLS });

  // ---- a mixed list: the allowed address sends, the suppressed one is skipped ----------------------
  S = loadSend();
  AUTH_OK = true; AUTH_ROWS = [{ email: SUP }]; CUR_RECIPS = [{ addr: SUP }, { addr: "ok@x.com" }]; RELAY_CALLS = [];
  res = await S.runSend("acme");
  ck("a mixed list sends only the allowed address and reports the skip", RELAY_CALLS.length === 1 && RELAY_CALLS[0] === "ok@x.com" && res.sent === 1 && res.skipped === 1, { res: res, calls: RELAY_CALLS });

  // ---- a cached SUCCESSFUL load stays valid: a later FAILED refresh does not block a send ----------
  S = loadSend();
  AUTH_OK = true; AUTH_ROWS = []; CUR_RECIPS = [{ addr: "a@b.com" }]; RELAY_CALLS = [];
  await S.runSend("acme");                         // first send loads the set successfully
  AUTH_OK = false;                                 // now every further read FAILS
  await S.ensureSuppress();                        // a failed refresh must not clear the cached good set
  ck("a cached good set stays valid after a failed refresh (still loaded)", S.suppressUnavailable() === false);
  RELAY_CALLS = [];
  res = await S.runSend("acme");
  ck("a send after a failed refresh still goes out (cached set, not blocked)", res && res.sent === 1 && RELAY_CALLS.length === 1, { res: res, calls: RELAY_CALLS });

  // ---- sendOne chokepoint (direct): a suppressed address never reaches relayPost -------------------
  S = loadSend();
  AUTH_OK = true; AUTH_ROWS = [{ email: SUP }];
  await S.loadSuppressions();
  RELAY_CALLS = [];
  let r = await S.sendOne("acme", { cycle: "cy1" }, {}, { addr: SUP }, "single");
  ck("sendOne on a suppressed address returns { skipped } and never calls relayPost", r && r.skipped === true && r.ok === false && RELAY_CALLS.length === 0, { r: r, calls: RELAY_CALLS });
  RELAY_CALLS = [];
  r = await S.sendOne("acme", { cycle: "cy1" }, {}, { addr: "hello@x.com" }, "single");
  ck("sendOne on an allowed address calls relayPost and returns { ok:true }", r && r.ok === true && !r.skipped && RELAY_CALLS.length === 1, { r: r, calls: RELAY_CALLS });

  // ---- sendResultView surfaces the skipped count --------------------------------------------------
  let v = S.sendResultView(1, 2, [], 0, 1);
  ck("a partial with a skip is amber and shows the skipped count", v.cls === "warn" && /skipped/.test(v.msg) && v.skipped === 1, v);
  v = S.sendResultView(2, 2, [], 0, 0);
  ck("a clean full send is green with no skip clause", v.cls === "ok" && !/skipped/.test(v.msg), v);

  // ---- upload strip -------------------------------------------------------------------------------
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
