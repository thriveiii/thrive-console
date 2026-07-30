/* Thrive prospect-page beacon — privacy-first, self-contained.
   Records an "open" event and dwell time for opp/<slug> pages.

   By default it only writes to same-origin localStorage (so the console's
   Insights page shows visits made from THIS browser — a live demo).

   For REAL cross-visitor analytics, set ENDPOINT below to a collector URL
   (a Google Apps Script Web App or any serverless endpoint that accepts a
   POST JSON body). Set the SAME url in the console → Insights → Data endpoint
   so the dashboard reads what the beacon writes.

   Set COLLECT_IP = true to also attach coarse IP + city/country via ipapi.co
   (this makes one external request from the visitor's browser). */
(function () {
  "use strict";
  var ENDPOINT = "";      // e.g. "https://script.google.com/macros/s/XXXX/exec"
  var COLLECT_IP = false; // true => enrich with IP/country (external request to ipapi.co)
  var HITS = "thrive_hits_v1";

  // Only count real, top-level opp/ page views — never editor/template previews,
  // gallery thumbnails, or any embedded iframe.
  try { if (window.top !== window.self) return; } catch (e) { return; }
  var m = location.pathname.match(/\/opp\/([^\/]+)/);
  if (!m) return;
  var slug = decodeURIComponent(m[1]);

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
  function send(ev) {
    pushLocal(ev);
    if (!ENDPOINT) return;
    try {
      var body = JSON.stringify(ev);
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      else fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
    } catch (e) {}
  }

  var openEv = {
    type: "open", slug: slug, ts: new Date().toISOString(), vid: VID,
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
    send({ type: "dwell", slug: slug, ts: new Date().toISOString(), vid: VID, ms: ms });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
})();
