/* Thrive Console — access gate (client-side).
   NOTE: This is a static site on a PUBLIC repo, so this gate deters casual
   access to the console UI but is not a cryptographic boundary. For true
   protection host the console behind server auth (private repo + Pages Pro,
   Netlify Identity, or Cloudflare Access). The public opp/ result pages are
   intentionally left open so prospects can view a shared link with no gate. */
(function () {
  "use strict";
  var KEY = "thrive_gate_v1";
  var HASH = "e00475a9bf66c48e332882a90f2638d0bf2f37272572f60ff0ca41e49f6e7c06"; // sha256("ConThrive2030")

  var STR = {
    en: { title: "Thrive Console", sub: "Private workspace. Enter the passcode to continue.",
          ph: "Passcode", go: "Unlock", err: "Incorrect passcode. Try again.",
          note: "Prospect result pages stay public — only the console is protected." },
    ar: { title: "كونسول ثرايف", sub: "مساحة خاصة. أدخل رمز الدخول للمتابعة.",
          ph: "رمز الدخول", go: "فتح", err: "رمز غير صحيح. حاول مجددًا.",
          note: "صفحات نتائج العملاء تبقى عامة — الكونسول وحده محميّ." }
  };
  function lang() { try { return localStorage.getItem("thrive_lang") === "ar" ? "ar" : "en"; } catch (e) { return "en"; } }

  async function sha256Hex(str) {
    var data = new TextEncoder().encode(str);
    var buf = await crypto.subtle.digest("SHA-256", data);
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }
  function authed() { try { return sessionStorage.getItem(KEY) === HASH; } catch (e) { return false; } }

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
    setTimeout(function () { input.focus(); }, 50);

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var val = input.value || "";
      if (!val) { return; }
      var h;
      try { h = await sha256Hex(val); } catch (ex) { h = null; }
      if (h === HASH) {
        try { sessionStorage.setItem(KEY, HASH); } catch (ex) {}
        if (typeof window.logActivity === "function") {
          try { window.logActivity("login", "", "console unlocked"); } catch (ex) {}
        }
        reveal();
        if (typeof window.onGateUnlocked === "function") { try { window.onGateUnlocked(); } catch (ex) {} }
      } else {
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
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  };
})();
