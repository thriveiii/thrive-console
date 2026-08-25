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
          op_busy: "Signing in", build: "Build",
          op_err_timeout: "Sign-in timed out. Check your connection and try again.",
          op_err_network: "Could not reach the service. Check your connection and try again.",
          op_err_unavailable: "The sign-in service is unavailable right now. Try again shortly.",
          op_err_empty: "The service returned an empty response. Tap Retry.",
          op_err_parse: "The service response could not be read. Tap Retry.",
          err_secure: "A secure connection is required to unlock. Open the console over HTTPS and try again.",
          op_retry: "Retry", op_clean_page: "Trouble signing in? Open the clean sign-in page",
          resub: "Welcome back. Sign in again to continue." },
    ar: { title: "كونسول ثرايف", sub: "مساحة خاصة. أدخل رمز الدخول للمتابعة.",
          ph: "رمز الدخول", go: "فتح", err: "رمز غير صحيح. حاول مجددًا.",
          wait: "محاولات كثيرة. حاول مجددًا بعد ",
          note: "صفحات نتائج العملاء تبقى عامة. الكونسول وحده محميّ.",
          op_sub: "الجهاز موثوق. سجّل الدخول كمشغّل للمتابعة.",
          op_email: "بريد المشغّل", op_pass: "كلمة المرور", op_go: "تسجيل الدخول",
          op_err: "تعذّر تسجيل الدخول.", op_wait: "محاولات كثيرة. حاول مجددًا بعد ",
          op_busy: "جارٍ تسجيل الدخول", build: "الإصدار",
          op_err_timeout: "انتهت مهلة تسجيل الدخول. تحقّق من اتصالك وحاول مجددًا.",
          op_err_network: "تعذّر الوصول إلى الخدمة. تحقّق من اتصالك وحاول مجددًا.",
          op_err_unavailable: "خدمة تسجيل الدخول غير متوفرة الآن. حاول بعد قليل.",
          op_err_empty: "أعادت الخدمة استجابة فارغة. اضغط إعادة المحاولة.",
          op_err_parse: "تعذّرت قراءة استجابة الخدمة. اضغط إعادة المحاولة.",
          err_secure: "يلزم اتصال آمن لفتح القفل. افتح الكونسول عبر HTTPS وحاول مجددًا.",
          op_retry: "إعادة المحاولة", op_clean_page: "تواجه مشكلة في تسجيل الدخول؟ افتح صفحة الدخول النظيفة",
          resub: "مرحبًا بعودتك. سجّل الدخول من جديد." }
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
  function lang() { try { return localStorage.getItem("thrive_lang") === "ar" ? "ar" : "en"; } catch (e) { gnote("lang read", e); return "en"; } }

  /* GATE_V2: no silent failure anywhere in the gate. Every caught error lands in this bounded note ring,
     which the ?diag=1 readout prints; a storage or crypto failure is a recorded fact, never a swallowed one. */
  function gnote(tag, e) {
    try {
      var a = window.__gateNotes = window.__gateNotes || [];
      a.push(tag + ": " + ((e && e.message) || String(e)));
      if (a.length > 20) a.shift();
    } catch (x) { /* the note ring is the last resort; there is nowhere further to record */ }
  }

  async function pbkdf2Hex(pass, salt) {
    // GATE_V2: a missing crypto.subtle (a non-secure context) is a NAMED failure the passcode step surfaces
    // as "secure connection required", never as "wrong passcode".
    if (!(window.crypto && window.crypto.subtle)) {
      var se = new Error("crypto.subtle unavailable (secure context required)"); se.kind = "secure"; throw se;
    }
    var enc = new TextEncoder();
    var keyMat = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITER }, keyMat, 256);
    return Array.prototype.map.call(new Uint8Array(bits), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }
  /* Graduated presence (supersedes the single 30-minute passcode presence of #95/#97). ONE last-active
     stamp in localStorage (which survives WebKit's eviction of a backgrounded tab's sessionStorage), read
     against TWO thresholds so the way back in is always the same, ordered walk out and never a moody swap:
       - inside 30 minutes idle: the board, no gate;
       - 30 to 45 minutes idle: the operator session is dropped, back to the lobby (the operator email
         step); the passcode presence is kept, so the passcode is not re-asked;
       - past 45 minutes idle: the passcode presence is dropped too, back to Gate 1 (the passcode).
     The passcode itself is never stored, only this timestamp and the already-derived device keys. */
  var PRESENCE = "thrive_presence";
  var OPERATOR_IDLE_MIN = 30;                        // idle minutes before the operator session drops to the lobby
  var PASSCODE_IDLE_MIN = 45;                        // idle minutes before the passcode presence drops too (full exit)
  var OPERATOR_IDLE_MS = OPERATOR_IDLE_MIN * 60 * 1000;
  var PASSCODE_IDLE_MS = PASSCODE_IDLE_MIN * 60 * 1000;
  /* GATE_V2 Part 4: presence is MEMORY-FIRST, mirrors second, exactly like the session store. On a
     storage-blocked device the old localStorage-only stamp made the passcode a loop: markPresent's write
     silently failed, passcodePresent() read back false, and every re-gate returned to the passcode step in
     the SAME session. With the in-memory stamp consulted first, the worst case on a storage-blocked device
     is re-entering the passcode after a full reload, never a same-session loop and never a lockout. */
  var __memPresence = 0;   // the PRIMARY presence stamp (page-lifetime)
  function markPresent() {
    __memPresence = Date.now();
    try { localStorage.setItem(PRESENCE, String(__memPresence)); window.__presenceMirrorOk = true; }
    catch (e) { window.__presenceMirrorOk = false; gnote("presence mirror write", e); }
  }
  function idleMs() {
    var at = __memPresence || 0;
    try { var st = parseInt(localStorage.getItem(PRESENCE) || "0", 10); if (st > at) at = st; }
    catch (e) { gnote("presence mirror read", e); }
    return at ? (Date.now() - at) : Infinity;
  }
  function passcodePresent() { return idleMs() < PASSCODE_IDLE_MS; }   // within 45 minutes: the passcode holds
  function operatorPresent() { return idleMs() < OPERATOR_IDLE_MS; }   // within 30 minutes: the operator holds
  function clearPresence() {
    __memPresence = 0;
    try { localStorage.removeItem(PRESENCE); } catch (e) { gnote("presence clear", e); }
  }
  // Drop the operator session: the MEMORY session first (the primary store since GATE_V2), then the mirror.
  // Without the memory clear, a lobby drop or sign-out would leave signedIn() true off the in-memory copy.
  function clearOperatorSession() {
    var S = supa();
    try { if (S && S.clearSession) S.clearSession(); } catch (e) { gnote("session clear", e); }
    try { localStorage.removeItem("console_sb_session"); } catch (e) { gnote("session mirror clear", e); }
  }
  // P29 self-heal: is the stored session's access token already past its expiry? A fresh token returns
  // false (the common warm-boot case), so the board is revealed at once with no network round trip and no
  // timing regression. Only an EXPIRED token pays the bounded validation below.
  function sessionExpired() {
    try {
      var S = supa(); var sess = (S && S.session) ? S.session() : null;
      if (!sess || !sess.access_token) return false;   // no session: nothing to heal here
      if (!sess.expires_at) return false;               // unknown expiry: treat as fresh (optimistic)
      return (Number(sess.expires_at) * 1000) < (Date.now() - 5000);   // 5s skew
    } catch (e) { return false; }
  }
  // A device that has unlocked or signed in before is a returning operator, so a re-gate reads as a calm
  // return rather than a first-time setup. Evidence that survives a drop: the derived sync credential.
  function returning() {
    try { return !!(localStorage.getItem(SYNC_KEY) || localStorage.getItem("console_sb_session")); }
    catch (e) { return false; }
  }
  // The one place the gate decides where the operator lands, in one fixed order, from the stamp plus
  // whether an operator session exists. Never two booleans racing: exactly one target.
  function gateTarget() {
    if (!passcodePresent()) return "passcode";        // 45+ minutes idle, or a fresh / cleared device
    if (!operatorPresent()) return "lobby";           // 30 to 45 minutes idle: the operator session lapsed
    if (needsOperator()) return "lobby";              // no operator session yet (fresh, or after sign-out)
    return "board";                                   // within 30 minutes and signed in
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
    try { localStorage.setItem(FAILS, JSON.stringify(f)); } catch (e) { gnote("fail throttle write", e); }
    try { // failed attempts belong in the operations ledger
      var a = JSON.parse(localStorage.getItem("thrive_activity_v1") || "[]");
      a.push({ ts: new Date().toISOString(), action: "login_fail", slug: "", detail: "attempt " + f.n });
      localStorage.setItem("thrive_activity_v1", JSON.stringify(a.slice(-500)));
    } catch (e) { gnote("fail ledger write", e); }
  }
  function clearFails() { try { localStorage.removeItem(FAILS); } catch (e) { gnote("fail throttle clear", e); } }
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
    try { localStorage.setItem(OP_FAILS, JSON.stringify(f)); } catch (e) { gnote("op throttle write", e); }
    try {
      var a = JSON.parse(localStorage.getItem("thrive_activity_v1") || "[]");
      a.push({ ts: new Date().toISOString(), action: "operator_login_fail", slug: "", detail: "attempt " + f.n });
      localStorage.setItem("thrive_activity_v1", JSON.stringify(a.slice(-500)));
    } catch (e) { gnote("op fail ledger write", e); }
  }
  function opClearFails() { try { localStorage.removeItem(OP_FAILS); } catch (e) { gnote("op throttle clear", e); } }

  var __presenceWired = false;
  function reveal() {
    document.documentElement.classList.remove("gate-locked");
    var g = document.getElementById("thriveGate");
    if (g) g.parentNode.removeChild(g);
    document.body.style.overflow = "";
    // GATE_V2 Part 5: the gate phase is silent. Background relay work (app.js autoSyncTick /
    // scheduleSyncPush) holds until this flag is set, so nothing competes with the sign-in.
    try { window.__gateRevealed = true; } catch (e) { gnote("reveal flag", e); }
    markPresent();
    wirePresence();
  }
  // Re-show the gate over the live console (state preserved) when idle has crossed a threshold. Graduated:
  // 30 to 45 minutes drops to the lobby (operator step), past 45 minutes drops to the passcode.
  function relock() {
    if (document.getElementById("thriveGate")) return;   // already gated
    var target = gateTarget();
    if (target === "board") { markPresent(); return; }   // still fresh: nothing to re-gate
    if (target === "passcode") {                          // full exit: clear both layers
      try { sessionStorage.removeItem(KEY); } catch (e) { gnote("gate token clear", e); }
      clearPresence(); clearOperatorSession();
    } else {                                              // lobby: drop the operator session, keep the passcode
      clearOperatorSession();
    }
    document.documentElement.classList.add("gate-locked");
    document.body.style.overflow = "hidden";
    buildGate(target);
  }
  // Keep the presence fresh while the console is in use, and re-gate a returning tab past a threshold.
  function wirePresence() {
    if (__presenceWired) return; __presenceWired = true;
    var last = 0;
    function bump() { var n = Date.now(); if (n - last > 20000) { last = n; markPresent(); } }
    ["pointerdown", "keydown"].forEach(function (ev) {
      try { document.addEventListener(ev, bump, { passive: true }); } catch (e) { gnote("presence listener", e); }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (document.getElementById("thriveGate")) return;   // the gate is already showing
      if (gateTarget() === "board") markPresent();          // within 30 minutes: extend the window
      else relock();                                        // 30+ minutes: graduated re-gate (lobby or passcode)
    });
  }

  // Build the gate at a fixed target: "passcode" is Gate 1, "lobby" is the operator email step. The order
  // is always passcode then lobby then board; the target is decided once, by gateTarget(), never by a race.
  function buildGate(target) {
    target = target || gateTarget();
    document.body.style.overflow = "hidden";
    var wrap = document.createElement("div");
    wrap.id = "thriveGate";
    wrap.setAttribute("dir", lang() === "ar" ? "rtl" : "ltr");
    document.body.appendChild(wrap);
    if (target === "passcode") showPasscodeStep(wrap); else showOperatorStep(wrap);
    // P29 watchdog signal: an interactive gate card is on screen, so the boot is NOT stuck. The board's
    // first paint sets this too (app.js); the 20s watchdog only fires when neither has happened.
    try { window.__thriveBooted = true; } catch (e) { gnote("boot flag", e); }
  }

  // After the passcode, hand off: sign in as an operator where the data is scoped, else reveal at once.
  function afterPasscode(wrap) {
    if (needsOperator()) showOperatorStep(wrap); else finish();
  }
  // GATE_V2 Part 2: finish() receives the session object straight from signIn's RETURN VALUE (the warm-boot
  // and no-Supabase callers pass nothing; their session, if any, is already held by the auth module). The
  // teardown itself performs no storage read-back: reaching finish() IS the success decision.
  function finish(sess) {
    try { clearOpBounce(); } catch (ex) { gnote("op bounce clear", ex); }   // P56: a resolved gate resets the redirect guard
    // P40 checkpoint + watchdog arm (string assignment + one call, no behavior change): the boot proper
    // begins now that the gate has resolved. Arming here means a signed-out gate never trips the stall
    // watchdog (a legitimate non-painted state); only a passed gate whose board never paints does.
    try { window.__bootMark = "gate resolved"; } catch (ex) { gnote("boot mark", ex); }
    try { if (typeof window.__thriveFailsafeArm === "function") window.__thriveFailsafeArm(); } catch (ex) { gnote("failsafe arm", ex); }
    reveal();
    // P48 gate-first boot: the gate now resolves BEFORE app.js is parsed (it is loaded first, right after
    // config + supabase). On a WARM session that means finish() runs while window.onGateUnlocked is still
    // undefined, so the unlock hydrate (the P111 force board-refresh, the operator chip, the name map)
    // would be missed. Call it if it exists; otherwise leave a pending flag that app.js drains the moment
    // it defines the hook, so the unlock fires exactly once on a warm boot too.
    if (typeof window.onGateUnlocked === "function") { try { window.onGateUnlocked(); } catch (ex) { gnote("unlock hook", ex); } }
    else { try { window.__gateUnlockedPending = true; } catch (ex) { gnote("unlock pending flag", ex); } }
  }
  function showPasscodeStep(wrap) {
    var s = STR[lang()];
    // A returning operator whose window lapsed gets the calm re-entry copy, not the first-time setup line.
    var subCopy = (returning() && s.resub) ? s.resub : s.sub;
    wrap.innerHTML =
      '<form class="gate-card" autocomplete="off">' +
      '  <img class="gate-logo" src="../assets/thrive-logo.png" alt="Thrive">' +
      '  <h1 class="gate-title">' + s.title + "</h1>" +
      '  <p class="gate-sub">' + subCopy + "</p>" +
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
      var h = null, sync = null, vault = null, cryptoErr = null;
      try {
        h = await pbkdf2Hex(val, GATE_SALT);
        if (h === HASH) {
          sync = await pbkdf2Hex(val, SYNC_SALT);
          // A third derived value, never sent anywhere: it decrypts the publishing token
          // that travels through the shared store, so the passcode alone unlocks every
          // capability on any device, and the store itself holds only ciphertext.
          vault = await pbkdf2Hex(val, VAULT_SALT);
        }
      } catch (ex) { cryptoErr = ex; gnote("pbkdf2", ex); }
      busy = false; input.disabled = false;
      if (cryptoErr) {
        // GATE_V2: a crypto failure is NOT a wrong passcode. It surfaces by its real name (secure context
        // required), is never throttled as a failed attempt, and the entered value is kept for a retry.
        err.textContent = s.err_secure;
        err.hidden = false;
        input.focus();
        return;
      }
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
        } catch (ex) { gnote("credential mirror write", ex); }
        markPresent();   // open the 30-minute presence window (memory-first, mirror best-effort)

        if (typeof window.logActivity === "function") {
          try { window.logActivity("login", "", "console unlocked"); } catch (ex) { gnote("login activity", ex); }
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

  /* P56 GATE_BREACH: the operator sign-in (the network token POST) is the step that HANGS in the loaded
     console on this WebKit build, while the SAME request completes in ~250ms on the standalone gate.html
     (the authtest-proven path), where no other console code is running to starve the connection. So the
     operator sign-in is routed to gate.html: the passcode stays in-console (local crypto, no network), and
     only the network sign-in runs on the clean page, which writes the session mirror and returns to the
     console. A one-shot bounce guard (20s) means a mirror that fails to carry falls back to the in-console
     card rather than looping, and a test can force the in-console path with window.__gateNoRedirect. */
  var OP_BOUNCE = "thrive_op_bounce";
  function opBouncedRecently() { try { var t = parseInt(localStorage.getItem(OP_BOUNCE) || "0", 10); return !!(t && (Date.now() - t) < 20000); } catch (e) { return false; } }
  function markOpBounce() { try { localStorage.setItem(OP_BOUNCE, String(Date.now())); } catch (e) { gnote("op bounce write", e); } }
  function clearOpBounce() { try { localStorage.removeItem(OP_BOUNCE); } catch (e) { gnote("op bounce clear", e); } }
  function gateHref() { return "../gate.html"; }          // the standalone gate, relative to library/console.html
  function redirectToGate() {
    if (window.__gateNoRedirect) return false;             // a test (or a deliberate override) keeps sign-in in-console
    if (opBouncedRecently()) return false;                 // just returned from gate.html without a session: fall back
    markOpBounce();
    try { location.assign(gateHref()); return true; } catch (e) { gnote("gate redirect", e); return false; }
  }

  function showOperatorStep(wrap) {
    var S = supa();
    if (!S) { finish(); return; }                       // no Supabase on this page, nothing to sign in to
    // P56: route the network sign-in to the standalone gate.html (proven to complete where the in-console
    // token POST hangs). Only skipped by a test override or the one-shot bounce fallback below.
    if (redirectToGate()) return;
    var s = STR[lang()];
    // A returning operator dropped to the lobby by idle (or by sign-out) reads a calm return, not a
    // first-time "signed device" setup line.
    var subCopy = (returning() && s.resub) ? s.resub : s.op_sub;
    wrap.innerHTML =
      '<form class="gate-card" autocomplete="off">' +
      '  <img class="gate-logo" src="../assets/thrive-logo.png" alt="Thrive">' +
      '  <h1 class="gate-title">' + s.title + "</h1>" +
      '  <p class="gate-sub">' + subCopy + "</p>" +
      '  <input class="gate-input" id="gateEmail" type="email" autocomplete="username" spellcheck="false" ' +
      '         placeholder="' + s.op_email + '" aria-label="' + s.op_email + '">' +
      '  <input class="gate-input" id="gatePass" type="password" autocomplete="current-password" ' +
      '         placeholder="' + s.op_pass + '" aria-label="' + s.op_pass + '">' +
      '  <button class="gate-btn" type="submit">' + s.op_go + "</button>" +
      '  <button class="gate-btn ghost" type="button" id="gateRetry" hidden>' + s.op_retry + "</button>" +
      '  <p class="gate-err" id="gateErr" hidden>' + s.op_err + "</p>" +
      '  <p class="gate-diag mono-iso" id="gateDiag" dir="ltr" hidden></p>' +
      '  <p class="gate-note">' + s.note + "</p>" +
      // P56 fallback: this in-console card is only shown when the gate.html redirect was suppressed or bounced;
      // the operator can still reach the proven clean page from here.
      '  <a class="gate-alt" href="' + gateHref() + '">' + s.op_clean_page + "</a>" +
      buildMark(s) +
      "</form>";
    var form = wrap.querySelector("form");
    var email = wrap.querySelector("#gateEmail");
    var pass = wrap.querySelector("#gatePass");
    var err = wrap.querySelector("#gateErr");
    var diag = wrap.querySelector("#gateDiag");
    var btn = wrap.querySelector(".gate-btn");
    var retry = wrap.querySelector("#gateRetry");
    // P29 diagnostic surface: show the raw error text on the card so a non-timeout failure is never a
    // silent hang. textContent only (never innerHTML), so a server error string cannot inject markup.
    function showDiag(t) { if (!diag) return; if (t) { diag.textContent = String(t).slice(0, 200); diag.hidden = false; } else { diag.textContent = ""; diag.hidden = true; } }
    function showRetry(on) { if (retry) retry.hidden = !on; }
    var busy = false;
    setTimeout(function () { email.focus(); }, 50);

    // P31: one attempt, callable from the form submit and the Retry button. On a timeout the button is
    // released, the reason and raw diagnostic are shown, and a one-tap Retry appears. Retry passes
    // fresh=true so signIn opens a new connection (nonce + no-store) rather than reusing a wedged socket.
    async function attempt(fresh) {
      if (busy) return;
      var lock = opLockedForMs();
      if (lock > 0) { err.textContent = s.op_wait + fmtWait(lock); err.hidden = false; return; }
      var m = (email.value || "").trim(), p = pass.value || "";
      // A missing field is the same neutral failure as a wrong one: the gate reveals nothing about why.
      busy = true; email.disabled = pass.disabled = true; btn.textContent = s.op_busy;
      err.hidden = true; showDiag(""); showRetry(false);   // clear any prior failure before this attempt
      var ok = false, kind = "", raw = "", sess = null;
      // GATE_V2 Part 2: success is bound to signIn's RETURN VALUE (the parsed session), never to a storage
      // read-back. signIn is bounded by its own setTimeout race: it resolves with the session or REJECTS
      // with a typed error (kind = timeout / network / unavailable / auth / empty / parse) at the 15s bound
      // even if the browser ignores the AbortController on a wedged socket. The button state is ALWAYS
      // released below, so "Signing in" can never be the last word; the raw error text is captured for the
      // visible diagnostic. No hard outer race, no step marks.
      if (m && p) {
        try {
          sess = await S.signIn(m, p, { fresh: !!fresh });
          ok = !!(sess && sess.access_token);
          if (!ok) { kind = "auth"; raw = "auth: sign-in returned no session"; }
        }
        catch (ex) {
          ok = false; kind = (ex && ex.kind) || "auth";
          raw = (kind || "error") + ": " + ((ex && ex.message) || String(ex));
          if (ex && ex.status) raw += " (HTTP " + ex.status + ")";
        }
      }
      busy = false; email.disabled = pass.disabled = false; btn.textContent = s.op_go;
      if (ok) {
        showDiag(""); showRetry(false);
        opClearFails();
        if (typeof window.logActivity === "function") { try { window.logActivity("operator_login", "", "signed in"); } catch (ex) { gnote("login activity", ex); } }
        // Signing in lands on the board (the working surface), not wherever the hash last pointed (Settings).
        try { location.hash = "board"; } catch (ex) { gnote("hash route", ex); }
        finish(sess);
      } else if (kind === "empty" || kind === "parse") {
        // GATE_V2 Part 1: a 200 whose body was empty (after the automatic retry) or unreadable is a SERVICE
        // response fault, named as such: never throttled as a wrong credential, always offered a Retry.
        err.textContent = kind === "empty" ? s.op_err_empty : s.op_err_parse;
        err.hidden = false;
        showDiag(raw);
        showRetry(true);
        (m ? pass : email).focus();
      } else if (kind === "timeout" || kind === "network" || kind === "unavailable") {
        // A transient service condition is NOT a wrong credential: say specifically what happened, do NOT
        // throttle it as a failed attempt, and offer a one-tap Retry that opens a fresh connection.
        err.textContent = kind === "timeout" ? s.op_err_timeout : (kind === "unavailable" ? s.op_err_unavailable : s.op_err_network);
        err.hidden = false;
        showDiag(raw);       // the actual error text, for on-device diagnosis
        showRetry(true);     // one-tap retry with a fresh connection
        (m ? pass : email).focus();
      } else {
        // A real credential rejection (or a missing field): neutral message and the existing throttle.
        opRecordFail();
        var again = opLockedForMs();
        err.textContent = again > 0 ? (s.op_wait + fmtWait(again)) : s.op_err;   // identical for wrong email or wrong password
        err.hidden = false;
        if (raw) showDiag(raw);   // surface the real reason (never a silent hang); empty for a missing field
        pass.value = "";
        form.classList.add("shake");
        setTimeout(function () { form.classList.remove("shake"); }, 400);
        (m ? pass : email).focus();
      }
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); attempt(false); });
    if (retry) retry.addEventListener("click", function () { attempt(true); });   // fresh connection on retry
  }

  // P29: an expired stored token at warm boot. Keep the console hidden, try ONE bounded refresh, and either
  // reveal the board (session healed) or clear the stale session and show the operator sign-in card. Bounded
  // by the same AbortController timeout, and backstopped by the boot watchdog, so it can never hang.
  async function healExpiredThenStart() {
    document.documentElement.classList.add("gate-locked");
    var S = supa(), good = false;
    try { if (S && S.getSession) good = await S.getSession(); } catch (e) { good = false; }
    if (good) { finish(); return; }
    // Not usable now (timed out, errored, or the refresh token was rejected): clear ONCE and drop to the
    // operator sign-in card. A corrupt or expired token never locks the app on a blank screen.
    clearOperatorSession();
    buildGate("lobby");
  }

  function start() {
    // One fixed order, decided once: board, else the lobby (operator step), else the passcode. The
    // graduated drops are enforced here so the session state always matches the step that is shown, and
    // the two gates can never disagree. Never a blank board (#84): a target is always chosen.
    var target = gateTarget();
    // A returning operator (session still live) skips both steps. Reveal AND signal the unlock, the same
    // as a fresh sign-in: without the signal the board renders from the local store and the live Supabase
    // hydrate never fires on a presence return, so the operator lands on stale cards until a manual refresh.
    if (target === "board") {
      // P29 stale-session self-heal. A fresh token reveals the board at once (no network, no delay). An
      // EXPIRED token is validated with ONE bounded refresh; if that fails (timed out, errored, or the
      // refresh token is invalid) the stale session is cleared ONCE and the operator sign-in card is shown,
      // never a blank hang. A corrupt or expired token can never lock the app.
      if (sessionExpired()) { healExpiredThenStart(); return; }
      finish(); return;
    }
    if (target === "passcode") { try { sessionStorage.removeItem(KEY); } catch (e) { gnote("gate token clear", e); } clearOperatorSession(); }
    else if (!operatorPresent()) { clearOperatorSession(); }   // lobby via a 30 to 45 minute idle drop
    document.documentElement.classList.add("gate-locked");
    buildGate(target);
  }

  // P48 gate-first boot: gate.js is emitted after <body>'s section markup and after config + supabase, so
  // document.body already exists and gate.js' dependencies (THRIVE_CONFIG, ThriveSupa) are satisfied when
  // this runs. There is therefore no reason to wait for DOMContentLoaded, which does not fire until app.js
  // (~874 KB) and every other module finish parsing; waiting is what made the login door boot AFTER the
  // whole application. Call start() immediately, guarded against a double init. The gate now paints before
  // app.js, not after it.
  if (!window.__gateStarted) {
    window.__gateStarted = true;
    start();
  }

  // Operator sign-out is the ONLY manual auth action besides sign-in (the Lock control is removed). It ends
  // the Supabase session and keeps the passcode presence, so the reload lands on the lobby (the operator
  // email step), never the passcode and never a blank board.
  window.thriveSignOut = async function () {
    var S = supa();
    try { if (S && S.signOut) await S.signOut(); } catch (e) { gnote("sign-out", e); }
    location.reload();
  };
})();
