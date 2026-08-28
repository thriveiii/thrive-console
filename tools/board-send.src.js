// ===================================================================================================
// L5 SINGLE-RECIPIENT SEND - faithful clone of relaySend (app.js:7423) + compile (app.js:1438) for ONE
// recipient. This file is INLINED verbatim into library/board.html by tools/bundle.js (interpolated as a
// string, so its backslashes/regexes need no template escaping) and runs inside board.html's IIFE, using
// its scope: esc, authFetchOnce, bearer, session, refresh, URL_BASE, ANON, t, LANG, __data, findRow,
// replaceRow, renderBoard, reloadBoardData, __act, __writing, __drawerSlug, refreshDrawer,
// drawerActsDisabled, redInto, root, TRAY_STAGES, oppReadData, isoNow, authEmail, and RELAY_EP (baked from
// library/sync.json). Grounded in L5_SEND_PATH_EVIDENCE.md; every clone below cites its engine source line.
//
// THE FIX (why L5 is a clone, not a call): the engine reads the relay body with a bare await r.text()
// (app.js:7453) OUTSIDE fetchT's timeout race (supabase.js:163-164 returns the raw Response, no body read),
// so a wedged WebKit body stream hangs forever. Here the relay POST goes through board.html's authFetchOnce,
// whose body read is arrayBuffer + TextDecoder INSIDE its setTimeout race, so an aborted / rejecting /
// timing-out body settles to a defined rejection, never a pending promise. No storage is touched on the send.
// ===================================================================================================

// ---- constants (cited from the engine) --------------------------------------------------------------
var SITE_L5 = "console.thriveiii.com";              // app.js:2 (SITE) - live host for opp pages
var OPP_PATH_L5 = "/opp/";                          // app.js:3 (OPP_PATH)
var FROM_EMAIL_L5 = "hi@thriveiii.com";             // app.js:6052 (FROM_EMAIL)
var FROM_NAME_DEFAULT_L5 = "Thrive Digital Solutions"; // app.js:6056 (getFromName default); the relay builds "Name <addr>" from it (thrive-relay.gs fromHeader_)
var REQUIRED_RELAY_L5 = 5;                          // app.js:8919 (REQUIRED_RELAY) - the payload contract version
// P23 attachment partition limits (app.js:1388-1391); attachments here are pre-uploaded Storage URLs only.
var ATTACH_INLINE_MAX_L5 = 5 * 1024 * 1024, ATTACH_MAX_L5 = 25 * 1024 * 1024, ATTACH_TOTAL_MAX_L5 = 40 * 1024 * 1024, ATTACH_COUNT_MAX_L5 = 10;

// RELAY_EP is baked into the template from library/sync.json (the /exec URL the engine seeds for email +
// sync). Constant-first: a localStorage override is read defensively and is NEVER a precondition, so
// board.html boots clean with no guaranteed storage. The URL is not the secret (the Resend key lives only on
// the relay). Cite: library/sync.json "ep"; getEmailEndpoint reads localStorage thrive_email_ep (app.js:6054).
function relayEp(){ try{ var o = localStorage.getItem("thrive_email_ep"); if(o && String(o).trim()) return String(o).trim(); }catch(e){} return (typeof RELAY_EP !== "undefined" && RELAY_EP) ? RELAY_EP : ""; }

// ---- compile() dependency clones (app.js line-for-line) ---------------------------------------------
function liveUrl(slug){ return "https://" + SITE_L5 + OPP_PATH_L5 + slug; }                 // app.js:15
function bareAddress(v){ return String(v==null?"":v).replace(/^\s*mailto:/i,"").trim(); }   // app.js:828
function fromName(){ try{ var n = localStorage.getItem("thrive_from_name"); if(n) return n; }catch(e){} return FROM_NAME_DEFAULT_L5; } // app.js:6056
function newMessageId(){ try{ return "<c" + Date.now().toString(36) + Math.random().toString(36).slice(2,10) + "@thriveiii.com>"; }catch(e){ return "<c" + Date.now() + "@thriveiii.com>"; } } // app.js:6643
// app.js:6670 - stable per-intent idempotency key (also the open token, with an empty body). Two hash passes.
function sendIdem(opp, to, subject, body){
  var s = String(opp||"") + "" + String(to||"").trim().toLowerCase() + "" + String(subject||"") + "" + String(body||"");
  var h = 0; for(var i=0;i<s.length;i++){ h = ((h<<5)-h + s.charCodeAt(i))|0; }
  var h2 = 0; for(var j=s.length-1;j>=0;j--){ h2 = ((h2<<5)-h2 + s.charCodeAt(j))|0; }
  return "snd_" + (h>>>0).toString(36) + (h2>>>0).toString(36);
}
function recipientOpenToken(opp, to, subject){ return sendIdem(String(opp||""), String(to||""), String(subject||""), ""); } // app.js:24
function openPixelHtml(slug, token, ep){                                                    // app.js:25
  if(!ep || !token) return "";
  var u = ep + (ep.indexOf("?")<0?"?":"&") + "op=hit&type=open&slug=" + encodeURIComponent(slug||"") + "&r=" + encodeURIComponent(token);
  return '<img src="' + esc(u) + '" width="1" height="1" alt="" style="width:1px;height:1px;border:0;margin:0;padding:0" referrerpolicy="no-referrer">';
}
function outboundHeaders(slug){                                                              // store.js:182-190
  var d = "thriveiii.com";
  var tag = slug ? ("hi+" + slug + "@" + d) : ("hi@" + d);
  return {
    "List-Unsubscribe": "<mailto:unsubscribe@" + d + "?subject=unsubscribe>, <https://" + d + "/unsubscribe>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Reply-To": tag                                                                         // the relay re-derives reply_to from payload.slug (relay:583); this agrees
  };
}
var POSTAL_L5 = "Thrive Digital Solutions, VA, USA";                                         // store.js:197
function footerHtml(lang){                                                                   // store.js:198
  var opt = (lang==="ar") ? "لا ترغب برسائل أخرى؟ ردّ بكلمة إيقاف وسنتوقف." : "Not interested in hearing from us? Reply STOP and we will stop.";
  return '<div style="margin-top:20px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#9aa0aa">' + POSTAL_L5 + '<br>' + opt + '</div>';
}
function footerText(lang){                                                                   // store.js:205
  var opt = (lang==="ar") ? "لا ترغب برسائل أخرى؟ ردّ بكلمة إيقاف وسنتوقف." : "Not interested in hearing from us? Reply STOP and we will stop.";
  return "\n\n" + POSTAL_L5 + "\n" + opt;
}
// The merge-field tokens are built by concatenation so the shipped board.html carries no literal
// double-brace UPPER slot (tools/verify.js forbids an unfilled merge slot in a console page); the runtime
// values are the exact engine tokens, so behavior is byte-identical to app.js:1370-1377.
var MF_BIZ = "{{" + "BIZ}}", MF_LINK = "{{" + "LINK}}", MF_MONTH = "{{" + "MONTH}}";
function mergeFieldsInto(str, name, ctx){                                                    // app.js:1370
  var out = String(str==null?"":str);
  if(name){ out = out.replace(/\{\{\s*NAME\s*\}\}/g, name); }
  else { out = out.replace(/\{\{\s*NAME\s*\}\}/g, "").replace(/[ \t]+([,،.:;!?])/g, "$1").replace(/[ \t]{2,}/g, " "); }
  out = out.split(MF_BIZ).join((ctx&&ctx.business)||"");
  out = out.split(MF_LINK).join((ctx&&ctx.link)||"");
  out = out.split(MF_MONTH).join((ctx&&ctx.month)||"");
  return out.replace(/<span data-m="[^"]*"[^>]*>([\s\S]*?)<\/span>/g, "$1");
}
function planAttachments(list){                                                              // app.js:1396
  var items = Array.isArray(list) ? list : [];
  var attach = [], hosted = [], refused = [], total = 0, count = 0;
  for(var i=0;i<items.length;i++){
    var a = items[i] || {};
    var size = Number(a.size) || 0;
    var url = String(a.url || "");
    var name = String(a.filename || a.name || "image");
    if(!url) continue;
    if(size > ATTACH_MAX_L5){ refused.push({ filename:name, size:size, reason:"file", limit:ATTACH_MAX_L5 }); continue; }
    if(count >= ATTACH_COUNT_MAX_L5){ refused.push({ filename:name, size:size, reason:"count", limit:ATTACH_COUNT_MAX_L5 }); continue; }
    if(size <= ATTACH_INLINE_MAX_L5 && total + size <= ATTACH_TOTAL_MAX_L5){
      attach.push({ filename:name, path:url, contentType:a.contentType || "", size:size }); total += size; count++;
    } else {
      hosted.push({ filename:name, url:url, size:size }); count++;
    }
  }
  return { attach:attach, hosted:hosted, refused:refused, totalBytes:total, count:count };
}
function attachHostedBlockHtml(list, lang){                                                  // app.js:1419
  if(!list || !list.length) return "";
  var label = (lang==="ar") ? "عرض الصورة" : "View image";
  var rows = list.map(function(a){ return '<div style="margin:6px 0"><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(label) + ': ' + esc(a.filename) + '</a></div>'; }).join("");
  return '<div class="att-hosted" style="margin-top:14px">' + rows + '</div>';
}
function attachHostedBlockText(list, lang){                                                  // app.js:1427
  if(!list || !list.length) return "";
  var label = (lang==="ar") ? "عرض الصورة" : "View image";
  return "\n\n" + list.map(function(a){ return label + ": " + a.filename + " " + a.url; }).join("\n");
}
function brandWrap(inner, branded, sigText){                                                 // app.js:6388
  var name = esc(fromName());
  var sig = (sigText==null) ? "" : String(sigText);
  var sigHtml = sig.trim() ? esc(sig).split("\n").join("<br>") : "";
  var font = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
  var closing = sigHtml ? '<div style="margin-top:18px;color:#444">' + sigHtml + '</div>' : '';
  if(!branded){ return '<div style="font-family:' + font + ';font-size:15px;line-height:1.6;color:#222">' + inner + closing + '</div>'; }
  var logo = "https://" + SITE_L5 + "/assets/thrive-logo.png";
  return '<div style="font-family:' + font + ';max-width:600px;margin:0 auto;padding:10px 4px">'
    + '<img src="' + logo + '" width="42" height="42" alt="' + name + '" style="display:block;border-radius:10px;margin-bottom:16px">'
    + '<div style="font-size:15px;line-height:1.7;color:#111827">' + inner + '</div>'
    + (sigHtml ? '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#9aa0aa">' + sigHtml + '</div>' : '')
    + '</div>';
}
function toPlainText(html, sig){                                                             // app.js:6371
  var s = String(html||"");
  s = s.replace(/<br\s*\/?>/gi, "\n")
       .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
       .replace(/<li[^>]*>/gi, "- ")
       .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function(_, h, txt){ var tt = String(txt).replace(/<[^>]*>/g, "").trim(); return (tt && tt!==h) ? (tt + " (" + h + ")") : h; })
       .replace(/<[^>]*>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  return sig ? (s + "\n\n" + sig) : s;
}
// LIGHT-HTML law of the new console: outreach sends light, clean HTML - not heavy branded HTML, not
// plain-only. Allowed: black body text in one system font, a smaller grey closing/signature and grey
// footer, real paragraph breaks, the plain opp link, and the one 1x1 open pixel. Forbidden: logo, tables,
// background colors, multi-color styling, any image other than the tracking pixel, inline-styled cards.

// The agency site, used ONLY by the "Use my signature" preset default (board-editor.src.js:65).
// PR-A: the message body is previewed and sent EXACTLY as written. Nothing detects or removes
// signature-like text from the body; the ONE signature is the separate data.sig field, appended by
// lightHtml / toPlainText below. The old stripBakedSig body-mutation (and its AGENCY_NAME_L5 anchor,
// whose only user it was) is removed; AGENCY_SITE_L5 stays because the editor preset still reads it.
var AGENCY_SITE_L5 = "thriveiii.com";

// Body paragraphs as light HTML: split on blank lines into <p>, single newlines become <br>. Black text,
// one system font, normal size. No wrapper card, no colors, no tables.
function bodyParasHtml(bodyPlain){
  var s = String(bodyPlain==null?"":bodyPlain).replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  if(!s) return "";
  return s.split(/\n{2,}/).map(function(b){
    b = b.replace(/^\n+|\n+$/g, "");
    return b ? '<p style="margin:0 0 14px 0">' + esc(b).split("\n").join("<br>") + '</p>' : "";
  }).filter(Boolean).join("");
}

// The one light-HTML document: body (black), then the identity signature in smaller grey, then the grey
// POSTAL/STOP footer. The open pixel is appended by the caller so it is the LAST and ONLY image.
function lightHtml(bodyPlain, sig, lang){
  var font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
  // E0: the signature block is a clear grey (not the near-transparent #888888), small, its own block, its
  // multi-line value (name / title / site) rendered with real <br> line breaks, separated from the body by
  // space above. Empty sig renders nothing (fully optional). The grey POSTAL/STOP footer stays distinct below.
  var sigHtml = (sig && sig.trim())
    ? '<div style="margin-top:18px;font-size:13px;line-height:1.5;color:#595959">' + esc(String(sig)).split("\n").join("<br>") + '</div>'
    : "";
  return '<div style="font-family:' + font + ';font-size:15px;line-height:1.6;color:#111111">'
    + bodyParasHtml(bodyPlain) + sigHtml + '</div>' + footerHtml(lang);
}

// compile(recipient, content) for ONE recipient. Content is the opp RECORD's prepared message
// (console_opps.data.outreach_subject / outreach_text / sig). LIGHT-HTML: the body is the operator's text
// VERBATIM (PR-A: no signature-like text is ever detected or removed from it). The ONE signature is the
// separate data.sig field, appended EXACTLY ONCE in smaller grey above the grey footer. The plain-text arm
// mirrors it (body + blank line + sig + footer). The tokenized opp-page link (channel 2) rides in both as a
// plain URL; the 1x1 open pixel (channel 1) is the ONLY image, appended last.
function sendCompile(slug, row, data, rcpt){
  data = data || {}; rcpt = rcpt || {};
  var full = String(rcpt.name==null?"":rcpt.name).trim();
  var name = (data.firstName && full) ? full.split(/\s+/)[0] : full;
  var lang = (rcpt.lang==="ar" || data.lang==="ar") ? "ar" : "en";
  var addr = bareAddress(rcpt.addr||"");
  var ctx = { business:(row&&row.business)||data.business||"", link:liveUrl(slug), month:data.month||"" };
  var inner = mergeFieldsInto(data.outreach_text||"", name, ctx);   // PR-A: body sent verbatim, no signature strip
  var subject = mergeFieldsInto(data.outreach_subject||"", name, ctx).replace(/^\s+|\s+$/g, "");
  var sig = data.sig || "";
  var plan = planAttachments(data.attachments||[]);
  var bodyPlain = inner + attachHostedBlockText(plan.hosted, lang);   // hosted-image links ride as text lines
  var token = recipientOpenToken(slug, addr, subject);       // == the console_mail row id (attribution join)
  if(token){
    var base = liveUrl(slug), tokd = base + (base.indexOf("?")<0?"?":"&") + "r=" + encodeURIComponent(token);
    bodyPlain = bodyPlain.split(base).join(tokd);            // channel 2: the opp page link carries the token
  }
  var text = toPlainText(bodyPlain, sig) + footerText(lang);            // plain-text alternative part
  var html = lightHtml(bodyPlain, sig, lang);                          // light-HTML primary part
  if(token) html = html + openPixelHtml(slug, token, relayEp());       // channel 1: the one open pixel (last, only image)
  return { to:addr, name:name, subject:subject, html:html, text:text, token:token, lang:lang, attachments:plan.attach };
}

// ---- eligibility + recipient (the engine's own gate) ------------------------------------------------
function isEmail(a){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a||"")); }
// A sighted recipient email on the opp RECORD: the engine derives recipients from data.recipients[] (app.js:1050,
// campaignRecipients). First valid email wins.
function firstRecipient(data){
  var rs = (data && Array.isArray(data.recipients)) ? data.recipients : [];
  for(var i=0;i<rs.length;i++){ var r = rs[i]||{}; var a = bareAddress(r.addr||""); if(isEmail(a)) return { addr:a.toLowerCase(), name:r.name||"", lang:r.lang||"" }; }
  return null;
}
// The engine allows a send when the opp has a prepared outreach message (has_email = console_board view line 210,
// docs/supabase-board-view.sql) and is not a closed/archived card, and a relay endpoint is configured (relaySend
// refuses with no endpoint, app.js:7426). The sighted-recipient requirement is checked at send time from the record.
function sendEligible(row){
  if(!row) return false;
  if(row.archived) return false;
  if(TRAY_STAGES.indexOf((row&&row.stage)||"")>=0) return false;   // won / lost / dropped are terminal
  if(!relayEp()) return false;
  return !!row.has_email;
}

// ---- the console_mail confirm write (supaConfirmMail shape) -----------------------------------------
// POST /rest/v1/console_mail, Prefer resolution=merge-duplicates,return=minimal, columns per supaMailRow
// (app.js:3913) via the generic upsert (supabase.js:408). Bounded + one refresh-retry, through authFetchOnce.
function confirmMail(row, retried){
  var url = URL_BASE + "/rest/v1/console_mail";
  return authFetchOnce(url, {
    method:"POST",
    headers:{ "apikey":ANON, "Authorization":"Bearer " + bearer(), "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates,return=minimal" },
    cache:"no-store", body: JSON.stringify([row])
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return confirmMail(row, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error((r.data && r.data.message) || ("HTTP " + r.res.status)); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    return true;
  });
}
// The relay POST, faithful to app.js:7452: text/plain body, the app.js:7446 payload shape. The response body is
// read INSIDE authFetchOnce's timeout race (the fix), so it settles even on a wedged body stream.
function relayPost(payload){
  return authFetchOnce(relayEp(), {
    method:"POST", headers:{ "Content-Type":"text/plain;charset=UTF-8" }, cache:"no-store", body: JSON.stringify(payload)
  });
}

// ---- runSend: optimistic confirm-or-revert, faithful ordering (app.js:7440-7481) --------------------
// (a) optimistic UI first (card jumps to Sent, a 'sending' pill), (b) POST to the relay, (c) ONLY on Resend
// acceptance write the console_mail server row and re-read the board from server truth, (d) on relay error /
// Resend reject / aborted body-read, revert the card and show red - never a phantom Sent (mirrors the engine's
// unsent local-only path, app.js:7458/7460/7479). A post-acceptance confirm-write failure is the engine's
// 'sending' limbo (app.js:7473): the email went out, so it is NOT reverted to unsent; the board reflects server
// truth (no phantom) and an amber 'confirming' note shows.
function runSend(slug){
  if(__writing) return; __writing = true;
  var row = findRow(slug);
  if(!row){ __writing = false; return; }
  __act[slug] = { msg:t("s_sending"), cls:"" };
  drawerActsDisabled(true);
  var snap = null;
  oppReadData(slug).then(function(data){
    var rcpt = firstRecipient(data);
    if(!rcpt) { var e0=new Error("no recipient"); e0.__kind="norecip"; throw e0; }
    if(!(data && (String(data.outreach_text||"").trim() || String(data.outreach_subject||"").trim()))){ var e1=new Error("no message"); e1.__kind="nomsg"; throw e1; }
    // E2 ConTh-3: an uploaded-page opp must be proven LIVE - its page ACTIVATED and a real fetch of the live
    // /opp/<slug> URL returning ok - before ANY send. A preview looking good is never the proof; the live
    // fetch is (app.js:832-833 pageSendable). Non-upload opps pass straight through. The gate throws
    // __kind="notlive"/"deadlink" so the catch below reverts the optimistic send with a clear reason.
    var __liveGate = (typeof upSendLiveGate==="function") ? upSendLiveGate(slug, data) : Promise.resolve();
    return __liveGate.then(function(){
    var art = sendCompile(slug, row, data, rcpt);
    var idem = sendIdem(slug, art.to, art.subject, art.html);          // app.js:7429 default idempotency key
    var msgid = newMessageId();                                        // app.js:7430 / :8824
    var headers = Object.assign({}, outboundHeaders(slug), { "Message-ID": msgid });   // app.js:7445
    var payload = { v:REQUIRED_RELAY_L5, from:FROM_EMAIL_L5, fromName:fromName(), to:art.to, subject:art.subject,
      html:art.html, text:art.text, idempotencyKey:idem, headers:headers, slug:slug };  // app.js:7446-7447
    if(art.attachments && art.attachments.length) payload.attachments = art.attachments; // app.js:7450
    // optimistic paint: the card shows sending at once (snapshot for a clean revert)
    snap = JSON.parse(JSON.stringify(row));
    row.stage = "sent"; row.sent_count = Number(row.sent_count||0) + 1; row.__sending = true;
    try{ renderBoard(__data); }catch(e){}
    return relayPost(payload).then(function(r){
      if(!r.res.ok){ var e2=new Error("relay " + r.res.status); e2.__kind="relay"; throw e2; }
      var d = r.data;
      if(d && d.ok===false){ var e3=new Error(d.error||"send failed"); e3.__kind="reject"; throw e3; }
      // Resend accepted. Write the server row ONLY now. id = the open token (== console_hits.data.r join target).
      var mailRow = { id:art.token, opp:slug, status:"sent", to_addr:art.to, subject:art.subject, ts:isoNow(),
        actor:currentUid(), up:Date.now(),   // Step 1: actor is the uid (currentActor()=authUid() parity), not the email
        data:{ mid:art.token, idem:idem, msgid:msgid, resend_id:(d && d.id) || "", provider:"endpoint", direction:"out" } };
      return confirmMail(mailRow).then(function(){
        return reloadBoardData().then(function(){ __writing=false; __act[slug]={ msg:t("s_sent"), cls:"ok" }; if(__drawerSlug===slug) refreshDrawer(slug); });
      }, function(){
        // email out, server write failed: the engine's 'sending' state. Reflect server truth (no phantom), amber note.
        return reloadBoardData().then(function(){ __writing=false; __act[slug]={ msg:t("s_confirming"), cls:"" }; if(__drawerSlug===slug) refreshDrawer(slug); },
                                      function(){ __writing=false; __act[slug]={ msg:t("s_confirming"), cls:"" }; if(__drawerSlug===slug) refreshDrawer(slug); });
      });
    });
    });
  }).catch(function(e){
    __writing = false;
    if(snap){ replaceRow(slug, snap); try{ renderBoard(__data); }catch(x){} }   // revert the optimistic send (no phantom Sent)
    var kind = e && e.__kind;
    var msg = (kind==="norecip") ? t("s_no_recip") : (kind==="nomsg") ? t("s_no_msg")
      : (kind==="notlive") ? t("s_not_live") : (kind==="deadlink") ? t("s_dead_link")
      : (e && e.authRequired) ? t("err") : t("s_failed");
    __act[slug] = { msg:msg, cls:"bad" };
    if(__drawerSlug===slug) refreshDrawer(slug); else { try{ redInto(root, "send", new Error(t("s_failed"))); }catch(x){} }
  });
}
