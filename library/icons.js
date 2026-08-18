/* ============================================================================
   Thrive Console · the symbol set

   Twenty-two symbols, one sprite, defined once near the top of the body and
   referenced by <use> everywhere else. Stroke only, 20 by 20, 1.6 wide, round
   caps and joins, inheriting currentColor, so a symbol is never a second colour
   decision after the text beside it.

   ---------------------------------------------------------------------------
   THE RULE THAT COST THRIVE ONCE
   ---------------------------------------------------------------------------
   Every <svg> that references a symbol carries explicit width and height
   attributes. A viewBox on the symbol is not enough: Safari infers a size from
   the referenced symbol and Chromium on Windows does not, so a sprite that looks
   correct on the iPad it was built on renders as a 300 by 150 blank on a laptop.
   icon() is the only way a symbol reaches the document, and it always writes
   both attributes, so there is no path that can forget.

   Decoration beside a label, so aria-hidden and the label carries the meaning.
   A symbol standing alone gets a real <title> instead, because an unlabelled
   control is a control only its author can use.
   ============================================================================ */
(function (global) {
  "use strict";

  /* Twenty-two. Each one is a thing the console actually does, and an unused
     symbol is deleted rather than kept in case. */
  var P = {
    send:    '<path d="M18 3 3 9l5.5 2.4L11 17z"/><path d="m8.5 11.4 3.2-3.2"/>',
    mail:    '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m2.5 6.5 7.5 5 7.5-5"/>',
    link:    '<path d="M8.5 11.5a3 3 0 0 0 4.4.3l2.6-2.6a3 3 0 0 0-4.3-4.3l-1.1 1.1"/><path d="M11.5 8.5a3 3 0 0 0-4.4-.3L4.5 10.8a3 3 0 0 0 4.3 4.3l1.1-1.1"/>',
    copy:    '<rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
    page:    '<path d="M11.5 2.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z"/><path d="M11.5 2.5V7H16"/>',
    text:    '<path d="M11.5 2.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z"/><path d="M11.5 2.5V7H16"/><path d="M7 11h6M7 14h4"/>',
    edit:    '<path d="M3 17h14"/><path d="M12.2 3.8a1.8 1.8 0 0 1 2.5 2.5L7.5 13.5 4 14.5l1-3.5z"/>',
    clock:   '<circle cx="10" cy="10" r="7"/><path d="M10 5.8V10l2.6 1.7"/>',
    check:   '<path d="m4 10.5 3.8 3.8L16 6"/>',
    alert:   '<path d="M10 3 2.5 16.5h15z"/><path d="M10 8v3.6M10 14h.01"/>',
    archive: '<rect x="2.5" y="6.5" width="15" height="10" rx="2"/><path d="M2.5 9.5h5l1 1.6h3l1-1.6h5"/><path d="M5.5 6.5v-3h9v3"/>',
    "import":'<path d="M10 3v8.5"/><path d="m6.5 8.5 3.5 3.5 3.5-3.5"/><path d="M3.5 13v2A1.5 1.5 0 0 0 5 16.5h10a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
    drag:    '<circle cx="7.5" cy="5" r="1.1"/><circle cx="12.5" cy="5" r="1.1"/><circle cx="7.5" cy="10" r="1.1"/><circle cx="12.5" cy="10" r="1.1"/><circle cx="7.5" cy="15" r="1.1"/><circle cx="12.5" cy="15" r="1.1"/>',
    chevron: '<path d="m6 8 4 4 4-4"/>',
    close:   '<path d="M5 5l10 10M15 5 5 15"/>',
    search:  '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 3.5 3.5"/>',
    filter:  '<path d="M3 5h14"/><path d="M6 10h8"/><path d="M8.5 15h3"/>',
    spark:   '<path d="M10 2.5v3.2M10 14.3v3.2M2.5 10h3.2M14.3 10h3.2"/><path d="M10 6.8 11.2 10 10 13.2 8.8 10z"/>',
    channel: '<circle cx="10" cy="10" r="2.4"/><path d="M14.6 5.4a6.5 6.5 0 0 1 0 9.2M5.4 14.6a6.5 6.5 0 0 1 0-9.2"/>',
    undo:    '<path d="M4 9.5h8.5a4 4 0 0 1 0 8H8"/><path d="M7 6 3.5 9.5 7 13"/>',
    lock:    '<rect x="4.5" y="9" width="11" height="7.5" rx="1.8"/><path d="M7 9V6.8a3 3 0 0 1 6 0V9"/>',
    globe:   '<circle cx="10" cy="10" r="7"/><path d="M3 10h14"/><path d="M10 3a11 11 0 0 1 0 14 11 11 0 0 1 0-14z"/>',
    eye:     '<path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.3"/>',
    trash:   '<path d="M4 6h12"/><path d="M7 6V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6"/><path d="M5.5 6l.8 9a1.6 1.6 0 0 0 1.6 1.5h4.2a1.6 1.6 0 0 0 1.6-1.5l.8-9"/><path d="M8.5 9v5M11.5 9v5"/>'
  };

  var NAMES = Object.keys(P);
  var SPRITE_ID = "thriveSprite";

  /* The sprite itself. Hidden without display:none, because a display:none SVG
     cannot be referenced by <use> in some engines and the symbols would silently
     render as nothing. */
  function sprite() {
    var out = '<svg id="' + SPRITE_ID + '" width="0" height="0" aria-hidden="true" focusable="false" ' +
      'style="position:absolute;width:0;height:0;overflow:hidden">';
    NAMES.forEach(function (n) {
      out += '<symbol id="i-' + n + '" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + P[n] + "</symbol>";
    });
    return out + "</svg>";
  }

  /* opts.size  pixels, default 18
     opts.title when the symbol stands alone and must name itself
     opts.cls   extra classes */
  function icon(name, opts) {
    if (!P[name]) return "";
    opts = opts || {};
    var size = opts.size || 18;
    var cls = "ic" + (opts.cls ? " " + opts.cls : "");
    var labelled = !!opts.title;
    return '<svg class="' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 20 20" ' +
      (labelled ? 'role="img"' : 'aria-hidden="true"') + ' focusable="false">' +
      (labelled ? "<title>" + String(opts.title).replace(/[<>&]/g, "") + "</title>" : "") +
      '<use href="#i-' + name + '" width="20" height="20"/></svg>';
  }

  /* Fills every data-icon in a scope. Idempotent, and it checks for the symbol
     rather than trusting its own marker: applyLang rewrites the innerHTML of
     every element carrying data-i18n, which throws the icon away and leaves the
     marker behind. Without this check, switching language emptied every icon
     that shared an element with a translated label. */
  function applyIcons(root) {
    var scope = root || document;
    if (!document.getElementById(SPRITE_ID)) {
      var host = document.createElement("div");
      host.innerHTML = sprite();
      document.body.insertBefore(host.firstChild, document.body.firstChild);
    }
    var list = scope.querySelectorAll("[data-icon]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var name = el.getAttribute("data-icon");
      if (el.getAttribute("data-icon-done") === name && el.querySelector("svg.ic")) continue;
      var svg = icon(name, { size: el.getAttribute("data-icon-size") || 18 });
      if (!svg) continue;
      el.insertAdjacentHTML("afterbegin", svg);
      el.setAttribute("data-icon-done", name);
      el.classList.add("has-ic");
    }
  }

  global.thriveIcon = icon;
  global.thriveSprite = sprite;
  global.applyIcons = applyIcons;
  global.THRIVE_ICON_NAMES = NAMES;
})(typeof window !== "undefined" ? window : this);
