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
  var HEAD_RE = new RegExp("^\\s*(\\d+)\\s*" + SEP + "\\s*(.+)$");
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
      body: "", extra: {}, warnings: []
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

  /* ---- the manifest -------------------------------------------------------
     Returns { entries, notes, batch }. `notes` is every trailing section, kept
     once and attached to every opportunity in the batch: the pricing floor in
     "Money at a glance" is something to read while deciding, not something to
     go and find in a file. */
  function parseManifest(md) {
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    var entries = [], notes = [], batch = { title: "", sub: "" };
    var e = null, note = null;
    var fence = false, buf = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^\s*```/.test(line)) {
        if (!fence) { fence = true; buf = e ? [] : null; }
        else {
          fence = false;
          /* The FIRST fenced block in a section is the message. A later one is a
             sample or a snippet, and overwriting the message with it would send
             the wrong words. */
          if (e && buf && !e.body) e.body = buf.join("\n").trim();
          buf = null;
        }
        continue;
      }
      if (fence) { if (buf) buf.push(line); continue; }

      if (/^#\s+/.test(line)) { batch.title = plain(line.replace(/^#\s+/, "")); e = null; note = null; continue; }
      if (/^###\s+/.test(line)) {
        if (!batch.sub && !entries.length && !notes.length) batch.sub = plain(line.replace(/^###\s+/, ""));
        else if (note) note.body.push(plain(line));
        continue;
      }
      if (/^##\s+/.test(line)) {
        var text = plain(line.replace(/^##\s+/, ""));
        var m = text.match(HEAD_RE);
        if (m) {
          e = blank();
          e.n = parseInt(m[1], 10);
          var rest = m[2];
          var bits = rest.split(new RegExp("\\s*" + SEP + "\\s*"));
          var head = bits.shift() || "";
          e.descriptor = plain(bits.join(" · "));
          var loc = head.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
          if (loc) { e.business = plain(loc[1]); e.city = plain(loc[2]); }
          else e.business = plain(head);
          entries.push(e);
          note = null;
        } else {
          e = null;
          note = { heading: text, body: [] };
          notes.push(note);
        }
        continue;
      }

      if (e) {
        var b = line.match(/^\s*[-*]\s*\*{0,2}([^:*]+?)\*{0,2}\s*:\s*(.*)$/);
        if (!b) continue;
        var key = plain(b[1]), val = b[2];
        if (/^send to$/i.test(key)) readSendTo(val, e);
        else if (/^page$/i.test(key)) readPage(val, e);
        else if (/^subject/i.test(key)) { e.subject = plain(val); e.extra["Subject"] = e.subject; }
        else if (/^owner$/i.test(key)) readOwner(val, e);
        else e.extra[key] = plain(val);      // never discarded, even when not understood
        continue;
      }
      if (note && line.trim()) note.body.push(line.trim());
    }

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

  function match(entries, pages) {
    var byKey = {}, used = {};
    (pages || []).forEach(function (f) { byKey[keyOf(f.name)] = f; });

    (entries || []).forEach(function (e) {
      var f = null;
      if (e.page_file && byKey[keyOf(e.page_file)]) f = byKey[keyOf(e.page_file)];
      if (!f) {
        var want = keyOf(e.business);
        Object.keys(byKey).forEach(function (k) {
          if (f || !want || used[byKey[k].name]) return;
          if (k === want || k.indexOf(want) === 0 || want.indexOf(k) === 0) f = byKey[k];
        });
      }
      if (f && !used[f.name]) { e.file = f; used[f.name] = 1; }
    });

    var orphanPages = (pages || []).filter(function (f) { return !used[f.name]; });
    var orphanEntries = (entries || []).filter(function (e) { return !e.file; });
    orphanEntries.forEach(function (e) { if (e.warnings.indexOf("no_page") < 0) e.warnings.push("no_page"); });

    return { matched: (entries || []).filter(function (e) { return !!e.file; }),
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
      manifest_extra: e.extra || {}
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

  global.ThriveIntake = {
    parseManifest: parseManifest,
    match: match,
    toRecord: toRecord,
    substituteLink: substituteLink,
    slugify: slugify,
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
      if (!/\.(html?|md|txt)$/i.test(name)) continue;
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
  /* Read a drop into its two kinds, unpacking any zip. One place decides what a
     page is and what a manifest is, so readDrop and the editor's batch pipeline
     can never disagree about which file was which. */
  async function readFiles(files) {
    var pages = [], manifests = [], skipped = [];
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      var f = list[i], name = f.name || "";
      if (/\.zip$/i.test(name)) {
        var inner = await readZip(await f.arrayBuffer());
        inner.forEach(function (z) {
          if (/\.html?$/i.test(z.name)) pages.push({ name: z.name, html: z.text });
          else if (/\.(md|txt)$/i.test(z.name)) manifests.push({ name: z.name, text: z.text });
          else skipped.push(z.name);
        });
        continue;
      }
      if (/\.html?$/i.test(name)) { pages.push({ name: name, html: await f.text() }); continue; }
      if (/\.(md|txt)$/i.test(name)) { manifests.push({ name: name, text: await f.text() }); continue; }
      skipped.push(name);
    }
    return { pages: pages, manifests: manifests, skipped: skipped };
  }

  async function readDrop(files) {
    var read = await readFiles(files);
    var pages = read.pages, manifests = read.manifests, skipped = read.skipped;

    var entries = [], notes = "", batch = { title: "", sub: "" };
    manifests.forEach(function (m) {
      var r = global.ThriveIntake.parseManifest(m.text);
      entries = entries.concat(r.entries);
      if (r.note_text) notes = notes ? notes + "\n\n" + r.note_text : r.note_text;
      if (r.batch.title && !batch.title) batch = r.batch;
    });

    /* A page with no manifest entry is still a real page and still work. It
       becomes an opportunity named after its file, flagged so the report says
       exactly what it is rather than pretending it arrived complete. */
    var m = global.ThriveIntake.match(entries, pages);
    var extra = m.orphanPages.map(function (f) {
      var e = { n: 0, business: f.name.replace(/^.*\//, "").replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim(),
                city: "", descriptor: "", channel: "", url: "", alternates: [], email: "", tier: "",
                page_file: f.name, slug_hint: "", subject: "", owner: "", owner_note: "",
                prohibition: "", body: "", extra: {}, warnings: ["no_manifest_entry"], file: f };
      return e;
    });

    return {
      entries: entries.concat(extra),
      orphanPages: m.orphanPages.map(function (f) { return f.name; }),
      orphanEntries: m.orphanEntries.map(function (e) { return e.business || "(unnamed)"; }),
      pages: pages.length, manifests: manifests.length,
      notes: notes, batch: batch, skipped: skipped
    };
  }

  global.ThriveIntake.readZip = readZip;
  global.ThriveIntake.readFiles = readFiles;
  global.ThriveIntake.readDrop = readDrop;
})(typeof window !== "undefined" ? window : this);

/* ============================================================================
   The batch report, and the warn-before-write gate (upload mode)

   readDrop already parses each section (subject, body, send-to, page file) and
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

  /* Read the dropped files, then build the batch. The editor's one entry point. */
  async function readBatch(files, opts) {
    var read = await TI.readFiles(files);
    var out = buildBatch(read.pages, read.manifests.map(function (m) { return m.text; }), opts);
    out.skipped = read.skipped;
    out.pageList = read.pages;
    return out;
  }

  global.ThriveIntake.parseJsonManifest = parseJsonManifest;
  global.ThriveIntake.applyJson = applyJson;
  global.ThriveIntake.batchReport = batchReport;
  global.ThriveIntake.buildBatch = buildBatch;
  global.ThriveIntake.readBatch = readBatch;
})(typeof window !== "undefined" ? window : this);
