/* Three kinds, one logic.
   =========================================================================

   The review named a real confusion and it is structural, not cosmetic. Three
   different objects were handled through overlapping paths, so nobody could
   predict what uploading a file would do.

     page template   an HTML skeleton with named fields, built to be filled
     finished offer  a complete page for one named prospect, already written
     outreach text   the words that carry the offer

   The rule that ends the overlap, and it is printed at the top of the Library:

     The Library holds only what gets reused. Anything belonging to one prospect
     lives on that opportunity.

   THE FIELD SYNTAX WAS NOT INVENTED HERE
   {{TOKEN}} is what templates/en-opp1 and templates/ar-opp1 already use, and
   <!--QUOTE_START--> ... <!--QUOTE_END--> is the one conditional they already
   carry. This module reads that contract; it does not propose a new one.
   docs/TEMPLATES.md records where the two shipped templates disagree.

   Pure: no DOM, no storage, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThriveKinds = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KINDS = ["page-template", "offer"];
  var LOCALES = ["EN", "AR"];

  /* The eight tokens the shipped templates use. SUBJECT is DERIVED: fillTemplate
     computes it from the business name, a person never fills it, and it is in
     neither meta.json. So it is known, and it does not count as a field. */
  var KNOWN_FIELDS = ["BIZ", "QUOTE", "QUOTE_BY", "PROOF1", "PROOF2", "PROOF3", "WANT"];
  var DERIVED_FIELDS = ["SUBJECT"];

  var FIELD_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

  function str(v) { return v == null ? "" : String(v); }
  function has(a, v) { return a.indexOf(v) >= 0; }

  /* ---------- reading the declaration ------------------------------------ */

  /* Parsed with a regular expression rather than DOMParser on purpose: this
     module is pure and is exercised in node as well as in a browser, and the
     three attributes it wants are simple enough that a parser would be the more
     fragile choice, not the less. Attribute order is not assumed. */
  function metaContent(html, name) {
    var re = new RegExp(
      "<meta[^>]*name\\s*=\\s*[\"']" + name + "[\"'][^>]*>", "i");
    var tag = re.exec(str(html));
    if (!tag) {
      re = new RegExp("<meta[^>]*content\\s*=\\s*[\"']([^\"']*)[\"'][^>]*name\\s*=\\s*[\"']" +
                      name + "[\"'][^>]*>", "i");
      var alt = re.exec(str(html));
      return alt ? alt[1].trim() : "";
    }
    var c = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
    return c ? c[1].trim() : "";
  }

  function normLocale(v) {
    var s = str(v).trim().toUpperCase();
    if (s === "EN" || s === "ENGLISH") return "EN";
    if (s === "AR" || s === "ARABIC") return "AR";
    return "";
  }

  function titleOf(html) {
    var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(str(html));
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
  }

  /* ---------- reading the fields ----------------------------------------- */

  function fieldsIn(html) {
    var s = str(html), out = [], seen = {}, m;
    FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(s))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      out.push(m[1]);
    }
    return out;
  }

  /* The fields a person fills, which is what decides whether a file is a
     template at all. A page carrying only {{SUBJECT}} has nothing to fill. */
  function fillableFields(html) {
    return fieldsIn(html).filter(function (f) { return !has(DERIVED_FIELDS, f); });
  }

  function unknownFields(html) {
    return fillableFields(html).filter(function (f) { return !has(KNOWN_FIELDS, f); });
  }

  function usesQuoteBlock(html) {
    var s = str(html);
    return s.indexOf("<!--QUOTE_START-->") >= 0 && s.indexOf("<!--QUOTE_END-->") >= 0;
  }

  /* ---------- the decision ------------------------------------------------ */

  /* Never guesses. When the file does not say what it is, the answer is "ask",
     and the caller shows the name and a preview and offers two choices. Guessing
     from field count would file a finished page with a stray token as a template
     and a minimal template as a page, and both failures are silent. */
  function classify(html, filename) {
    var declared = str(metaContent(html, "thrive-kind")).toLowerCase();
    var locale = normLocale(metaContent(html, "thrive-locale"));
    var name = metaContent(html, "thrive-name") || titleOf(html) || str(filename).replace(/\.html?$/i, "");

    var out = {
      kind: "",
      declaredKind: declared,
      locale: locale,
      name: name,
      nameFromFile: !metaContent(html, "thrive-name"),
      fields: fillableFields(html),
      derived: fieldsIn(html).filter(function (f) { return has(DERIVED_FIELDS, f); }),
      unknown: unknownFields(html),
      quoteBlock: usesQuoteBlock(html),
      ask: false,
      ok: true,
      error: "",
      warnings: []
    };

    if (declared && !has(KINDS, declared)) {
      out.ok = false;
      out.error = "kd_err_kind";
      out.errorDetail = declared;
      return out;
    }

    if (!declared) { out.ask = true; return out; }
    out.kind = declared;

    if (declared === "offer") return out;

    /* From here it is a page template, and two things are refusals rather than
       warnings, because both produce something that cannot work. */
    if (!locale) {
      out.ok = false;
      out.error = "kd_err_locale";
      return out;
    }
    if (!out.fields.length) {
      out.ok = false;
      out.error = "kd_err_nofields";
      return out;
    }
    /* An unknown field is accepted, and NAMED. It substitutes as empty, which is
       a usable template with a hole in it, and the person is told which hole
       rather than discovering it on a published page. */
    if (out.unknown.length) out.warnings.push({ code: "kd_warn_unknown", fields: out.unknown.slice() });
    return out;
  }

  /* Deciding after the console asked. The answer is a kind, and everything else
     is re-derived, so a person answering "page template" still gets the locale
     refusal if the file has no locale. */
  function decide(html, filename, kind) {
    var s = str(html);
    if (!has(KINDS, kind)) return { ok: false, error: "kd_err_kind", kind: kind };
    /* Injecting the answer into the document is what makes the decision
       durable. Re-uploading the same file next month asks nothing, and the file
       on disk now says what it is. */
    var declared = s.replace(/<head([^>]*)>/i,
      '<head$1>\n<meta name="thrive-kind" content="' + kind + '">');
    if (declared === s) declared = '<meta name="thrive-kind" content="' + kind + '">\n' + s;
    var r = classify(declared, filename);
    r.html = declared;
    return r;
  }

  /* ---------- the blank skeleton ----------------------------------------- */

  /* Built from a template that already works rather than written from scratch,
     so the first upload is not blind. The content is emptied; the declarations,
     the fields and the conditional block survive, because those are the contract
     and a skeleton that drops them teaches the wrong one. */
  function blankFrom(html, locale, name) {
    var loc = normLocale(locale) || "EN";
    var s = str(html);

    /* Strip the head of any declaration it already has, then write ours once. */
    s = s.replace(/<meta[^>]*name\s*=\s*["']thrive-(kind|locale|name)["'][^>]*>\s*/gi, "");
    var decl = '\n<meta name="thrive-kind" content="page-template">' +
               '\n<meta name="thrive-locale" content="' + loc.toLowerCase() + '">' +
               '\n<meta name="thrive-name" content="' + str(name).replace(/"/g, "&quot;") + '">\n';
    if (/<head([^>]*)>/i.test(s)) s = s.replace(/<head([^>]*)>/i, "<head$1>" + decl);
    else s = decl + s;
    return s;
  }

  /* ---------- self test --------------------------------------------------- */

  function selfTest() {
    var f = [];
    var head = '<!DOCTYPE html><html><head><title>A page</title>';

    var tpl = head +
      '<meta name="thrive-kind" content="page-template">' +
      '<meta name="thrive-locale" content="ar">' +
      '<meta name="thrive-name" content="عرض يومي">' +
      '</head><body><h1>{{BIZ}}</h1><p>{{PROOF1}} {{PROOF2}} {{PROOF3}} {{WANT}}</p>' +
      '<!--QUOTE_START--><q>{{QUOTE}}</q><cite>{{QUOTE_BY}}</cite><!--QUOTE_END-->' +
      '<a href="mailto:x?subject={{SUBJECT}}">go</a></body></html>';

    var a = classify(tpl, "daily.html");
    if (a.kind !== "page-template") f.push("declared kind, got " + a.kind);
    if (a.locale !== "AR") f.push("locale must normalise to AR, got " + a.locale);
    if (a.name !== "عرض يومي") f.push("name from the declaration, got " + a.name);
    if (a.fields.length !== 7) f.push("seven fillable fields, got " + a.fields.join(","));
    if (has(a.fields, "SUBJECT")) f.push("SUBJECT is derived and is not a field");
    if (!has(a.derived, "SUBJECT")) f.push("SUBJECT must still be reported as derived");
    if (!a.quoteBlock) f.push("the quote block must be detected");
    if (!a.ok || a.warnings.length) f.push("a good template must be accepted with no warning");

    // an offer routes straight through, with no field rules applied
    var offer = head + '<meta name="thrive-kind" content="offer"></head><body><h1>Real Co</h1></body></html>';
    var b = classify(offer, "realco.html");
    if (b.kind !== "offer" || !b.ok) f.push("an offer must be accepted, got " + b.kind);
    if (b.ask) f.push("a declared offer must not be asked about");

    // nothing declared: ask, never guess
    var bare = head + '</head><body><h1>{{BIZ}}</h1></body></html>';
    var c = classify(bare, "mystery.html");
    if (!c.ask) f.push("an undeclared file must be asked about");
    if (c.kind) f.push("an undeclared file must not be classified, got " + c.kind);
    if (c.name !== "A page") f.push("it falls back to the title, got " + c.name);
    var noTitle = classify("<html><body>{{BIZ}}</body></html>", "from-file.html");
    if (noTitle.name !== "from-file") f.push("then to the filename, got " + noTitle.name);
    if (!noTitle.nameFromFile) f.push("and it says the name came from the file");

    // zero fields is not a template
    var empty = head + '<meta name="thrive-kind" content="page-template">' +
                '<meta name="thrive-locale" content="en"></head><body><h1>Done</h1></body></html>';
    var d = classify(empty, "done.html");
    if (d.ok || d.error !== "kd_err_nofields") f.push("zero fields must be refused, got " + d.error);
    var onlyDerived = head + '<meta name="thrive-kind" content="page-template">' +
                      '<meta name="thrive-locale" content="en"></head><body>{{SUBJECT}}</body></html>';
    if (classify(onlyDerived, "x.html").error !== "kd_err_nofields")
      f.push("a page with only a derived token has nothing to fill");

    // a page template with no locale belongs to neither library
    var noLoc = head + '<meta name="thrive-kind" content="page-template"></head><body>{{BIZ}}</body></html>';
    var e = classify(noLoc, "x.html");
    if (e.ok || e.error !== "kd_err_locale") f.push("no locale must be refused, got " + e.error);

    // an unknown field is accepted and named
    var odd = head + '<meta name="thrive-kind" content="page-template">' +
              '<meta name="thrive-locale" content="en"></head><body>{{BIZ}} {{FOOTNOTE}}</body></html>';
    var g = classify(odd, "x.html");
    if (!g.ok) f.push("an unknown field must not refuse the template");
    if (!g.warnings.length || g.warnings[0].fields[0] !== "FOOTNOTE")
      f.push("an unknown field must be named, got " + JSON.stringify(g.warnings));

    // a kind nobody recognises is refused with the reason
    var wrong = head + '<meta name="thrive-kind" content="brochure"></head><body>{{BIZ}}</body></html>';
    var h = classify(wrong, "x.html");
    if (h.ok || h.error !== "kd_err_kind") f.push("an unknown kind must be refused, got " + h.error);

    // answering the question writes the answer into the file
    var decided = decide(bare, "mystery.html", "offer");
    if (decided.kind !== "offer") f.push("deciding must classify, got " + decided.kind);
    if (decided.html.indexOf('content="offer"') < 0) f.push("the answer must be written into the file");
    if (classify(decided.html, "x.html").ask) f.push("and re-reading it must not ask again");
    // and answering does not skip the refusals
    var decidedTpl = decide(bare, "mystery.html", "page-template");
    if (decidedTpl.error !== "kd_err_locale")
      f.push("answering page-template on a file with no locale must still refuse");

    // attribute order is not assumed
    var reversed = '<html><head><meta content="offer" name="thrive-kind"></head><body>x</body></html>';
    if (classify(reversed, "x.html").kind !== "offer") f.push("attribute order must not matter");

    // the blank skeleton keeps the contract
    var blank = blankFrom(tpl, "en", "Blank English");
    var bl = classify(blank, "blank.html");
    if (bl.kind !== "page-template") f.push("a blank skeleton is a page template");
    if (bl.locale !== "EN") f.push("its locale is the one asked for, got " + bl.locale);
    if (bl.name !== "Blank English") f.push("its name is the one asked for, got " + bl.name);
    if (bl.fields.length !== 7) f.push("it keeps every field, got " + bl.fields.length);
    if (!bl.quoteBlock) f.push("it keeps the conditional block");
    if ((blank.match(/thrive-kind/g) || []).length !== 1) f.push("it declares itself exactly once");

    return { pass: !f.length, failures: f };
  }

  return {
    KINDS: KINDS,
    LOCALES: LOCALES,
    KNOWN_FIELDS: KNOWN_FIELDS,
    DERIVED_FIELDS: DERIVED_FIELDS,
    metaContent: metaContent,
    normLocale: normLocale,
    fieldsIn: fieldsIn,
    fillableFields: fillableFields,
    unknownFields: unknownFields,
    usesQuoteBlock: usesQuoteBlock,
    classify: classify,
    decide: decide,
    blankFrom: blankFrom,
    selfTest: selfTest
  };
});
