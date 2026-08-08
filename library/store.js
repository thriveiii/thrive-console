/* One storage adapter, and the suppression list that protects the domain.
   =========================================================================

   WO-013 §10.4 and §10.5. Two things live here because both are seams: one is
   about where bytes go, the other about which addresses may ever be written to,
   and both are cheap now and expensive later.

   THE ADAPTER
   Every read and write goes through here. No feature code calls localStorage
   directly. With the adapter in place, moving to IndexedDB later is one file and
   moving built page HTML out of the synced blob is one decision. Without it,
   both are a rewrite.

   IndexedDB is deliberately NOT built in this phase. The seam is built, the
   usage is measured, and the threshold at which the migration becomes necessary
   is recorded in docs/RUNWAY.md.

   THE SUPPRESSION LIST
   Outreach goes out from hi@thriveiii.com, which is also the address clients
   reply to, invoices come from, and the newsroom and the website share. Cold
   outreach draws more spam complaints than any other category of mail. If
   outreach damages the reputation of thriveiii.com it does not only cost the
   next campaign, it costs client mail and invoices.

   At three sends a day this is not a volume problem. It is an asset being spent
   without measurement. Every guard here protects a small number of good sends
   rather than enabling a large number of mediocre ones. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThriveStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var backing = (typeof localStorage !== "undefined") ? localStorage : null;
  function setBacking(b) { backing = b; }

  /* The threshold at which IndexedDB stops being optional. Recorded here as well
     as in docs/RUNWAY.md so the number and the code cannot drift. */
  var MIGRATE_AT_BYTES = 3 * 1024 * 1024;
  var CEILING_BYTES = 5 * 1024 * 1024;

  function get(key, fallback) {
    try {
      var v = backing ? backing.getItem(key) : null;
      return v === null || v === undefined ? (fallback === undefined ? null : fallback) : v;
    } catch (e) { return fallback === undefined ? null : fallback; }
  }
  function getJSON(key, fallback) {
    var raw = get(key, null);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { if (backing) backing.setItem(key, value); return true; }
    catch (e) { return false; }
  }
  function setJSON(key, value) { return set(key, JSON.stringify(value)); }
  function remove(key) {
    try { if (backing) backing.removeItem(key); return true; } catch (e) { return false; }
  }
  function keys() {
    var out = [];
    try {
      for (var i = 0; i < backing.length; i++) out.push(backing.key(i));
    } catch (e) {}
    return out;
  }

  /* Measured, so the migration is decided on a number rather than a feeling. */
  function usage() {
    var total = 0, by = {};
    keys().forEach(function (k) {
      var v = get(k, "") || "";
      var n = (k.length + v.length) * 2;        // UTF-16 units, which is what the quota counts
      by[k] = n; total += n;
    });
    return {
      bytes: total,
      ceiling: CEILING_BYTES,
      pct: Math.min(100, Math.round(total / CEILING_BYTES * 100)),
      migrateAt: MIGRATE_AT_BYTES,
      shouldMigrate: total >= MIGRATE_AT_BYTES,
      top: Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })
        .slice(0, 6).map(function (k) { return { key: k, bytes: by[k] }; })
    };
  }

  /* ---------- the suppression list --------------------------------------- */

  var SUPPRESS = "thrive_suppress_v1";

  function norm(addr) { return String(addr || "").trim().toLowerCase(); }

  function list() { return getJSON(SUPPRESS, []) || []; }

  /* Permanent. There is no unsuppress, and that is the point: an address that
     complained once is an address that complains again, and the cost of never
     writing to it is one prospect against a domain reputation. */
  function suppress(addr, reason, when) {
    var a = norm(addr);
    if (!a) return false;
    var all = list();
    if (all.some(function (x) { return x.addr === a; })) return true;
    all.push({ addr: a, reason: String(reason || "unknown"), ts: when || new Date().toISOString() });
    return setJSON(SUPPRESS, all);
  }

  function isSuppressed(addr) {
    var a = norm(addr);
    return list().some(function (x) { return x.addr === a; });
  }
  function reasonFor(addr) {
    var a = norm(addr);
    var hit = list().filter(function (x) { return x.addr === a; })[0];
    return hit ? hit.reason : "";
  }

  /* Hard bounces suppress. Soft bounces retry ONCE and then stop. Today a bounce
     is invisible, which means a dead address is retried forever. */
  var SOFT = "thrive_soft_v1";
  function softCount(addr) {
    var m = getJSON(SOFT, {}) || {};
    return m[norm(addr)] || 0;
  }
  function noteBounce(addr, kind) {
    var a = norm(addr);
    if (!a) return { action: "ignored" };
    if (kind === "hard") { suppress(a, "hard_bounce"); return { action: "suppressed" }; }
    var m = getJSON(SOFT, {}) || {};
    m[a] = (m[a] || 0) + 1;
    setJSON(SOFT, m);
    if (m[a] >= 2) { suppress(a, "soft_bounce_twice"); return { action: "suppressed", after: m[a] }; }
    return { action: "retry_once", count: m[a] };
  }

  /* Honoured within two days, automatically. An unsubscribe converted from a
     spam complaint is the whole reason List-Unsubscribe costs nothing to add. */
  function unsubscribe(addr) { return suppress(addr, "unsubscribed"); }
  function complain(addr) { return suppress(addr, "complaint"); }

  /* ---------- the reputation numbers ------------------------------------- */

  /* Google's guidance is to stay below 0.1 percent and never reach 0.3. Those
     two numbers decide whether these are healthy, and the panel says so in a
     plain sentence rather than printing a rate and leaving the reader to judge. */
  var COMPLAINT_GOOD = 0.1, COMPLAINT_BAD = 0.3;

  function reputation(ctx) {
    ctx = ctx || {};
    var mail = Array.isArray(ctx.mail) ? ctx.mail : [];
    var month = ctx.month || "";
    var sent = 0, hard = 0, soft = 0, complaints = 0;
    mail.forEach(function (m) {
      if (!m || m.direction === "in") return;
      if (month && String(m.ts || "").slice(0, 7) !== month) return;
      if (m.status === "bounced_hard") { hard++; return; }
      if (m.status === "bounced_soft") { soft++; return; }
      if (m.status === "complaint") { complaints++; return; }
      sent++;
    });
    var denom = sent + hard + soft + complaints;
    var rate = function (n) { return denom ? Math.round((n / denom) * 1000) / 10 : 0; };
    var cRate = rate(complaints);
    var verdict = "rep_healthy";
    if (cRate >= COMPLAINT_BAD) verdict = "rep_bad";
    else if (cRate >= COMPLAINT_GOOD) verdict = "rep_watch";
    else if (rate(hard) >= 2) verdict = "rep_watch";
    return {
      sent: sent, hardBounces: hard, softBounces: soft, complaints: complaints,
      suppressed: list().length,
      hardRate: rate(hard), complaintRate: cRate,
      verdict: verdict, good: COMPLAINT_GOOD, bad: COMPLAINT_BAD
    };
  }

  /* ---------- the headers every outbound message carries ----------------- */

  /* RFC 8058. Not required at Thrive's volume and it costs nothing, and it
     converts a spam complaint into an unsubscribe, which is the difference
     between a reputation hit and a suppression. */
  function outboundHeaders(slug, domain) {
    var d = domain || "thriveiii.com";
    var tag = slug ? ("hi+" + slug + "@" + d) : ("hi@" + d);
    return {
      "List-Unsubscribe": "<mailto:" + "unsubscribe@" + d + "?subject=unsubscribe>, " +
                          "<https://" + d + "/unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Reply-To": tag
    };
  }

  /* The registered legal address, the single source of truth for every piece of outgoing mail. A valid
     physical postal address and a one line opt out are both required by US law for commercial email.
     This one constant is read by BOTH the HTML footer and the plain-text alternative below, so the
     address is written once and reused, and no country is ever inferred from a city name anywhere. */
  var POSTAL = "Thrive Digital Solutions, VA, USA";
  function footerHtml(lang) {
    var opt = (lang === "ar")
      ? "لا ترغب برسائل أخرى؟ ردّ بكلمة إيقاف وسنتوقف."
      : "Not interested in hearing from us? Reply STOP and we will stop.";
    return '<div style="margin-top:20px;padding-top:12px;border-top:1px solid #eee;' +
           'font-size:11px;color:#9aa0aa">' + POSTAL + '<br>' + opt + '</div>';
  }
  function footerText(lang) {
    var opt = (lang === "ar")
      ? "لا ترغب برسائل أخرى؟ ردّ بكلمة إيقاف وسنتوقف."
      : "Not interested in hearing from us? Reply STOP and we will stop.";
    return "\n\n" + POSTAL + "\n" + opt;
  }

  function selfTest() {
    var f = [];
    var mem = {};
    var prev = backing;
    setBacking({
      length: 0,
      getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
      setItem: function (k, v) { mem[k] = v; },
      removeItem: function (k) { delete mem[k]; },
      key: function (i) { return Object.keys(mem)[i]; }
    });

    // the adapter
    set("a", "1");
    if (get("a") !== "1") f.push("the adapter must store and return");
    if (get("missing", "d") !== "d") f.push("and fall back when nothing is there");
    setJSON("b", { x: 1 });
    if (getJSON("b", null).x !== 1) f.push("JSON round trip");
    if (getJSON("bad", "fb") !== "fb") f.push("unparseable JSON falls back");
    remove("a");
    if (get("a") !== null) f.push("remove must remove");

    // suppression is permanent and it blocks
    suppress("Owner@Example.COM", "complaint", "2026-08-01T00:00:00Z");
    if (!isSuppressed("owner@example.com")) f.push("suppression must normalise the address");
    if (reasonFor("owner@example.com") !== "complaint") f.push("and carry its reason");
    suppress("owner@example.com", "again");
    if (list().length !== 1) f.push("suppressing twice must not duplicate");
    if (isSuppressed("someone@else.example")) f.push("and must not catch an innocent address");

    // hard bounces suppress, soft bounces retry once then stop
    var r1 = noteBounce("dead@x.example", "hard");
    if (r1.action !== "suppressed") f.push("a hard bounce must suppress, got " + r1.action);
    var s1 = noteBounce("slow@x.example", "soft");
    if (s1.action !== "retry_once") f.push("a first soft bounce retries once, got " + s1.action);
    var s2 = noteBounce("slow@x.example", "soft");
    if (s2.action !== "suppressed") f.push("a second soft bounce stops, got " + s2.action);
    if (!isSuppressed("slow@x.example")) f.push("and suppresses it");

    // the headers
    var h = outboundHeaders("wise-butterfly");
    if (!/List-Unsubscribe/.test(Object.keys(h).join(","))) f.push("List-Unsubscribe must be present");
    if (h["List-Unsubscribe-Post"] !== "List-Unsubscribe=One-Click") f.push("RFC 8058 one click");
    if (h["Reply-To"].indexOf("hi+wise-butterfly@") !== 0) f.push("the reply-to tag, got " + h["Reply-To"]);

    if (footerHtml("en").indexOf("VA, USA") < 0) f.push("the correct registered address must be in the footer");
    if (footerHtml("en").indexOf("Egypt") >= 0) f.push("the footer must never say Egypt");
    if (footerText("en").indexOf("VA, USA") < 0) f.push("the plain-text alternative must carry the same address");
    if (footerText("en").indexOf("Egypt") >= 0) f.push("the plain-text alternative must never say Egypt");
    if (footerHtml("en").indexOf("STOP") < 0) f.push("and a one line opt out");
    if (footerText("ar").indexOf("إيقاف") < 0) f.push("and both in Arabic too");

    // the reputation verdict
    var clean = reputation({ mail: [{ ts: "2026-08-01", status: "sent" }, { ts: "2026-08-02", status: "sent" }] });
    if (clean.verdict !== "rep_healthy") f.push("two clean sends is healthy, got " + clean.verdict);
    var bad = reputation({ mail: [{ status: "complaint" }].concat(
      Array.from({ length: 99 }, function () { return { status: "sent" }; })) });
    if (bad.complaintRate !== 1) f.push("one complaint in a hundred is 1 percent, got " + bad.complaintRate);
    if (bad.verdict !== "rep_bad") f.push("and past 0.3 it is not healthy, got " + bad.verdict);

    // the migration threshold is a number, not a feeling
    if (MIGRATE_AT_BYTES !== 3 * 1024 * 1024) f.push("the threshold is 3 MiB");

    setBacking(prev);
    return { pass: !f.length, failures: f };
  }

  return {
    MIGRATE_AT_BYTES: MIGRATE_AT_BYTES, CEILING_BYTES: CEILING_BYTES,
    SUPPRESS_KEY: SUPPRESS, POSTAL: POSTAL,
    COMPLAINT_GOOD: COMPLAINT_GOOD, COMPLAINT_BAD: COMPLAINT_BAD,
    setBacking: setBacking,
    get: get, getJSON: getJSON, set: set, setJSON: setJSON, remove: remove, keys: keys,
    usage: usage,
    list: list, suppress: suppress, isSuppressed: isSuppressed, reasonFor: reasonFor,
    noteBounce: noteBounce, softCount: softCount, unsubscribe: unsubscribe, complain: complain,
    reputation: reputation, outboundHeaders: outboundHeaders,
    footerHtml: footerHtml, footerText: footerText,
    selfTest: selfTest
  };
});
