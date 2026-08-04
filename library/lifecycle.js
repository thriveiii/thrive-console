/* ============================================================================
   Thrive Console · the opportunity lifecycle
   ----------------------------------------------------------------------------
   Pure. Reads nothing from storage, writes nothing to storage, touches no DOM.
   The host passes a record in and gets back a patch, an activity line, and an
   error if the move was not legal.

   It exists because a state that can change from three places will eventually
   change three different ways. Every move in the console goes through apply()
   and there is no second path. A transition not in MOVES does not exist.

   ---------------------------------------------------------------------------
   NINE STATES, AND WHY TWO OF THEM ARE NOT LANES
   ---------------------------------------------------------------------------
   draft, ready, sent, opened, replied, won, lost, dropped, archived.

   Seven of them are the record's stage. Two are not:

   `archived` is a flag, not a stage, because unarchive has to put the record
   back where it was and a record that forgot its stage cannot be put back. It
   sits beside the stage rather than replacing it.

   `dropped` is a stage, and it is deliberately different from `lost`. Lost is a
   judgement about the prospect: they said no, or went quiet after the one nudge.
   Dropped is a decision about the work: we are not pursuing this, and the reason
   is ours. Collapsing the two would lose the only distinction that tells you
   whether the pipeline is failing or you are choosing.

   Neither gets a board lane. IDENTITY Law 3.3 keeps finished work out of the
   lanes, so dropped joins won and lost in the tray, and archived leaves the
   board entirely. A lane would also mean a new colour, which IDENTITY §11 G3
   requires a meaning for, and "not pursuing" is an absence rather than a state
   of the pipeline.

   ---------------------------------------------------------------------------
   WHAT MAKES A CARD "SENT"
   ---------------------------------------------------------------------------
   Evidence, and only evidence: a mail ledger entry, or a hand contact recorded
   through someone else's channel. NOT the sent_on field, which is the day the
   page was made and is filled in on every record including ones nobody has been
   written to. Reading that field as a send is the defect that put pages with no
   email into Sent and their page views into Opened, and the rule it broke is the
   one this file exists to hold.
   ============================================================================ */
(function (global) {
  "use strict";

  var STAGES = ["draft", "ready", "sent", "opened", "replied", "won", "lost", "dropped"];
  var OPEN_STAGES = ["draft", "ready", "sent", "opened", "replied"];
  var CLOSED_STAGES = ["won", "lost", "dropped"];

  /* The console's internal name for "published, nothing sent" is `live`, and it has been in
     stored records and in the derivation layer since before this file. The label a person
     reads is "Ready". Both names answer to the same state here rather than renaming a value
     that already exists in somebody's browser. */
  function norm(st) { return st === "live" ? "ready" : (st || ""); }

  var CHANNELS = ["web_form", "instagram", "linkedin", "whatsapp", "x", "phone", "other"];

  /* A short list, because a free-text loss reason is a field nobody can count later. Drop
     takes free text instead, because a drop is a one-off judgement and forcing it into a
     taxonomy would produce a taxonomy of one-offs. */
  var LOST_REASONS = ["declined", "no_reply", "wrong_fit", "went_elsewhere", "unreachable"];

  /* ---- the move table -----------------------------------------------------
     from: which stages the move is legal from. "*" means any open stage.
     final: the move cannot be undone by its own inverse, only by `reopen`.  */
  var MOVES = {
    publish:         { from: ["draft"],                          to: "ready" },
    unpublish:       { from: ["ready"],                          to: "draft" },
    send_email:      { from: ["ready"],                          to: "sent" },
    send_offchannel: { from: ["ready"],                          to: "sent" },
    record_reply:    { from: ["sent", "opened"],                 to: "replied" },
    /* WO-015 Phase D: an opportunity that earned a reply can convert to an offer.
       Convert does not change the stage, it binds an offer artifact and opens
       chapter two (I8), so it is an @same move logged the same documented way
       archive is, through apply then saveDraft then logActivity, not a bespoke
       path. It is the ONLY way to set "converted to offer" (I9). */
    convert:         { from: ["replied"],                        to: "@same" },
    mark_won:        { from: ["replied", "opened", "sent"],      to: "won",   final: true },
    mark_lost:       { from: OPEN_STAGES,                        to: "lost",  final: true },
    drop:            { from: OPEN_STAGES,                        to: "dropped" },
    restore:         { from: ["dropped", "lost"],                to: "@prev" },
    archive:         { from: "*",                                to: "@flag" },
    unarchive:       { from: "@archived",                        to: "@prev" },
    reopen:          { from: ["won", "lost"],                    to: "replied" },
    retire_page:     { from: "*",                                to: "@same" }
  };

  /* Moves a person could regret. The host offers Undo on these and only these. */
  var UNDOABLE = ["drop", "archive", "mark_lost", "mark_won", "convert"];

  function has(list, v) { return list.indexOf(v) >= 0; }

  /* ---- reading a record ---------------------------------------------------
     stageOf answers what the record IS, which is not always what it declares:
     an undeclared record is a draft or ready depending on whether its page is
     published, and a sent record becomes opened when somebody reads it. The host
     owns that derivation (effStage), so it is injected rather than copied. A
     second implementation of the stage rule is how two surfaces start
     disagreeing about the same record.                                       */
  function stageOf(o, ctx) {
    if (!o) return "";
    ctx = ctx || {};
    if (typeof ctx.stage === "function") return norm(ctx.stage(o));
    if (typeof global.effStage === "function") return norm(global.effStage(o));
    return norm(o.stage) || "draft";
  }

  function isArchived(o) { return !!(o && o.archived); }

  /* Evidence of a send. The ledger and the hand contacts, never sent_on. */
  function sendCount(o, ctx) {
    ctx = ctx || {};
    var n = 0;
    if (typeof ctx.sends === "function") n += ctx.sends(o) || 0;
    n += manualContacts(o).length;
    return n;
  }
  function manualContacts(o) {
    return (o && Array.isArray(o.manual_contacts)) ? o.manual_contacts : [];
  }

  /* ---- which moves are legal right now ------------------------------------ */
  function fromMatches(spec, st, archived) {
    if (spec === "*") return !archived && has(OPEN_STAGES.concat(CLOSED_STAGES), st);
    if (spec === "@archived") return archived;
    return !archived && has(spec, st);
  }

  function movesFor(o, ctx) {
    var st = stageOf(o, ctx), arch = isArchived(o);
    var out = [];
    Object.keys(MOVES).forEach(function (k) {
      if (!fromMatches(MOVES[k].from, st, arch)) return;
      if (k === "restore" && !o.prev_stage) return;      // nothing recorded to restore to
      if (k === "convert" && o.converted_at) return;     // an opportunity converts once
      if (k === "unarchive" && !arch) return;
      if (k === "unpublish" && sendCount(o, ctx) > 0) return;  // a send cannot be unpublished away
      if (k === "retire_page" && o.page_missing) return;
      out.push(k);
    });
    return out;
  }

  function can(move, o, ctx) { return has(movesFor(o, ctx), move); }

  /* ---- guards -------------------------------------------------------------
     Each returns an error key, or "" when the move may proceed. They are keys
     rather than sentences so the host renders them in the reader's language. */
  function guard(move, o, opts, ctx) {
    opts = opts || {};
    var st = stageOf(o, ctx);
    if (!can(move, o, ctx)) return "lc_err_illegal";

    if (move === "publish") {
      if (!opts.hasPage && !(o.html || o.template)) return "lc_err_nopage";
      if (opts.slugTaken) return "lc_err_slug";
    }
    if (move === "unpublish" && sendCount(o, ctx) > 0) return "lc_err_sent_already";
    if (move === "send_offchannel") {
      if (!has(CHANNELS, opts.channel)) return "lc_err_channel";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(opts.sent_on || ""))) return "lc_err_date";
      if (!String(opts.body || "").trim()) return "lc_err_body";
      /* The guard that matters. An unsubstituted [LINK] means the prospect received a message
         with a placeholder where the page should have been. The console makes that impossible
         rather than detectable, because detectable is after it was sent. */
      if (String(opts.body).indexOf("[LINK]") >= 0) return "lc_err_link";
    }
    if (move === "record_reply" && !/^\d{4}-\d{2}-\d{2}$/.test(String(opts.replied_on || ""))) return "lc_err_date";
    if (move === "convert" && !String(opts.text || "").trim()) return "lc_err_offer_text";
    if (move === "mark_lost" && !has(LOST_REASONS, opts.reason)) return "lc_err_reason";
    if (move === "drop" && !String(opts.reason || "").trim()) return "lc_err_reason_text";
    if (move === "reopen" && !opts.confirmed) return "lc_err_confirm";
    if (move === "restore" && !o.prev_stage) return "lc_err_noprev";
    return "";
  }

  /* ---- applying a move ----------------------------------------------------
     Returns { ok, error, patch, action, detail, undo }.

     `patch` is the fields to merge onto the record and nothing else, so the host
     saves through the path it already has. `undo` is the patch that puts it back,
     computed here while the previous values are still known, because working out
     an inverse later means guessing at what was overwritten.                 */
  function apply(move, o, opts, ctx) {
    opts = opts || {};
    var err = guard(move, o, opts, ctx);
    if (err) return { ok: false, error: err };

    var st = stageOf(o, ctx);
    var m = MOVES[move];
    var patch = {}, undo = {}, detail = "";

    function setStage(next) {
      patch.stage = next;
      /* Derived stages are stored as an empty declaration, so the record goes back to being
         read from its evidence rather than from a stale claim about itself. */
      if (next === "ready" || next === "draft") patch.stage = "";
      undo.stage = o.stage || "";
    }

    if (move === "publish")   { setStage("ready");  patch.published = true;  undo.published = !!o.published; }
    if (move === "unpublish") { setStage("draft");  patch.published = false; undo.published = !!o.published; }

    if (move === "send_offchannel") {
      var c = {
        id: opts.id || ("mc" + String(Date.now()) + Math.random().toString(36).slice(2, 7)),
        channel: opts.channel,
        url: opts.url || "",
        sent_on: opts.sent_on,
        body: String(opts.body),          // verbatim, exactly what was pasted into their form
        note: String(opts.note || "")
      };
      patch.manual_contacts = manualContacts(o).concat([c]);
      undo.manual_contacts = manualContacts(o).slice();
      detail = opts.channel + (opts.url ? " · " + opts.url : "");
      /* No stage is declared. The record now carries evidence of a send, and the derivation
         reads that evidence, which is the same thing the mail ledger does for an email. A
         declared "sent" on top of it would be a second answer to one question. */
    }

    if (move === "record_reply") {
      setStage("replied");
      patch.replied_on = opts.replied_on;
      undo.replied_on = o.replied_on || "";
      detail = opts.replied_on;
      /* A reply on Instagram is a reply. The channel and the note are additive
         and optional, so a reply the relay attributed from the inbox carries
         neither and still counts exactly the same. What differs is only how the
         console came to know, and that is worth recording rather than flattening. */
      if (opts.channel) {
        patch.reply_channel = opts.channel;
        undo.reply_channel = o.reply_channel || "";
        detail = opts.replied_on + " · " + opts.channel;
      }
      if (opts.note) {
        patch.reply_note = String(opts.note).slice(0, 600);
        undo.reply_note = o.reply_note || "";
      }
    }
    if (move === "convert") {
      /* Bind the offer artifact and stamp the conversion. The stage is untouched:
         the offer opens chapter two, and the lane follows that chapter through
         activeChapterStage, not through a declared stage. The artifact travels
         additively on the record (I8, I10), and undo lifts it cleanly. */
      patch.offer = { text: String(opts.text || ""), html: String(opts.html || ""), up: Date.now() };
      undo.offer = (o.offer === undefined) ? null : o.offer;
      patch.converted_at = opts.at || String(Date.now());
      undo.converted_at = o.converted_at || "";
    }
    if (move === "mark_won") { setStage("won"); patch.prev_stage = st; undo.prev_stage = o.prev_stage || ""; }
    if (move === "mark_lost") {
      setStage("lost");
      patch.prev_stage = st; undo.prev_stage = o.prev_stage || "";
      patch.lost_reason = opts.reason; undo.lost_reason = o.lost_reason || "";
      detail = opts.reason;
    }
    if (move === "drop") {
      setStage("dropped");
      patch.prev_stage = st; undo.prev_stage = o.prev_stage || "";
      patch.drop_reason = String(opts.reason).trim(); undo.drop_reason = o.drop_reason || "";
      detail = patch.drop_reason;
    }
    if (move === "restore" || move === "unarchive") {
      var back = o.prev_stage || "";
      if (move === "unarchive") { patch.archived = false; undo.archived = true; }
      if (move === "restore" || (move === "unarchive" && has(CLOSED_STAGES, norm(o.stage)))) {
        patch.stage = (back === "ready" || back === "draft") ? "" : back;
        undo.stage = o.stage || "";
        patch.prev_stage = ""; undo.prev_stage = o.prev_stage || "";
      }
      detail = back;
    }
    if (move === "archive") {
      patch.archived = true; undo.archived = !!o.archived;
      patch.prev_stage = st; undo.prev_stage = o.prev_stage || "";
    }
    if (move === "reopen") {
      setStage("replied");
      patch.lost_reason = ""; undo.lost_reason = o.lost_reason || "";
      patch.prev_stage = ""; undo.prev_stage = o.prev_stage || "";
    }
    if (move === "retire_page") {
      patch.page_missing = true; undo.page_missing = !!o.page_missing;
    }

    return {
      ok: true,
      patch: patch,
      undo: undo,
      action: "lc_" + move,          // the activity action name, one per move
      detail: detail,
      undoable: has(UNDOABLE, move)
    };
  }

  /* ---- deleting a page template -------------------------------------------
     A built page does not belong to the template it came from. Deleting the
     template must never change a page that has already gone out, so the pages
     stay exactly as they are and are flagged instead.

     The one case that genuinely breaks is a draft: it has no built html yet and
     regenerates from the template every time it is opened, so deleting the
     template underneath it leaves a record that cannot produce a page. Those
     block the deletion, and the count is named, because "cannot delete" without
     a number is a dead end rather than an instruction.                       */
  function templateDeletion(templateId, opps, ctx) {
    var blocking = [], affected = [];
    (opps || []).forEach(function (o) {
      if (!o || o.template !== templateId) return;
      affected.push(o.slug);
      if (stageOf(o, ctx) === "draft") blocking.push(o.slug);
    });
    return {
      allowed: blocking.length === 0,
      blocking: blocking,
      affected: affected,
      patches: blocking.length ? [] : affected.map(function (s) {
        return { slug: s, template_retired: true };
      })
    };
  }

  /* ---- self test ----------------------------------------------------------
     Runs only when asked. Asserts the table against records with known answers,
     including the two rules this file exists to hold: sent_on never moves a card
     on its own, and an unsubstituted [LINK] cannot be sent.                  */
  function selfTest() {
    var f = [];
    var ctx = { stage: function (o) { return o.__st; }, sends: function (o) { return o.__sends || 0; } };

    /* sent_on alone is not a send. This is the regression that started the board work. */
    var made = { slug: "a", sent_on: "2026-07-01", __st: "ready" };
    if (sendCount(made, ctx) !== 0) f.push("sent_on must not count as a send");
    if (!can("send_offchannel", made, ctx)) f.push("a ready card must accept an off channel send");

    /* the [LINK] guard */
    var bad = apply("send_offchannel", made, {
      channel: "web_form", url: "https://x.example", sent_on: "2026-08-03",
      body: "Hello there [LINK]"
    }, ctx);
    if (bad.ok || bad.error !== "lc_err_link") f.push("an unsubstituted [LINK] must block the send, got " + bad.error);

    var good = apply("send_offchannel", made, {
      channel: "web_form", url: "https://x.example", sent_on: "2026-08-03", body: "Hello there https://y"
    }, ctx);
    if (!good.ok) f.push("a substituted body must send, got " + good.error);
    if (!good.patch.manual_contacts || good.patch.manual_contacts.length !== 1) f.push("the contact must be recorded");
    if (good.patch.stage !== undefined) f.push("an off channel send declares no stage, it leaves evidence");
    if (good.patch.manual_contacts[0].body !== "Hello there https://y") f.push("the body must be stored verbatim");

    /* a bad channel and a bad date are refused */
    if (apply("send_offchannel", made, { channel: "carrier_pigeon", sent_on: "2026-08-03", body: "x" }, ctx).error !== "lc_err_channel")
      f.push("an unknown channel must be refused");
    if (apply("send_offchannel", made, { channel: "other", sent_on: "soon", body: "x" }, ctx).error !== "lc_err_date")
      f.push("a date that is not a date must be refused");

    /* evidence moves the card, and then unpublish is no longer offered */
    var sent = { slug: "b", __st: "sent", manual_contacts: [{ id: "1", channel: "other", sent_on: "2026-08-01", body: "x" }] };
    if (sendCount(sent, ctx) !== 1) f.push("a hand contact is a send");
    if (can("unpublish", sent, ctx)) f.push("a card with a send must not offer unpublish");

    /* drop and lost are different, and both need their reason */
    if (apply("drop", made, {}, ctx).error !== "lc_err_reason_text") f.push("drop needs a reason");
    if (apply("mark_lost", made, { reason: "because" }, ctx).error !== "lc_err_reason")
      f.push("lost needs a reason from the list");
    var dropped = apply("drop", made, { reason: "he sells food" }, ctx);
    if (dropped.patch.stage !== "dropped") f.push("drop sets dropped");
    if (dropped.patch.prev_stage !== "ready") f.push("drop remembers where it came from");
    if (!dropped.undoable) f.push("drop must be undoable");

    /* restore puts it back where it was, and ready is stored as no declaration */
    var afterDrop = { slug: "a", __st: "dropped", stage: "dropped", prev_stage: "ready" };
    var back = apply("restore", afterDrop, {}, ctx);
    if (!back.ok) f.push("restore must be legal on a dropped card, got " + back.error);
    if (back.patch.stage !== "") f.push("restoring to ready clears the declaration, got " + back.patch.stage);

    /* archive is a flag and keeps the stage underneath it */
    var arch = apply("archive", sent, {}, ctx);
    if (arch.patch.archived !== true) f.push("archive sets the flag");
    if (arch.patch.stage !== undefined) f.push("archive must not change the stage");
    var archived = { slug: "b", archived: true, prev_stage: "sent", __st: "sent" };
    if (!can("unarchive", archived, ctx)) f.push("an archived card must offer unarchive");
    if (can("drop", archived, ctx)) f.push("an archived card offers no open-state moves");

    /* reopen needs saying so out loud */
    var won = { slug: "c", stage: "won", __st: "won" };
    if (apply("reopen", won, {}, ctx).error !== "lc_err_confirm") f.push("reopen needs confirmation");
    if (!apply("reopen", won, { confirmed: true }, ctx).ok) f.push("a confirmed reopen must work");

    /* convert binds an offer, needs its text, and happens once */
    var replied = { slug: "r", __st: "replied" };
    if (!can("convert", replied, ctx)) f.push("a replied opportunity can convert");
    if (apply("convert", replied, {}, ctx).error !== "lc_err_offer_text") f.push("convert needs its offer text");
    var conv = apply("convert", replied, { text: "Here is the offer", html: "<p>offer</p>", at: "2026-08-04T00:00:00Z" }, ctx);
    if (!conv.ok) f.push("a convert with text must apply, got " + conv.error);
    if (!conv.patch.offer || conv.patch.offer.text !== "Here is the offer") f.push("convert binds the offer text");
    if (conv.patch.converted_at !== "2026-08-04T00:00:00Z") f.push("convert stamps the conversion");
    if (conv.patch.stage !== undefined) f.push("convert leaves the stage alone");
    if (!conv.undoable) f.push("convert must be undoable");
    if (can("convert", { slug: "r2", __st: "replied", converted_at: "2026-08-04T00:00:00Z" }, ctx))
      f.push("an already converted opportunity does not convert again");

    /* a move that is not in the table does not exist */
    if (apply("teleport", made, {}, ctx).error !== "lc_err_illegal") f.push("an unknown move must be refused");
    if (can("publish", made, ctx)) f.push("a ready card cannot be published again");

    /* deleting a page template */
    var opps = [
      { slug: "d1", template: "en-opp1", __st: "draft" },
      { slug: "s1", template: "en-opp1", __st: "sent" },
      { slug: "x1", template: "other", __st: "draft" }
    ];
    var del = templateDeletion("en-opp1", opps, ctx);
    if (del.allowed) f.push("a template with a draft on it must block deletion");
    if (del.blocking.length !== 1 || del.blocking[0] !== "d1") f.push("the blocking draft must be named");
    var del2 = templateDeletion("en-opp1", opps.filter(function (o) { return o.slug !== "d1"; }), ctx);
    if (!del2.allowed) f.push("with no drafts the deletion proceeds");
    if (del2.patches.length !== 1 || !del2.patches[0].template_retired) f.push("the built pages are flagged, not changed");

    return { pass: f.length === 0, fails: f };
  }

  if (typeof global.location !== "undefined" && /selftest/.test(global.location.hash || "")) {
    setTimeout(function () {
      var r = selfTest();
      console[r.pass ? "log" : "error"]("ThriveLifecycle selfTest", r);
      global.__thriveLifecycleSelfTest = r;
    }, 0);
  }

  global.ThriveLifecycle = {
    STAGES: STAGES,
    OPEN_STAGES: OPEN_STAGES,
    CLOSED_STAGES: CLOSED_STAGES,
    CHANNELS: CHANNELS,
    LOST_REASONS: LOST_REASONS,
    MOVES: MOVES,
    UNDOABLE: UNDOABLE,
    norm: norm,
    stageOf: stageOf,
    manualContacts: manualContacts,
    sendCount: sendCount,
    movesFor: movesFor,
    can: can,
    guard: guard,
    apply: apply,
    templateDeletion: templateDeletion,
    selfTest: selfTest
  };
})(typeof window !== "undefined" ? window : this);
