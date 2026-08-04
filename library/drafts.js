/* Work that survives a dismissal.
   =========================================================================

   Losing a draft by tapping outside the window was the most common frustration
   in the review. A dismissed dialogue took the work with it, there was no memory
   and there was no way back.

   The rule: NOTHING A PERSON TYPED DISAPPEARS BECAUSE A FINGER LANDED OUTSIDE A
   BOX.

   Thirty minutes, not ten. Ten was the shortest interval the review named and
   the cost of thirty is a few kilobytes.

   DEVICE LOCAL, AND DELIBERATELY SO. A half written message is not a decision,
   and a half written message arriving on another device is a half written
   message you did not ask for there. This module never touches SYNCED_KEYS.

   Pure apart from one storage adapter passed in, so the expiry arithmetic and
   the keying are testable without a browser. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThriveDrafts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "thrive_flow_drafts_v1";
  var TTL_MS = 30 * 60 * 1000;
  var DEBOUNCE_MS = 400;

  /* The store is injected so this can be exercised in node. In the browser it is
     localStorage, and it is NOT in SYNCED_KEYS. */
  var store = (typeof localStorage !== "undefined") ? localStorage : null;
  function setStore(s) { store = s; }

  function read() {
    try { return JSON.parse((store && store.getItem(KEY)) || "{}"); }
    catch (e) { return {}; }
  }
  function write(o) {
    try { if (store) store.setItem(KEY, JSON.stringify(o)); return true; }
    catch (e) { return false; }
  }

  /* Keyed by flow AND by opportunity, so a message half written for one prospect
     never reappears under another. A flow with no opportunity keys on the flow
     alone, which is correct for the ones that have no subject. */
  function keyOf(flow, slug) { return String(flow || "") + "|" + String(slug || ""); }

  /* Cleaned on load, so the store does not grow. An expired draft is not shown
     and is not kept: offering to restore something from last week is offering
     something the person has already moved past. */
  function clean(now) {
    now = now || Date.now();
    var all = read(), out = {}, dropped = 0;
    Object.keys(all).forEach(function (k) {
      var d = all[k];
      if (!d || typeof d !== "object") { dropped++; return; }
      if (now - (d.ts || 0) > TTL_MS) { dropped++; return; }
      out[k] = d;
    });
    if (dropped) write(out);
    return { kept: Object.keys(out).length, dropped: dropped };
  }

  function save(flow, slug, data, now) {
    now = now || Date.now();
    var all = read();
    all[keyOf(flow, slug)] = { ts: now, data: data };
    return write(all);
  }

  /* Returns null for an expired draft rather than the draft, so no caller has to
     remember to check the age. A caller that forgets restores last week's work
     over this morning's. */
  function load(flow, slug, now) {
    now = now || Date.now();
    var d = read()[keyOf(flow, slug)];
    if (!d) return null;
    if (now - (d.ts || 0) > TTL_MS) return null;
    return d;
  }

  function drop(flow, slug) {
    var all = read();
    delete all[keyOf(flow, slug)];
    return write(all);
  }

  /* How long ago, in whole minutes, for the band that says so. Zero minutes ago
     is "just now" to the caller, which reads better than "0 minutes ago". */
  function ageMinutes(d, now) {
    now = now || Date.now();
    return Math.max(0, Math.floor((now - ((d && d.ts) || 0)) / 60000));
  }

  /* A draft is only worth restoring if it actually holds something. An empty
     form autosaved on focus is not work, and offering to restore it teaches the
     reader to dismiss the band. */
  function isSubstantive(data) {
    if (!data || typeof data !== "object") return false;
    return Object.keys(data).some(function (k) {
      return String(data[k] == null ? "" : data[k]).trim().length > 0;
    });
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || DEBOUNCE_MS);
    };
  }

  function selfTest() {
    var f = [];
    var mem = {};
    /* The real store is put back at the end. Swapping it and walking away meant
       every draft written after a self test went into the test's memory and
       vanished on reload, which is the exact failure this module exists to
       prevent, caused by the test for it. */
    var prev = store;
    setStore({
      getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
      setItem: function (k, v) { mem[k] = v; }
    });

    var t0 = 1000000;
    save("compose", "wise", { body: "half a message" }, t0);
    var got = load("compose", "wise", t0 + 1000);
    if (!got || got.data.body !== "half a message") f.push("a draft must come back");

    if (load("compose", "other", t0 + 1000)) f.push("a draft must not leak to another opportunity");
    if (load("editor", "wise", t0 + 1000)) f.push("a draft must not leak to another flow");

    if (ageMinutes(got, t0 + 5 * 60000) !== 5) f.push("age in minutes, got " + ageMinutes(got, t0 + 5 * 60000));

    // thirty minutes, not ten
    if (!load("compose", "wise", t0 + 29 * 60000)) f.push("a draft must survive 29 minutes");
    if (load("compose", "wise", t0 + 31 * 60000)) f.push("a draft must not survive 31 minutes");

    // cleaned on load
    save("compose", "old", { body: "stale" }, t0 - 60 * 60000);
    var c = clean(t0 + 1000);
    if (c.dropped !== 1) f.push("the expired one must be cleaned, dropped " + c.dropped);
    if (c.kept !== 1) f.push("and the live one kept, kept " + c.kept);

    drop("compose", "wise");
    if (load("compose", "wise", t0 + 1000)) f.push("discard must remove it");

    if (isSubstantive({ a: "", b: "  " })) f.push("an empty form is not work");
    if (!isSubstantive({ a: "", b: "x" })) f.push("one filled field is work");
    if (isSubstantive(null)) f.push("nothing is not work");

    // the key never collides across flows and slugs
    if (keyOf("a", "b") === keyOf("ab", "")) f.push("keys must not collide");

    setStore(prev);
    return { pass: !f.length, failures: f };
  }

  return {
    KEY: KEY, TTL_MS: TTL_MS, DEBOUNCE_MS: DEBOUNCE_MS,
    setStore: setStore, keyOf: keyOf, clean: clean,
    save: save, load: load, drop: drop,
    ageMinutes: ageMinutes, isSubstantive: isSubstantive, debounce: debounce,
    selfTest: selfTest
  };
});
