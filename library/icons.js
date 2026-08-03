/* ============================================================================
   Thrive Console · icons

   One family, drawn on a 24 grid, 1.6 stroke, round caps and joins, no fills and
   no colour of their own. They inherit currentColor, so an icon is never a second
   decision after the text it sits beside: it is the same decision.

   Why they exist: a console that is only words asks the reader to parse a sentence
   to find the thing they do twenty times a day. An icon is a handle. It is warmth
   in the sense that a well-worn tool is warm, not in the sense of decoration, so
   there is exactly one per idea and none anywhere else.

   Usage: <span data-icon="send"></span>, or icon("send") in a template string.
   applyIcons() fills every data-icon in the document and is idempotent, so it can
   be called again after any render.
   ============================================================================ */
(function (global) {
  "use strict";

  var P = {
    /* destinations */
    board:    '<path d="M4 5h5v14H4zM10 5h5v9h-5zM16 5h4v6h-4z"/>',
    insights: '<path d="M4 19V9M10 19V5M16 19v-6M21 19H3"/>',
    library:  '<path d="M4 6a2 2 0 0 1 2-2h5v16H6a2 2 0 0 1-2-2z"/><path d="M11 4h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    lock:     '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',

    /* the journey, one per lane */
    draft:    '<path d="M4 20h16"/><path d="M14.5 4.5a2.1 2.1 0 0 1 3 3L9 16l-4 1 1-4z"/>',
    ready:    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    sent:     '<path d="M21 4 3 11l7 3 3 7z"/><path d="m10 14 4-4"/>',
    opened:   '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
    replied:  '<path d="m9 15-5-5 5-5"/><path d="M4 10h9a7 7 0 0 1 7 7v2"/>',
    closed:   '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h6l1 2h4l1-2h6"/><path d="M7 8V5h10v3"/>',

    /* things you do */
    send:     '<path d="M21 4 3 11l7 3 3 7z"/>',
    write:    '<path d="M4 20h16"/><path d="M14.5 4.5a2.1 2.1 0 0 1 3 3L9 16l-4 1 1-4z"/>',
    page:     '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    upload:   '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    add:      '<path d="M12 5v14M5 12h14"/>',
    search:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    refresh:  '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/>',
    check:    '<path d="m5 13 4 4L19 7"/>',
    close:    '<path d="M6 6 18 18M18 6 6 18"/>',
    drag:     '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',

    /* how you reach somebody */
    email:    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    form:     '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    dm:       '<path d="M21 12a8 8 0 1 1-3.2-6.4"/><path d="M21 4v5h-5"/><circle cx="12" cy="12" r="3"/>',
    whatsapp: '<path d="M4 20l1.2-3.6A8 8 0 1 1 8 19z"/>',
    other:    '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>',

    /* states and notes */
    warn:     '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
    info:     '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    clock:    '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    person:   '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    sparkle:  '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M12 8.5 13.4 12 12 15.5 10.6 12z"/>'
  };

  function icon(name, extra) {
    var d = P[name];
    if (!d) return "";
    return '<svg class="ic' + (extra ? " " + extra : "") + '" viewBox="0 0 24 24" ' +
      'width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      d + "</svg>";
  }

  /* Decoration, never information: an icon is placed beside a label, so it is
     hidden from assistive technology and the label carries the meaning. */
  function applyIcons(root) {
    var scope = root || document;
    var list = scope.querySelectorAll("[data-icon]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var name = el.getAttribute("data-icon");
      /* The attribute alone is not proof. applyLang rewrites the innerHTML of every element
         carrying data-i18n, which throws the icon away and leaves the marker behind, so the
         marker is checked against the icon actually in the element. Without this, switching
         language emptied every icon that shared an element with a translated label. */
      if (el.getAttribute("data-icon-done") === name && el.querySelector("svg.ic")) continue;
      var svg = icon(name);
      if (!svg) continue;
      el.insertAdjacentHTML("afterbegin", svg);
      el.setAttribute("data-icon-done", name);
      el.classList.add("has-ic");
    }
  }

  global.thriveIcon = icon;
  global.applyIcons = applyIcons;
  global.THRIVE_ICONS = P;
})(typeof window !== "undefined" ? window : this);
