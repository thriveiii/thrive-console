// ===================================================================================================
// E2 CAMPAIGN UPLOAD - upload a zip from the device (html pages + message texts + emails), match each page
// to its message + recipient + slug, review a match table, and on APPROVAL open draft opp cards while storing
// each page to console_pages. A ported subset of the old engine's proven ingest (library/intake.js), inlined
// into library/board.html by tools/bundle.js AFTER the send + editor + new-message clones, so it reuses their
// IIFE scope: esc, t, liveUrl, oppReadData, oppPatch, authFetchOnce, URL_BASE, ANON, bearer, session, refresh,
// reloadBoardData, findRow, refreshOppDetail, __writing, root; and oppUpsert (board-newmsg.src.js).
//
// GROUNDED IN E2_EVIDENCE.md, porting the cited old-engine logic (never rewritten):
//   * zip read: intake.js:1052-1128 (readZip / readFiles, native DecompressionStream).
//   * slug per html: intake.js:409/434 (slugify / pageSlug, folder-aware).
//   * one token matcher: intake.js:454-468 (normTokens / rankTokens).
//   * the mailto ConTh-3 fix: the old readSendTo set e.url = "mailto:"+em (intake.js:95); here the recipient
//     is the BARE address, mailto stripped, never "mailto:foo@bar" (matches toRecord's bare `to`, intake.js:610/626).
//   * nothing before approval: the report reads only (intake.js:1207); the write is the approve step
//     (commitDraftsBatch, app.js:4649). Here upBuildPlan previews, upCommit writes - two separate steps.
//   * no send until proven live: the real-fetch gate (pageIsGone/pageSendable, app.js:816/835). Here
//     verifyLive does a real GET of liveUrl(slug); upSendLiveGate blocks runSend for an upload opp that is
//     not activated or whose live URL does not resolve. A preview looking good is never the proof.
// ===================================================================================================

var __upPlan = null;       // the previewed plan, held until the operator approves (nothing written before then)
var __upBusy = false;      // in-flight guard for the read/commit
var __libExisting = {};    // PR-L1: the set of console_pages slugs already taken (for upload uniqueness check)
var __libPages = null;     // PR-L1: the last console_pages rows fetched for the Library surface (+ tests)
var __libQuery = "";       // PR-L1: the live Library search query
var __libPromoting = false;// PR-L6: in-flight guard for promote-to-Operations (one at a time)
var __libState = {};       // PR-CF: per-slug liveness state after re-verify ("live"|"confirming"|"fault") - survives search re-renders
var __libTab = "templates";// PR-AF: the Library view tab ("templates" | "archive")
var __libArch = [];        // PR-AF: the last console_opps?archived=eq.true rows fetched for the Archive tab
// PR-L0: a page_publish commits to GitHub (GET sha + PUT, relay:pagePublish_ two round-trips) which routinely
// takes longer than the 6s sign-in fetch timeout. This op gets its own longer client bound so a slow-but-
// successful commit is not aborted by the client and falsely reported "could not publish".
var PAGE_PUBLISH_TIMEOUT_MS = 30000;

// ---- ported zip reader (intake.js:1052-1128), native DecompressionStream, no library --------------
function upU16(v, p){ return v[p] | (v[p+1] << 8); }
function upU32(v, p){ return (v[p] | (v[p+1] << 8) | (v[p+2] << 16) | (v[p+3] << 24)) >>> 0; }
function upInflateRaw(bytes){                                                       // intake.js:1055
  if(typeof DecompressionStream !== "function") return Promise.reject(new Error("no_inflate"));
  var ds = new DecompressionStream("deflate-raw");
  var stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer().then(function(ab){ return new Uint8Array(ab); });
}
function upFindEOCD(v){                                                             // intake.js:1064
  for(var i = v.length - 22; i >= 0 && i > v.length - 66000; i--){ if(upU32(v, i) === 0x06054b50) return i; }
  return -1;
}
function upReadZip(arrayBuffer){                                                    // intake.js:1071
  var v = new Uint8Array(arrayBuffer);
  var eocd = upFindEOCD(v);
  if(eocd < 0) return Promise.reject(new Error("not_a_zip"));
  var count = upU16(v, eocd + 10), p = upU32(v, eocd + 16);
  var out = [], dec = new TextDecoder("utf-8");
  function step(i){
    if(i >= count || p + 46 > v.length) return Promise.resolve(out);
    if(upU32(v, p) !== 0x02014b50) return Promise.resolve(out);
    var method = upU16(v, p + 10), csize = upU32(v, p + 20);
    var nameLen = upU16(v, p + 28), extraLen = upU16(v, p + 30), commentLen = upU16(v, p + 32);
    var local = upU32(v, p + 42);
    var name = dec.decode(v.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    var skip = (/\/$/.test(name)) || (name.replace(/^.*\//, "").charAt(0) === ".") ||
               (!/\.(html?|md|txt|json)$/i.test(name)) || (upU32(v, local) !== 0x04034b50);
    if(skip) return step(i + 1);
    var dataAt = local + 30 + upU16(v, local + 26) + upU16(v, local + 28);
    var raw = v.subarray(dataAt, dataAt + csize);
    var bytesP = (method === 0) ? Promise.resolve(raw) : (method === 8) ? upInflateRaw(raw) : null;
    if(!bytesP) return step(i + 1);
    return bytesP.then(function(bytes){ out.push({ name:name, text:dec.decode(bytes) }); return step(i + 1); });
  }
  return step(0);
}
// One entry point (intake.js:1107): unpack any zip, classify html -> pages, md/txt/json -> texts.
function upReadFiles(files){
  var pages = [], texts = [], skipped = [];
  var list = Array.prototype.slice.call(files || []);
  function one(i){
    if(i >= list.length) return Promise.resolve({ pages:pages, texts:texts, skipped:skipped });
    var f = list[i], name = f.name || "";
    if(/\.zip$/i.test(name)){
      return f.arrayBuffer().then(upReadZip).then(function(inner){
        inner.forEach(function(z){
          if(/\.html?$/i.test(z.name)) pages.push({ name:z.name, html:z.text });
          else if(/\.(md|txt|json)$/i.test(z.name)) texts.push({ name:z.name, text:z.text });
          else skipped.push(z.name);
        });
        return one(i + 1);
      });
    }
    if(/\.html?$/i.test(name)) return f.text().then(function(h){ pages.push({ name:name, html:h }); return one(i + 1); });
    if(/\.(md|txt|json)$/i.test(name)) return f.text().then(function(x){ texts.push({ name:name, text:x }); return one(i + 1); });
    skipped.push(name); return one(i + 1);
  }
  return one(0);
}

// ---- ported slug + matcher (intake.js:409/434/454/468) --------------------------------------------
function upSlugify(s){                                                              // intake.js:409
  return String(s || "").toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function upBaseName(name){ return String(name || "").replace(/^.*\//, ""); }
// The directory prefix of a zip entry name (everything before the last "/"), "" for a top-level file. Used to
// pair a page and its message by their SHARED FOLDER (a per-slug subfolder zip), independent of the message's
// heading or filename.
function upDir(name){ var s = String(name || ""); var i = s.lastIndexOf("/"); return i < 0 ? "" : s.slice(0, i); }
function upPageSlug(name){                                                          // intake.js:434
  var parts = String(name || "").split("/").filter(Boolean);
  var file = parts.length ? parts[parts.length - 1] : "";
  var base = file.replace(/\.html?$/i, "");
  if(parts.length >= 2 && /^(index|page|opp|opportunity|default|home)$/i.test(base)) return upSlugify(parts[parts.length - 2]);
  return upSlugify(base);
}
function upFirstHeading(text){ var m = String(text || "").match(/^[ \t]*#{1,6}[ \t]*(.+?)[ \t]*$/m); return m ? m[1].trim() : ""; }
function upNormTokens(s){ return upSlugify(s).split("-").filter(Boolean); }         // intake.js:454
function upRankTokens(a, b){                                                        // intake.js:455
  if(!a.length || !b.length) return { score:0, matched:0 };
  if(a.join("-") === b.join("-")) return { score:3, matched:a.length };
  var sh = a.length <= b.length ? a : b, lo = a.length <= b.length ? b : a;
  if(sh.every(function(t, i){ return lo[i] === t; })) return { score:2, matched:sh.length };
  var setA = {}, setB = {}; a.forEach(function(t){ setA[t] = 1; }); b.forEach(function(t){ setB[t] = 1; });
  var subset = a.every(function(t){ return setB[t]; }) || b.every(function(t){ return setA[t]; });
  if(subset) return { score:2, matched:Math.min(a.length, b.length) };
  var inter = 0; Object.keys(setA).forEach(function(t){ if(setB[t]) inter++; });
  var uni = Object.keys(setA).length + Object.keys(setB).length - inter;
  var j = uni ? inter / uni : 0;
  if(j >= 0.6) return { score:1, matched:inter };
  return { score:0, matched:0 };
}

// The recipient email, ALWAYS bare. The old readSendTo also set e.url = "mailto:"+em (intake.js:95); here the
// address a person reads and the console sends is the bare form, mailto stripped - the ConTh-3 mailto fix.
var UP_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
function upEmailFrom(text){
  var s = String(text || "");
  var m = s.match(/mailto:\s*([^\s"'<>]+)/i);              // a mailto: link, if present
  var raw = m ? m[1] : ((s.match(UP_EMAIL_RE) || [])[0] || "");
  return String(raw).replace(/^\s*mailto:/i, "").trim().toLowerCase();   // strip the scheme, always
}
// Subject + body + email from one message text. Subject is a "Subject:" line, else the first heading; the
// body is the remainder with that subject line and any fenced ```json block removed. Nothing invented.
function upExtract(text){
  var s = String(text || "").replace(/\r\n/g, "\n");
  var subj = "";
  var sm = s.match(/^[ \t]*subject[ \t]*:[ \t]*(.+)$/im);
  if(sm){ subj = sm[1].trim(); s = s.replace(sm[0], ""); }
  else { subj = upFirstHeading(s); }
  var body = s.replace(/```json[\s\S]*?```/gi, "").replace(/^[ \t]*#{1,6}[ \t]*.+$/m, function(h){ return (h.trim() === "# " + subj || upFirstHeading(h) === subj) ? "" : h; });
  body = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return { subject:subj, body:body, email:upEmailFrom(text) };
}
function upPretty(slug){ return String(slug || "").split("-").filter(Boolean).map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ") || slug; }

// ---- consolidated messages file: MANY messages in ONE file -----------------------------------------
// The device-proven BATCH13 zip carries every message + email + subject in ONE file (e.g.
// BATCH13_research_and_messages.md), not one text file per page. Each per-opportunity SECTION is a heading
// ("## 2) Hypergoat Coffee Roasters - Alexandria (Del Ray), VA"), a metadata line
// ("- **Send to:** contact@hyper-goat.com · **Subject:** The Del Ray opening, louder"), and the email
// body inside a fenced code block ("```" ... "Hi ...," ... signature ... "```"). upParseSections reads that
// structure; upBuildPlan below supports BOTH it AND the original one-file-per-page mode, auto-detecting which
// a zip uses. Robust matching: a section maps to a page slug by normalized-name similarity (the same token
// ranker), so "Hypergoat Coffee Roasters" resolves to the page slug "hypergoat-coffee".
function upSectionName(heading){
  var h = String(heading || "").replace(/^[ \t]*#{1,6}[ \t]*/, "");   // drop the leading hashes
  h = h.replace(/^\s*\d+[\).:]\s*/, "");                              // drop a leading "n)" / "n." number
  // the business name is the head of the line, before a location dash / middot / pipe / parenthesis / comma.
  // The dash class uses \u2014 (long dash) and \u2013 (mid dash) escapes so no literal long dash sits in source.
  var cut = h.split(/\s+[\u2014\u2013-]\s+|\s+\u00b7\s+|\s+\|\s+|\s*\(|,/)[0];
  return cut.replace(/[*_`]+/g, "").trim();
}
function upFenceBody(chunk){
  // the first fenced code block; drop an optional language token on the opening fence line; verbatim otherwise.
  // The [LINK] token inside the body is preserved untouched so it survives into the opp's outreach text.
  var m = String(chunk || "").match(/```[^\n]*\n([\s\S]*?)```/);
  if(!m) return "";
  return m[1].replace(/\s+$/, "");
}
function upParseSections(text){
  var s = String(text || "").replace(/\r\n/g, "\n");
  var lines = s.split("\n"), heads = [];
  lines.forEach(function(ln, i){
    var m = ln.match(/^[ \t]*(#{1,6})[ \t]+(.+?)[ \t]*$/);
    if(m) heads.push({ i:i, level:m[1].length, text:ln, numbered: /^[ \t]*#{1,6}[ \t]*\d+[\).:]/.test(ln) });
  });
  if(!heads.length) return [];
  // numbered opportunity headers ("## 2) Name") are the strongest boundary; else the shallowest heading level.
  var numbered = heads.filter(function(h){ return h.numbered; });
  var bounds = numbered.length ? numbered : heads.filter(function(h){ return h.level === heads[0].level; });
  if(!bounds.length) return [];
  var out = [];
  bounds.forEach(function(h, k){
    var end = (k + 1 < bounds.length) ? bounds[k + 1].i : lines.length;
    var chunk = lines.slice(h.i, end).join("\n");
    var fenceAt = chunk.indexOf("```");
    var meta = fenceAt >= 0 ? chunk.slice(0, fenceAt) : chunk;      // metadata lives before the fenced body
    var sendM = meta.match(/send[ \t]*to[^\n]*/i);
    var email = sendM ? upEmailFrom(sendM[0]) : "";
    var subjM = meta.match(/subject[ \t]*:?[ \t*]*([^\n]+)/i);
    var subject = subjM ? subjM[1].replace(/[*`]+/g, "").replace(/\s*·.*$/, "").trim() : "";
    var body = upFenceBody(chunk);
    var isMessage = !!(email || (body && sendM));
    out.push({ name:upSectionName(h.text), email:email, subject:subject, body:body, isMessage:isMessage });
  });
  return out;
}

// ---- upBuildPlan: the preview (read-only, nothing written) ---------------------------------------
// AXIOM #3 - the upload extracts html, IGNORES the rest, never rejects a valid file. Only an html page becomes
// a row. For each html page derive its slug. Build ONE pool of message UNITS from every text file, supporting
// BOTH structures: a consolidated file yields one unit per per-opportunity section; a plain per-page file (with
// a recipient email) is a single whole-file unit (the original mode). A text that carries no message (a README,
// a facts sheet, a base64 asset, a manifest) is NOT a page and NOT a message: it is silently IGNORED, never
// surfaced as a row or a note. Match each page to its best unit by the token ranker, extract subject / body /
// bare email. The only page-level warnings kept: dup_slug (two pages one slug) and no_message (a page that
// resolved no message - the operator completes it on the card). This only reads; it writes nothing.
function upBuildPlan(files){
  // B2: try to load the do-not-contact set before the plan is built, so a suppressed recipient is flagged in
  // the review (warning + count) and stripped at commit. Best-effort on the LOAD only (.catch): a failed load
  // must not break the whole upload review - the SEND path is the fail-closed backstop (runSend halts if the
  // set never loaded), so a slip here is still caught before anything is sent. ensureSuppress/isSuppressed live
  // in board-send.src.js.
  return ensureSuppress().catch(function(){}).then(function(){ return upReadFiles(files); }).then(function(kinds){
    var pages = kinds.pages, texts = kinds.texts, seen = {}, rows = [];
    pages.forEach(function(pg){
      var slug = upPageSlug(pg.name);
      var dup = !!seen[slug]; seen[slug] = (seen[slug] || 0) + 1;
      rows.push({ slug:slug, page:pg, title:"", subject:"", body:"", email:"", text_name:"", warnings: dup ? ["dup_slug"] : [] });
    });
    var units = [];
    texts.forEach(function(tx){
      var msgs = upParseSections(tx.text).filter(function(sec){ return sec.isMessage; });
      if(msgs.length){                                              // a consolidated file: one unit per section
        msgs.forEach(function(sec){
          units.push({ file:tx.name, name:sec.name || upBaseName(tx.name), slug:upSlugify(sec.name),
            subject:sec.subject, body:sec.body, email:sec.email, whole:false });
        });
        return;
      }
      var ex = upExtract(tx.text);                                  // else the original whole-file mode
      if(ex.email){                                                 // a real message carries a recipient email
        var nm = upFirstHeading(tx.text) || upBaseName(tx.name).replace(/\.(md|txt|json)$/i, "");
        units.push({ file:tx.name, name:nm, slug:upSlugify(nm), subject:ex.subject, body:ex.body, email:ex.email, whole:true });
      }
      // AXIOM #3 "ignores the rest": a text with no message (README / facts sheet / base64 asset / manifest) is
      // neither a page nor a message. It is silently ignored - no informational row, no note.
    });
    var usedUnit = {}, pairedRow = {};
    // FOLDER-FIRST pairing: a page and the single message-bearing text that live in the SAME subfolder are the
    // same campaign item (the per-slug zip: bards-alley/index.html + bards-alley/<name>.md), so pair them
    // DIRECTLY - by their shared folder - before any name-similarity guess. The message's heading or filename may
    // differ from the folder name; the folder is the unambiguous link the token ranker cannot see. This only
    // fires for a page in a REAL subfolder that has EXACTLY ONE unused unit sharing that folder, so the
    // consolidated one-file-many-messages zip (its messages live in one top-level file, not per folder) never
    // folder-pairs and is still resolved by the token ranker below.
    rows.forEach(function(r, ri){
      var pdir = upDir(r.page && r.page.name);
      if(!pdir) return;                                         // only a real subfolder pairs by folder
      var found = -1, n = 0;
      units.forEach(function(u, ui){ if(usedUnit[ui]) return; if(upDir(u.file) === pdir){ n++; found = ui; } });
      if(n !== 1) return;                                       // 0 or ambiguous (>1) in this folder: leave to the ranker
      var u = units[found]; usedUnit[found] = 1; pairedRow[ri] = 1;
      r.subject = u.subject; r.body = u.body; r.email = u.email; r.text_name = u.file;
      r.title = u.subject || upPretty(r.slug);
      if(r.email && isSuppressed(r.email) && r.warnings.indexOf("suppressed") < 0) r.warnings.push("suppressed");
    });
    rows.forEach(function(r, ri){
      if(pairedRow[ri]) return;                                 // already attached by the shared-folder pass
      var best = null, bestScore = 0, bi = -1;
      units.forEach(function(u, ui){
        if(usedUnit[ui]) return;
        var rk = upRankTokens(upNormTokens(r.slug), upNormTokens(u.slug || u.name));
        if(rk.score > bestScore){ bestScore = rk.score; best = u; bi = ui; }
      });
      if(best && bestScore >= 2){
        usedUnit[bi] = 1;
        r.subject = best.subject; r.body = best.body; r.email = best.email; r.text_name = best.file;
        r.title = best.subject || upPretty(r.slug);
        // B2: a suppressed recipient is flagged here so the review shows a visible warning + count; it is stripped
        // from the stored recipients at upCommit. The page/message still upload; only the address is dropped.
        if(r.email && isSuppressed(r.email) && r.warnings.indexOf("suppressed") < 0) r.warnings.push("suppressed");
      } else {
        r.title = upPretty(r.slug);
        if(r.warnings.indexOf("no_message") < 0) r.warnings.push("no_message");
      }
    });
    // AXIOM #3 "ignores the rest": a message unit that matched no page is NOT surfaced as an orphan note - it is
    // silently ignored, exactly like a non-message file. Only html pages become rows. (was: orphanTexts)
    return { rows:rows };
  });
}

// ---- console_pages write (the uploaded-template store E3's Insert-link dropdown will read) ---------
// The console_pages schema is (slug, html, up, updated_at, live_verified_at). There is no title or active
// column, so the title lives on console_opps.business; liveness lives on console_pages.live_verified_at (PR1,
// stamped by pageStampLive only after a real verify-live ok), NOT on any flag in the opp's data. The dropdown
// reads console_pages joined to console_opps for the label. Bounded upsert, same discipline as oppUpsert
// (merge-duplicates, one refresh-retry). This insert leaves live_verified_at null - a stored page is a DRAFT
// until it is committed and verified live.
// PR-L1: an optional `meta` ({title, task}) is written alongside the html so a page-only Library template
// carries its own human title + task classification (console_pages gained title/task/tags columns, applied in
// Supabase). Campaign callers pass no meta, so those columns stay null (their title lives on console_opps).
// Only defined keys are sent, so an unknown column never breaks the upsert.
function pageUpsert(slug, html, meta, retried){
  var url = URL_BASE + "/rest/v1/console_pages";
  var row = { slug:slug, html:String(html == null ? "" : html), up:Date.now() };
  if(meta && typeof meta === "object"){
    if(meta.title != null) row.title = String(meta.title);
    if(meta.task  != null) row.task  = String(meta.task);
  }
  return authFetchOnce(url, {
    method:"POST",
    headers:{ "apikey":ANON, "Authorization":"Bearer " + bearer(), "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates,return=minimal" },
    cache:"no-store", body: JSON.stringify([row])
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return pageUpsert(slug, html, meta, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error((r.data && r.data.message) || ("HTTP " + r.res.status)); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    return true;
  });
}

// ---- pageStampLive: the SINGLE write that makes a page "live" (PR1) -------------------------------
// Called ONLY after verifyLive did a real GET /opp/<slug> and returned ok. It stamps
// console_pages.live_verified_at = now() by slug. The console_board view and the drawer derive
// "activated / live" SOLELY from this column; console_opps.published and bare row-existence are no longer the
// live signal. The relay commits the static file; the board writes this truth after it CONFIRMS the file
// actually serves - never optimistically. One refresh-retry, same discipline as pageUpsert; a failure is
// surfaced (settle-always: the caller shows red and does not claim live).
function pageStampLive(slug, retried){
  var url = URL_BASE + "/rest/v1/console_pages?slug=eq." + encodeURIComponent(slug);
  var patch = { live_verified_at: new Date().toISOString(), up: Date.now() };
  return authFetchOnce(url, {
    method:"PATCH",
    headers:{ "apikey":ANON, "Authorization":"Bearer " + bearer(), "Content-Type":"application/json", "Prefer":"return=minimal" },
    cache:"no-store", body: JSON.stringify(patch)
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return pageStampLive(slug, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error((r.data && r.data.message) || ("HTTP " + r.res.status)); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    return true;
  });
}

// ---- upCommit: the approve step (writes) ---------------------------------------------------------
// Only on approval, and only then. Each page row becomes a DRAFT opp (console_opps: published nowhere, sent
// to nobody, source "upload") AND its html a console_pages row (live_verified_at null, so a draft page).
// Deduped by slug (first wins). Bounded confirm-or-revert per row; a per-row failure is counted, never a
// phantom success.
// ACTIVATE ON UPLOAD: a page-bearing row is written AND published in the one action - oppUpsert, pageUpsert,
// then pagePublishRelay (the same relay commit the Library path does), so the operator never faces a second
// "activate" click. The live-verify + live_verified_at stamp runs in the background right after (upApprove ->
// upActivateBackground), so the card is born live/confirming, never a draft with a lingering prompt. A
// text-only row (no page html) skips the publish untouched. published[] carries the slugs to verify + stamp.
// A short, unique transit id for a fresh upload cycle (time + randomness; guarded so a hostile runtime still
// yields a usable string). Written to console_opps.cycle; the send stamps console_mail.cycle with it.
function upNewCycle(){ try{ return "cy" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }catch(e){ return "cy" + Date.now(); } }
function upCommit(plan){
  var rows = (plan && plan.rows) || [], done = {}, ok = 0, fail = 0, failed = [], published = [];
  function one(i){
    if(i >= rows.length) return Promise.resolve({ ok:ok, fail:fail, failed:failed, published:published });
    var r = rows[i];
    if(done[r.slug]) return one(i + 1);
    done[r.slug] = 1;
    var data = { source:"upload", page_title:r.title,
      outreach_subject:r.subject || "", outreach_text:r.body || "",
      // B2: strip a suppressed recipient - the opp/page still commit, but the do-not-contact address is not stored.
      recipients: (r.email && !isSuppressed(r.email)) ? [{ addr:r.email, name:"", lang:"en" }] : [] };
    // Resolve {{ASSET_BASE}} on the page html ONCE, up front, so BOTH the stored console_pages row (Library
    // preview) and the committed static file (the hosted page) carry real asset URLs. assetBaseInto lives in
    // board-send.src.js and resolves ONLY that token, the same value the message compile uses.
    var html = assetBaseInto((r.page && r.page.html) || "");
    // TRANSIT CYCLE: every (re-)upload starts a CLEAN transit - a fresh short cycle id on the opp. The view
    // scopes sends/opens to this cycle, so an old transit's ledger rows never re-attach to the new card. The
    // SAME cycle is stamped into the published page (withBeaconClient below), so the beacon carries it on opens.
    var cycle = upNewCycle();
    return oppUpsert(r.slug, { business:r.title || r.slug, data:data, up:Date.now(), cycle:cycle })
      .then(function(){ return pageUpsert(r.slug, html); })
      .then(function(){
        if(!String(html).trim()){ ok++; return one(i + 1); }                     // text-only row: no page to publish, untouched
        return pagePublishRelay(r.slug, withBeaconClient(html, cycle)).then(   // commit the static file NOW, carrying THIS transit's cycle
          function(){ ok++; published.push(r.slug); return one(i + 1); },
          function(e){
            if(e && e.kind === "timeout"){ ok++; published.push(r.slug); return one(i + 1); }   // idempotent commit likely landed -> confirm in background
            fail++; failed.push(r.title || r.slug); return one(i + 1);          // a real relay error: named, never a phantom success
          });
      }, function(){ fail++; failed.push(r.title || r.slug); return one(i + 1); });   // opp/page write failure: name the file
  }
  return one(0);
}
// The per-page NON-LIVE outcome from the last verify, keyed by (page) slug: "dead" or "unconfirmed". Absent when
// the page is live or has not been checked yet. The drawer reads this so a page is NEVER a silent permanent
// "publishing" - it shows live, a named dead, or "still checking". __upVerifying guards a re-check in flight so
// a re-open does not stack polls. Both are in-memory (lost on reload); the drawer re-verifies on open to rebuild
// them, and live_verified_at (persisted by pageStampLive) is the durable truth.
var __upLive = {}, __upVerifying = {};
// Background live-verify for the pages just published on upload: poll the live URL (patient, backing off), and
// ONLY on a real ok stamp live_verified_at (the single liveness write). A non-ok result records a NAMED outcome
// (dead vs unconfirmed) instead of leaving a silent "publishing", reflects it in an open drawer, and reloads the
// board so the cards read the truth. Non-blocking: upApprove does not wait on it.
function upActivateBackground(slugs){
  var pend = (slugs || []).slice(); if(!pend.length) return;
  var left = pend.length;
  pend.forEach(function(slug){
    verifyLivePoll(slug).then(function(v){
      if(v && v.ok){ delete __upLive[slug]; return pageStampLive(slug).catch(function(){}); }
      // F1: a not-yet-resolving URL is an async deploy that has not landed, NOT a failure. Leave the page in
      // the neutral transitional state (do not record "dead"/"unconfirmed"); re-verify on the next drawer open
      // flips it to Live when the deploy arrives. No RED for a committed page.
    }).catch(function(){}).then(function(){
      left--; if(left === 0){ reloadBoardData().then(function(){}, function(){}); }
      try{ refreshOppDetail(slug); }catch(e){}   // reflect the outcome in an open drawer
    });
  });
}

// ---- F2 static activation: commit opp/<slug>/index.html via the relay (the token lives on the relay) -------
// The live host is GitHub Pages, which serves committed static files; a page in console_pages is not served
// until it is committed as opp/<slug>/index.html (exactly how the old engine published, app.js:3530). board.html
// is a static client and must NOT hold a repo-write token, so activation POSTs the html to the relay (the same
// endpoint the send uses) and the RELAY commits it with a server-held GH_TOKEN. The client never sees the token.
var BEACON_TAG_UP = '<script src="/beacon.js" defer></' + 'script>';   // byte-identical to app.js:3493 withBeacon
// TRANSIT CYCLE: the beacon reads the slug from the URL (beacon.js /opp/<slug>) but the cycle is NOT in the URL,
// so the published page must CARRY it. We stamp <meta name="thrive-cycle"> with the opp's current cycle; the
// beacon reads that meta and sends it on the hit, so the view counts the open against the CURRENT transit. The
// stamp is authoritative (any stale marker is dropped first) and idempotent. An old page with no such meta ->
// the beacon sends no cycle (NULL) -> legacy behavior, exactly as today.
function withCycleMeta(html, cycle){
  var h = String(html || "");
  if(!h.trim() || !cycle) return h;                                    // old/empty page or no cycle: nothing stamped (beacon -> NULL)
  h = h.replace(/<meta\s+name=["']thrive-cycle["'][^>]*>\s*/ig, "");    // authoritative: strip any stale marker first
  var tag = '<meta name="thrive-cycle" content="' + String(cycle).replace(/["&<>]/g, "") + '">';
  if(/<\/head\s*>/i.test(h)) return h.replace(/<\/head\s*>/i, tag + "\n</head>");
  if(/<\/body\s*>/i.test(h)) return h.replace(/<\/body\s*>/i, tag + "\n</body>");
  if(/<\/html\s*>/i.test(h)) return h.replace(/<\/html\s*>/i, tag + "\n</html>");
  return tag + "\n" + h;
}
function withBeaconClient(html, cycle){                                 // mirror app.js:3494-3502 (idempotent) + stamp the cycle
  var h = withCycleMeta(html, cycle);                                  // stamp the transit cycle FIRST (survives the relay commit)
  if(!h.trim()) return h;
  if(/beacon\.js/.test(h)) return h;
  if(/<\/body\s*>/i.test(h)) return h.replace(/<\/body\s*>/i, BEACON_TAG_UP + "\n</body>");
  if(/<\/html\s*>/i.test(h)) return h.replace(/<\/html\s*>/i, BEACON_TAG_UP + "\n</html>");
  return h + "\n" + BEACON_TAG_UP;
}
// Read the uploaded page html back from console_pages (the column E2's pageUpsert wrote). F2 only READS it.
function pageReadHtml(slug, retried){
  var url = URL_BASE + "/rest/v1/console_pages?slug=eq." + encodeURIComponent(slug) + "&select=html&limit=1";
  return authFetchOnce(url, { method:"GET", headers:{ "apikey":ANON, "Authorization":"Bearer " + bearer() }, cache:"no-store" }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return pageReadHtml(slug, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error("HTTP " + r.res.status); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    var row = (r.data && r.data[0]) || null;
    return row ? String(row.html == null ? "" : row.html) : "";
  });
}
// POST the page to the relay to commit it as a static file. The client sends only { op, slug, html } - no token.
function pagePublishRelay(slug, html){
  return relayPost({ op:"page_publish", slug:slug, html:html }, PAGE_PUBLISH_TIMEOUT_MS).then(function(r){
    if(!r.res.ok){ var e=new Error("relay " + r.res.status); e.__kind="relayhttp"; throw e; }    // a real HTTP error
    var d = r.data || {};
    if(d.ok === false){ var e2=new Error(d.error || "publish failed"); e2.__kind="relayreject"; throw e2; }  // the relay ran and refused
    return d;
  });
}
// A bounded wait (never a hang): a real setTimeout wrapped in a promise, used only to space verify-live polls.
function upDelay(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
// Verify-live with a bounded, BACKING-OFF poll for the GitHub Pages publish delay. A FRESH Pages path
// (opp/<slug>/index.html) 404s while Pages rebuilds and the CDN propagates, which routinely takes far longer
// than a few seconds, so the poll must be patient: a realistic window of several minutes with a RAMPING gap
// (never a busy-poll). Settle honestly and NAMED (never a silent permanent "publishing"):
//   ok               -> live (the caller stamps live_verified_at)
//   budget spent, still 404/410 -> dead (a definitive failure the operator can act on)
//   budget spent, other error   -> unconfirmed (still checkable; not dead, not live)
// A caller may pass a fixed (tries, gap) for a SHORT bounded re-check (e.g. the drawer's Re-check). This runs
// AFTER a successful commit, so the file exists in the repo; the send gate re-checks live at send time regardless.
function verifyLivePoll(slug, tries, gap){
  var fixed = (typeof gap === "number");                       // an explicit gap -> fixed spacing (a short bounded check)
  tries = tries || 30;                                         // default ~4.5 min with the backoff below (was 8 x 3000 = 24s, too short for a fresh Pages path)
  var base = fixed ? gap : 2000, cap = 10000, factor = 1.4;    // ramp 2s -> capped 10s; do not busy-poll
  function gapFor(n){ return fixed ? base : Math.min(cap, Math.round(base * Math.pow(factor, n - 1))); }
  function attempt(n){
    return verifyLive(slug).then(function(v){
      if(v.ok) return { ok:true, dead:false };
      if(n >= tries) return v.dead ? { ok:false, dead:true } : { ok:false, dead:false, unconfirmed:true };
      return upDelay(gapFor(n)).then(function(){ return attempt(n + 1); });
    });
  }
  return attempt(1);
}

// ---- verify-live (the real fetch that is the ONLY proof) -----------------------------------------
// A real GET of the live /opp/<slug> URL. 404/410 -> dead; ok -> live; anything else -> unknown (blocks).
// This is the truth the send gate reads; a stored flag is never trusted as proof (app.js:832-833).
function verifyLive(slug){
  var url = liveUrl(slug);
  return authFetchOnce(url, { method:"GET", cache:"no-store" }).then(function(r){
    var st = r.res.status;
    if(st === 404 || st === 410) return { ok:false, dead:true, status:st };
    if(r.res.ok) return { ok:true, dead:false, status:st };
    return { ok:false, dead:false, status:st };
  }, function(){ return { ok:false, dead:false, status:0 }; });
}
// The send gate runSend consults. A non-upload opp passes straight through (behaviour unchanged). An upload
// opp's live URL must resolve RIGHT NOW; otherwise the send is refused. PR1: the gate trusts ONLY the real
// fetch - it no longer pre-checks a stored page_active flag (that flag is retired). A page that is not live
// fails the fetch and is refused, which is the same outcome the flag used to guard, minus the stale signal.
// The board's own live-verified signal for this slug: console_board.has_page is true iff the page has been
// proven live (live_verified_at stamped, docs/supabase-live-verified.sql). A page that was verified live must
// not be aborted by one flaky GET; a page never proven live still blocks until it resolves.
function upSendLiveGate(slug, data){
  data = data || {};
  if(data.source !== "upload") return Promise.resolve();
  function deny(kind){ var e=new Error(kind); e.__kind=kind; throw e; }
  // Pages now activate ON UPLOAD, so a card in Operations already carries a live page. The gate therefore
  // blocks ONLY on a DEFINITIVELY dead page (404/410); it never blocks on "not activated" or on a transient
  // GET. A live page passes; a transient failure (network/5xx/unknown) is retried once and then ALLOWED (do
  // not lose a ready send to a flaky GET); only a 404/410 stops the send.
  return verifyLive(slug).then(function(v){
    if(v.ok) return true;                                   // live right now
    if(v.dead) deny("deadlink");                            // 404/410: the page is truly gone -> always block
    return upDelay(1500).then(function(){ return verifyLive(slug); }).then(function(v2){
      if(v2.dead) deny("deadlink");                         // still a definitive dead signal -> block
      return true;                                          // ok or a mere transient -> allow (page is live on upload)
    });
  });
}

// ---- the upload overlay (its own scrim, mirroring the profile/new-message pattern) ----------------
function upFrame(txt){ return '<div class="up-frame"><pre class="up-pre">' + esc(String(txt || "")) + '</pre></div>'; }
// F2 INSTANT PREVIEW: render a page from the HELD html as a sandboxed srcdoc iframe (the SAME mechanism the
// editor #edPreview and the Library .lv-frame preview use), never from the live URL - so a page previews
// instantly, before and after upload, independent of deploy state. Tokens ({{...}}) render as-is: offers are
// generated full in Claude and the console does not fill page tokens.
function pageFrameIframe(html){ return '<iframe class="lv-frame" title="' + esc(t("lib_preview")) + '" sandbox="" referrerpolicy="no-referrer" srcdoc="' + esc(String(html || "")) + '"></iframe>'; }
function upWarnChips(ws){
  return (ws || []).map(function(w){
    var key = w === "dup_slug" ? "up_warn_dup" : w === "no_message" ? "up_warn_nomsg" : w === "suppressed" ? "up_warn_supp" : "up_warn_generic";
    return '<span class="up-warn">' + esc(t(key)) + '</span>';
  }).join("");
}
function upRowHtml(r){
  return '<div class="up-row' + (r.warnings.length ? " up-row-warn" : "") + '">'+
    '<div class="up-row-h"><span class="up-slug mono-iso">' + esc(r.slug) + '</span> ' +
      '<span class="up-title">' + esc(r.title || "") + '</span>' + upWarnChips(r.warnings) + '</div>'+
    '<div class="up-meta"><span class="up-k">' + esc(t("up_col_email")) + ':</span> ' +
      '<bdi class="mono-iso">' + esc(r.email || t("none")) + '</bdi>' +
      ' <span class="up-k">' + esc(t("up_col_subject")) + ':</span> ' + esc(r.subject || t("none")) + '</div>'+
    // ConTh-3: the uploaded message text renders in a clean FRAMED area, never dumped raw off-screen.
    (r.body ? upFrame(r.body) : '<div class="up-empty">' + esc(t("up_no_text")) + '</div>')+
  '</div>';
}
function upResultHtml(plan){
  var rows = (plan.rows || []).map(upRowHtml).join("");
  // AXIOM #3 "ignores the rest": no orphan / informational lines. Non-page, non-message files are ignored, so
  // the preview shows ONLY the html page rows. The count below is exactly the number of those rows.
  var n = (plan.rows || []).length;
  return '<div class="up-count">' + esc(t("up_matched")) + ' ' + n + '</div>' +
    '<div class="up-rows">' + rows + '</div>'+
    '<div class="acts"><button class="act send" id="upApprove" type="button"' + (n ? "" : " disabled") + '>' + esc(t("up_approve")) + '</button></div>'+
    '<div class="act-status" id="upStatus" role="status" aria-live="polite"></div>';
}
function upPanelHtml(){
  return '<div class="nm-head"><h2>' + esc(t("up_h")) + '</h2>'+
      '<button class="link nm-x" id="upClose" type="button">' + esc(t("pf_close")) + '</button></div>'+
    '<div class="nm-body">'+
      '<div class="up-hint">' + esc(t("up_hint")) + '</div>'+
      '<input class="up-file" id="upFile" type="file" accept=".zip,.html,.htm" aria-label="' + esc(t("up_h")) + '">'+
      '<div id="upResult"></div>'+
    '</div>';
}
function upSetStatus(msg, cls){ var el=document.getElementById("upStatus"); if(el){ el.className="act-status" + (cls ? (" " + cls) : ""); el.textContent = msg || ""; } }

function openUpload(){
  var sc=document.getElementById("upScrim"), pn=document.getElementById("upPanel");
  if(!sc || !pn) return;
  __upPlan = null;
  pn.innerHTML = upPanelHtml(); sc.hidden = false; pn.scrollTop = 0;
  var fi=document.getElementById("upFile"); if(fi) fi.addEventListener("change", function(){ upOnFile(fi.files); });
  var cl=document.getElementById("upClose"); if(cl) cl.addEventListener("click", function(){ closeUpload(); });
}
function closeUpload(){ var sc=document.getElementById("upScrim"); if(sc) sc.hidden = true; __upPlan = null; }

function upOnFile(files){
  if(!files || !files.length) return;
  var res=document.getElementById("upResult"); if(res) res.innerHTML = '<div class="muted" style="padding:10px 2px">' + esc(t("up_reading")) + '</div>';
  upBuildPlan(files).then(function(plan){
    __upPlan = plan;                                         // held for review; NOTHING written yet
    var r2=document.getElementById("upResult"); if(r2){ r2.innerHTML = upResultHtml(plan);
      var ap=document.getElementById("upApprove"); if(ap) ap.addEventListener("click", function(){ upApprove(); }); }
  }, function(e){
    var r3=document.getElementById("upResult"); if(r3) r3.innerHTML = '<div class="act-status bad">' + esc((e && e.message==="not_a_zip") ? t("up_not_zip") : t("up_read_failed")) + '</div>';
  });
}
function upApprove(){
  if(__upBusy || !__upPlan) return; __upBusy = true;
  upSetStatus(t("up_writing"), ""); var ap=document.getElementById("upApprove"); if(ap) ap.disabled = true;
  upCommit(__upPlan).then(function(res){
    try{ upActivateBackground(res.published); }catch(e){}   // ACTIVATE ON UPLOAD: verify + stamp live in the background, then reload
    return reloadBoardData().then(function(){ return res; }, function(){ return res; });
  }).then(function(res){
    __upBusy = false;
    if(res.fail){
      // FEEDBACK: a file that failed to commit is named with the count, as a warning (amber if some landed, red
      // if none), and the overlay stays OPEN so the operator reads which files failed - never a silent success.
      var names = (res.failed || []).join(", ");
      upSetStatus(t("up_done_partial").replace("{k}", String(res.ok || 0)).replace("{n}", String((res.ok || 0) + res.fail)) + " " + names, (res.ok ? "warn" : "bad"));
      var ap2=document.getElementById("upApprove"); if(ap2) ap2.disabled = false;   // allow a retry
    } else {
      upSetStatus(t("up_done") + " " + (res.ok || 0), "ok");
      setTimeout(function(){ closeUpload(); }, 600);
    }
  }).catch(function(e){
    __upBusy = false; var a2=document.getElementById("upApprove"); if(a2) a2.disabled = false;
    upSetStatus((e && e.authRequired) ? t("err") : t("up_write_failed"), "bad");
  });
}

// ---- the Activate control on the drawer (injected after the editor) --------------------------------
// PR1: renders for any opp that HAS a page row (detail.page), not only upload-source opps. The state is the
// verified truth and nothing else: activated / live iff the console_pages row has live_verified_at set (by
// slug), otherwise a draft. Activation commits the static file via the relay then verifies the live URL with
// a real fetch and, ONLY on ok, stamps live_verified_at; send stays blocked until the fetch resolves live
// (upSendLiveGate re-verifies at send time regardless).
// PR-AF - no dead ends: a card that has a page (its OWN row, or a SHARED template page via data.page_slug) always
// offers an exit. When the page is live, the section confirms it; when it is un-live, it offers Re-activate/repair
// (re-run publish + verify + stamp) targeting the EFFECTIVE page slug (detail.pageSlug = data.page_slug || slug),
// so a PROMOTED card that owns no page row of its own can still repair its shared template page. Only a card with
// no page anywhere (a message-only opp) renders nothing here.
function uploadActivateHtml(slug, row, detail){
  var page = (detail && detail.page) || null;
  var pageSlug = (detail && detail.pageSlug) || slug;
  var hasPage = !!(page || (detail && detail.opp && detail.opp.data && detail.opp.data.page_slug));
  if(!hasPage) return "";                                        // no page anywhere -> nothing to activate
  var live = !!(page && page.live_verified_at);                 // the SINGLE, durable liveness truth (on the effective page)
  // F1 PUBLISH TRUTH: a COMMITTED page is published. The only two states are live (green) or a neutral
  // transitional "Published, going live shortly" - NEVER a RED "dead"/failed, because a not-yet-resolving URL
  // is an async deploy that has not landed, not a publish failure. The transitional state always offers a
  // Re-check, and the background re-verify (upWireActivate on open) flips it to green Live when the deploy
  // lands. RED is reserved for a genuine relay/commit failure, which surfaces on the upload result panel
  // (libDoneRowHtml), never here.
  var stateKey = live ? "up_state_live" : "up_state_going_live";
  var stateCls = live ? "ok" : "";                              // never "bad" for a committed page
  var canReverify = !live;                                       // Re-check offered until it resolves live
  return '<div class="dw-sec up-act-sec" data-page-slug="' + esc(pageSlug) + '" data-live="' + (live ? "1" : "0") + '"><h3>' + esc(t("up_page_h")) + '</h3>'+
    '<div class="up-state ' + stateCls + '" id="upState">' + esc(t(stateKey)) + '</div>'+
    (canReverify ? '<div class="acts"><button class="act" id="upReverify" type="button">' + esc(t("up_reverify")) + '</button></div>' : '')+
    '<div class="act-status" id="upActStatus"></div>'+
    // F2: an in-place srcdoc preview of the stored page html (populated async in upWireActivate via
    // pageReadHtml), so a landed offer previews instantly, before AND after the deploy resolves.
    '<div class="up-preview" id="upPreview"></div></div>';
}
// A SHORT, bounded re-check (the operator is watching): ~24s, fixed spacing. On ok, stamp live_verified_at
// (which persists across reloads) and flip the badge to green Live. F1: a spent budget is NOT a failure - the
// deploy simply has not landed yet, so the page stays in the neutral transitional state (never RED) and the
// next re-check flips it to Live. Guarded by __upVerifying so a re-open never stacks polls; always refreshes
// the open drawer so the state (live / going live shortly) is shown, never a stale silent "publishing".
function upReverify(pageSlug, oppSlug){
  if(__upVerifying[pageSlug]) return Promise.resolve();
  __upVerifying[pageSlug] = 1;
  return verifyLivePoll(pageSlug, 6, 4000).then(function(v){
    if(v && v.ok){ delete __upLive[pageSlug]; return pageStampLive(pageSlug).catch(function(){}); }
    // not resolved yet: leave transitional (no RED), a later re-check flips it to Live
  }, function(){}).then(function(){
    delete __upVerifying[pageSlug];
    try{ refreshOppDetail(oppSlug); }catch(e){}
  }, function(){ delete __upVerifying[pageSlug]; });
}
// Wire the upload-page section AFTER the Details view renders (called from owDetailWire): the Re-check button, and
// a RE-VERIFY ON OPEN. A page refresh drops the in-page background promise, so a page that is un-live with no
// recorded outcome yet is re-checked here (bounded), resolving its true state instead of a stale "publishing".
function upWireActivate(slug){
  var sec = document.querySelector("#owDetail .up-act-sec"); if(!sec) return;
  var pageSlug = sec.getAttribute("data-page-slug") || slug;
  var live = sec.getAttribute("data-live") === "1";
  var btn = document.getElementById("upReverify");
  if(btn) btn.addEventListener("click", function(){ btn.disabled = true; upActStatus(t("up_verifying"), ""); upReverify(pageSlug, slug); });
  if(!live && !__upLive[pageSlug] && !__upVerifying[pageSlug]){ upActStatus(t("up_verifying"), ""); upReverify(pageSlug, slug); }
  // F2: preview the landed offer in place from the STORED console_pages html (srcdoc), instant and independent
  // of the deploy. Best-effort: a failed read simply leaves the preview empty, never an error in the drawer.
  var pv = document.getElementById("upPreview");
  if(pv){ pageReadHtml(pageSlug).then(function(html){ if(html) pv.innerHTML = pageFrameIframe(html); }, function(){}); }
}
function upActStatus(msg, cls){ var el=document.getElementById("upActStatus"); if(el){ el.className="act-status" + (cls ? (" " + cls) : ""); el.textContent = msg || ""; } }
// Activation, the GitHub-Pages sacred order (mirror app.js:3586 activateAndConfirm): COMMIT the static file
// via the relay, then CONFIRM live with a real bounded poll, then and ONLY then STAMP the truth. The client
// never holds the token (the relay commits). PR1 settle-always: green (up_now_live) ONLY after the stamp write
// returns ok; red on a verify fail OR a stamp-write fail; there is no optimistic success and no liveness flag
// written to the opp's data. On any failure the page is left NOT stamped, so it stays a draft everywhere.
// (upActivate / upWireActivate removed: activation is no longer a manual drawer button. Pages activate on
// upload via upCommit -> upActivateBackground; the drawer's page section is a passive state line only.)

// ===================================================================================================
// LIBRARY UPLOAD (PR1) - document + activate templates with NO message, NO recipient, NO card.
// The Library path reuses the SAME read/parse/preview the campaign upload uses (upReadFiles/upBuildPlan,
// never forked) but on approval it commits ONLY the console_pages row and runs the activation chain per file.
// It NEVER calls oppUpsert, so no console_opps card is created; the board view is anchored on console_opps
// (docs/supabase-board-view.sql:242), so a page with no opp never appears on the Operations board. It never
// opens the compose surface and never sends (runSend / sendMode / upSendLiveGate are untouched). Result: each
// template is a live console_pages row (live_verified_at stamped) with its own live link liveUrl(slug).
// Shares __upPlan / __upBusy with the campaign path (only one upload overlay is ever open).
// ===================================================================================================
function libPanelHtml(){
  return '<div class="nm-head"><h2>' + esc(t("lib_h")) + '</h2>'+
      '<button class="link nm-x" id="upClose" type="button">' + esc(t("pf_close")) + '</button></div>'+
    '<div class="nm-body">'+
      '<div class="up-hint">' + esc(t("lib_hint")) + '</div>'+
      '<input class="up-file" id="upFile" type="file" accept=".zip,.html,.htm" aria-label="' + esc(t("lib_h")) + '">'+
      '<div id="upResult"></div>'+
    '</div>';
}
// Open the SAME upload overlay in Library (page-only) mode. Mirrors openUpload; only the copy + handlers differ.
function openLibrary(){
  var sc=document.getElementById("upScrim"), pn=document.getElementById("upPanel");
  if(!sc || !pn) return;
  __upPlan = null;
  pn.innerHTML = libPanelHtml(); sc.hidden = false; pn.scrollTop = 0;
  var fi=document.getElementById("upFile"); if(fi) fi.addEventListener("change", function(){ libOnFile(fi.files); });
  var cl=document.getElementById("upClose"); if(cl) cl.addEventListener("click", function(){ closeUpload(); });
}
// PR-L1: the review row lets the operator set a clean SLUG, TITLE, and TASK per file BEFORE publish, so the
// live link is right the first time and no rename is ever needed (the relay has no delete op). Defaults: slug
// from upPageSlug (the plan), title from the plan title (or a prettified slug), task blank. The task input
// offers the existing tasks via a shared datalist and also accepts a brand-new one typed in.
var LIB_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
function libRowHtml(r, i){
  var slug = r.slug || "", title = r.title || upPretty(r.slug), task = r.task || "";
  return '<div class="up-row lib-edit" data-lib-idx="' + i + '">'+
    '<div class="lib-fields">'+
      '<label class="lib-f"><span class="lib-fl">' + esc(t("lib_f_title")) + '</span>'+
        '<input class="lib-in" id="libTitle-' + i + '" type="text" value="' + esc(title) + '" autocomplete="off"></label>'+
      '<label class="lib-f"><span class="lib-fl">' + esc(t("lib_f_slug")) + '</span>'+
        '<input class="lib-in mono-iso" id="libSlug-' + i + '" type="text" dir="ltr" value="' + esc(slug) + '" autocomplete="off" spellcheck="false"></label>'+
      '<label class="lib-f"><span class="lib-fl">' + esc(t("lib_f_task")) + '</span>'+
        '<input class="lib-in" id="libTask-' + i + '" type="text" list="libTasks" value="' + esc(task) + '" autocomplete="off" placeholder="' + esc(t("lib_task_ph")) + '"></label>'+
    '</div>'+
    '<div class="lib-rowerr" id="libErr-' + i + '"></div>'+
    // F2: render the actual page from the held html (srcdoc), not a source-text snippet, so the team sees the
    // real page BEFORE uploading. Tokens render as-is (raw-template preview).
    (r.page && r.page.html ? pageFrameIframe(r.page.html) : '<div class="up-empty">' + esc(t("up_no_text")) + '</div>')+
  '</div>';
}
function libTasksDatalist(tasks){
  return '<datalist id="libTasks">' + (tasks || []).map(function(tk){ var v = esc(tk); return '<option value="' + v + '">' + v + '</option>'; }).join("") + '</datalist>';
}
function libResultHtml(plan, tasks){
  var rows = (plan.rows || []).map(function(r, i){ return libRowHtml(r, i); }).join("");
  var n = (plan.rows || []).length;
  return libTasksDatalist(tasks)+
    '<div class="up-count">' + esc(t("up_matched")) + ' ' + n + '</div>'+
    '<div class="up-rows">' + rows + '</div>'+
    '<div class="acts"><button class="act send" id="libApprove" type="button"' + (n ? "" : " disabled") + '>' + esc(t("lib_activate")) + '</button></div>'+
    '<div class="act-status" id="upStatus" role="status" aria-live="polite"></div>';
}
// The next FREE slug: the given slug if it is taken by neither the existing console_pages set nor a slug already
// claimed earlier in this batch, else slug-2, slug-3, ... A hostile runtime that somehow exhausts the counter
// falls back to a time suffix, so this always returns a usable, free slug (never loops forever, never "").
function upFreeSlug(slug, seen){
  function taken(s){ return !!((__libExisting && __libExisting[s]) || (seen && seen[s])); }
  if(!taken(slug)) return slug;
  for(var n = 2; n < 1000; n++){ var cand = slug + "-" + n; if(!taken(cand)) return cand; }
  return slug + "-" + Date.now().toString(36);
}
// Read the edited slug/title/task back into the plan rows and validate: slug format + uniqueness against the
// existing console_pages slugs (__libExisting) and against the other rows in this batch. Marks each row's inline
// error and returns { ok, firstBad }.
// BUG-1 FIX: with autoSuffix (the campaign commit paths pass true), a slug already TAKEN in console_pages, or by
// an earlier row in this batch, is NOT an error to fix by hand - the message would be stuck and the card would
// commit empty. Instead the slug is renamed to the next free one (bards-alley-2), the input is updated, and a
// visible (info, not error) note shows the rename, so the page + its message + recipient commit under a free
// slug and no card is ever left empty. Only a bad FORMAT still blocks (a genuine input error). The Library
// upload keeps autoSuffix off, so a hand-named page still surfaces "already taken" for the operator to rename.
function libCollectRows(autoSuffix){
  var plan = __upPlan; if(!plan || !plan.rows) return { ok:false, firstBad:-1 };
  var seen = {}, ok = true, firstBad = -1;
  plan.rows.forEach(function(r, i){
    if(r && r.included===false){                                          // an excluded row is dropped at commit; it never validates or blocks
      var e0=document.getElementById("libErr-"+i); if(e0){ e0.textContent=""; e0.className="lib-rowerr"; }
      var s0=document.getElementById("libSlug-"+i); if(s0) s0.className="lib-in mono-iso";
      return;
    }
    var si = document.getElementById("libSlug-" + i), ti = document.getElementById("libTitle-" + i), ki = document.getElementById("libTask-" + i);
    var slug = si ? String(si.value||"").trim().toLowerCase() : (r.slug||"");
    var renamed = "";
    if(autoSuffix && LIB_SLUG_RE.test(slug) && ((__libExisting && __libExisting[slug]) || seen[slug])){
      var free = upFreeSlug(slug, seen);
      if(free !== slug){ renamed = free; slug = free; if(si) si.value = slug; }   // rename to a free slug; keep the message
    }
    r.slug = slug;
    r.title = ti ? String(ti.value||"").trim() : (r.title||"");
    r.task  = ki ? String(ki.value||"").trim() : (r.task||"");
    var msg = "";
    if(!LIB_SLUG_RE.test(slug)) msg = t("lib_err_slug");
    else if(seen[slug]) msg = t("lib_err_dup");
    else if(!autoSuffix && __libExisting && __libExisting[slug]) msg = t("lib_err_exists");
    seen[slug] = 1;
    var err = document.getElementById("libErr-" + i);
    if(err){
      if(renamed){ err.textContent = t("lib_renamed").replace("{s}", slug); err.className = "lib-rowerr info"; }
      else { err.textContent = msg; err.className = "lib-rowerr" + (msg ? " bad" : ""); }
    }
    if(si){ si.className = "lib-in mono-iso" + (msg ? " bad" : ""); }
    if(msg){ ok = false; if(firstBad < 0) firstBad = i; }
  });
  return { ok:ok, firstBad:firstBad };
}
function libOnFile(files){
  if(!files || !files.length) return;
  var res=document.getElementById("upResult"); if(res) res.innerHTML = '<div class="muted" style="padding:10px 2px">' + esc(t("up_reading")) + '</div>';
  Promise.all([ upBuildPlan(files), libFetchPages() ]).then(function(a){   // the SAME parser (never forked) + existing slugs/tasks
    var plan = a[0], pages = a[1] || [];
    __upPlan = plan;                                         // held for review; NOTHING written yet
    __libExisting = {}; pages.forEach(function(p){ if(p && p.slug) __libExisting[p.slug] = 1; });
    var r2=document.getElementById("upResult"); if(r2){ r2.innerHTML = libResultHtml(plan, libDistinctTasks(pages));
      var ap=document.getElementById("libApprove"); if(ap) ap.addEventListener("click", function(){ libApprove(); });
      libCollectRows();                                     // initial validation paint
      (plan.rows||[]).forEach(function(r, i){ var si=document.getElementById("libSlug-"+i); if(si) si.addEventListener("input", function(){ libCollectRows(); }); });
    }
  }, function(e){
    var r3=document.getElementById("upResult"); if(r3) r3.innerHTML = '<div class="act-status bad">' + esc((e && e.message==="not_a_zip") ? t("up_not_zip") : t("up_read_failed")) + '</div>';
  });
}
// PAGE-ONLY COMMIT + activation, per file. Writes ONLY console_pages (pageUpsert), then the activation chain
// (pagePublishRelay -> verifyLivePoll -> pageStampLive). NEVER oppUpsert. Per-file settle: a file that cannot
// publish records its own failure and the batch continues - never a dropped batch, never a phantom success.
// PR-L0 COMMIT != VERIFY: a page is PUBLISHED the moment the relay commit returns {ok:true}. Liveness (a real
// GET of the live URL) is a NON-BLOCKING follow-up (libVerifyBackground): a GitHub Pages rebuild takes far
// longer than any client bound, so the batch must never wait on it and never report a committed page as failed.
// A CLIENT TIMEOUT is NOT a failure either: pagePublish_ is idempotent by path+sha, so the commit very likely
// landed; the row reports "confirming" and next-open / the send gate reconciles. ONLY a real relay error (an
// HTTP error or {ok:false}) is a true publish failure.
function upCommitLibrary(plan){
  var rows = (plan && plan.rows) || [], done = {}, results = [];
  function one(i){
    if(i >= rows.length) return Promise.resolve(results);
    var r = rows[i];
    if(done[r.slug]){ return one(i + 1); }
    done[r.slug] = 1;
    var html = assetBaseInto((r.page && r.page.html) || ""), title = r.title || upPretty(r.slug), task = r.task || "";   // resolve {{ASSET_BASE}} before store + commit
    if(!String(html).trim()){ results.push({ slug:r.slug, title:title, task:task, ok:false, kind:"nohtml" }); return one(i + 1); }
    return pageUpsert(r.slug, html, { title:title, task:task })                     // console_pages row ONLY (title+task) - no oppUpsert
      .then(function(){ return pagePublishRelay(r.slug, withBeaconClient(html)); }) // relay commits the static file
      .then(function(){
        results.push({ slug:r.slug, title:title, ok:true, published:true, live:false, link:liveUrl(r.slug) });  // committed = published
        return one(i + 1);
      }, function(e){
        if(e && e.kind === "timeout"){                                             // idempotent commit, likely landed -> confirming
          results.push({ slug:r.slug, title:title, ok:true, published:true, confirming:true, live:false, link:liveUrl(r.slug) });
        } else {                                                                    // a real relay error is the only true failure
          results.push({ slug:r.slug, title:title, ok:false, kind:(e && e.__kind) || "fail" });
        }
        return one(i + 1);
      });
  }
  return one(0);
}
// Non-blocking follow-up: for each committed row, confirm live (a real fetch) and, only on ok, stamp
// live_verified_at and upgrade the row from "confirming" to "live". A verify failure NEVER downgrades a
// published row - build-lag is not a publish failure.
function libVerifyBackground(results){
  (results || []).forEach(function(x){
    if(!x || !x.ok || x.live) return;
    verifyLivePoll(x.slug).then(function(v){
      if(v && v.ok){ pageStampLive(x.slug).catch(function(){}); libUpgradeRow(x.slug); }
    }).catch(function(){});
  });
}
function libUpgradeRow(slug){
  var row = document.querySelector('#upResult [data-lib-slug="' + slug + '"]');   // slug is sanitized [a-z0-9-]
  if(!row) return;
  var chip = row.querySelector(".lib-state");
  if(chip){ chip.className = "up-warn lib-state ok"; chip.textContent = t("lib_row_live"); }
}
// Done panel: each committed template with its live link + Copy/Open (live, or "confirming" while Pages builds),
// or a real publish failure. No card, no send.
function libDoneRowHtml(x){
  if(x.ok){
    var live = !!x.live;
    return '<div class="up-row lib-live" data-lib-slug="' + esc(x.slug) + '">'+
      '<div class="up-row-h"><span class="up-slug mono-iso">' + esc(x.slug) + '</span> '+
        '<span class="up-title">' + esc(x.title || "") + '</span>'+
        '<span class="up-warn lib-state' + (live ? " ok" : "") + '">' + esc(t(live ? "lib_row_live" : "lib_row_confirming")) + '</span></div>'+
      '<div class="up-meta"><span class="up-k">' + esc(t("lib_link")) + ':</span> '+
        '<bdi class="mono-iso lib-url">' + esc(liveUrl(x.slug)) + '</bdi></div>'+
      '<div class="acts"><button class="act" type="button" data-lib-copy="' + esc(x.slug) + '">' + esc(t("lib_copy")) + '</button>'+
        '<button class="act" type="button" data-lib-open="' + esc(x.slug) + '">' + esc(t("lib_open_page")) + '</button></div>'+
    '</div>';
  }
  var reason = (x.kind === "nohtml") ? t("up_no_html") : t("up_commit_failed");   // a committed page is never here
  return '<div class="up-row up-row-warn" data-lib-slug="' + esc(x.slug) + '">'+
    '<div class="up-row-h"><span class="up-slug mono-iso">' + esc(x.slug) + '</span> '+
      '<span class="up-title">' + esc(x.title || "") + '</span>'+
      '<span class="up-warn">' + esc(t("lib_row_failed")) + '</span></div>'+
    '<div class="up-meta">' + esc(reason) + '</div>'+
  '</div>';
}
function libDoneHtml(results){
  var okN = (results || []).filter(function(x){ return x.ok; }).length;
  var rows = (results || []).map(libDoneRowHtml).join("");
  return '<div class="up-count">' + esc(t("lib_done")) + ' ' + okN + '</div>'+
    '<div class="up-rows">' + rows + '</div>'+
    '<div class="acts"><button class="act" id="upClose2" type="button">' + esc(t("pf_close")) + '</button></div>';
}
// Link controls (ported from the old-engine modalOpen/modalCopy, app.js). Copy uses the async clipboard when
// present and falls back to showing the URL so it can always be copied by hand; Open opens the live page.
function libCopyLink(slug){
  var url = liveUrl(slug);
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url); upSetStatus(t("lib_copied"), "ok"); return; } }catch(e){}
  upSetStatus(url, "");
}
function libOpenPage(slug){ try{ window.open(liveUrl(slug), "_blank", "noopener"); }catch(e){} }
function libWireDone(){
  [].forEach.call(document.querySelectorAll("#upResult [data-lib-copy]"), function(b){ b.addEventListener("click", function(){ libCopyLink(b.getAttribute("data-lib-copy")); }); });
  [].forEach.call(document.querySelectorAll("#upResult [data-lib-open]"), function(b){ b.addEventListener("click", function(){ libOpenPage(b.getAttribute("data-lib-open")); }); });
  var c2=document.getElementById("upClose2"); if(c2) c2.addEventListener("click", function(){ closeUpload(); });
}
function libApprove(){
  if(__upBusy || !__upPlan) return;
  var chk = libCollectRows();                              // read the edited slug/title/task + validate
  if(!chk.ok){ upSetStatus(t("lib_err_fix"), "bad"); var bad=document.getElementById("libSlug-"+chk.firstBad); if(bad){ try{ bad.focus(); }catch(e){} } return; }
  __upBusy = true;
  upSetStatus(t("lib_activating"), ""); var ap=document.getElementById("libApprove"); if(ap) ap.disabled = true;
  upCommitLibrary(__upPlan).then(function(results){
    __upBusy = false;
    var r=document.getElementById("upResult"); if(r){ r.innerHTML = libDoneHtml(results); libWireDone(); }
    libVerifyBackground(results);          // PR-L0: verify-live is a NON-BLOCKING follow-up (confirming -> live), never a failure
  }).catch(function(e){
    __upBusy = false; var a2=document.getElementById("libApprove"); if(a2) a2.disabled = false;
    upSetStatus((e && e.authRequired) ? t("err") : t("up_write_failed"), "bad");
  });
}

// ===================================================================================================
// LIBRARY SURFACE (PR-L1) - a standalone, task-classified, searchable view of every published template.
// Reads ALL console_pages via restGet (page-only, independent of console_opps), groups by TASK, and shows per
// template: title (fallback slug), slug, live state, the live link with Copy/Open, and an on-demand preview.
// This is a READ + link + preview surface; promote-to-Operations, contacts, and archive are later PRs.
// ===================================================================================================
function libFetchPages(){
  return restGet("console_pages?select=slug,title,task,live_verified_at,up,updated_at&order=up.desc")
    .then(function(a){ return Array.isArray(a) ? a : []; }, function(){ return []; });
}
function libDistinctTasks(pages){
  var seen = {}, out = [];
  (pages||[]).forEach(function(p){ var tk = p && p.task ? String(p.task).trim() : ""; if(tk && !seen[tk]){ seen[tk]=1; out.push(tk); } });
  return out.sort();
}
function openLibraryView(){
  var sc=document.getElementById("libViewScrim"), pn=document.getElementById("libViewPanel");
  if(!sc || !pn) return;
  __libQuery = ""; __libTab = "templates";
  libRenderView();
  sc.hidden = false; pn.scrollTop = 0;
  try{ shimmerOnce(pn); }catch(e){}
}
function libRenderView(){
  var pn=document.getElementById("libViewPanel"); if(!pn) return;
  pn.innerHTML = libViewHtml();
  libViewWireShell();
  libViewLoad();
}
function closeLibraryView(){ var sc=document.getElementById("libViewScrim"); if(sc) sc.hidden = true; }
function libViewHtml(){
  var arch = (__libTab==="archive");
  return '<div class="lv-head">'+
      '<h2 class="lv-title">' + esc(t("lib_view_h")) + '</h2>'+
      '<div class="lv-head-acts">'+
        '<button class="btnp" id="lvAdd" type="button">' + esc(t("lib_add")) + '</button>'+
        '<button class="link" id="lvClose" type="button">' + esc(t("pf_close")) + '</button>'+
      '</div>'+
    '</div>'+
    '<div class="lv-tabs">'+
      '<button class="lv-tab' + (arch ? "" : " on") + '" id="lvTabTpl" type="button">' + esc(t("lib_tab_templates")) + '</button>'+
      '<button class="lv-tab' + (arch ? " on" : "") + '" id="lvTabArch" type="button">' + esc(t("lib_tab_archive")) + '</button>'+
    '</div>'+
    (arch ? '' : '<div class="lv-search"><input class="lv-q" id="lvQ" type="search" dir="auto" placeholder="' + esc(t("lib_search_ph")) + '" autocomplete="off" aria-label="' + esc(t("lib_search_ph")) + '"></div>')+
    '<div class="lv-body" id="lvBody"><div class="muted" style="padding:14px 2px">' + esc(t("up_reading")) + '</div></div>';
}
function libViewLoad(){
  if(__libTab==="archive"){ libArchLoad(); return; }
  libFetchPages().then(function(pages){ __libPages = pages; libRenderList(); libReverifyPending(); });
}
function libSwitchTab(tab){ if(__libTab===tab) return; __libTab = tab; __libQuery = ""; libRenderView(); }

// ===================================================================================================
// ARCHIVE SURFACE (PR-AF) - the labeled home for archived cards, so an archived card is never invisible. Reads
// console_opps?archived=eq.true directly (like the templates tab reads console_pages). Each card shows its title,
// archived_at, and archived_from (the column it was archived from), with a one-tap open to its FULL history (the
// board drawer, which renders notes + conversations + the archive stamps) and a one-tap Restore (archived=false).
// ===================================================================================================
function libArchLoad(){
  var body=document.getElementById("lvBody");
  if(body) body.innerHTML='<div class="muted" style="padding:14px 2px">'+esc(t("up_reading"))+'</div>';
  restGet("console_opps?archived=eq.true&select=slug,business,stage,archived_at,archived_from&order=archived_at.desc.nullslast")
    .then(function(a){ __libArch = Array.isArray(a) ? a : []; libArchRender(); }, function(){ __libArch = []; libArchRender(); });
}
function libArchRender(){
  var body=document.getElementById("lvBody"); if(!body) return;
  if(!__libArch.length){ body.innerHTML='<div class="lv-empty">'+esc(t("lib_arch_empty"))+'</div>'; return; }
  body.innerHTML='<div class="lv-cards">'+__libArch.map(libArchCardHtml).join("")+'</div>';
  libArchWire();
}
function libArchCardHtml(o){
  var title=(o.business && String(o.business).trim()) || upPretty(o.slug);
  var at=o.archived_at ? fmtWhen(o.archived_at) : "", from=o.archived_from ? laneLabel(o.archived_from) : "";
  var meta="";
  if(at)   meta+='<div class="lv-arch-meta"><span class="lv-k">'+esc(t("a_arch_at"))+':</span> <bdi>'+esc(at)+'</bdi></div>';
  if(from) meta+='<div class="lv-arch-meta"><span class="lv-k">'+esc(t("a_arch_from"))+':</span> <bdi>'+esc(from)+'</bdi></div>';
  return '<div class="lv-card lv-arch" data-arch-slug="'+esc(o.slug)+'">'+
    '<div class="lv-card-h"><span class="lv-card-t">'+esc(title)+'</span></div>'+
    meta+
    '<div class="lv-acts">'+
      '<button class="act" type="button" data-lv-arch-open="'+esc(o.slug)+'">'+esc(t("lib_arch_open"))+'</button>'+
      '<button class="act" type="button" data-lv-restore="'+esc(o.slug)+'">'+esc(t("lib_restore"))+'</button>'+
    '</div>'+
    '<div class="act-status lv-arch-st" id="lvArchSt-'+esc(o.slug)+'"></div>'+
  '</div>';
}
function libArchWire(){
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-arch-open]"), function(b){ b.addEventListener("click", function(){ libArchOpenHistory(b.getAttribute("data-lv-arch-open")); }); });
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-restore]"), function(b){ b.addEventListener("click", function(){ libRestore(b.getAttribute("data-lv-restore"), b); }); });
}
// Open the full history: close the Library and open the opp window on Details for this slug (it renders the archive
// stamps via archivedInfoHtml + the notes + the conversation from fetchDetail). Reload first so the row is in memory.
function libArchOpenHistory(slug){
  closeLibraryView();
  if(typeof openOppWindow !== "function") return;
  reloadBoardData().then(function(){ openOppWindow(slug, "detail"); }, function(){ openOppWindow(slug, "detail"); });
}
// Restore: un-archive (archived=false), clearing a legacy terminal stage exactly like the drawer's reopen, so the
// card returns to its lane; then refresh the archive list (the card is gone from it). Reuses oppPatch.
function libRestore(slug, btn){
  if(btn) btn.disabled = true;
  var st=(document.getElementById("lvArchSt-"+slug));
  if(st){ st.className="act-status lv-arch-st"; st.textContent=t("a_saving"); }
  var row=(typeof findRow==="function" && findRow(slug)) || {};
  var clear = TRAY_STAGES.indexOf(row.stage||"") >= 0;
  var patch = clear ? { archived:false, stage:"", up:Date.now() } : { archived:false, up:Date.now() };
  oppPatch(slug, patch).then(function(){ return reloadBoardData().then(function(){}, function(){}); }).then(function(){
    libArchLoad();                                                     // the card left the archive; re-render the list
  }).catch(function(e){
    if(btn) btn.disabled = false;
    if(st){ st.className="act-status lv-arch-st bad"; st.textContent=(e && e.authRequired) ? t("err") : t("a_failed"); }
  });
}
// PR-CF - the console's first live-health signal (self-memory seed). For every template whose live_verified_at is
// NULL (published but not yet confirmed), re-run the SAME verify-live poll the upload uses, in the background:
// GitHub Pages often finishes building after the short upload-time window, so a page that is actually live still
// reads "confirming" until something re-checks it. On ok we stamp live_verified_at (the single liveness write) and
// flip the chip to "live" without a re-upload; on a persistent failure we flip it to a RED "fault", so a broken
// live URL announces itself instead of stalling forever. NEVER downgrades an already-live template. Returns a
// promise (Promise.all of the per-slug jobs) so a test can await it; the poll window is wider than upload time.
function libReverifyPending(tries, gap){
  var pend = (__libPages || []).filter(function(p){ return p && !p.live_verified_at && __libState[p.slug] !== "live"; });
  var jobs = pend.map(function(p){
    return verifyLivePoll(p.slug, tries || 5, gap || 4000).then(function(v){
      if(v && v.ok){
        p.live_verified_at = new Date().toISOString();   // remember locally so a search re-render stays "live"
        libSetState(p.slug, "live");
        return pageStampLive(p.slug).catch(function(){});  // persist the liveness truth (self-memory)
      }
      // F1: not resolved within this pass is an async deploy that has not landed, NOT a fault. Leave the row in
      // its neutral transitional "Published (going live)" state (never a RED "fault"); a later Library open
      // re-runs this pass and flips it to Live once the deploy arrives.
    }, function(){});
  });
  return Promise.all(jobs);
}
function libViewWireShell(){
  var c=document.getElementById("lvClose"); if(c) c.addEventListener("click", function(){ closeLibraryView(); });
  var a=document.getElementById("lvAdd"); if(a) a.addEventListener("click", function(){ closeLibraryView(); openLibrary(); });   // add templates -> the upload overlay
  var q=document.getElementById("lvQ"); if(q) q.addEventListener("input", function(){ __libQuery = String(q.value||"").trim().toLowerCase(); libRenderList(); });
  var tt=document.getElementById("lvTabTpl"); if(tt) tt.addEventListener("click", function(){ libSwitchTab("templates"); });
  var ta=document.getElementById("lvTabArch"); if(ta) ta.addEventListener("click", function(){ libSwitchTab("archive"); });
}
function libMatches(p, q){
  if(!q) return true;
  var hay = ((p.title||"") + " " + (p.slug||"") + " " + (p.task||"")).toLowerCase();
  return hay.indexOf(q) >= 0;
}
// Group the (filtered) pages under their TASK heading; untasked go under a single "غير مصنّف" section, sorted last.
function libRenderList(){
  var body = document.getElementById("lvBody"); if(!body) return;
  var pages = (__libPages||[]).filter(function(p){ return libMatches(p, __libQuery); });
  if(!pages.length){ body.innerHTML = '<div class="lv-empty">' + esc(__libQuery ? t("lib_no_match") : t("lib_empty")) + '</div>'; return; }
  var groups = {}, order = [], UNTASK = t("lib_untasked");
  pages.forEach(function(p){ var tk = (p.task && String(p.task).trim()) || UNTASK; if(!groups[tk]){ groups[tk]=[]; order.push(tk); } groups[tk].push(p); });
  order.sort(function(a,b){ if(a===UNTASK) return 1; if(b===UNTASK) return -1; return a<b?-1:(a>b?1:0); });
  body.innerHTML = order.map(function(tk){
    var cards = groups[tk].map(libCardHtml).join("");
    return '<section class="lv-sec"><h3 class="lv-task"><span class="lv-task-k">' + esc(t("lib_task_k")) + '</span> <bdi>' + esc(tk) + '</bdi> <span class="lv-n">' + groups[tk].length + '</span></h3>'+
      '<div class="lv-cards">' + cards + '</div></section>';
  }).join("");
  libViewWireCards();
}
// PR-CF: three liveness states for a template chip. "live" = live_verified_at stamped (verified). "confirming" =
// published, verify pending or retrying. "fault" = published but the live URL will not resolve after retries - a
// visible RED fault, never a silent stall. Once re-verify settles a slug, __libState remembers it across re-renders.
function libStateOf(p){ if(p && p.live_verified_at) return "live"; return __libState[p && p.slug] || "confirming"; }
function libStateCls(state){ return "lv-state" + (state==="live" ? " ok" : (state==="fault" ? " bad" : "")); }
function libStateKey(state){ return state==="live" ? "lib_row_live" : (state==="fault" ? "lib_row_fault" : "lib_row_confirming"); }
function libSetState(slug, state){
  __libState[slug] = state;
  var el = document.getElementById("lvState-" + slug);
  if(el){ el.className = libStateCls(state); el.textContent = t(libStateKey(state)); }
  var ab = document.getElementById("lvAct-" + slug);                  // PR-AF: the repair exit is offered while not live
  if(ab) ab.hidden = (state === "live");
}
function libCardHtml(p){
  var state = libStateOf(p), title = (p.title && String(p.title).trim()) || upPretty(p.slug);
  return '<div class="lv-card" data-lib-slug="' + esc(p.slug) + '">'+
    '<div class="lv-card-h"><span class="lv-card-t">' + esc(title) + '</span>'+
      '<span class="' + libStateCls(state) + '" id="lvState-' + esc(p.slug) + '">' + esc(t(libStateKey(state))) + '</span></div>'+
    '<div class="lv-slug mono-iso" dir="ltr">' + esc(p.slug) + '</div>'+
    '<div class="lv-link"><span class="lv-k">' + esc(t("lib_link")) + ':</span> <bdi class="mono-iso lv-url" dir="ltr">' + esc(liveUrl(p.slug)) + '</bdi></div>'+
    '<div class="lv-acts">'+
      '<button class="act" type="button" data-lv-copy="' + esc(p.slug) + '">' + esc(t("lib_copy")) + '</button>'+
      '<button class="act" type="button" data-lv-open="' + esc(p.slug) + '">' + esc(t("lib_open_page")) + '</button>'+
      '<button class="act" type="button" data-lv-prev="' + esc(p.slug) + '">' + esc(t("lib_preview")) + '</button>'+
      // Phase 3 template memory: who this template was sent to (contacts), the sender, date/time and the count.
      '<button class="act lv-mem-b" type="button" data-lv-mem="' + esc(p.slug) + '">' + esc(t("ct_mem_open")) + '</button>'+
      '<button class="act lv-prom-b" type="button" data-lv-promote="' + esc(p.slug) + '">' + esc(t("lib_promote")) + '</button>'+
      // BUG-2 FIX: a Delete action (two-tap confirm) removes ONLY this one console_pages row, so a mistaken or
      // stale template is not stuck forever. It never touches an opp/card or any ledger row.
      '<button class="act lv-del-b" type="button" data-lv-del="' + esc(p.slug) + '">' + esc(t("lib_delete")) + '</button>'+
      // No re-activate button: a template publishes and verifies on upload (upCommitLibrary + libVerifyBackground),
      // and a not-yet-live row self-heals in the background - the state chip reads confirming/live, never a prompt.
    '</div>'+
    '<div class="lv-prev" id="lvPrev-' + esc(p.slug) + '" hidden></div>'+
    '<div class="lv-mem" id="lvMem-' + esc(p.slug) + '" hidden></div>'+
    '<div class="lv-prom" id="lvProm-' + esc(p.slug) + '" hidden></div>'+
    '<div class="lv-del" id="lvDel-' + esc(p.slug) + '" hidden></div>'+
  '</div>';
}
function libViewWireCards(){
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-copy]"), function(b){ b.addEventListener("click", function(){ libCopyLink(b.getAttribute("data-lv-copy")); }); });
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-open]"), function(b){ b.addEventListener("click", function(){ libOpenPage(b.getAttribute("data-lv-open")); }); });
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-prev]"), function(b){ b.addEventListener("click", function(){ libPreviewToggle(b.getAttribute("data-lv-prev"), b); }); });
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-mem]"), function(b){ b.addEventListener("click", function(){ libMemToggle(b.getAttribute("data-lv-mem"), b); }); });   // Phase 3 template memory
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-promote]"), function(b){ b.addEventListener("click", function(){ libPromoteToggle(b.getAttribute("data-lv-promote"), b); }); });
  [].forEach.call(document.querySelectorAll("#lvBody [data-lv-del]"), function(b){ b.addEventListener("click", function(){ libDeleteToggle(b.getAttribute("data-lv-del"), b); }); });
}
// BUG-2: a two-tap delete for one Library page. First tap opens an inline confirm (Delete / Cancel); the confirm
// deletes ONLY this console_pages row (restDelete, the same bounded DELETE the card delete uses - the DB grant in
// docs/supabase-opp-delete.sql permits it), then drops the row from the cached list and re-renders. No opp/card,
// no ledger row, and no other page is ever touched. A failed delete shows a red status and changes nothing.
function libDeleteToggle(slug, btn){
  var box = document.getElementById("lvDel-" + slug); if(!box) return;
  if(!box.hidden){ box.hidden = true; box.innerHTML = ""; if(btn) btn.classList.remove("on"); return; }
  box.hidden = false; if(btn) btn.classList.add("on");
  box.innerHTML = '<div class="lv-del-warn">' + esc(t("lib_del_confirm")) + '</div>'+
    '<div class="acts"><button class="act lv-del-go" type="button">' + esc(t("lib_delete")) + '</button>'+
    '<button class="act lv-del-x" type="button">' + esc(t("lib_del_cancel")) + '</button></div>'+
    '<div class="act-status" id="lvDelStatus-' + esc(slug) + '" role="status" aria-live="polite"></div>';
  var go = box.querySelector(".lv-del-go"); if(go) go.addEventListener("click", function(){ libDoDelete(slug); });
  var cx = box.querySelector(".lv-del-x"); if(cx) cx.addEventListener("click", function(){ libDeleteToggle(slug, btn); });
}
function libDoDelete(slug){
  var st = document.getElementById("lvDelStatus-" + slug);
  if(st){ st.className = "act-status"; st.textContent = t("lib_deleting"); }
  return restDelete("console_pages?slug=eq." + encodeURIComponent(slug)).then(function(){
    __libPages = (__libPages || []).filter(function(p){ return !(p && p.slug === slug); });   // optimistic: drop it from the list
    if(__libExisting) delete __libExisting[slug];
    libRenderList();
  }, function(e){
    if(st){ st.className = "act-status bad"; st.textContent = (e && e.authRequired) ? t("err") : t("lib_del_failed"); }
  });
}
// (libRepair removed: a Library template publishes and verifies on upload, so there is no manual repair button.)
// On-demand preview: read the committed html back from console_pages (pageReadHtml) into a sandboxed iframe,
// the same isolation the editor preview uses. Toggling again closes it (and frees the frame).
function libPreviewToggle(slug, btn){
  var box = document.getElementById("lvPrev-" + slug); if(!box) return;
  if(!box.hidden){ box.hidden = true; box.innerHTML = ""; if(btn) btn.classList.remove("on"); return; }
  box.hidden = false; if(btn) btn.classList.add("on");
  box.innerHTML = '<div class="muted" style="padding:8px 2px">' + esc(t("up_reading")) + '</div>';
  pageReadHtml(slug).then(function(html){
    box.innerHTML = '<iframe class="lv-frame" title="' + esc(t("lib_preview")) + '" sandbox="" referrerpolicy="no-referrer" srcdoc="' + esc(String(html||"")) + '"></iframe>';
  }, function(){ box.innerHTML = '<div class="act-status bad">' + esc(t("up_read_failed")) + '</div>'; });
}

// ===================================================================================================
// PROMOTE TO OPERATIONS (PR-L6) - from a live Library template, attach a recipient (individual or group) to
// mint a live Operations card. The template's page is already live (console_pages row), so promote is exactly
// the act of minting the console_opps anchor with the SAME slug: the board view is anchored from console_opps
// and left-joined to console_pages by slug (docs/supabase-board-view.sql:242,203,247), so a page with no opp
// is not a card until promoted. With a page row present and zero sends the card is born stage 'live'
// (docs/supabase-board-view.sql:208,232-236) and the drawer opens the compose surface (editorHtml) for the
// message to be written and then sent. CRITICAL: promote NEVER sets data.source, so sendMode stays 'personal'
// (board-send.src.js:189) - a promoted 1:1 sends in the clean personal shape, never the campaign/bulk shape.
// This is a promote surface only; runSend / sendMode / upSendLiveGate are untouched.
// ===================================================================================================
function libPageBySlug(slug){
  var ps = __libPages || [];
  for(var i=0;i<ps.length;i++){ if(ps[i] && ps[i].slug === slug) return ps[i]; }
  return null;
}
// The template's card label: the title (from #272) if present, else a prettified slug - the exact rule
// libCardHtml uses, so the Operations card business matches the Library title the operator sees.
function libPromoteTitle(slug){
  var p = libPageBySlug(slug) || {};
  return (p.title && String(p.title).trim()) || upPretty(slug);
}
// Idempotency check REMOVED (PR-A0): promote no longer keys the opp on the template slug, so there is nothing to
// collide with. A template is a reusable asset - each promote mints its OWN unique opp slug (libShortId below),
// so one template fans out to many recipients as many independent cards. (libOppExists had only this one caller.)
// A short, url-safe id for a per-promote opp slug - mirrors nmNewSlug's Date.now()/Math.random() base36 recipe.
function libShortId(){
  var tp=""; try{ tp=Date.now().toString(36).slice(-4); }catch(e){ tp="0"; }
  var rr=""; try{ rr=Math.random().toString(36).slice(2,6); }catch(e){ rr="x"; }
  return tp + rr;
}
function libPromStatus(slug, msg, cls){
  var el = document.getElementById("lvPromSt-" + slug);
  if(el){ el.className = "act-status lv-prom-st" + (cls ? (" " + cls) : ""); el.textContent = msg || ""; }
}
// The inline promote form: one recipient field (single email, or several comma / newline separated for a
// group), a confirm button, and a status line. Reuses the SAME parser the compose recipient field uses.
function libPromoteFormHtml(slug){
  return '<textarea class="lv-prom-in mono-iso" id="lvPromIn-' + esc(slug) + '" rows="1" dir="ltr" '+
      'autocomplete="off" spellcheck="false" placeholder="' + esc(t("lib_prom_ph")) + '" '+
      'aria-label="' + esc(t("lib_prom_ph")) + '"></textarea>'+
    '<div class="lv-prom-acts"><button class="act send" type="button" data-lv-prom-go="' + esc(slug) + '">' + esc(t("lib_prom_go")) + '</button></div>'+
    '<div class="act-status lv-prom-st" id="lvPromSt-' + esc(slug) + '"></div>';
}
function libPromoteToggle(slug, btn){
  var box = document.getElementById("lvProm-" + slug); if(!box) return;
  if(!box.hidden){ box.hidden = true; box.innerHTML = ""; if(btn) btn.classList.remove("on"); return; }
  box.hidden = false; if(btn) btn.classList.add("on");
  box.innerHTML = libPromoteFormHtml(slug);
  var go = box.querySelector('[data-lv-prom-go]');
  if(go) go.addEventListener("click", function(){ libPromoteConfirm(slug); });
  var inp = document.getElementById("lvPromIn-" + slug);
  if(inp){ try{ inp.focus(); }catch(e){} }
}
// Confirm: parse recipient(s), then mint a UNIQUE opp for THIS promote (PR-A0) and attach the recipients, then
// reload the board so the promoted card is live. The `slug` argument is the TEMPLATE slug (the surface card id +
// the shared page); the opp minted is `<templateSlug>-<shortId>`, so a template promotes to many recipients as
// many independent cards. published:true makes the card stage 'live' via the view (has_page = published OR page
// row, board-view.sql:208) WITHOUT minting a new console_pages row; data.page_slug points every card at the ONE
// shared template page (liveUrl(data.page_slug||slug), board-send.src.js). NO data.source -> clean personal
// shape. Optimistic confirm-or-revert: green on a confirmed write, red on failure. Returns the promise so a test
// hook can await it (it resolves to the minted opp slug, or false on a no-op/failure).
function libPromoteConfirm(slug){
  var inp = document.getElementById("lvPromIn-" + slug);
  var raw = inp ? String(inp.value || "") : "";
  var list = parseAddrs(raw).filter(isEmail).map(function(a){ return { addr:a, name:"", lang:"" }; });   // one = individual, many = group
  if(!list.length){ libPromStatus(slug, t("lib_prom_need"), "bad"); return Promise.resolve(false); }
  if(__libPromoting) return Promise.resolve(false);
  __libPromoting = true;
  var go = document.querySelector('[data-lv-prom-go="' + slug + '"]'); if(go) go.disabled = true;
  libPromStatus(slug, t("lib_prom_saving"), "");
  var title = libPromoteTitle(slug);
  var oppSlug = slug + "-" + libShortId();                                                   // this promote's OWN card identity
  return oppUpsert(oppSlug, { business: title, published: true, up: Date.now(), data: { recipients: [], page_slug: slug } })
    .then(function(){ return saveRecipients(oppSlug, list); })                               // attach recipient(s), read-back confirmed
    .then(function(){ return reloadBoardData(); })                                           // the promoted card is now a board row
    .then(function(){ __libPromoting = false; if(go) go.disabled = false; libPromStatus(slug, t("lib_prom_done"), "ok"); return oppSlug; })
    .catch(function(e){
      __libPromoting = false; if(go) go.disabled = false;
      libPromStatus(slug, (e && e.authRequired) ? t("err") : t("lib_prom_failed"), "bad");
      return false;
    });
}

// ===================================================================================================
// G3: the window's Mode B ("message with campaign") PAGE tab - the ONE unified upload/library engine.
// Three ENTRY MODES (Upload / Pick from Library / Duplicate) feed the SAME review component (libRowHtml:
// pageFrameIframe render + editable title/slug/task + libCollectRows validation). NOTHING branches except the
// COMMIT, which is the campaign shape (card + B2-stripped recipients + cycle + page). Reuses upBuildPlan,
// libRowHtml, libCollectRows, libFetchPages, libMatches, pageReadHtml, pageFrameIframe, and the upCommit-shape
// primitives (oppUpsert/pageUpsert/pagePublishRelay/upActivateBackground) - no new copies, no forked commit.
var __owCommitting = false;
// G7: which of the three Page-tab paths the operator chose on this Mode B entry: "campaign" (a full multi-page
// zip -> N cards via upCommit), "page" (one uploaded page + a hand-written message -> this opp), or "pick"
// (a Library template copied onto this opp). null until a path is chosen. It routes both the entry UI (which
// input is revealed) and the commit (owCommitCampaign delegates the campaign path to owCommitCampaignAll).
var __owPagePath = null;
function owPageStatus(msg, cls){ var el=document.getElementById("owPageStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }
function owCommitStatus(msg, cls){ var el=document.getElementById("owCommitStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }
// Load the existing-slug set for validation, EXCLUDING this opp's own slug (re-publishing the opp's own page is
// not a conflict). libDistinctTasks feeds the task datalist. Best-effort; a failed read leaves an empty set.
function owPageLoadExisting(){
  return libFetchPages().then(function(pages){
    __libPages = pages || [];
    __libExisting = {}; (pages||[]).forEach(function(p){ if(p && p.slug && p.slug!==__owSlug) __libExisting[p.slug]=1; });
    return pages || [];
  }, function(){ __libExisting = __libExisting || {}; return []; });
}
// Mount a single row into the SAME review component the Library upload uses (libRowHtml), then wire its slug
// input to libCollectRows exactly as libOnFile does. The row is held on __upPlan (one place, one review).
function owPageSetReview(row){
  row.slug = row.slug || __owSlug; row.warnings = row.warnings || []; if(row.included==null) row.included = true;
  __upPlan = { rows:[row] };
  if(__owPickAwaiting){ __owPickAwaiting = false; owRevealPickEditor(); }   // FIX B: a template was picked -> reveal the editor + review + commit (scoped to the pick entry)
  owReviewRender();                     // the SAME accordion the multi-page upload uses (one section here)
}
// Entry mode 1: UPLOAD a new page/template (the SHARED upBuildPlan parse). First page row becomes the review.
function owPageOnFile(files){
  if(!files || !files.length) return;
  owPageStatus(t("up_reading"), "");
  Promise.all([ upBuildPlan(files), owPageLoadExisting() ]).then(function(a){
    var plan=a[0], rows=(plan&&plan.rows)||[];
    var pageRow=null; for(var i=0;i<rows.length;i++){ if(rows[i] && rows[i].page && rows[i].page.html){ pageRow=rows[i]; break; } }
    if(!pageRow){ owPageStatus(t("up_no_html"), "bad"); return; }
    owPageSetReview({ slug:__owSlug, title:pageRow.title||"", task:pageRow.task||"", page:pageRow.page });
  }, function(e){ owPageStatus((e&&e.message==="not_a_zip")?t("up_not_zip"):t("up_read_failed"), "bad"); });
}
// Entry modes 2 + 3: PICK an existing page (its html copied to THIS campaign at the opp slug) or DUPLICATE it
// (same html, a fresh slug the operator names). Both read the stored html via pageReadHtml -> the SAME review.
function owPagePickList(){
  var box=document.getElementById("owPickList"); if(!box) return;
  owPageLoadExisting().then(function(pages){
    var q=(document.getElementById("owPickSearch")||{}).value; q=String(q||"").trim().toLowerCase();
    var list=(pages||[]).filter(function(p){ return libMatches(p, q); });
    if(!list.length){ box.innerHTML='<div class="lv-empty">'+esc(q?t("lib_no_match"):t("lib_empty"))+'</div>'; return; }
    box.innerHTML = list.map(function(p){
      var title=(p.title&&String(p.title).trim())||upPretty(p.slug);
      return '<div class="ow-pick-row"><div class="ow-pick-meta"><span class="ow-pick-t">'+esc(title)+'</span>'+
        '<span class="ow-pick-s mono-iso" dir="ltr">'+esc(p.slug)+'</span></div>'+
        '<div class="acts"><button class="act" type="button" data-ow-pick="'+esc(p.slug)+'">'+esc(t("ow_use"))+'</button>'+
        '<button class="act" type="button" data-ow-dup="'+esc(p.slug)+'">'+esc(t("ow_duplicate"))+'</button></div></div>';
    }).join("");
    [].forEach.call(box.querySelectorAll("[data-ow-pick]"), function(b){ b.addEventListener("click", function(){ owPagePick(b.getAttribute("data-ow-pick"), false); }); });
    [].forEach.call(box.querySelectorAll("[data-ow-dup]"), function(b){ b.addEventListener("click", function(){ owPagePick(b.getAttribute("data-ow-dup"), true); }); });
  });
}
function owPagePick(slug, duplicate){
  var p=libPageBySlug(slug)||{ slug:slug };
  var title=(p.title&&String(p.title).trim())||upPretty(slug);
  owPageStatus(t("up_reading"), "");
  pageReadHtml(slug).then(function(html){
    owPageStatus("", "");
    // pick -> publish a copy at THIS opp's slug; duplicate -> a fresh slug the operator names (blank to force a choice)
    owPageSetReview({ slug: duplicate ? "" : __owSlug, title:title, task:(p.task||""), page:{ html:String(html||"") } });
  }, function(){ owPageStatus(t("up_read_failed"), "bad"); });
}
// One path button: reuses the mode-selector's .ow-mode-btn look (a titled block with a one-line subtitle), so the
// three campaign paths read exactly like the two send modes - organized, not a wall of controls.
function owPathBtnHtml(path, tkey, subkey){
  var id = "owPath" + path.charAt(0).toUpperCase() + path.slice(1);
  return '<button class="ow-mode-btn ow-path-btn" id="'+id+'" type="button">'+esc(t(tkey))+
    '<span class="ow-mode-sub">'+esc(t(subkey))+'</span></button>';
}
// Choose one of the three paths: highlight it, reveal ITS input (hide the others), and RESET the held plan +
// review so a switch never carries a stale plan into the wrong commit. The Library list loads lazily on pick.
function owSelectPath(path){
  __owPagePath = path; __upPlan = null;
  [["upload","owPathUpload","owBodyUpload"],["pick","owPathPick","owBodyPick"]].forEach(function(x){
    var btn=document.getElementById(x[1]); if(btn) btn.classList.toggle("on", x[0]===path);
    var body=document.getElementById(x[2]); if(body) body.hidden = (x[0]!==path);
  });
  var rev=document.getElementById("owPageReview"); if(rev) rev.innerHTML="";
  owPageStatus("", "");
  if(path==="pick") owPagePickList();
}
// The unified UPLOAD parse (a single page OR a multi-page zip). Keep the WHOLE plan (every page row), exactly as
// the standalone upOnFile does. A SINGLE page defaults its slug to THIS opp's slug (mirroring the old one-page
// path, so the page publishes at the opp's own link); a multi-page zip keeps each page's own derived slug and
// mints its own card. The slug stays editable in the review either way. Commit routes by row count.
function owCampaignOnFile(files){
  if(!files || !files.length) return;
  owPageStatus(t("up_reading"), "");
  Promise.all([ upBuildPlan(files), owPageLoadExisting() ]).then(function(a){
    var plan=a[0], rows=(plan&&plan.rows)||[];
    if(!rows.length){ owPageStatus(t("up_no_html"), "bad"); return; }
    if(rows.length === 1 && __owSlug){ rows[0].slug = __owSlug; }        // a single page -> the opp's own slug (old one-page behavior)
    rows.forEach(function(r){ if(r.included==null) r.included = true; }); // per-item include/exclude: default all included
    __upPlan = plan;                                                    // the WHOLE plan (all pages), never rows[0]
    owReviewRender();
  }, function(e){ owPageStatus((e&&e.message==="not_a_zip")?t("up_not_zip"):t("up_read_failed"), "bad"); });
}
// Append more files to the held plan without dropping the rows already reviewed (the "add more" control). Every
// appended page row defaults to included; the review re-renders with the combined set.
function owCampaignAddFiles(files){
  if(!files || !files.length) return;
  owPageStatus(t("up_reading"), "");
  upBuildPlan(files).then(function(plan){
    var add=(plan&&plan.rows)||[];
    if(!add.length){ owPageStatus(t("up_no_html"), "bad"); return; }
    if(!__upPlan || !__upPlan.rows) __upPlan = { rows:[] };
    add.forEach(function(r){ if(r.included==null) r.included = true; __upPlan.rows.push(r); });
    owReviewRender();
  }, function(e){ owPageStatus((e&&e.message==="not_a_zip")?t("up_not_zip"):t("up_read_failed"), "bad"); });
}
// The matched recipient + subject line for one campaign row (read-only), above its editable fields + page preview.
function owCampMetaHtml(r){
  return '<div class="up-meta"><span class="up-k">'+esc(t("up_col_email"))+':</span> '+
    '<bdi class="mono-iso">'+esc(r.email||t("none"))+'</bdi> '+
    '<span class="up-k">'+esc(t("up_col_subject"))+':</span> '+esc(r.subject||t("none"))+' '+
    upWarnChips(r.warnings||[])+'</div>';
}
function owRowIncluded(r){ return !r || r.included!==false; }
function owReviewIncluded(){ return ((__upPlan&&__upPlan.rows)||[]).filter(owRowIncluded); }
// The review: a LIGHT accordion, one collapsible section per page/row. Each section carries its per-row
// include/exclude toggle, a remove, the matched recipient/subject (its message) and the existing srcdoc
// preview + editable title/slug/task (libRowHtml). One shared renderer for 1..N rows (single page, picked
// template, or a multi-page zip), plus an "add more" control. Nothing here writes; the plan is held for review.
function owReviewRender(){
  var box=document.getElementById("owPageReview"); if(!box) return;
  var rows=(__upPlan&&__upPlan.rows)||[];
  if(!rows.length){ box.innerHTML=""; owPageStatus("", ""); return; }
  var incN = rows.filter(owRowIncluded).length;
  var html = libTasksDatalist(libDistinctTasks(__libPages||[]));
  html += '<div class="up-count" id="owReviewCount">'+esc(t("up_matched"))+' '+incN+'</div>';
  rows.forEach(function(r, i){
    var inc = owRowIncluded(r);
    var title=(r.title&&String(r.title).trim())||upPretty(r.slug||("page-"+(i+1)));
    var meta=(r.email||r.subject) ? owCampMetaHtml(r) : "";
    html += '<div class="ow-acc'+(inc?"":" ow-acc-out")+'" data-acc="'+i+'">'+
        '<div class="ow-acc-sum">'+
          '<label class="ow-acc-inc"><input type="checkbox" data-row-inc="'+i+'"'+(inc?" checked":"")+'> <span>'+esc(t("ow_row_include"))+'</span></label>'+
          '<button type="button" class="ow-acc-toggle" data-acc-toggle="'+i+'" aria-expanded="true"><span class="ow-acc-t" dir="auto">'+esc(title)+'</span></button>'+
          '<button type="button" class="ow-acc-rm" data-row-remove="'+i+'">'+esc(t("ow_row_remove"))+'</button>'+
        '</div>'+
        '<div class="ow-acc-body" id="owAccBody-'+i+'">'+meta+libRowHtml(r, i)+'</div>'+
      '</div>';
  });
  html += '<div class="ow-add-more-wrap"><label class="act ow-add-more">'+esc(t("ow_add_more"))+'<input type="file" id="owAddFile" accept=".zip,.html,.htm" hidden></label></div>';
  box.innerHTML = html;
  try{ libCollectRows(); }catch(e){}
  rows.forEach(function(r, i){
    ["libSlug-","libTitle-","libTask-"].forEach(function(pre){
      var el=document.getElementById(pre+i); if(el) el.addEventListener("input", function(){ try{ libCollectRows(); }catch(e){} });
    });
    var inc=box.querySelector('[data-row-inc="'+i+'"]'); if(inc) inc.addEventListener("change", function(){ owRowSetIncluded(i, inc.checked); });
    var rm=box.querySelector('[data-row-remove="'+i+'"]'); if(rm) rm.addEventListener("click", function(){ owRowRemove(i); });
    var tg=box.querySelector('[data-acc-toggle="'+i+'"]'); if(tg) tg.addEventListener("click", function(){ owAccToggle(i); });
  });
  var af=document.getElementById("owAddFile"); if(af) af.addEventListener("change", function(){ owCampaignAddFiles(af.files); });
  owPageStatus("", "");
}
function owAccToggle(i){
  var body=document.getElementById("owAccBody-"+i); var tg=document.querySelector('[data-acc-toggle="'+i+'"]');
  if(!body) return; var open=body.hasAttribute("hidden");
  if(open){ body.removeAttribute("hidden"); if(tg) tg.setAttribute("aria-expanded","true"); }
  else { body.setAttribute("hidden",""); if(tg) tg.setAttribute("aria-expanded","false"); }
}
function owRowSetIncluded(i, on){
  var rows=(__upPlan&&__upPlan.rows)||[]; if(!rows[i]) return;
  rows[i].included = !!on;
  var acc=document.querySelector('[data-acc="'+i+'"]'); if(acc) acc.classList.toggle("ow-acc-out", !on);
  var cnt=document.getElementById("owReviewCount"); if(cnt) cnt.textContent = t("up_matched")+" "+owReviewIncluded().length;
  try{ libCollectRows(); }catch(e){}   // re-validate: an excluded row no longer blocks the commit
}
function owRowRemove(i){
  var rows=(__upPlan&&__upPlan.rows)||[]; if(i<0 || i>=rows.length) return;
  rows.splice(i, 1);
  owReviewRender();                     // re-render with re-indexed rows (a removed file is gone from the plan)
}
// Mount the Page tab: the THREE labelled paths, the input each reveals, the shared review, the status line.
// owModeBMount calls this. A fresh mount starts with no path chosen (__owPagePath null): the operator picks.
function owPageMount(slug){
  var host=document.getElementById("owPagePanel"); if(!host) return;
  __owPagePath = null;
  // TWO paths now (Thyab's request surfaces them at the FIRST screen): ONE unified upload that accepts a single
  // page OR a full multi-page zip (upBuildPlan folder-pairs both; the review renders 1..N rows), and Pick from the
  // Library. The old separate "campaign" (zip-only) and "page" (single) paths are merged into "upload".
  host.innerHTML =
    '<div class="ow-page-paths">'+
      owPathBtnHtml("upload", "ow_path_upload", "ow_path_upload_sub")+
      owPathBtnHtml("pick", "ow_path_pick", "ow_path_pick_sub")+
    '</div>'+
    '<div class="ow-path-body" id="owBodyUpload" hidden>'+
      '<label class="act ow-up-btn">'+esc(t("ow_campaign_upload"))+'<input type="file" id="owUploadFile" accept=".zip,.html,.htm" hidden></label>'+
    '</div>'+
    '<div class="ow-path-body" id="owBodyPick" hidden>'+
      '<div class="ow-pick" id="owPick">'+
        '<input class="lib-in" id="owPickSearch" type="text" placeholder="'+esc(t("lib_search_ph"))+'" autocomplete="off">'+
        '<div class="ow-pick-list" id="owPickList"></div>'+
      '</div>'+
    '</div>'+
    '<div class="up-rows" id="owPageReview"></div>'+
    '<div class="act-status" id="owPageStatus" role="status" aria-live="polite"></div>';
  var pu=document.getElementById("owPathUpload"); if(pu) pu.addEventListener("click", function(){ owSelectPath("upload"); });
  var pk=document.getElementById("owPathPick");   if(pk) pk.addEventListener("click", function(){ owSelectPath("pick"); });
  var uf=document.getElementById("owUploadFile"); if(uf) uf.addEventListener("change", function(){ owCampaignOnFile(uf.files); });   // single OR multi-page: upBuildPlan handles both
  var q=document.getElementById("owPickSearch");  if(q) q.addEventListener("input", function(){ owPagePickList(); });
  owPageLoadExisting();
}

// ===================================================================================================
// DIRECT NEW-MESSAGE ENTRY (no Mode B tab shell, no duplicate path buttons). Each first-screen button lands
// straight on its destination. The surface carries the SAME element ids the review + commit reuse (owMsgPanel
// for the shared message, owPageReview / owPageStatus / owCommit / owCommitStatus), so nothing forks: the
// upload parse, the accordion review, the commit routing and every send invariant are the existing ones.
// ===================================================================================================
function owDirectHostHtml(kind){
  var pick = (kind==="pick");
  var src = pick
    ? '<div class="ow-pick" id="owPick">'+
        '<input class="lib-in" id="owPickSearch" type="text" placeholder="'+esc(t("lib_search_ph"))+'" autocomplete="off">'+
        '<div class="ow-pick-list" id="owPickList"></div>'+
      '</div>'
    : '<div class="ow-path-body" id="owBodyUpload">'+
        '<label class="act ow-up-btn">'+esc(t("ow_campaign_upload"))+'<input type="file" id="owUploadFile" accept=".zip,.html,.htm" hidden></label>'+
      '</div>';
  // FIX B: in PICK mode the editor + review + commit start HIDDEN, so only the Library list shows until a
  // template is chosen (Use/Duplicate); the pick reveals them. Upload mode shows the compose up front as before.
  var h = pick ? " hidden" : "";
  return '<div class="ow-mode ow-direct" id="owDirect">'+
      '<div class="ow-direct-src" id="owPagePanel">'+src+'</div>'+       // the source: upload input OR the Library picker
      '<div class="up-rows" id="owPageReview"'+h+'></div>'+               // the accordion review (per-row preview + include/exclude)
      '<div class="ow-panel ow-direct-msg" id="owMsgPanel"'+h+'></div>'+  // the shared message (single page / picked template)
      '<div class="act-status" id="owPageStatus" role="status" aria-live="polite"></div>'+
      '<div class="ow-foot" id="owDirectFoot"'+h+'><button class="act send" id="owCommit" type="button">'+iconText("check", t("ow_commit"))+'</button>'+
        '<div class="act-status" id="owCommitStatus" role="status" aria-live="polite"></div></div>'+
    '</div>';
}
// FIX B: reveal the editor + review + commit AFTER a template is picked in the new-message pick entry (only).
var __owPickAwaiting = false;
function owRevealPickEditor(){
  ["owPageReview","owMsgPanel","owDirectFoot"].forEach(function(id){ var el=document.getElementById(id); if(el) el.removeAttribute("hidden"); });
  try{ if(typeof owMsgMount==="function" && document.getElementById("owMsgPanel")) owMsgMount(__owSlug); }catch(e){}   // mount the compose now, not before a pick
  try{ if(typeof owRefreshTitle==="function") owRefreshTitle(); }catch(e){}
}
function owUploadEntryMount(slug){
  try{ if(typeof owMsgMount==="function") owMsgMount(slug); }catch(e){}    // shared compose fields (subject/body/signature/recipient)
  __owPagePath="upload"; __upPlan=null;
  var uf=document.getElementById("owUploadFile"); if(uf) uf.addEventListener("change", function(){ owCampaignOnFile(uf.files); });
  var cb=document.getElementById("owCommit"); if(cb) cb.addEventListener("click", function(){ if(typeof owCommitCampaign==="function") owCommitCampaign(slug); });
  owPageLoadExisting();
  try{ if(uf) uf.click(); }catch(e){}                                     // open the OS file picker IMMEDIATELY (still inside the button-click gesture)
}
function owPickEntryMount(slug){
  // FIX B: the compose editor is NOT mounted yet; only the Library search + list show. A pick reveals the rest.
  __owPickAwaiting = true; __owPagePath="pick"; __upPlan=null;
  var q=document.getElementById("owPickSearch"); if(q) q.addEventListener("input", function(){ owPagePickList(); });
  var cb=document.getElementById("owCommit"); if(cb) cb.addEventListener("click", function(){ if(typeof owCommitCampaign==="function") owCommitCampaign(slug); });
  owPagePickList();                                                       // owPagePickList loads the existing pages itself
}
// The ONE primary action: COMMIT the campaign. Reuses the upCommit-shape primitives (oppUpsert + pageUpsert +
// pagePublishRelay + upActivateBackground) in the same order, but MERGES the campaign fields into the opp's
// EXISTING data so the interactive compose (subject/body/signature) and any notes are preserved (upCommit's
// own data-replace is right for a fresh zip row, but would clobber an interactively-composed opp). B2 strips
// suppressed recipients here, exactly like upCommit. {{ASSET_BASE}} resolved. F1 publish-truth via
// upActivateBackground. Single recipient is fine at G3; rich multi-recipient management is G4.
function owCommitCampaign(slug){
  // Route by ROW COUNT, not by path name: a multi-page upload (N>1 rows, each folder-paired to its own message)
  // iterates into N cards with those paired messages; a single page or a picked template (1 row) takes the
  // interactively-written Message-tab message into ONE card. Both come from the one unified upload/pick surface.
  var inc=owReviewIncluded();                                          // per-item include/exclude: route by INCLUDED count
  if(!inc.length){ owCommitStatus(t("ow_none_included"), "bad"); return Promise.resolve(false); }   // guard: no empty publish
  if(inc.length > 1) return owCommitCampaignAll(slug);                 // multi-page: paired messages, N cards
  if(__owCommitting) return Promise.resolve(false);
  var subj=edVal("edSubj"), body=edVal("edBody");
  if(!(subj.trim() && body.trim())){ owCommitStatus(t("nm_need_msg"), "bad"); return Promise.resolve(false); }
  var pr=inc[0];
  if(!pr || !(pr.page && String(pr.page.html).trim())){ owCommitStatus(t("ow_need_page"), "bad"); return Promise.resolve(false); }
  var v=libCollectRows(true); if(!v.ok){ owCommitStatus(t("lib_fix_rows"), "bad"); return Promise.resolve(false); }   // format/dup/exists validation gate
  __owCommitting=true; owCommitStatus(t("up_writing"), "");
  var pageSlug=pr.slug||slug, html=assetBaseInto(pr.page.html), cycle=upNewCycle(), sig=edSignature();
  var kept=sendToList().filter(function(r){ return !isSuppressed(r.addr); });   // B2 strip at commit
  return oppReadData(slug).then(function(data){
    var next=Object.assign({}, data, { source:"upload", page_title:pr.title||pageSlug,
      outreach_subject:subj, outreach_text:body, sig:sig, recipients:kept });
    if(pageSlug!==slug) next.page_slug=pageSlug;                                 // a renamed page: the card references it by page_slug
    return oppUpsert(slug, { business:pr.title||slug, data:next, up:Date.now(), cycle:cycle })
      .then(function(){ return pageUpsert(pageSlug, html, { title:pr.title, task:pr.task }); })
      .then(function(){ return pagePublishRelay(pageSlug, withBeaconClient(html, cycle)); });
  }).then(function(){
    try{ upActivateBackground([pageSlug]); }catch(e){}                            // F1 publish-truth (never a false RED)
    return reloadBoardData().then(function(){},function(){});
  }).then(function(){
    __owCommitting=false; owCommitStatus(t("ow_committed"), "ok"); return true;
  }, function(e){
    __owCommitting=false; owCommitStatus((e&&e.authRequired)?t("err"):t("up_write_failed"), "bad"); return false;
  });
}
// G7 path 1 (FULL CAMPAIGN): commit EVERY row of the held plan - one card + its recipients + its page per row -
// by delegating to upCommit, the SAME multi-row commit the standalone upload path uses (oppUpsert + pageUpsert +
// pagePublishRelay per row, B2 stripping the suppressed recipient at upCommit:347, {{ASSET_BASE}} resolved at
// upCommit:351, F1 publish-truth via the returned published[] -> upActivateBackground). No forked commit; this is
// the exact fix for "a full campaign showed one page". libCollectRows is the shared per-row validation gate (slug
// format / dup / already-exists) and writes the edited slug/title/task back onto the plan rows before the commit.
function owCommitCampaignAll(slug){
  if(__owCommitting) return Promise.resolve(false);
  var rows=owReviewIncluded();                                          // per-item include/exclude: commit ONLY the included rows
  if(!rows.length){ owCommitStatus(t("ow_none_included"), "bad"); return Promise.resolve(false); }   // guard: no empty publish
  var v=libCollectRows(true); if(!v.ok){ owCommitStatus(t("lib_fix_rows"), "bad"); return Promise.resolve(false); }
  __owCommitting=true; owCommitStatus(t("up_writing"), "");
  return upCommit({ rows:rows }).then(function(res){
    try{ upActivateBackground(res.published); }catch(e){}                          // F1 publish-truth, per page
    return reloadBoardData().then(function(){ return res; }, function(){ return res; });
  }).then(function(res){
    __owCommitting=false;
    if(res.fail){                                                                   // name the failed rows, keep the panel
      var names=(res.failed||[]).join(", ");
      owCommitStatus(t("up_done_partial").replace("{k}", String(res.ok||0)).replace("{n}", String((res.ok||0)+res.fail))+" "+names, (res.ok?"warn":"bad"));
      return (res.ok||0)>0;
    }
    owCommitStatus(t("ow_committed_n").replace("{n}", String(res.ok||0)), "ok");
    return true;
  }, function(e){
    __owCommitting=false; owCommitStatus((e&&e.authRequired)?t("err"):t("up_write_failed"), "bad"); return false;
  });
}

// ===================================================================================================
// G4: the window's Mode B RECIPIENTS tab - the opp's recipient list, each with ONE derived status.
// READ-ONLY. No relay, no schema, no write. It REUSES the board's existing ledger reads (restGet /
// fetchInbound / oppReadData / ensureSuppress+isSuppressed) and MIRRORS the app engine's per-recipient
// derivation (library/app.js recipientState + campaignStats P2), so the window and the app agree:
//   - sent/queued  : console_mail rows for this opp, keyed by to_addr (status buckets per the board view:
//                    ''/sent/copied/pending = a dispatched send; queued/held/sending = still in flight);
//   - opened       : the P2 token join console_hits.data.r -> console_mail.id -> to_addr (a hit with no
//                    token stays anonymous, never guessed onto a person);
//   - replied      : a console_inbound reply (kind != auto) whose data.from matches the address;
//   - bounced       : a console_inbound auto+bounce row whose text names the address (hard vs soft from
//                    the bounce value); an unattributable bounce is never pinned onto a recipient;
//   - suppressed   : the B2 do-not-contact set (isSuppressed) - shown distinctly; B2 still refuses it at send.
// Precedence (one clear status): suppressed > hard-bounced > soft-bounced > replied > opened > sent > queued > none.
var OW_RS_KEY = { suppressed:"ow_rs_suppressed", bounced_hard:"ow_rs_bounced_hard", bounced_soft:"ow_rs_bounced_soft",
  replied:"ow_rs_replied", opened:"ow_rs_opened", sent:"ow_rs_sent", queued:"ow_rs_queued", none:"ow_rs_none" };
// Build the join structures ONCE from the three ledgers (mail/hits/inbound), then classify each address against them.
function owRecipContext(mail, inbound, hits){
  var tokTo = {}, sentSet = {}, queuedSet = {};
  (mail || []).forEach(function(m){ m = m || {}; var d = m.data || {};
    if(d.direction === "in") return;                                      // an inbound-mirrored row is not a send
    var addr = String(m.to_addr || d.to || "").trim().toLowerCase(); if(!addr) return;
    var id = m.id || d.mid; if(id) tokTo[id] = addr;                      // P2: the mail row id is the open token
    var st = String(m.status || "").toLowerCase();
    if(st === "" || st === "sent" || st === "copied" || st === "pending") sentSet[addr] = 1;   // dispatched (view counts these)
    else if(st === "queued" || st === "held" || st === "sending") queuedSet[addr] = 1;         // committed / in flight
  });
  var openedSet = {};
  (hits || []).forEach(function(h){ h = h || {}; var d = h.data || {};
    if(h.self || d.self) return;                                          // the operator's own visit is excluded
    if((h.type || d.type || "open") !== "open") return;
    var ref = d.r || d.token || d.mid; if(ref && tokTo[ref]) openedSet[tokTo[ref]] = 1;         // token -> to_addr
  });
  var repliedSet = {}, bounces = [];
  (inbound || []).forEach(function(r){ r = r || {}; var d = r.data || {};
    if(r.kind === "auto"){
      if(r.bounce){
        var text = ((d.snippet || "") + " " + (d.subject || "") + " " + (d.body || d.text || "")).toLowerCase();
        bounces.push({ hard: String(r.bounce).toLowerCase().indexOf("hard") >= 0, text: text });
      }
      return;                                                             // an auto row (bounce / vacation) is never a reply
    }
    var from = String(d.from || r.from || "").trim().toLowerCase(); if(from) repliedSet[from] = 1;
  });
  return { sentSet: sentSet, queuedSet: queuedSet, openedSet: openedSet, repliedSet: repliedSet, bounces: bounces };
}
function owRecipStatus(addr, ctx){
  addr = String(addr || "").trim().toLowerCase();
  if(!addr) return "none";
  if(typeof isSuppressed === "function" && isSuppressed(addr)) return "suppressed";   // B2 posture: refused at send regardless
  var hard = false, soft = false;
  (ctx.bounces || []).forEach(function(b){ if(b.text.indexOf(addr) >= 0){ if(b.hard) hard = true; else soft = true; } });
  if(hard) return "bounced_hard";
  if(soft) return "bounced_soft";
  if(ctx.repliedSet[addr]) return "replied";
  if(ctx.openedSet[addr]) return "opened";
  if(ctx.sentSet[addr]) return "sent";
  if(ctx.queuedSet[addr]) return "queued";
  return "none";
}
// Read the opp's recipients + the three ledgers (scoped to this opp / its effective page), then classify each.
function owRecipLoad(slug){
  return oppReadData(slug).then(function(d){ return d || {}; }, function(){ return {}; }).then(function(data){
    var recips = Array.isArray(data.recipients) ? data.recipients : [];
    var pageSlug = data.page_slug || slug;                                // opens live on the effective page (a promoted card shares it)
    return Promise.all([
      restGet("console_mail?opp=eq." + enc(slug) + "&select=id,opp,to_addr,status,ts,data&order=ts.asc"),
      (typeof fetchInbound === "function" ? fetchInbound() : Promise.resolve([])),
      restGet("console_hits?slug=eq." + enc(pageSlug) + "&select=id,slug,ts,self,data&order=ts.asc"),
      (typeof ensureSuppress === "function" ? ensureSuppress().catch(function(){}) : Promise.resolve())
    ]).then(function(a){
      var mail = a[0] || [], inbound = (a[1] || []).filter(function(r){ return r && r.opp === slug; }), hits = a[2] || [];
      var ctx = owRecipContext(mail, inbound, hits);
      return recips.map(function(r){
        return { addr: (r && r.addr) || "", name: (r && r.name) || "", status: owRecipStatus((r && r.addr) || "", ctx) };
      });
    });
  });
}
function owRecipRowHtml(r){
  var name = String(r.name || "").trim(), supp = r.status === "suppressed";
  return '<li class="ow-recip' + (supp ? " supp" : "") + '">' +
      '<div class="ow-recip-who">' +
        (name ? '<span class="ow-recip-name" dir="auto">' + esc(name) + '</span>' : '') +
        '<span class="ow-recip-addr mono-iso" dir="ltr">' + esc(r.addr) + '</span>' +
      '</div>' +
      '<span class="ow-rs ow-rs-' + esc(r.status) + '">' + esc(t(OW_RS_KEY[r.status] || "ow_rs_none")) + '</span>' +
    '</li>';
}
function owRecipMount(slug){
  var host = document.getElementById("owRecipPanel"); if(!host) return;
  host.innerHTML = '<div class="up-empty">' + esc(t("d_loading")) + '</div>';
  owRecipLoad(slug).then(function(rows){
    if(!rows || !rows.length){ host.innerHTML = '<div class="up-empty">' + esc(t("ow_recip_none")) + '</div>'; return; }
    host.innerHTML = '<ul class="ow-recip-list">' + rows.map(owRecipRowHtml).join("") + '</ul>';
  }, function(){ host.innerHTML = '<div class="up-empty">' + esc(t("ow_recip_none")) + '</div>'; });
}

// Read-only hooks for board_upload_test:
try{
  window.__thriveOppRecipients = function(slug){ return owRecipLoad(slug); };              // G4: await the recipient ledger
  window.__thriveOppCommitCampaign = function(slug){ return owCommitCampaign(slug); };   // G3: await the campaign commit
  window.__thriveUploadPlan = function(){ return __upPlan; };
  window.__thriveSetUploadPlan = function(rows){ __upPlan = { rows:(rows||[]).map(function(r){ if(r.included==null) r.included=true; return r; }) }; try{ owReviewRender(); }catch(e){} return __upPlan; };   // test seam: inject a plan + render the accordion (no real zip needed)
  window.__thriveUploadVerify = function(slug){ return verifyLive(slug); };
  window.__thriveLibraryCommit = function(plan){ return upCommitLibrary(plan); };   // PR1: page-only commit + activate
  window.__thriveLibraryDoneHtml = function(results){ return libDoneHtml(results); };
  window.__thriveLibraryPages = function(){ return __libPages; };                   // PR-L1: the surface's fetched rows
  window.__thriveLibraryPromote = function(slug){ return libPromoteConfirm(slug); };// PR-L6: await the promote (reads #lvPromIn-<slug>)
  window.__thriveLibraryDelete = function(slug){ return libDoDelete(slug); };       // BUG-2: await the one-page delete
  window.__thriveLibraryReverify = function(tries, gap){ return libReverifyPending(tries, gap); };   // PR-CF: await a fast re-verify pass
  window.__thriveParseSections = function(text){ return upParseSections(text); };
}catch(e){}
