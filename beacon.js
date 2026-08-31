/* Thrive prospect-page beacon: privacy-first, self-contained.
   Records an "open" event and dwell time for opp/<slug> pages.

   Where the data goes:
     • Always to same-origin localStorage (so a page you open yourself is visible instantly).
     • And, when live sync is configured, to the Thrive relay, the SAME Apps Script that sends
       your email. That is what makes recipient opens real: without it an open only ever exists
       in the visitor's own browser and never reaches your console.
   The endpoint is discovered automatically from /library/sync.json, so there is nothing to configure here.

   Self-visits are tagged (self:true) when the viewer is the console operator (their browser
   holds an unlocked console session), so your own previews never inflate campaign numbers.

   Set COLLECT_IP = true to also attach coarse IP + city/country via ipapi.co
   (this makes one external request from the visitor's browser). */
(function () {
  "use strict";
  var COLLECT_IP = false; // true => enrich with IP/country (external request to ipapi.co)
  var HITS = "thrive_hits_v1";
  var EP_CACHE = "thrive_beacon_ep";

  // Only count real, top-level opp/ page views, never editor/template previews,
  // gallery thumbnails, or any embedded iframe.
  try { if (window.top !== window.self) return; } catch (e) { return; }
  var m = location.pathname.match(/\/opp\/([^\/]+)/);
  if (!m) return;
  var slug = decodeURIComponent(m[1]);

  // The per-recipient token: a tokenized page link (liveUrl?r=<mail_id>) carries r so a visit can be
  // attributed to one recipient (console_hits.data.r -> console_mail.id -> to_addr). Absent it, the visit
  // stays an anonymous, campaign-level view, never guessed onto a person.
  function tokenR() {
    try { return (new URLSearchParams(location.search)).get("r") || ""; } catch (e) { return ""; }
  }
  var R = tokenR();

  // The transit cycle: the console stamps <meta name="thrive-cycle"> into the published page (the same publish
  // that injects this beacon), so an open can be attributed to the CURRENT transit and an old transit's opens
  // never inherit onto a re-uploaded card. The cycle is NOT in the URL, so it must be read from the page. An old
  // page has no such meta -> we send no cycle (null), never guessed: the console treats null as legacy.
  function pageCycle() {
    try { var m = document.querySelector('meta[name="thrive-cycle"]'); var c = m && m.getAttribute("content"); return c ? String(c) : ""; }
    catch (e) { return ""; }
  }
  var CYCLE = pageCycle();

  // Is this the console operator (or a teammate) previewing their own page? Their browser holds a console
  // session on this same origin. Tagged, not dropped: the console filters it. Two signals, either suffices:
  //   1. console_sb_session in localStorage - the DURABLE, per-origin signed-in session (bundle.js SESSION_KEY,
  //      the same signal the gate trusts as signed-in, gate.js returning()). localStorage is shared across
  //      tabs and survives opening /opp/<slug> DIRECTLY, so an owner preview outside the console tab is caught.
  //   2. thrive_gate_v2 in sessionStorage - the per-tab gate marker (kept for the in-console preview case).
  // The old code checked ONLY (2), so an owner opening the page directly (a fresh tab with empty
  // sessionStorage) was scored self=false and counted as a real open.
  function isSelf() {
    try { if (localStorage.getItem("console_sb_session")) return true; } catch (e) {}
    try { return !!sessionStorage.getItem("thrive_gate_v2"); } catch (e) { return false; }
  }
  var SELF = isSelf();

  function vid() {
    try {
      var v = localStorage.getItem("thrive_vid");
      if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem("thrive_vid", v); }
      return v;
    } catch (e) { return "anon"; }
  }
  var VID = vid();

  function pushLocal(ev) {
    try {
      var a = JSON.parse(localStorage.getItem(HITS) || "[]");
      a.push(ev); if (a.length > 2000) a = a.slice(-2000);
      localStorage.setItem(HITS, JSON.stringify(a));
    } catch (e) {}
  }
  function cachedEp() { try { return localStorage.getItem(EP_CACHE) || ""; } catch (e) { return ""; } }
  function post(ep, ev) {
    try {
      var body = JSON.stringify({ op: "hit", ev: ev });
      if (navigator.sendBeacon) navigator.sendBeacon(ep, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      else fetch(ep, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
    } catch (e) {}
  }
  var pending = [];
  function send(ev) {
    pushLocal(ev);
    var ep = cachedEp();
    if (ep) { post(ep, ev); return; }
    pending.push(ev);                       // hold until the endpoint resolves
  }
  // Discover the relay once, then flush anything queued.
  (function resolveEndpoint() {
    if (cachedEp()) return;
    try {
      fetch("/library/sync.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ep = j && j.ep;
          if (!ep) return;
          try { localStorage.setItem(EP_CACHE, ep); } catch (e) {}
          while (pending.length) post(ep, pending.shift());
        })
        .catch(function () {});
    } catch (e) {}
  })();

  var openEv = {
    type: "open", slug: slug, ts: new Date().toISOString(), vid: VID, self: SELF, r: R,
    cycle: CYCLE || null,
    ref: document.referrer || "", lang: navigator.language || "",
    w: (screen && screen.width) || 0, h: (screen && screen.height) || 0,
    ua: (navigator.userAgent || "").slice(0, 180)
  };

  if (COLLECT_IP && window.fetch) {
    fetch("https://ipapi.co/json/").then(function (r) { return r.json(); })
      .then(function (j) { openEv.ip = j.ip; openEv.city = j.city; openEv.country = j.country_name; send(openEv); })
      .catch(function () { send(openEv); });
  } else {
    send(openEv);
  }

  // dwell time (first time the page is backgrounded / closed)
  var start = Date.now(), done = false;
  function flush() {
    if (done) return; done = true;
    var ms = Date.now() - start; if (ms < 500) return;
    send({ type: "dwell", slug: slug, ts: new Date().toISOString(), vid: VID, self: SELF, cycle: CYCLE || null, ms: ms });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
})();
