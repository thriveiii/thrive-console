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

  /* Opens that answer a message: the number that means somebody read what you sent. The host
     resolves it, because only the host knows when each view happened. */
  function hostOpens(slug, ctx){
    if (ctx && ctx.opens && Object.prototype.hasOwnProperty.call(ctx.opens, slug)) {
      return ctx.opens[slug] || 0;
    }
    if (typeof global.opensForSlug === "function") return global.opensForSlug(slug);
    return 0;
  }

  /* Every recorded view of the page, whatever caused it. A page can be visited before anybody
     is written to, and that is worth showing; it is simply not an open. */
  function hostViews(slug, ctx){
    if (ctx && ctx.views && Object.prototype.hasOwnProperty.call(ctx.views, slug)) {
      return ctx.views[slug] || 0;
    }
    return hostOpens(slug, ctx);
  }

  /* One authority. When the host is present its effStage decides, and both the opens count and
     the send evidence this module resolved are handed to it, so an injected context reaches the
     same rule instead of a copy of it. The fallback below exists only for the standalone
     reference page, and it is written to give the same answers. */
  function hostEffStage(o, ctx){
    var op = hostOpens(o.slug, ctx);
    var send = (ctx && ctx.mail) ? sendInfo(o.slug, ctx, o) : undefined;
    if (typeof global.effStage === "function") return global.effStage(o, op, send);
    var declared = o.stage || "";
    if (declared && declared !== "sent") return declared;
    if (send === undefined) send = sendInfo(o.slug, ctx, o);
    if (!send.count) return hostIsLive(o) ? "live" : "draft";
    return op > 0 ? "opened" : "sent";
  }

  /* ---- send evidence ------------------------------------------------------
     "Sent" means a message actually left. The mail ledger proves that, and so
     does your own declaration on the record for a message sent elsewhere.
     sent_on does not: it is the day the page was made, it is filled in on every
     record, and treating it as a send put pages nobody had written to into the
     Sent lane and their page views into the Opened lane.                    */

  function sendInfo(slug, ctx, o){
    var first = "", last = "", count = 0;
    var log = (ctx && ctx.mail) || [];
    for (var i = 0; i < log.length; i++){
      var m = log[i];
      if (!m || m.opp !== slug) continue;
      if (m.direction === "in") continue;                                    // a reply is not a send
      if (m.status && m.status !== "sent" && m.status !== "copied") continue; // queued is not sent
      count++;
      var ts = String(m.ts || "");
      if (ts){
        if (!first || ts < first) first = ts;
        if (ts > last) last = ts;
      }
    }
    if (!count && o && o.stage === "sent")
      return { count: 1, first: o.sent_on || "", last: o.sent_on || "", declared: true };
    return { count: count, first: first, last: last };
  }

  /* ---- lane assignment ----------------------------------------------------
     Position is the whole claim this board makes, so a lane is never assigned
     by anything softer than evidence.                                       */

  function laneOf(o, ctx){
    if (!o) return null;
    if (o.archived) return null;

    var stage = hostEffStage(o, ctx);
    if (CLOSED.indexOf(stage) >= 0) return "closed";
    if (stage === "replied") return "replied";
    if (stage === "opened")  return "opened";
    if (stage === "sent")    return "sent";

    /* Nothing has gone out. It is a page that exists, or a page that does not. */
    return hostIsLive(o) ? "live" : "draft";
  }

  /* ---- age and stall ------------------------------------------------------
     The clock starts at the most recent thing that actually happened to this
     record: the last outbound message, else the send date, else the last local
     edit stamp. A record with no history at all has no age and cannot stall. */

  function lastTouch(o, ctx){
    var send = sendInfo(o.slug, ctx, o);
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
       is a queue of neglect, not a chronology of activity.

       Unless somebody has said otherwise. Dragging a card stamps an ord on every
       card in that lane, and an ord outranks the clock, because a person who has
       looked at the lane knows things the clock does not. Cards that arrive after
       the ordering have no ord and fall in below, still sorted by age, so a new
       arrival never silently jumps a queue somebody arranged by hand.          */
    LANES.forEach(function(k){
      lanes[k].sort(function(a,b){
        var ao = a.ord || 0, bo = b.ord || 0;
        if (ao && bo) return ao - bo;
        if (ao) return -1;
        if (bo) return 1;
        return b.age - a.age;
      });
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
      views: hostViews(o.slug, ctx),
      age: ageDays(o, ctx),
      /* Position somebody chose, when they chose one. Zero means nobody has. */
      ord: Number(o.ord) || 0,
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
      /* h is the record this board got wrong in production: a page made on a date, read three
         times, never emailed to anybody. It belongs in Live, and its views belong on it.    */
      { slug:"h", biz:"Read but unsent co", _local:false, sent_on:"2026-07-30" },
      { slug:"b", biz:"Live co",     _local:false, sent_on:"2026-07-30" },
      { slug:"c", biz:"Sent co",     _local:false, sent_on:"2026-07-01" },
      { slug:"d", biz:"Opened co",   _local:false, sent_on:"2026-07-20" },
      { slug:"e", biz:"Replied co",  _local:false, stage:"replied" },
      { slug:"f", biz:"Won co",      _local:false, stage:"won" },
      { slug:"g", biz:"Archived co", _local:false, archived:true }
    ];
    var ctx = {
      /* Both maps are given in full, so the test never falls through to whatever this
         browser happens to have collected. */
      opens: { a:0, b:0, c:0, d:4, e:0, f:0, g:0, h:0 },   // opens that answer a send
      views: { a:0, b:0, c:0, d:4, e:0, f:0, g:0, h:3 },   // every recorded view
      mail: [ { opp:"c", direction:"out", status:"sent", ts:iso(30) },
              { opp:"d", direction:"out", status:"sent", ts:iso(2)  } ]
    };
    var b = build(opps, ctx);
    var want = { draft:1, live:2, sent:1, opened:1, replied:1 };
    var fails = [];
    Object.keys(want).forEach(function(k){
      if (b.lanes[k].length !== want[k]) fails.push(k + " expected " + want[k] + " got " + b.lanes[k].length);
    });
    if (b.closed.won.length !== 1) fails.push("won expected 1 got " + b.closed.won.length);
    if (b.archived !== 1) fails.push("archived expected 1 got " + b.archived);
    if (!b.lanes.sent[0].stalled) fails.push("30 day old send should be stalled");
    if (!b.lanes.opened[0].hot) fails.push("4 opens should be hot");
    /* The rule this file exists to hold: no ledger send, no Sent lane and no Opened lane. */
    var h = b.lanes.live.filter(function(t){ return t.slug === "h"; })[0];
    if (!h) fails.push("a page with views and no send must sit in live");
    else {
      if (h.opens !== 0) fails.push("an unsent page has no opens, got " + h.opens);
      if (h.views !== 3) fails.push("an unsent page keeps its views, got " + h.views);
    }
    if (b.lanes.sent.concat(b.lanes.opened).some(function(t){ return t.slug === "h" || t.slug === "b"; }))
      fails.push("a record with no send reached a send lane");

    /* A hand order outranks the clock, and a card with no order falls in below. */
    var ordOpps = [
      { slug:"o1", biz:"One",   _local:false, sent_on:"2026-07-01", ord:2 },
      { slug:"o2", biz:"Two",   _local:false, sent_on:"2026-07-20", ord:1 },
      { slug:"o3", biz:"Three", _local:false, sent_on:"2026-06-01" }
    ];
    var ob = build(ordOpps, { opens:{o1:0,o2:0,o3:0}, views:{o1:0,o2:0,o3:0}, mail:[] });
    var order = ob.lanes.live.map(function(x){ return x.slug; }).join(",");
    /* o3 is the oldest, so age alone would put it first. It has no ord, so it does not. */
    if (order !== "o2,o1,o3") fails.push("hand order expected o2,o1,o3 got " + order);

    /* Evidence of a hand send is evidence of a send: the lane moves. */
    var manual = [{ slug:"m1", biz:"Form co", _local:false, sent_on:"2026-07-01" }];
    var mb = build(manual, { opens:{m1:0}, views:{m1:0},
      mail:[{ opp:"m1", direction:"out", status:"sent", provider:"manual", channel:"form", ts:iso(1) }] });
    if (mb.lanes.sent.length !== 1) fails.push("a hand send must move the lane to sent");

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
