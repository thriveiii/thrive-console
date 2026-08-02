/* ============================================================================
   Thrive Console · board derivation layer
   ----------------------------------------------------------------------------
   Pure. Reads nothing from storage, writes nothing to storage, touches no DOM.
   The host passes state in, this module returns lanes and counts.

   It deliberately delegates to the console's own helpers when they exist
   (effStage, isLive, opensForSlug, daysSince) instead of reimplementing them.
   Reimplementing would create a second authority on stage, and the two would
   drift the first time either changed. See MIGRATION.md I3.

   Written in the same plain-script style as the rest of the console. No modules,
   no build step, no dependencies.
   ============================================================================ */

(function(global){
  "use strict";

  var LANES = ["draft","live","sent","opened","replied"];
  var CLOSED = ["won","lost"];

  /* Follow-up threshold already lives in the console's needsFollowup at 3 days.
     Stall is a separate, longer signal: a record that has stopped moving.     */
  var STALL_DAYS = 10;

  /* ---- delegation helpers -------------------------------------------------
     Each returns the console's implementation when present, otherwise a
     conservative local fallback so the reference page can run standalone.  */

  function hostDaysSince(iso){
    if (typeof global.daysSince === "function") return global.daysSince(iso);
    if (!iso) return 0;
    var ms = Date.parse(String(iso).length === 10 ? iso + "T00:00:00Z" : iso);
    if (isNaN(ms)) return 0;
    return Math.floor((Date.now() - ms) / 86400000);
  }

  function hostIsLive(o){
    if (typeof global.isLive === "function") return global.isLive(o);
    return !o._local || !!o.published;
  }

  function hostOpens(slug, ctx){
    if (ctx && ctx.opens && Object.prototype.hasOwnProperty.call(ctx.opens, slug)) {
      return ctx.opens[slug] || 0;
    }
    if (typeof global.opensForSlug === "function") return global.opensForSlug(slug);
    return 0;
  }

  /* One authority. When the host is present its effStage decides, and the opens count this
     module resolved is handed to it, so an injected context reaches the same rule instead of
     a copy of it. The fallback below exists only for the standalone reference page. */
  function hostEffStage(o, ctx){
    var op = hostOpens(o.slug, ctx);
    if (typeof global.effStage === "function") return global.effStage(o, op);
    if ((!o.stage || o.stage === "sent") && op > 0) return "opened";
    return o.stage || "sent";
  }

  /* ---- send evidence ------------------------------------------------------
     "Sent" means a message actually left, not that a date field was filled in.
     The mail ledger is the authority. sent_on is accepted as a fallback for
     records created before the ledger existed.                              */

  function sendInfo(slug, ctx){
    var last = "", count = 0;
    var log = (ctx && ctx.mail) || [];
    for (var i = 0; i < log.length; i++){
      var m = log[i];
      if (!m || m.opp !== slug) continue;
      if (m.direction === "in") continue;
      count++;
      if (!last || String(m.ts) > String(last)) last = m.ts;
    }
    return { count: count, last: last };
  }

  /* ---- lane assignment ---------------------------------------------------- */

  function laneOf(o, ctx){
    if (!o) return null;
    if (o.archived) return null;

    var stage = hostEffStage(o, ctx);
    if (CLOSED.indexOf(stage) >= 0) return "closed";
    if (stage === "replied") return "replied";
    if (stage === "opened")  return "opened";

    /* stage is "sent" from here down, which is also the default for a record
       that has never been touched. Split it by real evidence.               */
    var live = hostIsLive(o);
    if (!live) return "draft";

    var send = sendInfo(o.slug, ctx);
    if (send.count > 0 || o.sent_on) return "sent";
    return "live";
  }

  /* ---- age and stall ------------------------------------------------------
     The clock starts at the most recent thing that actually happened to this
     record: the last outbound message, else the send date, else the last local
     edit stamp. A record with no history at all has no age and cannot stall. */

  function lastTouch(o, ctx){
    var send = sendInfo(o.slug, ctx);
    if (send.last) return send.last;
    if (o.sent_on) return o.sent_on;
    if (o.up) return new Date(o.up).toISOString();
    return "";
  }

  function ageDays(o, ctx){
    var t = lastTouch(o, ctx);
    return t ? hostDaysSince(t) : 0;
  }

  function isStalled(o, ctx){
    var lane = laneOf(o, ctx);
    if (lane !== "sent" && lane !== "live" && lane !== "opened") return false;
    return ageDays(o, ctx) >= STALL_DAYS;
  }

  /* A repeat-open record is the strongest live signal on the board. */
  function isHot(o, ctx){
    return laneOf(o, ctx) === "opened" && hostOpens(o.slug, ctx) >= 2;
  }

  /* ---- board assembly ----------------------------------------------------- */

  function build(opps, ctx){
    ctx = ctx || {};
    var lanes = {}, closed = { won: [], lost: [] }, archived = 0;
    LANES.forEach(function(k){ lanes[k] = []; });

    (opps || []).forEach(function(o){
      if (o.archived){ archived++; return; }
      var lane = laneOf(o, ctx);
      if (lane === "closed"){
        var s = hostEffStage(o, ctx);
        closed[s === "won" ? "won" : "lost"].push(o);
        return;
      }
      if (!lane) return;
      lanes[lane].push(decorate(o, lane, ctx));
    });

    /* Within a lane, the thing that has waited longest comes first. The board
       is a queue of neglect, not a chronology of activity.                   */
    LANES.forEach(function(k){
      lanes[k].sort(function(a,b){ return b.age - a.age; });
    });

    return { lanes: lanes, closed: closed, archived: archived, summary: summary(lanes, closed) };
  }

  function decorate(o, lane, ctx){
    return {
      slug: o.slug,
      /* The package documents this field as biz. The shipped console writes business, and
         the live file wins: read both, fall back to the slug. */
      biz: o.business || o.biz || o.slug,
      lane: lane,
      stage: hostEffStage(o, ctx),
      opens: hostOpens(o.slug, ctx),
      age: ageDays(o, ctx),
      stalled: isStalled(o, ctx),
      hot: isHot(o, ctx),
      provisional: lane === "draft" && !o.published,
      raw: o
    };
  }

  function summary(lanes, closed){
    var stalled = 0, total = 0;
    LANES.forEach(function(k){
      total += lanes[k].length;
      lanes[k].forEach(function(t){ if (t.stalled) stalled++; });
    });
    return {
      total: total,
      stalled: stalled,
      waiting: lanes.opened.length + lanes.replied.length,
      counts: {
        draft: lanes.draft.length,
        live: lanes.live.length,
        sent: lanes.sent.length,
        opened: lanes.opened.length,
        replied: lanes.replied.length,
        won: closed.won.length,
        lost: closed.lost.length
      }
    };
  }

  /* ---- verdict ------------------------------------------------------------
     One sentence, chosen by priority, never a stack of sentences. The console
     says one thing at a time. IDENTITY §9.2.
     Returns a key plus values, so the caller renders it through I18N.       */

  function verdict(board){
    var s = board.summary;
    if (s.counts.replied > 0) return { key: "vd_replied", n: s.counts.replied };
    if (s.counts.opened  > 0) return { key: "vd_opened",  n: s.counts.opened };
    if (s.stalled        > 0) return { key: "vd_stalled", n: s.stalled };
    if (s.counts.live    > 0) return { key: "vd_live",    n: s.counts.live };
    if (s.total          > 0) return { key: "vd_quiet",   n: s.total };
    return { key: "vd_empty", n: 0 };
  }

  /* ---- self test ----------------------------------------------------------
     Runs only when the host asks. Never on a normal load. Asserts lane
     assignment against synthetic records with known answers.               */

  function selfTest(){
    var now = Date.now();
    var iso = function(d){ return new Date(now - d * 86400000).toISOString(); };
    var opps = [
      { slug:"a", biz:"Draft co",    _local:true,  published:false },
      { slug:"b", biz:"Live co",     _local:false },
      { slug:"c", biz:"Sent co",     _local:false, sent_on:"2026-07-01" },
      { slug:"d", biz:"Opened co",   _local:false, sent_on:"2026-07-20" },
      { slug:"e", biz:"Replied co",  _local:false, stage:"replied" },
      { slug:"f", biz:"Won co",      _local:false, stage:"won" },
      { slug:"g", biz:"Archived co", _local:false, archived:true }
    ];
    var ctx = { opens:{ d:4 }, mail:[ { opp:"c", direction:"out", ts:iso(30) } ] };
    var b = build(opps, ctx);
    var want = { draft:1, live:1, sent:1, opened:1, replied:1 };
    var fails = [];
    Object.keys(want).forEach(function(k){
      if (b.lanes[k].length !== want[k]) fails.push(k + " expected " + want[k] + " got " + b.lanes[k].length);
    });
    if (b.closed.won.length !== 1) fails.push("won expected 1 got " + b.closed.won.length);
    if (b.archived !== 1) fails.push("archived expected 1 got " + b.archived);
    if (!b.lanes.sent[0].stalled) fails.push("30 day old send should be stalled");
    if (!b.lanes.opened[0].hot) fails.push("4 opens should be hot");
    return { pass: fails.length === 0, fails: fails };
  }

  /* Runs only when the URL asks for it, never on a normal load. */
  if (typeof global.location !== "undefined" && /selftest/.test(global.location.hash || "")) {
    setTimeout(function(){
      var r = selfTest();
      console[r.pass ? "log" : "error"]("ThriveBoard selfTest", r);
      global.__thriveBoardSelfTest = r;
    }, 0);
  }

  global.ThriveBoard = {
    LANES: LANES,
    CLOSED: CLOSED,
    STALL_DAYS: STALL_DAYS,
    laneOf: laneOf,
    ageDays: ageDays,
    isStalled: isStalled,
    isHot: isHot,
    build: build,
    verdict: verdict,
    selfTest: selfTest
  };

})(typeof window !== "undefined" ? window : this);
