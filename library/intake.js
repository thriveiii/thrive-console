/* ============================================================================
   Thrive Console · batch intake

   A working day arrives as a zip: some finished pages, and one brief that says who each page
   is for, how to reach them, and the exact words to send. Until now the console could take a
   page. It could not take the brief, so the words that came with the page were retyped, and
   the thing that decides whether a message lands was the thing being retyped.

   This module reads the brief. It does not touch the DOM, it does not store anything, and it
   never invents: a field that is not in the brief comes back empty, and an entry whose page is
   missing says so rather than guessing which file was meant.

   ---------------------------------------------------------------------------
   THE SHAPE OF A BRIEF
   ---------------------------------------------------------------------------
   ## 2 · Wise Butterfly Shop (Vienna) · a boutique for women 40 and up

   - **Send to:** website contact form at wisebutterflyshop.com (no public email, Tier B)
   - **Page:** wisebutterfly.html · slug `/s/wisebutterfly-` plus four random characters
   - **Subject / opener:** The women the mall forgot
   - **Owner:** Stephanie Davari-McConnon. **Standing prohibition:** none.

   ```
   Hi Stephanie,
   ...
   ```

   Everything above is optional except the heading. A brief with only headings still produces
   one opportunity per heading, which is the point: the console should never refuse the work
   because the paperwork was thin.
   ============================================================================ */
(function (global) {
  "use strict";

  /* ---- one entry ----------------------------------------------------------
     Fields are always present, so nothing downstream has to test for their
     existence. Empty means "the brief did not say", never "we could not read". */
  function blank() {
    return {
      n: 0,
      business: "",
      location: "",
      descriptor: "",
      channel: { kind: "", to: "", note: "" },   // how this one is reached
      pageFile: "",                              // the html file named in the brief
      slugHint: "",
      subject: "",
      owner: "",
      ownerNote: "",
      prohibition: "",
      message: "",                               // the words, verbatim
      warnings: []
    };
  }

  /* Markdown emphasis is noise once the field is parsed out of it. */
  function plain(s) {
    return String(s || "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ---- how to reach them --------------------------------------------------
     The brief writes this as a sentence, because a person wrote it. Three kinds
     matter operationally, because they are three different actions: an address
     you can send to from here, a form you have to open, and a direct message.
     Anything else is kept verbatim under "other" rather than forced into one. */
  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  function readChannel(line) {
    var raw = plain(line.replace(/^-\s*Send to:\s*/i, ""));
    var out = { kind: "", to: "", note: raw };
    var m = raw.match(EMAIL_RE);
    if (m) { out.kind = "email"; out.to = m[0]; return out; }
    /* The form is tested before the direct message on purpose. A brief that says "paste the
       message into the form, or send as an Instagram DM" is naming a first choice and a
       fallback, and the first choice is the instruction. */
    if (/contact form|form at|website form|\bform\b/i.test(raw)) {
      out.kind = "form";
      var d = raw.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
      out.to = d ? d[1] : "";
      return out;
    }
    if (/instagram|\bdm\b/i.test(raw)) {
      out.kind = "dm";
      var h = raw.match(/@[A-Za-z0-9._]+/);
      var site = raw.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
      out.to = h ? h[0] : (site ? site[1] : "");
      return out;
    }
    if (/whatsapp|wa\.me/i.test(raw)) {
      out.kind = "whatsapp";
      var w = raw.match(/\+?\d[\d\s()-]{6,}/);
      out.to = w ? w[0].trim() : "";
      return out;
    }
    out.kind = raw ? "other" : "";
    return out;
  }

  /* A heading carries three facts in one line, and any of the three may be absent:
       ## 1 · Ludic Lillian (Fairfax) · handmade ceramics
     The separator is a middle dot in this brief, but a hyphen or an en dash reads
     the same to a person, so all three are accepted. They are written as escapes
     rather than as characters because the long dash is banned in this source and
     a parser that accepts one is not the same thing as copy that uses one. */
  function readHeading(line, e) {
    var s = plain(line.replace(/^##\s*/, ""));
    var num = s.match(/^(\d+)\s*[·\-\u2013\u2014]\s*/);
    if (num) { e.n = parseInt(num[1], 10); s = s.slice(num[0].length); }
    var parts = s.split(/\s*[·\u2013\u2014]\s*|\s+-\s+/);
    var head = parts.shift() || "";
    e.descriptor = plain(parts.join(" · "));
    var loc = head.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (loc) { e.business = plain(loc[1]); e.location = plain(loc[2]); }
    else e.business = plain(head);
  }

  function readPage(line, e) {
    var raw = plain(line.replace(/^-\s*Page:\s*/i, ""));
    var f = raw.match(/([A-Za-z0-9._-]+\.html?)/i);
    if (f) e.pageFile = f[1];
    var sl = raw.match(/slug\s+\/?s?\/?([A-Za-z0-9-]+)/i);
    if (sl) e.slugHint = sl[1].replace(/-+$/, "");
  }

  /* The owner line is a name and then, often, a paragraph about them. The name is the thing
     the message is addressed to, so it is kept apart from the context; both are shown, and
     neither is thrown away. */
  function readOwner(line, e) {
    var raw = plain(line.replace(/^-\s*Owner:\s*/i, ""));
    var pro = raw.split(/standing prohibition:\s*/i);
    var head = plain((pro[0] || "").replace(/\.\s*$/, ""));
    var cut = head.match(/^([^.]+?)\.\s+(.+)$/);
    if (cut) { e.owner = plain(cut[1]); e.ownerNote = plain(cut[2]); }
    else e.owner = head;
    if (pro.length > 1) e.prohibition = plain(pro[1]);
  }

  /* ---- the brief ---------------------------------------------------------- */
  function parseBrief(md) {
    var text = String(md || "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n");
    var out = [];
    var e = null;
    var fence = false, buf = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      /* A fenced block inside an entry is the message. Outside an entry it is an
         example or a snippet in the notes, and is not anybody's message. */
      if (/^\s*```/.test(line)) {
        if (!fence) { fence = true; buf = (e ? [] : null); }
        else { fence = false; if (e && buf) { e.message = buf.join("\n").trim(); buf = null; } }
        continue;
      }
      if (fence) { if (buf) buf.push(line); continue; }

      if (/^##\s+/.test(line) && !/^###/.test(line)) {
        /* A heading with no number is a section of the brief (Money at a glance,
           Gates, Rejection log), not an opportunity. Numbered headings are the work. */
        var probe = blank();
        readHeading(line, probe);
        if (!probe.n) { e = null; continue; }
        e = probe;
        out.push(e);
        continue;
      }
      if (!e) continue;

      if (/^-\s*\*{0,2}Send to/i.test(line)) e.channel = readChannel(line.replace(/\*\*/g, ""));
      else if (/^-\s*\*{0,2}Page\b/i.test(line)) readPage(line.replace(/\*\*/g, ""), e);
      else if (/^-\s*\*{0,2}Subject/i.test(line)) {
        e.subject = plain(line.replace(/\*\*/g, "").replace(/^-\s*Subject(\s*\/\s*opener)?:\s*/i, ""));
      }
      else if (/^-\s*\*{0,2}Owner\b/i.test(line)) readOwner(line.replace(/\*\*/g, ""), e);
    }

    out.forEach(function (x) {
      if (!x.business) x.warnings.push("no_business");
      if (!x.message) x.warnings.push("no_message");
      if (!x.channel.kind) x.warnings.push("no_channel");
    });
    return out;
  }

  /* ---- matching a brief entry to an uploaded page -------------------------
     By the filename the brief named, first. Then by a filename that contains the
     business name with its punctuation removed, because "2 Faces Clothing Co."
     arrives as 2faces.html. Never by position in the zip: two files in the wrong
     order would silently send one prospect another prospect's page. */
  function slugify(s) {
    return String(s || "").toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }
  function keyOf(name) {
    return String(name || "").replace(/^.*\//, "").replace(/\.html?$/i, "").toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function matchPages(entries, files) {
    var byKey = {};
    (files || []).forEach(function (f) { byKey[keyOf(f.name)] = f; });
    var used = {};
    (entries || []).forEach(function (e) {
      var f = null;
      if (e.pageFile && byKey[keyOf(e.pageFile)]) f = byKey[keyOf(e.pageFile)];
      if (!f) {
        var want = keyOf(e.business);
        Object.keys(byKey).forEach(function (k) {
          if (f) return;
          if (!want) return;
          if (k === want || k.indexOf(want) === 0 || want.indexOf(k) === 0) f = byKey[k];
        });
      }
      if (f && !used[f.name]) { e.file = f; used[f.name] = 1; }
      else if (!f) e.warnings.push("no_page");
    });
    /* A page nobody claimed is still work: it becomes an entry of its own rather
       than being dropped on the floor. */
    var extra = [];
    (files || []).forEach(function (f) {
      if (used[f.name]) return;
      var e = blank();
      e.business = f.name.replace(/^.*\//, "").replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
      e.pageFile = f.name;
      e.file = f;
      e.warnings.push("no_brief");
      extra.push(e);
    });
    return (entries || []).concat(extra);
  }

  /* ---- an entry becomes an opportunity record -----------------------------
     Everything the console already understands, plus the two things the brief
     adds: the channel this one is reached through, and the words to send. */
  function toRecord(e, opts) {
    opts = opts || {};
    var slug = e.slugHint || slugify(e.business) || slugify(e.pageFile) || "opportunity";
    return {
      slug: slug,
      business: e.business || slug,
      template: "custom",
      sent_on: opts.today || new Date().toISOString().slice(0, 10),
      location: e.location || "",
      phone: "",
      status: "sent",
      mode: "upload",
      published: false,
      fields: {},
      html: (e.file && e.file.html) || "",
      /* the two new facts, and the note that explains a standing prohibition so it
         is read before the message is sent rather than after */
      channel: { kind: e.channel.kind || "", to: e.channel.to || "", note: e.channel.note || "" },
      pitch: { subject: e.subject || "", body: e.message || "" },
      owner: e.owner || "",
      ownerNote: e.ownerNote || "",
      prohibition: e.prohibition || "",
      descriptor: e.descriptor || ""
    };
  }

  global.ThriveIntake = {
    parseBrief: parseBrief,
    matchPages: matchPages,
    toRecord: toRecord,
    slugify: slugify,
    readChannel: readChannel,
    /* Kept so a change here can be judged rather than trusted. */
    selfTest: function () {
      var md = [
        "# READY TO SEND · Batch 06",
        "Intro prose that is not an opportunity.",
        "",
        "## 1 · Ludic Lillian (Fairfax) · handmade ceramics, tea, and paint nights",
        "",
        "- **Send to:** tis_herself@LudicLillian.com (email, Tier A)",
        "- **Page:** ludic.html · slug `/s/ludic-` plus four random characters",
        "- **Subject:** Handmade in Fairfax",
        "- **Owner:** Deborah Dillard. **Standing prohibition:** she is a maker.",
        "",
        "```",
        "Hi Deborah,",
        "",
        "We put together a short brief. [LINK]",
        "```",
        "",
        "## 2 · Wise Butterfly Shop (Vienna) · a boutique",
        "- **Send to:** website contact form at wisebutterflyshop.com (no public email, Tier B)",
        "- **Page:** wisebutterfly.html",
        "- **Owner:** Stephanie. First shop, opening summer 2026.",
        "- **Subject / opener:** The women the mall forgot",
        "```",
        "Hi Stephanie,",
        "```",
        "",
        "## 3 · 2 Faces Clothing Co. (Fairfax) · streetwear",
        "- **Send to:** website contact form at 2faceonline.us, or send as an Instagram DM.",
        "",
        "## Money at a glance",
        "Not an opportunity.",
        "",
        "## Gates (all three)",
        "Also not an opportunity."
      ].join("\n");

      var f = [];
      var got = parseBrief(md);
      if (got.length !== 3) f.push("expected 3 entries, got " + got.length);
      if (got[0] && got[0].business !== "Ludic Lillian") f.push("business: " + (got[0] || {}).business);
      if (got[0] && got[0].location !== "Fairfax") f.push("location: " + (got[0] || {}).location);
      if (got[0] && got[0].channel.kind !== "email") f.push("channel 1: " + (got[0] || {}).channel.kind);
      if (got[0] && got[0].channel.to !== "tis_herself@LudicLillian.com") f.push("to 1: " + got[0].channel.to);
      if (got[0] && got[0].subject !== "Handmade in Fairfax") f.push("subject: " + got[0].subject);
      if (got[0] && got[0].owner !== "Deborah Dillard") f.push("owner: " + got[0].owner);
      /* a name followed by a paragraph keeps the name as the name */
      if (got[1] && got[1].owner !== "Stephanie") f.push("owner 2 should be the name alone: " + got[1].owner);
      if (got[0] && !/maker/.test(got[0].prohibition)) f.push("prohibition: " + got[0].prohibition);
      if (got[0] && got[0].message.indexOf("Hi Deborah") !== 0) f.push("message 1: " + got[0].message.slice(0, 20));
      if (got[0] && got[0].message.indexOf("[LINK]") < 0) f.push("message 1 lost its link slot");
      if (got[1] && got[1].channel.kind !== "form") f.push("channel 2: " + got[1].channel.kind);
      if (got[1] && got[1].channel.to !== "wisebutterflyshop.com") f.push("to 2: " + got[1].channel.to);
      if (got[1] && got[1].subject !== "The women the mall forgot") f.push("subject 2: " + got[1].subject);
      /* a form and a DM in one line: the form is the instruction, so it wins */
      if (got[2] && got[2].channel.kind !== "form") f.push("channel 3: " + got[2].channel.kind);
      if (got[2] && got[2].warnings.indexOf("no_message") < 0) f.push("a missing message must be reported");

      /* pages are matched by name, never by position */
      var files = [{ name: "wisebutterfly.html", html: "<h1>W</h1>" },
                   { name: "ludic.html", html: "<h1>L</h1>" },
                   { name: "spare.html", html: "<h1>S</h1>" }];
      var all = matchPages(got, files);
      if (!got[0].file || got[0].file.name !== "ludic.html") f.push("ludic matched " + ((got[0].file || {}).name));
      if (!got[1].file || got[1].file.name !== "wisebutterfly.html") f.push("wise matched " + ((got[1].file || {}).name));
      if (all.length !== 4) f.push("an unclaimed page must still become work, got " + all.length);
      if (all[3] && all[3].warnings.indexOf("no_brief") < 0) f.push("an unclaimed page must say so");

      var rec = toRecord(got[0], { today: "2026-08-03" });
      if (rec.slug !== "ludic") f.push("slug: " + rec.slug);
      if (rec.channel.kind !== "email") f.push("record channel: " + rec.channel.kind);
      if (rec.pitch.body.indexOf("[LINK]") < 0) f.push("record lost the message");
      if (rec.html !== "<h1>L</h1>") f.push("record lost the page");

      return { pass: f.length === 0, fails: f };
    }
  };
})(typeof window !== "undefined" ? window : this);

/* ============================================================================
   Reading a zip in the browser, with nothing installed

   A day's work arrives as one zip. Adding a library to unpack it would mean a
   third-party script inside the gate, on a console whose whole security story is
   that nothing runs here that we did not write. The format is simple enough to
   read directly: walk the central directory, and inflate with the platform's own
   DecompressionStream. Stored entries need no inflating at all.

   It reads .html, .md and .txt and ignores everything else, because those are the
   three things a brief is made of and a zip full of images is not a reason to fail.
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

  /* The end-of-central-directory record is at the tail, after a comment that may
     be up to 64KB, so it is found by scanning back for its signature. */
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
    var count = u16(v, eocd + 10);
    var start = u32(v, eocd + 16);
    var out = [];
    var p = start;
    var dec = new TextDecoder("utf-8");

    for (var i = 0; i < count && p + 46 <= v.length; i++) {
      if (u32(v, p) !== 0x02014b50) break;
      var method = u16(v, p + 10);
      var csize = u32(v, p + 20);
      var nameLen = u16(v, p + 28);
      var extraLen = u16(v, p + 30);
      var commentLen = u16(v, p + 32);
      var local = u32(v, p + 42);
      var name = dec.decode(v.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;

      if (/\/$/.test(name)) continue;                       // a directory entry
      if (name.replace(/^.*\//, "").charAt(0) === ".") continue;  // __MACOSX and friends
      if (!/\.(html?|md|txt)$/i.test(name)) continue;

      // the local header repeats the name and extra lengths, and only it is trustworthy
      if (u32(v, local) !== 0x04034b50) continue;
      var lNameLen = u16(v, local + 26), lExtraLen = u16(v, local + 28);
      var dataAt = local + 30 + lNameLen + lExtraLen;
      var raw = v.subarray(dataAt, dataAt + csize);

      var bytes;
      if (method === 0) bytes = raw;
      else if (method === 8) bytes = await inflateRaw(raw);
      else continue;                                        // a method we do not read

      out.push({ name: name, text: dec.decode(bytes) });
    }
    return out;
  }

  /* ---- one entry point for every shape of drop ----------------------------
     A page on its own, a page and a brief, or a zip of both. The caller hands
     over File objects and gets back the same answer in every case, so nothing
     downstream has to know which of the three happened. */
  async function readDrop(files) {
    var pages = [], briefs = [], skipped = [];
    var list = Array.prototype.slice.call(files || []);

    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var name = f.name || "";
      if (/\.zip$/i.test(name)) {
        var inner = await readZip(await f.arrayBuffer());
        inner.forEach(function (z) {
          if (/\.html?$/i.test(z.name)) pages.push({ name: z.name, html: z.text });
          else briefs.push({ name: z.name, text: z.text });
        });
        continue;
      }
      if (/\.html?$/i.test(name)) { pages.push({ name: name, html: await f.text() }); continue; }
      if (/\.(md|txt)$/i.test(name)) { briefs.push({ name: name, text: await f.text() }); continue; }
      skipped.push(name);
    }

    var entries = [];
    briefs.forEach(function (b) {
      entries = entries.concat(global.ThriveIntake.parseBrief(b.text));
    });
    var all = global.ThriveIntake.matchPages(entries, pages);
    return { entries: all, pages: pages.length, briefs: briefs.length, skipped: skipped };
  }

  global.ThriveIntake.readZip = readZip;
  global.ThriveIntake.readDrop = readDrop;
})(typeof window !== "undefined" ? window : this);
