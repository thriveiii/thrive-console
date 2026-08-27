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

// ---- upBuildPlan: the preview (read-only, nothing written) ---------------------------------------
// For each html page: derive its slug, find the best-matching message text by the one token ranker, and
// extract subject / body / bare email. Warnings by name: dup_slug (two pages one slug), no_message (a page
// with no matched text), orphan_text (a text matched to no page). This only reads; it writes nothing.
function upBuildPlan(files){
  return upReadFiles(files).then(function(kinds){
    var pages = kinds.pages, texts = kinds.texts, seen = {}, rows = [];
    pages.forEach(function(pg){
      var slug = upPageSlug(pg.name);
      var dup = !!seen[slug]; seen[slug] = (seen[slug] || 0) + 1;
      rows.push({ slug:slug, page:pg, title:"", subject:"", body:"", email:"", text_name:"", warnings: dup ? ["dup_slug"] : [] });
    });
    var usedText = {};
    rows.forEach(function(r){
      var best = null, bestScore = 0;
      texts.forEach(function(tx, ti){
        if(usedText[ti]) return;
        var ts = upSlugify(upFirstHeading(tx.text) || upBaseName(tx.name).replace(/\.(md|txt|json)$/i, ""));
        var rk = upRankTokens(upNormTokens(r.slug), upNormTokens(ts));
        if(rk.score > bestScore){ bestScore = rk.score; best = { ti:ti, tx:tx }; }
      });
      if(best && bestScore >= 2){
        usedText[best.ti] = 1;
        var ex = upExtract(best.tx.text);
        r.subject = ex.subject; r.body = ex.body; r.email = ex.email; r.text_name = best.tx.name;
        r.title = ex.subject || upPretty(r.slug);
      } else {
        r.title = upPretty(r.slug);
        if(r.warnings.indexOf("no_message") < 0) r.warnings.push("no_message");
      }
    });
    var orphans = [];
    texts.forEach(function(tx, ti){ if(!usedText[ti]) orphans.push(tx.name); });
    return { rows:rows, orphanTexts:orphans, skipped:kinds.skipped || [] };
  });
}

// ---- console_pages write (the uploaded-template store E3's Insert-link dropdown will read) ---------
// The console_pages schema is (slug, html, up) - E2_EVIDENCE / supabase-stage1.sql:39. There is no title or
// active column, so the title lives on console_opps.business and the active/live flags on the opp's data
// (page_active / page_live); the dropdown reads console_pages joined to console_opps for the label. Bounded
// upsert, same discipline as oppUpsert (merge-duplicates, one refresh-retry).
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

// ---- upCommit: the approve step (writes) ---------------------------------------------------------
// Only on approval, and only then. Each page row becomes a DRAFT opp (console_opps: published nowhere, sent
// to nobody, source "upload", page not yet active) AND its html a console_pages row. Deduped by slug (first
// wins). Bounded confirm-or-revert per row; a per-row failure is counted, never a phantom success.
function upCommit(plan){
  var rows = (plan && plan.rows) || [], done = {}, ok = 0, fail = 0;
  function one(i){
    if(i >= rows.length) return Promise.resolve({ ok:ok, fail:fail });
    var r = rows[i];
    if(done[r.slug]) return one(i + 1);
    done[r.slug] = 1;
    var data = { source:"upload", page_active:false, page_live:false, page_title:r.title,
      outreach_subject:r.subject || "", outreach_text:r.body || "",
      recipients: r.email ? [{ addr:r.email, name:"", lang:"en" }] : [] };
    return oppUpsert(r.slug, { business:r.title || r.slug, data:data, up:Date.now() })
      .then(function(){ return pageUpsert(r.slug, r.page && r.page.html); })
      .then(function(){ ok++; return one(i + 1); }, function(){ fail++; return one(i + 1); });
  }
  return one(0);
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
// opp must be ACTIVATED and its live URL must resolve RIGHT NOW; otherwise the send is refused.
function upSendLiveGate(slug, data){
  data = data || {};
  if(data.source !== "upload") return Promise.resolve();
  if(!data.page_active){ var e=new Error("not activated"); e.__kind="notlive"; return Promise.reject(e); }
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
  var n = (plan.rows || []).length;
  return '<div class="up-count">' + esc(t("up_matched")) + ' ' + n + '</div>' + orphan +
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

// ---- the Activate control on an upload opp's drawer (injected after the editor) --------------------
// Renders only for an upload opp: the live/dead state and an Activate button. Activation marks the page
// active AND verifies the live URL with a real fetch before claiming live; send stays blocked until the
// fetch actually resolves (upSendLiveGate re-checks live at send time regardless of this flag).
function uploadActivateHtml(slug, row, detail){
  var data = (detail && detail.opp && detail.opp.data) || null;
  if(!data || data.source !== "upload") return "";
  var stateKey, stateCls;
  if(data.page_live){ stateKey = "up_state_live"; stateCls = "ok"; }
  else if(data.page_active && data.page_dead){ stateKey = "up_state_dead"; stateCls = "bad"; }   // verified dead
  else if(data.page_active){ stateKey = "up_state_pending"; stateCls = ""; }
  else { stateKey = "up_state_draft"; stateCls = "bad"; }
  return '<div class="dw-sec up-act-sec"><h3>' + esc(t("up_page_h")) + '</h3>'+
    '<div class="up-state ' + stateCls + '" id="upState">' + esc(t(stateKey)) + '</div>'+
    '<div class="acts"><button class="act" id="upActBtn" type="button">' + esc(t("up_activate")) + '</button></div>'+
    '<div class="act-status" id="upActStatus"></div></div>';
}
function upActStatus(msg, cls){ var el=document.getElementById("upActStatus"); if(el){ el.className="act-status" + (cls ? (" " + cls) : ""); el.textContent = msg || ""; } }
function upActivate(slug){
  if(__writing || __upBusy) return; __upBusy = true;
  upActStatus(t("up_verifying"), ""); var b=document.getElementById("upActBtn"); if(b) b.disabled = true;
  oppReadData(slug).then(function(data){
    var next = Object.assign({}, data, { source:"upload", page_active:true });
    return oppPatch(slug, { data:next, up:Date.now() }).then(function(){ return verifyLive(slug); }).then(function(v){
      var d2 = Object.assign({}, next, { page_live: !!v.ok, page_dead: !v.ok });
      return oppPatch(slug, { data:d2, up:Date.now() }).then(function(){ return v; }, function(){ return v; });
    });
  }).then(function(v){
    __upBusy = false;
    if(v.ok){ upActStatus(t("up_now_live"), "ok"); }
    else { upActStatus(v.dead ? t("up_dead") : t("up_unconfirmed"), "bad"); }
    if(__drawerSlug === slug) refreshDrawer(slug);
  }).catch(function(e){
    __upBusy = false; var b2=document.getElementById("upActBtn"); if(b2) b2.disabled = false;
    upActStatus((e && e.authRequired) ? t("err") : t("up_write_failed"), "bad");
  });
}
function upWireActivate(slug){ var b=document.getElementById("upActBtn"); if(b) b.addEventListener("click", function(){ upActivate(slug); }); }

// Read-only hooks for board_upload_test:
try{
  window.__thriveUploadPlan = function(){ return __upPlan; };
  window.__thriveUploadVerify = function(slug){ return verifyLive(slug); };
}catch(e){}
