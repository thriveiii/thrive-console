// ===================================================================================================
// E2 CAMPAIGN UPLOAD - upload a zip from the device (html pages + message texts + emails), match each page
// to its message + recipient + slug, review a match table, and on APPROVAL open draft opp cards while storing
// each page to console_pages. A ported subset of the old engine's proven ingest (library/intake.js), inlined
// into library/board.html by tools/bundle.js AFTER the send + editor + new-message clones, so it reuses their
// IIFE scope: esc, t, liveUrl, oppReadData, oppPatch, authFetchOnce, URL_BASE, ANON, bearer, session, refresh,
// reloadBoardData, findRow, refreshDrawer, __drawerSlug, __writing, root; and oppUpsert (board-newmsg.src.js).
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
// For each html page derive its slug. Build ONE pool of message UNITS from every text file, supporting BOTH
// structures: a consolidated file yields one unit per per-opportunity section; a plain per-page file (with a
// recipient email) is a single whole-file unit (the original mode). A text that is neither a section message
// nor an email-bearing message (a README or a market assessment) is INFORMATIONAL - surfaced by name, never
// an error. Match each page to its best unit by the token ranker, extract subject / body / bare email.
// Warnings by name in BOTH directions, so nothing is silently dropped: dup_slug (two pages one slug),
// no_message (a page that resolved no message), orphanTexts (a message that matched no page, by name),
// informational (a file that is not a per-page message). This only reads; it writes nothing.
function upBuildPlan(files){
  return upReadFiles(files).then(function(kinds){
    var pages = kinds.pages, texts = kinds.texts, seen = {}, rows = [];
    pages.forEach(function(pg){
      var slug = upPageSlug(pg.name);
      var dup = !!seen[slug]; seen[slug] = (seen[slug] || 0) + 1;
      rows.push({ slug:slug, page:pg, title:"", subject:"", body:"", email:"", text_name:"", warnings: dup ? ["dup_slug"] : [] });
    });
    var units = [], informational = [];
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
      var nm = upFirstHeading(tx.text) || upBaseName(tx.name).replace(/\.(md|txt|json)$/i, "");
      if(ex.email){                                                 // a real message carries a recipient email
        units.push({ file:tx.name, name:nm, slug:upSlugify(nm), subject:ex.subject, body:ex.body, email:ex.email, whole:true });
      } else {
        informational.push(tx.name);                               // README / market assessment: not a message
      }
    });
    var usedUnit = {};
    rows.forEach(function(r){
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
      } else {
        r.title = upPretty(r.slug);
        if(r.warnings.indexOf("no_message") < 0) r.warnings.push("no_message");
      }
    });
    var orphans = [];                                               // a message with no page, reported by name
    units.forEach(function(u, ui){ if(!usedUnit[ui]) orphans.push(u.whole ? u.file : (u.name || u.file)); });
    return { rows:rows, orphanTexts:orphans, informational:informational, skipped:kinds.skipped || [] };
  });
}

// ---- console_pages write (the uploaded-template store E3's Insert-link dropdown will read) ---------
// The console_pages schema is (slug, html, up, updated_at, live_verified_at). There is no title or active
// column, so the title lives on console_opps.business; liveness lives on console_pages.live_verified_at (PR1,
// stamped by pageStampLive only after a real verify-live ok), NOT on any flag in the opp's data. The dropdown
// reads console_pages joined to console_opps for the label. Bounded upsert, same discipline as oppUpsert
// (merge-duplicates, one refresh-retry). This insert leaves live_verified_at null - a stored page is a DRAFT
// until it is committed and verified live.
function pageUpsert(slug, html, retried){
  var url = URL_BASE + "/rest/v1/console_pages";
  var row = { slug:slug, html:String(html == null ? "" : html), up:Date.now() };
  return authFetchOnce(url, {
    method:"POST",
    headers:{ "apikey":ANON, "Authorization":"Bearer " + bearer(), "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates,return=minimal" },
    cache:"no-store", body: JSON.stringify([row])
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return pageUpsert(slug, html, true); var e=new Error("auth"); e.authRequired=true; throw e; });
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
function upCommit(plan){
  var rows = (plan && plan.rows) || [], done = {}, ok = 0, fail = 0;
  function one(i){
    if(i >= rows.length) return Promise.resolve({ ok:ok, fail:fail });
    var r = rows[i];
    if(done[r.slug]) return one(i + 1);
    done[r.slug] = 1;
    var data = { source:"upload", page_title:r.title,
      outreach_subject:r.subject || "", outreach_text:r.body || "",
      recipients: r.email ? [{ addr:r.email, name:"", lang:"en" }] : [] };
    return oppUpsert(r.slug, { business:r.title || r.slug, data:data, up:Date.now() })
      .then(function(){ return pageUpsert(r.slug, r.page && r.page.html); })
      .then(function(){ ok++; return one(i + 1); }, function(){ fail++; return one(i + 1); });
  }
  return one(0);
}

// ---- F2 static activation: commit opp/<slug>/index.html via the relay (the token lives on the relay) -------
// The live host is GitHub Pages, which serves committed static files; a page in console_pages is not served
// until it is committed as opp/<slug>/index.html (exactly how the old engine published, app.js:3530). board.html
// is a static client and must NOT hold a repo-write token, so activation POSTs the html to the relay (the same
// endpoint the send uses) and the RELAY commits it with a server-held GH_TOKEN. The client never sees the token.
var BEACON_TAG_UP = '<script src="/beacon.js" defer></' + 'script>';   // byte-identical to app.js:3493 withBeacon
function withBeaconClient(html){                                        // mirror app.js:3494-3502 (idempotent)
  var h = String(html || "");
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
  return relayPost({ op:"page_publish", slug:slug, html:html }).then(function(r){
    if(!r.res.ok){ var e=new Error("relay " + r.res.status); throw e; }
    var d = r.data || {};
    if(d.ok === false){ var e2=new Error(d.error || "publish failed"); throw e2; }
    return d;
  });
}
// A bounded wait (never a hang): a real setTimeout wrapped in a promise, used only to space verify-live polls.
function upDelay(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
// Verify-live with a bounded poll for the GitHub Pages publish delay. Pages takes a moment to serve a fresh
// commit, so a 404 right after activation is "still publishing", not dead. Poll up to `tries` with `gap`, then
// settle: ok -> live; otherwise -> publishing (honest, never a false success). This runs AFTER a successful
// commit, so the file exists in the repo; a persistent 404 means Pages has not published it yet, not that it
// is dead. The send gate re-checks live at send time regardless, so nothing sends before a real ok.
function verifyLivePoll(slug, tries, gap){
  tries = tries || 3; gap = gap || 3000;
  function attempt(n){
    return verifyLive(slug).then(function(v){
      if(v.ok) return { ok:true, publishing:false };
      if(n >= tries) return { ok:false, publishing:true };     // committed but not yet served -> publishing
      return upDelay(gap).then(function(){ return attempt(n + 1); });
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
function upSendLiveGate(slug, data){
  data = data || {};
  if(data.source !== "upload") return Promise.resolve();
  return verifyLive(slug).then(function(v){
    if(v.ok) return true;
    var e2=new Error("dead link"); e2.__kind="deadlink"; throw e2;
  });
}

// ---- the upload overlay (its own scrim, mirroring the profile/new-message pattern) ----------------
function upFrame(txt){ return '<div class="up-frame"><pre class="up-pre">' + esc(String(txt || "")) + '</pre></div>'; }
function upWarnChips(ws){
  return (ws || []).map(function(w){
    var key = w === "dup_slug" ? "up_warn_dup" : w === "no_message" ? "up_warn_nomsg" : "up_warn_generic";
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
  var orphan = (plan.orphanTexts && plan.orphanTexts.length)
    ? '<div class="up-orphans">' + esc(t("up_warn_orphan")) + ': <bdi>' + esc(plan.orphanTexts.join(", ")) + '</bdi></div>' : "";
  // Files that are not per-page messages (a README, a market assessment) are informational, never an error.
  var info = (plan.informational && plan.informational.length)
    ? '<div class="up-info">' + esc(t("up_info")) + ': <bdi>' + esc(plan.informational.join(", ")) + '</bdi></div>' : "";
  var n = (plan.rows || []).length;
  return '<div class="up-count">' + esc(t("up_matched")) + ' ' + n + '</div>' + orphan + info +
    '<div class="up-rows">' + rows + '</div>'+
    '<div class="acts"><button class="act send" id="upApprove" type="button"' + (n ? "" : " disabled") + '>' + esc(t("up_approve")) + '</button></div>'+
    '<div class="act-status" id="upStatus"></div>';
}
function upPanelHtml(){
  return '<div class="nm-head"><h2>' + esc(t("up_h")) + '</h2>'+
      '<button class="link nm-x" id="upClose" type="button">' + esc(t("pf_close")) + '</button></div>'+
    '<div class="nm-body">'+
      '<div class="up-hint">' + esc(t("up_hint")) + '</div>'+
      '<input class="up-file" id="upFile" type="file" accept=".zip" aria-label="' + esc(t("up_h")) + '">'+
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
    return reloadBoardData().then(function(){ return res; }, function(){ return res; });
  }).then(function(res){
    __upBusy = false;
    upSetStatus(t("up_done") + " " + (res.ok || 0), "ok");
    setTimeout(function(){ closeUpload(); }, 600);
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
function uploadActivateHtml(slug, row, detail){
  var page = (detail && detail.page) || null;
  if(!page) return "";                                           // no console_pages row -> nothing to activate
  var live = !!page.live_verified_at;                            // the SINGLE liveness truth
  var stateKey = live ? "up_state_live" : "up_state_draft";
  var stateCls = live ? "ok" : "bad";
  return '<div class="dw-sec up-act-sec"><h3>' + esc(t("up_page_h")) + '</h3>'+
    '<div class="up-state ' + stateCls + '" id="upState">' + esc(t(stateKey)) + '</div>'+
    '<div class="acts"><button class="act" id="upActBtn" type="button">' + esc(t("up_activate")) + '</button></div>'+
    '<div class="act-status" id="upActStatus"></div></div>';
}
function upActStatus(msg, cls){ var el=document.getElementById("upActStatus"); if(el){ el.className="act-status" + (cls ? (" " + cls) : ""); el.textContent = msg || ""; } }
// Activation, the GitHub-Pages sacred order (mirror app.js:3586 activateAndConfirm): COMMIT the static file
// via the relay, then CONFIRM live with a real bounded poll, then and ONLY then STAMP the truth. The client
// never holds the token (the relay commits). PR1 settle-always: green (up_now_live) ONLY after the stamp write
// returns ok; red on a verify fail OR a stamp-write fail; there is no optimistic success and no liveness flag
// written to the opp's data. On any failure the page is left NOT stamped, so it stays a draft everywhere.
function upActivate(slug){
  if(__writing || __upBusy) return; __upBusy = true;
  upActStatus(t("up_committing"), ""); var b=document.getElementById("upActBtn"); if(b) b.disabled = true;
  pageReadHtml(slug).then(function(html){
    if(!String(html || "").trim()){ var e0=new Error("no page html"); e0.__kind="nohtml"; throw e0; }
    return pagePublishRelay(slug, withBeaconClient(html));              // relay commits opp/<slug>/index.html
  }).then(function(){
    upActStatus(t("up_verifying"), "");
    return verifyLivePoll(slug);                                        // bounded poll for the Pages build delay
  }).then(function(v){
    if(!v.ok){ var e1=new Error("not live"); e1.__kind="notlive"; throw e1; }   // committed, not yet served
    return pageStampLive(slug);                                         // the ONLY liveness write, after a real ok
  }).then(function(){
    __upBusy = false;
    upActStatus(t("up_now_live"), "ok");                                // green ONLY after the stamp write returned ok
    return reloadBoardData().then(function(){}, function(){});          // the card stage (view) now reads live
  }).then(function(){
    if(__drawerSlug === slug) refreshDrawer(slug);
  }).catch(function(e){
    __upBusy = false; var b2=document.getElementById("upActBtn"); if(b2) b2.disabled = false;
    var kind = e && e.__kind;
    var msg = (e && e.authRequired) ? t("err")
      : (kind === "nohtml") ? t("up_no_html")
      : (kind === "notlive") ? t("up_publishing")                      // committed but not served yet (honest, red)
      : t("up_commit_failed");                                         // relay/commit OR stamp-write failure
    upActStatus(msg, "bad");
  });
}
function upWireActivate(slug){ var b=document.getElementById("upActBtn"); if(b) b.addEventListener("click", function(){ upActivate(slug); }); }

// Read-only hooks for board_upload_test:
try{
  window.__thriveUploadPlan = function(){ return __upPlan; };
  window.__thriveUploadVerify = function(slug){ return verifyLive(slug); };
  window.__thriveParseSections = function(text){ return upParseSections(text); };
}catch(e){}
