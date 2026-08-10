/* Thrive Console access gate (client-side, hardened).
   The passcode is verified with PBKDF2-SHA256 at 120,000 iterations (offline guessing
   against the public verifier is ~120,000× costlier than a plain hash), and repeated
   wrong attempts trigger an escalating lockout. Unlocking also derives the cross-device
   sync credential, so the passcode alone opens the full live console on any device.
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
  var VAULT_SALT = "thrive-vault-v1";      // wraps the publishing token so only the passcode opens it
  var VAULT_KEY = "thrive_vault_key";
  var HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8"; // PBKDF2(passcode, thrive-gate-v2, 120k)

  var OP_FAILS = "thrive_op_fails";        // operator sign-in throttle (gate two), separate from the passcode
  var STR = {
    en: { title: "Thrive Console", sub: "Private workspace. Enter the passcode to continue.",
          ph: "Passcode", go: "Unlock", err: "Incorrect passcode. Try again.",
          wait: "Too many attempts. Try again in ",
          note: "Prospect result pages stay public. Only the console is protected.",
          op_sub: "Signed device. Sign in as an operator to continue.",
          op_email: "Operator email", op_pass: "Password", op_go: "Sign in",
          op_err: "Could not sign in.", op_wait: "Too many attempts. Try again in ",
          op_busy: "Signing in", build: "Build" },
    ar: { title: "كونسول ثرايف", sub: "مساحة خاصة. أدخل رمز الدخول للمتابعة.",
          ph: "رمز الدخول", go: "فتح", err: "رمز غير صحيح. حاول مجددًا.",
          wait: "محاولات كثيرة. حاول مجددًا بعد ",
          note: "صفحات نتائج العملاء تبقى عامة. الكونسول وحده محميّ.",
          op_sub: "الجهاز موثوق. سجّل الدخول كمشغّل للمتابعة.",
          op_email: "بريد المشغّل", op_pass: "كلمة المرور", op_go: "تسجيل الدخول",
          op_err: "تعذّر تسجيل الدخول.", op_wait: "محاولات كثيرة. حاول مجددًا بعد ",
          op_busy: "جارٍ تسجيل الدخول", build: "الإصدار" }
  };
  /* The build marker (bundle.js stamps meta[name=thrive-build]). Printed on the gate so a deploy
     is verifiable at a glance, on the device, before sign-in: the mark on the device is compared
     against the latest build. Only hex is kept, so a foreign meta value cannot inject markup, and
     an empty value renders nothing rather than an empty label. Standalone pages that carry no such
     meta simply show no mark. */
  function buildId() {
    try {
      var m = document.querySelector('meta[name="thrive-build"]');
      var v = (m && m.getAttribute("content")) || (typeof window !== "undefined" && window.THRIVE_BUILD) || "";
      return String(v).replace(/[^0-9a-f]/gi, "").slice(0, 12);
    } catch (e) { return ""; }
  }
  function buildMark(s) {
    var bid = buildId();
    return bid ? '<p class="gate-build">' + s.build + ' <bdi>' + bid + "</bdi></p>" : "";
  }
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
  /* Presence: the 30-minute window that keeps the operator inside across a short absence.
     The passcode unlock is a per-session flag (sessionStorage), and iOS Safari evicts a backgrounded
     tab's sessionStorage readily, so before this the operator was ejected to the passcode on every
     short absence. Presence records the last time the console was active, in localStorage (which
     survives eviction), and the device counts as passcode-unlocked while that is under 30 minutes old.
     A return inside the window goes straight to the board; after 30 minutes of idle the device re-gates.
     The passcode itself is never stored, only this timestamp and the already-stored derived keys, so
     the protection is exactly a 30-minute idle presence, the rule the review asked for. */
  var PRESENCE = "thrive_presence";
  var IDLE_MS = 30 * 60 * 1000;   // 30 minutes of idle before the device re-gates
  function markPresent() { try { localStorage.setItem(PRESENCE, String(Date.now())); } catch (e) {} }
  function present() {
    try { var at = parseInt(localStorage.getItem(PRESENCE) || "0", 10); return !!at && (Date.now() - at) < IDLE_MS; }
    catch (e) { return false; }
  }
  function clearPresence() { try { localStorage.removeItem(PRESENCE); } catch (e) {} }
  // The device is passcode-unlocked when this session unlocked it OR a fresh presence still holds.
  function authed() {
    try { if (sessionStorage.getItem(KEY) === HASH) return true; } catch (e) {}
    return present();
  }

  /* escalating lockout: after 5 wrong tries, 30s, doubling each further failure (cap 15 min) */
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

  /* Gate two: the operator sign-in. The passcode is a device gate; the Supabase session is what actually
     scopes the data, and every signed-in operator is equal (the to authenticated policies treat them the
     same). Failure is neutral and attempts are throttled, a UI brake on top of Supabase's own limits. */
  function supa() { return (typeof window !== "undefined" && window.ThriveSupa) ? window.ThriveSupa : null; }
  // Gate two is required only where the data lives: Supabase is configured and there is no session yet. A
  // device without Supabase configured has no gate two to pass, so the passcode alone reveals the console.
  function needsOperator() { var S = supa(); try { return !!(S && S.ready && S.ready() && S.signedIn && !S.signedIn()); } catch (e) { return false; } }
  function opFailState() { try { return JSON.parse(localStorage.getItem(OP_FAILS) || "{}") || {}; } catch (e) { return {}; } }
  function opLockedForMs() { var f = opFailState(); return (f.until && f.until > Date.now()) ? (f.until - Date.now()) : 0; }
  // After 3 failed sign-ins, exponential backoff from 5s, doubling, capped at 15 minutes.
  function opRecordFail() {
    var f = opFailState(); f.n = (f.n || 0) + 1;
    if (f.n >= 3) f.until = Date.now() + Math.min(5000 * Math.pow(2, f.n - 3), 900000);
    try { localStorage.setItem(OP_FAILS, JSON.stringify(f)); } catch (e) {}
    try {
      var a = JSON.parse(localStorage.getItem("thrive_activity_v1") || "[]");
      a.push({ ts: new Date().toISOString(), action: "operator_login_fail", slug: "", detail: "attempt " + f.n });
      localStorage.setItem("thrive_activity_v1", JSON.stringify(a.slice(-500)));
    } catch (e) {}
  }
  function opClearFails() { try { localStorage.removeItem(OP_FAILS); } catch (e) {} }

  var __presenceWired = false;
  function reveal() {
    document.documentElement.classList.remove("gate-locked");
    var g = document.getElementById("thriveGate");
    if (g) g.parentNode.removeChild(g);
    document.body.style.overflow = "";
    markPresent();
    wirePresence();
  }
  // Re-show the gate over the live console (state preserved) when the presence window has lapsed. Used
  // when a tab that stayed alive is foregrounded after more than 30 minutes idle.
  function relock() {
    if (document.getElementById("thriveGate")) return;   // already gated
    try { sessionStorage.removeItem(KEY); } catch (e) {}  // this session must re-enter the passcode
    clearPresence();
    document.documentElement.classList.add("gate-locked");
    document.body.style.overflow = "hidden";
    buildGate();
  }
  // Keep the presence fresh while the console is in use, and re-gate a returning tab past the window.
  function wirePresence() {
    if (__presenceWired) return; __presenceWired = true;
    var last = 0;
    function bump() { var n = Date.now(); if (n - last > 20000) { last = n; markPresent(); } }
    ["pointerdown", "keydown"].forEach(function (ev) {
      try { document.addEventListener(ev, bump, { passive: true }); } catch (e) {}
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (document.getElementById("thriveGate")) return;   // the gate is already showing
      if (present()) markPresent();                        // within the window: extend it
      else relock();                                       // idle past 30 minutes: re-gate
    });
  }

  function buildGate() {
    document.body.style.overflow = "hidden";
    var wrap = document.createElement("div");
    wrap.id = "thriveGate";
    wrap.setAttribute("dir", lang() === "ar" ? "rtl" : "ltr");
    document.body.appendChild(wrap);
    // Passcode first (unless the device is already unlocked), then the operator sign-in, then the console.
    if (authed()) showOperatorStep(wrap); else showPasscodeStep(wrap);
  }

  // After the passcode, hand off: sign in as an operator where the data is scoped, else reveal at once.
  function afterPasscode(wrap) {
    if (needsOperator()) showOperatorStep(wrap); else finish();
  }
  function finish() {
    reveal();
    if (typeof window.onGateUnlocked === "function") { try { window.onGateUnlocked(); } catch (ex) {} }
  }

  function showPasscodeStep(wrap) {
    var s = STR[lang()];
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
      buildMark(s) +
      "</form>";
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
      var h = null, sync = null, vault = null;
      try {
        h = await pbkdf2Hex(val, GATE_SALT);
        if (h === HASH) {
          sync = await pbkdf2Hex(val, SYNC_SALT);
          // A third derived value, never sent anywhere: it decrypts the publishing token
          // that travels through the shared store, so the passcode alone unlocks every
          // capability on any device, and the store itself holds only ciphertext.
          vault = await pbkdf2Hex(val, VAULT_SALT);
        }
      } catch (ex) {}
      busy = false; input.disabled = false;
      if (h === HASH) {
        clearFails();
        // The gate token is per-session (locking must really lock). The SYNC credential is a
        // device capability (derived from the passcode, never the passcode itself), so it is
        // also kept in localStorage; otherwise a session that reveals from a stored token has
        // no way to sync or read analytics, and everything silently degrades to "not collecting".
        try {
          sessionStorage.setItem(KEY, HASH);
          if (sync) { sessionStorage.setItem(SYNC_KEY, sync); localStorage.setItem(SYNC_KEY, sync); }
          if (vault) { sessionStorage.setItem(VAULT_KEY, vault); localStorage.setItem(VAULT_KEY, vault); }
        } catch (ex) {}
        markPresent();   // open the 30-minute presence window

        if (typeof window.logActivity === "function") {
          try { window.logActivity("login", "", "console unlocked"); } catch (ex) {}
        }
        afterPasscode(wrap);
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

  function showOperatorStep(wrap) {
    var S = supa();
    if (!S) { finish(); return; }                       // no Supabase on this page, nothing to sign in to
    var s = STR[lang()];
    wrap.innerHTML =
      '<form class="gate-card" autocomplete="off">' +
      '  <img class="gate-logo" src="../assets/thrive-logo.png" alt="Thrive">' +
      '  <h1 class="gate-title">' + s.title + "</h1>" +
      '  <p class="gate-sub">' + s.op_sub + "</p>" +
      '  <input class="gate-input" id="gateEmail" type="email" autocomplete="username" spellcheck="false" ' +
      '         placeholder="' + s.op_email + '" aria-label="' + s.op_email + '">' +
      '  <input class="gate-input" id="gatePass" type="password" autocomplete="current-password" ' +
      '         placeholder="' + s.op_pass + '" aria-label="' + s.op_pass + '">' +
      '  <button class="gate-btn" type="submit">' + s.op_go + "</button>" +
      '  <p class="gate-err" id="gateErr" hidden>' + s.op_err + "</p>" +
      '  <p class="gate-note">' + s.note + "</p>" +
      buildMark(s) +
      "</form>";
    var form = wrap.querySelector("form");
    var email = wrap.querySelector("#gateEmail");
    var pass = wrap.querySelector("#gatePass");
    var err = wrap.querySelector("#gateErr");
    var btn = wrap.querySelector(".gate-btn");
    var busy = false;
    setTimeout(function () { email.focus(); }, 50);

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (busy) return;
      var lock = opLockedForMs();
      if (lock > 0) { err.textContent = s.op_wait + fmtWait(lock); err.hidden = false; return; }
      var m = (email.value || "").trim(), p = pass.value || "";
      // A missing field is the same neutral failure as a wrong one: the gate reveals nothing about why.
      busy = true; email.disabled = pass.disabled = true; btn.textContent = s.op_busy;
      var ok = false;
      if (m && p) { try { await S.signIn(m, p); ok = S.signedIn && S.signedIn(); } catch (ex) { ok = false; } }
      busy = false; email.disabled = pass.disabled = false; btn.textContent = s.op_go;
      if (ok) {
        opClearFails();
        if (typeof window.logActivity === "function") { try { window.logActivity("operator_login", "", "signed in"); } catch (ex) {} }
        // Signing in lands on the board (the working surface), not wherever the hash last pointed (Settings).
        try { location.hash = "board"; } catch (ex) {}
        finish();
      } else {
        opRecordFail();
        var again = opLockedForMs();
        err.textContent = again > 0 ? (s.op_wait + fmtWait(again)) : s.op_err;   // identical for wrong email or wrong password
        err.hidden = false;
        pass.value = "";
        form.classList.add("shake");
        setTimeout(function () { form.classList.remove("shake"); }, 400);
        (m ? pass : email).focus();
      }
    });
  }

  function start() {
    // Already unlocked AND signed in (or no Supabase to sign into): reveal. Unlocked but not signed in:
    // straight to the operator step, never a blank board. Not unlocked: the passcode step.
    if (authed() && !needsOperator()) { reveal(); return; }
    document.documentElement.classList.add("gate-locked");
    buildGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // expose a manual lock (used by a "Lock" button in the console). This is the full lock: it clears the
  // passcode session so the next entry starts at the passcode again.
  window.thriveLock = function () {
    try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(SYNC_KEY); sessionStorage.removeItem(VAULT_KEY); } catch (e) {}
    clearPresence();   // a manual lock ends the presence window at once
    location.reload();
  };
  // Operator sign-out: ends the Supabase session only. The passcode (the device gate) stays, so the reload
  // lands on the operator sign-in step, not the passcode, and never on a blank board.
  window.thriveSignOut = async function () {
    var S = supa();
    try { if (S && S.signOut) await S.signOut(); } catch (e) {}
    location.reload();
  };
})();
