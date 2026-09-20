// ===================================================================================================
// PHASE 3 (the last arc) - the networked Contacts + Template memory + Reply tags. This ties the three
// entities (Opportunity, Template, Contact) into ONE network, every view a LENS over the existing ledger:
// nothing new is stored beyond the one console_mail.page_slug column and the console_contacts curation.
//
// It REUSES the same reads and helpers the rest of the board uses (restGet / fetchInbound / bearer / ANON /
// URL_BASE / esc / t / enc / normFrom / fmtWhen / liveUrl / upPretty / smartPerson / bareAddress), and the
// SAME thread bubble markup (.msg.in / .msg.out) the opp detail thread renders. Inlined into the board IIFE
// after the upload module, so all of the above are in scope; function declarations hoist.
//
// Data sources (all best-effort, read-only, bearer+apikey):
//   * console_contacts  - the curation overlay (id, grouped addresses, name, tags). A person is the merge of
//     addresses a human confirmed; an address in NO contact row is its own ad-hoc contact (id "addr:<email>").
//   * console_mail      - the outbound ledger (to_addr, actor=team member, subject, ts, page_slug + a
//     data.page_slug mirror). effectivePageSlug = page_slug || data.page_slug || oppPage[opp] || opp, so a
//     row from before the column landed still resolves its template via the opportunity.
//   * console_inbound   - the replies (data.from, subject, snippet). Human replies only (auto/bounce dropped),
//     the SAME rule buildReplies() uses for the card counts.
//   * console_opps      - only data->>page_slug, for the old-row fallback (the "opp -> page_slug derivation").
//   * console_pages     - slug -> title, so a template shows its human title.
// ===================================================================================================

var __ctModel = null, __ctQuery = "", __ctView = "list", __ctCurrent = null;

// A rich read that degrades to a lean read if the rich columns are not there yet (e.g. a build reaching a DB
// where the additive page_slug column has not been applied). restGet swallows the status, so this does its own
// fetch to tell a 400 (bad column) from a genuine empty, then falls back.
function ctRestOr(pathRich, pathLean){
  return fetch(URL_BASE + "/rest/v1/" + pathRich, {
    method:"GET", headers:{ "apikey":ANON, "Authorization":"Bearer " + bearer() }, cache:"no-store"
  }).then(function(res){
    if(res.ok) return res.text().then(function(tx){ var d=null; try{ d=tx?JSON.parse(tx):null; }catch(e){} return Array.isArray(d)?d:[]; });
    return restGet(pathLean);                                            // rich columns absent -> lean read + derive
  }, function(){ return restGet(pathLean); });
}

// One normalized email key for a contact address (mailto strip + trim + lowercase). The whole network keys on it.
function ctAddr(v){ return normFrom(bareAddress(v)); }

// A display name for a contact: the curated name, else a name derived from the address (smartPerson), else the
// bare address. Never a machine token.
function ctName(rec){
  var n = rec && rec.name ? String(rec.name).trim() : "";
  if(n) return n;
  var a = rec && rec.primaryAddr ? rec.primaryAddr : "";
  var d = a ? String(smartPerson(a)||"").trim() : "";
  return d || a || t("unnamed");
}

// Build the whole contact network from the five reads. Pure (no DOM); returns { contacts, byId, byAddr,
// templates, pageTitle }.
function ctBuild(contacts, mail, inbound, opps, pages){
  var oppPage = {}, pageTitle = {};
  (opps||[]).forEach(function(o){ if(o && o.slug) oppPage[o.slug] = (o.ps && String(o.ps).trim()) || o.slug; });
  (pages||[]).forEach(function(p){ if(p && p.slug) pageTitle[p.slug] = (p.title && String(p.title).trim()) || upPretty(p.slug); });

  var byId = {}, byAddr = {};
  function ensure(cid, addr){
    if(byId[cid]) return byId[cid];
    var rec = { id:cid, addresses:[], addrSet:{}, name:"", tags:[], note:"", primaryAddr:addr||"",
                sends:0, replyCount:0, lastTs:"", tmpl:{}, convo:[] };
    byId[cid] = rec; return rec;
  }
  function addAddr(rec, addr){ addr = ctAddr(addr); if(addr && !rec.addrSet[addr]){ rec.addrSet[addr]=1; rec.addresses.push(addr); byAddr[addr]=rec; if(!rec.primaryAddr) rec.primaryAddr=addr; } }

  // 1) curated contacts first, so their merge (grouped addresses) owns every address they claim
  (contacts||[]).forEach(function(c){ if(!c || !c.id) return;
    var rec = ensure(c.id, "");
    rec.name = c.name ? String(c.name).trim() : "";
    rec.tags = Array.isArray(c.tags) ? c.tags : [];
    rec.note = c.note ? String(c.note) : "";
    var addrs = Array.isArray(c.addresses) ? c.addresses : [];
    addrs.forEach(function(a){ addAddr(rec, a); });
  });
  function recFor(addr){
    addr = ctAddr(addr); if(!addr) return null;
    if(byAddr[addr]) return byAddr[addr];
    var rec = ensure("addr:"+addr, addr); addAddr(rec, addr); return rec;   // ad-hoc contact: an address no human has merged yet
  }

  // 2) outbound sends: attribute each to its contact + its template
  var templates = {};
  function tmpl(slug){ return templates[slug] || (templates[slug] = { slug:slug, title:(pageTitle[slug]||upPretty(slug)), count:0, contactIds:{}, sends:[] }); }
  (mail||[]).forEach(function(m){ if(!m) return;
    var addr = ctAddr(m.to_addr); if(!addr) return;
    var rec = recFor(addr); if(!rec) return;
    var eff = (m.page_slug && String(m.page_slug).trim()) || (m.data && m.data.page_slug && String(m.data.page_slug).trim()) || oppPage[m.opp] || m.opp || "";
    var ts = String(m.ts || (m.data && m.data.ts) || "");
    rec.sends++; if(ts > rec.lastTs) rec.lastTs = ts;
    if(eff){
      var te = rec.tmpl[eff] || (rec.tmpl[eff] = { slug:eff, title:(pageTitle[eff]||upPretty(eff)), count:0, lastTs:"" });
      te.count++; if(ts > te.lastTs) te.lastTs = ts;
      var T = tmpl(eff); T.count++; T.contactIds[rec.id] = 1;
      T.sends.push({ cid:rec.id, addr:addr, actor:(m.actor||""), ts:ts, subject:(m.subject||(m.data&&m.data.subject)||"") });
    }
    rec.convo.push({ dir:"out", ts:ts, subject:(m.subject||(m.data&&m.data.subject)||""), actor:(m.actor||""), pageSlug:eff });
  });

  // 3) inbound replies: human only (auto/bounce dropped), the same rule as the card counts
  (inbound||[]).forEach(function(r){ if(!r) return; var d=r.data||{};
    if(r.kind==="auto" || r.bounce) return;
    var from = ctAddr(d.from || r.from); if(!from) return;
    var rec = recFor(from); if(!rec) return;
    var ts = String(r.ts || d.ts || "");
    rec.replyCount++; if(ts > rec.lastTs) rec.lastTs = ts;
    rec.convo.push({ dir:"in", ts:ts, from:from, subject:(d.subject||""), snippet:(d.snippet||d.body||d.text||"") });
  });

  // 4) finalize each contact: sort the conversation, number the inbound replies, freeze the template list
  var list = Object.keys(byId).map(function(id){ return byId[id]; });
  list.forEach(function(rec){
    rec.convo.sort(function(a,b){ return a.ts<b.ts?-1:(a.ts>b.ts?1:0); });
    var n=0; rec.convo.forEach(function(x){ if(x.dir==="in"){ n++; x.num=n; } });
    rec.templates = Object.keys(rec.tmpl).map(function(k){ return rec.tmpl[k]; }).sort(function(a,b){ return b.lastTs<a.lastTs?-1:(b.lastTs>a.lastTs?1:0); });
    if(!rec.primaryAddr && rec.addresses.length) rec.primaryAddr = rec.addresses[0];
  });
  // A contact is anyone curated OR anyone ever emailed/replied. Curated-but-never-touched people still list
  // (the shared address book), so the section truly retires the Legacy Contacts.
  list.sort(function(a,b){ if(a.lastTs!==b.lastTs) return a.lastTs<b.lastTs?1:-1; return ctName(a)<ctName(b)?-1:1; });
  return { contacts:list, byId:byId, byAddr:byAddr, templates:templates, pageTitle:pageTitle };
}

function ctLoad(){
  var body=document.getElementById("ctBody");
  if(body) body.innerHTML = '<div class="muted" style="padding:14px 2px">'+esc(t("up_reading"))+'</div>';
  return Promise.all([
    restGet("console_contacts?select=id,addresses,name,tags,note"),
    ctRestOr("console_mail?select=id,opp,to_addr,actor,subject,ts,status,page_slug,data&order=ts.asc",
             "console_mail?select=id,opp,to_addr,actor,subject,ts,status,data&order=ts.asc"),
    (typeof fetchInbound==="function" ? fetchInbound() : Promise.resolve([])),
    restGet("console_opps?select=slug,ps:data->>page_slug"),
    restGet("console_pages?select=slug,title")
  ]).then(function(a){
    __ctModel = ctBuild(a[0]||[], a[1]||[], a[2]||[], a[3]||[], a[4]||[]);
    if(__ctView==="detail" && __ctCurrent && __ctModel.byId[__ctCurrent]) ctDetailRender(__ctCurrent);
    else ctListRender();
    return __ctModel;
  }, function(){ __ctModel = { contacts:[], byId:{}, byAddr:{}, templates:{}, pageTitle:{} }; ctListRender(); return __ctModel; });
}

// ---- the Contacts view shell (mirrors the Library surface: a full-height panel, mobile-first) ----
function openContactsView(){
  var sc=document.getElementById("ctScrim"), pn=document.getElementById("ctPanel");
  if(!sc || !pn) return;
  __ctQuery = ""; __ctView = "list"; __ctCurrent = null;
  pn.innerHTML = ctViewHtml();
  ctWireShell();
  sc.hidden = false; pn.scrollTop = 0;
  ctLoad();
}
function closeContactsView(){ var sc=document.getElementById("ctScrim"); if(sc) sc.hidden = true; }
function ctViewHtml(){
  return '<div class="lv-head">'+
      '<h2 class="lv-title" id="ctTitle">'+esc(t("ct_h"))+'</h2>'+
      '<div class="lv-head-acts"><button class="link" id="ctClose" type="button">'+esc(t("pf_close"))+'</button></div>'+
    '</div>'+
    '<div class="ct-shell" id="ctShell">'+
      '<div class="lv-search" id="ctSearchWrap"><input class="lv-q" id="ctQ" type="search" dir="auto" placeholder="'+esc(t("ct_search_ph"))+'" autocomplete="off" aria-label="'+esc(t("ct_search_ph"))+'"></div>'+
      '<div class="lv-body ct-body" id="ctBody"></div>'+
    '</div>';
}
function ctWireShell(){
  var c=document.getElementById("ctClose"); if(c) c.addEventListener("click", function(){ closeContactsView(); });
  var q=document.getElementById("ctQ"); if(q) q.addEventListener("input", function(){ __ctQuery=String(q.value||"").trim().toLowerCase(); if(__ctView==="list") ctListRender(); });
}

function ctMatches(rec, q){
  if(!q) return true;
  var hay = (ctName(rec)+" "+rec.addresses.join(" ")+" "+(rec.tags||[]).join(" ")).toLowerCase();
  return hay.indexOf(q) >= 0;
}
// The reply tag: a count chip that OPENS the full conversation with the contact. It is the same control in the
// contacts list, the contact header, and the template-memory recipient rows - one class, one behavior.
function ctReplyTag(rec, extraCls){
  var n = rec.replyCount||0;
  var cls = "ct-replytag"+(n>0?" on":"")+(extraCls?(" "+extraCls):"");
  return '<button type="button" class="'+cls+'" data-ct-convo="'+esc(rec.id)+'" title="'+esc(t("ct_open_convo"))+'">'+
    '<span class="ct-rt-n">'+n+'</span> <span class="ct-rt-l">'+esc(n===1?t("ct_reply_one"):t("ct_reply_n"))+'</span></button>';
}
function ctListRender(){
  __ctView="list"; __ctCurrent=null;
  var title=document.getElementById("ctTitle"); if(title) title.textContent=t("ct_h");
  var sw=document.getElementById("ctSearchWrap"); if(sw) sw.hidden=false;
  var q=document.getElementById("ctQ"); if(q) q.hidden=false;
  var body=document.getElementById("ctBody"); if(!body) return;
  var all=(__ctModel && __ctModel.contacts) ? __ctModel.contacts : [];
  var rows=all.filter(function(r){ return ctMatches(r, __ctQuery); });
  if(!rows.length){ body.innerHTML='<div class="lv-empty">'+esc(all.length?t("ct_no_match"):t("ct_empty"))+'</div>'; return; }
  body.innerHTML =
    '<div class="ct-count">'+esc(String(rows.length))+' '+esc(rows.length===1?t("ct_count_one"):t("ct_count_n"))+'</div>'+
    '<div class="ct-cards">'+rows.map(ctCardHtml).join("")+'</div>';
  ctWireList();
}
function ctCardHtml(rec){
  var tags=(rec.tags||[]).slice(0,4).map(function(x){ return '<span class="ct-tag">'+esc(String(x))+'</span>'; }).join("");
  return '<div class="ct-card" data-ct-open="'+esc(rec.id)+'" role="button" tabindex="0">'+
    '<div class="ct-card-top">'+
      '<span class="ct-name" dir="auto">'+esc(ctName(rec))+'</span>'+
      ctReplyTag(rec)+
    '</div>'+
    '<bdi class="ct-addr mono-iso" dir="ltr">'+esc(rec.primaryAddr||"")+'</bdi>'+
    (rec.addresses.length>1 ? '<span class="ct-more">+'+(rec.addresses.length-1)+' '+esc(t("ct_more_addr"))+'</span>' : '')+
    (tags?'<div class="ct-tags">'+tags+'</div>':'')+
    '<div class="ct-metrics"><span class="ct-metric"><b>'+(rec.sends||0)+'</b> '+esc(t("ct_sends"))+'</span>'+
      '<span class="ct-metric"><b>'+(rec.templates.length||0)+'</b> '+esc(t("ct_tmpls"))+'</span></div>'+
  '</div>';
}
function ctWireList(){
  [].forEach.call(document.querySelectorAll("#ctBody [data-ct-open]"), function(el){
    el.addEventListener("click", function(e){ if(e.target && e.target.closest && e.target.closest("[data-ct-convo]")) return; ctDetailRender(el.getAttribute("data-ct-open")); });
    el.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); ctDetailRender(el.getAttribute("data-ct-open")); } });
  });
  ctWireReplyTags(document.getElementById("ctBody"));
}
function ctWireReplyTags(scope, opener){
  if(!scope) return;
  var open = opener || ctOpenConvo;
  [].forEach.call(scope.querySelectorAll("[data-ct-convo]"), function(b){
    b.addEventListener("click", function(e){ e.stopPropagation(); open(b.getAttribute("data-ct-convo")); });
  });
}
// Open the conversation: land on the contact detail and scroll to the thread. Works from anywhere (list,
// template memory, header) - the reply tag's ONE behavior.
function ctOpenConvo(cid){
  if(!(__ctModel && __ctModel.byId[cid])){ return; }
  ctDetailRender(cid);
  try{ var th=document.getElementById("ctConvo"); if(th) th.scrollIntoView({ block:"start", behavior:(ctReduceMotion()?"auto":"smooth") }); }catch(e){}
}
function ctReduceMotion(){ try{ return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){ return false; } }

// ---- one contact: ONLY the templates sent to them + the FULL conversation ----
function ctDetailRender(cid){
  var rec = __ctModel && __ctModel.byId[cid]; if(!rec){ ctListRender(); return; }
  __ctView="detail"; __ctCurrent=cid;
  var title=document.getElementById("ctTitle"); if(title) title.textContent=ctName(rec);
  var sw=document.getElementById("ctSearchWrap"); if(sw) sw.hidden=true;
  var body=document.getElementById("ctBody"); if(!body) return;

  var addrs = rec.addresses.map(function(a){ return '<bdi class="ct-addr mono-iso" dir="ltr">'+esc(a)+'</bdi>'; }).join("");
  var tags = (rec.tags||[]).map(function(x){ return '<span class="ct-tag">'+esc(String(x))+'</span>'; }).join("");

  // templates sent to THIS contact only (never a template they were not sent)
  var tpl = rec.templates.length
    ? rec.templates.map(function(te){
        return '<div class="ct-tpl-row">'+
          '<span class="ct-tpl-t" dir="auto">'+esc(te.title)+'</span>'+
          '<bdi class="ct-tpl-slug mono-iso" dir="ltr">'+esc(te.slug)+'</bdi>'+
          '<span class="ct-tpl-n">'+te.count+' '+esc(te.count===1?t("ct_send_one"):t("ct_send_n"))+'</span>'+
        '</div>';
      }).join("")
    : '<div class="ct-empty">'+esc(t("ct_no_tpl"))+'</div>';

  // the full conversation, threaded (the SAME .msg.in/.msg.out bubbles the opp thread uses)
  var convo = rec.convo.length ? rec.convo.map(ctBubbleHtml).join("") : '<div class="ct-empty">'+esc(t("ct_no_convo"))+'</div>';

  body.innerHTML =
    '<button class="link ct-back" id="ctBack" type="button">'+esc(t("ct_back"))+'</button>'+
    '<div class="ct-detail-head">'+
      '<div class="ct-dh-top"><span class="ct-name-lg" dir="auto">'+esc(ctName(rec))+'</span>'+ctReplyTag(rec, "lg")+'</div>'+
      '<div class="ct-addrs">'+addrs+'</div>'+
      (tags?'<div class="ct-tags">'+tags+'</div>':'')+
      (rec.note?'<div class="ct-note" dir="auto">'+esc(rec.note)+'</div>':'')+
    '</div>'+
    '<section class="ct-sec"><h3 class="ct-sh">'+esc(t("ct_tpl_h"))+'</h3><div class="ct-tpl-list">'+tpl+'</div></section>'+
    '<section class="ct-sec" id="ctConvo"><h3 class="ct-sh">'+esc(t("ct_convo_h"))+' <span class="nbadge">'+(rec.replyCount||0)+'</span></h3><div class="thread ct-thread">'+convo+'</div></section>';

  var back=document.getElementById("ctBack"); if(back) back.addEventListener("click", function(){ ctListRender(); var b2=document.getElementById("ctBody"); if(b2) b2.scrollTop=0; });
  ctWireReplyTags(body);
}
// One conversation bubble, matching the opp thread's markup exactly so it inherits the same styling.
function ctBubbleHtml(m){
  if(m.dir==="in"){
    return '<div class="msg in" data-in="1"><div class="mh"><span class="mnum">#'+(m.num||"")+'</span><span class="maddr">'+esc(m.from||t("unnamed"))+'</span></div>'+
      (m.subject?'<div class="msubj">'+esc(m.subject)+'</div>':'')+
      (m.snippet?'<div class="msnip">'+esc(m.snippet)+'</div>':'')+
      '<div class="mwhen">'+esc(fmtWhen(m.ts))+'</div></div>';
  }
  var who = t("d_you") + (m.actor ? (" · "+actorName(m.actor)) : "");
  return '<div class="msg out"><div class="mh"><span class="mwho">'+esc(who)+'</span>'+
      (m.pageSlug?'<span class="ct-b-tpl" dir="auto">'+esc((__ctModel&&__ctModel.pageTitle[m.pageSlug])||upPretty(m.pageSlug))+'</span>':'')+'</div>'+
    (m.subject?'<div class="msubj">'+esc(m.subject)+'</div>':'')+
    '<div class="mwhen">'+esc(fmtWhen(m.ts))+'</div></div>';
}

// ===================================================================================================
// TEMPLATE MEMORY - opening a template in the Library shows who it was sent to (contacts), the sender (the
// team member, console_mail.actor), the date/time, and the send count. Rendered inline under the template
// card (the #lvMem-<slug> container libCardHtml provides). Reuses the SAME network build as Contacts.
// ===================================================================================================
function libMemToggle(slug, btn){
  var box=document.getElementById("lvMem-"+slug); if(!box) return;
  var open = box.hasAttribute("hidden");
  // close the other inline panels on this card so they never stack
  ["lvPrev-","lvProm-","lvDel-"].forEach(function(p){ var o=document.getElementById(p+slug); if(o) o.setAttribute("hidden",""); });
  if(!open){ box.setAttribute("hidden",""); if(btn) btn.classList.remove("on"); return; }
  box.removeAttribute("hidden"); if(btn) btn.classList.add("on");
  box.innerHTML = '<div class="muted" style="padding:8px 2px">'+esc(t("up_reading"))+'</div>';
  var have = __ctModel ? Promise.resolve(__ctModel) : ctBuildForMemory();
  have.then(function(model){ libMemRender(slug, model); }, function(){ box.innerHTML='<div class="ct-empty">'+esc(t("ct_mem_none"))+'</div>'; });
}
// Build the network WITHOUT a Contacts view mounted (the Library is a separate surface). Caches into __ctModel
// so a later Contacts open (or another template) reuses it.
function ctBuildForMemory(){
  return Promise.all([
    restGet("console_contacts?select=id,addresses,name,tags,note"),
    ctRestOr("console_mail?select=id,opp,to_addr,actor,subject,ts,status,page_slug,data&order=ts.asc",
             "console_mail?select=id,opp,to_addr,actor,subject,ts,status,data&order=ts.asc"),
    (typeof fetchInbound==="function" ? fetchInbound() : Promise.resolve([])),
    restGet("console_opps?select=slug,ps:data->>page_slug"),
    restGet("console_pages?select=slug,title")
  ]).then(function(a){ __ctModel = ctBuild(a[0]||[], a[1]||[], a[2]||[], a[3]||[], a[4]||[]); return __ctModel; });
}
function libMemRender(slug, model){
  var box=document.getElementById("lvMem-"+slug); if(!box) return;
  var T = model && model.templates && model.templates[slug];
  var sends = (T && T.sends) ? T.sends.slice() : [];
  if(!sends.length){ box.innerHTML='<div class="ct-mem"><div class="ct-mem-h">'+esc(t("ct_mem_h"))+' <span class="ct-mem-n">0</span></div><div class="ct-empty">'+esc(t("ct_mem_none"))+'</div></div>'; return; }
  sends.sort(function(a,b){ return a.ts<b.ts?1:(a.ts>b.ts?-1:0); });   // newest first
  var rows = sends.map(function(s){
    var rec = model.byId[s.cid];
    var name = rec ? ctName(rec) : (smartPerson(s.addr)||s.addr);
    var who = s.actor ? actorName(s.actor) : t("ct_sender_unknown");
    var tag = rec ? ctReplyTag(rec) : "";
    return '<div class="ct-mem-row">'+
      '<div class="ct-mem-who"><span class="ct-name" dir="auto">'+esc(name)+'</span>'+
        '<bdi class="ct-addr mono-iso" dir="ltr">'+esc(s.addr)+'</bdi></div>'+
      '<div class="ct-mem-meta"><span class="ct-mem-by">'+esc(t("ct_sent_by"))+' <b dir="auto">'+esc(who)+'</b></span>'+
        '<span class="ct-mem-when">'+esc(fmtWhen(s.ts))+'</span></div>'+
      (tag?'<div class="ct-mem-tag">'+tag+'</div>':'')+
    '</div>';
  }).join("");
  box.innerHTML = '<div class="ct-mem">'+
    '<div class="ct-mem-h">'+esc(t("ct_mem_h"))+' <span class="ct-mem-n">'+sends.length+'</span> '+esc(sends.length===1?t("ct_send_one"):t("ct_send_n"))+'</div>'+
    rows+
  '</div>';
  ctWireReplyTags(box, ctOpenConvoFromLibrary);   // a tag inside the Library hops surfaces to the Contacts conversation
}
// A reply tag inside the Library must leave the Library and open the Contacts conversation.
function ctOpenConvoFromLibrary(cid){
  closeLibraryView();
  openContactsView();
  // openContactsView reloads async; wait for the model, then land on the contact.
  var tries=0;
  (function land(){ if(__ctModel && __ctModel.byId[cid]){ ctOpenConvo(cid); return; } if(tries++>40) return; setTimeout(land, 50); })();
}
