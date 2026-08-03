/* ============================================================================
   Thrive Console · every number, once

   One function per quantity. Every surface calls the function. No surface
   computes anything locally.

   This exists because three surfaces once gave three answers to one question:
   the Insights page said 2 opens and 8 views, the board said one card with 2
   opens and another with 5 views, and an earlier capture of the same data said
   5 opens in total. None of them was buggy on its own. They were parallel
   counters, which is a design that produces disagreement as a matter of course.

   ---------------------------------------------------------------------------
   THE TWO WAYS A NUMBER GOES WRONG QUIETLY
   ---------------------------------------------------------------------------
   Double counting: a refresh read as a second open, a resend mutating an entry
   rather than adding one, a sync merging by content instead of by id.

   Truncation: the ledgers are capped, and anything counted by scanning a capped
   log becomes wrong at the moment of truncation without throwing. The number
   simply starts being smaller than the truth, which is the worst failure a
   number can have, because it still looks like a number.

   Definitions live in docs/NUMBERS.md and are duplicated nowhere.
   ============================================================================ */
(function (global) {
  "use strict";

  function arr(v) { return Array.isArray(v) ? v : []; }
  function ymOf(ts) { return String(ts || "").slice(0, 7); }      // YYYY-MM
  function dayOf(ts) { return String(ts || "").slice(0, 10); }

  /* The local day and month. Local rather than UTC on purpose: a send made at
     nine in the evening in Alexandria belongs to that evening, not to the next
     morning in London, and a month boundary read in the wrong zone moves a
     day's work into the wrong month once every month. */
  function localDay(d) {
    d = d || new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function localMonth(d) { return localDay(d).slice(0, 7); }

  /* A ledger timestamp is an ISO string in UTC, so it is converted before it is
     compared to a local day. Comparing the first ten characters of a UTC stamp
     to a local date is the bug this avoids. */
  function localDayOfStamp(ts) {
    if (!ts) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;    // already a plain local date
    var d = new Date(ts);
    return isNaN(d.getTime()) ? "" : localDay(d);
  }

  /* ---- the ledgers, as given -------------------------------------------
     ctx = { mail, hits, opps, activity, rollup }. Nothing is read from storage
     here: the host owns storage, this owns arithmetic. */

  /* Every recorded view of a page, including previews from this browser. */
  function views(ctx, slug) {
    return arr(ctx.hits).filter(function (h) {
      return h && (!slug || h.slug === slug);
    }).length;
  }

  /* Views that were not this browser's own preview. The self marker is written
     by the console when it opens its own page, and it is the only thing that
     separates an open from a look. */
  function openHits(ctx, slug) {
    return arr(ctx.hits).filter(function (h) {
      return h && !h.self && (!slug || h.slug === slug);
    });
  }
  function opens(ctx, slug) { return openHits(ctx, slug).length; }

  function uniqueOpens(ctx, slug) {
    var seen = {};
    openHits(ctx, slug).forEach(function (h) { if (h.vid) seen[h.vid] = 1; });
    return Object.keys(seen).length;
  }

  /* ---- sends -------------------------------------------------------------
     A mail ledger row and a hand contact are both sends. The console witnessed a
     relay's answer in one case and your word in the other, and it records which,
     but neither is a reason to leave a card out of a total. */
  function outbound(ctx) {
    var out = [];
    arr(ctx.mail).forEach(function (m) {
      if (!m || m.direction === "in") return;
      if (m.status && m.status !== "sent" && m.status !== "copied") return;
      out.push({ id: m.mid || (m.to + "|" + m.subject + "|" + m.ts), to: m.to || "",
                 day: localDayOfStamp(m.ts), kind: m.provider === "manual" ? "manual" : "mail" });
    });
    arr(ctx.opps).forEach(function (o) {
      arr(o && o.manual_contacts).forEach(function (c) {
        if (!c || !c.sent_on) return;
        out.push({ id: c.id || (o.slug + "|" + c.sent_on), to: c.url || c.channel || o.slug,
                   day: dayOf(c.sent_on), kind: "manual" });
      });
    });
    /* By id, so a record present on two devices appears once and a double sync
       changes nothing. This is the whole of the idempotency guarantee. */
    var seen = {}, uniq = [];
    out.forEach(function (x) { if (seen[x.id]) return; seen[x.id] = 1; uniq.push(x); });
    return uniq;
  }

  function sentToday(ctx) {
    var d = ctx.today || localDay();
    return outbound(ctx).filter(function (x) { return x.day === d; }).length;
  }

  /* The current month reads the live ledger. Earlier months read the rollup,
     which is never truncated. A month that is still open cannot be in the
     rollup, and a month that has closed must never be recounted from a log that
     may since have lost its head. */
  function sentMonth(ctx, ym) {
    var want = ym || ctx.month || localMonth();
    var cur = ctx.month || localMonth();
    if (want !== cur) {
      var r = (ctx.rollup || {})[want];
      return r ? (r.sent || 0) : 0;
    }
    return outbound(ctx).filter(function (x) { return ymOf(x.day) === want; }).length;
  }

  function peopleContacted(ctx) {
    var seen = {};
    outbound(ctx).forEach(function (x) { if (x.to) seen[String(x.to).toLowerCase()] = 1; });
    return Object.keys(seen).length;
  }

  function replies(ctx) {
    var n = 0, seen = {};
    arr(ctx.mail).forEach(function (m) {
      if (!m) return;
      if (m.direction !== "in" && m.status !== "replied") return;
      var id = m.mid || (m.to + "|" + m.ts);
      if (seen[id]) return;
      seen[id] = 1; n++;
    });
    /* A reply recorded by hand through the lifecycle counts too, and is counted
       once per opportunity rather than once per activity row, because the log
       keeps the correction as well as the original. */
    var byOpp = {};
    arr(ctx.activity).forEach(function (a) {
      if (a && a.action === "lc_record_reply" && a.slug) byOpp[a.slug] = 1;
    });
    arr(ctx.mail).forEach(function (m) {
      if (m && (m.direction === "in" || m.status === "replied") && m.opp) delete byOpp[m.opp];
    });
    return n + Object.keys(byOpp).length;
  }

  /* A rate is a share of something, so it cannot exceed the whole and it is
     never shown without its denominator. An open rate once printed 200% by
     dividing unique visitors by people written to. */
  function replyRate(ctx) {
    var d = peopleContacted(ctx);
    if (!d) return { pct: 0, num: 0, den: 0 };
    var n = replies(ctx);
    return { pct: Math.min(100, Math.round((n / d) * 100)), num: n, den: d };
  }

  function needsFollowup(ctx, days) {
    var thr = days || 3;
    var today = ctx.today || localDay();
    var out = [];
    arr(ctx.opps).forEach(function (o) {
      if (!o || o.archived) return;
      var sends = outbound({ mail: arr(ctx.mail).filter(function (m) { return m && m.opp === o.slug; }),
                             opps: [o] });
      if (!sends.length) return;
      if (opens(ctx, o.slug) > 0) return;
      var last = sends.map(function (x) { return x.day; }).sort().pop();
      if (!last) return;
      var age = Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(last + "T00:00:00Z")) / 86400000);
      if (age >= thr) out.push(o.slug);
    });
    return out;
  }

  /* ---- the monthly rollup -------------------------------------------------
     Written when a month closes and never again. Historical numbers read it, so
     they stop depending on a log that is allowed to forget its head. */
  function buildRollup(ctx, existing) {
    var out = Object.assign({}, existing || {});
    var cur = ctx.month || localMonth();
    var byMonth = {};
    outbound(ctx).forEach(function (x) {
      var m = ymOf(x.day);
      if (!m || m >= cur) return;                     // the open month is never rolled up
      byMonth[m] = byMonth[m] || { sent: 0, people: {} };
      byMonth[m].sent++;
      if (x.to) byMonth[m].people[String(x.to).toLowerCase()] = 1;
    });
    Object.keys(byMonth).forEach(function (m) {
      /* Written once. A month already in the rollup is not recounted, because
         the log it would be recounted from may since have been truncated and the
         smaller answer would silently replace the true one. */
      if (out[m]) return;
      out[m] = { sent: byMonth[m].sent, people: Object.keys(byMonth[m].people).length, closed: true };
    });
    return out;
  }

  /* ---- self test ---------------------------------------------------------- */
  function selfTest() {
    var f = [];
    var ctx = {
      today: "2026-08-03", month: "2026-08",
      hits: [ { slug: "a", vid: "v1", ts: "2026-08-01T10:00:00Z" },
              { slug: "a", vid: "v1", ts: "2026-08-01T10:00:30Z" },
              { slug: "a", vid: "v2", ts: "2026-08-02T10:00:00Z" },
              { slug: "a", vid: "me", self: true, ts: "2026-08-02T11:00:00Z" } ],
      mail: [ { mid: "m1", opp: "a", to: "one@x.example", direction: "out", status: "sent", ts: "2026-08-03T09:00:00Z" },
              { mid: "m2", opp: "b", to: "two@x.example", direction: "out", status: "sent", ts: "2026-07-15T09:00:00Z" },
              { mid: "m3", opp: "a", to: "one@x.example", direction: "in", status: "replied", ts: "2026-08-03T12:00:00Z" } ],
      opps: [ { slug: "a" },
              { slug: "c", manual_contacts: [ { id: "c1", channel: "web_form", sent_on: "2026-08-03" } ] } ],
      activity: [], rollup: {}
    };

    if (views(ctx, "a") !== 4) f.push("views counts every hit, got " + views(ctx, "a"));
    if (opens(ctx, "a") !== 3) f.push("opens excludes the self marker, got " + opens(ctx, "a"));
    if (uniqueOpens(ctx, "a") !== 2) f.push("unique opens counts visitors, got " + uniqueOpens(ctx, "a"));

    /* an off channel send counts exactly as an email does */
    if (sentToday(ctx) !== 2) f.push("today counts the email and the hand contact, got " + sentToday(ctx));
    if (peopleContacted(ctx) !== 3) f.push("people contacted spans both ledgers, got " + peopleContacted(ctx));
    if (replies(ctx) !== 1) f.push("replies, got " + replies(ctx));
    var rr = replyRate(ctx);
    if (rr.den !== 3 || rr.num !== 1) f.push("reply rate must carry its denominator, got " + JSON.stringify(rr));
    if (rr.pct > 100) f.push("a rate cannot exceed the whole");

    /* idempotency: the same batch twice changes nothing */
    var doubled = Object.assign({}, ctx, {
      mail: ctx.mail.concat(ctx.mail.map(function (m) { return Object.assign({}, m); })),
      opps: ctx.opps.map(function (o) {
        return o.manual_contacts
          ? Object.assign({}, o, { manual_contacts: o.manual_contacts.concat(o.manual_contacts.map(function (c) { return Object.assign({}, c); })) })
          : o;
      })
    });
    if (sentToday(doubled) !== sentToday(ctx)) f.push("a double sync moved sent_today");
    if (peopleContacted(doubled) !== peopleContacted(ctx)) f.push("a double sync moved people_contacted");
    if (replies(doubled) !== replies(ctx)) f.push("a double sync moved replies");

    /* the rollup, and the truncation it exists for */
    var roll = buildRollup(ctx, {});
    if (!roll["2026-07"] || roll["2026-07"].sent !== 1) f.push("july must roll up, got " + JSON.stringify(roll["2026-07"]));
    if (roll["2026-08"]) f.push("the open month must never be rolled up");
    /* now truncate the log the way a cap does, and the closed month must not move */
    var cut = Object.assign({}, ctx, { mail: ctx.mail.filter(function (m) { return m.ts >= "2026-08"; }) });
    if (sentMonth(cut, "2026-07") !== 0) f.push("without a rollup a truncated month reads zero, which is the defect");
    var withRoll = Object.assign({}, cut, { rollup: roll });
    if (sentMonth(withRoll, "2026-07") !== 1)
      f.push("with the rollup a truncated month still reads true, got " + sentMonth(withRoll, "2026-07"));
    var re = buildRollup(cut, roll);
    if (re["2026-07"].sent !== 1) f.push("a month already rolled up must never be recounted from a shorter log");

    /* follow-up */
    var fu = needsFollowup({ today: "2026-08-20", mail: ctx.mail, opps: [{ slug: "b" }], hits: [] }, 3);
    if (fu.indexOf("b") < 0) f.push("an old send with no opens needs following up");
    var fu2 = needsFollowup({ today: "2026-08-20", mail: ctx.mail, opps: [{ slug: "a" }], hits: ctx.hits }, 3);
    if (fu2.indexOf("a") >= 0) f.push("a page that was opened does not need following up");

    return { pass: f.length === 0, fails: f };
  }

  global.ThriveNumbers = {
    localDay: localDay, localMonth: localMonth, localDayOfStamp: localDayOfStamp,
    views: views, opens: opens, uniqueOpens: uniqueOpens,
    outbound: outbound, sentToday: sentToday, sentMonth: sentMonth,
    peopleContacted: peopleContacted, replies: replies, replyRate: replyRate,
    needsFollowup: needsFollowup, buildRollup: buildRollup,
    selfTest: selfTest
  };
})(typeof window !== "undefined" ? window : this);
