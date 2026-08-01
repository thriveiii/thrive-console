/* Thrive Console — access gate (client-side, hardened).
   The passcode is verified with PBKDF2-SHA256 at 120,000 iterations (offline guessing
   against the public verifier is ~120,000× costlier than a plain hash), and repeated
   wrong attempts trigger an escalating lockout. Unlocking also derives the cross-device
   sync credential — so the passcode alone opens the full live console on any device.
   NOTE: a static site on a public repo is still not a server-side boundary; the public
   opp/ result pages are intentionally open so prospects can view shared links. */
(function () {
  "use strict";
  var KEY = "thrive_gate_v2";
  var SYNC_KEY = "thrive_sync_auth";
  var FAILS = "thrive_gate_fails";
  var ITER = 120000;
  var GATE_SALT = "thrive-gate-v2";
  var SYNC_SALT = "thrive-sync-v2";
  var HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8"; // PBKDF2(passcode, thrive-gate-v2, 120k)

  var STR = {
    en: { title: "Thrive Console", sub: "Private workspace. Enter the passcode to continue.",
          ph: "Passcode", go: "Unlock", err: "Incorrect passcode. Try again.",
          wait: "Too many attempts. Try again in ",
          note: "Prospect result pages stay public — only the console is protected." },
    ar: { title: "كونسول ثرايف", sub: "مساحة خاصة. أدخل رمز الدخول للمتابعة.",
          ph: "رمز الدخول", go: "فتح", err: "رمز غير صحيح. حاول مجددًا.",
          wait: "محاولات كثيرة. حاول مجددًا بعد ",
          note: "صفحات نتائج العملاء تبقى عامة — الكونسول وحده محميّ." }
  };
  function lang() { try { return localStorage.getItem("thrive_lang") === "ar" ? "ar" : "en"; } catch (e) { return "en"; } }

  async function pbkdf2Hex(pass, salt) {
    var enc = new TextEncoder();
    var keyMat = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITER }, keyMat, 256);
    return Array.prototype.map.call(new Uint8Array(bits), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }
  function authed() { try { return sessionStorage.getItem(KEY) === HASH; } catch (e) { return false; } }

  /* escalating lockout: after 5 wrong tries, 30s — doubling each further failure (cap 15 min) */
  function failState() { try { return JSON.parse(localStorage.getItem(FAILS) || "{}") || {}; } catch (e) { return {}; } }
  function lockedForMs() {
    var f = failState();
    return (f.until && f.until > Date.now()) ? (f.until - Date.now()) : 0;
  }
  function recordFail() {
    var f = failState(); f.n = (f.n || 0) + 1;
    if (f.n >= 5) f.until = Date.now() + Math.min(30000 * Math.pow(2, f.n - 5), 900000);
    try { localStorage.setItem(FAILS, JSON.stringify(f)); } catch (e) {}
    try { // failed attempts belong in the operations ledger
      var a = JSON.parse(localStorage.getItem("thrive_activity_v1") || "[]");
      a.push({ ts: new Date().toISOString(), action: "login_fail", slug: "", detail: "attempt " + f.n });
      localStorage.setItem("thrive_activity_v1", JSON.stringify(a.slice(-500)));
    } catch (e) {}
  }
  function clearFails() { try { localStorage.removeItem(FAILS); } catch (e) {} }
  function fmtWait(ms) { var s = Math.ceil(ms / 1000); return s >= 60 ? Math.ceil(s / 60) + "m" : s + "s"; }

  function reveal() {
    document.documentElement.classList.remove("gate-locked");
    var g = document.getElementById("thriveGate");
    if (g) g.parentNode.removeChild(g);
    document.body.style.overflow = "";
  }

  function buildGate() {
    var s = STR[lang()];
    document.body.style.overflow = "hidden";
    var wrap = document.createElement("div");
    wrap.id = "thriveGate";
    wrap.setAttribute("dir", lang() === "ar" ? "rtl" : "ltr");
    wrap.innerHTML =
      '<form class="gate-card" autocomplete="off">' +
      '  <img class="gate-logo" src="../assets/thrive-logo.png" alt="Thrive">' +
      '  <h1 class="gate-title">' + s.title + "</h1>" +
      '  <p class="gate-sub">' + s.sub + "</p>" +
      '  <input class="gate-input" id="gateInput" type="password" inputmode="text" ' +
      '         autocomplete="current-password" placeholder="' + s.ph + '" aria-label="' + s.ph + '">' +
      '  <button class="gate-btn" type="submit">' + s.go + "</button>" +
      '  <p class="gate-err" id="gateErr" hidden>' + s.err + "</p>" +
      '  <p class="gate-note">' + s.note + "</p>" +
      "</form>";
    document.body.appendChild(wrap);

    var form = wrap.querySelector("form");
    var input = wrap.querySelector("#gateInput");
    var err = wrap.querySelector("#gateErr");
    var busy = false;
    setTimeout(function () { input.focus(); }, 50);

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (busy) return;
      var lock = lockedForMs();
      if (lock > 0) { err.textContent = s.wait + fmtWait(lock); err.hidden = false; return; }
      var val = input.value || "";
      if (!val) { return; }
      busy = true; input.disabled = true;
      var h = null, sync = null;
      try { h = await pbkdf2Hex(val, GATE_SALT); if (h === HASH) sync = await pbkdf2Hex(val, SYNC_SALT); } catch (ex) {}
      busy = false; input.disabled = false;
      if (h === HASH) {
        clearFails();
        // The gate token is per-session (locking must really lock). The SYNC credential is a
        // device capability — derived from the passcode, never the passcode itself — so it is
        // also kept in localStorage; otherwise a session that reveals from a stored token has
        // no way to sync or read analytics, and everything silently degrades to "not collecting".
        try {
          sessionStorage.setItem(KEY, HASH);
          if (sync) { sessionStorage.setItem(SYNC_KEY, sync); localStorage.setItem(SYNC_KEY, sync); }
        } catch (ex) {}
        if (typeof window.logActivity === "function") {
          try { window.logActivity("login", "", "console unlocked"); } catch (ex) {}
        }
        reveal();
        if (typeof window.onGateUnlocked === "function") { try { window.onGateUnlocked(); } catch (ex) {} }
      } else {
        recordFail();
        var again = lockedForMs();
        err.textContent = again > 0 ? (s.wait + fmtWait(again)) : s.err;
        err.hidden = false;
        input.value = "";
        input.classList.add("shake");
        setTimeout(function () { input.classList.remove("shake"); }, 400);
        input.focus();
      }
    });
  }

  function start() {
    if (authed()) { reveal(); return; }
    document.documentElement.classList.add("gate-locked");
    buildGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // expose a manual lock (used by a "Lock" button in the console)
  window.thriveLock = function () {
    try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(SYNC_KEY); } catch (e) {}
    location.reload();
  };
})();
