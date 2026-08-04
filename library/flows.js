/* One registry, no open loops.
   =========================================================================

   A flow that can be entered and not left is a dead end, and the review found
   several. The fix that lasts is not finding them one at a time: it is making a
   flow that has no ending impossible to declare, and failing the build on one
   that is.

   EVERY MULTI-STEP INTERACTION IS DECLARED HERE, with its entry, its steps, its
   exits and its completion. A flow not in the registry does not open.

   The gate is in tools/verify.js and it reads this file. It fails on a
   registered flow with no back, no close, or no defined completion, and the
   proof that it works is removing one and watching the build go red.

   Pure. No DOM, no storage, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThriveFlows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Every action ends in one of exactly these three, and each one says what
     happened. A fourth outcome is a spinner that runs forever. */
  var OUTCOMES = ["success", "failure", "cancelled"];

  /* Every network call has a timeout and a stated failure. The relay can be
     slow, and a promise that never settles is a frozen console. */
  var DEFAULT_TIMEOUT_MS = 30000;

  var FLOWS = {
    opportunity: {
      title: "mw_overview",
      entry: "a card on the board",
      steps: ["overview", "text", "page", "outreach", "history"],
      back: "modalBack",
      close: "modalClose",
      completion: "the window closes, and the card carries whatever moved",
      outcomes: OUTCOMES
    },
    outreach_channel: {
      title: "och_h",
      entry: "the Outreach tab of an opportunity",
      steps: ["question", "channel", "sent"],
      back: "ochChange",
      close: "modalClose",
      completion: "send_offchannel is recorded, or the path is changed",
      outcomes: OUTCOMES
    },
    compose: {
      title: "cmp_title",
      entry: "the Outreach tab, email path",
      steps: ["write", "check", "send"],
      back: "modalBack",
      close: "modalClose",
      completion: "the message is sent and enters the mail ledger, or it is not",
      outcomes: OUTCOMES
    },
    upload_kind: {
      title: "tpl_upload_h",
      entry: "the Library upload control",
      steps: ["read", "decide", "save"],
      back: "modalBack",
      close: "modalClose",
      completion: "one sentence saying what was decided and where it went",
      outcomes: OUTCOMES
    },
    intake_batch: {
      title: "in_batch_h2",
      entry: "the Library import control",
      steps: ["read", "report", "write"],
      back: "modalBack",
      close: "modalClose",
      completion: "the report is shown and the chosen records are written",
      outcomes: OUTCOMES
    },
    reply_repair: {
      title: "rp_repair_btn",
      entry: "Settings, Replies",
      steps: ["count", "confirm", "write"],
      back: "modalBack",
      close: "modalClose",
      completion: "the count is reported, then written or abandoned",
      outcomes: OUTCOMES
    }
  };

  function names() { return Object.keys(FLOWS); }
  function get(name) { return FLOWS[name] || null; }

  /* A flow not in the registry does not open. This is the enforcement, and it
     returns a reason rather than a boolean so the caller can say why. */
  function canOpen(name) {
    var f = get(name);
    if (!f) return { ok: false, why: "not registered: " + String(name) };
    var bad = problems(name);
    if (bad.length) return { ok: false, why: bad.join("; ") };
    return { ok: true };
  }

  /* What is wrong with a declaration, in words. The build gate prints these. */
  function problems(name) {
    var f = get(name), out = [];
    if (!f) return ["not registered"];
    if (!f.entry) out.push("no entry");
    if (!f.steps || !f.steps.length) out.push("no steps");
    if (!f.back) out.push("no back");
    if (!f.close) out.push("no close");
    if (!f.completion) out.push("no defined completion");
    if (!f.outcomes || OUTCOMES.some(function (o) { return f.outcomes.indexOf(o) < 0; })) {
      out.push("does not declare all three outcomes");
    }
    return out;
  }

  function audit() {
    var bad = [];
    names().forEach(function (n) {
      var p = problems(n);
      if (p.length) bad.push(n + ": " + p.join(", "));
    });
    return { ok: !bad.length, problems: bad, count: names().length };
  }

  /* ---- every action ends somewhere --------------------------------------- */

  /* One shape for the end of an action, so no caller can invent a fourth. A
     result with no outcome is the silent success this exists to prevent. */
  function result(outcome, message, detail) {
    if (OUTCOMES.indexOf(outcome) < 0) {
      throw new Error("unknown outcome: " + String(outcome));
    }
    return { outcome: outcome, message: String(message || ""), detail: detail };
  }

  /* Every network call has a timeout and a STATED failure. A rejection with no
     message is a spinner with extra steps. */
  function withTimeout(promise, ms, label) {
    ms = ms || DEFAULT_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        var e = new Error(String(label || "request") + " timed out after " + ms + "ms");
        e.timeout = true;
        reject(e);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (e && !e.message) e = new Error(String(label || "request") + " failed");
        reject(e);
      });
    });
  }

  function selfTest() {
    var f = [];
    var a = audit();
    if (!a.ok) f.push("every registered flow must be complete: " + a.problems.join(" | "));
    if (a.count < 6) f.push("the registry is thinner than the console, got " + a.count);

    if (canOpen("opportunity").ok !== true) f.push("a complete flow must open");
    if (canOpen("nothing-like-this").ok !== false) f.push("an unregistered flow must not open");
    if (!/not registered/.test(canOpen("nope").why || "")) f.push("and it must say why");

    /* The gate, proven by breaking one. */
    var saved = FLOWS.compose.back;
    FLOWS.compose.back = "";
    if (audit().ok) f.push("a flow with no back must fail the audit");
    if (canOpen("compose").ok) f.push("and must not open");
    FLOWS.compose.back = saved;
    var saved2 = FLOWS.compose.completion;
    FLOWS.compose.completion = "";
    if (audit().ok) f.push("a flow with no completion must fail the audit");
    FLOWS.compose.completion = saved2;
    if (!audit().ok) f.push("and the registry must be clean again afterwards");

    try { result("maybe", "x"); f.push("a fourth outcome must throw"); } catch (e) {}
    var r = result("failure", "the relay did not answer");
    if (r.outcome !== "failure" || !r.message) f.push("a result must carry its message");

    return { pass: !f.length, failures: f };
  }

  return {
    OUTCOMES: OUTCOMES,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    FLOWS: FLOWS,
    names: names, get: get, canOpen: canOpen, problems: problems, audit: audit,
    result: result, withTimeout: withTimeout,
    selfTest: selfTest
  };
});
