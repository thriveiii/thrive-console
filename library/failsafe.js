/* P40 failsafe: a first-script, zero-dependency reveal surface. It exists to make a silent client death
   SPEAK. It NEVER paints a pixel in a healthy boot; it appears only on (a) an uncaught error, (b) an
   unhandled promise rejection, or (c) a boot that stalls past the watchdog after the gate resolved. It
   prints DIAGNOSTICS ONLY: error name/message/first stack line, the build stamp, the boot checkpoint, a
   ROW COUNT for the board read, and whether a session blob EXISTS in storage. It NEVER prints or embeds a
   token value or any row content. It depends on no app CSS, no app module, and no render path: it builds
   its own panel imperatively on documentElement, so it still speaks when everything else has failed.

   This is P40's whole job: reveal, not fix. Zero behavior change to auth, session, reads, or rendering. */
(function () {
  "use strict";
  var shown = false;

  function meta(name) { try { var m = document.querySelector('meta[name="' + name + '"]'); return (m && m.getAttribute("content")) || ""; } catch (e) { return ""; } }
  function buildStamp() { return meta("thrive-build") || "(unknown)"; }
  // Existence only. The token value is never read into a variable, never printed, never embedded.
  function sessionPresent() { try { return localStorage.getItem("console_sb_session") ? "present" : "null"; } catch (e) { return "unknown"; } }
  function ephemeral() { try { return (window.ThriveSupa && window.ThriveSupa.sessionEphemeral) ? String(window.ThriveSupa.sessionEphemeral()) : "unknown"; } catch (e) { return "unknown"; } }
  // Count only, recorded by the app where the board payload is already parsed. Never the rows themselves.
  function boardRows() { try { return (typeof window.__boardRows === "number") ? String(window.__boardRows) : "unknown"; } catch (e) { return "unknown"; } }
  function checkpoint() { try { return String(window.__bootMark || "(none)"); } catch (e) { return "(none)"; } }

  // One datum, EN then AR. Arabic keeps letter-spacing normal and reads right to left.
  function pair(box, en, ar) {
    var e = document.createElement("p");
    e.setAttribute("dir", "ltr");
    e.style.cssText = "margin:0;padding:2px 0;white-space:pre-wrap;word-break:break-word";
    e.textContent = en; box.appendChild(e);
    var a = document.createElement("p");
    a.setAttribute("dir", "rtl");
    a.style.cssText = "margin:0 0 12px;padding:2px 0;white-space:pre-wrap;word-break:break-word;letter-spacing:normal";
    a.textContent = ar; box.appendChild(a);
  }

  function panel(headEn, headAr, err) {
    if (shown) return; shown = true;
    var root = document.documentElement;
    var box = document.createElement("div");
    box.id = "thriveFailsafe";
    box.setAttribute("dir", "ltr");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;overflow:auto;-webkit-overflow-scrolling:touch;" +
      "background:#0a0a0c;color:#e5e7eb;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:22px;-webkit-text-size-adjust:100%";
    var h = document.createElement("p");
    h.style.cssText = "margin:0 0 16px;font-weight:700;font-size:15px;line-height:1.4";
    h.textContent = headEn + "   ·   " + headAr; box.appendChild(h);

    if (err) {
      var name = (err && err.name) || "Error";
      var msg = (err && (err.message !== undefined ? err.message : String(err))) || "(no message)";
      pair(box, "Error: " + name + ": " + msg, "الخطأ: " + name + ": " + msg);
      var at = ""; try { at = (String((err && err.stack) || "").split("\n")[1] || "").trim(); } catch (e) {}
      if (at) pair(box, "At: " + at, "عند: " + at);
    }
    pair(box, "Build: " + buildStamp(), "الإصدار: " + buildStamp());
    pair(box, "Checkpoint: " + checkpoint(), "المرحلة: " + checkpoint());
    pair(box, "Board rows: " + boardRows(), "صفوف اللوحة: " + boardRows());
    pair(box, "Session in storage: " + sessionPresent(), "الجلسة في التخزين: " + sessionPresent());
    pair(box, "Ephemeral: " + ephemeral(), "مؤقتة: " + ephemeral());

    try { root.appendChild(box); } catch (e) { try { (document.body || root).appendChild(box); } catch (x) {} }
  }

  window.addEventListener("error", function (e) {
    var err = (e && e.error) || { name: "Error", message: (e && e.message) || "script error", stack: "" };
    panel("Console failed to start", "تعذّر بدء الكونسول", err);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var err = (r && typeof r === "object") ? r : { name: "UnhandledRejection", message: (r != null ? String(r) : "promise rejected"), stack: "" };
    panel("Console failed to start", "تعذّر بدء الكونسول", err);
  });

  /* The boot watchdog. It is ARMED by the app only once the gate has resolved and the boot proper begins,
     so a signed-out gate (a legitimate non-painted state) never triggers it. If, WATCHDOG_MS after arming,
     no board state has painted (window.__bootPainted) and nothing has errored, the stall panel appears with
     the checkpoint, the row count, and the storage datum, so the operator photographs WHERE it stopped. */
  var WATCHDOG_MS = 12000;
  window.__thriveFailsafeArm = function () {
    try {
      setTimeout(function () {
        if (shown || window.__bootPainted) return;
        panel("Console boot stalled", "توقّف بدء الكونسول", null);
      }, WATCHDOG_MS);
    } catch (e) {}
  };
})();
