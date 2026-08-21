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
  /* P42 idempotence. The shell carries this file BOTH inlined (parse-time, cannot 404) and as a first
     src tag (survives a stale shell whose inline block was stripped). Whichever runs first installs the
     failsafe and marks the tab; the second copy is a no-op, so there is never a second strip, a second
     listener set, or a fought-over accessor. */
  try { if (window.__thriveFailsafeLoaded) return; window.__thriveFailsafeLoaded = true; } catch (e) {}
  var shown = false;

  function meta(name) { try { var m = document.querySelector('meta[name="' + name + '"]'); return (m && m.getAttribute("content")) || ""; } catch (e) { return ""; } }
  function buildStamp() { return meta("thrive-build") || "(unknown)"; }
  // Existence only. The token value is never read into a variable, never printed, never embedded.
  function sessionPresent() { try { return localStorage.getItem("console_sb_session") ? "present" : "null"; } catch (e) { return "unknown"; } }
  function ephemeral() { try { return (window.ThriveSupa && window.ThriveSupa.sessionEphemeral) ? String(window.ThriveSupa.sessionEphemeral()) : "unknown"; } catch (e) { return "unknown"; } }
  // Count only, recorded by the app where the board payload is already parsed. Never the rows themselves.
  function boardRows() { try { return (typeof window.__boardRows === "number") ? String(window.__boardRows) : "unknown"; } catch (e) { return "unknown"; } }
  function checkpoint() { try { return String(window.__bootMark || "(none)"); } catch (e) { return "(none)"; } }

  /* P41 heartbeat. A synchronous one-line strip created at PARSE TIME on every document, before any other
     script, so its presence, its frozen value, or its absence is itself the datum when even the P40 panel
     stays silent:
       - never appears on the black screen  -> branch A: the post-sign-in document is dead (the failsafe
         never ran there), a routing/404/stale-shell defect on that document;
       - frozen at a mark                   -> branch B: the main thread is synchronously blocked, and the
         mark NAMES the step holding it (parse / merge / paint);
       - reaches "board painted" over black -> branch C: the board painted invisibly, a CSS/scope defect.
     It shows "boot <mark> · build <stamp>", updates on every checkpoint, appends "rows <n>" at
     payload-parsed (count only, never content), and REMOVES itself 3s after the board paints, so a healthy
     boot shows a brief line and loses it (the P36 no-lingering-diagnostics spirit). It is driven off the
     existing P40 checkpoint globals via accessors, so it needs ZERO further change to the app. Temporary:
     deleted in the closing PR of this outage. */
  var _mark; try { _mark = window.__bootMark; } catch (e) {}
  var _rows; try { _rows = window.__boardRows; } catch (e) {}
  var _painted; try { _painted = window.__bootPainted; } catch (e) {}
  var strip = null, stripGone = false, removeTimer = null;
  function stripText() {
    var t = "boot " + (_mark || "start") + " · build " + buildStamp();
    if (typeof _rows === "number") t += " · rows " + _rows;
    return t;
  }
  function ensureStrip() {
    if (strip || stripGone) return;
    try {
      strip = document.createElement("div");
      strip.id = "thriveHeartbeat"; strip.setAttribute("dir", "ltr");
      strip.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483646;margin:0;padding:4px 10px;" +
        "background:#111318;color:#9ca3af;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;-webkit-text-size-adjust:100%";
      strip.textContent = stripText();
      (document.body || document.documentElement).appendChild(strip);
    } catch (e) {}
  }
  function updateStrip() { if (strip && !stripGone) { try { strip.textContent = stripText(); } catch (e) {} } }
  function removeStrip() { stripGone = true; try { if (strip && strip.parentNode) strip.parentNode.removeChild(strip); } catch (e) {} strip = null; }
  // Intercept the assignments the app already makes (P40) so each one drives the heartbeat; reads still
  // return the stored value, so the P40 panel and watchdog read exactly what they did before.
  try {
    Object.defineProperty(window, "__bootMark", { configurable: true, get: function () { return _mark; }, set: function (v) { _mark = v; ensureStrip(); updateStrip(); } });
    Object.defineProperty(window, "__boardRows", { configurable: true, get: function () { return _rows; }, set: function (v) { _rows = v; updateStrip(); } });
    Object.defineProperty(window, "__bootPainted", { configurable: true, get: function () { return _painted; }, set: function (v) { _painted = v; if (v) { try { if (removeTimer) clearTimeout(removeTimer); } catch (e) {} removeTimer = setTimeout(removeStrip, 3000); } } });
  } catch (e) {}
  ensureStrip();   // render the heartbeat NOW, at parse time, before any module runs

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

  /* P42 GAP 3, the reveal guarantee. Whenever the panel fires, the static shell must stop being hidden:
     diagnostics over a black void help less than diagnostics over the visible shell. The shell is hidden
     by the `gate-locked` class on <html> (styles.css: html.gate-locked .top/.wrap display:none), removed
     in a healthy boot by gate.js reveal(). A dead boot never reaches reveal(), so the failsafe removes it
     here, restores body scrolling, and drops any stranded gate overlay. Black becomes impossible: either
     the app painted, or the shell + this panel are visible. */
  function revealShell() {
    try { document.documentElement.classList.remove("gate-locked"); } catch (e) {}
    try { if (document.body) document.body.style.overflow = ""; } catch (e) {}
    try { var g = document.getElementById("thriveGate"); if (g && g.parentNode) g.parentNode.removeChild(g); } catch (e) {}
  }

  function panel(headEn, headAr, err) {
    if (shown) return; shown = true;
    revealShell();
    var root = document.documentElement;
    var box = document.createElement("div");
    box.id = "thriveFailsafe";
    box.setAttribute("dir", "ltr");
    // A top sheet, not a full-screen cover (P42): the revealed shell stays visible beneath it, so the
    // photograph carries both the diagnostics and the state of the page they describe.
    box.style.cssText = "position:fixed;top:0;left:0;right:0;max-height:75vh;z-index:2147483647;overflow:auto;-webkit-overflow-scrolling:touch;" +
      "background:#0a0a0c;color:#e5e7eb;border-bottom:1px solid #2a2f3a;box-shadow:0 12px 40px rgba(0,0,0,.6);" +
      "font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:22px;-webkit-text-size-adjust:100%";
    var h = document.createElement("p");
    h.style.cssText = "margin:0 0 16px;font-weight:700;font-size:15px;line-height:1.4";
    h.textContent = headEn + "   ·   " + headAr; box.appendChild(h);

    if (err && err.resourceUrl) {
      // P42 GAP 1: a resource death names its URL (URL only, never content).
      pair(box, "Resource failed: " + err.resourceUrl, "تعذّر تحميل المورد: " + err.resourceUrl);
    } else if (err) {
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
  /* P42 GAP 1: a 404ing script or stylesheet fires its error on the ELEMENT, which never bubbles to the
     window listener above; a document whose app.js 404s died mute by construction. Capture-phase sees it.
     A resource target (script/link/img with a URL) panels with the failing URL only, never content; a
     plain uncaught error passing through capture is left for the bubble listener above (same panel, and
     `shown` guards a double-fire anyway). */
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (!t || t === window || !t.tagName) return;
    var url = t.src || t.href || "";
    panel("Console failed to start", "تعذّر بدء الكونسول", { resourceUrl: String(url || ("<" + t.tagName + ">")) });
  }, true);
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
  /* P42 GAP 2, the self-armed sentry. The app-armed path above depends on the app being alive enough to
     call it; if the bundle itself is dead, nothing ever arms and the death is mute. So on any document
     that carries the app marker (the thrive-build meta), the failsafe arms its OWN fallback at parse
     time. It stands down when anything legitimate painted: the board (__bootPainted) or an interactive
     gate card (__thriveBooted, set by gate.js the moment the sign-in card shows), so a signed-out
     operator reading the gate never sees it. Only a document where NOTHING painted and nothing errored
     panels here. Whichever of the two arms fires first wins; `shown` guards a double-fire. */
  try {
    if (meta("thrive-build")) {
      setTimeout(function () {
        if (shown || window.__bootPainted || window.__thriveBooted) return;
        panel("Console boot stalled", "توقّف بدء الكونسول", null);
      }, WATCHDOG_MS);
    }
  } catch (e) {}
})();
