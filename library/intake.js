/* ============================================================================
   Thrive Console · reading a day's batch

   A working day arrives as a zip: finished pages, and one manifest that says who
   each page is for, how to reach them, and the exact words to send. Until now
   those words were retyped by hand, and the thing that decides whether a message
   lands was the thing being retyped.

   Pure. No DOM, no storage, no network. It reads text and returns records.

   ---------------------------------------------------------------------------
   THE DISCRIMINATOR, WHICH IS THE WHOLE SAFETY OF THE PARSER
   ---------------------------------------------------------------------------
   A level two heading is an opportunity IF AND ONLY IF its text begins with a
   number followed by a middle dot.

       ## 1 · Ludic Lillian (Fairfax) · handmade ceramics     an opportunity
       ## Money at a glance                                   a batch note
       ## Rejection log (today)                               a batch note

   Everything else about the format can vary between batches. This one thing
   cannot, and it is why the trailing sections can never be imported as prospects
   by accident. A parser that guessed from position, or from "does this heading
   look like a business name", would eventually file the rejection log as four
   new leads.

   ---------------------------------------------------------------------------
   WHAT IS NEVER INVENTED
   ---------------------------------------------------------------------------
   A field the manifest did not carry stays empty and is named as missing. An
   unrecognised bullet key is kept rather than discarded, because the manifest is
   written by a person and next month it will carry something this parser has not
   been told about. Losing it silently is worse than not understanding it.
   ============================================================================ */
(function (global) {
  "use strict";

  /* The separator is a middle dot in every batch so far, but a hyphen or an en
     dash reads the same to a person. Written as escapes rather than characters
     because the long dash is banned in this source, and a parser that accepts
     one is not the same thing as copy that uses one. */
  var SEP = "[\u00b7\u2013\u2014]";
  /* The heading grammar, tolerant of every shape a person actually writes. A
     heading is an optional list marker (a number, optionally closed by a paren,
     dot or colon), then an optional separator (middle dot, hyphen, en dash, em
     dash, pipe or colon), then the title. "1 dot Name", "1) Name", "1. Name",
     "N pipe Name" and a plain "Name" all parse. The producer that broke batch 13
     wrote a numbered list with a close-paren after the digit ("## 1) River-Sea
     Chocolates ..."): that paren is why the old digit-then-separator pattern
     rejected every heading and left the batch with zero sections. Capture groups:
     1 = the number (may be absent), 2 = the title. The separator characters are
     escapes, not literals, because the long dash is banned in this source.
     Because this matches a plain name too, heading SHAPE no longer decides
     opportunity-vs-note - the send-to + body gate does, at section close. */
  var HEAD_RE = new RegExp("^\\s*(\\d+)?\\s*[)\\.:]?\\s*[\u00b7\\-\u2013\u2014|:]?\\s*(.+)$");
  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  var DOMAIN_RE = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

  function plain(s) {
    return String(s == null ? "" : s)
      .replace(/\*\*/g, "").replace(/`/g, "")
      .replace(/\s+/g, " ").trim();
  }

  function blank() {
    return {
      n: 0, business: "", city: "", descriptor: "",
      channel: "", url: "", alternates: [], email: "", tier: "",
      page_file: "", slug_hint: "", subject: "",
      owner: "", owner_note: "", prohibition: "",
      body: "", extra: {}, warnings: [],
      file: null, confirm: null, match_rule: "", match_score: 0
    };
  }

  /* ---- Send to ------------------------------------------------------------
     An address if there is one, otherwise a channel. The manifest writes this as
     a sentence because a person wrote it, and it routinely names a first choice
     and a fallback: "paste the message into the form, or send as an Instagram
     DM". The first choice is the instruction, and the fallback is kept as an
     alternate rather than thrown away or promoted. */
  function readSendTo(v, e) {
    var raw = plain(v);
    e.extra["Send to"] = raw;

    var tier = raw.match(/\bTier\s+([ABC])\b/i);
    if (tier) e.tier = tier[1].toUpperCase();

    var em = raw.match(EMAIL_RE);
    if (em) {
      e.email = em[0];
      e.channel = "email";
      e.url = "mailto:" + em[0];
    }

    var form = /contact form|website form|\bform at\b/i.test(raw);
    if (form) {
      var d = raw.replace(EMAIL_RE, "").match(DOMAIN_RE);
      if (!e.channel) { e.channel = "web_form"; e.url = d ? "https://" + d[1] : ""; }
      else e.alternates.push({ channel: "web_form", url: d ? "https://" + d[1] : "" });
    }
    if (/instagram|\bIG\b|\bDM\b/i.test(raw)) {
      var h = raw.match(/@[A-Za-z0-9._]+/);
      var ig = { channel: "instagram", url: h ? "https://instagram.com/" + h[0].slice(1) : "" };
      if (!e.channel) { e.channel = ig.channel; e.url = ig.url; }
      else e.alternates.push(ig);
    }
    if (/whatsapp|wa\.me/i.test(raw)) {
      var w = raw.match(/\+?\d[\d\s()-]{6,}/);
      var wa = { channel: "whatsapp", url: w ? "https://wa.me/" + w[0].replace(/\D/g, "") : "" };
      if (!e.channel) { e.channel = wa.channel; e.url = wa.url; }
      else e.alternates.push(wa);
    }
    if (/linkedin/i.test(raw)) {
      if (!e.channel) e.channel = "linkedin";
      else e.alternates.push({ channel: "linkedin", url: "" });
    }
    if (!e.channel && raw) e.channel = "other";
  }

  function readPage(v, e) {
    var raw = plain(v);
    e.extra["Page"] = raw;
    var f = raw.match(/([A-Za-z0-9._-]+\.html?)\b/i);
    if (f) e.page_file = f[1];
    var sl = raw.match(/slug\s*\/?s?\/?([A-Za-z0-9-]+)/i);
    if (sl) e.slug_hint = sl[1].replace(/-+$/, "");
  }

  /* The owner line is a name, then often a paragraph about them, and sometimes a
     standing prohibition. All three are kept apart: the name is what the message
     is addressed to, the prohibition is a guard, and the rest is context. */
  function readOwner(v, e) {
    var raw = plain(v);
    e.extra["Owner"] = raw;
    var parts = raw.split(/standing prohibition:\s*/i);
    var head = plain((parts[0] || "").replace(/\.\s*$/, ""));
    if (parts.length > 1) e.prohibition = plain(parts[1]);
    var cut = head.match(/^([^.]+?)\.\s+(.+)$/);
    if (cut) { e.owner = plain(cut[1]); e.owner_note = plain(cut[2]); }
    else e.owner = head;
  }

  /* One heading, parsed into the business, an optional city in parentheses, and a
     trailing descriptor. The heading is matched with the tolerant grammar (so a
     numbered `1) Name` and a plain `Name` both parse); the business and descriptor
     are then split on the SEP separators (middle dot, en dash, long dash). Those
     separators, not the ordinary hyphen, are what carries a "Name to maker" title
     into business + descriptor while leaving the hyphen inside "River-Sea" intact. */
  function headEntry(text) {
    var e = blank();
    var m = text.match(HEAD_RE);
    var rest = text;
    if (m) { if (m[1]) e.n = parseInt(m[1], 10); rest = m[2]; }
    var bits = rest.split(new RegExp("\\s*" + SEP + "\\s*"));
    var head = bits.shift() || "";
    e.descriptor = plain(bits.join(" · "));
    var loc = head.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (loc) { e.business = plain(loc[1]); e.city = plain(loc[2]); }
    else e.business = plain(head);
    return e;
  }

  /* ---- the manifest -------------------------------------------------------
     Returns { entries, notes, batch }. `notes` is every trailing section, kept
     once and attached to every opportunity in the batch: the pricing floor in
     "Money at a glance" is something to read while deciding, not something to
     go and find in a file.

     Every `##` heading starts a candidate section - because the tolerant grammar
     accepts a plain name, heading shape can no longer tell an opportunity from a
     "Market Assessment" or a "Sources" section. The qualification gate decides at
     section close: a section is an opportunity only if it yields a send-to AND a
     body. Everything else is a note, folded into note_text, and never becomes a
     phantom "needs message" card. This is the P13 gate, moved to where a permissive
     heading makes it necessary. */
  function parseManifest(md) {
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    var batch = { title: "", sub: "" };
    var sections = [];          // { e, heading, raw } per `##` heading, in order
    var sec = null;             // the section currently being read
    var fence = false, buf = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^\s*```/.test(line)) {
        if (!fence) { fence = true; buf = sec ? [] : null; }
        else {
          fence = false;
          /* The FIRST fenced block in a section is the message. A later one is a
             sample or a snippet, and overwriting the message with it would send
             the wrong words. */
          if (sec && buf && !sec.e.body) sec.e.body = buf.join("\n").trim();
          buf = null;
        }
        continue;
      }
      if (fence) { if (buf) buf.push(line); continue; }

      if (/^#\s+/.test(line)) { batch.title = plain(line.replace(/^#\s+/, "")); sec = null; continue; }
      if (/^###\s+/.test(line)) {
        if (!batch.sub && !sections.length) batch.sub = plain(line.replace(/^###\s+/, ""));
        else if (sec) sec.raw.push(plain(line));
        continue;
      }
      if (/^##\s+/.test(line)) {
        var text = plain(line.replace(/^##\s+/, ""));
        sec = { e: headEntry(text), heading: text, raw: [] };
        sections.push(sec);
        continue;
      }

      if (sec) {
        if (line.trim()) sec.raw.push(line.trim());     // kept so a demoted section survives as a note
        var b = line.match(/^\s*[-*]\s*\*{0,2}([^:*]+?)\*{0,2}\s*:\s*(.*)$/);
        if (!b) continue;
        var key = plain(b[1]), val = b[2], e = sec.e;
        if (/^send to$/i.test(key)) readSendTo(val, e);
        else if (/^page$/i.test(key)) readPage(val, e);
        else if (/^subject/i.test(key)) { e.subject = plain(val); e.extra["Subject"] = e.subject; }
        else if (/^owner$/i.test(key)) readOwner(val, e);
        else e.extra[key] = plain(val);      // never discarded, even when not understood
      }
    }

    // The gate: a section becomes an opportunity only with a send-to AND a body.
    // Same predicate resolveOne uses, so the two never disagree about what an
    // opportunity is. A section that fails is a note, not a phantom card.
    var entries = [], notes = [];
    sections.forEach(function (s) {
      var e = s.e;
      var hasSend = !!(e.email || e.url || (e.channel && e.channel !== ""));
      var hasBody = !!(e.body && e.body.trim());
      if (hasSend && hasBody) entries.push(e);
      else notes.push({ heading: s.heading, body: s.raw });
    });

    entries.forEach(function (x) {
      if (!x.business) x.warnings.push("no_business");
      if (!x.body) x.warnings.push("no_body");
      if (!x.channel) x.warnings.push("no_channel");
      if (!x.page_file) x.warnings.push("no_page_named");
    });

    return {
      entries: entries,
      notes: notes,
      batch: batch,
      note_text: notes.map(function (n) {
        return "## " + n.heading + "\n" + n.body.join("\n");
      }).join("\n\n").trim()
    };
  }

  /* ---- matching pages to entries ------------------------------------------
     By the filename the manifest named, then by a filename that contains the
     business name with its punctuation removed, because "2 Faces Clothing Co."
     arrives as 2faces.html. NEVER by position: two files in the wrong order
     would send one prospect another prospect's page, and nothing downstream
     would ever notice. */
  // "&" is a word, not a separator: it always reads as "and", so "Gift & Gather" derives one slug,
  // gift-and-gather, and never a second phantom (gift-gather) that drops the ampersand. Both the match key
  // and the slug apply this rule, so a page and its manifest entry resolve to the SAME identity and merge
  // into one row instead of splitting into two. Deterministic: the same input always yields the same slug.
  function keyOf(name) {
    return String(name || "").replace(/^.*\//, "").replace(/\.html?$/i, "")
      .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  }
  function slugify(s) {
    return String(s || "").toLowerCase().replace(/['’]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  /* The identity of a dropped page (R8). A page shipped inside its own folder (opp/<slug>/index.html)
     takes the FOLDER as its identity, because the file is a generic "index.html" that would collide with
     every other folder's index. A flat page keeps its filename. This is what lets a bundle of
     opp/<slug>/index.html files resolve, where matching by the bare filename never could. */
  function folderOf(name) { var i = String(name || "").lastIndexOf("/"); return i < 0 ? "" : String(name).slice(0, i + 1); }
  function baseOf(name) { return String(name || "").replace(/^.*\//, ""); }
  function pageSlug(name) {
    var parts = String(name || "").split("/").filter(Boolean);
    var file = parts.length ? parts[parts.length - 1] : "";
    var base = file.replace(/\.html?$/i, "");
    if (parts.length >= 2 && /^(index|page|opp|opportunity|default|home)$/i.test(base)) return slugify(parts[parts.length - 2]);
    return slugify(base);
  }

  /* ---- the one matcher: token ranking (P13) -------------------------------
     A page slug and a section business are the same opportunity when their normSlug TOKENS rank a match.
     One scorer, used for every page-to-section join, so a folder page (opp/hypergoat-coffee/index.html)
     and its section ("Hypergoat Coffee Roasters") unify - which exact-slug equality alone never could,
     because slugify("Hypergoat Coffee Roasters") is "hypergoat-coffee-roasters", not the folder slug.
       exact         3  the token lists are identical
       token-prefix  2  one list is an ordered prefix of the other (hypergoat-coffee < hypergoat-coffee-roasters)
       token-subset  2  every token of one appears in the other, order aside
       overlap       1  Jaccard of the token sets is >= 0.6 (a CONFIRM, never an auto-join)
       below            no match
     `matched` is the count of shared/consumed tokens, the specificity used to break a tie between two
     pages that both rank a section: the more specific (more matched tokens) wins, the other stays open. */
  function normTokens(s) { return slugify(s).split("-").filter(Boolean); }
  function rankTokens(a, b) {
    if (!a.length || !b.length) return { score: 0, matched: 0, rule: "" };
    if (a.join("-") === b.join("-")) return { score: 3, matched: a.length, rule: "exact" };
    var sh = a.length <= b.length ? a : b, lo = a.length <= b.length ? b : a;
    if (sh.every(function (t, i) { return lo[i] === t; })) return { score: 2, matched: sh.length, rule: "token_prefix" };
    var setA = {}, setB = {}; a.forEach(function (t) { setA[t] = 1; }); b.forEach(function (t) { setB[t] = 1; });
    var subset = a.every(function (t) { return setB[t]; }) || b.every(function (t) { return setA[t]; });
    if (subset) return { score: 2, matched: Math.min(a.length, b.length), rule: "token_subset" };
    var inter = 0; Object.keys(setA).forEach(function (t) { if (setB[t]) inter++; });
    var uni = Object.keys(setA).length + Object.keys(setB).length - inter;
    var j = uni ? inter / uni : 0;
    if (j >= 0.6) return { score: 1, matched: inter, rule: "overlap" };
    return { score: 0, matched: 0, rule: "" };
  }
  // Score one page against one entry. The entry offers up to three identities - the slug it named
  // (slug_hint), its business title, and the file it named (page_file, reduced to its folder-aware slug) -
  // and the best rank against the page's slug wins. Ranking the page's FOLDER slug (never the shared
  // "index" basename) is what lets folder-shipped bundles match without every page colliding on one key.
  function scorePageEntry(pageSlugStr, page, e) {
    var pt = normTokens(pageSlugStr);
    var cands = [];
    if (e.slug_hint) cands.push(e.slug_hint);
    if (e.business) cands.push(slugify(e.business));
    if (e.page_file) cands.push(pageSlug(e.page_file));
    var best = { score: 0, matched: 0, rule: "" };
    cands.forEach(function (c) {
      var r = rankTokens(pt, normTokens(c));
      if (r.score > best.score || (r.score === best.score && r.matched > best.matched)) best = r;
    });
    return best;
  }
  function hasSendish(e) { return !!(e && (e.email || e.url || (e.channel && e.channel !== ""))); }

  /* The join, complete. Every page and every entry ends in exactly one state. Pairs are scored with the
     one ranker, assigned greedily by (score, specificity), 1:1. Score 3 or 2 and unambiguous -> the entry
     takes the page (e.file). Score 1, or a tie at the top (two pages equally specific) -> e.confirm, a
     "possible match, confirm" that is never auto-joined. No candidate -> the entry is an orphan section
     (e.file and e.confirm both unset) and the page is an orphan page. An unmatched section is a join
     failure to surface, NEVER a card to spawn: this matcher only records the verdict. */
  function match(entries, pages) {
    var P = (pages || []).map(function (p) { return { page: p, slug: pageSlug(p.name) }; });
    var E = entries || [];
    E.forEach(function (e) { e.file = e.file || null; e.confirm = null; e.match_rule = ""; e.match_score = 0; });

    var pairs = [];
    E.forEach(function (e, ei) {
      P.forEach(function (pp, pi) {
        var r = scorePageEntry(pp.slug, pp.page, e);
        if (r.score > 0) pairs.push({ ei: ei, pi: pi, score: r.score, matched: r.matched, rule: r.rule });
      });
    });
    pairs.sort(function (a, b) { return (b.score - a.score) || (b.matched - a.matched); });

    var eDone = {}, pDone = {}, used = {};
    pairs.forEach(function (pr) {
      if (eDone[pr.ei] || pDone[pr.pi]) return;
      // A tie at the top: another still-open pair with IDENTICAL score and specificity contesting the same
      // entry (two pages) or the same page (two entries). Specificity has not separated them, so confirm.
      var tie = pairs.some(function (q) {
        if (q === pr || eDone[q.ei] || pDone[q.pi]) return false;
        if (q.score !== pr.score || q.matched !== pr.matched) return false;
        return q.ei === pr.ei || q.pi === pr.pi;
      });
      var e = E[pr.ei], pp = P[pr.pi];
      if (pr.score >= 2 && !tie) {
        e.file = pp.page; e.match_rule = pr.rule; e.match_score = pr.score; used[pp.page.name] = 1;
        eDone[pr.ei] = 1; pDone[pr.pi] = 1;
      } else {                                 // score 1, or an unresolved tie: a CONFIRM, never auto-joined
        e.confirm = { page: pp.page, page_slug: pp.slug, score: pr.score, matched: pr.matched, rule: pr.rule };
        eDone[pr.ei] = 1; pDone[pr.pi] = 1;
      }
    });

    var orphanPages = P.filter(function (pp) { return !used[pp.page.name]; }).map(function (pp) { return pp.page; });
    var orphanEntries = E.filter(function (e) { return !e.file; });
    orphanEntries.forEach(function (e) { if (e.warnings.indexOf("no_page") < 0) e.warnings.push("no_page"); });

    return { matched: E.filter(function (e) { return !!e.file; }),
             orphanPages: orphanPages, orphanEntries: orphanEntries };
  }

  /* ---- an entry becomes a record ------------------------------------------
     Everything the console already understands, plus what the manifest adds.
     Draft, and nothing stronger: it is published nowhere and sent to nobody. */
  function toRecord(e, opts) {
    opts = opts || {};
    var slug = e.slug_hint || slugify(e.business) || slugify(e.page_file) || "opportunity";
    return {
      slug: slug,
      business: e.business || slug,
      template: "custom",
      sent_on: opts.today || "",
      location: e.city || "",
      phone: "",
      published: false,
      stage: "",
      fields: {},
      html: (e.file && e.file.html) || "",
      mode: "upload",
      /* the channel the lifecycle needs to record a hand send against. `to` is the bare address or
         url, never the mailto scheme: for an email channel the bare address (e.email) comes first,
         so the scheme lives only in a send action's href, not in what the console shows or seeds. */
      channel: { kind: e.channel || "", to: e.email || e.url || "", note: e.extra["Send to"] || "" },
      channel_alternates: e.alternates || [],
      contact_tier: e.tier || "",
      outreach_text: e.body || "",
      outreach_subject: e.subject || "",
      owner: e.owner || "",
      owner_note: e.owner_note || "",
      prohibition: e.prohibition || "",
      descriptor: e.descriptor || "",
      batch_note: opts.note_text || "",
      batch_title: (opts.batch && opts.batch.title) || "",
      manifest_extra: e.extra || {},
      // R8 provenance: which rung of the tolerant ladder resolved this opportunity, kept on the record so
      // the truth ("read from opp.md" vs "read from research md" vs "needs message") is visible, not guessed.
      provenance: e.provenance || "",
      needs_message: !!e.needs_message
    };
  }

  /* ---- [LINK] -------------------------------------------------------------
     Substituted on publish, with the original kept, so the substitution is
     visible and reversible rather than a one way edit of somebody's words. */
  function substituteLink(text, url) {
    return String(text == null ? "" : text).split("[LINK]").join(url || "");
  }

  function selfTest(sample) {
    var f = [];
    var md = sample || "";
    if (!md) return { pass: true, fails: ["no sample supplied, parser not exercised"], skipped: true };
    var r = parseManifest(md);

    if (r.entries.length !== 3) f.push("expected 3 opportunities, got " + r.entries.length);
    if (r.notes.length !== 5) f.push("expected 5 batch notes, got " + r.notes.length +
      " (" + r.notes.map(function (n) { return n.heading; }).join(" | ") + ")");

    var a = r.entries[0] || {}, b = r.entries[1] || {}, c = r.entries[2] || {};
    if (a.business !== "Ludic Lillian") f.push("business 1: " + a.business);
    if (a.city !== "Fairfax") f.push("city 1: " + a.city);
    if (a.channel !== "email") f.push("channel 1: " + a.channel);
    if (a.email !== "tis_herself@LudicLillian.com") f.push("email 1: " + a.email);
    if (a.tier !== "A") f.push("tier 1: " + a.tier);
    if (a.owner !== "Deborah Dillard") f.push("owner 1: " + a.owner);
    if (!/maker/.test(a.prohibition)) f.push("prohibition 1: " + a.prohibition);
    if (a.body.indexOf("Hi Deborah") !== 0) f.push("body 1 start: " + a.body.slice(0, 24));
    if (a.body.indexOf("[LINK]") < 0) f.push("body 1 lost its link slot");
    if (a.page_file !== "ludic.html") f.push("page 1: " + a.page_file);

    if (b.channel !== "web_form") f.push("channel 2: " + b.channel);
    if (b.url !== "https://wisebutterflyshop.com") f.push("url 2: " + b.url);
    if (b.tier !== "B") f.push("tier 2: " + b.tier);
    if (b.prohibition) f.push("2 has no standing prohibition, got: " + b.prohibition);
    if (b.subject !== "The women the mall forgot") f.push("subject 2: " + b.subject);

    if (c.channel !== "web_form") f.push("channel 3: " + c.channel);
    if (c.url !== "https://2faceonline.us") f.push("url 3: " + c.url);
    /* the fallback is kept as an alternate, neither promoted nor discarded */
    if (!(c.alternates || []).some(function (x) { return x.channel === "instagram"; }))
      f.push("3 must offer instagram as an alternate");
    if (!/designs the line/.test(c.prohibition)) f.push("prohibition 3: " + c.prohibition);

    /* the trailing sections are notes, never prospects */
    var headings = r.notes.map(function (n) { return n.heading; });
    ["Money at a glance", "Standing prohibitions"].forEach(function (h) {
      if (!headings.some(function (x) { return x.indexOf(h) === 0; })) f.push("missing note: " + h);
    });
    if (r.entries.some(function (x) { return /Money|Gates|Rejection/.test(x.business); }))
      f.push("a batch note was imported as a prospect");
    if (r.note_text.indexOf("2,500") < 0) f.push("the pricing floor must survive into the batch note");

    /* matching is by name, never by position */
    var pages = [{ name: "wisebutterfly.html", html: "<h1>W</h1>" },
                 { name: "2faces.html", html: "<h1>2</h1>" },
                 { name: "ludic.html", html: "<h1>L</h1>" }];
    var m = match(r.entries, pages);
    if (m.matched.length !== 3) f.push("all three should match, got " + m.matched.length);
    if ((r.entries[0].file || {}).name !== "ludic.html") f.push("ludic matched " + ((r.entries[0].file || {}).name));
    if ((r.entries[2].file || {}).name !== "2faces.html") f.push("2 faces matched " + ((r.entries[2].file || {}).name));
    if (m.orphanPages.length || m.orphanEntries.length) f.push("nothing should be orphaned here");

    /* an unmatched page and an unmatched entry are both reported by name */
    var m2 = match(parseManifest(md).entries, [{ name: "spare.html", html: "<h1>S</h1>" }]);
    if (m2.orphanPages.length !== 1) f.push("an unmatched page must be reported");
    if (m2.orphanEntries.length !== 3) f.push("unmatched entries must be reported, got " + m2.orphanEntries.length);

    var rec = toRecord(r.entries[0], { today: "2026-08-03", note_text: r.note_text, batch: r.batch });
    if (rec.slug !== "ludic") f.push("slug: " + rec.slug);
    if (rec.stage !== "") f.push("an imported record declares no stage");
    if (rec.published !== false) f.push("an imported record is not published");
    if (rec.outreach_text.indexOf("[LINK]") < 0) f.push("the record keeps the link slot");
    if (rec.channel.kind !== "email") f.push("record channel: " + rec.channel.kind);
    if (!rec.batch_note) f.push("the batch note travels with the record");
    if (rec.manifest_extra["Send to"] === undefined) f.push("unrecognised keys are kept");

    var sub = substituteLink(rec.outreach_text, "https://console.thriveiii.com/opp/ludic");
    if (sub.indexOf("[LINK]") >= 0) f.push("substitution must remove the slot");
    if (sub.indexOf("/opp/ludic") < 0) f.push("substitution must insert the address");
    if (rec.outreach_text.indexOf("[LINK]") < 0) f.push("the original must be left intact");

    return { pass: f.length === 0, fails: f };
  }

  /* ---- R8: the opportunity envelope (opp.md) ------------------------------
     One opportunity, self-describing, beside its index.html. A flat block of `key: value` lines, then a
     line that is exactly `---`, then the full tailored email body verbatim (the {{NAME}} token kept). No
     manual manifest step. This is the authoritative source when present. It reuses the same field readers
     as the bullet manifest (readSendTo, readOwner), so an envelope and a manifest entry resolve to the
     SAME record shape. */
  function parseEnvelope(md) {
    var lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
    var head = [], body = [], inBody = false;
    for (var i = 0; i < lines.length; i++) {
      if (!inBody && /^\s*---+\s*$/.test(lines[i])) { inBody = true; continue; }
      (inBody ? body : head).push(lines[i]);
    }
    var f = {};
    head.forEach(function (l) {
      var m = l.match(/^\s*([A-Za-z][A-Za-z0-9_ ]*?)\s*:\s*(.*)$/);
      if (m) { var k = plain(m[1]).toLowerCase().replace(/\s+/g, "_"); f[k] = m[2].trim(); }
    });
    var e = blank();
    e.business = plain(f.business || "");
    e.slug_hint = f.slug ? slugify(f.slug) : "";
    if (f.location) { var loc = f.location.match(/^(.*?),\s*([A-Za-z]{2})\s*$/); e.city = plain(loc ? f.location : f.location); }
    if (f.subject) { e.subject = plain(f.subject); e.extra["Subject"] = e.subject; }
    if (f.template) e.extra.template = plain(f.template);
    if (f.kind) e.extra.kind = plain(f.kind);
    if (f.sent_on) e.extra.sent_on = plain(f.sent_on);
    if (f.send_to) readSendTo(f.send_to, e);
    e.body = body.join("\n").trim();
    e.envelope = true;
    return e;
  }

  /* ---- a manifest.json FILE (rung 2, the legacy path) ---------------------
     An array of entries, or {opportunities:[...]}, or a {slug: {...}} map, or one entry object. Each entry
     names its slug/business and carries send_to/subject/body. Unparseable JSON yields nothing (the ladder
     simply falls through to the next rung), never a guess. */
  function parseJsonFile(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw) return [];
    try {
      var v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.opportunities)) return v.opportunities;
      if (v && Array.isArray(v.entries)) return v.entries;
      if (v && typeof v === "object") {
        if (v.slug || v.business || v.send_to || v.sendTo || v.email) return [v];
        return Object.keys(v).map(function (k) { var o = v[k] || {}; if (!o.slug) o.slug = k; return o; });
      }
    } catch (e) {}
    return [];
  }

  function jsonToEntry(j, slug) {
    j = j || {};
    var e = blank();
    e.slug_hint = j.slug ? slugify(j.slug) : slug;
    e.business = plain(j.business || "");
    if (j.subject) { e.subject = plain(j.subject); e.extra["Subject"] = e.subject; }
    if (j.template) e.extra.template = plain(j.template);
    if (j.sent_on) e.extra.sent_on = plain(j.sent_on);
    if (j.location) e.city = plain(j.location);
    var send = j.send_to || j.sendTo || j.email || "";
    if (send) readSendTo(String(send), e);
    e.body = String(j.body || j.message || "");
    return e;
  }

  /* Rung 4: index.html itself. Extract the visible business email and a name; NEVER a body (the body is
     written by hand). A minimum record, marked partial. */
  function pageToEntry(page, slug) {
    var e = blank();
    e.slug_hint = slug;
    e.file = page;
    var html = String((page && page.html) || "");
    var textOnly = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    var em = textOnly.match(EMAIL_RE);
    if (em) { e.email = em[0]; e.channel = "email"; e.url = "mailto:" + em[0]; e.extra["Send to"] = em[0]; }
    var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    var title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    e.business = plain((h1 && h1[1]) || (title && title[1]) || "") || slug.replace(/-/g, " ");
    e.body = "";                       // partial by design; a body is never invented from a page
    return e;
  }

  /* ---- the tolerant reader: ONE resolver, ONE ladder ----------------------
     Every opportunity, keyed by slug, resolves its instruction by trying in order and stopping at the first
     rung that yields a send_to AND a body: (1) opp.md beside index.html [R8, authoritative], (2) any
     manifest.json entry for the slug [legacy], (3) any research/flat md section for the slug [batch 13],
     (4) index.html email + name [partial, body needs writing], (5) nothing [needs message, never blocked].
     Each opportunity records WHICH rung resolved it (provenance). No per-batch or per-slug branch. */
  function resolveOne(slug, page, env, json, doc) {
    var cands = [];
    if (env)  { env.provenance = "opp_md"; cands.push(env); }
    if (json) { var je = jsonToEntry(json, slug); je.provenance = "manifest_json"; cands.push(je); }
    if (doc)  { doc.provenance = "research_md"; cands.push(doc); }
    if (page) { var pe = pageToEntry(page, slug); pe.provenance = "page_partial"; cands.push(pe); }

    function hasSend(e) { return !!(e && (e.email || e.url || (e.channel && e.channel !== ""))); }
    function hasBody(e) { return !!(e && e.body && e.body.trim()); }

    var chosen = null, needs = false, i;
    for (i = 0; i < cands.length; i++) { if (hasSend(cands[i]) && hasBody(cands[i])) { chosen = cands[i]; break; } }
    if (!chosen) {
      needs = true;
      for (i = 0; i < cands.length; i++) { if (hasSend(cands[i])) { chosen = cands[i]; break; } }  // best partial: a send with no body
    }
    var e;
    if (chosen) { e = chosen; }
    else {                              // nothing anywhere: create the card as "needs message", never dropped
      e = blank(); e.provenance = "needs_message"; e.file = page || null;
      e.business = (env && env.business) || (doc && doc.business) || (json && plain(json.business || "")) ||
        (page ? baseOf(page.name).replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim() : slug.replace(/-/g, " "));
      needs = true;
    }
    e.slug_hint = e.slug_hint || slug;
    if (page && !e.file) e.file = page;
    if (!e.business) e.business = page ? baseOf(page.name).replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim() : slug.replace(/-/g, " ");
    e.needs_message = needs || e.provenance === "page_partial" || e.provenance === "needs_message";
    return e;
  }

  function resolveBatch(pages, manifests, jsons, opts) {
    opts = opts || {};
    pages = pages || []; manifests = manifests || []; jsons = jsons || [];
    var TI = global.ThriveIntake;

    // classify manifests: opp.md envelopes (rung 1) vs research/flat docs (rung 3)
    var envelopes = [], docs = [];
    manifests.forEach(function (m) {
      if (/(^|\/)opp\.md$/i.test(m.name || "")) envelopes.push(m); else docs.push(m);
    });

    // rung 3 (+ the fenced ```json block): the tested core parses sections and matches pages by the one
    // token ranker. A section is keyed to its PAGE's slug when it matched a page, so page + section unify
    // onto one row. A section that matched NO page is NOT keyed here: it is an orphan section (surfaced
    // below), never a slug that spawns its own card.
    var base = TI.buildBatch(pages, docs.map(function (m) { return m.text; }), opts);
    var docBySlug = {};
    base.entries.forEach(function (e) {
      if (e.file) { var s = pageSlug(e.file.name); if (s && !docBySlug[s]) docBySlug[s] = e; return; }
      // A drop with NO pages at all is a manifest-only import (templates to become drafts, pages hosted
      // later): the section IS the opportunity, keyed by its own slug. This is NOT the page-vs-section
      // reconciliation the orphan rule governs - there are no pages for a section to fail to join.
      if (pages.length === 0) {
        var isSection = !!e.business && (!!e.body || hasSendish(e) || !!e.subject);
        if (isSection) { var so = e.slug_hint || slugify(e.business); if (so && !docBySlug[so]) docBySlug[so] = e; }
      }
    });

    // rung 2: manifest.json FILES, keyed by slug
    var jsonBySlug = {};
    jsons.forEach(function (j) {
      parseJsonFile(j.text).forEach(function (x) {
        var s = x.slug ? slugify(x.slug) : slugify(x.business || "");
        if (s && !jsonBySlug[s]) jsonBySlug[s] = x;
      });
    });

    // rung 1: opp.md envelopes, keyed by the FOLDER slug so they unify with their sibling index.html
    var envBySlug = {};
    envelopes.forEach(function (m) {
      var e = parseEnvelope(m.text);
      var folderSlug = pageSlug(folderOf(m.name) + "index.html");
      var s = folderSlug || e.slug_hint || slugify(e.business);
      if (s) { e.slug_hint = s; if (!envBySlug[s]) envBySlug[s] = e; }
    });

    // Every opportunity slug comes from a PAGE or an authoritative envelope/json - never from a section
    // alone. A pageless section is an orphan (below), so six pages plus six sections resolve to six rows,
    // never eight. Matched sections are reachable here because their docBySlug key IS their page's slug.
    var pageBySlug = {};
    pages.forEach(function (p) { var s = pageSlug(p.name); if (s && !pageBySlug[s]) pageBySlug[s] = p; });
    var slugs = {};
    var unionMaps = [pageBySlug, envBySlug, jsonBySlug];
    if (pages.length === 0) unionMaps.push(docBySlug);          // manifest-only import: the sections are the opps
    unionMaps.forEach(function (map) { Object.keys(map).forEach(function (s) { slugs[s] = 1; }); });

    var entries = Object.keys(slugs).map(function (s) {
      return resolveOne(s, pageBySlug[s] || null, envBySlug[s] || null, jsonBySlug[s] || null, docBySlug[s] || null);
    });

    var report = TI.batchReport(entries, { existingSlugs: opts.existingSlugs || [], jsonError: base.jsonError || "" });
    // provenance and the needs-message verdict travel onto every row so the drop surface can show the rung.
    report.rows.forEach(function (row) {
      var e = row.entry || {};
      row.provenance = e.provenance || "";
      row.match_rule = e.match_rule || "";                 // WHICH ranking rule joined the page and section
      row.needs_message = !!e.needs_message;
      if (e.needs_message && row.reasons.indexOf("needs_message") < 0) { row.reasons.push("needs_message"); row.verdict = "warned"; }
    });
    report.matched = report.rows.filter(function (r) { return r.verdict === "matched"; }).length;
    report.warned = report.rows.filter(function (r) { return r.verdict === "warned"; }).length;
    report.allMatched = report.rows.length > 0 && report.rows.every(function (r) { return r.verdict === "matched"; }) && !base.jsonError;

    // CONFIRM rows (score 1 or an unresolved tie) and ORPHAN sections (no page at all): the two states a
    // pageless section can take. Neither is a row among the pages; neither is auto-imported or spawned.
    var confirmRows = [], orphanSections = [];
    // Only a drop that HAS pages can have an orphan section: an orphan is a section that failed to join a
    // page. A manifest-only import (no pages) has no join, so its sections are drafts, never orphans.
    if (pages.length) base.entries.forEach(function (e) {
      if (e.file) return;
      var isSection = !!e.business && (!!e.body || hasSendish(e) || !!e.subject);
      if (!isSection) return;                                // a synthesized page-stub is not a section
      if (e.confirm) {
        confirmRows.push({ page_slug: e.confirm.page_slug, score: e.confirm.score, rule: e.confirm.rule,
          business: e.business, slug_hint: e.slug_hint || slugify(e.business),
          hasSubject: !!e.subject, hasBody: !!e.body, hasSendTo: hasSendish(e), entry: e });
      } else {
        var best = null;                                     // the nearest page below threshold, a suggestion only
        pages.forEach(function (p) {
          var r = scorePageEntry(pageSlug(p.name), p, e);
          if (r.score > 0 && (!best || r.score > best.score || (r.score === best.score && r.matched > best.matched)))
            best = { slug: pageSlug(p.name), score: r.score, rule: r.rule, matched: r.matched };
        });
        orphanSections.push({ business: e.business, slug_hint: e.slug_hint || slugify(e.business),
          suggest: best ? best.slug : "", suggest_rule: best ? best.rule : "",
          hasSubject: !!e.subject, hasBody: !!e.body, hasSendTo: hasSendish(e), entry: e });
      }
    });
    report.confirm = confirmRows;
    report.orphanSections = orphanSections;

    // Repair on re-drop: a card already in the store whose send-to AND subject equal a page now joined here,
    // but under a DIFFERENT slug, is a previously spawned ghost. Flag it "duplicate of <page>, merge?" - the
    // page card keeps everything, the ghost archives. Never merged silently; the flag drives a one-tap action.
    var duplicates = [];
    var existingRecords = opts.existingRecords || [];
    if (existingRecords.length) {
      report.rows.forEach(function (row) {
        if (row.verdict !== "matched") return;
        var e = row.entry || {};
        var to = e.email || e.url || "", subj = e.subject || "";
        if (!to && !subj) return;
        existingRecords.forEach(function (rec) {
          if (!rec || !rec.slug || rec.slug === row.slug) return;
          var rto = (rec.channel && rec.channel.to) || rec.email || "";
          var rsubj = rec.outreach_subject || rec.subject || "";
          if (rto && rto === to && rsubj === subj) duplicates.push({ ghost_slug: rec.slug, page_slug: row.slug, business: row.business });
        });
      });
    }
    report.duplicates = duplicates;

    report.counts = {
      pages: report.rows.length,
      matched: report.matched,
      confirm: confirmRows.length,
      needs: report.rows.filter(function (r) { return r.needs_message; }).length,
      orphans: orphanSections.length
    };

    return {
      entries: entries, report: report,
      pages: pages.length, manifests: manifests.length, jsons: jsons.length,
      notes: base.notes, batch: base.batch,
      jsonPresent: base.jsonPresent, jsonError: base.jsonError
    };
  }

  global.ThriveIntake = {
    parseManifest: parseManifest,
    parseEnvelope: parseEnvelope,
    parseJsonFile: parseJsonFile,
    resolveBatch: resolveBatch,
    match: match,
    toRecord: toRecord,
    substituteLink: substituteLink,
    slugify: slugify,
    pageSlug: pageSlug,
    folderOf: folderOf,
    baseOf: baseOf,
    selfTest: selfTest
  };
})(typeof window !== "undefined" ? window : this);

/* ============================================================================
   Reading a zip in the browser, with nothing installed

   A day's work arrives as one zip. Adding a library to unpack it would put a
   third party script inside the gate, on a console whose whole security story is
   that nothing runs here that we did not write. The format is simple enough to
   read directly: walk the central directory, inflate with the platform's own
   DecompressionStream. Stored entries need no inflating at all.

   It reads .html, .md and .txt and ignores everything else, because those are
   the three things a batch is made of and a zip carrying images is not a reason
   to refuse the whole day.
   ============================================================================ */
(function (global) {
  "use strict";

  function u16(v, p) { return v[p] | (v[p + 1] << 8); }
  function u32(v, p) { return (v[p] | (v[p + 1] << 8) | (v[p + 2] << 16) | (v[p + 3] << 24)) >>> 0; }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") throw new Error("no_inflate");
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* The end of central directory record sits at the tail, after a comment that
     may be up to 64KB, so it is found by scanning back for its signature. */
  function findEOCD(v) {
    for (var i = v.length - 22; i >= 0 && i > v.length - 66000; i--) {
      if (u32(v, i) === 0x06054b50) return i;
    }
    return -1;
  }

  async function readZip(arrayBuffer) {
    var v = new Uint8Array(arrayBuffer);
    var eocd = findEOCD(v);
    if (eocd < 0) throw new Error("not_a_zip");
    var count = u16(v, eocd + 10), p = u32(v, eocd + 16);
    var out = [], dec = new TextDecoder("utf-8");

    for (var i = 0; i < count && p + 46 <= v.length; i++) {
      if (u32(v, p) !== 0x02014b50) break;
      var method = u16(v, p + 10), csize = u32(v, p + 20);
      var nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commentLen = u16(v, p + 32);
      var local = u32(v, p + 42);
      var name = dec.decode(v.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;

      if (/\/$/.test(name)) continue;                                  // a directory entry
      if (name.replace(/^.*\//, "").charAt(0) === ".") continue;        // __MACOSX and friends
      if (!/\.(html?|md|txt|json)$/i.test(name)) continue;
      if (u32(v, local) !== 0x04034b50) continue;
      var dataAt = local + 30 + u16(v, local + 26) + u16(v, local + 28);
      var raw = v.subarray(dataAt, dataAt + csize);
      var bytes;
      if (method === 0) bytes = raw;
      else if (method === 8) bytes = await inflateRaw(raw);
      else continue;
      out.push({ name: name, text: dec.decode(bytes) });
    }
    return out;
  }

  /* ---- one entry point for every shape of drop ----------------------------
     A page alone, a page and its manifest, or a zip of both. The caller hands
     over File objects and gets the same answer in every case, so nothing
     downstream has to know which of the three happened. */
  /* Read a drop into its kinds, unpacking any zip. One place decides what a page, a manifest and a json
     are, so every ingest surface agrees about which file was which. */
  async function readFiles(files) {
    var pages = [], manifests = [], jsons = [], skipped = [];
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      var f = list[i], name = f.name || "";
      if (/\.zip$/i.test(name)) {
        var inner = await readZip(await f.arrayBuffer());
        inner.forEach(function (z) {
          if (/\.html?$/i.test(z.name)) pages.push({ name: z.name, html: z.text });
          else if (/\.json$/i.test(z.name)) jsons.push({ name: z.name, text: z.text });
          else if (/\.(md|txt)$/i.test(z.name)) manifests.push({ name: z.name, text: z.text });
          else skipped.push(z.name);
        });
        continue;
      }
      if (/\.html?$/i.test(name)) { pages.push({ name: name, html: await f.text() }); continue; }
      if (/\.json$/i.test(name)) { jsons.push({ name: name, text: await f.text() }); continue; }
      if (/\.(md|txt)$/i.test(name)) { manifests.push({ name: name, text: await f.text() }); continue; }
      skipped.push(name);
    }
    return { pages: pages, manifests: manifests, jsons: jsons, skipped: skipped };
  }

  /* P14: readDrop, the second ingest path that fed the board's "Today's batch" surface, is retired. It
     parsed sections and matched pages directly (parseManifest + match), never running the tolerant ladder,
     so every fix to resolveBatch left that surface unchanged. Both drop and upload surfaces now go through
     ThriveIntake.readBatch -> resolveBatch (one reader). parseManifest and match remain, reached ONLY through
     buildBatch inside the resolver (the one path), never as a second entry point. */

  global.ThriveIntake.readZip = readZip;
  global.ThriveIntake.readFiles = readFiles;
})(typeof window !== "undefined" ? window : this);

/* ============================================================================
   The batch report, and the warn-before-write gate (upload mode)

   buildBatch parses each section (subject, body, send-to, page file) and
   matches pages to entries by slug, never by position. This layer adds the two
   things the upload gate needs on top of that: the optional structured JSON
   manifest block (a second, machine-reliable source for the structured fields
   when a batch carries one), and a per-slug report that marks the five things
   for every slug and classifies matched or warned, so nothing is written until
   the operator approves what it says. It invents nothing: a missing anchor is a
   warning, never a guess.
   ============================================================================ */
(function (global) {
  "use strict";
  var TI = global.ThriveIntake;

  /* The structured source of truth, when the batch provides one: a fenced ```json block (usually
     under a "## Manifest entries" heading) of comma separated objects with slug, business, template,
     sent_on, location, phone, status. Returned as {present, entries, error}. Present but unparseable
     is an error the report shows by name, never a guess. Absent is simply the bullet format. */
  function parseJsonManifest(md) {
    var m = String(md || "").match(/```json\s*([\s\S]*?)```/i);
    if (!m) return { present: false, entries: [] };
    var raw = m[1].trim().replace(/,\s*$/, "");
    if (raw.charAt(0) !== "[") raw = "[" + raw + "]";
    try {
      var arr = JSON.parse(raw);
      return { present: true, entries: Array.isArray(arr) ? arr : [arr] };
    } catch (e) { return { present: true, entries: [], error: String((e && e.message) || e) }; }
  }

  function slugOf(e) {
    return e.slug_hint || TI.slugify(e.business) || TI.slugify(e.page_file) || "";
  }

  /* Overlay the JSON block's structured fields onto the parsed sections, by slug, so the section's
     subject, body and send-to meet the JSON's business, template, location, phone and status on one
     entry. A JSON object with no matching section becomes its own entry (a manifest entry that may
     have no page). The JSON is the structured source of truth for the fields it carries. */
  function applyJson(entries, jsonEntries) {
    var bySlug = {};
    entries.forEach(function (e) { var s = slugOf(e); if (s) bySlug[s] = e; });
    (jsonEntries || []).forEach(function (j) {
      var s = j.slug || TI.slugify(j.business || "");
      if (!s) return;
      var e = bySlug[s];
      if (!e) {
        e = { n: 0, business: "", city: "", descriptor: "", channel: "", url: "", alternates: [],
              email: "", page_file: (j.slug ? j.slug + ".html" : ""), slug_hint: s, subject: "",
              owner: "", owner_note: "", prohibition: "", body: "", extra: {}, warnings: [], _fromJson: true };
        entries.push(e); bySlug[s] = e;
      }
      e.from_manifest_json = true;
      if (j.business) e.business = j.business;
      if (j.location) e.city = j.location;
      if (j.template) e.extra.template = j.template;
      if (j.sent_on)  e.extra.sent_on = j.sent_on;
      if (j.phone)    e.extra.phone = j.phone;
      if (j.status)   e.extra.status = j.status;
      if (j.slug)     e.slug_hint = j.slug;
    });
    return entries;
  }

  /* The report: one row per slug, the five columns marked present or missing, and a verdict. Matched
     means an HTML page and a manifest entry are both present and nothing else is off. Every other
     state is warned, with its reason named, and a warned row blocks approval until the operator
     decides. Nothing here writes; it only reads and reports. */
  function batchReport(entries, opts) {
    opts = opts || {};
    var existing = opts.existingSlugs || [];
    var jsonError = opts.jsonError || "";
    var counts = {};
    (entries || []).forEach(function (e) { var s = slugOf(e) || "(unnamed)"; counts[s] = (counts[s] || 0) + 1; });

    var rows = (entries || []).map(function (e) {
      var slug = slugOf(e) || "(unnamed)";
      var hasPage = !!e.file;
      var hasManifest = e.warnings.indexOf("no_manifest_entry") < 0 && (!!e.business || !!e.from_manifest_json);
      var hasSubject = !!e.subject;
      var hasBody = !!e.body;
      var hasSendTo = !!(e.email || e.url || (e.channel && e.channel !== ""));
      var reasons = [];
      if (counts[slug] > 1) reasons.push("duplicate_slug");
      if (existing.indexOf(slug) >= 0) reasons.push("exists_would_overwrite");
      if (!hasPage) reasons.push("no_page");                                  // text with no page
      if (!hasManifest) reasons.push("no_manifest_entry");                    // page with no manifest
      if (hasPage && hasManifest && !hasSubject && !hasBody) reasons.push("no_text"); // page with no text
      if (!e.business && hasManifest) reasons.push("missing_business");       // a missing required field
      // surface, without duplicating, the parser's own field warnings
      ["no_channel"].forEach(function (w) { if (e.warnings.indexOf(w) >= 0 && reasons.indexOf(w) < 0) reasons.push(w); });
      return {
        slug: slug, business: e.business || slug,
        hasPage: hasPage, hasManifest: hasManifest, hasSubject: hasSubject, hasBody: hasBody, hasSendTo: hasSendTo,
        verdict: reasons.length ? "warned" : "matched", reasons: reasons, entry: e
      };
    });

    return {
      rows: rows,
      jsonError: jsonError,
      matched: rows.filter(function (r) { return r.verdict === "matched"; }).length,
      warned: rows.filter(function (r) { return r.verdict === "warned"; }).length,
      allMatched: rows.length > 0 && rows.every(function (r) { return r.verdict === "matched"; }) && !jsonError
    };
  }

  /* The whole reading of a batch, from already read text to the report, in one pure place. The
     editor calls it through readBatch (which reads the files first); the Node proof calls it
     directly with the fixture. Both run the identical pipeline, so what the sandbox proves is
     exactly what the editor does: parse the sections, overlay the JSON block by slug, match pages
     to entries by slug (never by position), give a page with no section its own entry, and report.
     Nothing here writes; it reads and returns what a write would touch. */
  function buildBatch(pages, manifestTexts, opts) {
    opts = opts || {};
    pages = pages || [];
    var texts = manifestTexts || [];
    var joined = texts.join("\n\n");

    var entries = [], notes = "", batch = { title: "", sub: "" };
    texts.forEach(function (text) {
      var r = TI.parseManifest(text);
      r.entries.forEach(function (e) {
        entries.push(Object.assign({}, e, { warnings: e.warnings.slice(), file: null }));
      });
      if (r.note_text) notes = notes ? notes + "\n\n" + r.note_text : r.note_text;
      if (r.batch && r.batch.title && !batch.title) batch = r.batch;
    });

    var jm = parseJsonManifest(joined);
    if (jm.entries && jm.entries.length) applyJson(entries, jm.entries);

    TI.match(entries, pages);

    /* A page the document never named is still a real page and still work. It becomes an entry
       named after its file, flagged, so the report says exactly what it is rather than dropping it. */
    var used = {};
    entries.forEach(function (e) { if (e.file) used[e.file.name] = 1; });
    pages.forEach(function (p) {
      if (used[p.name]) return;
      entries.push({ n: 0, business: p.name.replace(/^.*\//, "").replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim(),
        city: "", descriptor: "", channel: "", url: "", alternates: [], email: "", tier: "",
        page_file: p.name, slug_hint: "", subject: "", owner: "", owner_note: "",
        prohibition: "", body: "", extra: {}, warnings: ["no_manifest_entry"], file: p });
    });

    var report = batchReport(entries, { existingSlugs: opts.existingSlugs || [], jsonError: jm.error || "" });
    return {
      entries: entries, report: report,
      pages: pages.length, manifests: texts.length,
      notes: notes, batch: batch,
      jsonPresent: !!jm.present, jsonError: jm.error || ""
    };
  }

  /* The ONE entry point for every drop or upload surface. Reads the files, runs the tolerant resolver, and
     reports (never silently drops) any instruction-shaped file the reader cannot open. */
  // A document a producer might have meant as the instruction file but that this console cannot read (it
  // reads only html/md/txt/json). Surfaced as "unreadable format, needs message" so a .docx or .pdf is a
  // truthful state on the report, never a file that vanished before the resolver saw it.
  var DOC_LIKE = /\.(docx?|pdf|rtf|pages|odt|key|pptx?)$/i;
  async function readBatch(files, opts) {
    var read = await TI.readFiles(files);
    // The ONE tolerant resolver runs the ladder (opp.md > manifest.json > research md > page > needs message)
    // and carries provenance. buildBatch remains its rung-3 section engine, so the flat path is unchanged.
    var out = TI.resolveBatch(read.pages, read.manifests, read.jsons || [], opts);
    out.skipped = read.skipped;
    out.pageList = read.pages;
    // A dropped .docx/.pdf is named on the report as an unreadable instruction file, not dropped in silence.
    out.unreadable = (read.skipped || []).filter(function (n) { return DOC_LIKE.test(n); })
      .map(function (n) { return String(n).replace(/^.*\//, ""); });
    return out;
  }

  global.ThriveIntake.parseJsonManifest = parseJsonManifest;
  global.ThriveIntake.applyJson = applyJson;
  global.ThriveIntake.batchReport = batchReport;
  global.ThriveIntake.buildBatch = buildBatch;
  global.ThriveIntake.readBatch = readBatch;
})(typeof window !== "undefined" ? window : this);
