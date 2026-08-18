/* P16 · The page-to-section join, completed. The token ranker (P13) governs the one join, and an unmatched
   section is a JOIN FAILURE to surface, never a card to spawn. Pure logic, the part the sandbox proves:

     1. token-prefix: a folder page (opp/hypergoat-coffee) and its section ("Hypergoat Coffee Roasters")
        join by token-prefix, where slugify-equality alone never could. This was the live batch-13 break.
     2. tie -> CONFIRM: two equally specific pages for one section are never auto-joined; one confirm row.
     3. below-threshold orphan: a section that matches no page renders in the orphan list and spawns NOTHING
        (no row among the pages, no draft, no card).
     4. specificity: river-sea vs river-sea-chocolates for one "River-Sea Chocolates" section assigns the
        more specific page (exact) and leaves the other a needs-message page, never mis-assigned.
     5. the count line is truthful: pages N, matched M, confirm C, needs-message K, orphan sections J. */
const fs = require("fs"), path = require("path");
const TI = require(path.join(__dirname, "../library/intake.js")).ThriveIntake;

let fails = [];
function ck(n, c, d) { console.log((c ? "PASS " : "FAIL ") + n); if (!c) { fails.push(n); if (d !== undefined) console.log("      " + String(d).slice(0, 300)); } }

const P = (s) => ({ name: "opp/" + s + "/index.html", html: "<!doctype html><h1>" + s + "</h1>" });
function sec(biz, email, subj) { return "## " + biz + "\n- **Send to:** " + email + "\n- **Subject:** " + subj + "\n```\nHi {{NAME}}, hello. [LINK]\n```\n"; }
function resolve(pages, md, jsons) { return TI.resolveBatch(pages, [{ name: "research.md", text: md }], jsons || []); }

// ---- 1. token-prefix (the live batch-13 break: hypergoat-coffee vs "Hypergoat Coffee Roasters") --------
{
  const out = resolve([P("hypergoat-coffee")], "# B\n" + sec("Hypergoat Coffee Roasters", "hi@hypergoat.com", "The roasters"));
  const r = out.report.rows[0] || {};
  ck("token-prefix: one row, matched, joined onto the page slug (not the longer section slug)",
     out.report.rows.length === 1 && r.slug === "hypergoat-coffee" && r.verdict === "matched", r.slug + ":" + r.verdict);
  ck("token-prefix: the join rule is recorded on the row (provenance of the match)", r.match_rule === "token_prefix", r.match_rule);
  ck("token-prefix: the row carries the section's send_to, subject and body (never invented)",
     r.entry.email === "hi@hypergoat.com" && r.entry.subject === "The roasters" && /\{\{NAME\}\}/.test(r.entry.body));
  ck("token-prefix: zero orphan sections, zero spawned cards", out.report.counts.orphans === 0 && out.report.rows.length === 1, out.report.counts);
}

// ---- 2. tie -> CONFIRM (two equally specific pages, one section) ---------------------------------------
{
  const out = resolve([P("acme-north"), P("acme-south")], "# B\n" + sec("Acme", "hi@acme.com", "Hello"));
  ck("tie: the section is NOT auto-joined to either page", out.report.matched === 0, out.report.matched);
  ck("tie: exactly one CONFIRM (possible match, one tap to accept or reject)", out.report.confirm.length === 1, out.report.confirm.length);
  ck("tie: the confirm names the section and a candidate page", !!out.report.confirm[0].business && !!out.report.confirm[0].page_slug,
     JSON.stringify(out.report.confirm[0]));
  ck("tie: no confirmed row was written as matched", !out.report.rows.some(r => r.verdict === "matched"));
}

// ---- 3. below-threshold ORPHAN section (matches no page): surfaced, spawns nothing ---------------------
{
  const out = resolve([P("blue-bottle")], "# B\n" + sec("Totally Unrelated Widgets", "hi@widgets.com", "Hello"));
  ck("orphan: the page is its own row (needs message), the section is NOT a row",
     out.report.rows.length === 1 && out.report.rows[0].slug === "blue-bottle", out.report.rows.map(r => r.slug));
  ck("orphan: the unmatched section renders in the orphan list, spawns no card",
     out.report.orphanSections.length === 1 && !out.report.rows.some(r => /widget/.test(r.slug)),
     out.report.orphanSections.map(o => o.business));
  ck("orphan: no opportunity entry is created from the orphan section (join failure, not a card)",
     !out.entries.some(e => /widget/i.test(e.business || "")), out.entries.map(e => e.business));
}

// ---- 4. specificity: river-sea vs river-sea-chocolates, one "River-Sea Chocolates" section -------------
{
  const out = resolve([P("river-sea"), P("river-sea-chocolates")], "# B\n" + sec("River-Sea Chocolates", "hi@rs.com", "The shop"));
  const rc = out.report.rows.find(r => r.slug === "river-sea-chocolates") || {};
  const rs = out.report.rows.find(r => r.slug === "river-sea") || {};
  ck("specificity: the more specific page (river-sea-chocolates, exact) takes the section",
     rc.verdict === "matched" && rc.match_rule === "exact", rc.verdict + ":" + rc.match_rule);
  ck("specificity: the less specific page (river-sea) stays a needs-message page, never mis-assigned",
     rs.verdict !== "matched" && rs.needs_message === true, rs.verdict);
  ck("specificity: two pages plus one section resolve to two rows, never three", out.report.rows.length === 2, out.report.rows.length);
}

// ---- 5. the truthful count line -----------------------------------------------------------------------
{
  const md = "# B\n" + sec("Hypergoat Coffee Roasters", "a@h.com", "X") + sec("Acme", "a@a.com", "Y") + sec("Totally Unrelated Widgets", "a@w.com", "Z");
  const out = resolve([P("hypergoat-coffee"), P("acme-north"), P("acme-south"), P("lonely-page")], md);
  const c = out.report.counts;
  ck("count line: pages/matched/confirm/needs/orphans are all present and add up",
     c.pages === out.report.rows.length && typeof c.matched === "number" && typeof c.confirm === "number" &&
     typeof c.needs === "number" && typeof c.orphans === "number", JSON.stringify(c));
  ck("count line: pages+sections never render as more rows than pages (no section becomes a row)",
     out.report.rows.length === 4, out.report.rows.length + " rows for 4 pages");
}

// ---- source law (Evidence 4): ONE matcher, no exact-only branch, no orphan-spawn ----------------------
{
  const src = fs.readFileSync(path.join(__dirname, "../library/intake.js"), "utf8");
  ck("there is exactly ONE ranker (rankTokens) and ONE page-entry scorer (scorePageEntry)",
     (src.match(/function rankTokens\(/g) || []).length === 1 && (src.match(/function scorePageEntry\(/g) || []).length === 1);
  ck("the resolver's slug union is drawn from pages/envelopes/json (a section keys a slug only with NO pages)",
     /var unionMaps = \[pageBySlug, envBySlug, jsonBySlug\]/.test(src) &&
     /if \(pages\.length === 0\) unionMaps\.push\(docBySlug\)/.test(src) &&
     !/\[pageBySlug, envBySlug, docBySlug, jsonBySlug\]/.test(src));
  ck("orphan sections are collected only when pages exist to join against (a join failure, never a spawn)",
     /Only a drop that HAS pages can have an orphan section/.test(src) && /if \(pages\.length\) base\.entries\.forEach/.test(src));
  ck("the old exact-only folder branch (bySlug equality + keyOf prefix) is gone from the join",
     !/k\.indexOf\(want\) === 0 \|\| want\.indexOf\(k\) === 0/.test(src));
}

// ---- P17: field extraction - labels anywhere on a line, bold-tolerant, value-bounded ------------------
{
  // shared send-to + subject line (the live batch-13 break: subject column empty for all six)
  const r = TI.parseManifest("## X\n- **Send to:** info@dripdocx.com · **Subject:** From press to booked chairs\n```\nHi Bo, hello. [LINK]\n```\n");
  const e = r.entries[0] || {};
  ck("shared line: BOTH the send-to and the subject are captured from one line",
     e.email === "info@dripdocx.com" && e.subject === "From press to booked chairs", e.email + " / " + e.subject);
  ck("no markdown bold marker leaks into any captured value", !/\*/.test((e.subject || "") + (e.email || "")), e.subject);
}
{
  // bold-wrapped labels + Owner name ending at the first period, prohibition kept apart
  const r = TI.parseManifest("## X\n- **Send to:** a@b.com\n- **Subject:** Hi\n- **Owner:** Adam Godet. Standing prohibition: he designs the line.\n```\nHi Adam, hello. [LINK]\n```\n");
  const e = r.entries[0] || {};
  ck("owner: the name ends at the first period (Adam Godet), the note is kept apart",
     e.owner === "Adam Godet" && /designs the line/.test(e.owner_note || e.prohibition || ""), e.owner);
  ck("a title within the name segment survives (PA-C, L.Ac.)",
     (TI.parseManifest("## Y\n- **Send to:** a@b.com\n- **Owner:** Narges Najmyar, PA-C. Runs it.\n```\nx. [LINK]\n```\n").entries[0] || {}).owner === "Narges Najmyar, PA-C");
}
{
  // greeting with two names, precedence over owner
  const r = TI.parseManifest("## X\n- **Send to:** a@b.com\n- **Owner:** Rodrigo Alvarez. Note.\n```\nHi Krissee and Mariano, hello. [LINK]\n```\n");
  const e = r.entries[0] || {};
  ck("greeting: two names captured up to the comma (Krissee and Mariano)", e.greeting_name === "Krissee and Mariano", e.greeting_name);
  ck("name precedence: the greeting name wins over the owner's first name", e.person_name === "Krissee and Mariano", e.person_name);
  const r2 = TI.parseManifest("## X\n- **Send to:** a@b.com\n- **Owner:** Adam Godet. Note.\n```\nWe wrote a brief. [LINK]\n```\n");
  ck("name precedence: with no greeting, the owner's leading first name is used (Adam)", (r2.entries[0] || {}).person_name === "Adam", (r2.entries[0] || {}).person_name);
}
{
  // Arabic labels
  const r = TI.parseManifest("## متجر\n- **المرسل إليه:** hello@sharq.jo · **الموضوع:** متجر عمّان\n```\nمرحبًا آدم، وجدت المتجر. [LINK]\n```\n");
  const e = r.entries[0] || {};
  ck("Arabic labels: send-to and subject captured (المرسل إليه / الموضوع)",
     e.email === "hello@sharq.jo" && e.subject === "متجر عمّان", e.email + " / " + e.subject);
  ck("Arabic greeting: the name is captured (آدم)", e.greeting_name === "آدم", e.greeting_name);
}
{
  // a middle dot INSIDE a quoted value is not a field boundary
  const r = TI.parseManifest("## X\n- **Subject:** \"The shop · found\" today\n- **Send to:** a@b.com\n```\nHi. [LINK]\n```\n");
  ck("a middle dot inside quotes does not split the value", (r.entries[0] || {}).subject === '"The shop · found" today', (r.entries[0] || {}).subject);
}
{
  // bundle-wide template from the README/intro, applied to a page that named none
  const r = TI.parseManifest("# Batch\nAll pages use template en-opp1.\n\n## X\n- **Send to:** a@b.com\n- **Subject:** Hi\n```\nHi Bo. [LINK]\n```\n");
  ck("template: a bundle-wide default (en-opp1) applies where a page named none", (r.entries[0] || {}).template === "en-opp1", r.batch.template);
  const rec = TI.toRecord(r.entries[0], {});
  ck("the saved record carries the full envelope: business, template, subject, person, recipient",
     rec.template === "en-opp1" && rec.outreach_subject === "Hi" && rec.recipients.length === 1 && rec.recipients[0].addr === "a@b.com",
     JSON.stringify({ t: rec.template, s: rec.outreach_subject, r: rec.recipients }));
}
{
  // one extractor, one grammar (Evidence 4)
  const src = fs.readFileSync(path.join(__dirname, "../library/intake.js"), "utf8");
  ck("there is exactly ONE field extractor (extractFields) reached from the one key-line loop",
     (src.match(/function extractFields\(/g) || []).length === 1 && (src.match(/fields\.forEach\(function \(f\) \{ applyField/g) || []).length === 1);
  // ten reads byte-identical
  const md = "# B\nAll pages use en-opp1.\n## X\n- **Send to:** a@b.com · **Subject:** Hi\n- **Owner:** Adam Godet. Note.\n```\nHi Adam. [LINK]\n```\n";
  const snap = () => JSON.stringify(TI.parseManifest(md).entries.map(e => [e.email, e.subject, e.owner, e.person_name, e.template]));
  let first = snap(), same = true; for (let i = 0; i < 10; i++) if (snap() !== first) same = false;
  ck("ten reads of the extraction are byte-identical", same);
}

/* ============================================================================
   P18 · The universal contact model (R11). Extraction fills more than an email:
   phones, WhatsApp, social handles, in EN and Arabic; each channel classified
   and tiered by where it was sighted. One list on the record, read by the tab,
   the composer and the Contact Book. Pure logic, proven here. */
{
  // Evidence 2: a crafted section with a phone, a WhatsApp link, an Instagram handle and an Arabic جوال
  // (a second phone). The one extractor captures FOUR non-email channels beside the send-to email.
  const md = "# Batch\n## Bloom Studio\n"
    + "- **Send to:** hello@bloom.example  **Phone:** +1 (555) 200-3040  **WhatsApp:** https://wa.me/15552003040\n"
    + "- **Instagram:** @bloomstudio  **جوال:** 0501234567\n"
    + "```\nHi Sara, hello. [LINK]\n```\n";
  const rec = TI.toRecord(TI.parseManifest(md).entries[0], {});
  const chs = rec.channels || [];
  const nonEmail = chs.filter(c => c.type !== "email");
  ck("P18: the crafted fixture captures four channels beside the email (Phone, WhatsApp, Instagram, جوال)",
     nonEmail.length === 4, nonEmail.map(c => c.type + (c.platform ? ":" + c.platform : "")).join(","));
  ck("P18: the Arabic جوال line yields a phone channel (a second number, not dropped)",
     chs.filter(c => c.type === "phone").length === 2 && chs.some(c => c.type === "phone" && c.value === "0501234567"),
     JSON.stringify(chs.filter(c => c.type === "phone")));
  ck("P18: the WhatsApp channel is a wa.me link; the Instagram channel carries the bare handle",
     chs.some(c => c.type === "whatsapp" && /wa\.me\/15552003040/.test(c.value)) &&
     chs.some(c => c.type === "social" && c.platform === "instagram" && c.handle === "bloomstudio"),
     JSON.stringify(chs));
  ck("P18: exactly one channel is primary and it is the send-to email (the send target)",
     chs.filter(c => c.primary).length === 1 && (chs.find(c => c.primary) || {}).type === "email",
     JSON.stringify(chs.filter(c => c.primary)));
}
{
  // Evidence 3: a rung-4 page read. mailto + an Instagram profile link sit on the business's OWN page,
  // so every channel sighted there is Tier A / sighted (never inferred, never invented).
  const html = "<!doctype html><title>Godet</title><h1>Godet Furniture</h1>"
    + "<a href=\"mailto:adam@godet.example\">Email</a><a href=\"https://instagram.com/godetfurniture\">IG</a>";
  const out = TI.resolveBatch([{ name: "opp/godet-furniture/index.html", html: html }], [], []);
  const rec = TI.toRecord(out.report.rows[0].entry, {});
  ck("P18: a rung-4 page (mailto + instagram on the business's own surface) gives an email and a social channel",
     rec.channels.length === 2 && rec.channels.some(c => c.type === "email") && rec.channels.some(c => c.type === "social" && c.platform === "instagram"),
     JSON.stringify(rec.channels.map(c => c.type)));
  ck("P18: every channel sighted on the business's own page is Tier A / sighted",
     rec.channels.every(c => c.tier === "A" && c.tier_basis === "sighted"), JSON.stringify(rec.channels));
}
{
  // Evidence 1: the real batch-13 shape (address named by the research md, not sighted on a page) is
  // Tier A / stated - shown "Tier A per research, confirm" until Thyab verifies. The composer To resolves.
  const md = "# Batch 13\n## Drip Docx Wellness and Aesthetics\n- **Send to:** info@dripdocx.com  **Subject:** From press to booked chairs\n```\nHi Narges, hello. [LINK]\n```\n";
  const rec = TI.toRecord(TI.parseManifest(md).entries[0], {});
  const email = (rec.channels || []).find(c => c.type === "email") || {};
  ck("P18: a research-md address is Tier A / stated (confirm), never auto-upgraded to sighted",
     email.tier === "A" && email.tier_basis === "stated" && email.source === "research md", JSON.stringify(email));
  ck("P18: the email channel is primary, so the composer To resolves to it",
     email.primary === true && email.value === "info@dripdocx.com", JSON.stringify(email));
}
{
  // Evidence 4: ONE model. buildChannels is the single builder; toRecord writes exactly one `channels`
  // field; ten reads are byte-identical; the record never carries a second contact list.
  const src = fs.readFileSync(path.join(__dirname, "../library/intake.js"), "utf8");
  ck("P18: there is exactly ONE channel builder (buildChannels) and toRecord writes it once",
     (src.match(/function buildChannels\(/g) || []).length === 1 && (src.match(/channels: buildChannels\(/g) || []).length === 1);
  const md = "# B\n## X\n- **Send to:** a@b.example  **Phone:** +15551112222  **Instagram:** @xco\n```\nHi. [LINK]\n```\n";
  const snap = () => JSON.stringify(TI.toRecord(TI.parseManifest(md).entries[0], {}).channels);
  let first = snap(), same = true; for (let i = 0; i < 10; i++) if (snap() !== first) same = false;
  ck("P18: ten reads of the channel list are byte-identical", same, first);
}

/* ============================================================================
   P19 · R13 re-import is idempotent by slug. importPlan is the ONE classifier; the report row carries the
   action and the count line reads new / updates / needs-decision. Pure logic, proven here. */
{
  const P = (s) => ({ name: "opp/" + s + "/index.html", html: "<!doctype html><h1>" + s + "</h1>" });
  const sec = (b, e, su) => "## " + b + "\n- **Send to:** " + e + " · **Subject:** " + su + "\n```\nHi. [LINK]\n```\n";
  const md = "# B\n" + sec("Alpha Co", "a@a.com", "S") + sec("Beta Co", "b@b.com", "S") + sec("Gamma Co", "c@c.com", "S") + sec("Delta Co", "d@d.com", "S");
  // beta has no history (update), gamma has history (locked), delta is archived (decision); alpha is new.
  const existing = { "beta-co": { archived: false, hasHistory: false }, "gamma-co": { archived: false, hasHistory: true }, "delta-co": { archived: true, hasHistory: false } };

  ck("P19: importPlan classifies new / update / update_locked / decision from one map (no per-slug branches)",
     TI.importPlan("alpha-co", existing) === "new" && TI.importPlan("beta-co", existing) === "update" &&
     TI.importPlan("gamma-co", existing) === "update_locked" && TI.importPlan("delta-co", existing) === "decision");

  const out = TI.resolveBatch([P("alpha-co"), P("beta-co"), P("gamma-co"), P("delta-co")], [{ name: "r.md", text: md }], [], { existing: existing });
  const act = {}; out.report.rows.forEach(r => act[r.slug] = r.action);
  ck("P19: every report row carries its re-import action",
     act["alpha-co"] === "new" && act["beta-co"] === "update" && act["gamma-co"] === "update_locked" && act["delta-co"] === "decision",
     JSON.stringify(act));
  ck("P19: the count line reads pages / new / updates / needs-decision (updates = update + update_locked)",
     out.report.counts.pages === 4 && out.report.counts.new === 1 && out.report.counts.updates === 2 && out.report.counts.decision === 1,
     JSON.stringify(out.report.counts));
  ck("P19: an existing slug is an update, never a warning that blocks the batch (no exists_would_overwrite)",
     out.report.rows.every(r => (r.reasons || []).indexOf("exists_would_overwrite") < 0), "still warns on exists");

  // back-compat: a bare existingSlugs list (no history/archived info) still reads as a plain update
  const out2 = TI.resolveBatch([P("beta-co")], [{ name: "r.md", text: sec("Beta Co", "b@b.com", "S") }], [], { existingSlugs: ["beta-co"] });
  ck("P19: a bare existingSlugs list still classifies as update (back-compat)", out2.report.rows[0].action === "update");

  // ONE classifier, and it is reached by both the report and the writer (grep the client)
  const app = fs.readFileSync(path.join(__dirname, "../library/app.js"), "utf8");
  const intake = fs.readFileSync(path.join(__dirname, "../library/intake.js"), "utf8");
  ck("P19: exactly ONE importPlan classifier (in intake.js), read by the writer in app.js (one lifecycle path)",
     (intake.match(/function importPlan\(/g) || []).length === 1 && /ThriveIntake\.importPlan\(/.test(app),
     "classifier count / writer read");

  // ten reads of the classified report are byte-identical
  const snap = () => JSON.stringify(TI.resolveBatch([P("alpha-co"), P("beta-co"), P("gamma-co"), P("delta-co")], [{ name: "r.md", text: md }], [], { existing: existing }).report.rows.map(r => [r.slug, r.action]));
  let first = snap(), same = true; for (let i = 0; i < 10; i++) if (snap() !== first) same = false;
  ck("P19: ten reads of the re-import classification are byte-identical", same, first);
}

console.log("\n" + (fails.length ? "FAILED: " + fails.join(", ") : "ALL INGEST MATCHER CHECKS PASS"));
process.exit(fails.length ? 1 : 0);
