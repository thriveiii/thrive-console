/* Inbound mail: what counts as a reply, and which opportunity it belongs to.
   ==========================================================================

   This module is pure. No DOM, no storage, no network. It exists because the
   attribution rules are the part that has to be right, and a rule you can only
   exercise through a browser is a rule nobody exercises.

   The defect this closes: a campaign went to a real recipient, he replied, the
   reply landed in hi@thriveiii.com, and the console's replies column read zero
   and always had. Nothing watched the inbox. Every reply the business has ever
   received was invisible to the system that exists to track them.

   THE ATTRIBUTION ORDER, AND WHY IT IS AN ORDER
   The first rule that matches wins, and the record STORES WHICH ONE DID. A wrong
   attribution then has a name and a rule to blame, rather than being mysterious.

     1. tag        Reply-To: hi+<slug>@thriveiii.com. Exact, and it survives every
                   mail client, because it is an address rather than a header a
                   client may drop.
     2. thread     In-Reply-To or References matched against the mid already on
                   an outbound record.
     3. sender     The from address matched against a known recipient of a sent
                   opportunity.
     4. none       Stored, named on screen, never discarded and never guessed.

   WHAT IS NOT A REPLY
   A bounce is not a reply. An out of office is not a reply. They are still
   stored, because a bounce is evidence about an address, but they carry
   kind:"auto" and they move no card and count in no total. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThriveInbound = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TAG_DOMAIN = "thriveiii.com";
  var TAG_LOCAL = "hi";

  /* Subjects that announce themselves as machinery, in both languages. Matched
     at the start only: "Automatic reply" is a vacation notice, but "an automatic
     reply would be nice" inside a sentence is a person talking. */
  var AUTO_SUBJECTS = [
    /^\s*automatic reply\b/i,
    /^\s*auto(matic)?[ -]?reply\b/i,
    /^\s*out of (the )?office\b/i,
    /^\s*رد تلقائي/,
    /^\s*ردّ تلقائي/,
    /^\s*خارج المكتب/
  ];

  function str(v) { return v == null ? "" : String(v); }
  function lower(v) { return str(v).trim().toLowerCase(); }
  function arr(v) { return Array.isArray(v) ? v : []; }

  /* Header lookup that does not care about case, because no two mail servers
     agree on it and Gmail's own API hands them back in yet another shape. */
  function header(headers, name) {
    if (!headers) return "";
    var want = lower(name), k;
    for (k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k) && lower(k) === want) return str(headers[k]);
    }
    return "";
  }

  /* An address out of a From or Reply-To value, which may be bare or may be
     "Display Name <box@example.com>" with quoting around the name. */
  function addressOf(value) {
    var s = str(value).trim();
    var m = /<([^<>]+)>/.exec(s);
    if (m) return lower(m[1]);
    return lower(s);
  }

  function displayNameOf(value) {
    var s = str(value).trim();
    var m = /^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/.exec(s);
    if (m && m[1].trim()) return m[1].trim();
    return "";
  }

  /* ---------- rule 0: is this machinery ---------------------------------- */

  /* Deliberately generous. A bounce counted as a reply is a false hope on a
     board, and a false hope costs more than an auto reply filed as auto. */
  function classify(msg) {
    msg = msg || {};
    var from = addressOf(msg.from);
    var subject = str(msg.subject);
    var h = msg.headers || {};

    if (/^mailer-daemon@/i.test(from) || /^postmaster@/i.test(from)) return "auto";

    var auto = lower(header(h, "Auto-Submitted"));
    /* RFC 3834: absence means "no". Any value other than "no" is machinery. */
    if (auto && auto !== "no") return "auto";

    if (header(h, "X-Autoreply")) return "auto";
    if (lower(header(h, "X-Autorespond"))) return "auto";
    if (lower(header(h, "Precedence")) === "auto_reply") return "auto";

    for (var i = 0; i < AUTO_SUBJECTS.length; i++) {
      if (AUTO_SUBJECTS[i].test(subject)) return "auto";
    }
    return "reply";
  }

  /* Is this specifically a delivery failure, as opposed to a vacation notice?
     The two are both "auto", but only one says an address is dead, and phase 8
     suppresses on the dead ones. */
  function bounceKind(msg) {
    msg = msg || {};
    var from = addressOf(msg.from);
    var subject = str(msg.subject);
    var body = str(msg.snippet || msg.body);
    if (!(/^mailer-daemon@/i.test(from) || /^postmaster@/i.test(from))) {
      if (!/delivery status notification|undeliverable|returned mail|delivery has failed/i.test(subject)) return "";
    }
    /* 5.x.x is permanent, 4.x.x is temporary. The distinction is the whole
       reason to classify at all: retrying a permanent failure forever is how a
       dead address quietly eats a sending reputation. */
    if (/\b5\.\d\.\d\b/.test(body) || /\b55\d\b/.test(body)) return "hard";
    if (/\b4\.\d\.\d\b/.test(body) || /\b45\d\b/.test(body)) return "soft";
    if (/permanent|does not exist|no such user|user unknown|address rejected/i.test(body)) return "hard";
    if (/temporar|try again|mailbox full|over quota|deferred/i.test(body)) return "soft";
    return "hard";
  }

  /* ---------- rule 1: the reply-to tag ------------------------------------ */

  /* hi+<slug>@thriveiii.com. Gmail delivers plus-addressed mail to the same
     inbox and the tag survives every client, which is why it outranks headers
     a client is free to drop. */
  function tagAddress(slug, domain, local) {
    var s = str(slug).trim();
    if (!s) return "";
    return (local || TAG_LOCAL) + "+" + s + "@" + (domain || TAG_DOMAIN);
  }

  function slugFromTag(value, domain, local) {
    var addr = addressOf(value);
    if (!addr) return "";
    var at = addr.indexOf("@");
    if (at < 0) return "";
    var box = addr.slice(0, at), host = addr.slice(at + 1);
    if (host !== lower(domain || TAG_DOMAIN)) return "";
    var plus = box.indexOf("+");
    if (plus < 0) return "";
    if (box.slice(0, plus) !== lower(local || TAG_LOCAL)) return "";
    var slug = box.slice(plus + 1);
    return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : "";
  }

  /* A reply carries the tag in whichever field the client chose to echo. Gmail
     puts it in To; some clients put it in Cc; a few only leave it in the
     Delivered-To of the receiving side. All three are read. */
  function tagIn(msg, domain, local) {
    var h = (msg && msg.headers) || {};
    var fields = [msg && msg.to, msg && msg.cc,
                  header(h, "To"), header(h, "Cc"), header(h, "Delivered-To"),
                  header(h, "X-Original-To"), header(h, "Reply-To")];
    for (var i = 0; i < fields.length; i++) {
      var raw = str(fields[i]);
      if (!raw) continue;
      var parts = raw.split(",");
      for (var j = 0; j < parts.length; j++) {
        var slug = slugFromTag(parts[j], domain, local);
        if (slug) return slug;
      }
    }
    return "";
  }

  /* ---------- rule 2: the threading headers ------------------------------ */

  function messageIds(value) {
    var out = [], re = /<([^<>\s]+)>/g, m;
    var s = str(value);
    while ((m = re.exec(s))) out.push(m[1]);
    if (!out.length && s.trim()) out.push(s.trim());
    return out;
  }

  /* The mail ledger's `mid` is what a send wrote down. A client echoes it in
     In-Reply-To, and every client that threads at all echoes the chain in
     References, so both are read and the newest match wins. */
  function threadMatch(msg, mail) {
    var h = (msg && msg.headers) || {};
    var ids = messageIds(header(h, "In-Reply-To")).concat(messageIds(header(h, "References")));
    if (!ids.length) return null;
    /* Providers wrap the id in angle brackets on the wire and store it bare, or
       the other way round, so both sides are stripped before they are compared.
       Indexing the stored shape verbatim is what made this rule never fire. */
    function bare(v) { return str(v).replace(/^<|>$/g, ""); }
    var byId = {};
    arr(mail).forEach(function (m) {
      if (!m || m.direction === "in") return;
      if (m.mid) byId[bare(m.mid)] = m;
      if (m.messageId) byId[bare(m.messageId)] = m;
    });
    for (var i = ids.length - 1; i >= 0; i--) {
      var hit = byId[ids[i]];
      if (hit && hit.opp) return hit;
    }
    return null;
  }

  /* ---------- rule 3: the sender ----------------------------------------- */

  function senderMatch(msg, mail) {
    var from = addressOf(msg && msg.from);
    if (!from) return null;
    var best = null;
    arr(mail).forEach(function (m) {
      if (!m || m.direction === "in" || !m.opp) return;
      if (lower(m.to) !== from) return;
      /* The most recent send to that address is the one being answered. */
      if (!best || str(m.ts) > str(best.ts)) best = m;
    });
    return best;
  }

  /* ---------- the whole decision ----------------------------------------- */

  /* Returns a record ready to be stored, never null. An unmatched reply is a
     record with rule "none" and no opp, because the one thing that must never
     happen is a reply arriving and nothing existing to show for it. */
  function attribute(msg, ctx) {
    msg = msg || {};
    ctx = ctx || {};
    var mail = arr(ctx.mail);
    var opps = arr(ctx.opps);
    var kind = classify(msg);

    var rec = {
      gid: str(msg.gid || msg.id),
      from: addressOf(msg.from),
      name: displayNameOf(msg.from) || str(msg.fromName),
      subject: str(msg.subject),
      ts: str(msg.ts || msg.date),
      snippet: str(msg.snippet || msg.body).slice(0, 300),
      threadId: str(msg.threadId),
      kind: kind,
      rule: "none",
      opp: ""
    };
    if (kind === "auto") {
      var b = bounceKind(msg);
      if (b) rec.bounce = b;
    }

    var known = {};
    opps.forEach(function (o) { if (o && o.slug) known[o.slug] = 1; });

    var tagged = tagIn(msg, ctx.domain, ctx.local);
    /* A tag naming a slug this console has never heard of is not a match. It is
       almost certainly a slug that was deleted, and attaching a reply to a
       record that is gone loses it more quietly than leaving it unattributed. */
    if (tagged && (!opps.length || known[tagged])) {
      rec.rule = "tag";
      rec.opp = tagged;
      return rec;
    }

    var th = threadMatch(msg, mail);
    if (th && (!opps.length || known[th.opp])) {
      rec.rule = "thread";
      rec.opp = th.opp;
      return rec;
    }

    var sn = senderMatch(msg, mail);
    if (sn && (!opps.length || known[sn.opp])) {
      rec.rule = "sender";
      rec.opp = sn.opp;
      return rec;
    }

    return rec;
  }

  /* ---------- idempotency ------------------------------------------------- */

  /* Keyed on the Gmail message id. Running the scan twice, or syncing twice,
     produces one record. This is the property nobody notices until it is
     missing, and by then the replies column is double. */
  function mergeInbound(local, incoming) {
    var out = [], seen = {};
    function take(r) {
      if (!r) return;
      var id = str(r.gid);
      if (!id) id = str(r.from) + "|" + str(r.ts) + "|" + str(r.subject);
      if (seen[id]) {
        /* Same message twice. Keep the one that knows more: an attributed copy
           beats an unattributed one, whichever arrived first. */
        var prev = seen[id];
        if (prev.rule === "none" && r.rule !== "none") {
          out[prev.__i] = r;
          r.__i = prev.__i;
          seen[id] = r;
        }
        return;
      }
      r.__i = out.length;
      seen[id] = r;
      out.push(r);
    }
    arr(local).forEach(take);
    arr(incoming).forEach(take);
    return out.map(function (r) { var c = {}; for (var k in r) { if (k !== "__i") c[k] = r[k]; } return c; });
  }

  /* Which opportunities a set of inbound records says have replied. Auto
     records are excluded here rather than at the call site, so no caller can
     forget and move a card because of a vacation notice. */
  function repliedSlugs(records) {
    var out = {}, list = [];
    arr(records).forEach(function (r) {
      if (!r || r.kind === "auto" || !r.opp) return;
      if (out[r.opp]) return;
      out[r.opp] = 1;
      list.push({ slug: r.opp, ts: r.ts, gid: r.gid, rule: r.rule });
    });
    return list;
  }

  /* The day part of a timestamp, which is what the lifecycle move wants. */
  function dayOf(ts) {
    var s = str(ts);
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) return m[1];
    var d = new Date(s);
    if (isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* A Gmail deep link for a stored record. The thread id is what opens the
     conversation rather than one message, which is what a person wants. */
  function gmailLink(rec) {
    var id = str(rec && (rec.threadId || rec.gid));
    if (!id) return "";
    return "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(id);
  }

  /* ---------- the join basis: one derivation, one precedence ------------- */

  /* Every inbound row is joined to its opportunity by one of five bases. This is
     the SINGLE place the basis is decided, so the board, the thread and the tests
     read one answer and it cannot drift. The precedence is fixed, and a
     DETERMINISTIC basis always outranks a HEURISTIC one for the same row:

       plus-address       Reply-To hi+<slug>@. An address; no client rewrites it.   deterministic
       references         In-Reply-To/References against a sent Message-ID.         deterministic
       sender             From matches a known recipient of a sent opportunity.     heuristic
       subject-heuristic  the normalised subject matches one sent subject.          heuristic
       manual             a person attached it by hand.                             certain (human)
       unresolved         nothing matched; stored, named, never guessed.

     The stored provenance is `rule` (tag/thread/sender/none, from attribute()) and,
     on the client, `match_tier` (header/subject/sender) and `match_mode`. joinBasis
     projects those onto the one vocabulary; it never guesses beyond them. The
     if-chain order IS the precedence, so a row carrying both a deterministic and a
     heuristic signal records the deterministic one. */
  var BASIS = {
    "plus-address":      { basis: "plus-address",      deterministic: true,  heuristic: false },
    "references":        { basis: "references",        deterministic: true,  heuristic: false },
    "sender":            { basis: "sender",            deterministic: false, heuristic: true  },
    "subject-heuristic": { basis: "subject-heuristic", deterministic: false, heuristic: true  },
    "manual":            { basis: "manual",            deterministic: true,  heuristic: false },
    "unresolved":        { basis: "unresolved",        deterministic: false, heuristic: false }
  };

  function joinBasis(rec) {
    rec = rec || {};
    var rule = lower(rec.rule);         // tag | thread | sender | none
    var tier = lower(rec.match_tier);   // header | subject | sender
    var mode = lower(rec.match_mode);   // auto | manual
    /* A hand attachment is certain and stands outside the automated ladder. */
    if (mode === "manual") return BASIS["manual"];
    /* The automated ladder, deterministic rungs before heuristic ones. */
    if (rule === "tag") return BASIS["plus-address"];
    if (rule === "thread" || tier === "header") return BASIS["references"];
    if (rule === "sender" || tier === "sender") return BASIS["sender"];
    if (tier === "subject") return BASIS["subject-heuristic"];
    /* Placed on an opportunity by some other stored decision (a person, an
       import) with no ladder rung recorded: certain-by-human, not a guess. */
    if (rec.opp) return BASIS["manual"];
    return BASIS["unresolved"];
  }

  /* ---------- self test --------------------------------------------------- */

  function selfTest() {
    var f = [];
    var mail = [
      { mid: "m1", messageId: "<abc@relay>", opp: "wise-butterfly", to: "hello@wise.example", ts: "2026-08-01T10:00:00Z", direction: "out" },
      { mid: "m2", opp: "two-faces", to: "team@twofaces.example", ts: "2026-08-02T10:00:00Z", direction: "out" }
    ];
    var opps = [{ slug: "wise-butterfly" }, { slug: "two-faces" }, { slug: "ludic-lillian" }];
    var ctx = { mail: mail, opps: opps };

    // rule 1, the tag, and it outranks everything else even when they disagree
    var a = attribute({ gid: "g1", from: "Owner <owner@wise.example>", to: "hi+wise-butterfly@thriveiii.com",
                        subject: "Re: hello", ts: "2026-08-03T09:00:00Z", snippet: "sounds good" }, ctx);
    if (a.rule !== "tag" || a.opp !== "wise-butterfly") f.push("tag rule, got " + a.rule + "/" + a.opp);

    var conflict = attribute({ gid: "g1b", from: "team@twofaces.example",
                               to: "hi+wise-butterfly@thriveiii.com", subject: "Re" }, ctx);
    if (conflict.rule !== "tag" || conflict.opp !== "wise-butterfly") f.push("the tag must outrank the sender");

    // rule 2, threading, with the tag absent
    var b = attribute({ gid: "g2", from: "someone@elsewhere.example", subject: "Re: hello",
                        headers: { "In-Reply-To": "<abc@relay>" } }, ctx);
    if (b.rule !== "thread" || b.opp !== "wise-butterfly") f.push("thread rule, got " + b.rule + "/" + b.opp);

    var bref = attribute({ gid: "g2b", from: "x@y.example",
                           headers: { References: "<other@x> <abc@relay>" } }, ctx);
    if (bref.rule !== "thread") f.push("References must match as well as In-Reply-To");

    // rule 3, the sender
    var c = attribute({ gid: "g3", from: "Team <team@twofaces.example>", subject: "Re: offer" }, ctx);
    if (c.rule !== "sender" || c.opp !== "two-faces") f.push("sender rule, got " + c.rule + "/" + c.opp);
    if (c.name !== "Team") f.push("display name, got " + c.name);

    // rule 4, no match, stored rather than discarded
    var d = attribute({ gid: "g4", from: "stranger@nowhere.example", subject: "hi" }, ctx);
    if (d.rule !== "none" || d.opp !== "") f.push("unmatched must be rule none with no opp");
    if (!d.gid) f.push("an unmatched reply must still be a record");

    // a tag naming a slug that no longer exists is not a match
    var gone = attribute({ gid: "g4b", from: "a@b.example", to: "hi+deleted-thing@thriveiii.com" }, ctx);
    if (gone.rule !== "none") f.push("a tag for an unknown slug must not match");

    // machinery
    var bounce = attribute({ gid: "g5", from: "mailer-daemon@googlemail.com",
                             subject: "Delivery Status Notification (Failure)",
                             snippet: "550 5.1.1 The email account does not exist" }, ctx);
    if (bounce.kind !== "auto") f.push("a bounce must be auto");
    if (bounce.bounce !== "hard") f.push("a 550 must be a hard bounce, got " + bounce.bounce);

    var ooo = attribute({ gid: "g6", from: "team@twofaces.example", subject: "Automatic reply: away" }, ctx);
    if (ooo.kind !== "auto") f.push("an out of office must be auto");
    var oooAr = attribute({ gid: "g6b", from: "team@twofaces.example", subject: "رد تلقائي: إجازة" }, ctx);
    if (oooAr.kind !== "auto") f.push("an Arabic out of office must be auto");
    var subm = attribute({ gid: "g6c", from: "a@b.example", headers: { "Auto-Submitted": "auto-replied" } }, ctx);
    if (subm.kind !== "auto") f.push("Auto-Submitted other than no must be auto");
    var human = attribute({ gid: "g6d", from: "a@b.example", headers: { "Auto-Submitted": "no" } }, ctx);
    if (human.kind !== "reply") f.push("Auto-Submitted: no is a person");

    // machinery moves no card
    var moved = repliedSlugs([bounce, ooo, a]);
    if (moved.length !== 1 || moved[0].slug !== "wise-butterfly") f.push("only the real reply may move a card");

    // idempotency
    var once = mergeInbound([], [a, b, c]);
    var twice = mergeInbound(once, [a, b, c]);
    if (twice.length !== once.length) f.push("a second scan must not add records, got " + twice.length + " vs " + once.length);
    var upgraded = mergeInbound([{ gid: "g9", rule: "none", opp: "" }], [{ gid: "g9", rule: "tag", opp: "two-faces" }]);
    if (upgraded.length !== 1 || upgraded[0].rule !== "tag") f.push("a later attributed copy must win");

    // the tag round trips
    if (slugFromTag(tagAddress("wise-butterfly")) !== "wise-butterfly") f.push("the tag must round trip");
    if (slugFromTag("hi+x@example.com")) f.push("a tag on another domain is not ours");
    if (slugFromTag("hi@thriveiii.com")) f.push("an untagged address carries no slug");

    if (dayOf("2026-08-03T09:00:00Z") !== "2026-08-03") f.push("dayOf, got " + dayOf("2026-08-03T09:00:00Z"));
    if (!/thriveiii/.test(tagAddress("s"))) f.push("tagAddress domain");
    if (gmailLink({ threadId: "t1" }).indexOf("t1") < 0) f.push("gmail link must carry the thread");

    // the join basis: one vocabulary, fixed precedence, deterministic wins
    if (joinBasis({ rule: "tag" }).basis !== "plus-address") f.push("tag is plus-address");
    if (!joinBasis({ rule: "tag" }).deterministic) f.push("plus-address is deterministic");
    if (joinBasis({ rule: "thread" }).basis !== "references") f.push("thread is references");
    if (joinBasis({ match_tier: "header" }).basis !== "references") f.push("header tier is references");
    if (joinBasis({ rule: "sender" }).basis !== "sender") f.push("sender is sender");
    if (joinBasis({ rule: "sender" }).deterministic) f.push("sender is heuristic, not deterministic");
    if (joinBasis({ match_tier: "subject" }).basis !== "subject-heuristic") f.push("subject is subject-heuristic");
    if (joinBasis({ match_tier: "subject" }).deterministic) f.push("subject is heuristic, not deterministic");
    if (joinBasis({ match_mode: "manual", opp: "x" }).basis !== "manual") f.push("a hand attachment is manual");
    if (!joinBasis({ match_mode: "manual" }).deterministic) f.push("manual is certain");
    if (joinBasis({}).basis !== "unresolved") f.push("no signal is unresolved");
    // precedence: a row matchable by BOTH joins records the deterministic one
    if (joinBasis({ rule: "tag", match_tier: "header" }).basis !== "plus-address")
      f.push("plus-address outranks references on the same row");
    if (joinBasis({ rule: "thread", match_tier: "subject" }).basis !== "references")
      f.push("references outranks subject on the same row");
    if (joinBasis({ rule: "sender", match_tier: "header" }).basis !== "references")
      f.push("a deterministic references must beat a heuristic sender on the same row");
    if (joinBasis({ match_tier: "subject", rule: "sender" }).basis !== "sender")
      f.push("sender (heuristic) still outranks subject (heuristic) by fixed order");

    return { pass: !f.length, failures: f };
  }

  return {
    TAG_DOMAIN: TAG_DOMAIN,
    TAG_LOCAL: TAG_LOCAL,
    addressOf: addressOf,
    displayNameOf: displayNameOf,
    classify: classify,
    bounceKind: bounceKind,
    tagAddress: tagAddress,
    slugFromTag: slugFromTag,
    attribute: attribute,
    joinBasis: joinBasis,
    mergeInbound: mergeInbound,
    repliedSlugs: repliedSlugs,
    dayOf: dayOf,
    gmailLink: gmailLink,
    selfTest: selfTest
  };
});
