/* Thrive Opportunity Library: shared client logic (vanilla JS, no build step) */
const SITE = "console.thriveiii.com";  // live host for opp/ result pages
const OPP_PATH = "/opp/";
const STORE = "thrive_opps_v1";     // local overlay (drafts + edits + archive flags)
const LOG   = "thrive_activity_v1"; // activity log

/* ---------- utilities ---------- */
function slugify(s){
  return (s||"").toString().trim().toLowerCase()
    .replace(/['’".]/g,"")
    .replace(/[^a-z0-9؀-ۿ]+/g,"-")
    .replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-");
}
function esc(s){ return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function liveUrl(slug){ return "https://"+SITE+OPP_PATH+slug; }
function relOpp(slug){ return "../opp/"+slug+"/"; }
/* One toast in the document, and one only. It grew an action rather than gaining a sibling,
   because two notification surfaces means two places a message can be missed. */
function toast(msg, action){
  let el=document.getElementById("toast");
  if(!el){ el=document.createElement("div"); el.id="toast"; el.className="toast"; document.body.appendChild(el); }
  el.innerHTML="";
  const text=document.createElement("span");
  text.className="toast-text"; text.textContent=msg;
  el.appendChild(text);
  el.classList.toggle("has-act", !!action);
  let ms=2600;
  if(action && typeof action.fn==="function"){
    /* Ten seconds, because an undo you have to catch is not an undo. Long enough to read the
       sentence, notice it was wrong, and reach the control. */
    ms=action.ms||10000;
    const b=document.createElement("button");
    b.type="button"; b.className="toast-act"; b.textContent=action.label||t("lc_undo");
    b.addEventListener("click",()=>{
      el.classList.remove("show");
      clearTimeout(window.__tt);
      // An undo that throws must say so, not vanish: the user thinks it took when it did not.
      try{ action.fn(); }catch(e){ actionStatus("err", errText(e)); }
    });
    el.appendChild(b);
  }
  el.classList.add("show");
  clearTimeout(window.__tt); window.__tt=setTimeout(()=>el.classList.remove("show"), ms);
}
/* ---------- the one action runner ----------
   Every action passes through here, so no action can complete without the user seeing it start,
   succeed, or fail. On invoke, the tapped control shows a working state and is guarded from a second
   tap until the action settles. On success, a visible confirmed outcome. On any failure or thrown
   error, the real text (the message, and for a failed request the HTTP status and the response body,
   which ghPutFile already puts in the Error) is rendered into a surface that always sits above every
   overlay, never a toast that can render behind the modal, never blank. No fabricated success, and no
   silent failure: this is the single choke point that guarantees both, everywhere, at once. */
function errText(e){
  if(e==null) return t("act_err_unknown");
  if(typeof e==="string") return e;
  var m=(e && e.message!=null) ? String(e.message) : String(e);
  return m || t("act_err_unknown");
}
function actionStatus(kind, msg){
  var el=document.getElementById("actionStatus");
  if(!el){ el=document.createElement("div"); el.id="actionStatus"; el.className="act-status";
    el.setAttribute("role","status"); el.setAttribute("aria-live","polite"); document.body.appendChild(el); }
  el.className="act-status act-"+kind+" show";
  var icn = kind==="err" ? "alert" : (kind==="ok" ? "check" : "clock");
  el.innerHTML='<span class="act-ic">'+(typeof thriveIcon==="function"? thriveIcon(icn,{size:16}) : "")+'</span>'+
    '<span class="act-msg"></span>'+(kind==="err"? '<button type="button" class="act-x" aria-label="dismiss">×</button>' : '');
  el.querySelector(".act-msg").textContent=msg;   // textContent, so the raw error text is shown verbatim and safely
  var x=el.querySelector(".act-x"); if(x) x.addEventListener("click", function(){ el.classList.remove("show"); });
  clearTimeout(window.__as);
  // An error persists until the next action or a manual dismiss, because an error you cannot read in
  // time is an error nobody saw. Working and success states clear on their own.
  if(kind!=="err") window.__as=setTimeout(function(){ el.classList.remove("show"); }, kind==="work"? 20000 : 2600);
}
function clearActionStatus(){ var el=document.getElementById("actionStatus"); if(el) el.classList.remove("show"); }
/* Copy helper with a fallback for engines without the async clipboard: a temporary textarea and
   execCommand, so Copy confirms an actual copy rather than a swallowed failure. */
async function copyToClipboard(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(e){
    try{ var ta=document.createElement("textarea"); ta.value=text; ta.setAttribute("readonly","");
      ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta);
      ta.select(); var ok=document.execCommand("copy"); document.body.removeChild(ta); return !!ok;
    }catch(_){ return false; }
  }
}
/* The activation crowning moment. On a confirmed activation the runner success surface becomes a
   compact card in the same always-visible top layer (z-index 300), non-blocking, no scrim. It carries
   the live link and its actions where the eye already is, and it persists until dismissed so there is
   time to copy or share. The full brand gradient is spent here and only here: one sweep on appear,
   then a calm static gradient. It never appears before the commit is confirmed. */
function activationCard(slug){
  var url=liveUrl(slug);
  var el=document.getElementById("actionStatus");
  if(!el){ el=document.createElement("div"); el.id="actionStatus"; el.setAttribute("role","status");
    el.setAttribute("aria-live","polite"); document.body.appendChild(el); }
  clearTimeout(window.__as);                            // the card does not auto-vanish
  el.className="act-status act-card sweep show";
  el.style.setProperty("--ac-ang","0deg");             // resolves the gradient even without @property
  el.innerHTML=
    '<div class="act-card-in">'+
      '<button type="button" class="act-x" aria-label="dismiss">×</button>'+
      '<div class="act-card-h">'+esc(t("ac_live_h"))+'</div>'+
      '<a class="act-card-url" href="'+esc(url)+'" target="_blank" rel="noopener" dir="ltr">'+esc(url)+'</a>'+
      '<div class="act-card-acts">'+
        '<a class="btn sm" href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(t("ac_open"))+'</a>'+
        '<button type="button" class="btn sm" data-ac="copy">'+esc(t("ac_copy"))+'</button>'+
        '<button type="button" class="btn sm" data-ac="share">'+esc(t("ac_share"))+'</button>'+
      '</div>'+
    '</div>';
  el.querySelector(".act-x").addEventListener("click", function(){ el.classList.remove("show"); });
  function confirmBtn(b){ var old=b.textContent; b.textContent=t("ac_copied"); setTimeout(function(){ b.textContent=old; }, 1600); }
  var cp=el.querySelector('[data-ac="copy"]');
  cp.addEventListener("click", async function(){ await copyToClipboard(url); confirmBtn(cp); });
  var sh=el.querySelector('[data-ac="share"]');
  sh.addEventListener("click", async function(){
    if(typeof navigator!=="undefined" && typeof navigator.share==="function"){
      try{ await navigator.share({ url:url, title:t("ac_live_h") }); }catch(e){}   // a cancelled share is not an error
    } else { await copyToClipboard(url); confirmBtn(sh); }   // fall back to Copy where share is not available
  });
}
async function runAction(control, opts){
  opts=opts||{};
  var btn=(typeof control==="string") ? document.getElementById(control) : control;
  if(btn && btn.dataset.running==="1") return;                 // guard: no second invocation until it settles
  var oldText=btn? btn.textContent : "", oldDis=btn? btn.disabled : false;
  if(btn){ btn.dataset.running="1"; btn.disabled=true; btn.classList.add("is-running"); if(opts.working) btn.textContent=opts.working; }
  actionStatus("work", opts.workingMsg || opts.working || t("act_working"));
  try{
    var result=await opts.run();
    // A success can render its own surface (the activation card) instead of the plain ok line.
    if(typeof opts.okRender==="function") opts.okRender(result);
    else actionStatus("ok", opts.doneMsg || (typeof result==="string" && result) || t("act_done"));
    return result===undefined? true : result;
  }catch(e){
    actionStatus("err", errText(e));                           // the real reason, always visible
    if(typeof opts.onError==="function") try{ opts.onError(e); }catch(_){}
    return undefined;
  }finally{
    if(btn){ btn.dataset.running=""; btn.disabled=oldDis; btn.textContent=oldText; btn.classList.remove("is-running"); }
  }
}
function download(name, text, type){
  const blob=new Blob([text], {type:type||"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100);
}
/* quota-safe localStorage: on overflow, reclaim space from transient logs and retry once.
   Writes to synced keys also schedule a (debounced) cross-device sync push. */
/* Everything here is mirrored across devices. Writing any of them schedules a push, so a
   change made anywhere reaches everywhere without being asked. */
const SYNCED_KEYS={ thrive_opps_v1:1, thrive_mail_v1:1, thrive_quota_v1:1, thrive_activity_v1:1,
  /* Derived, but a device whose log has truncated cannot rebuild it, so it travels. */
  thrive_rollup_v1:1,
  /* Inbound mail. The relay writes it, every device reads it, and it is evidence
     about a prospect rather than posture about a device, so it travels. */
  thrive_inbound_v1:1,
  /* The closing block is reused, so it travels: the Library rule applies to a
     signature exactly as it applies to a template. */
  thrive_signature_v1:1,
  thrive_email_templates_v1:1, thrive_templates_v1:1, thrive_removed_v1:1, thrive_etpl_seed_v1:1 };
/* WebKit deletes ALL script writeable storage for an origin with no user interaction in the
   last seven days of browser use. Not part of it: all of it, at once. And localStorage throws
   past roughly 5 MiB. So a write that fails is not a detail, it is the moment the console stops
   being able to remember anything, and it has to say so rather than return false into a caller
   that ignores it. */
let __quotaHit=0;
function storageBytes(){
  let total=0; const by={};
  try{
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      const v=localStorage.getItem(k)||"";
      const n=(k.length+v.length)*2;      // UTF-16 code units, which is what the quota counts
      by[k]=n; total+=n;
    }
  }catch(e){}
  return { total:total, by:by,
           top:Object.keys(by).sort((a,b)=>by[b]-by[a]).slice(0,6).map(k=>({key:k,bytes:by[k]})) };
}
const STORAGE_CEILING=5*1024*1024;
function lsSet(key, str){
  try{ localStorage.setItem(key, str); if(SYNCED_KEYS[key]) try{ scheduleSyncPush(); }catch(_){} return true; }
  catch(e){
    try{
      const h=JSON.parse(localStorage.getItem("thrive_hits_v1")||"[]"); if(h.length>150) localStorage.setItem("thrive_hits_v1", JSON.stringify(h.slice(-150)));
      const a=JSON.parse(localStorage.getItem("thrive_activity_v1")||"[]"); if(a.length>200) localStorage.setItem("thrive_activity_v1", JSON.stringify(a.slice(-200)));
      localStorage.setItem(key, str); if(SYNCED_KEYS[key]) try{ scheduleSyncPush(); }catch(_){} return true;
    }catch(e2){
      /* Both writes failed, so this device can no longer remember anything new. It is told
         once, loudly, with what to do, rather than a toast that scrolls away: the next thing
         the reader types would otherwise be lost without a word. */
      __quotaHit=Date.now();
      try{ toast(t("st_full_act"), { label:t("nav_settings"), ms:14000,
        fn:()=>{ try{ goTo("settings"); }catch(_){ location.hash="#settings"; } } }); }catch(_){}
      try{ logActivity("storage_full", key, String((storageBytes().total/1048576).toFixed(2))+" MiB"); }catch(_){}
      return false;
    }
  }
}

/* ---------- activity log ---------- */
function getActivity(){ try{ return JSON.parse(localStorage.getItem(LOG)||"[]"); }catch(e){ return []; } }
function setActivity(a){ lsSet(LOG, JSON.stringify(a.slice(-500))); }
/* One field, added now because it is free now and expensive later. Adding it
   after a year of history means a migration over records that cannot be
   attributed. WO-013 §10.7. */
const ACTOR="thyab";
function logActivity(action, slug, detail){
  const a=getActivity();
  a.push({ ts:new Date().toISOString(), action:action||"", slug:slug||"", detail:detail||"",
           actor:ACTOR });
  setActivity(a);
}
window.logActivity = logActivity;

/* ---------- one way to move around ----------
   The console is one document in the shell and a set of documents on its own pages, and a link
   has to mean the same thing in both. It did not.

   Links written inside app.js said `compose.html?slug=x`, which inside the shell walked the
   reader out of the application into a second document. Links written in the pages were
   rewritten by the build into `#compose?slug=x`, and every reader of a parameter was asking
   `location.search`, where nothing had been put. Two navigation models in one product, and the
   parameters fell down the gap between them: "use this template", "compose with this", the
   Email and Edit buttons on every library card, and both board chips all opened an empty
   screen or left the shell.

   So: every internal destination is built here, and every parameter is read here. */
/* A run of digits, an address or a URL reads left to right inside an Arabic
   sentence. Also one definition rather than one per surface, for the same reason
   as ic() below: the second surface that wanted it threw instead. */
function ltr(s){ return '<span class="mono-iso">'+esc(s)+'</span>'; }

/* One symbol helper for the whole file. It was a local inside the board render,
   so every other surface that wanted a symbol either duplicated it or, as the
   replies panel did, threw. One definition, module scope, guarded for the pages
   that load app.js before icons.js has run. */
function ic(n, sz){ return (typeof thriveIcon==="function") ? thriveIcon(n,{size:sz||14}) : ""; }

function inShell(){ return !!document.getElementById("view-board"); }
function viewHref(view, query){
  const q = query ? ("?" + query) : "";
  if(inShell()) return "#" + view + q;
  return (view === "home" ? "index.html" : view + ".html") + q;
}
function goTo(view, query){
  if(inShell()) location.hash = viewHref(view, query);
  else location.href = viewHref(view, query);
}
/* In the shell a parameter rides after the hash; on a single page it rides in the query
   string. One reader, so neither caller has to know which document it is living in. */
function viewParams(){
  const h = location.hash || "", i = h.indexOf("?");
  if(i >= 0) return new URLSearchParams(h.slice(i + 1));
  return new URLSearchParams(location.search);
}

/* ---------- removals ----------
   A mirror that only ever adds is not a mirror. Every merge in this console was a union or a
   newest-wins, so deleting an opportunity on the phone left it alive on the iPad, the iPad
   pushed it back, and it returned. The console overruled a decision you had made.

   So a removal is a fact with a timestamp, exactly like a record is, and it travels the same
   way. An item comes back only if it was re-created AFTER it was removed. Tombstones are
   pruned at six months, which is far longer than any device stays out of sync. */
const TOMB = "thrive_removed_v1";
const TOMB_KEEP_MS = 180*86400000;
function tombs(){ try{ return JSON.parse(localStorage.getItem(TOMB)||"{}"); }catch(e){ return {}; } }
function setTombs(o){
  const now=Date.now(), out={};
  // Number(), never |0. A bitwise operator truncates to 32 bits, and a millisecond timestamp
  // has not fitted in 32 bits since 1970 plus 25 days: every tombstone was being wrapped into
  // garbage and then discarded as ancient, which is why removals travelled nowhere.
  Object.keys(o||{}).forEach(k=>{ const ts=Number(o[k])||0; if(ts && now-ts < TOMB_KEEP_MS) out[k]=ts; });
  return lsSet(TOMB, JSON.stringify(out));
}
function markRemoved(kind, id){ const o=tombs(); o[kind+":"+id]=Date.now(); setTombs(o); }
function removedAt(kind, id){ return Number(tombs()[kind+":"+id])||0; }
/* One merge rule for every keyed collection, so opportunities, message templates and page
   templates cannot drift into three different ideas of what "deleted" means. */
function mergeKeyed(local, remote, key, tombKind, allTombs, carry){
  const by={};
  (local||[]).forEach(x=>{ if(x && x[key]!=null) by[x[key]]={ x:x, mine:true }; });
  (remote||[]).forEach(r=>{
    if(!r || r[key]==null) return;
    const cur=by[r[key]];
    if(!cur){ by[r[key]]={ x:r, mine:false }; return; }
    if((r.up||0) > (cur.x.up||0)) by[r[key]]={ x: carry? carry(r, cur.x) : r, mine:false };
  });
  const out=[];
  Object.keys(by).forEach(k=>{
    const rec=by[k].x;
    const gone=Math.max(allTombs[tombKind+":"+k]||0, 0);
    if(gone && gone > (rec.up||0)) return;               // removed after it was last written
    out.push(rec);
  });
  return out;
}

/* ---------- custom page templates (local registry) ---------- */
/* The three explicit item types of the template taxonomy. The type is a fixed attribute, decided
   at creation and stored on the record, and it never changes implicitly: no code path flips one
   type into another. An editable template is edited, activated, and generates offers; a ready
   offer is activated and sent, never edited; a text snippet is recalled into outreach and may hold
   a live reference to an editable template. */
const T_EDITABLE="editable-template", T_OFFER="ready-offer", T_SNIPPET="text-snippet";

const TPLSTORE = "thrive_templates_v1";
function getCustomTemplates(){ try{ return JSON.parse(localStorage.getItem(TPLSTORE)||"[]"); }catch(e){ return []; } }
function setCustomTemplates(a){ return lsSet(TPLSTORE, JSON.stringify(a)); }
function getCustomTemplate(id){ return getCustomTemplates().find(x=>x.id===id); }
function saveCustomTemplate(rec){ rec.up=Date.now(); const a=getCustomTemplates(); const i=a.findIndex(x=>x.id===rec.id);
  if(i<0 && !rec.type) rec.type=T_EDITABLE;   // a page template is an editable template, typed at creation
  if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setCustomTemplates(a); }
function removeCustomTemplate(id){ markRemoved("tpl", id); setCustomTemplates(getCustomTemplates().filter(x=>x.id!==id)); }

/* ---------- analytics (beacon hits stored same-origin) ---------- */
const HITS = "thrive_hits_v1";
const ENDPT = "thrive_endpoint";
function getHits(){ try{ return JSON.parse(localStorage.getItem(HITS)||"[]"); }catch(e){ return []; } }
/* Real analytics come from the relay (a prospect's open only ever exists in THEIR browser
   otherwise). We keep them in their own bucket and merge on read, de-duplicated. */
const RHITS="thrive_hits_remote_v1";
function getRemoteHits(){ try{ return JSON.parse(localStorage.getItem(RHITS)||"[]"); }catch(e){ return []; } }
function setRemoteHits(a){ try{ localStorage.setItem(RHITS, JSON.stringify(a.slice(-2000))); }catch(e){} }
function hitKey(e){ return (e.type||"open")+"|"+(e.slug||"")+"|"+(e.ts||"")+"|"+(e.vid||""); }
/* Which page events count.

   Once collection is live, ONLY collected events count. The local bucket is this browser's
   own history: it was written before self-visits were tagged, so it is full of the
   operator's own previews that are indistinguishable from recipient opens. Mixing it in is
   precisely what made a page nobody was emailed show 3 "opens" while a real campaign showed 0.
   Local events are the fallback when nothing is being collected, and are labelled as such. */
function legacyLocalHits(){ return getHits().filter(e=>e && e.self===undefined); }
function usingCollected(){ return hitsState()==="live"; }
function allHits(opts){
  const src = usingCollected() ? getRemoteHits() : getHits();
  const seen={}, out=[];
  src.forEach(e=>{
    if(!e || (!(opts&&opts.includeSelf) && e.self)) return;
    const k=hitKey(e); if(seen[k]) return; seen[k]=1; out.push(e);
  });
  return out;
}
function selfHitCount(){ return (usingCollected()?getRemoteHits():getHits()).filter(e=>e&&e.self).length; }
function clearLocalHits(){ try{ localStorage.removeItem(HITS); }catch(e){} invalidateHits(); }
/* Is collection actually working? Distinguishes three states that look identical otherwise:
   "off" (no relay), "stale" (relay answered but doesn't understand analytics, an old script),
   "live" (collecting, even if nobody has opened a page yet). */
let __hitsState="off", __hitsErr="";
function hitsState(){ return __hitsState; }
function hitsError(){ return __hitsErr; }
/* Ask the relay what it actually is. Saving the script is not the same as deploying it, and a
   second deployment serves the OLD code from a different URL. This reports, verbatim, which
   URL the console calls and what that URL answers, so the question is settled in one click. */
async function relayProbe(){
  await syncBootstrap();
  const ep=getSyncEndpoint();
  const out={ url:ep, tail:(ep||"").replace(/\/exec.*$/,"").slice(-12), version:"", state:"", hits:"", v4:false };
  if(!ep){ out.version="(no endpoint configured)"; return out; }
  try{
    const r=await fetchT(ep,{cache:"no-store"},9000);
    const v=classifyRelayBody(await r.text());
    out.version = v.kind==="signin"? t("sy_v_signin") : (v.version||"(empty answer)");
    out.signin  = v.kind==="signin";
    out.ver     = v.ver!=null? v.ver : null;
  }catch(e){ out.version="(unreachable: "+e.message+")"; }
  /* The green light is "matches the version this build needs", read from
     REQUIRED_RELAY, not the literal v4 this once tested for. */
  out.v4=(out.ver===REQUIRED_RELAY);
  const auth=syncAuth();
  if(!auth){ out.state=out.hits="(not unlocked, no sync credential)"; return out; }
  try{
    const r=await fetchT(ep,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({op:"state_get",auth:auth})});
    const j=await r.json(); out.state = j.ok? "ok" : ("✕ "+(j.error||"failed"));
  }catch(e){ out.state="✕ "+e.message; }
  try{
    const r=await fetchT(ep,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({op:"hits_get",auth:auth})});
    const j=await r.json();
    out.hits = j.ok? ("ok: "+((j.events||[]).length)+" events") : ("✕ "+(j.error||"failed"));
  }catch(e){ out.hits="✕ "+e.message; }
  return out;
}
// Pull collected analytics from the relay (same endpoint as sync/email).
async function fetchRemoteHits(){
  const auth=syncAuth(); if(!auth){ __hitsState="off"; return false; }
  await syncBootstrap();
  const ep=getSyncEndpoint(); if(!ep){ __hitsState="off"; return false; }
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({ op:"hits_get", auth:auth }) });
    const j=await r.json();
    if(!j.ok || !Array.isArray(j.events)){
      __hitsState="stale"; __hitsErr=String(j.error||"no events array"); return false;
    }
    __hitsState="live"; __hitsErr="";
    // union with what we already have, so nothing collected earlier is lost when the relay rolls
    const seen={}, merged=[];
    j.events.concat(getRemoteHits()).forEach(e=>{ const k=hitKey(e); if(seen[k]) return; seen[k]=1; merged.push(e); });
    merged.sort((a,b)=> (String(a.ts)<String(b.ts)?-1:1));
    setRemoteHits(merged);
    invalidateHits();                                    // opens map and open times must be recomputed
    return true;
  }catch(e){ __hitsState="stale"; __hitsErr=String(e.message||e); return false; }
}
function getEndpoint(){ try{ return localStorage.getItem(ENDPT)||""; }catch(e){ return ""; } }
function setEndpoint(u){ try{ u?localStorage.setItem(ENDPT,u):localStorage.removeItem(ENDPT); }catch(e){} }
/* perf: memoise the opens-per-slug map (avoids re-parsing hits for every card each render) */
let __opensCache=null, __opensTs=0;
function opensMap(){
  const now=Date.now();
  if(__opensCache && (now-__opensTs)<3000) return __opensCache;
  const m={}; allHits().forEach(e=>{ if(e.type==="open"||!e.type){ m[e.slug]=(m[e.slug]||0)+1; } });
  __opensCache=m; __opensTs=now; return m;
}
/* Every recorded view of a page, whatever caused it. This is a real number and it is shown as
   one, but it is not the same number as "somebody read what I sent them". */
function opensForSlug(slug){ return opensMap()[slug]||0; }

/* One timestamp parser for dates and full stamps alike, so a comparison never silently
   becomes NaN and answers "no". */
function tsMs(v){ if(!v) return 0; const s=String(v);
  const ms=Date.parse(s.length===10? s+"T00:00:00Z" : s); return isNaN(ms)? 0 : ms; }

/* WHEN each view happened, so a view can be told apart from a read. A page opened before any
   message went out was opened by somebody who was never written to: the operator, a colleague,
   a shared link. Counting those as opens is how a page nobody had emailed reported readers. */
let __openTimesCache=null, __openTimesTs=0;
function openTimes(){
  const now=Date.now();
  if(__openTimesCache && (now-__openTimesTs)<3000) return __openTimesCache;
  const m={};
  allHits().forEach(e=>{
    if(e.type && e.type!=="open") return;
    const ms=tsMs(e.ts); if(!ms) return;
    (m[e.slug]||(m[e.slug]=[])).push(ms);
  });
  __openTimesCache=m; __openTimesTs=now; return m;
}
function opensSince(slug, since){
  const from=tsMs(since); if(!from) return 0;
  const a=openTimes()[slug]||[]; let n=0;
  for(let i=0;i<a.length;i++) if(a[i]>=from) n++;
  return n;
}
function invalidateHits(){ __opensCache=null; __openTimesCache=null; }

/* ---------- send evidence ----------
   "Sent" means a message left. Two things prove that and nothing else does: the mail ledger,
   which records every message this console sent or handed to Gmail, and your own declaration
   on the record for a message you sent elsewhere.

   sent_on proves nothing. It is the day the page was made, it is filled in on every record
   including ones nobody has been written to, and reading it as a send is exactly what put
   pages with no email behind them into Sent, and their page views into Opened. */
let __sendCache=null, __sendTs=0;
function sendIndex(){
  const now=Date.now();
  if(__sendCache && (now-__sendTs)<3000) return __sendCache;
  const m={};
  getMailLog().forEach(x=>{
    if(!x || !x.opp) return;
    if(x.direction==="in") return;                        // a reply is not a send
    if(x.status && x.status!=="sent" && x.status!=="copied") return;   // queued or failed is not sent
    const r=m[x.opp]||(m[x.opp]={count:0, first:"", last:""});
    r.count++;
    const ts=String(x.ts||"");
    if(ts){ if(!r.first || ts<r.first) r.first=ts; if(ts>r.last) r.last=ts; }
  });
  __sendCache=m; __sendTs=now; return m;
}
function invalidateSends(){ __sendCache=null; }
/* Every hand contact recorded through somebody else's channel: their contact form, an
   Instagram message, a phone call. Most of a batch has no email address at all, so without
   these the board reports that nothing went out when something did.

   It is evidence in exactly the way a ledger row is. The console did not witness either one:
   it witnessed you telling it, and it says so on the record. What it must never do is invent
   one, which is why sent_on is still not consulted anywhere here. */
function manualSends(o){
  if(!o || typeof o!=="object" || !Array.isArray(o.manual_contacts)) return { count:0, first:"", last:"" };
  let first="", last="", count=0;
  o.manual_contacts.forEach(c=>{
    if(!c || !c.sent_on) return;
    count++;
    const ts=String(c.sent_on);
    if(!first || ts<first) first=ts;
    if(ts>last) last=ts;
  });
  return { count:count, first:first, last:last };
}
/* Accepts a record or a slug. A record can also carry hand contacts and a hand declaration;
   a slug can carry neither. */
function sendsFor(o){
  const slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  const r=sendIndex()[slug];
  const m=manualSends(o);
  if(r && r.count){
    if(!m.count) return r;
    // Both kinds happened. The age of the record is measured from the most recent of them,
    // and the first send is the earliest, because opens are counted from that moment.
    return { count:r.count+m.count,
             first:(m.first && m.first<r.first)? m.first : r.first,
             last:(m.last && m.last>r.last)? m.last : r.last };
  }
  if(m.count) return m;
  if(o && typeof o==="object" && o.stage==="sent")
    return { count:1, first:o.sent_on||"", last:o.sent_on||"", declared:true };
  return { count:0, first:"", last:"" };
}
/* Opens that answer a message: views recorded at or after the first send. Zero until something
   was actually sent, because before that there is nothing for anybody to have opened. */
function outreachOpens(o){
  const s=sendsFor(o);
  if(!s.count) return 0;
  return opensSince((typeof o==="string")? o : o.slug, s.first);
}
/* The local day, as the date inputs and the manual contact records want it. Local rather than
   UTC on purpose: a send made at nine in the evening in Alexandria belongs to that evening, not
   to the next morning in London. */
/* Does the published page still answer? true gone, false there, null could not tell.
   The third answer matters: a proxy, an offline iPad or a blocked host is not a missing page,
   and recording one as the other would put a false note on a record nobody would question. */
async function pageIsGone(slug){
  try{
    const r=await fetchT(liveUrl(slug), { method:"GET", cache:"no-store", redirect:"follow" });
    if(r.status===404 || r.status===410) return true;
    if(r.ok) return false;
    return null;
  }catch(e){ return null; }
}
/* The bare email address, without the mailto scheme. The scheme belongs in a send action's href,
   never in the address a person reads or the field they edit. A record imported before this fix
   may still carry "mailto:" on channel.to, so every place that shows or sends an address strips it
   here rather than trusting the stored value. */
function bareAddress(v){ return String(v==null?"":v).replace(/^\s*mailto:/i,"").trim(); }
/* The one truth every send to a party asks before a message leaves: the page is activated AND its
   live link actually loads, confirmed by a real fetch at this moment. Activation alone is not
   enough, a Pages build can still be in flight or a slug can be wrong, and a fetch that cannot
   confirm blocks rather than assuming success. The preview looking right is never the proof; this
   is. Returns {ok:true} or {ok:false, reason}. The copy-link control reads the same isLive truth,
   so "ready" is one notion, not two. */
async function pageSendable(o){
  const rec=(typeof o==="string") ? ((await mergedOpps()).find(x=>x.slug===o)||null) : o;
  if(!rec || !isLive(rec)) return { ok:false, reason:t("send_block_draft") };
  const gone=await pageIsGone(rec.slug);
  if(gone===true)  return { ok:false, reason:t("send_block_dead") };        // 404 or 410, a dead link
  if(gone===null)  return { ok:false, reason:t("send_block_unconfirmed") }; // could not tell, so block
  return { ok:true, reason:"" };                                            // activated and it loads
}
function today(){
  const d=new Date();
  const p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
}
function debounce(fn, ms){ let h; return function(){ const a=arguments, c=this; clearTimeout(h); h=setTimeout(()=>fn.apply(c,a), ms||150); }; }

/* ---------- pipeline stages (mini CRM) ----------
   STAGES are the five you can declare on a record. PIPE_STAGES are the seven a record can
   actually be in: draft and live are derived, never declared, and they were invisible for as
   long as every untouched record defaulted to "sent". */
const STAGES=["sent","opened","replied","won","lost"];
const PIPE_STAGES=["draft","live"].concat(STAGES);
/* Accepts a plain date (2026-07-01) and a full timestamp alike. It used to append a time to
   whatever it was given, so any ISO timestamp parsed as NaN and silently aged nothing: a
   ledger entry could be a month old and still read as today. */
function daysSince(d){ if(!d) return 0;
  const str=String(d); const ms=Date.parse(str.length===10? str+"T00:00:00Z" : str);
  if(isNaN(ms)) return 0; return Math.floor((Date.now()-ms)/86400000); }
/* shared opportunity predicates (used by the library grid and the Overview dashboard) */
function isLive(o){ return !o._local || !!o.published; }
/* The stage rule lives here and only here. Both the opens count and the send evidence can be
   injected, so a caller with its own context (the board derivation layer, a test) reuses this
   rule instead of copying it. A second implementation of these lines is how a board and a
   library start disagreeing about the same record.

   The order is the whole rule:
     1. What you declared stands. Replied, won and lost are decisions, not derivations.
     2. With no send, a record is a live page or a draft. It is never "sent".
     3. With a send, it is opened if somebody read it after that send, otherwise sent. */
function effStage(o, opensOverride, sendOverride){
  const declared=o.stage||"";
  if(declared && declared!=="sent") return declared;
  const s=(sendOverride===undefined)? sendsFor(o) : sendOverride;
  if(!s || !s.count) return isLive(o) ? "live" : "draft";
  const op=(opensOverride===undefined)? outreachOpens(o) : (opensOverride||0);
  return op>0 ? "opened" : "sent";
}
/* WO-015 §5.1: status is causal. Every status a card can display is a reading of a
   documented event, never an assertion. This is the one place the map lives, so the
   display and the Phase F causal scan cannot disagree. effStage (I3) stays the
   authority on the derived stage; this wraps it with the two flags a stage cannot
   express (archived, and won which only a contract may set) and names, for each
   status, the event that backs it. `event:""` means "nothing backs this", which is
   a defect the scan reports, not a state a person can reach by clicking. */
function wonHasContract(o){
  /* The contracts module is not built (§5.2). Until it emits a signature, no `won`
     is backed, so every legacy `won` is surfaced for reconciliation rather than
     trusted. When the module exists it will record the event this reads. */
  return !!(o && o.contract_signed);
}
function causalStatus(o){
  if(!o) return { status:"", event:"" };
  if(o.archived) return { status:"archived", event:"archive" };
  const declared=ThriveLifecycle.norm(o.stage||"");
  if(declared==="won") return { status:"won", event: wonHasContract(o) ? "contract" : "" };
  /* Phase D fields, forward compatible: undefined reads as not converted. */
  if(o.converted_at && o.offer) return { status:"converted", event:"convert" };
  /* A reply is read before the send gate: an inbound attribution backs "replied"
     directly, and a hand recorded reply is backed by its record_reply in the log.
     Checking the send count first would drop a replied card with no ledger send
     down to "live", which is the exact opinion-over-evidence this phase removes. */
  if(inboundFor(o.slug).some(r=>r && r.kind!=="auto")) return { status:"replied", event:"inbound" };
  if(declared==="replied") return { status:"replied", event:"record_reply" };
  const s=sendsFor(o);
  if(!s || !s.count) return isLive(o) ? { status:"live", event:"publish" } : { status:"draft", event:"local" };
  return outreachOpens(o)>0 ? { status:"opened", event:"open" } : { status:"sent", event:"send" };
}

/* Follow-up is a thing you do about a message. A page you have not written to yet does not
   need following up, it needs sending, and calling that "needs follow-up" made the console
   ask for the wrong action on the wrong record. */
function needsFollowup(o){
  if(!isLive(o) || o.archived || effStage(o)!=="sent") return false;
  const s=sendsFor(o);
  return daysSince(s.last||s.first)>=3;
}

/* ---------- opportunity HTML (regenerated on demand, not stored, to save space) ---------- */
const __tplCache={};
async function fetchTemplateHtml(idT){
  if(__tplCache[idT]) return __tplCache[idT];
  const custom=getCustomTemplate(idT);
  if(custom){ __tplCache[idT]=custom.html||""; return __tplCache[idT]; }
  // A stock template lives beside the console on the server. The offline single-file build has
  // no such neighbour, and a missing file is a missing preview, never an unhandled failure.
  try{
    const r=await fetch("../templates/"+idT+"/template.html",{cache:"no-store"});
    if(!r.ok) return "";
    const txt=await r.text(); __tplCache[idT]=txt; return txt;
  }catch(e){ return ""; }
}
function fillTemplate(tpl, v){
  let h=tpl;
  if(!v.QUOTE || !v.QUOTE.trim()) h=h.replace(/<!--QUOTE_START-->[\s\S]*?<!--QUOTE_END-->/,"");
  const subject=encodeURIComponent((v.BIZ||"Opportunity")+" x Thrive");
  const map={ BIZ:esc(v.BIZ), QUOTE:esc(v.QUOTE), QUOTE_BY:esc(v.QUOTE_BY),
    PROOF1:esc(v.PROOF1), PROOF2:esc(v.PROOF2), PROOF3:esc(v.PROOF3), WANT:esc(v.WANT), SUBJECT:subject };
  Object.keys(map).forEach(k=>{ h=h.split("{{"+k+"}}").join(map[k]); });
  return h;
}
/* returns the full page HTML for an opportunity record (upload keeps its html; template drafts regenerate) */
async function renderOppHtml(rec){
  if(!rec) return "";
  if(rec.mode==="upload") return rec.html||"";
  if(!rec.template || rec.template==="custom") return rec.html||"";
  const tpl=await fetchTemplateHtml(rec.template);
  return fillTemplate(tpl, Object.assign({BIZ:rec.business}, rec.fields||{}));
}

/* ---------- backup / restore (everything, minus the GitHub token) ---------- */
function exportBackup(){
  return { _type:"thrive-console-backup", v:2, exported:new Date().toISOString(),
    opps:getDrafts(), templates:getCustomTemplates(), activity:getActivity(),
    hits:getHits(), endpoint:getEndpoint(),
    mail:getMailLog(), emailTemplates:getEmailTemplates(), fromName:getFromName() };
}
function importBackup(obj){
  if(!obj || obj._type!=="thrive-console-backup") throw new Error("Not a Thrive backup file");
  if(Array.isArray(obj.opps)) setDrafts(obj.opps);
  if(Array.isArray(obj.templates)) setCustomTemplates(obj.templates);
  if(Array.isArray(obj.activity)) setActivity(obj.activity);
  if(Array.isArray(obj.hits)){ try{ localStorage.setItem(HITS, JSON.stringify(obj.hits)); }catch(e){} }
  if(typeof obj.endpoint==="string") setEndpoint(obj.endpoint);
  if(Array.isArray(obj.mail)) setMailLog(obj.mail);               // restore the email ledger / threads
  if(Array.isArray(obj.emailTemplates)) setEmailTemplates(obj.emailTemplates);
  if(typeof obj.fromName==="string") setFromName(obj.fromName);
}

/* ---------- one document, many listeners ----------
   Every view used to own its page, so assigning window.onThriveSync was safe. In one shell
   they all share one window, and the view that initialises last silently unsubscribes every
   view that ran before it: open Activity once and the board stops refreshing on sync, and the
   board's own handler had already displaced the sync round that runs on unlock. Listeners are
   registered by key now. A view replaces only its own, and all of them run. */
const __hooks={ sync:{}, lang:{}, unlock:{} };
function onThrive(kind, key, fn){ (__hooks[kind]||(__hooks[kind]={}))[key]=fn; }
function fireThrive(kind){
  const h=__hooks[kind]||{};
  Object.keys(h).forEach(k=>{ try{ h[k](); }catch(e){} });
}
window.onThriveSync  = function(){ fireThrive("sync"); };
window.onLangApplied = function(){ fireThrive("lang"); };
window.onGateUnlocked= function(){ fireThrive("unlock"); };

/* ---------- live cross-device sync ----------
   One shared state document, stored by the same Apps Script relay that sends email.
   Unlocking the gate derives the sync credential (PBKDF2 of the passcode, see gate.js), so the
   passcode alone opens the SAME live console on every device: send counter, mail ledger,
   threads, drafts, email templates, settings. The endpoint bootstraps from library/sync.json
   (committed once from a configured device): zero setup on each new device.
   Merge is union-based: sends/replies/activity dedupe by id, drafts+templates newest-wins.
   The GitHub token is deliberately NEVER synced. Page html stays device-local (repo has it). */
const SYNC_EP="thrive_sync_ep", SYNC_AUTH="thrive_sync_auth", SYNC_LAST="thrive_sync_last", SCAL_UP="thrive_scalars_up";
const SYNC_EP_UP="thrive_sync_ep_up", SYNC_EP_FILE="thrive_sync_ep_file";
let __syncBusy=false, __syncApplying=false, __syncPushT=null, __syncBootstrapped=false;
function getSyncEndpoint(){ try{ return localStorage.getItem(SYNC_EP)||""; }catch(e){ return ""; } }
function setSyncEndpoint(u){ try{ u?localStorage.setItem(SYNC_EP,u):localStorage.removeItem(SYNC_EP); }catch(e){} }
// When was this device's relay URL last chosen by a person who verified it here? A published
// sync.json only replaces the local URL if it is at least as new, so a device that just proved
// its URL serves v4 is never dragged back onto an older one by a stale file.
function syncEpStamp(){ try{ return parseInt(localStorage.getItem(SYNC_EP_UP)||"0",10)||0; }catch(e){ return 0; } }
function stampSyncEp(t){ try{ localStorage.setItem(SYNC_EP_UP, String(t||Date.now())); }catch(e){} }
// Session first, then the device-level copy (see gate.js) so an already-unlocked tab still syncs.
function syncAuth(){
  try{ return sessionStorage.getItem(SYNC_AUTH) || localStorage.getItem(SYNC_AUTH) || ""; }
  catch(e){ return ""; }
}
function syncLast(){ try{ return localStorage.getItem(SYNC_LAST)||""; }catch(e){ return ""; } }
function scalarsUp(){ try{ return parseInt(localStorage.getItem(SCAL_UP)||"0",10)||0; }catch(e){ return 0; } }
function touchScalars(){ try{ localStorage.setItem(SCAL_UP, String(Date.now())); }catch(e){} }
/* Adopting the published relay is one operation, used by the bootstrap AND by the sync
   fallback. Doing it in one place is why email, the stamp and the file marker can no longer
   drift apart: an endpoint adopted through one path used to leave the others stale. */
function adoptPublishedEndpoint(ep, up, cur, ee){
  if(!ep) return;
  if(cur===undefined) cur=getSyncEndpoint();
  if(ee===undefined) ee=getEmailEndpoint();
  let prevFile=""; try{ prevFile=localStorage.getItem(SYNC_EP_FILE)||""; }catch(e){}
  setSyncEndpoint(ep); stampSyncEp(up||0);
  try{ localStorage.setItem(SYNC_EP_FILE, ep); }catch(e){}
  // Email follows the published relay when it was empty, or when it is only there because an
  // earlier publish put it there. An address typed into the Email box is never overwritten.
  if(!ee || ee===cur || ee===prevFile) setEmailEndpoint(ep);
}
/* The endpoint every device must agree on lives in library/sync.json, served from this same
   origin. Reconcile with it on every load, not only when the device has nothing: a phone that
   was configured by hand months ago would otherwise keep calling a URL nobody chose again, and
   publishing a new relay would silently reach no one. */
async function syncBootstrap(){
  if(__syncBootstrapped) return; __syncBootstrapped=true;
  let j=null;
  try{ const r=await fetch("./sync.json",{cache:"no-store"}); if(r.ok) j=await r.json(); }catch(e){}
  // The offline single-file build has no sibling sync.json to fetch, so it carries the
  // published endpoint inside itself. The served console never reaches this line.
  if((!j || !j.ep) && window.THRIVE_SYNC_JSON) j=window.THRIVE_SYNC_JSON;
  if(!j || !j.ep) return;
  const cur=getSyncEndpoint(), ee=getEmailEndpoint();
  if(cur===j.ep) return;
  // A device with nothing takes whatever is published. A device that already has an endpoint is
  // only moved by a STAMPED file that is at least as new as its own choice: a file written before
  // stamps existed can never yank a working device onto a relay it already moved away from.
  if(cur && !(j.up && j.up >= syncEpStamp())) return;
  adoptPublishedEndpoint(j.ep, j.up||0, cur, ee);
}
/* ---------- the mirror contract ----------
   Everything this console holds is in exactly one of three classes, and there is no fourth.

   MIRRORED   travels in the shared state and is complete, removals included: opportunities,
              the mail ledger, the activity log, send stamps, message templates, page template
              records, publishing credentials, settings, and the tombstones that make a
              deletion travel like any other fact.
   PUBLISHED  lives in the repository and is therefore reachable from every device by
              construction: the live pages, and a page template once it is published.
   LOCAL      device posture that would be wrong to share: the collapsed tray, the language,
              the relay URL (which comes from library/sync.json), the session key.

   Page HTML is the one thing that can run to hundreds of kilobytes, and the shared store is a
   few hundred kilobytes in total. So HTML travels while it fits, oldest dropped first, and
   anything that did not fit is NAMED on screen rather than silently missing. A mirror is
   allowed to have physical limits. It is not allowed to have quiet ones. */
/* The relay rejects a state over 400,000 bytes outright, and a rejected push is not a smaller
   mirror, it is no mirror at all. So the console knows the ceiling, measures what it is about
   to send, and sheds in a fixed order rather than discovering the limit as a failure.

   Nothing that is evidence is ever shed: the mail ledger, the opportunities, the removals, the
   message templates and the vault always travel. Page html goes first because the repository
   is its real home; the operations log goes next, oldest first, because it is a log and not a
   fact anything is derived from. If even that is not enough, the console says so instead of
   pretending. */
const SYNC_HTML_BUDGET = 220000;      // total page html carried in one snapshot
const SYNC_HTML_MAX    = 90000;       // and the most any single record may take of it
const SYNC_STATE_MAX   = 400000;      // the relay's own hard cap, mirrored here so we never meet it
const SYNC_STATE_SAFE  = 330000;      // and the size we stay under, leaving room to grow

function syncSnapshot(){
  let snap=buildSnapshot(SYNC_HTML_BUDGET);
  let size=JSON.stringify(snap).length;
  if(size<=SYNC_STATE_SAFE){ setSyncSize(size, ""); return snap; }

  // 1. the pages go home to the repository
  snap=buildSnapshot(0);
  size=JSON.stringify(snap).length;
  if(size<=SYNC_STATE_SAFE){ setSyncSize(size, "html"); return snap; }

  // 2. the operations log is trimmed, oldest first, until it fits
  let acts=snap.activity||[];
  while(size>SYNC_STATE_SAFE && acts.length>50){
    acts=acts.slice(Math.ceil(acts.length/4));           // drop the oldest quarter each pass
    snap.activity=acts;
    size=JSON.stringify(snap).length;
  }
  setSyncSize(size, size<=SYNC_STATE_SAFE ? "html+log" : "over");
  return snap;
}
/* Size and headroom, read by Settings, so a store filling up is a number you watch rather than
   a sync that stops one day. */
let __syncSize=0, __syncShed="";
function setSyncSize(n, shed){ __syncSize=n; __syncShed=shed; }
function syncSize(){ return { bytes:__syncSize, max:SYNC_STATE_MAX, shed:__syncShed,
  pct: Math.min(100, Math.round(__syncSize/SYNC_STATE_MAX*100)) }; }

function buildSnapshot(htmlBudget){
  /* A draft that was never published exists nowhere else, so its page travels while there is
     room. A published one does not need to: the repo already holds it, and every device can
     read it from there. */
  let budget=htmlBudget;
  const left=[];
  const opps=getDrafts()
    .slice()
    .sort((a,b)=> (b.up||0)-(a.up||0))                   // newest first: the ones you are working on
    .map(d=>{
      const c=Object.assign({}, d);
      const html=c.html||"";
      const needed = html && !d.published;
      if(!needed || html.length>SYNC_HTML_MAX || html.length>budget){
        if(needed) left.push(c.slug);
        delete c.html;
      } else budget-=html.length;
      return c;
    });
  setUnmirrored(left);
  /* Page templates travel as records. Their html rides along under the same budget, and a
     template that is published to the repo needs no ride at all. */
  const tpl=getCustomTemplates().map(ct=>{
    const c=Object.assign({}, ct), html=c.html||"";
    if(!html || c.published || html.length>SYNC_HTML_MAX || html.length>budget){
      if(html && !c.published) left.push("tpl:"+c.id);
      delete c.html;
    } else budget-=html.length;
    return c;
  });
  // The relay URL is deliberately NOT in here. It used to travel with the state, and a device
  // holding an old URL could push it back over a freshly verified one, which is how two devices
  // ended up calling two different deployments. The published truth is library/sync.json.
  return { v:2, updated:Date.now(), scalarsUp:scalarsUp(),
    opps, mail:getMailLog(), quota:getSendStamps(), activity:getActivity(),
    etpl:getEmailTemplates(), tpl:tpl, seed:etplSeeded(), tombs:tombs(),
    fromName:getFromName(), quotaCfg:quotaCfg(),
    vault:sealedVault() };
}
/* What this device is holding that the shared state could not carry. Read by Settings, so the
   gap is a sentence on screen rather than a surprise on another device. */
let __unmirrored=[];
function setUnmirrored(a){ __unmirrored=a||[]; }
function unmirrored(){ return __unmirrored.slice(); }
function syncMergeApply(remote){
  if(!remote || typeof remote!=="object") return false;
  __syncApplying=true;
  try{
    /* Removals first. Both sides' tombstones are merged before anything else is decided, so a
       deletion made on either device is known to the rules below rather than being outvoted by
       a copy that happens to still exist somewhere. */
    const allTombs=tombs();
    if(remote.tombs && typeof remote.tombs==="object"){
      Object.keys(remote.tombs).forEach(k=>{
        const ts=Number(remote.tombs[k])||0;
        if(ts > (allTombs[k]||0)) allTombs[k]=ts;
      });
      setTombs(allTombs);
    }
    // drafts: per-slug, newest `up` wins; a winner without html never erases local html
    if(Array.isArray(remote.opps)){
      setDrafts(mergeKeyed(getDrafts(), remote.opps, "slug", "opp", allTombs,
        (r,l)=> Object.assign({}, r, (!r.html && l.html)?{html:l.html}:{})));
    } else if(remote.tombs){
      setDrafts(mergeKeyed(getDrafts(), [], "slug", "opp", allTombs));
    }
    /* Page templates: the same rule, and the same care with html. A record that arrives without
       its page never wipes a page this device is holding. */
    if(Array.isArray(remote.tpl)){
      setCustomTemplates(mergeKeyed(getCustomTemplates(), remote.tpl, "id", "tpl", allTombs,
        (r,l)=> Object.assign({}, r, (!r.html && l.html)?{html:l.html}:{})));
    } else if(remote.tombs){
      setCustomTemplates(mergeKeyed(getCustomTemplates(), [], "id", "tpl", allTombs));
    }
    /* Which stock messages this console has been offered, so one you deleted stays deleted on
       every device instead of being re-seeded by the next one that syncs. */
    if(Array.isArray(remote.seed)){
      const s=new Set(etplSeeded()); remote.seed.forEach(x=>s.add(x));
      try{ localStorage.setItem(ETPL_SEED, JSON.stringify([...s])); }catch(e){}
    }
    if(Array.isArray(remote.mail)){                       // ledger: union by message id
      const seen={}, all=[];
      getMailLog().concat(remote.mail).forEach(m=>{ const k=m.mid||JSON.stringify(m); if(!seen[k]){ seen[k]=1; all.push(m); } });
      all.sort((a,b)=> (a.ts<b.ts?-1:1)); setMailLog(all);
    }
    if(Array.isArray(remote.quota)){                      // send stamps: union (counter = union of devices)
      const s=new Set(getSendStamps()); remote.quota.forEach(n=>{ if(typeof n==="number") s.add(n); });
      const now=Date.now(); lsSet(QUOTA, JSON.stringify([...s].filter(t=> now-t < MONTH_MS+DAY_MS).sort()));
    }
    if(Array.isArray(remote.activity)){                   // operations log: union by ts+action+slug
      const seen={}, all=[];
      getActivity().concat(remote.activity).forEach(a=>{ const k=a.ts+"|"+a.action+"|"+(a.slug||""); if(!seen[k]){ seen[k]=1; all.push(a); } });
      all.sort((a,b)=> (a.ts<b.ts?-1:1)); setActivity(all);
    }
    if(Array.isArray(remote.etpl)){                       // message templates: per-id, newest wins
      setEmailTemplates(mergeKeyed(getEmailTemplates(), remote.etpl, "id", "etpl", allTombs));
    } else if(remote.tombs){
      setEmailTemplates(mergeKeyed(getEmailTemplates(), [], "id", "etpl", allTombs));
    }
    // Publishing credentials: sealed under the passcode, newest wins. Opened asynchronously,
    // so a device that just unlocked gains publishing a moment after the first sync round.
    if(remote.vault){ try{ vaultAdopt(remote.vault); }catch(e){} }
    if((remote.scalarsUp||0) > scalarsUp()){              // settings scalars: newest device wins
      if(typeof remote.fromName==="string") setFromName(remote.fromName);
      if(remote.quotaCfg) setQuotaCfg(remote.quotaCfg);
      try{ localStorage.setItem(SCAL_UP, String(remote.scalarsUp||0)); }catch(e){}
    }
  } finally { __syncApplying=false; }
  return true;
}
let __syncErr="";
function syncErrHint(){ return __syncErr; }
// Turn the relay's raw error into an actionable diagnosis (old deployment vs missing/wrong key).
function classifySyncError(msg){
  msg=String(msg||"");
  if(/missing "to"/i.test(msg)) return t("sy_err_old");         // old script answered a sync op as if it were an email
  if(/SYNC_KEY not set/i.test(msg)) return t("sy_err_nokey");
  if(/unauthorized/i.test(msg)) return t("sy_err_badkey");
  if(/Failed to fetch|NetworkError|Load failed/i.test(msg)) return t("sy_err_net");
  if(/state too large/i.test(msg)) return t("sy_err_toobig");
  return msg;
}
/* ---------- inbound mail ----------
   The relay scans the inbox and writes records; the console reads them and moves
   what they prove. It never writes a stage directly: a matched reply goes through
   the same lifecycle move a person would use, with the same guards and the same
   activity entry, because a card that arrived in `replied` by a different route
   is a card whose history has a hole in it. */
const INBOUND="thrive_inbound_v1";
function getInbound(){ try{ return JSON.parse(localStorage.getItem(INBOUND)||"[]"); }catch(e){ return []; } }
function setInbound(a){ lsSet(INBOUND, JSON.stringify((a||[]).slice(-800))); }
function inboundFor(slug){ return getInbound().filter(r=> r && r.opp===slug); }
/* Named on screen rather than counted: a reply nobody could attribute is the one
   most likely to be worth money, because it is the one nobody is expecting. */
function inboundUnmatched(){ return getInbound().filter(r=> r && r.kind!=="auto" && !r.opp); }

/* Pull, merge, then move. Idempotent at every step: the merge is keyed on the
   Gmail message id, and the move is refused by the lifecycle if the card is
   already there, so a second sync in the same minute changes nothing. */
async function pullInbound(ep, auth){
  let j=null;
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({ op:"inbound_get", auth:auth }) });
    j=await r.json();
  }catch(e){ return 0; }
  /* A relay still on v4 does not know this op. That is not an error worth
     showing: it is a relay that has not been redeployed yet, and docs/RELAY.md
     is where that is fixed. */
  if(!j || !j.ok || !Array.isArray(j.records)) return 0;

  const before=getInbound();
  const merged=ThriveInbound.mergeInbound(before, j.records);
  /* WO-015 Phase D: attribute each reply to the chapter that was live when it
     arrived. The relay knows the slug from the reply-to tag but not the chapter,
     so a reply with no chapter reads as the opportunity's active chapter, which is
     two once the offer has gone out. Additive and idempotent: a record that
     already carries a chapter keeps it. */
  merged.forEach(r=>{ if(r && r.opp && r.chapter==null){ try{ r.chapter=activeChapter(r.opp); }catch(e){ r.chapter=1; } } });
  if(merged.length===before.length && JSON.stringify(merged)===JSON.stringify(before)) return 0;
  setInbound(merged);
  try{ if(j.scan) __inboxScan=j.scan; }catch(e){}
  await applyInboundMoves(merged);
  return merged.length-before.length;
}
let __inboxScan=null;
function inboxScanInfo(){ return __inboxScan; }

async function applyInboundMoves(records){
  const want=ThriveInbound.repliedSlugs(records);
  if(!want.length) return;
  const all=await mergedOpps();
  for(const w of want){
    const o=all.find(x=>x.slug===w.slug);
    if(!o) continue;
    if(ThriveLifecycle.stageOf(o)==="replied") continue;
    if(!ThriveLifecycle.can("record_reply", o)) continue;   // won, lost, archived: leave it alone
    const day=ThriveInbound.dayOf(w.ts)||today();
    await runMove("record_reply", w.slug, { replied_on:day, silent:true });
  }
}

async function doSyncRound(ep, auth){
  const g=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:relayBody({ op:"state_get", auth:auth }) });
  const gj=noteRelayVersion(await g.json());
  /* §3: a version mismatch is reported as the version banner, not as a sync-auth
     failure, because the fix is a redeploy and not a credential. */
  if(!relayReady()) throw new Error(relayBannerText());
  if(!gj.ok) throw new Error(gj.error||"sync auth");
  if(gj.data) syncMergeApply(gj.data);
  const p=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:relayBody({ op:"state_put", auth:auth, data:syncSnapshot() }) });
  const pj=noteRelayVersion(await p.json()); if(!pj.ok) throw new Error(pj.error||"sync put");
  try{ localStorage.setItem(SYNC_LAST, new Date().toISOString()); }catch(e){}
  // Analytics share this endpoint and credential, so refresh them in the same round. Without
  // this, a page that syncs right after unlocking never re-checks collection and sits on a
  // stale "not collecting" message no matter how the relay is actually deployed.
  try{ await fetchRemoteHits(); }catch(e){}
  // Replies ride the same round. A reply that arrives fifteen minutes after a
  // send should be on the board before the next time anybody looks at it.
  try{ await pullInbound(ep, auth); }catch(e){}
  if(typeof window.onThriveSync==="function"){ try{ window.onThriveSync(); }catch(e){} }
}
async function syncNow(){
  const auth=syncAuth(); if(!auth) return false;
  await syncBootstrap();
  const ep=getSyncEndpoint(); if(!ep){ __syncErr=t("sy_need_ep"); return false; }
  if(__syncBusy) return false; __syncBusy=true;
  try{
    try{ await doSyncRound(ep, auth); __syncErr=""; return true; }
    catch(e1){
      // The saved URL may point at a superseded deployment (it answers, but with the old script).
      // Re-read the committed sync.json and retry once with the published URL. Time-boxed so a
      // blocked or slow lookup can never leave the button spinning.
      let fresh="", freshUp=0;
      try{
        const ac=new AbortController(); const to=setTimeout(()=>ac.abort(), 6000);
        const r=await fetch("./sync.json",{cache:"no-store", signal:ac.signal});
        clearTimeout(to);
        if(r.ok){ const j=await r.json(); fresh=(j&&j.ep)||""; freshUp=(j&&j.up)||0; }
      }catch(_){}
      if(fresh && fresh!==ep){
        try{ await doSyncRound(fresh, auth); adoptPublishedEndpoint(fresh, freshUp); __syncErr=""; return true; }
        // If the published endpoint fails too, the FIRST error is the actionable one (it describes
        // the endpoint the user actually configured): don't mask it with the fallback's error.
        catch(e2){ __syncErr=classifySyncError(e1.message); return false; }
      }
      __syncErr=classifySyncError(e1.message); return false;
    }
  }
  finally{ __syncBusy=false; }
}
// Push-only: publish THIS device's data to the shared store without pulling first.
// Recovery lever for "the device holding the campaign never got its data up".
async function syncPush(){
  const auth=syncAuth(); if(!auth) return false;
  await syncBootstrap();
  const ep=getSyncEndpoint(); if(!ep){ __syncErr=t("sy_need_ep"); return false; }
  try{
    const p=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({ op:"state_put", auth:auth, data:syncSnapshot() }) });
    const pj=await p.json(); if(!pj.ok) throw new Error(pj.error||"sync put");
    try{ localStorage.setItem(SYNC_LAST, new Date().toISOString()); }catch(e){}
    __syncErr=""; return true;
  }catch(e){ __syncErr=classifySyncError(e.message); return false; }
}
function scheduleSyncPush(){
  if(__syncApplying) return;                              // merges must not re-trigger themselves
  if(!syncAuth()) return;
  clearTimeout(__syncPushT); __syncPushT=setTimeout(syncNow, 4000);
}
function startLiveSync(){
  if(!document.querySelector("header.top")) return;       // console pages only
  if(syncAuth()) syncNow();
  onThrive("unlock","sync",function(){ syncNow(); });
  setInterval(()=>{ if(!document.hidden && syncAuth()) syncNow(); }, 60000);
}
document.addEventListener("DOMContentLoaded", startLiveSync);

/* ---------- GitHub publishing (the console's backend = the repo itself) ---------- */
const GH = "thrive_gh_v1";
function ghConfig(){ try{ return JSON.parse(localStorage.getItem(GH)||"{}"); }catch(e){ return {}; } }
function setGhConfig(c){ try{ localStorage.setItem(GH, JSON.stringify(c)); }catch(e){} }

/* ---------- the vault: publishing on every device ----------
   The passcode is the boundary. Everything behind it must work from any device, including
   publishing pages, so the GitHub token travels with the shared state. It never travels in
   the clear: it is sealed with AES-GCM under a key derived from the passcode (gate.js, salt
   thrive-vault-v1) before it leaves the browser. The relay stores ciphertext it cannot read,
   and only a device that knows the passcode can open it. Losing the passcode loses the vault,
   which is the correct trade: the alternative is a token readable by whoever holds the store. */
const VAULT_KEY_LS="thrive_vault_key";
function vaultKey(){
  try{ return sessionStorage.getItem(VAULT_KEY_LS) || localStorage.getItem(VAULT_KEY_LS) || ""; }
  catch(e){ return ""; }
}
async function aesKey(hex){
  const raw=new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
  return crypto.subtle.importKey("raw", raw, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
}
async function vaultSeal(obj){
  const k=vaultKey(); if(!k) return null;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await aesKey(k);
  const buf=await crypto.subtle.encrypt({name:"AES-GCM", iv:iv}, key, new TextEncoder().encode(JSON.stringify(obj)));
  const b=a=>btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(a))));
  return { v:1, iv:b(iv), ct:b(buf), up:Date.now() };
}
async function vaultOpen(sealed){
  const k=vaultKey(); if(!k || !sealed || !sealed.ct) return null;
  try{
    const u=s=>Uint8Array.from(atob(s), c=>c.charCodeAt(0));
    const key=await aesKey(k);
    const buf=await crypto.subtle.decrypt({name:"AES-GCM", iv:u(sealed.iv)}, key, u(sealed.ct));
    return JSON.parse(new TextDecoder().decode(buf));
  }catch(e){ return null; }
}
/* What the vault carries: the publishing credentials, and nothing else. */
function vaultPayload(){
  const c=ghConfig();
  return c.token? { owner:c.owner||"", repo:c.repo||"", branch:c.branch||"main", token:c.token } : null;
}
let __vaultUp=0;
function vaultStamp(){ try{ return parseInt(localStorage.getItem("thrive_vault_up")||"0",10)||__vaultUp; }catch(e){ return __vaultUp; } }
function setVaultStamp(t){ __vaultUp=t; try{ localStorage.setItem("thrive_vault_up", String(t)); }catch(e){} }
function sealedVault(){ try{ return JSON.parse(localStorage.getItem("thrive_vault_v1")||"null"); }catch(e){ return null; } }
/* Re-seal whenever the credentials change, so the snapshot itself stays synchronous. */
async function vaultRefresh(){
  const p=vaultPayload();
  if(!p){ try{ localStorage.removeItem("thrive_vault_v1"); }catch(e){} return false; }
  const sealed=await vaultSeal(p);
  if(!sealed) return false;
  try{ localStorage.setItem("thrive_vault_v1", JSON.stringify(sealed)); }catch(e){}
  setVaultStamp(sealed.up);
  return true;
}
/* Adopt a vault that arrived from another device. Publishing then works here with nothing typed. */
async function vaultAdopt(remote){
  if(!remote || !remote.ct) return false;
  if((remote.up||0) <= vaultStamp()) return false;
  const p=await vaultOpen(remote);
  if(!p || !p.token) return false;
  const cur=ghConfig();
  setGhConfig({ owner:p.owner||cur.owner||"thriveiii", repo:p.repo||cur.repo||"thrive-console",
                branch:p.branch||cur.branch||"main", token:p.token });
  try{ localStorage.setItem("thrive_vault_v1", JSON.stringify(remote)); }catch(e){}
  setVaultStamp(remote.up||Date.now());
  return true;
}
function ghReady(){ const c=ghConfig(); return !!(c.token && c.owner && c.repo); }
function b64(str){ return btoa(unescape(encodeURIComponent(str))); }
function unb64(str){ try{ return decodeURIComponent(escape(atob((str||"").replace(/\n/g,"")))); }catch(e){ return ""; } }
async function ghApi(path, opts){
  const c=ghConfig();
  return fetchT("https://api.github.com/repos/"+c.owner+"/"+c.repo+path, Object.assign({}, opts, {
    headers: Object.assign({ "Authorization":"Bearer "+c.token, "Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28" }, (opts&&opts.headers)||{}) }));
}
async function ghGetFile(path){
  const c=ghConfig(); const r=await ghApi("/contents/"+path+"?ref="+encodeURIComponent(c.branch||"main"));
  if(r.status===404) return null;
  if(!r.ok) throw new Error("GitHub "+r.status);
  return r.json();
}
async function ghPutFile(path, text, message){
  const c=ghConfig(); const existing=await ghGetFile(path);
  const body={ message:message, content:b64(text), branch:(c.branch||"main") };
  if(existing && existing.sha) body.sha=existing.sha;
  const r=await ghApi("/contents/"+path, {method:"PUT", body:JSON.stringify(body)});
  if(!r.ok) throw new Error("GitHub "+r.status+": "+(await r.text()).slice(0,140));
  return r.json();
}
async function ghDeleteFile(path, message){
  const c=ghConfig(); const existing=await ghGetFile(path); if(!existing) return;
  const r=await ghApi("/contents/"+path, {method:"DELETE", body:JSON.stringify({message:message, sha:existing.sha, branch:(c.branch||"main")})});
  if(!r.ok && r.status!==404) throw new Error("GitHub "+r.status);
}
async function ghVerify(){
  const c=ghConfig();
  const r=await fetchT("https://api.github.com/repos/"+c.owner+"/"+c.repo,
    {headers:{ "Authorization":"Bearer "+c.token, "Accept":"application/vnd.github+json" }});
  if(!r.ok) throw new Error("GitHub "+r.status);
  return r.json();
}
function manifestEntry(rec){
  return { slug:rec.slug, business:rec.business||"", template:rec.template||"", sent_on:rec.sent_on||"",
    location:rec.location||"", phone:rec.phone||"", status:rec.status||"sent" };
}
/* Every published page MUST carry the beacon, or it can never record an open. An uploaded
   page authored elsewhere has no way to know that. Inject it at publish time when missing,
   so analytics are complete by construction instead of by luck. */
const BEACON_TAG='<script src="/beacon.js" defer></'+'script>';
function withBeacon(html){
  const h=String(html||"");
  if(!h.trim()) return h;
  if(/beacon\.js/.test(h)) return h;
  if(/<\/body\s*>/i.test(h)) return h.replace(/<\/body\s*>/i, BEACON_TAG+"\n</body>");
  if(/<\/html\s*>/i.test(h)) return h.replace(/<\/html\s*>/i, BEACON_TAG+"\n</html>");
  return h+"\n"+BEACON_TAG;
}
function hasBeacon(html){ return /beacon\.js/.test(String(html||"")); }
/* Publishing is two writes: the page, then the manifest that lists it. Between them the repo
   is in a state that is neither published nor unpublished, and if the second write fails the
   page is live at its URL while the library still calls it a draft. That is the worst of the
   three possible outcomes, because it looks like nothing happened.

   So the halves are named. A failure after the page is written throws an error that says which
   half is done, the record remembers it, and the console offers to finish rather than asking
   you to publish again from the beginning. */
const HALF = "thrive_half_publish_v1";
function halfPublished(){ try{ return JSON.parse(localStorage.getItem(HALF)||"{}"); }catch(e){ return {}; } }
function setHalfPublished(slug, on){
  const o=halfPublished();
  if(on) o[slug]=Date.now(); else delete o[slug];
  try{ localStorage.setItem(HALF, JSON.stringify(o)); }catch(e){}
}
async function publishManifest(rec){
  const mf=await ghGetFile("library/manifest.json");
  let man = mf ? (JSON.parse(unb64(mf.content))||{}) : {};
  man.site=man.site||SITE; man.base_path=man.base_path||OPP_PATH; man.opportunities=man.opportunities||[];
  const e=manifestEntry(rec); const i=man.opportunities.findIndex(o=>o.slug===rec.slug);
  if(i>=0){ if(man.opportunities[i].archived) e.archived=true; man.opportunities[i]=e; }  // keep an archived flag across re-publish
  else man.opportunities.push(e);
  man.updated=new Date().toISOString().slice(0,10);
  await ghPutFile("library/manifest.json", JSON.stringify(man,null,2)+"\n", "Update manifest: "+rec.slug);
  setHalfPublished(rec.slug, false);
}
async function publishOpp(rec){
  await ghPutFile("opp/"+rec.slug+"/index.html", withBeacon(rec.html||""), "Publish opp/"+rec.slug);
  setHalfPublished(rec.slug, true);          // from here the page is live whatever happens next
  try{
    await publishManifest(rec);
  }catch(e){
    logActivity("publish_half", rec.slug, String(e.message||e));
    const err=new Error(t("pub_half")); err.half=true; err.slug=rec.slug; throw err;
  }
}
/* WO-015 Phase D, I10: the offer is a DISTINCT artifact from the first contact
   page. It publishes to a sub path of the same slug directory, opp/<slug>/offer/,
   so the first contact page at opp/<slug>/index.html is never overwritten. The two
   share a slug and a thread; they do not share a file. No manifest write: the
   offer is a sub artifact of one opportunity, and the manifest still holds one
   entry per slug, so its shape is unchanged (standing rule 6). The published flag
   is stored additively on the offer, through saveDraft. */
function liveOfferUrl(slug){ return liveUrl(slug)+"/offer"; }
async function publishOffer(rec){
  const offer=rec.offer||{};
  await ghPutFile("opp/"+rec.slug+"/offer/index.html", withBeacon(offer.html||""),
                  "Publish offer opp/"+rec.slug+"/offer");
  saveDraft({ slug:rec.slug, offer:Object.assign({}, offer, { published:true, up:Date.now() }) });
  logActivity("publish_offer", rec.slug, "");
}
/* The chapter a new send should carry. A converted opportunity's next send is the
   offer, chapter two; everything else is chapter one. This is what tags the send
   so a reply attributes to the right chapter, and it reads the convert event
   rather than a stored chapter on the opportunity (I8). */
function sendChapter(slug){
  const rec=getDraft(slug);
  return (rec && rec.converted_at && rec.offer) ? 2 : 1;
}
/* Finish a publish that got halfway. The page is already live, so this writes only the entry
   that lists it. */
async function finishPublish(rec){ await publishManifest(rec); logActivity("publish", rec.slug, "finished"); }
const sleep=ms=>new Promise(function(r){ setTimeout(r, ms); });
/* The confirm half of activation. After the commit, the page is in the repo but GitHub Pages has
   to rebuild before the URL resolves, so this polls the live link until it actually loads, over a
   build-sized window, and returns whether it went live. It reads the SAME live-state truth the
   send-safety gate reads (pageIsGone, a real fetch of liveUrl): a page is live when its URL
   resolves, full stop. A timeout is not a claim that it failed, only that it is not confirmed yet. */
async function confirmLive(slug, opts){
  opts=opts||{};
  const tries=opts.tries||8, gap=opts.gap||8000;   // about a minute, a normal Pages build
  for(let i=0;i<tries;i++){
    const gone=await pageIsGone(slug);              // false means the URL returned 200, it resolves
    if(gone===false) return true;
    if(i<tries-1) await sleep(gap);
  }
  return false;
}
/* Activation, in the sacred order: commit, confirm, then flip. NEVER flip first. The page and the
   manifest are committed for real (additive and idempotent: a re-activation updates the same file
   by sha and merges the one manifest entry by slug, never duplicating). Only after the live link is
   confirmed to resolve does the state flip to activated. A commit that cannot be confirmed live
   leaves the state not activated, so nothing is ever shown as live that was not confirmed. Returns
   whether it went live; publishOpp's half-commit error propagates to the caller. */
async function activateAndConfirm(o, html){
  await publishOpp(Object.assign({}, o, { html: html }));   // 1. commit the page and the manifest
  if(typeof actionStatus==="function") actionStatus("work", t("act_step_confirm"));  // narrate the confirm step
  const live=await confirmLive(o.slug);                     // 2. confirm the live URL resolves
  if(live){ saveDraft({ slug:o.slug, published:true }); logActivity("publish", o.slug, o.business||""); }  // 3. flip only now
  return live;
}
async function unpublishOpp(slug){
  await ghDeleteFile("opp/"+slug+"/index.html", "Unpublish opp/"+slug);
  const mf=await ghGetFile("library/manifest.json");
  if(mf){ let man=JSON.parse(unb64(mf.content))||{}; man.opportunities=(man.opportunities||[]).filter(o=>o.slug!==slug);
    man.updated=new Date().toISOString().slice(0,10);
    await ghPutFile("library/manifest.json", JSON.stringify(man,null,2)+"\n", "Remove "+slug+" from manifest"); }
}
async function publishTemplate(ct){
  await ghPutFile("templates/"+ct.id+"/template.html", ct.html||"", "Publish template "+ct.id);
  const meta={ id:ct.id, name:ct.name||ct.id, lang:ct.lang||"EN", source:"console", created:ct.created||new Date().toISOString() };
  await ghPutFile("templates/"+ct.id+"/meta.json", JSON.stringify(meta,null,2)+"\n", "Template meta "+ct.id);
}
async function setManifestArchived(slug, archived){
  const mf=await ghGetFile("library/manifest.json"); if(!mf) return;
  const man=JSON.parse(unb64(mf.content))||{}; const o=(man.opportunities||[]).find(x=>x.slug===slug);
  if(!o) return; if(archived) o.archived=true; else delete o.archived;
  man.updated=new Date().toISOString().slice(0,10);
  await ghPutFile("library/manifest.json", JSON.stringify(man,null,2)+"\n", (archived?"Archive ":"Unarchive ")+slug);
}
function openLocalPreview(html){
  const blob=new Blob([html||"<!doctype html><meta charset=utf-8><p style='font-family:sans-serif;color:#888;padding:40px'>No saved content.</p>"],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob); const w=window.open(url,"_blank");
  setTimeout(()=>URL.revokeObjectURL(url), 60000); return w;
}
/* ---------- data (manifest = committed, overlay = local edits) ---------- */
async function loadManifest(){
  try{ const r=await fetch("./manifest.json",{cache:"no-store"}); const j=await r.json();
       return {site:j.site||SITE, list:(j.opportunities||[])}; }
  catch(e){ return {site:SITE, list:[]}; }
}
function getDrafts(){ try{ return JSON.parse(localStorage.getItem(STORE)||"[]"); }catch(e){ return []; } }
function setDrafts(a){ return lsSet(STORE, JSON.stringify(a)); }
function getDraft(slug){ return getDrafts().find(x=>x.slug===slug); }
function saveDraft(rec){
  rec.up=Date.now();                                     // freshness stamp for cross-device merge
  const a=getDrafts(); const i=a.findIndex(x=>x.slug===rec.slug);
  if(i>=0) a[i]={...a[i], ...rec}; else a.push(rec); setDrafts(a);
}
function removeDraft(slug){ markRemoved("opp", slug); setDrafts(getDrafts().filter(x=>x.slug!==slug)); }
/* Carried forward from phase 1. A delete is the move a person most regrets, and it was the one
   without an undo. The whole record is kept in the closure until the toast expires, so undoing
   restores what was there rather than a reconstruction of it, and the tombstone is lifted so
   the record does not get removed again by the next sync. */
function removeDraftUndoable(slug, label){
  const rec=getDraft(slug);
  if(!rec) return false;
  const copy=JSON.parse(JSON.stringify(rec));
  removeDraft(slug);
  logActivity("remove", slug, label||"");
  try{ scheduleSyncPush(); }catch(e){}
  toast(t("mv_undo_del"), { label:t("lc_undo"), fn:()=>{
    const tb=tombs(); delete tb["opp:"+slug]; setTombs(tb);
    saveDraft(copy);
    logActivity("lc_undo", slug, "remove");
    try{ scheduleSyncPush(); }catch(e){}
    toast(t("lc_undone"));
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
  }});
  return true;
}

/* WO-015 §5.3: migrate retired statuses, non-destructively.
   A `lost` record becomes archived, its whole record retained (I5), with the
   outcome kept as `outcome_was:"lost"` and a migration note in the activity log
   so nothing is lost and the reason it was lost is still readable. `won` records
   are left exactly as they are: the causal scan (Phase F) surfaces each for Thyab
   to reconcile against a contract event, and none is converted or hidden here.
   Idempotent: a record already archived is skipped, so a second load is a no-op.
   Every write is through saveDraft then logActivity (I2), never a direct write. */
function migrateRetiredStatuses(){
  var changed=false;
  getDrafts().forEach(function(d){
    if(!d || d.archived) return;
    if(ThriveLifecycle.norm(d.stage)==="lost"){
      saveDraft({ slug:d.slug, archived:true, outcome_was:"lost",
                  prev_stage:(d.prev_stage||"sent") });   // where recall returns it, never back to a retired stage
      logActivity("lc_migrate_lost", d.slug, d.lost_reason||"");
      changed=true;
    }
  });
  return changed;
}

async function mergedOpps(){
  const {list}=await loadManifest();
  const bySlug={};
  list.forEach(o=>{ bySlug[o.slug]={...o, _local:false, _edited:false}; });
  getDrafts().forEach(d=>{
    if(bySlug[d.slug]) bySlug[d.slug]={...bySlug[d.slug], ...d, _local:false, _edited:true};
    else bySlug[d.slug]={...d, _local:true, _edited:false};
  });
  const rows=Object.values(bySlug);
  rows.forEach(o=>{ o.archived=!!o.archived; });
  return rows;
}
async function allSlugs(){ return (await mergedOpps()).map(o=>o.slug); }

/* One disclosure, used by the two screens that had grown too many controls at rest. It counts
   what is active inside itself, so folding something away never hides the fact that it is on. */
function initMore(btnId, boxId, count){
  const b=document.getElementById(btnId), box=document.getElementById(boxId);
  if(!b || !box) return;
  function label(){
    const n=count? count() : 0;
    b.textContent = t("lib_more") + (n? " ("+n+")" : "");
    b.classList.toggle("has-on", !!n);
  }
  b.addEventListener("click", ()=>{
    const open = box.hidden;
    box.hidden = !open;
    b.setAttribute("aria-expanded", open?"true":"false");
  });
  label();
  return label;
}

/* ---------- dashboard ---------- */
async function initDashboard(){
  const state={ q:"", sort:"new", tmpl:"all", status:"active", stage:null, data:[] };
  state.data = await mergedOpps();

  const search=document.getElementById("q");
  const sort=document.getElementById("sort");
  const filt=document.getElementById("filter");
  const statusFilt=document.getElementById("statusFilter");

  // populate template filter (guard against empty/undefined)
  [...new Set(state.data.map(o=>o.template).filter(Boolean))].forEach(tp=>{
    const op=document.createElement("option"); op.value=tp; op.textContent=tp; filt.appendChild(op);
  });

  function badgeFor(o){
    if(o.archived) return '<span class="badge arch">'+t("badge_archived")+'</span>';
    if(o._local && !o.published) return '<span class="badge draft">'+t("draft")+'</span>';
    return '<span class="badge sent">'+t("badge_live")+'</span>';
  }

  function render(){
    const grid=document.getElementById("grid");
    let rows=state.data.slice();
    if(state.status==="active")   rows=rows.filter(o=>!o.archived);
    else if(state.status==="archived") rows=rows.filter(o=>o.archived);
    else if(state.status==="followup") rows=rows.filter(needsFollowup);
    if(state.stage) rows=rows.filter(o=>effStage(o)===state.stage);
    if(state.tmpl!=="all") rows=rows.filter(o=>o.template===state.tmpl);
    if(state.q){ const q=state.q.toLowerCase();
      rows=rows.filter(o=>[o.business,o.location,o.template,o.slug].join(" ").toLowerCase().includes(q)); }
    rows.sort((a,b)=>{
      if(state.sort==="az") return (a.business||"").localeCompare(b.business||"");
      const da=(a.sent_on||""), db=(b.sent_on||"");
      return state.sort==="old" ? da.localeCompare(db) : db.localeCompare(da);
    });
    // pipeline summary, rendered BEFORE the empty-grid guard so the pills, active-filter
    // highlight, and clear button stay correct even when a filter yields zero cards.
    const pipelineEl=document.getElementById("pipeline");
    if(pipelineEl){
      const act=state.data.filter(o=>!o.archived); const counts={}; PIPE_STAGES.forEach(s=>counts[s]=0);
      act.forEach(o=>{ const s=effStage(o); counts[s]=(counts[s]||0)+1; });
      const fu=act.filter(needsFollowup).length;
      pipelineEl.innerHTML =
        PIPE_STAGES.map(s=>`<button class="pl-pill pl-${s}${state.stage===s?" on":""}" data-stage-f="${s}">${t("stage_"+s)} <b>${counts[s]}</b></button>`).join("")
        + `<button class="pl-pill pl-fu${state.status==="followup"?" on":""}" data-fu="1">${t("followup")} <b>${fu}</b></button>`
        + ((state.stage||state.status==="followup"||state.tmpl!=="all"||state.q)?`<button class="pl-pill pl-clear" data-clear="1">${t("clear_filters")}</button>`:"");
      pipelineEl.querySelectorAll("[data-stage-f]").forEach(b=>b.addEventListener("click",()=>{
        const s=b.getAttribute("data-stage-f");
        state.stage = (state.stage===s)?null:s;
        if(moreLabel) setTimeout(moreLabel,0);
        if(state.stage && state.status==="followup"){ state.status="active"; if(statusFilt) statusFilt.value="active"; }
        render();
      }));
      const fp=pipelineEl.querySelector("[data-fu]");
      if(fp) fp.addEventListener("click",()=>{
        if(state.status==="followup"){ state.status="active"; if(statusFilt) statusFilt.value="active"; }
        else { state.status="followup"; state.stage=null; if(statusFilt) statusFilt.value="followup"; }
        render();
      });
      const cl=pipelineEl.querySelector("[data-clear]");
      if(cl) cl.addEventListener("click",()=>{
        state.stage=null; state.status="active"; state.tmpl="all"; state.q="";
        if(statusFilt) statusFilt.value="active"; if(filt) filt.value="all"; if(search) search.value="";
        render();
      });
    }
    if(!rows.length){ grid.className="empty-wrap"; grid.innerHTML='<div class="empty">'+t("empty")+'</div>'; return; }
    grid.className="grid";

    /* The first option is the derived state and it is what a record sits on until you say
       otherwise. Declaring a stage is a decision you can make and unmake; it is no longer
       something the console assumes on your behalf. */
    function stageSel(o){
      if(!isLive(o)) return "";
      const declared=o.stage||"", cur=effStage(o);
      return `<select class="stage-sel" data-stage="${esc(o.slug)}" title="${t("stage")}">`+
        `<option value=""${declared?"":" selected"}>${t("stage_auto")}: ${t("stage_"+cur)}</option>`+
        STAGES.map(s=>`<option value="${s}"${s===declared?" selected":""}>${t("stage_"+s)}</option>`).join("")+`</select>`;
    }
    const halves=halfPublished();
    grid.innerHTML = rows.map(o=>{
      const arch=o.archived, live=isLive(o), enc=encodeURIComponent(o.slug), fu=needsFollowup(o);
      /* Two different facts, told apart. The date on the record is the day the page was made.
         A send date exists only when a message actually went out, and only then is a view of
         that page an open rather than a visit. */
      const snd=sendsFor(o), sentDay=String(snd.last||snd.first||"").slice(0,10);
      // The page went live and its entry did not. Named on the card, with the way to finish it.
      const half=!!halves[o.slug];
      const linkRow = live
        ? `<a class="link" href="${relOpp(o.slug)}" target="_blank" rel="noopener">${esc(liveUrl(o.slug))}</a>`
        : `<span class="link muted">${esc(liveUrl(o.slug))} · ${t("not_published")}</span>`;
      const primary = live
        ? `<a class="btn sm" href="${relOpp(o.slug)}" target="_blank" rel="noopener">${t("open_page")}</a>`
        : `<button class="btn sm" data-pub="${esc(o.slug)}">${t("publish")}</button>`;
      /* T-Library: one skeleton, three tiers. Primary (name, state, primary action) is prominent;
         the supporting facts are one quiet muted line, not a wall of bright chips; the rest of the
         actions sit behind a native <details> disclosure, reachable but off the face. Every value
         and every action from the old card is still here, only re-tiered. */
      // A ready offer is not edited on the platform, so its Edit action is not present at all,
      // never a disabled one. Every other type keeps Edit.
      const isOffer = o.type===T_OFFER;
      const moreActions =
          (!live?`<button class="btn ghost sm" data-prev="${esc(o.slug)}">${t("preview")}</button>`:``)
        + (live?`<a class="btn ghost sm" href="${viewHref("compose","slug="+enc)}">${t("email_btn")}</a><button class="btn ghost sm" data-pdf="${esc(o.slug)}">PDF</button>`:``)
        + (isOffer?``:`<a class="btn ghost sm" href="${viewHref("editor","slug="+enc)}">${t("edit")}</a>`)
        + `<button class="btn ghost sm" data-arch="${esc(o.slug)}" data-val="${arch?"0":"1"}">${arch?t("unarchive"):t("archive")}</button>`
        + (half?`<button class="btn sm" data-finish="${esc(o.slug)}">${t("pub_finish")}</button>`:``)
        + (live?`<button class="btn ghost sm danger" data-unpub="${esc(o.slug)}">${t("unpublish")}</button>`:``)
        + ((o._local&&!o.published)?`<button class="btn ghost sm danger" data-del="${esc(o.slug)}">${t("remove")}</button>`:``);
      return `<div class="card${arch?" is-arch":""}${live?"":" is-draft"}${fu?" needs-fu":""}">
        <div class="card-top">
          <div class="card-id"><p class="biz">${esc(o.business)||esc(o.slug)}</p>${linkRow}</div>
          <div class="card-state">
            ${badgeFor(o)}
            ${fu?`<span class="flag flag-fu">${t("followup")}</span>`:""}
            ${half?`<span class="flag flag-half">${t("pub_half_chip")}</span>`:""}
          </div>
        </div>
        <p class="card-facts">
          <span class="fact fact-tmpl">${esc(o.template)||t("none")}</span>
          <span class="fact">${t("col_made")}: ${esc(o.sent_on)||t("none")}</span>
          ${snd.count?`<span class="fact">${t("col_sent")}: ${esc(sentDay)||t("none")}</span>`:""}
          ${live?`<span class="fact">${snd.count?t("ins_opens")+": "+outreachOpens(o):t("col_views")+": "+opensForSlug(o.slug)}</span>`:""}
          <span class="fact">${t("col_location")}: ${esc(o.location)||t("none")}</span>
        </p>
        <div class="card-foot">
          <div class="card-act">
            ${primary}
            ${stageSel(o)}
          </div>
          <details class="card-more">
            <summary class="card-more-s">${ic("chevron",14)}<span>${t("lib_more")}</span></summary>
            <div class="card-more-list">${moreActions}</div>
          </details>
        </div>
      </div>`;
    }).join("");

    grid.querySelectorAll(".stage-sel").forEach(sel=>sel.addEventListener("change",()=>{
      const slug=sel.getAttribute("data-stage"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      o.stage=sel.value; saveDraft({slug, stage:sel.value});
      logActivity("stage", slug, sel.value||t("stage_auto"));
      render();   // always re-render so pipeline counts + any active stage filter reflect the change
    }));
    grid.querySelectorAll("[data-pdf]").forEach(b=>b.addEventListener("click", async ()=>{
      const o=state.data.find(x=>x.slug===b.getAttribute("data-pdf")); if(!o) return;
      if(isLive(o)){ const w=window.open(relOpp(o.slug),"_blank"); if(w) w.addEventListener("load",()=>setTimeout(()=>w.print(),300)); }
      else { const w=openLocalPreview(await renderOppHtml(o)); if(w) setTimeout(()=>{ try{w.print();}catch(e){} },500); }
    }));
    grid.querySelectorAll("[data-unpub]").forEach(b=>b.addEventListener("click", ()=>{
      const slug=b.getAttribute("data-unpub"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!confirm(t("confirm_unpublish"))) return;   // the guard question stays a native confirm
      runAction(b, { doneMsg:t("unpublished_ok"), run: async ()=>{
        if(!ghReady()){ setTimeout(()=>goTo("settings"),900); throw new Error(t("gh_needed")); }
        // Capture the live page BEFORE deleting: for opps published on another device we have no
        // local fields to regenerate from, so keep the real HTML so re-publishing isn't blank.
        const hasFields=o.fields && Object.keys(o.fields).some(k=>o.fields[k]);
        let liveHtml=(o.mode==="upload" && o.html)?o.html:"";
        if(!liveHtml && !hasFields){ try{ const cur=await ghGetFile("opp/"+slug+"/index.html"); if(cur&&cur.content) liveHtml=unb64(cur.content); }catch(_){} }
        await unpublishOpp(slug);
        const useUpload = !!liveHtml && !hasFields;   // no fields to regenerate from → keep verbatim HTML
        const back={slug, business:o.business, template:o.template, sent_on:o.sent_on, location:o.location, phone:o.phone, status:o.status||"sent", published:false, mode:useUpload?"upload":(o.mode||(o.template&&o.template!=="custom"?"fill":"upload")), fields:o.fields||{}};
        if(liveHtml) back.html=liveHtml;
        saveDraft(back);
        logActivity("unpublish", slug, o.business);
        state.data=await mergedOpps(); render();
      }});
    }));
    grid.querySelectorAll("[data-prev]").forEach(b=>b.addEventListener("click", async ()=>{
      const o=state.data.find(x=>x.slug===b.getAttribute("data-prev")); if(o) openLocalPreview(await renderOppHtml(o));
    }));
    grid.querySelectorAll("[data-pub]").forEach(b=>b.addEventListener("click", ()=> runAction(b, { working:t("publishing"), workingMsg:t("act_step_check"),
      okRender:(res)=>{ if(res===t("activated_live")) activationCard(b.getAttribute("data-pub")); else actionStatus("ok", (typeof res==="string" && res) || t("act_done")); },
      run: async ()=>{
      const slug=b.getAttribute("data-pub"); const o=state.data.find(x=>x.slug===slug); if(!o) throw new Error(t("act_err_unknown"));
      if(!ghReady()){ setTimeout(()=>goTo("settings"),900); throw new Error(t("gh_needed")); }
      const html=await renderOppHtml(o);
      if(!html) throw new Error(t("no_content_publish"));
      // Commit, confirm, then flip. The state does not move to Ready until the live link resolves.
      let live;
      actionStatus("work", t("act_step_commit"));
      try{ live=await activateAndConfirm(o, html); }
      catch(e){ throw new Error(e && e.half ? t("pub_half") : (t("gh_err")+": "+errText(e))); }
      if(!live){ render(); return t("act_unconfirmed"); }   // committed, not yet resolved: reason shown, state stays
      o.published=true; render(); return t("activated_live");
    }})));
    grid.querySelectorAll("[data-finish]").forEach(b=>b.addEventListener("click", ()=> runAction(b, { working:t("publishing"), run: async ()=>{
      const slug=b.getAttribute("data-finish"); const o=state.data.find(x=>x.slug===slug); if(!o) throw new Error(t("act_err_unknown"));
      if(!ghReady()){ setTimeout(()=>goTo("settings"),900); throw new Error(t("gh_needed")); }
      try{ await finishPublish(o); }             // write the missing manifest entry
      catch(e){ throw new Error(t("gh_err")+": "+errText(e)); }
      const live=await confirmLive(slug);        // confirm before declaring it activated
      if(!live){ render(); return t("act_unconfirmed"); }
      saveDraft({slug, published:true}); o.published=true; render(); return t("activated_live");
    }})));
    grid.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      const slug=b.getAttribute("data-del");
      if(!confirm(t("confirm_remove"))) return;
      const gone=state.data.find(o=>o.slug===slug);
      removeDraftUndoable(slug, (gone&&gone.business)||"");
      state.data=state.data.filter(o=>!(o._local&&o.slug===slug)); render();
      /* The undo puts the record back, so the list has to be able to see it again. */
      window.thriveBoardRefresh=window.thriveBoardRefresh||null;
    }));
    grid.querySelectorAll("[data-arch]").forEach(b=>b.addEventListener("click",async ()=>{
      const slug=b.getAttribute("data-arch"); const val=b.getAttribute("data-val")==="1";
      const o=state.data.find(x=>x.slug===slug); if(!o) return;
      /* WO-015 Phase E follow-up: archive and recall go through the ONE shared,
         documented, chapter aware path the board uses, runMove, rather than the
         second write that used to bypass the chapter aware recall. A converted
         card recalled from the Library now returns to its active chapter exactly
         as it does from the board, and both surfaces write the same lc_archive and
         lc_unarchive events through saveDraft then logActivity. runMove reads the
         record from mergedOpps, so a manifest only item keeps its fields from the
         manifest and still renders without carrying a summary by hand. */
      await runMove(val?"archive":"unarchive", slug, {});
      /* The one thing the board does not need and the Library keeps: committing the
         archived flag to the manifest, so a published page's archive is durable
         across devices before the next state sync. It is an addition beside the
         shared recall, never a substitute for it. */
      if(isLive(o) && ghReady()) setManifestArchived(slug, val).catch(()=>{});
      /* Re-read the overlay runMove just wrote, so the grid reflects the new
         archived flag and any chapter aware stage the recall stored. This is the
         same refresh the rest of the Library uses after a write. */
      state.data=await mergedOpps(); render();
    }));
  }

  /* Folded away, never hidden: the button carries the number of filters that are on, so a
     library that is showing you a subset always says so. */
  const moreLabel=initMore("libMoreBtn","libMore", ()=>
    (state.sort!=="new"?1:0)+(state.tmpl!=="all"?1:0)+(state.status!=="active"?1:0));
  const debRender=debounce(render,140);
  onThrive("sync","library", async ()=>{ state.data=await mergedOpps(); render(); });
  search.addEventListener("input",e=>{ state.q=e.target.value; debRender(); });
  sort.addEventListener("change",e=>{ state.sort=e.target.value; render(); if(moreLabel) moreLabel(); });
  filt.addEventListener("change",e=>{ state.tmpl=e.target.value; render(); if(moreLabel) moreLabel(); });
  if(statusFilt) statusFilt.addEventListener("change",e=>{ state.status=e.target.value; render(); if(moreLabel) moreLabel(); });

  document.getElementById("exportManifest").addEventListener("click", async ()=>{
    const {site}=await loadManifest();
    const rows=state.data.slice().sort((a,b)=>{
      const d=(b.sent_on||"").localeCompare(a.sent_on||""); return d!==0?d:(a.business||"").localeCompare(b.business||"");
    });
    const out={ site:site||SITE, base_path:OPP_PATH, updated:new Date().toISOString().slice(0,10),
      opportunities: rows.map(o=>{
        const e={ slug:o.slug, business:o.business||"", template:o.template||"", sent_on:o.sent_on||"",
                  location:o.location||"", phone:o.phone||"", status:o.status||"sent" };
        if(o.archived) e.archived=true;
        return e;
      }) };
    download("manifest.json", JSON.stringify(out,null,2), "application/json");
    logActivity("export", "", rows.length+" opportunities");
    const localCount=state.data.filter(o=>o._local).length;
    toast(localCount? boardText(getLang(),"export_local_note",localCount) : t("exported_toast"));
  });

  onThrive("lang","dashboard",render);
  render();
}

/* ---------- editor undo/redo ----------
   Native undo is dead in the editor because the opportunity window rebuilds the editor view from a
   boot snapshot on every entry (thriveViewReset sets el.innerHTML), and initEditor re-hydrates each
   field with `.value =`. A recreated node has an empty native undo stack, and a programmatic value
   assignment clears whatever stack a fresh page had. So the history cannot live in the DOM. It lives
   here, in memory, keyed by the editing slug and the field id, so it survives every re-render and the
   auto-save. Depth is capped so memory stays bounded. This changes nothing that is saved; it only lets
   the field step back and forward. */
var ThriveEditHistory = (function(){
  var CAP = 100;                 // per-field snapshots kept; older ones fall off the bottom
  var COALESCE = 600;            // ms: a burst of typing in one field collapses to one undo step
  var store = {};                // fieldId -> { stack:[{v,s,e}], idx, ts }
  var slug = null;               // the document these histories belong to
  var lastId = "";               // the field the icons act on (survives re-render: an id, not a node)
  var applying = false;          // true while we set a value ourselves, so it is not recorded as an edit
  function snap(f){ return { v: f.value, s: (f.selectionStart==null?f.value.length:f.selectionStart), e: (f.selectionEnd==null?f.value.length:f.selectionEnd) }; }
  function reset(s){ if(s!==slug){ store = {}; slug = s; lastId = ""; } }   // a new document starts fresh
  function seed(f){ if(!store[f.id]) store[f.id] = { stack:[snap(f)], idx:0, ts:0 }; }
  function ensure(f){ seed(f); return store[f.id]; }
  function record(f){
    if(applying) return;
    var h = ensure(f), now = nowMs(), top = h.stack[h.idx];
    if(top && top.v === f.value){ top.s = f.selectionStart; top.e = f.selectionEnd; return; }   // caret move only
    if(h.ts && (now - h.ts) < COALESCE && h.idx === h.stack.length - 1){
      h.stack[h.idx] = snap(f);                 // same burst: evolve the current step, do not add one
    } else {
      h.stack = h.stack.slice(0, h.idx + 1);    // a fresh edit truncates any redo tail
      h.stack.push(snap(f));
      if(h.stack.length > CAP) h.stack.shift();
      h.idx = h.stack.length - 1;
    }
    h.ts = now;
  }
  function apply(f, s){
    applying = true;
    f.value = s.v;
    try{ f.setSelectionRange(s.s, s.e); }catch(e){}
    try{ f.dispatchEvent(new Event("input", { bubbles:true })); }catch(e){}   // let the preview and slug follow
    applying = false;
  }
  function canUndo(id){ var h = store[id]; return !!(h && h.idx > 0); }
  function canRedo(id){ var h = store[id]; return !!(h && h.idx < h.stack.length - 1); }
  function undo(f){ var h = store[f.id]; if(!h || h.idx <= 0) return false; h.idx--; apply(f, h.stack[h.idx]); h.ts = 0; return true; }
  function redo(f){ var h = store[f.id]; if(!h || h.idx >= h.stack.length - 1) return false; h.idx++; apply(f, h.stack[h.idx]); h.ts = 0; return true; }
  function nowMs(){ try{ return Date.now(); }catch(e){ return 0; } }
  return {
    reset: reset, seed: seed, record: record, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    setLast: function(id){ lastId = id; }, last: function(){ return lastId; }, cap: CAP
  };
})();

/* ---------- editor ---------- */
async function initEditor(slugArg){
  const el=id=>document.getElementById(id);
  const existing = await allSlugs();
  // The slug currently being edited (null for a brand-new opp). Advances on first save so an
  // opp never collides with itself, and lets save/publish block collisions with OTHER opps.
  // The caller passes it (the modal borrows this view and calls initEditor(current)); only the
  // standalone editor page, which carries the slug in the URL, falls back to the query. Without
  // this, editingSlug is null in the modal, so a page's own slug reads as a collision with
  // "another" opp, and Activate throws slug_taken before it ever reaches the commit.
  let editingSlug = slugArg || viewParams().get("slug");

  // add custom templates to the picker, then honor ?t=
  const tsel=el("f_template");
  // Built-in option labels follow the UI language (they are the only hard-coded ones in the markup).
  function relabelBuiltins(){
    const L=getLang();
    [...tsel.options].forEach(o=>{
      const tp=APPROVED_TEMPLATES.find(x=>x.id===o.value);
      if(tp) o.textContent=tp.id+" · "+(L==="ar"?tp.name_ar:tp.name_en)+" ("+tp.lang+")";
    });
  }
  relabelBuiltins();
  getCustomTemplates().forEach(ct=>{
    if([...tsel.options].some(o=>o.value===ct.id)) return;
    const o=document.createElement("option"); o.value=ct.id; o.textContent=ct.id+" · "+(ct.name||ct.id)+" ("+t("tpl_badge_custom")+")"; tsel.appendChild(o);
  });
  /* The optional half of the form, folded, with the button carrying how much of it is filled
     in so nothing you typed can hide behind it. */
  const ED_OPTIONAL=["f_sent","f_location","f_phone","f_quote","f_quoteby"];
  const edMore=initMore("edMoreBtn","edMore", ()=>
    ED_OPTIONAL.filter(id=>{ const e=document.getElementById(id); return e && String(e.value||"").trim(); }).length);
  if(edMore) ED_OPTIONAL.forEach(id=>{
    const e=document.getElementById(id); if(e){ e.addEventListener("input", edMore); e.addEventListener("change", edMore); }
  });
  const tParam=viewParams().get("t");
  if(tParam && [...tsel.options].some(o=>o.value===tParam)) tsel.value=tParam;

  function values(){
    return { BIZ:el("f_biz").value, QUOTE:el("f_quote").value, QUOTE_BY:el("f_quoteby").value,
      PROOF1:el("f_proof1").value, PROOF2:el("f_proof2").value, PROOF3:el("f_proof3").value,
      WANT:el("f_want").value };
  }
  let mode="fill", uploadedHTML=null, uploadedName="";
  async function currentHTML(){
    if(mode==="upload") return uploadedHTML||"";
    const tpl=await fetchTemplateHtml(el("f_template").value);
    return fillTemplate(tpl, values());
  }
  function curSlug(){ return (el("f_slug").value.trim() || slugify(el("f_biz").value)); }
  function collides(){ const s=curSlug(); return !!(s && s!==editingSlug && existing.indexOf(s)>=0); }
  function checkCollision(){
    const warn=el("slugWarn"); if(!warn) return;
    warn.hidden = !collides();
  }
  /* The direction, the typeface and the typography rules come from the document's own language,
     not from the chrome. Thyab can work in Arabic chrome on an English opportunity and nothing
     about the document changes, which is the whole point of separating the two axes. */
  function applyDocLang(){
    const sel=el("f_doclang"); if(!sel) return;
    const L=(sel.value||"EN").toUpperCase();
    const badge=el("edLocBadge");
    if(badge){
      badge.hidden=false;
      badge.textContent=t("loc_badge")+": "+t("loc_"+L.toLowerCase());
      badge.className="loc-badge loc-"+L.toLowerCase();
    }
    ["f_biz","f_quote","f_quoteby","f_proof1","f_proof2","f_proof3","f_want"].forEach(id=>{
      const n=el(id); if(!n) return;
      n.setAttribute("dir", dirOf(L));
      n.classList.toggle("doc-ar", L==="AR");
    });
    /* Identity fields stay left to right in both, because a slug, a URL, an address and a date
       are read the same way whatever the document says. */
    ["f_slug","f_sent","f_phone"].forEach(id=>{ const n=el(id); if(n) n.setAttribute("dir","ltr"); });
  }
  function refreshMeta(){ el("urlpill").textContent = liveUrl(curSlug()||"<name>"); checkCollision(); }
  async function refreshPreview(){ const html=await currentHTML(); el("frame").srcdoc = html || "<!doctype html><meta charset='utf-8'>"; }
  async function refresh(){ refreshMeta(); await refreshPreview(); }
  const debPreview=debounce(refreshPreview, 220);   // perf: don't regenerate the heavy preview on every keystroke
  function refreshLive(){ refreshMeta(); debPreview(); }
  let editingLive=false;
  applyDocLang();
  const dlSel=el("f_doclang");
  if(dlSel) dlSel.addEventListener("change", ()=>{ applyDocLang(); debPreview&&debPreview(); });
  function record(){
    const slug = curSlug(); const v=values();
    return { slug, business:el("f_biz").value.trim(),
      template: mode==="upload"?"custom":el("f_template").value,
      sent_on:el("f_sent").value, location:el("f_location").value.trim(),
      phone:el("f_phone").value.trim(), status:"sent", mode:mode, published:editingLive,
      doc_lang:(el("f_doclang")&&el("f_doclang").value)||"EN",
      fields:{ QUOTE:v.QUOTE, QUOTE_BY:v.QUOTE_BY, PROOF1:v.PROOF1, PROOF2:v.PROOF2, PROOF3:v.PROOF3, WANT:v.WANT } };
  }
  // store the page HTML only for uploads (template drafts regenerate on demand, which saves storage)
  async function fullRecord(){ const r=record(); if(mode==="upload") r.html=uploadedHTML||""; else delete r.html; return r; }

  // mode switch. Upload mode is a different act: it hosts a finished file, so it never shows the
  // fill-template picker (#templateField) or the fill-only quote fields (#quoteFields), both of
  // which leaked into upload mode before because they live outside #fillFields.
  function applyMode(){
    const up = mode==="upload";
    el("mode_upload").classList.toggle("on", up);
    el("mode_fill").classList.toggle("on", !up);
    el("fillFields").hidden = up;
    el("uploadBox").hidden = !up;
    const tf=el("templateField"); if(tf) tf.hidden = up;
    const qf=el("quoteFields");   if(qf) qf.hidden = up;
    const ed=document.querySelector(".editor"); if(ed) ed.classList.toggle("mode-upload", up);
  }
  function setMode(m){ mode=m; applyMode(); refresh(); }
  el("mode_fill").addEventListener("click",()=>setMode("fill"));
  el("mode_upload").addEventListener("click",()=>setMode("upload"));
  applyMode();   // reflect the resting mode so the picker and quote state is never stale

  // upload handling. One finished .html is the single-page path (kept as it was). Anything else,
  // a zip or several files or a batch document, is a batch: read it, match by slug, and show the
  // report. Nothing is hosted or stored from a batch until it is approved below.
  const dz=el("dz"), fileInput=el("fileInput"), batchPanel=el("batchPanel");
  let batch=null;
  dz.addEventListener("click",()=>fileInput.click());
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("over"); onFiles(e.dataTransfer&&e.dataTransfer.files);});
  fileInput.addEventListener("change",e=>{ onFiles(e.target.files); fileInput.value=""; });
  /* A zip dropped an inch wide of the box is the browser navigating away to open it, a day's work
     replaced by a file listing. Missing the target has to cost nothing. */
  if(!window.__thriveEdDropGuard){
    window.__thriveEdDropGuard=1;
    ["dragover","drop"].forEach(k=>document.addEventListener(k, e=>{
      if(e.target.closest && e.target.closest("#uploadBox")) return;
      e.preventDefault();
    }));
  }
  function onFiles(files){
    const arr=files? [].slice.call(files):[];
    if(!arr.length) return;
    if(arr.length===1 && /\.html?$/i.test(arr[0].name)) readFile(arr[0]);
    else runBatch(arr);
  }
  function readFile(f){
    if(!/\.html?$/i.test(f.name)){ toast(t("need_html")); return; }
    const fr=new FileReader();
    fr.onload=()=>{ uploadedHTML=fr.result; uploadedName=f.name; batch=null; batchPanel.hidden=true; batchPanel.innerHTML="";
      dz.innerHTML=t("uploaded")+"<b>"+esc(f.name)+"</b>"; if(!el("f_biz").value){ el("f_biz").value=f.name.replace(/\.html?$/i,""); }
      logActivity("upload", curSlug(), f.name); refresh(); };
    fr.onerror=()=>toast(t("read_err"));
    fr.readAsText(f);
  }

  /* The match report and the warn-before-write gate. Every reason names itself; a warned row is
     never guessed past. The reasons reuse the intake warning labels where they already exist. */
  const B_REASON={ no_page:"in_w_no_page", no_manifest_entry:"in_w_no_manifest_entry",
    no_text:"btr_no_text", duplicate_slug:"btr_dupe", exists_would_overwrite:"btr_exists",
    missing_business:"in_w_no_business", no_channel:"in_w_no_channel" };
  const reasonLabel=x=> t(B_REASON[x]||x);
  // Hostable: a real page and a manifest entry, not a duplicate, and not already live. This is the
  // matched set plus the "no text" and "no channel" pages Thyab is allowed to host as they are.
  function hostable(r){
    return r.hasPage && r.hasManifest
      && r.reasons.indexOf("duplicate_slug")<0
      && r.reasons.indexOf("exists_would_overwrite")<0;
  }
  async function runBatch(files){
    dz.innerHTML=esc(t("in_reading"));
    let out=null;
    try{
      const existing=await allSlugs();
      out=await ThriveIntake.readBatch(files, { existingSlugs:existing });
    }catch(e){
      dz.innerHTML=esc(t("upload_dz"));
      toast(/zip|inflate/i.test((e&&e.message)||"") ? t("in_zip_err") : t("in_none"));
      return;
    }
    dz.innerHTML=esc(t("upload_dz"));
    batch=out; renderBatch();
  }
  function batchCell(v){ return '<td class="bt-c">'+(v?'<span class="bt-y" data-icon="check"></span>':'<span class="bt-n">·</span>')+'</td>'; }
  function renderBatch(){
    if(!batch){ batchPanel.hidden=true; batchPanel.innerHTML=""; return; }
    const rep=batch.report;
    if(!rep.rows.length){ batchPanel.hidden=true; batchPanel.innerHTML=""; toast(t("in_none")); return; }
    const canHost=rep.rows.filter(hostable).length;
    const skip=rep.rows.length-canHost;
    let summary=boardText(getLang(),"bt_summary",canHost);
    if(skip>0) summary+=" "+boardText(getLang(),"bt_warned",skip);
    const head='<tr><th>'+esc(t("bt_slug"))+'</th><th>'+esc(t("bt_html"))+'</th><th>'+esc(t("bt_mfst"))+
      '</th><th>'+esc(t("bt_subj"))+'</th><th>'+esc(t("bt_body"))+'</th><th>'+esc(t("bt_send"))+'</th><th>'+esc(t("bt_verdict"))+'</th></tr>';
    const rows=rep.rows.map(r=>{
      const verdict = r.verdict==="matched"
        ? '<span class="bt-ok">'+esc(t("bt_matched"))+'</span>'
        : '<span class="bt-warn">'+r.reasons.map(x=>esc(reasonLabel(x))).join(", ")+'</span>';
      return '<tr class="'+(r.verdict==="matched"?"is-matched":"is-warned")+'">'+
        '<td class="mono-iso" dir="ltr">'+esc(r.slug)+'</td>'+
        batchCell(r.hasPage)+batchCell(r.hasManifest)+batchCell(r.hasSubject)+batchCell(r.hasBody)+batchCell(r.hasSendTo)+
        '<td>'+verdict+'</td></tr>';
    }).join("");
    batchPanel.innerHTML=
      '<h4 class="sec-h" data-icon="check">'+esc(t("in_report_h"))+'</h4>'+
      (batch.jsonError? '<div class="note warn-note">'+esc(t("bt_jsonerr"))+': '+esc(batch.jsonError)+'</div>':'')+
      '<div class="bt-wrap"><table class="bt">'+head+rows+'</table></div>'+
      '<p class="hint">'+esc(summary)+'</p>'+
      '<div class="bar bar-actions">'+
        '<button class="btn" id="batchApprove" data-icon="send"'+(canHost?'':' disabled')+'>'+esc(t("bt_approve"))+'</button>'+
        '<button class="btn ghost" id="batchDiscard">'+esc(t("in_cancel"))+'</button>'+
      '</div>';
    batchPanel.hidden=false;
    if(typeof applyIcons==="function") applyIcons(batchPanel);
    el("batchDiscard").addEventListener("click",()=>{ batch=null; renderBatch(); });
    const ab=el("batchApprove"); if(ab && canHost) ab.addEventListener("click", ()=> runAction("batchApprove", { working:t("publishing"), run: approveBatch }));
  }
  async function approveBatch(){
    if(!batch) throw new Error(t("bt_nothing"));
    if(!ghReady()){ setTimeout(()=>goTo("settings"),900); throw new Error(t("gh_needed")); }
    const rows=batch.report.rows.filter(hostable);
    if(!rows.length) throw new Error(t("bt_nothing"));
    let hosted=0, stored=0, failed=0;
    for(let k=0;k<rows.length;k++){
      const e=rows[k].entry;
      try{
        const rec=ThriveIntake.toRecord(e, { today:today(), note_text:batch.notes, batch:batch.batch });
        // Host the finished page as it is. publishOpp adds or merges the manifest entry
        // additively and idempotently; hostable already excluded any slug already live.
        await publishOpp(Object.assign({}, rec, { html:(e.file&&e.file.html)||"" }));
        hosted++;
        // Store the matched email text (subject, body, send-to) additively on the opportunity,
        // through saveDraft then logActivity, ready for the later send.
        rec.published=true;
        saveDraft(rec);
        logActivity("upload", rec.slug, rec.business||"");
        if(rec.outreach_text || rec.outreach_subject){ logActivity("in_import", rec.slug, t("bt_text_stored")); stored++; }
      }catch(err){ failed++; logActivity("publish_half", (e.slug_hint||""), String((err&&err.message)||err)); }
    }
    logActivity("in_batch", "", hosted+" hosted, "+stored+" texts stored, "+failed+" failed");
    let msg=boardText(getLang(),"bt_done",hosted);
    if(stored) msg+=" "+boardText(getLang(),"bt_stored",stored);
    if(failed) msg+=" "+boardText(getLang(),"bt_failed",failed);
    batch=null; batchPanel.hidden=true; batchPanel.innerHTML="";
    try{ scheduleSyncPush(); }catch(_){}
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
    return msg;                                  // shown by the runner as the confirmed outcome
  }

  // live inputs
  ["f_quote","f_quoteby","f_proof1","f_proof2","f_proof3","f_want","f_template"].forEach(id=>{
    el(id).addEventListener("input",refreshLive); el(id).addEventListener("change",refresh);
  });
  el("f_location").addEventListener("input",()=>{}); el("f_phone").addEventListener("input",()=>{});
  el("f_biz").addEventListener("input",()=>{ if(!el("f_slug").dataset.touched) el("f_slug").value=slugify(el("f_biz").value); refreshLive(); });
  el("f_slug").addEventListener("input",()=>{ el("f_slug").dataset.touched="1"; refreshLive(); });

  // preview controls
  const openTab=el("openTab"), copyLink=el("copyLink");
  if(openTab) openTab.addEventListener("click", async ()=>{
    const w=window.open("","_blank"); if(!w) return;
    w.document.open(); w.document.write(await currentHTML()); w.document.close();
  });
  if(copyLink) copyLink.addEventListener("click", ()=> runAction(copyLink, { doneMsg:t("link_copied"), run: async ()=>{
    const url=liveUrl(curSlug()||"<name>");
    try{ await navigator.clipboard.writeText(url); }
    catch(e){ throw new Error(url); }   // no clipboard: show the link itself so it can be copied by hand
  }}));
  document.querySelectorAll(".devtoggle [data-dev]").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll(".devtoggle [data-dev]").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); el("frame").classList.toggle("phone", b.getAttribute("data-dev")==="phone");
  }));

  function missingRequired(){
    if(mode==="upload") return uploadedHTML? [] : ["upload"];
    const need=[["f_proof1","f_proof1"],["f_proof2","f_proof2"],["f_proof3","f_proof3"],["f_want","f_want"]];
    return need.filter(([id])=>!el(id).value.trim()).map(([,k])=>k);
  }

  // actions, every one through the shared runner so its outcome is always visible
  el("dlPage").addEventListener("click", ()=> runAction("dlPage", { doneMsg:t("dl_toast"), run: async ()=>{
    if(!el("f_biz").value.trim()) throw new Error(t("need_biz"));
    if(missingRequired().length) throw new Error(t("need_fields"));
    download("index.html", await currentHTML());
    logActivity("download", curSlug(), el("f_biz").value.trim());
  }}));
  el("saveLib").addEventListener("click", ()=> runAction("saveLib", { doneMsg:t("saved_toast"), run: async ()=>{
    if(!el("f_biz").value.trim()) throw new Error(t("need_biz"));
    if(collides()) throw new Error(t("slug_taken"));   // never clobber another opp's record
    const rec=await fullRecord(); const isNew = existing.indexOf(rec.slug)<0;
    saveDraft(rec);
    if(isNew) existing.push(rec.slug);
    editingSlug = rec.slug;                              // this opp is now the one we're editing
    logActivity(isNew?"create":"save", rec.slug, rec.business);
  }}));
  const pubBtn=el("publishBtn");
  if(pubBtn) pubBtn.addEventListener("click", ()=> runAction("publishBtn", { working:t("publishing"), workingMsg:t("act_step_check"),
    // The confirmed activation presents the live link as a card; any other outcome stays a plain line.
    okRender:(res)=>{ if(res===t("activated_live")) activationCard(curSlug()); else actionStatus("ok", (typeof res==="string" && res) || t("act_done")); },
    run: async ()=>{
    // Narrate each step to the always-visible surface, so a tap that stops names where it stopped.
    if(!el("f_biz").value.trim()) throw new Error(t("need_biz"));
    if(missingRequired().length) throw new Error(t("need_fields"));
    if(collides()) throw new Error(t("slug_taken"));   // never overwrite another opp's live page
    if(!ghReady()){ setTimeout(()=>goTo("settings"),900); throw new Error(t("gh_needed")); }
    const rec=await fullRecord();
    const pubRec=Object.assign({}, rec, { html: await currentHTML() });
    // Commit, confirm, then flip: the editor never claims activated until the live link resolves.
    actionStatus("work", t("act_step_commit"));
    try{
      await publishOpp(pubRec);
    }catch(e){ throw new Error(e && e.half ? t("pub_half") : (t("gh_err")+": "+errText(e))); }
    actionStatus("work", t("act_step_confirm"));
    const live=await confirmLive(rec.slug);
    if(!live) return t("act_unconfirmed");             // committed, not yet confirmed live: state stays, reason shown
    editingLive=true; rec.published=true; saveDraft(rec);
    if(existing.indexOf(rec.slug)<0) existing.push(rec.slug);
    logActivity("publish", rec.slug, rec.business);
    return t("activated_live");
  }}));
  el("copyManifest").addEventListener("click", ()=> runAction("copyManifest", { doneMsg:t("copied_toast"), run: async ()=>{
    if(!el("f_biz").value.trim()) throw new Error(t("need_biz"));
    const r=record(); delete r.fields; const json=JSON.stringify(r,null,2);
    try{ await navigator.clipboard.writeText(json); }
    catch(e){ download("entry.json", json, "application/json"); }
    logActivity("copy", r.slug, "");
  }}));

  // prefill from ?slug= (edit any existing opp) or default date today. The disclosure's count
  // is taken again afterwards: one taken before the record is loaded says nothing is filled in
  // while the form is full, which is exactly the thing the count exists to prevent.
  const params=viewParams();
  el("f_sent").value = new Date().toISOString().slice(0,10);
  const editSlug=(slugArg!==undefined&&slugArg!==null&&slugArg!=="")?slugArg:params.get("slug");
  if(editSlug){
    const all=await mergedOpps();
    const d=all.find(x=>x.slug===editSlug);
    if(d){
      editingLive = (!d._local || !!d.published);
      el("f_biz").value=d.business||""; el("f_slug").value=d.slug; el("f_slug").dataset.touched="1";
      el("f_sent").value=d.sent_on||el("f_sent").value; el("f_location").value=d.location||""; el("f_phone").value=d.phone||"";
      if(d.template && d.template!=="custom"){ el("f_template").value=d.template; }
      /* The document's own language, explicit if it has one and inferred if it does not, but
         never taken from the chrome. */
      if(el("f_doclang")){ el("f_doclang").value=docLang(d); applyDocLang(); }
      const hasFields = d.fields && Object.keys(d.fields).some(k=>d.fields[k]);
      // restore an uploaded/custom page so editing keeps its content
      if((d.mode==="upload" || d.template==="custom") && d.html){
        mode="upload"; uploadedHTML=d.html; uploadedName=(d.slug||"page")+".html";
        applyMode();
        dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>";
      } else if(editingLive && !hasFields && !d._local){
        // Live opp published elsewhere (manifest-only, no local fields): pull the real page so a
        // save/publish can't overwrite it with a blank template regeneration.
        try{ const r=await fetchT(relOpp(d.slug)+"index.html",{cache:"no-store"});
          if(r.ok){ const html=await r.text();
            mode="upload"; uploadedHTML=html; uploadedName=(d.slug||"page")+".html";
            applyMode();
            dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>";
          }
        }catch(_){}
      }
      const F=d.fields||{};
      if("QUOTE" in F) el("f_quote").value=F.QUOTE||"";
      if("QUOTE_BY" in F) el("f_quoteby").value=F.QUOTE_BY||"";
      if("PROOF1" in F) el("f_proof1").value=F.PROOF1||"";
      if("PROOF2" in F) el("f_proof2").value=F.PROOF2||"";
      if("PROOF3" in F) el("f_proof3").value=F.PROOF3||"";
      if("WANT" in F) el("f_want").value=F.WANT||"";
    }
  }
  onThrive("lang","editor",()=>{
    relabelBuiltins();                                   // template names follow the language switch
    if(mode==="upload" && uploadedName) dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>";
    if(edMore) edMore();                                 // and so does the disclosure's label
  });
  if(edMore) edMore();                                   // now the form is loaded, count it again

  /* Undo and redo for the editor text fields. The history is keyed by the editing slug, so entering
     the same document again (a re-render) keeps its steps, while a different document starts fresh.
     Each field is seeded with its loaded value as the base step. */
  const H=ThriveEditHistory;
  const HIST_FIELDS=["f_biz","f_slug","f_location","f_phone","f_quoteby","f_want","f_quote","f_proof1","f_proof2","f_proof3"];
  const edUndoBtn=el("edUndo"), edRedoBtn=el("edRedo");
  function updateHist(){
    const id=H.last();
    if(edUndoBtn) edUndoBtn.disabled=!H.canUndo(id);
    if(edRedoBtn) edRedoBtn.disabled=!H.canRedo(id);
  }
  H.reset(editSlug||"");
  HIST_FIELDS.forEach(id=>{
    const f=el(id); if(!f) return;
    H.seed(f);
    f.addEventListener("input", ()=>{ H.record(f); H.setLast(id); updateHist(); });
    f.addEventListener("focus", ()=>{ H.setLast(id); updateHist(); });
    // The shortcuts, on the field itself so a focused field owns them: Cmd/Ctrl+Z undo, +Shift+Z or +Y redo.
    f.addEventListener("keydown", e=>{
      const meta=e.metaKey||e.ctrlKey; if(!meta) return;
      const k=(e.key||"").toLowerCase();
      if(k==="z" && !e.shiftKey){ e.preventDefault(); H.setLast(id); if(H.undo(f)) updateHist(); }
      else if((k==="z" && e.shiftKey) || k==="y"){ e.preventDefault(); H.setLast(id); if(H.redo(f)) updateHist(); }
    });
  });
  function actOn(fn){ const f=el(H.last()); if(!f) return; if(fn(f)) updateHist(); }
  if(edUndoBtn){ edUndoBtn.addEventListener("mousedown", e=>e.preventDefault());   // keep the field focused
    edUndoBtn.addEventListener("click", ()=> actOn(f=>H.undo(f))); }
  if(edRedoBtn){ edRedoBtn.addEventListener("mousedown", e=>e.preventDefault());
    edRedoBtn.addEventListener("click", ()=> actOn(f=>H.redo(f))); }
  updateHist();

  refresh();
}

/* ---------- activity log page (categorised operations + campaigns) ---------- */
const ACT_CAT={ email:"emails", email_copy:"emails", reply:"emails",
  create:"pages", save:"pages", publish:"pages", unpublish:"pages", download:"pages",
  archive:"pages", unarchive:"pages", remove:"pages", stage:"pages", copy:"pages", reassign:"emails",
  upload:"templates", tpl_add:"templates", tpl_remove:"templates", tpl_publish:"templates",
  etpl_add:"templates", etpl_remove:"templates",
  login:"system", export:"system", backup:"system", restore:"system", settings:"system", clear:"system" };
function actCat(a){ return ACT_CAT[a]||"system"; }
function initActivity(){
  const el=id=>document.getElementById(id);
  let cat="all";
  const actionLabel=a=>t("act_"+a) !== ("act_"+a) ? t("act_"+a) : a;
  function fmt(ts){ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",{dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts; } }

  function renderChips(){
    const cats=["all","pages","emails","templates","system"];
    el("logCats").innerHTML=cats.map(c=>`<button class="pl-pill${cat===c?" on":""}" data-cat="${c}">${t("cat_"+c)}</button>`).join("");
    el("logCats").querySelectorAll("[data-cat]").forEach(b=>b.addEventListener("click",()=>{ cat=b.getAttribute("data-cat"); renderChips(); render(); }));
  }
  let threadQ="";
  function statusLabel(m){
    if(m.direction==="in"||m.status==="replied") return t("mst_reply");
    if(m.status==="copied") return t("mst_copied");
    if(m.status==="sent") return t("mst_sent");
    return esc(m.status||"–");
  }
  let slugs=[];
  mergedOpps().then(o=>{ slugs=o.filter(x=>!x.archived).map(x=>({slug:x.slug, business:x.business})); renderThreads(); });
  function renderThreads(){
    const wrap=el("campaigns"); if(!wrap) return;
    let threads=getThreads();
    const total=threads.length;
    if(threadQ){ const q=threadQ.toLowerCase();
      threads=threads.filter(th=> (th.to+" "+th.toName+" "+th.opp+" "+th.templates.join(" ")).toLowerCase().includes(q)); }
    const shown=threads.length;
    const pill=(threadQ && shown!==total) ? (shown+" / "+total) : String(total);   // pill matches the visible cards
    const head='<div class="threads-head"><h3 class="block-h">'+t("act_threads")+' <span class="pill">'+pill+'</span></h3>'+
      '<input id="threadSearch" class="input sm" placeholder="'+esc(t("act_thread_search"))+'" value="'+esc(threadQ)+'"></div>'+
      '<p class="sub">'+esc(t("act_threads_sub"))+'</p>';
    if(!total){ wrap.innerHTML=head+'<div class="empty">'+t("act_no_threads")+'</div>'; bindSearch(); return; }
    const cards=threads.map(th=>{
      const who=esc(th.toName? (th.toName+" · "+th.to) : th.to);
      const tplB=th.templates.length? th.templates.map(n=>'<span class="tag tag-templates">'+esc(n)+'</span>').join('')
                                    : '<span class="tag tag-plain">'+t("cmp_no_tpl")+'</span>';
      const counts=th.sent+' '+t("cmp_sent_n")+(th.replied?' · '+th.replied+' '+t("cmp_replied_n"):'');
      const rows=th.msgs.map(m=>{
        const dir=(m.direction==="in")?'<span class="mdir in">←</span>':'<span class="mdir out">→</span>';
        const tp=m.templateName?'<span class="tag tag-templates">'+esc(m.templateName)+'</span>':'<span class="tag tag-plain">'+t("cmp_no_tpl")+'</span>';
        const br=m.branded?' <span class="tag">'+t("mst_branded")+'</span>':'';
        const pv=m.preview?'<div class="mprev">'+esc(m.preview)+'</div>':'';
        return '<div class="msg"><div class="msg-top">'+dir+'<span class="mono msg-time">'+esc(fmt(m.ts))+'</span>'+
          '<span class="tag">'+statusLabel(m)+'</span>'+tp+br+'</div>'+
          '<div class="msg-subj">'+esc(m.subject||"–")+'</div>'+pv+'</div>';
      }).join("");
      /* Which opportunity this conversation is about, as a decision you can correct. The
         composer used to keep one slug for a whole session, so a run of newsletters written in
         one sitting was filed against whichever page you happened to open it from. That is
         fixed going forward, and the console cannot know which old rows carried a link, so it
         does not guess: it hands you the correction instead. */
      const oppSel='<select class="th-opp" data-th="'+esc(th.id)+'" title="'+esc(t("act_which_opp"))+'">'+
        '<option value=""'+(th.opp?"":" selected")+'>'+esc(t("act_no_opp"))+'</option>'+
        slugs.map(sg=>'<option value="'+esc(sg.slug)+'"'+(sg.slug===th.opp?" selected":"")+'>'+
          esc(sg.business||sg.slug)+'</option>').join("")+'</select>';
      return '<details class="thread"><summary>'+
        '<div class="th-main"><span class="th-who">'+who+'</span><span class="th-meta">'+oppSel+tplB+'</span></div>'+
        '<div class="th-side"><span class="th-counts">'+counts+'</span><span class="mono th-last">'+esc(fmt(th.last))+'</span>'+
        '<button class="btn ghost sm th-reply" data-th="'+esc(th.id)+'" data-to="'+esc(th.to)+'" data-opp="'+esc(th.opp)+'">'+t("act_reply_btn")+'</button></div>'+
        '</summary><div class="thread-body">'+rows+'</div></details>';
    }).join("");
    wrap.innerHTML=head+'<div class="threads">'+cards+'</div>';
    bindSearch();
    wrap.querySelectorAll(".th-opp").forEach(sel=>{
      sel.addEventListener("click", e=>e.stopPropagation());
      sel.addEventListener("change", ()=>{
        const id=sel.getAttribute("data-th"), opp=sel.value;
        const th=getThreads().find(x=>x.id===id); if(!th) return;
        const ids={}; th.msgs.forEach(m=>{ if(m.mid) ids[m.mid]=1; });
        const all=getMailLog().map(m=> (m.mid && ids[m.mid])? Object.assign({}, m, {opp:opp}) : m);
        setMailLog(all);
        logActivity("reassign", opp||"(none)", th.to+" · "+th.msgs.length+" messages");
        toast(t("act_reassigned")); render();
      });
    });
    wrap.querySelectorAll(".th-reply").forEach(b=>b.addEventListener("click",e=>{
      e.preventDefault(); e.stopPropagation();
      const to=b.getAttribute("data-to"), opp=b.getAttribute("data-opp"), thread=b.getAttribute("data-th");
      const note=prompt(t("act_reply_note")); if(note===null) return;
      // Attach to THIS exact thread (opp-less threads can't be re-derived from to+subject alone).
      logMail({ thread:thread, opp:opp, to:to, subject:"Re: "+(opp||to), preview:(note||"").slice(0,600), provider:"manual", status:"replied", direction:"in" });
      logActivity("reply", opp||"", to); toast(t("act_reply_logged")); render();
    }));
  }
  function bindSearch(){
    const s=el("threadSearch"); if(!s) return;
    s.addEventListener("input",()=>{ threadQ=s.value; const pos=s.selectionStart; renderThreads();
      const s2=el("threadSearch"); if(s2){ s2.focus(); try{ s2.setSelectionRange(pos,pos); }catch(_){} } });
  }
  const renderCampaigns=renderThreads;

  /* The week, read back as a week. This page is a log, and a log is a list of rows in which
     nothing stands out, so a person who wants to know what happened has to reconstruct it in
     their head. Above the rows the same events are now grouped by day and said in a sentence:
     what went out, who answered, what was published, what was read. The table stays underneath
     for the moment you need the exact row. */
  function renderStory(){
    const wrap=el("logStory"); if(!wrap) return;
    const DAY=86400000, since=Date.now()-7*DAY;
    const mail=getMailLog().filter(m=>tsMs(m.ts)>=since);
    const acts=getActivity().filter(a=>tsMs(a.ts)>=since);
    const hits=allHits().filter(e=>(!e.type||e.type==="open") && tsMs(e.ts)>=since);
    const days={};
    const day=k=>days[k]||(days[k]={sent:0, replies:0, published:0, opens:0, people:new Set()});
    const dk=ts=>String(ts).slice(0,10);
    mail.forEach(m=>{
      const d=day(dk(m.ts));
      if(m.direction==="in"||m.status==="replied") d.replies++;
      else if(m.status==="sent"||m.status==="copied"){ d.sent++; if(m.to) d.people.add(String(m.to).toLowerCase()); }
    });
    acts.forEach(a=>{ if(a.action==="publish") day(dk(a.ts)).published++; });
    hits.forEach(e=>{ day(dk(e.ts)).opens++; });
    const keys=Object.keys(days).sort().reverse();
    if(!keys.length){ wrap.innerHTML='<div class="empty">'+esc(t("act_story_quiet"))+'</div>'; return; }
    const when=k=>{
      const today=dk(new Date().toISOString()), yest=dk(new Date(Date.now()-DAY).toISOString());
      if(k===today) return t("act_today");
      if(k===yest) return t("act_yesterday");
      try{ return new Date(k+"T12:00:00Z").toLocaleDateString(getLang()==="ar"?"ar":"en",{weekday:"long", day:"numeric", month:"long"}); }
      catch(e){ return k; }
    };
    wrap.innerHTML='<h3 class="block-h">'+esc(t("act_story_h"))+'</h3>'+
      '<p class="sub">'+esc(t("act_story_sub"))+'</p>'+
      '<ol class="story-days">'+keys.map(k=>{
        const d=days[k], said=[];
        const L=getLang();
        if(d.sent){ said.push(boardText(L,"act_s_sent",d.sent)); said.push(boardText(L,"act_s_to",d.people.size)); }
        if(d.replies) said.push(boardText(L,"act_s_replies",d.replies));
        if(d.published) said.push(boardText(L,"act_s_published",d.published));
        if(d.opens) said.push(boardText(L,"act_s_opens",d.opens));
        return '<li><span class="story-when">'+esc(when(k))+'</span><span class="story-said">'+
          (said.length? said.join(" ") : esc(t("act_s_nothing")))+'</span></li>';
      }).join("")+'</ol>';
  }

  function render(){
    renderStory();
    renderCampaigns();
    let rows=getActivity().slice().reverse();
    if(cat!=="all") rows=rows.filter(r=>actCat(r.action)===cat);
    const wrap=el("logBody");
    if(!rows.length){ wrap.innerHTML='<div class="empty">'+t("act_empty")+'</div>'; return; }
    wrap.innerHTML='<div class="logwrap"><table class="logtable"><thead><tr>'+
      '<th>'+t("act_time")+'</th><th>'+t("act_category")+'</th><th>'+t("act_action")+'</th><th>'+t("act_item")+'</th><th>'+t("act_detail")+'</th></tr></thead><tbody>'+
      rows.map(r=>`<tr><td class="mono">${esc(fmt(r.ts))}</td><td><span class="tag tag-cat-${esc(actCat(r.action))}">${t("cat_"+actCat(r.action))}</span></td><td><span class="tag tag-${esc(r.action)}">${esc(actionLabel(r.action))}</span></td><td class="mono">${esc(r.slug)||"–"}</td><td>${esc(r.detail)||"–"}</td></tr>`).join("")+
      '</tbody></table></div>';
  }
  el("logRefresh").addEventListener("click",render);
  el("logReply").addEventListener("click",()=>{
    const to=prompt(t("act_reply_who")); if(!to) return;
    const oppIn=prompt(t("act_reply_opp"))||"";
    const opp=oppIn.trim()?slugify(oppIn):"";   // match compose's slug convention so the reply joins the real thread
    const note=prompt(t("act_reply_note"))||"";
    logActivity("reply", opp, to.trim());
    logMail({ opp:opp, to:to.trim(), subject:"Re: "+(opp||to.trim()), preview:note.slice(0,600), provider:"manual", status:"replied", direction:"in" });
    toast(t("act_reply_logged")); render();
  });
  el("logClear").addEventListener("click",()=>{
    // This button deletes the campaign ledger, not just the operations list, and one mis-tap used
    // to be unrecoverable. Say what is going, and hand over a restorable file before deleting it.
    const mail=getMailLog(), acts=getActivity();
    if(!confirm(t("confirm_clear").replace("{m}", String(mail.length)).replace("{a}", String(acts.length)))) return;
    download("thrive-ledger-backup.json", JSON.stringify({ activity:acts, mail:mail },null,2), "application/json");
    setActivity([]); try{localStorage.removeItem(MAILLOG);}catch(e){} logActivity("clear","",""); render();
    toast(t("clear_backed_up"));
  });
  el("logExport").addEventListener("click",()=>{
    download("thrive-activity.json", JSON.stringify({ activity:getActivity(), mail:getMailLog() },null,2), "application/json");
  });
  onThrive("lang","activity",()=>{ renderChips(); render(); });
  onThrive("sync","activity",render);
  renderChips(); render();
}

/* ---------- email compose + send ---------- */
const EMAIL_EP = "thrive_email_ep";
const FROM_EMAIL = "hi@thriveiii.com";
const FROM_NAME_KEY = "thrive_from_name";
function getEmailEndpoint(){ try{ return localStorage.getItem(EMAIL_EP)||""; }catch(e){ return ""; } }
function setEmailEndpoint(u){ try{ u?localStorage.setItem(EMAIL_EP,u):localStorage.removeItem(EMAIL_EP); }catch(e){} }
function getFromName(){ try{ return (localStorage.getItem(FROM_NAME_KEY)||"Thrive"); }catch(e){ return "Thrive"; } }
function setFromName(v){ try{ v?localStorage.setItem(FROM_NAME_KEY, v):localStorage.removeItem(FROM_NAME_KEY); }catch(e){} }

/* ---- Resend free-tier guard: a local, rolling-window send counter (no third party) ----
   Resend's free plan allows 100 emails/day and 3,000/month. We keep a compact list of the
   timestamps of real sends made from this browser, prune it to 31 days, and derive usage
   over a rolling 24h window (each send frees exactly 24h later) and a rolling 30d window.
   This only counts sends from THIS device. Resend's dashboard is the true source of truth;
   this is a safety rail to stay comfortably under the free tier. */
const QUOTA = "thrive_quota_v1";               // array of send timestamps (ms)
const QUOTA_CFG = "thrive_quota_cfg_v1";       // { daily, monthly }
const DAY_MS=86400000, MONTH_MS=30*86400000;
function quotaCfg(){ try{ const c=JSON.parse(localStorage.getItem(QUOTA_CFG)||"{}"); return { daily:(c.daily>0?c.daily:100), monthly:(c.monthly>0?c.monthly:3000) }; }catch(e){ return { daily:100, monthly:3000 }; } }
function setQuotaCfg(c){ try{ localStorage.setItem(QUOTA_CFG, JSON.stringify({ daily:Math.max(1,parseInt(c.daily,10)||100), monthly:Math.max(1,parseInt(c.monthly,10)||3000) })); }catch(e){} }
function getSendStamps(){ try{ const a=JSON.parse(localStorage.getItem(QUOTA)||"[]"); return Array.isArray(a)?a.filter(n=>typeof n==="number"):[]; }catch(e){ return []; } }
function recordSend(){ const now=Date.now(); const a=getSendStamps().filter(t=> now-t < MONTH_MS+DAY_MS); a.push(now); lsSet(QUOTA, JSON.stringify(a)); }
// Current usage + remaining headroom against the configured caps.
function quotaUsage(){
  const now=Date.now(), st=getSendStamps(), c=quotaCfg();
  const dayStamps=st.filter(t=> now-t < DAY_MS);
  const day=dayStamps.length, month=st.filter(t=> now-t < MONTH_MS).length;
  // when at the daily cap, the oldest in-window send is what frees a slot next
  let freeInMs=0;
  if(day>=c.daily && dayStamps.length){ const oldest=Math.min.apply(null,dayStamps); freeInMs=Math.max(0, DAY_MS-(now-oldest)); }
  return { day, month, dailyCap:c.daily, monthlyCap:c.monthly,
           dayLeft:Math.max(0,c.daily-day), monthLeft:Math.max(0,c.monthly-month),
           dayFull:day>=c.daily, monthFull:month>=c.monthly, freeInMs };
}
function fmtDur(ms){ const h=Math.floor(ms/3600000), m=Math.round((ms%3600000)/60000); return (h>0? h+"h ":"")+m+"m"; }
/* wrap the message with a branded header (logo) + footer for outgoing mail */
// Wrap the message body for sending.
//  branded=false (default): a clean, personal 1:1 email, no logo image, system font,
//    plain text signature. Reads like a real person wrote it, so it lands in the inbox
//    instead of Gmail's Promotions tab.
//  branded=true (opt-in): adds the Thrive logo header for known contacts / announcements.
/* ---- the link card, one component, used by both paths -------------------
   Both paths deliver the same two things: the campaign text and the page
   link. A prospect reading either should see the same object, so the card is
   built once. It is what makes a message pasted into a contact form look
   considered rather than pasted. */
function linkCard(o, opts){
  opts=opts||{};
  const url=liveUrl(o.slug);
  const title=o.business||o.slug;
  const desc=o.descriptor||o.outreach_subject||t("lc_card_desc");
  return '<div class="link-card">'+
    '<div class="lc-body">'+
      '<div class="lc-title">'+esc(title)+'</div>'+
      '<div class="lc-desc">'+esc(desc)+'</div>'+
      '<a class="lc-url" href="'+esc(url)+'" target="_blank" rel="noopener">'+ltr(esc(url))+'</a>'+
    '</div>'+
    (opts.copy===false? '' :
      '<button class="btn ghost sm lc-copy" type="button" data-lcurl="'+esc(url)+'">'+
      ic("copy")+esc(t("lc_copy_link"))+'</button>')+
    '</div>';
}
function bindLinkCards(root){
  (root||document).querySelectorAll("[data-lcurl]").forEach(b=>b.addEventListener("click",()=>{
    const u=b.getAttribute("data-lcurl");
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(u).then(()=>toast(t("oc_copied")),
        ()=>toast(legacyCopy(u)? t("oc_copied") : t("cmp_copy_err")));
      return;
    }
    toast(legacyCopy(u)? t("oc_copied") : t("cmp_copy_err"));
  }));
}

/* ---------- a question with three answers ----------
   confirm() offers two, and the answer a person actually wants when they tap
   outside a half written message is the third one: keep editing. So this is a
   real dialogue rather than a window.confirm, and it returns the index. */
function threeWay(title, body, labels){
  return new Promise(resolve=>{
    const old=document.getElementById("threeWay");
    if(old) old.remove();
    const box=document.createElement("div");
    box.id="threeWay"; box.className="tw-scrim";
    box.innerHTML='<div class="tw-box" role="alertdialog" aria-modal="true" aria-labelledby="twT">'+
      '<h3 class="tw-t" id="twT">'+esc(title)+'</h3>'+
      '<p class="tw-p">'+esc(body)+'</p>'+
      '<div class="tw-acts">'+labels.map((l,i)=>
        '<button class="btn'+(i===0?"":" ghost")+(i===2?" danger":"")+'" type="button" data-tw="'+i+'">'+
        esc(l)+'</button>').join("")+'</div></div>';
    document.body.appendChild(box);
    const done=i=>{ box.remove(); resolve(i); };
    box.querySelectorAll("[data-tw]").forEach(b=>
      b.addEventListener("click",()=>done(parseInt(b.getAttribute("data-tw"),10))));
    /* Escape on the question means keep editing. Anything else would make the
       gesture that saves you the gesture that loses your work. */
    box.addEventListener("keydown", e=>{ if(e.key==="Escape"){ e.stopPropagation(); done(0); } });
    box.addEventListener("click", e=>{ if(e.target===box) done(0); });
    const first=box.querySelector("[data-tw]"); if(first) first.focus();
  });
}

/* ---------- the closing block ----------
   It was a fixed string built inside brandWrap and invisible until send. It is
   now a stored object with one block PER LOCALE, chosen by the opportunity's
   document language rather than by the chrome, so writing in Arabic chrome to an
   English prospect still signs off in English. WO-013 §5.1. */
const SIGN="thrive_signature_v1";
function getSignatures(){
  try{ return JSON.parse(localStorage.getItem(SIGN)||"{}"); }catch(e){ return {}; }
}
function defaultSignature(loc){
  const name=getFromName();
  return loc==="AR"
    ? name+"\nthriveiii.com"
    : name+"\nthriveiii.com";
}
function signatureFor(loc){
  const L=(loc==="AR")?"AR":"EN";
  const all=getSignatures();
  const v=all[L];
  return (typeof v==="string" && v.trim()) ? v : defaultSignature(L);
}
function setSignature(loc, text){
  const L=(loc==="AR")?"AR":"EN";
  const all=getSignatures(); all[L]=String(text||"");
  return lsSet(SIGN, JSON.stringify(all));
}
/* Plain text, generated from the rich body rather than typed twice. Two copies a
   person maintains by hand are two copies that disagree. */
function toPlainText(html, sig){
  let s=String(html||"");
  s=s.replace(/<br\s*\/?>/gi,"\n")
     .replace(/<\/(p|div|li|h[1-6])>/gi,"\n")
     .replace(/<li[^>]*>/gi,"- ")
     .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function(_,h,txt){
        const t=String(txt).replace(/<[^>]*>/g,"").trim();
        /* A link whose text already IS the URL must not be printed twice. */
        return (t && t!==h) ? (t+" ("+h+")") : h;
     })
     .replace(/<[^>]*>/g,"");
  s=s.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
     .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  s=s.replace(/\n{3,}/g,"\n\n").replace(/[ \t]+\n/g,"\n").trim();
  return sig ? (s+"\n\n"+sig) : s;
}

function brandWrap(inner, branded, sigText){
  const name=esc(getFromName());
  const sig=(sigText===undefined||sigText===null) ? "" : String(sigText);
  const sigHtml=sig.trim()
    ? esc(sig).split("\n").join("<br>")
    : "";
  const font='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
  const closing = sigHtml
    ? '<div style="margin-top:18px;color:#444">'+sigHtml+'</div>'
    : '<div style="margin-top:18px;color:#444">'+name+'<br><a href="https://thriveiii.com" style="color:#444;text-decoration:none">thriveiii.com</a></div>';
  if(!branded){
    return '<div style="font-family:'+font+';font-size:15px;line-height:1.6;color:#222">'
      +inner+closing+'</div>';
  }
  const logo="https://"+SITE+"/assets/thrive-logo.png";
  return '<div style="font-family:'+font+';max-width:600px;margin:0 auto;padding:10px 4px">'
    +'<img src="'+logo+'" width="42" height="42" alt="'+name+'" style="display:block;border-radius:10px;margin-bottom:16px">'
    +'<div style="font-size:15px;line-height:1.7;color:#111827">'+inner+'</div>'
    +'<div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#9aa0aa">'
      +(sigHtml||(name+' · thriveiii.com'))+'</div>'
    +'</div>';
}

/* email templates (reusable subject + body with merge fields) */
const ETPL = "thrive_email_templates_v1";
/* The monthly template is month-aware ({{MONTH}}: the composer asks which month) and ships
   with NO embedded opportunity link: the writer decides which words carry it (guided flow). */
const ETPL_MONTHLY = { id:"monthly", locale:"EN", name:"Monthly update", subject:"{{MONTH}} at Thrive",
  html:'Hi {{NAME}},<br><br>End of the month, so here is {{MONTH}} at Thrive. We take on the work we think we’ll be proud of. If that could be yours, just say hi.<br><br>See you next month!<br><br>Abdullah Thyab<br>thriveiii.com' };
/* Arabic edition of the stock template, a real Arabic message, not a translation of labels
   around English text. Greeting is «مرحبًا فلان،», not "Hi …". */
const ETPL_MONTHLY_AR = { id:"monthly-ar", locale:"AR", name:"التحديث الشهري", subject:"{{MONTH}} في ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>مع نهاية الشهر، هذا هو {{MONTH}} في ثرايف. نحن نختار العمل الذي نفخر به. إن كان ذلك يناسبك، تكفي كلمة.<br><br>إلى الشهر القادم!<br><br>عبدالله ذياب<br>thriveiii.com' };
/* The two that matter on the day you publish a page: the message that sends it, and the one
   that follows up when nothing came back. Both carry the link inside real words rather than
   as a bare URL, and neither states anything about the recipient: every fact in them is a
   merge field or something you type. They are a starting point, and you edit them. */
const ETPL_OPP = { id:"opp-intro", locale:"EN", name:"Send an opportunity page", subject:"{{BIZ}} x Thrive",
  html:'Hi {{NAME}},<br><br>I put together <a href="{{LINK}}">a short page for {{BIZ}}</a>. One screen, no form to fill in. It says what I noticed and what I would do about it.<br><br>If it is worth a conversation, just reply. If not, no reply needed.<br><br>Abdullah Thyab<br>thriveiii.com' };
const ETPL_OPP_AR = { id:"opp-intro-ar", locale:"AR", name:"إرسال صفحة فرصة", subject:"{{BIZ}} مع ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>أعددت <a href="{{LINK}}">صفحة قصيرة لـ {{BIZ}}</a>. شاشة واحدة، بلا نموذج تملؤه. فيها ما لاحظته وما أقترح فعله.<br><br>إن كانت تستحق حديثًا، يكفي أن تردّ. وإن لم تكن، فلا حاجة للرد.<br><br>عبدالله ذياب<br>thriveiii.com' };
const ETPL_NUDGE = { id:"opp-nudge", locale:"EN", name:"Follow up once", subject:"Re: {{BIZ}} x Thrive",
  html:'Hi {{NAME}},<br><br>Bringing <a href="{{LINK}}">the page for {{BIZ}}</a> back to the top of your inbox, in case it arrived on a busy day.<br><br>If the timing is wrong, tell me and I will leave it there.<br><br>Abdullah Thyab<br>thriveiii.com' };
const ETPL_NUDGE_AR = { id:"opp-nudge-ar", locale:"AR", name:"متابعة واحدة", subject:"إعادة: {{BIZ}} مع ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>أعيد <a href="{{LINK}}">صفحة {{BIZ}}</a> إلى أعلى بريدك، فربما وصلت في يوم مزدحم.<br><br>وإن كان التوقيت غير مناسب، أخبرني وأتركها عند هذا الحد.<br><br>عبدالله ذياب<br>thriveiii.com' };

/* Which stock templates this console has already been offered. Without it, deleting one
   brought it back on the next load, which is a console overruling a decision you made. */
const ETPL_SEED = "thrive_etpl_seed_v1";
const ETPL_STOCK = [ETPL_OPP, ETPL_OPP_AR, ETPL_NUDGE, ETPL_NUDGE_AR, ETPL_MONTHLY, ETPL_MONTHLY_AR];
function etplSeeded(){ try{ return JSON.parse(localStorage.getItem(ETPL_SEED)||"[]"); }catch(e){ return []; } }
function getEmailTemplates(){
  let a; try{ a=JSON.parse(localStorage.getItem(ETPL)||"null"); }catch(e){ a=null; }
  const fresh = !a;
  if(!a) a=[];
  else{
    // migrate the two OLD stock defaults (hard-wired month / auto-embedded link) to the new one
    const i=a.findIndex(x=>x.id==="monthly");
    if(i>=0 && /<a href="\{\{LINK\}\}">(this month|July) at Thrive<\/a>/.test(a[i].html||"")){
      a[i]=Object.assign({},ETPL_MONTHLY); try{ localStorage.setItem(ETPL, JSON.stringify(a)); }catch(e){}
    }
  }
  // Offer each stock template exactly once, ever. A console that already has it keeps its own
  // edits; a console where you deleted it does not get it back.
  const seen=etplSeeded(), add=[], seedNow=seen.slice();
  ETPL_STOCK.forEach(tp=>{
    const known = a.some(x=>x.id===tp.id) || (!fresh && seen.indexOf(tp.id)>=0);
    if(!known){ add.push(Object.assign({},tp)); }
    if(seedNow.indexOf(tp.id)<0) seedNow.push(tp.id);
  });
  if(add.length || seedNow.length!==seen.length){
    a=a.concat(add);
    try{ localStorage.setItem(ETPL, JSON.stringify(a)); localStorage.setItem(ETPL_SEED, JSON.stringify(seedNow)); }catch(e){}
  }
  return a;
}
function setEmailTemplates(a){ return lsSet(ETPL, JSON.stringify(a)); }
function saveEmailTemplate(rec){ rec.up=Date.now(); const a=getEmailTemplates(); const i=a.findIndex(x=>x.id===rec.id);
  if(i<0 && !rec.type) rec.type=T_SNIPPET;   // a message template is a text snippet, typed at creation
  if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setEmailTemplates(a); }
/* A bound snippet holds a REFERENCE to its editable template, its id, never a copy of the
   template's text. So the binding is resolved live here, and an edit to the template propagates the
   next time the snippet is read: a copied snippet would silently go stale. */
function boundTemplate(et){ return (et && et.template_ref) ? getCustomTemplate(et.template_ref) : null; }
/* Conscious migration (page templates only). Every page template made before the taxonomy has no
   type; default each to the widest type, the editable template, and mark it migrated so Thyab can
   review and correct. Message templates are text snippets by their store, so they are typed as
   such, not defaulted to editable. Additive and idempotent: a record that already carries a type is
   skipped, and every write is through the store's save path then logActivity, never a direct write.
   Returns the counts so the count can be shown. */
function migrateItemTypes(){
  let pages=0, snippets=0;
  getCustomTemplates().forEach(function(ct){
    if(ct && !ct.type){ saveCustomTemplate({ id:ct.id, type:T_EDITABLE, type_migrated:true });
      logActivity("type_migrate", ct.id, T_EDITABLE); pages++; }
  });
  getEmailTemplates().forEach(function(et){
    if(et && !et.type){ saveEmailTemplate({ id:et.id, type:T_SNIPPET }); snippets++; }  // typed by store, not a guess
  });
  if(pages||snippets) logActivity("type_migrate_batch", "", pages+" pages to editable-template, "+snippets+" messages typed");
  return { pages:pages, snippets:snippets };
}
function removeEmailTemplate(id){ markRemoved("etpl", id); setEmailTemplates(getEmailTemplates().filter(x=>x.id!==id)); }
/* Merge fields, two variants:
   - mergeFieldsText: plain replacements for the subject input (.value, never HTML).
   - mergeFieldsHtml: for the body. Values are escaped (a name like "<img onerror=…>" must never
     execute in the console origin), and NAME/MONTH become tagged spans so the editor can keep
     them in sync live, even after the writer has edited the rest of the message. */
function mergeFieldsText(str, o, name, month){
  return (str||"").split("{{BIZ}}").join((o&&o.business)||"")
    .split("{{LINK}}").join(o?liveUrl(o.slug):"")
    .split("{{NAME}}").join(name||"there")
    .split("{{MONTH}}").join(month||"")
    .split("{{SLUG}}").join(o?o.slug:"");
}
function mergeFieldsHtml(str, o, name, month){
  return (str||"").split("{{BIZ}}").join(esc((o&&o.business)||""))
    .split("{{LINK}}").join(o?liveUrl(o.slug):"")
    .split("{{NAME}}").join('<span data-m="name">'+esc(name||"there")+'</span>')
    .split("{{MONTH}}").join('<span data-m="month">'+esc(month||"")+'</span>')
    .split("{{SLUG}}").join(esc(o?o.slug:""));
}
function tplUsesMonth(tp){ return !!tp && /\{\{MONTH\}\}/.test((tp.subject||"")+(tp.html||"")); }

/* mail log: every send/copy/reply, per recipient (campaign documentation) */
const MAILLOG = "thrive_mail_v1";
function getMailLog(){ try{ return JSON.parse(localStorage.getItem(MAILLOG)||"[]"); }catch(e){ return []; } }
function setMailLog(a){ const ok=lsSet(MAILLOG, JSON.stringify(a.slice(-800))); invalidateSends(); return ok; }
// Normalise a subject into a stable conversation root (strip Re:/Fwd:/رد: prefixes).
function subjRoot(s){ return (s||"").replace(/^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*/i,"").replace(/^\s*(re|fwd|fw|رد)\s*:\s*/i,"").trim().toLowerCase().slice(0,80); }
// A thread groups every message to one recipient about one opportunity (or, with no
// opportunity, one subject line), so template sends, plain sends, and replies chain together.
function threadKey(to, opp, subject){
  const person=(to||"").trim().toLowerCase();
  const root=((opp||"").trim().toLowerCase()) || subjRoot(subject) || "(no-subject)";
  return person+"|"+root;
}
function newMid(){ try{ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }catch(e){ return "m"+(getMailLog().length+1); } }
// Central ledger writer: stamps a unique message id, resolves the thread, and fixes direction.
function logMail(rec){
  const a=getMailLog();
  const r=Object.assign({ ts:new Date().toISOString(), actor:ACTOR }, rec);
  if(!r.mid) r.mid=newMid();
  if(!r.actor) r.actor=ACTOR;
  if(!r.thread) r.thread=threadKey(r.to, r.opp, r.subject);
  if(!r.direction) r.direction=(r.status==="replied"||r.status==="received")?"in":"out";
  /* WO-015 I8: a mail record carries its chapter. One is the first contact, two is
     the offer. It defaults to one, so every record written before this reads as
     the first contact with nothing to migrate. */
  if(r.chapter==null) r.chapter=1;
  if(r.templateId===undefined) r.templateId="";
  if(r.templateName===undefined) r.templateName="";
  a.push(r); setMailLog(a);   // invalidates the send index: a send changes a lane immediately
  return r;
}
// Roll the flat mail log up into thread objects, newest activity first.
function getThreads(){
  const mail=getMailLog(), map={};
  mail.forEach(m=>{
    const k=m.thread||threadKey(m.to,m.opp,m.subject);
    const th=map[k]||(map[k]={ id:k, to:(m.to||"–"), toName:(m.toName||""), opp:(m.opp||""), msgs:[], templates:[], sent:0, replied:0, first:m.ts, last:m.ts });
    th.msgs.push(m);
    if(m.toName && !th.toName) th.toName=m.toName;
    if(m.opp && !th.opp) th.opp=m.opp;
    if(m.status==="sent"||m.status==="copied") th.sent++;
    if(m.direction==="in"||m.status==="replied") th.replied++;
    if(m.templateName && th.templates.indexOf(m.templateName)<0) th.templates.push(m.templateName);
    if(m.ts<th.first) th.first=m.ts;
    if(m.ts>th.last) th.last=m.ts;
    map[k]=th;
  });
  return Object.values(map).map(th=>{ th.msgs.sort((a,b)=> (a.ts<b.ts?-1:1)); return th; })
    .sort((a,b)=> (a.last<b.last?1:-1));
}

/* ---------- WO-015 Phase A: the thread, derived and read-only ----------
   The thread already exists as data. Every outbound message is in the mail
   ledger under its slug, every reply the relay captured is attributed to that
   slug, every open is in the hits map, every stage change is in the activity
   log. It has never been shown as one thing. This assembles the one thing.

   I7: the thread stores nothing. buildThread reads the four sources and returns
   a time ordered array. It writes nowhere, holds no state, and derives no stage
   (I3 leaves that to effStage). If the thread and the ledger ever disagree, the
   bug is here, because here is the only place that can be wrong.

   Order: oldest first, newest at the foot. A thread is read as a story, from the
   first contact forward to the reply that first contact earned, and the chapter
   divider (Phase C) between the first contact and the offer only reads in that
   direction. A reply carries the snippet the relay stored and a link to open it
   in Gmail, never a full body: the body lives in Gmail and stays there. */
function buildThread(slug){
  slug=String(slug||"");
  if(!slug) return [];
  const out=[];
  const ms=v=>{ const n=tsMs(v); return n||0; };

  // 1. the sends and any manually logged replies in the ledger, this slug only
  getMailLog().forEach(m=>{
    if(!m || m.opp!==slug) return;
    if(m.direction==="in" || m.status==="replied" || m.status==="received"){
      out.push({ kind:"reply", ts:m.ts, source:"ledger", from:(m.toName||m.to||""),
                 subject:m.subject||"", snippet:(m.preview||"").slice(0,600), chapter:m.chapter||1, mid:m.mid });
    }else{
      out.push({ kind:"sent", ts:m.ts, to:m.to||"", toName:m.toName||"",
                 subject:m.subject||"", channel:m.provider||"", status:m.status||"sent",
                 templateName:m.templateName||"", chapter:m.chapter||1, mid:m.mid });
    }
  });

  // 2. the relay inbox: real replies carry a snippet and a Gmail link, autos are
  //    machinery (a bounce) shown and labelled, never counted as a reply.
  inboundFor(slug).forEach(r=>{
    if(r.kind==="auto"){
      out.push({ kind:"auto", ts:r.ts, bounce:r.bounce||"", from:r.from||"" });
    }else{
      out.push({ kind:"reply", ts:r.ts, source:"inbox", from:(r.name||r.from||""),
                 fromAddr:r.from||"", subject:r.subject||"", snippet:(r.snippet||"").slice(0,600),
                 rule:r.rule||"none", chapter:r.chapter||1, gmail:(typeof ThriveInbound!=="undefined"&&ThriveInbound.gmailLink)?ThriveInbound.gmailLink(r):"" });
    }
  });

  // 3. every open of this slug's page. An open is a fact the prospect produced,
  //    so it belongs in the thread beside the sends that could have caused it.
  allHits().forEach(e=>{
    if(!e || e.slug!==slug) return;
    if(e.type && e.type!=="open") return;
    out.push({ kind:"open", ts:e.ts, ms:e.ms });
  });

  // 4. the stage changes and notes, from the activity log
  getActivity().forEach(a=>{
    if(!a || a.slug!==slug) return;
    out.push({ kind:"act", ts:a.ts, action:a.action||"", detail:a.detail||"", actor:a.actor||"" });
  });

  out.sort((x,y)=>{ const dx=ms(x.ts), dy=ms(y.ts); return dx===dy? 0 : (dx<dy? -1 : 1); });
  return out;
}
/* The active chapter is a reading of the ledger, never stored on the opportunity
   (I8). It is the highest chapter number any send to this slug carries, or 1 when
   there is none. Phase C gives the card its marker and Phase D opens chapter 2;
   this is the one derivation both read. */
function activeChapter(slug){
  let ch=1;
  getMailLog().forEach(m=>{ if(m && m.opp===slug && (m.chapter||1)>ch) ch=m.chapter||1; });
  return ch;
}
/* WO-015 §6: the lane reflects the furthest state of the ACTIVE chapter. For the
   only chapter that exists today, chapter one, this is exactly effStage, so the
   board does not move a single card: effStage stays the single authority (I3) for
   the state that is actually there. When Phase D opens chapter two, a card that
   was answered in chapter one and then sent an offer reads from the offer's own
   evidence rather than staying on the earlier reply, because the earlier reply is
   a fact about a chapter that has closed. The chapter's evidence is its sends, the
   opens after its first send, and any reply attributed to it. */
function activeChapterStage(o){
  if(!o || typeof o!=="object") return effStage(o);
  const slug=o.slug, ch=activeChapter(slug);
  if(ch<=1) return effStage(o);
  const sends=getMailLog().filter(m=> m && m.opp===slug && m.direction!=="in" && (m.chapter||1)===ch);
  if(!sends.length) return effStage(o);                 // this chapter has not sent yet
  if(getInbound().some(r=> r && r.opp===slug && r.kind!=="auto" && (r.chapter||1)===ch)) return "replied";
  const firstTs=sends.map(m=>m.ts).sort()[0];
  return opensSince(slug, firstTs)>0 ? "opened" : "sent";
}

async function initCompose(slugArg){
  const el=id=>document.getElementById(id);
  const body=el("ebody");
  const params=viewParams();
  const slug=(slugArg!==undefined&&slugArg!==null&&slugArg!=="")?slugArg:params.get("slug");
  const oppUrl = slug ? liveUrl(slug) : "";

  // rich editor: keep the selection alive when clicking toolbar buttons
  document.querySelectorAll(".etoolbar button").forEach(b=>b.addEventListener("mousedown",e=>e.preventDefault()));
  function cmd(c,v){ document.execCommand(c,false,v||null); }
  function hasSel(){ const s=window.getSelection(); return s.rangeCount && !s.isCollapsed; }
  el("tbBold").addEventListener("click",()=>cmd("bold"));
  el("tbItalic").addEventListener("click",()=>cmd("italic"));
  el("tbUnder").addEventListener("click",()=>cmd("underline"));
  el("tbList").addEventListener("click",()=>cmd("insertUnorderedList"));
  // tbUnlink is wired once, below, together with the links-manager refresh

  // ---- robust multi-link engine (DOM-based; reliable on touch/iPad, no execCommand) ----
  const linkBar=el("elinkbar"), linkUrl=el("elinkurl"), linkText=el("elinktext"),
        linksBox=el("elinks"), presetsBox=el("elinkpresets");
  let savedRange=null, editingAnchor=null;
  // Keep the last real selection inside the editor alive across taps into the URL field.
  // Registered on the document, so the previous one is removed first: the composer can be
  // opened again with a different opportunity, and one document must not collect a watcher
  // per opening.
  const onSel=()=>{
    const s=window.getSelection(); if(!s.rangeCount) return;
    const r=s.getRangeAt(0);
    if(body.contains(r.commonAncestorContainer) && !r.collapsed) savedRange=r.cloneRange();
  };
  if(window.__thriveSelWatch) document.removeEventListener("selectionchange", window.__thriveSelWatch);
  window.__thriveSelWatch=onSel;
  document.addEventListener("selectionchange", onSel);
  // Accept bare domains, emails, and phone numbers, turning them into valid hrefs.
  function normalizeUrl(u){
    u=(u||"").trim(); if(!u) return "";
    if(/^(https?:|mailto:|tel:|#|\/)/i.test(u)) return u;
    if(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u)) return "mailto:"+u;
    if(/^\+?[\d][\d\s()\-]{5,}$/.test(u)) return "tel:"+u.replace(/[^\d+]/g,"");
    return "https://"+u.replace(/^\/+/,"");
  }
  function presetList(){
    const a=[];
    if(oppUrl) a.push({label:t("cmp_lp_opp"), url:oppUrl});
    a.push({label:t("cmp_lp_site"), url:"https://thriveiii.com"});
    a.push({label:t("cmp_lp_email"), url:"mailto:hi@thriveiii.com"});
    a.push({label:t("cmp_lp_whatsapp"), url:"https://wa.me/"});
    a.push({label:t("cmp_lp_call"), url:"tel:+"});
    return a;
  }
  function renderPresets(){
    if(!presetsBox) return;
    presetsBox.innerHTML=presetList().map(p=>'<button type="button" class="lp" data-url="'+esc(p.url)+'">'+esc(p.label)+'</button>').join("");
    presetsBox.querySelectorAll(".lp").forEach(b=>{
      b.addEventListener("mousedown",e=>e.preventDefault());
      b.addEventListener("click",()=>{ linkUrl.value=b.getAttribute("data-url"); linkUrl.focus(); });
    });
  }
  function openLinkBar(preset, forceAnchor){
    const a=forceAnchor || null;
    editingAnchor=a;
    linkUrl.value = a ? (a.getAttribute("href")||"") : (preset||"");
    linkText.value = a ? a.textContent : (savedRange && !savedRange.collapsed ? savedRange.toString() : "");
    linkBar.hidden=false; renderPresets(); setTimeout(()=>{ (linkUrl.value?linkText:linkUrl).focus(); },30);
  }
  function applyLink(){
    const url=normalizeUrl(linkUrl.value);
    if(!url){ toast(t("cmp_link_need_url")); return; }
    const text=(linkText.value||"").trim();
    const selText = (savedRange && !savedRange.collapsed) ? savedRange.toString().trim() : "";
    if(editingAnchor){                                   // editing an existing link
      editingAnchor.setAttribute("href",url);
      if(text) editingAnchor.textContent=text;
      if(!editingAnchor.getAttribute("data-origin")) editingAnchor.setAttribute("data-origin","custom");
    } else if(selText && (!text || text===selText)){     // wrap the selected words (keeps formatting)
      const a=document.createElement("a"); a.href=url; a.setAttribute("data-origin","custom");
      try{ a.appendChild(savedRange.extractContents()); savedRange.insertNode(a); }catch(e){}
    } else {                                             // insert a brand-new link (text or url)
      const a=document.createElement("a"); a.href=url; a.setAttribute("data-origin","custom"); a.textContent=text||url;
      if(savedRange){ try{ savedRange.deleteContents(); savedRange.insertNode(a); }catch(e){ body.appendChild(a); } }
      else body.appendChild(a);
    }
    linkBar.hidden=true; editingAnchor=null; savedRange=null;
    refreshLinks();
  }
  // "Links in this message" manager: every link is visible, editable, removable.
  function refreshLinks(){
    if(!linksBox) return;
    const anchors=[].slice.call(body.querySelectorAll("a"));
    if(!anchors.length){ linksBox.hidden=true; linksBox.innerHTML=""; renderOppStatus(); return; }
    linksBox.hidden=false;
    linksBox.innerHTML='<div class="elinks-h">'+t("cmp_links_h")+' <span class="pill">'+anchors.length+'</span></div>'+
      anchors.map((a,i)=>{
        const tpl=a.getAttribute("data-origin")==="template";
        const badge=tpl?'<span class="tag tag-templates">'+t("cmp_link_tpl")+'</span>':'<span class="tag tag-plain">'+t("cmp_link_custom")+'</span>';
        return '<div class="elink-item"><div class="elink-info"><span class="elink-text">'+esc(a.textContent||"–")+'</span>'+badge+
          '<span class="elink-url mono">'+esc(a.getAttribute("href")||"")+'</span></div>'+
          '<div class="elink-acts"><button type="button" class="btn ghost sm" data-edit="'+i+'">'+t("cmp_link_edit")+'</button>'+
          '<button type="button" class="btn ghost sm danger" data-del="'+i+'">'+t("cmp_link_remove")+'</button></div></div>';
      }).join("");
    linksBox.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{
      const a=anchors[+b.getAttribute("data-edit")]; if(!a) return; openLinkBar(null, a);
    }));
    linksBox.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      const a=anchors[+b.getAttribute("data-del")]; if(!a||!a.parentNode) return;
      const p=a.parentNode; while(a.firstChild) p.insertBefore(a.firstChild,a); p.removeChild(a); refreshLinks();
    }));
    renderOppStatus();
  }
  el("tbLink").addEventListener("click",()=>{ closeBars(); openLinkBar(""); });
  el("tbUnlink").addEventListener("click",()=>{ cmd("unlink"); refreshLinks(); });
  el("elinkApply").addEventListener("click",applyLink);
  el("elinkCancel").addEventListener("click",()=>{ linkBar.hidden=true; editingAnchor=null; });
  linkUrl.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); applyLink(); } if(e.key==="Escape"){ linkBar.hidden=true; } });
  linkText.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); applyLink(); } });

  // ---- guided "Link to opportunity" flow ----
  const oppBar=el("eoppbar"), oppText=el("eopptext"), oppStatus=el("eoppstatus"), oppPreview=el("eoppPreview");
  function closeBars(){ if(linkBar) linkBar.hidden=true; if(oppBar) oppBar.hidden=true; editingAnchor=null; }
  // Is the opportunity linked anywhere in the body? As an <a>, or pasted as a raw URL line.
  function oppLinked(){
    if(!oppUrl) return false;
    const anchors=[].slice.call(body.querySelectorAll("a"));
    if(anchors.some(a=>{ const h=a.getAttribute("href")||""; return h===oppUrl || (slug && h.indexOf("/opp/"+slug)>=0); })) return true;
    const text=body.innerText||"";
    return text.indexOf(oppUrl)>=0 || (slug && text.indexOf("/opp/"+slug)>=0);
  }
  function renderOppStatus(){
    if(!oppStatus || !oppUrl) return;
    const ok=oppLinked();
    oppStatus.hidden=false; oppStatus.className="eoppstatus "+(ok?"ok":"todo");
    oppStatus.textContent=(ok?"✓ ":"○ ")+(ok?t("cmp_opp_added"):t("cmp_opp_missing"));
  }
  function buildOppPreview(){
    if(!oppPreview) return;
    if(!oppObj){ oppPreview.innerHTML='<div class="eopp-note">'+esc(t("cmp_opp_nopreview"))+'</div>'; return; }
    const title=esc(oppObj.business||slug||""), want=esc((oppObj.fields&&oppObj.fields.WANT)||"");
    oppPreview.innerHTML=
      '<iframe class="eopp-thumb" src="'+esc(oppUrl)+'" loading="lazy" referrerpolicy="no-referrer" tabindex="-1" title="preview"></iframe>'+
      '<div class="eopp-info"><div class="eopp-title">'+title+'</div>'+
      (want?'<div class="eopp-tag">'+want+'</div>':'')+
      '<a class="eopp-open mono" href="'+esc(oppUrl)+'" target="_blank" rel="noopener">'+esc(oppUrl)+'</a></div>';
  }
  function openOppBar(){
    closeBars(); buildOppPreview();
    oppText.value = (savedRange && !savedRange.collapsed) ? savedRange.toString().trim() : "";
    oppBar.hidden=false; setTimeout(()=>oppText.focus(),30);
  }
  function insertOppAnchor(text){
    const a=document.createElement("a"); a.href=oppUrl; a.setAttribute("data-origin","custom"); a.textContent=text;
    if(savedRange){ try{ savedRange.deleteContents(); savedRange.insertNode(a); }catch(e){ body.appendChild(a); } }
    else body.appendChild(a);
    savedRange=null;
  }
  const tbOpp=el("tbOpp");
  if(slug && tbOpp){ tbOpp.hidden=false;
    tbOpp.addEventListener("mousedown",e=>e.preventDefault());
    tbOpp.addEventListener("click",()=>{
      if(savedRange && !savedRange.collapsed){          // words already selected → link them right away
        const a=document.createElement("a"); a.href=oppUrl; a.setAttribute("data-origin","custom");
        try{ a.appendChild(savedRange.extractContents()); savedRange.insertNode(a); savedRange=null; refreshLinks(); }
        catch(e){ openOppBar(); }
      } else openOppBar();                              // otherwise guide the writer
    });
    el("eoppInsert").addEventListener("click",()=>{
      const txt=(oppText.value||"").trim(); if(!txt){ toast(t("cmp_opp_need_text")); return; }
      insertOppAnchor(txt); oppBar.hidden=true; refreshLinks();
    });
    el("eoppLine").addEventListener("click",()=>{
      const label=(oppText.value||"").trim() || (oppObj&&oppObj.business) || oppUrl;
      const p=document.createElement("div"); const a=document.createElement("a");
      a.href=oppUrl; a.setAttribute("data-origin","custom"); a.textContent=label; p.appendChild(a);
      body.appendChild(p); oppBar.hidden=true; refreshLinks();
    });
    el("eoppCancel").addEventListener("click",()=>{ oppBar.hidden=true; });
    oppText.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); el("eoppInsert").click(); } });
  }

  // Paste a URL over selected words → auto-link them.
  body.addEventListener("paste",e=>{
    const txt=((e.clipboardData||window.clipboardData)||{getData:()=>""}).getData("text")||"";
    const s=window.getSelection();
    if(/^https?:\/\/\S+$/i.test(txt.trim()) && s.rangeCount && !s.isCollapsed){
      e.preventDefault();
      const r=s.getRangeAt(0), a=document.createElement("a"); a.href=txt.trim(); a.setAttribute("data-origin","custom");
      try{ a.appendChild(r.extractContents()); r.insertNode(a); refreshLinks(); }catch(_){}
    }
  });
  body.addEventListener("input", debounce(()=>{ refreshLinks(); }, 250));

  el("efrom").value=getFromName()+" <"+FROM_EMAIL+">";
  let oppObj=null;
  if(slug){ const all=await mergedOpps(); oppObj=all.find(x=>x.slug===slug)||null; }
  /* Prefilled from the opportunity: recipient, name, subject from the manifest,
     the outreach text as the body, and the page link ALREADY SUBSTITUTED for
     [LINK]. WO-013 §4.2.

     It never overwrites something a person typed. Only an empty field is filled,
     so arriving here a second time to finish a half written message finds it
     exactly as it was left. */
  if(oppObj){
    const addr=bareAddress((oppObj.channel && /@/.test(String(oppObj.channel.to||"")) ? oppObj.channel.to : "")
             || oppObj.email || "");
    const toEl=el("eto");
    if(toEl && !toEl.value.trim() && addr) toEl.value=addr;   // the bare address, mailto lives in the send href
    const nm=el("ename");
    if(nm && !nm.value.trim()) nm.value=oppObj.owner||oppObj.business||"";
    const su=el("esubject");
    if(su && !su.value.trim() && oppObj.outreach_subject) su.value=oppObj.outreach_subject;
    const bd=el("ebody");
    if(bd && !(bd.textContent||"").trim() && oppObj.outreach_text){
      /* The placeholder is substituted here rather than left for the writer,
         because a message that reaches a prospect still saying [LINK] is the one
         failure the whole guard exists to prevent. */
      const filled=String(oppObj.outreach_text).split("[LINK]").join(liveUrl(oppObj.slug));
      bd.innerHTML=esc(filled).split("\n").join("<br>");
    }
  }
  const nameEl=el("ename"), tplSel=el("etpl"), firstEl=el("efirst"),
        monthEl=el("emonth"), monthWrap=el("emonthWrap");
  let tplCache=getEmailTemplates();                       // parse localStorage once, not on every keystroke
  const refreshTplCache=()=>{ tplCache=getEmailTemplates(); };
  let subjectDirty=false;                                 // writer edited the subject by hand, so stop recomputing it
  function recipientName(){
    const n=(nameEl?nameEl.value.trim():"");
    if(firstEl && firstEl.checked && n) return n.split(/\s+/)[0];
    return n;
  }
  function monthVal(){ return monthEl ? monthEl.value.trim() : ""; }
  // The month is written in the language of the template being used, not the UI language:
  // an Arabic template needs «أغسطس», an English one needs "August".
  function defaultMonth(forTpl){
    const ar = forTpl ? /[؀-ۿ]/.test((forTpl.subject||"")+(forTpl.html||"")) : (getLang()==="ar");
    try{ return new Date().toLocaleString(ar?"ar":"en",{month:"long"}); }
    catch(e){ return new Date().toLocaleString("en",{month:"long"}); }
  }
  if(monthEl && !monthEl.value) monthEl.value=defaultMonth(null);
  // Empty selection ("") is an intentional plain, template-less message: currentTpl() returns null.
  function currentTpl(){ if(tplSel && tplSel.value==="") return null; return tplCache.find(x=>x.id===(tplSel?tplSel.value:"monthly")) || tplCache[0]; }
  // Live merge sync: NAME/MONTH live in tagged spans, so typing the recipient's name or the month
  // updates them IN PLACE: it never re-renders (and can never wipe) the writer's edited message.
  function syncMerge(){
    const nm=recipientName()||"there", mo=monthVal();
    body.querySelectorAll('[data-m="name"]').forEach(s=>{ s.textContent=nm; });
    body.querySelectorAll('[data-m="month"]').forEach(s=>{ s.textContent=mo; });
    const tp=currentTpl();
    if(tp && !subjectDirty) el("esubject").value=mergeFieldsText(tp.subject, oppObj, nm, mo);
  }
  function applyTemplate(tp){
    if(monthWrap) monthWrap.hidden=!tplUsesMonth(tp);
    if(!tp) return;                                  // plain: leave whatever the user has typed
    // Put the month in the template's own language (an Arabic template wants «أغسطس»), but
    // never discard a month the writer typed: only fill it when empty or when the script
    // doesn't match the template (e.g. an English month left over on an Arabic template).
    if(monthEl && tplUsesMonth(tp)){
      const cur=monthEl.value.trim();
      const tplAr=/[؀-ۿ]/.test((tp.subject||"")+(tp.html||""));
      const curAr=/[؀-ۿ]/.test(cur);
      if(!cur || curAr!==tplAr) monthEl.value=defaultMonth(tp);
    }
    subjectDirty=false;
    el("esubject").value = mergeFieldsText(tp.subject, oppObj, recipientName()||"there", monthVal());
    body.innerHTML = mergeFieldsHtml(tp.html, oppObj, recipientName(), monthVal());
    // Mark the template's own links so the manager can tell them apart from links you add.
    body.querySelectorAll("a").forEach(a=>{ if(!a.getAttribute("data-origin")) a.setAttribute("data-origin","template"); });
    refreshLinks();
  }
  function clearCompose(){ subjectDirty=false; el("esubject").value=""; body.innerHTML=""; if(monthWrap) monthWrap.hidden=true; refreshLinks(); }
  if(tplSel){
    const plainOpt=document.createElement("option"); plainOpt.value=""; plainOpt.textContent=t("cmp_no_tpl"); plainOpt.setAttribute("data-i18n","cmp_no_tpl"); tplSel.appendChild(plainOpt);
    /* The drop-down obeys the same rule as the chips. Two controls offering different sets is
       how a person learns to distrust both. */
    const preT=params.get("etpl");
    /* An explicit ask outranks an inference. "Compose with" names one template, and if the
       drop-down is filtered to the other library the ask is silently dropped: the composer
       opens blank with no word about why. So when a template is named, the locale of THAT
       template is the locale of the list. Inference is only for when nobody said. */
    const askedTpl = preT ? tplCache.find(tp=>tp.id===preT) : null;
    const localeOfTpl = tp=>(localeOf(tp) || (isArabicText((tp.subject||"")+(tp.html||"")) ? "AR" : "EN"));
    const selWant = askedTpl ? localeOfTpl(askedTpl)
                  : oppObj ? docLang(oppObj)
                  : (getLang()==="ar" ? "AR" : "EN");
    tplCache.filter(tp=>localeOfTpl(tp)===selWant)
      .forEach(tp=>{ const o=document.createElement("option"); o.value=tp.id; o.textContent=tp.name; tplSel.appendChild(o); });
    // ALWAYS start blank: an empty editor with no template. A template is only pre-selected when
    // the writer explicitly asked for one via ?etpl=<id> (e.g. "Compose with" from Templates).
    tplSel.value="";
    if(preT && [...tplSel.options].some(o=>o.value===preT)) tplSel.value=preT;
    tplSel.addEventListener("change",()=>{
      if(tplSel.value===""){ clearCompose(); }        // plain: back to an empty editor
      else applyTemplate(currentTpl());
      quick();
    });
  }
  /* The editor still opens blank, and still only a person decides what it says. What changed is
     that the choice is one tap instead of a drop-down you have to know is there: after you
     publish a page, the message that sends it should not start from nothing. Offered while the
     message is empty, gone the moment there is something to lose. */
  const quickBox=el("etplQuick");
  function quick(){
    if(!quickBox) return;
    const empty = !(body.textContent||"").trim() && !(el("esubject").value||"").trim();
    if(!empty || !tplCache.length){ quickBox.hidden=true; quickBox.innerHTML=""; return; }
    /* One locale, never a mixed row. Which locale is a property of the OPPORTUNITY when there
       is one, and of the chrome only when there is not. This is the leak WO-012 §7 opens with:
       the English composer offering «التحديث الشهري» beside Monthly update was one variable
       doing two jobs, not a translation problem. */
    const want = oppObj ? docLang(oppObj) : (getLang()==="ar" ? "AR" : "EN");
    const inLocale = tp => (localeOf(tp) || (isArabicText((tp.subject||"")+(tp.html||"")) ? "AR" : "EN")) === want;
    const pool = tplCache.filter(inLocale);
    const score=tp=>{
      let n=0;
      if(/\{\{LINK\}\}/.test(tp.html||"") && slug) n-=2;  // the ones that carry this page first
      return n;
    };
    const list=pool.slice().sort((a,b)=>score(a)-score(b)).slice(0,4);
    /* An empty shelf that says nothing is better than a shelf of the wrong language. */
    if(!list.length){ quickBox.hidden=true; quickBox.innerHTML=""; return; }
    quickBox.hidden=false;
    quickBox.innerHTML='<span class="etpl-quick-h">'+esc(t("cmp_quick_h"))+'</span>'+
      list.map(tp=>'<button type="button" class="lp" data-quick="'+esc(tp.id)+'">'+esc(tp.name||tp.id)+'</button>').join("");
    quickBox.querySelectorAll("[data-quick]").forEach(b=>b.addEventListener("click",()=>{
      tplSel.value=b.getAttribute("data-quick");
      applyTemplate(currentTpl());
      quick();
    }));
  }
  el("esubject").addEventListener("input",()=>{ subjectDirty=true; });
  if(nameEl) nameEl.addEventListener("input",syncMerge);
  if(firstEl) firstEl.addEventListener("change",syncMerge);
  if(monthEl) monthEl.addEventListener("input",syncMerge);
  // Resolved when counted, not when wired: these two live further down the file, and reading
  // them here by name threw before they existed.
  initMore("cmpMoreBtn","cmpMore", ()=>{
    const f=document.getElementById("efirst"), br=document.getElementById("ebrand");
    return ((f&&f.checked)?1:0)+((br&&br.checked)?1:0);
  });
  applyTemplate(currentTpl());
  refreshLinks();
  quick();
  onThrive("lang","compose-quick",quick);
  // Outgoing HTML: unwrap the merge spans so the sent email is clean markup.
  function htmlOut(){
    const c=body.cloneNode(true);
    c.querySelectorAll("[data-m]").forEach(s=>s.replaceWith(document.createTextNode(s.textContent)));
    return c.innerHTML;
  }
  const saveT=el("eSaveTpl");
  if(saveT) saveT.addEventListener("click",()=>{
    const name=prompt(t("cmp_tpl_name")); if(!name) return;
    const id=slugify(name)||("tpl"+getEmailTemplates().length);
    // Convert live merge spans back into {{NAME}}/{{MONTH}} placeholders so the template stays reusable.
    const c=body.cloneNode(true);
    c.querySelectorAll('[data-m="name"]').forEach(s=>s.replaceWith(document.createTextNode("{{NAME}}")));
    c.querySelectorAll('[data-m="month"]').forEach(s=>s.replaceWith(document.createTextNode("{{MONTH}}")));
    c.querySelectorAll("[data-origin]").forEach(a=>a.removeAttribute("data-origin"));
    saveEmailTemplate({ id, name, subject:el("esubject").value, html:c.innerHTML }); refreshTplCache();
    if(tplSel && ![...tplSel.options].some(o=>o.value===id)){ const op=document.createElement("option"); op.value=id; op.textContent=name; tplSel.appendChild(op); }
    if(tplSel) tplSel.value=id;
    logActivity("etpl_add", id, name); toast(t("cmp_tpl_saved"));
  });
  // Upload a ready-built month template (an .html file authored elsewhere) and use it to send.
  const tplFile=el("eTplFile");
  if(tplFile) tplFile.addEventListener("change",e=>{
    const f=e.target.files && e.target.files[0]; if(!f) return; tplFile.value="";
    if(!/\.html?$/i.test(f.name)){ toast(t("need_html")); return; }
    const fr=new FileReader();
    fr.onload=()=>{
      const base=f.name.replace(/\.html?$/i,"");
      let id=slugify(base)||"uploaded"; let n=2;
      while(tplCache.some(x=>x.id===id)) id=(slugify(base)||"uploaded")+"-"+(n++);
      const rec={ id, name:base, subject:el("esubject").value || base, html:String(fr.result||"") };
      saveEmailTemplate(rec); refreshTplCache();
      if(tplSel){ const op=document.createElement("option"); op.value=id; op.textContent=base; tplSel.appendChild(op); tplSel.value=id; }
      applyTemplate(currentTpl());
      logActivity("etpl_add", id, base+" (upload)"); toast(t("cmp_tpl_uploaded"));
    };
    fr.onerror=()=>toast(t("read_err"));
    fr.readAsText(f);
  });

  function plainText(){ return body.innerText; }
  const brandEl=el("ebrand");
  function isBranded(){ return !!(brandEl && brandEl.checked); }
  // What template (if any) this message carries. Empty id => plain, template-less message.
  function tplMeta(){
    const id=tplSel?tplSel.value:"";
    if(!id) return { templateId:"", templateName:"" };
    const tp=tplCache.find(x=>x.id===id);
    return { templateId:id, templateName:(tp?tp.name:id) };
  }
  function recName(){ return nameEl?nameEl.value.trim():""; }
  function preview(){ return plainText().replace(/\s+/g," ").trim().slice(0,600); }
  /* Which opportunity this message is about, decided by what the message actually says rather
     than by which page you happened to open the composer from. The composer keeps its slug for
     a whole session, so fifteen monthly newsletters written in one sitting were all filed
     against one prospect's page and that page reported fifteen sends it never received.
     A message belongs to an opportunity when it carries that opportunity's link. */
  function oppOf(){
    const html=body.innerHTML||"";
    if(slug && html.indexOf("/opp/"+slug) >= 0) return slug;
    const m=html.match(/\/opp\/([a-z0-9-]+)/i);
    if(m && m[1]) return m[1];
    return "";
  }
  // Copying for Gmail is a send to a party, so it waits on the same proof as any other send, and it
  // runs through the shared runner: an in-progress state, a double-tap guard, and a visible outcome.
  el("eCopy").addEventListener("click", ()=> runAction("eCopy", { doneMsg:t("cmp_copied"), run: async ()=>{
    await checkLive(); renderPreSend();
    if(slug && !liveState.ok) throw new Error(liveState.reason);   // the gate, re-checked at the moment of the send
    const html=brandWrap(htmlOut(), isBranded()), text=plainText();
    try{
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html],{type:"text/html"}),
          "text/plain": new Blob([text],{type:"text/plain"}) })]);
      } else { await navigator.clipboard.writeText(text); }
    }catch(e){ throw new Error(t("cmp_copy_err")); }
    const to=el("eto").value.trim(), subject=el("esubject").value.trim(), m=tplMeta();
    logActivity("email_copy", oppOf(), (to?to+" · ":"")+subject);
    logMail({ opp:oppOf(), to:to, toName:recName(), subject:subject, templateId:m.templateId, templateName:m.templateName, branded:isBranded(), preview:preview(), provider:"gmail-copy", status:"copied", chapter:sendChapter(oppOf()) });
    clearComposeDraft();                                  // copied to Gmail to send, so the working draft is done
    return t("cmp_copied");
  }}));
  el("eMail").addEventListener("click", ()=> runAction("eMail", { doneMsg:t("cmp_mail_open"), run: async ()=>{
    await checkLive(); renderPreSend();
    if(slug && !liveState.ok) throw new Error(liveState.reason);   // the same gate before the mail app opens
    const to=bareAddress(el("eto").value), subject=el("esubject").value.trim();
    // The mailto scheme is added only here, in the action's target, never in the field value.
    location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(plainText());
    return t("cmp_mail_open");
  }}));
  // live Resend free-tier meter under the Send button
  const meter=el("quotaMeter");
  function renderQuota(){
    if(!meter) return;
    const u=quotaUsage();
    const near = u.dayLeft<=Math.max(3, Math.ceil(u.dailyCap*0.1));
    const cls = u.dayFull||u.monthFull ? "full" : (near ? "near" : "ok");
    meter.className="quota-meter "+cls;
    let txt=t("cmp_quota_today")+" "+u.day+" / "+u.dailyCap+" · "+t("cmp_quota_month")+" "+u.month+" / "+u.monthlyCap;
    if(u.dayFull && u.freeInMs>0) txt+=" · "+t("cmp_quota_resets")+" "+fmtDur(u.freeInMs);
    meter.textContent=txt;
    meter.title=t("cmp_quota_hint");
  }
  renderQuota();
  onThrive("sync","compose",renderQuota);
  /* ---- what the editor gained, and why each one earns its place ----------
     Every item here removes a failure the team has actually hit. Nothing here
     schedules, sequences, tests variants, or adds a tracking pixel: those change
     what Thrive is, and WO-013 §5.3 says not to. */

  /* The closing block: previewed, editable for THIS message only, and saved per
     locale by the DOCUMENT language rather than the chrome. */
  const sigBox=el("sigBox"), sigLoc=el("sigLoc");
  const docLoc=()=> (oppObj ? docLang(oppObj) : (getLang()==="ar"?"AR":"EN"));
  function loadSignature(){
    if(!sigBox) return;
    sigBox.value=signatureFor(docLoc());
    if(sigLoc) sigLoc.textContent=t("sig_using")+" "+t("loc_"+docLoc().toLowerCase());
  }
  loadSignature();
  const sigSave=el("sigSave");
  if(sigSave) sigSave.addEventListener("click", ()=>{
    setSignature(docLoc(), sigBox.value);
    toast(t("sig_saved")); refreshPreview();
  });
  const sigReset=el("sigReset");
  if(sigReset) sigReset.addEventListener("click", ()=>{ loadSignature(); refreshPreview(); });
  if(sigBox) sigBox.addEventListener("input", debounce(()=>refreshPreview(), 300));

  /* Personalisation tokens, resolved live. Nobody sends "Hi {name}". */
  const TOKENS={ NAME:()=>recipientName()||"", BIZ:()=>(oppObj&&oppObj.business)||"",
                 LINK:()=>oppUrl||"", MONTH:()=>(monthEl?monthEl.value:"")||"" };
  function resolveTokens(str){
    let out=String(str||"");
    Object.keys(TOKENS).forEach(k=>{ out=out.split("{{"+k+"}}").join(TOKENS[k]()); });
    return out;
  }
  /* A token left in the text AFTER RESOLUTION is one whose value is empty or
     whose name is not a token at all. Either way it must not leave.

     Reading the raw body instead would report every token the writer used, so
     every message carrying {{NAME}} would be blocked, which is most of them. */
  function unresolvedTokens(str){
    const out=[], re=/\{\{([A-Z][A-Z0-9_]*)\}\}/g; let m;
    const s2=String(str||"");
    while((m=re.exec(s2))) if(out.indexOf(m[1])<0) out.push(m[1]);
    /* The literal [LINK] from the manifest is the same failure wearing different
       brackets, so it is reported beside them. */
    if(s2.indexOf("[LINK]")>=0 && out.indexOf("LINK")<0) out.push("LINK");
    return out;
  }

  function composedHtml(){
    return brandWrap(resolveTokens(htmlOut()), isBranded(), sigBox?sigBox.value:"");
  }
  function composedText(){
    const box=el("plainBox");
    if(box && box.dataset.dirty==="1") return box.value;
    return toPlainText(resolveTokens(htmlOut()), sigBox?sigBox.value:"");
  }

  const plainBox=el("plainBox");
  if(plainBox) plainBox.addEventListener("input", ()=>{ plainBox.dataset.dirty="1"; });
  const plainRegen=el("plainRegen");
  if(plainRegen) plainRegen.addEventListener("click", ()=>{
    if(!plainBox) return;
    plainBox.dataset.dirty=""; plainBox.value=composedText(); toast(t("pt_regenerated"));
  });

  /* The subject meter. Past 60 most clients truncate. */
  function refreshSubjMeter(){
    const m=el("subjMeter"), su=el("esubject");
    if(!m||!su) return;
    const n=su.value.length;
    m.textContent=boardText(getLang(),"subj_count", n)+(n>60? " · "+t("subj_long") : "");
    m.classList.toggle("is-long", n>60);
  }

  const prevFrame=el("cmpPreview");
  function refreshPreview(){
    refreshSubjMeter();
    if(plainBox && plainBox.dataset.dirty!=="1") plainBox.value=composedText();
    renderPreSend();
    if(!prevFrame) return;
    const card = oppObj ? linkCard(oppObj, {copy:false}) : "";
    prevFrame.srcdoc='<!DOCTYPE html><html dir="'+(docLoc()==="AR"?"rtl":"ltr")+'"><body '+
      'style="margin:0;padding:16px;background:#fff">'+composedHtml()+card+'</body></html>';
  }

  /* Send safety: the page is proven live before any message leaves for a party. liveState is the
     last known answer, refreshed on open and re-checked at the moment of each send. `null` means
     not yet checked; the send re-checks regardless, so a stale yes can never let a message out. */
  let liveState={ ok:null, reason:"" };
  async function checkLive(){
    if(!slug){ liveState={ ok:true, reason:"" }; return liveState; }   // a message tied to no page
    liveState=await pageSendable(oppObj || slug);
    return liveState;
  }
  // The at-send gate: re-confirm now, show the line, and block with the reason if it is not live.
  async function ensureLive(){
    await checkLive();
    renderPreSend();
    if(!liveState.ok) toast(liveState.reason);
    return liveState.ok;
  }

  /* The lines shown before it leaves. The live-page line is first, because it is the one whose
     failure is a message delivered to a dead link. */
  function preSendChecks(){
    const bodyHtml=htmlOut();
    const left=unresolvedTokens(resolveTokens(bodyHtml+" "+(el("esubject").value||"")));
    const live = slug
      ? (liveState.ok===null
          ? { k:"ps_live_wait", ok:false, pending:true }
          : { k: liveState.ok? "ps_live_ok" : "ps_live_no", ok: liveState.ok,
              detail: liveState.ok? "" : liveState.reason })
      : null;
    return [
      live,
      { k:"ps_link", ok: !oppUrl || composedHtml().indexOf(oppUrl)>=0 },
      { k:"ps_tokens", ok: left.length===0, detail:left.join(", ") },
      { k:"ps_sig", ok: !!(sigBox && sigBox.value.trim()) }
    ].filter(Boolean);
  }
  function renderPreSend(){
    const host=el("preSend");
    if(host){
      const rows=preSendChecks();
      host.hidden=false;
      host.innerHTML='<ul class="ps-list">'+rows.map(r=>
        '<li class="'+(r.pending?"wait":(r.ok?"ok":"no"))+'">'+ic(r.pending?"clock":(r.ok?"check":"alert"))+esc(t(r.k))+
        (r.detail? ' <span class="mono-iso">'+esc(r.detail)+'</span>':'')+'</li>').join("")+'</ul>';
    }
    syncSendState();   // the Send buttons follow the same gate, so the look matches the truth at a glance
  }
  /* The honest Send state. A send to a party is only allowed once the page is proven live, so while
     that is unknown or false the send buttons are visibly disabled, not lit, and one short line names
     the reason and the single action that unblocks it. This shows the gate; it does not change it. The
     buttons remain gated by the at-send re-check as well, so nothing here can let a message out. */
  const SEND_BTNS=["eSend","eCopy","eMail"];
  function ensureSendGate(){
    let g=el("sendGate");
    if(!g){
      const bar=el("eSend") && el("eSend").parentNode;
      if(!bar || !bar.parentNode) return null;
      g=document.createElement("div"); g.id="sendGate"; g.className="send-gate";
      g.setAttribute("role","status"); g.hidden=true;
      bar.parentNode.insertBefore(g, bar);
    }
    return g;
  }
  function syncSendState(){
    const gated = !!slug;                                   // a message tied to no page is never gated
    const ok = !gated || liveState.ok===true;
    const checking = gated && liveState.ok===null;
    SEND_BTNS.forEach(id=>{ const b=el(id); if(!b) return;
      if(b.dataset.running==="1") return;                   // a run in flight owns the button
      b.disabled = !ok;
      b.classList.toggle("is-blocked", !ok);
    });
    const g=ensureSendGate(); if(!g) return;
    if(ok){ g.hidden=true; g.innerHTML=""; return; }
    const notLive = !oppObj || !isLive(oppObj);
    const msg = checking ? t("cmp_send_gate_check") : (notLive ? t("cmp_send_gate_draft") : liveState.reason);
    let action="";
    if(!checking){
      action = notLive
        ? '<a class="btn sm" href="'+esc(viewHref("editor","slug="+encodeURIComponent(slug)))+'">'+esc(t("lc_publish"))+'</a>'
        : '<button type="button" class="btn sm" id="sendRecheck">'+esc(t("cmp_recheck"))+'</button>';
    }
    g.hidden=false;
    g.innerHTML='<span class="send-gate-ic">'+ic(checking?"clock":"alert")+'</span>'+
      '<span class="send-gate-msg">'+esc(msg)+'</span>'+action;
    const rc=el("sendRecheck");
    if(rc) rc.addEventListener("click", ()=> runAction("sendRecheck", { run: async ()=>{ await checkLive(); renderPreSend(); return liveState.ok? t("ps_live_ok") : liveState.reason; } }));
  }

  /* ---- draft integrity: continuous save to the durable, synced record ------
     The message, its subject, recipient, and campaign settings are written to the opportunity
     record as they change, additively under compose_draft, through saveDraft (which schedules the
     relay sync, because thrive_opps_v1 is a synced key) then logActivity. An accidental close then
     loses nothing, and another device continues from the last point. Only real input is saved: an
     untouched composer writes nothing, and no empty field is ever invented into a value. */
  function composeState(){
    return {
      to: bareAddress(el("eto").value), name: (nameEl? nameEl.value : "").trim(),
      subject: el("esubject").value, body_html: htmlOut(),
      template: tplSel? tplSel.value : "", branded: isBranded(),
      first: !!(firstEl && firstEl.checked), month: monthVal(),
      plain: (plainBox && plainBox.dataset.dirty==="1") ? plainBox.value : ""
    };
  }
  function composeHasContent(s){
    return !!(String(s.body_html||"").replace(/<[^>]*>/g,"").trim() || (s.subject||"").trim()
              || s.to || s.name || (s.plain||"").trim());
  }
  const savedTag=el("draftSaved");
  let composeDirty=false, composeLogged=false, restoring=false;
  const persistCompose=debounce(()=>{
    if(!slug || !composeDirty || restoring) return;   // no record to hold it, or nothing real typed
    const s=composeState();
    if(!composeHasContent(s)) return;                 // an untouched composer writes nothing
    saveDraft({ slug, compose_draft: Object.assign({}, s, { up:Date.now() }) });
    if(!composeLogged){ logActivity("draft_save", slug, ""); composeLogged=true; }  // one audit line per editing session
    if(savedTag){ savedTag.textContent=t("draft_saved"); savedTag.hidden=false; }
  }, 600);
  function touchCompose(){ if(restoring) return; composeDirty=true; persistCompose(); }
  // Once the message has gone out, the working draft is done: it is cleared from the record so a
  // reopen starts fresh rather than restoring a message already sent. Additive, keyed by slug.
  function clearComposeDraft(){ if(slug) saveDraft({ slug, compose_draft:null }); composeDirty=false; composeLogged=false; if(savedTag) savedTag.hidden=true; }
  [["ebody","input"],["esubject","input"],["eto","input"],["ename","input"],
   ["emonth","input"],["etpl","change"],["ebrand","change"],["efirst","change"],
   ["plainBox","input"]].forEach(([id,ev])=>{ const e=el(id); if(e) e.addEventListener(ev, touchCompose); });

  /* Continue from the last saved point. If the record carries a compose_draft, the composer is
     restored to it exactly, over the fresh seed, so a reopen resumes rather than restarts. The
     restore is not an edit, so it neither marks the draft dirty nor writes anything back. */
  function restoreCompose(){
    const d=oppObj && oppObj.compose_draft; if(!d) return false;
    restoring=true;
    if(d.template && tplSel && [...tplSel.options].some(o=>o.value===d.template)) tplSel.value=d.template;
    if("subject" in d){ el("esubject").value=d.subject||""; subjectDirty=true; }
    if(nameEl && "name" in d) nameEl.value=d.name||"";
    if(el("eto") && "to" in d) el("eto").value=d.to||"";
    if(brandEl && "branded" in d) brandEl.checked=!!d.branded;
    if(firstEl && "first" in d) firstEl.checked=!!d.first;
    if(monthEl && "month" in d && d.month) monthEl.value=d.month;
    if("body_html" in d){ body.innerHTML=d.body_html||"";
      body.querySelectorAll("a").forEach(a=>{ if(!a.getAttribute("data-origin")) a.setAttribute("data-origin","custom"); }); }
    if(plainBox && d.plain){ plainBox.value=d.plain; plainBox.dataset.dirty="1"; }
    refreshLinks();
    restoring=false;
    return true;
  }

  ["esubject","eto","ename"].forEach(id=>{
    const e=el(id); if(e) e.addEventListener("input", debounce(refreshPreview, 300));
  });
  body.addEventListener("input", debounce(refreshPreview, 400));
  const prevWrap=el("prevWrap");
  if(prevWrap) prevWrap.addEventListener("toggle", ()=>{ if(prevWrap.open) refreshPreview(); });
  if(restoreCompose()) toast(t("draft_restored"));
  refreshPreview();
  // Confirm the live page when the composer opens, so a draft or a dead link is visible before a
  // click. The send actions re-check regardless: the gate is the send-time confirmation.
  checkLive().then(renderPreSend);

  /* Send to myself. The only honest way to see what a client sees. */
  const selfBtn=el("eSelf");
  if(selfBtn) selfBtn.addEventListener("click", async ()=>{
    const ep=getEmailEndpoint();
    if(!ep){ toast(t("cmp_no_ep")); return; }
    selfBtn.disabled=true;
    try{
      const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify({ from:FROM_EMAIL, fromName:getFromName(), to:FROM_EMAIL,
          subject:"["+t("cmp_self_tag")+"] "+resolveTokens(el("esubject").value.trim()),
          html:composedHtml(), text:composedText() }) }, 30000);
      const txt=await r.text();
      let j=null; try{ j=JSON.parse(txt); }catch(_){}
      if(j && j.ok===false) throw new Error(j.error||"send failed");
      /* It is a proof copy, not outreach, so it does not spend the quota and it
         does not enter the ledger. Counting it would inflate every number the
         board reports. */
      toast(t("cmp_self_sent"));
    }catch(e){ toast(t("cmp_send_err")+": "+e.message); }
    finally{ selfBtn.disabled=false; }
  });

  el("eSend").addEventListener("click", async ()=>{
    // Nothing leaves for a party until the page is proven live, at this moment, not on appearance.
    if(!(await ensureLive())) return;
    const to=bareAddress(el("eto").value);
    if(!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ toast(t("cmp_need_to")); return; }
    const ep=getEmailEndpoint();
    if(!ep){ toast(t("cmp_no_ep")); setTimeout(()=>goTo("settings"),1100); return; }
    /* §3: a known version mismatch makes the send impossible to attempt. This is
       the exact send that failed with `missing "to"`, and refusing it here is the
       difference between a named problem and a mysterious one. */
    if(!relayReady()){ toast(relayBannerText()); setTimeout(()=>goTo("settings"),1200); return; }
    // Resend free-tier guard: block before we would exceed the daily/monthly cap.
    const q=quotaUsage();
    if(q.dayFull){ toast(t("cmp_quota_day_hit")+(q.freeInMs>0?" "+t("cmp_quota_resets")+" "+fmtDur(q.freeInMs):"")); return; }
    if(q.monthFull){ toast(t("cmp_quota_month_hit")); return; }
    /* A suppressed address is never written to again, and the console says why.
       This is the single highest value guard in the deliverability section: at
       three sends a day the risk is not volume, it is one complaint against a
       domain that also carries client mail and invoices. */
    if(ThriveStore.isSuppressed(to)){
      toast(t("sup_blocked")+" "+t("sup_r_"+(ThriveStore.reasonFor(to)||"unknown")));
      return;
    }
    /* An unresolved token blocks the send. "Hi {name}" reaching a prospect is
       the failure this whole section exists to prevent, and detecting it after
       the fact is detecting it too late. */
    const left=unresolvedTokens(resolveTokens(htmlOut()+" "+el("esubject").value));
    if(left.length){ toast(t("ps_tokens_block")+" "+left.join(", ")); renderPreSend(); return; }
    const loc=docLoc();
    const payload={ v:REQUIRED_RELAY, from:FROM_EMAIL, fromName:getFromName(), to:to,
      subject:resolveTokens(el("esubject").value.trim()),
      /* The physical address and the one line opt out are required by US law for
         commercial email, and both are already true of Thrive. List-Unsubscribe
         is not required at this volume and costs nothing, and it converts a spam
         complaint into an unsubscribe. */
      html:composedHtml()+ThriveStore.footerHtml(loc==="AR"?"ar":"en"),
      text:composedText()+ThriveStore.footerText(loc==="AR"?"ar":"en"),
      headers:ThriveStore.outboundHeaders(slug||""),
      slug:slug||"" };
    el("eSend").disabled=true; const old=el("eSend").textContent; el("eSend").textContent=t("cmp_sending");
    try{
      const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"}, body:JSON.stringify(payload) });
      const txt=await r.text();
      if(!r.ok) throw new Error(r.status+" "+txt.slice(0,140));
      let id="", parsed=null; try{ parsed=JSON.parse(txt); }catch(_){}
      noteRelayVersion(parsed);
      /* If the send only now revealed the relay is behind, say so with the banner
         rather than a generic send error, and refresh so the gate takes hold. */
      if(parsed && !relayReady()){ throw new Error(relayBannerText()); }
      if(parsed && parsed.ok===false) throw new Error(parsed.error||"send failed");
      if(parsed) id=parsed.id||"";
      const m=tplMeta();
      recordSend(); renderQuota();
      logActivity("email", slug||"", to+" · "+payload.subject);
      logMail({ opp:oppOf(), to:to, toName:recName(), subject:payload.subject, templateId:m.templateId, templateName:m.templateName, branded:isBranded(), preview:preview(), provider:"endpoint", status:"sent", id:id, chapter:sendChapter(oppOf()) });
      clearComposeDraft();                                  // the message went out, so the working draft is done
      toast(t("cmp_sent"));
    }catch(e){ toast(t("cmp_send_err")+": "+e.message); }
    finally{ el("eSend").disabled=false; el("eSend").textContent=old; }
  });
}

/* ---------- settings (GitHub publishing + analytics endpoint) ---------- */
/* ---------- connection health ----------
   The console depends on one chain: a relay URL, that URL serving v4, the passcode credential,
   a sync round trip, analytics, and the URL being published in the repo so every other device
   finds it. When any link broke, the failure surfaced somewhere else entirely (a phone showing
   zeros, a banner that would not clear), and the missing link was never the one being fixed.
   This checks every link in order, names the one that is broken, and repairs what it can. */
/* Nothing here waits forever. A hung request used to leave the whole panel on "Testing..."
   with no result at all, which is the same sin as a blank page. */
async function fetchT(url, opts, ms){
  const ac=new AbortController(); const to=setTimeout(()=>ac.abort(), ms||15000);
  try{ return await fetch(url, Object.assign({signal:ac.signal}, opts||{})); }
  catch(e){
    // A relay that is merely slow (Apps Script cold start on a phone network) must never be
    // reported as a wrong key. Mark the timeout so the diagnosis can tell them apart.
    if(e && (e.name==="AbortError" || /abort/i.test(e.message||""))){ const err=new Error(t("conn_timeout")); err.timeout=true; throw err; }
    throw e;
  }
  finally{ clearTimeout(to); }
}

/* ---------- WO-014 §3: the version contract ----------
   The night this was written, the relay editor held v5 and the deployment served
   v4, and every send failed with `missing "to"`. The console asked v5 questions
   and the deployment gave v4 answers, and nobody could see the mismatch without
   reading two screens at once. This closes the gap: the relay stamps its version
   onto every response (relay/thrive-relay.gs, RELAY_VERSION), the console carries
   the version it was built for, and on a disagreement it does not degrade quietly.
   It shows one banner, everywhere a send or a sync would appear, with the exact
   five taps that fix it, and it makes every relay-dependent action impossible to
   attempt. A send that would fail with `missing "to"` is refused before it leaves. */
const REQUIRED_RELAY = 5;
let __relaySeen = null;                 // the version the last relay response declared, or null
let __relayChecked = false;             // whether we have parsed any relay response this session
/* A relay response that omits relay_version is, by definition, older than the
   contract: a v4 deployment predates the field entirely. So an absent version
   reads as a mismatch, not as "unknown, assume fine". That absence was the whole
   failure. */
function noteRelayVersion(j){
  const v = (j && typeof j === "object" && j.relay_version != null) ? Number(j.relay_version) : null;
  __relaySeen = v; __relayChecked = true;
  return j;
}
/* null when no relay response has been seen yet (nothing to disagree with), or
   when the versions match. An object {seen, need} the moment a parsed response
   disagrees, which is what the banner and every gate read. */
function relayMismatch(){
  if(!__relayChecked) return null;
  if(__relaySeen === REQUIRED_RELAY) return null;
  return { seen: __relaySeen, need: REQUIRED_RELAY };
}
function relayReady(){ return relayMismatch() === null; }
/* Stamp the request with the version it was written for, so a relay older than
   the request can refuse it by name (`request v6, relay v5`) instead of misreading
   the shape the way a v4 handler misread a v5 send. */
function relayBody(o){ return JSON.stringify(Object.assign({ v: REQUIRED_RELAY }, o || {})); }
/* The one banner, verbatim per §3.1, with the remedy inside it because the
   knowledge that was missing that night was exactly those five taps. The version
   numbers are not counts, so they do not take a plural form; they are stamped as
   Western numerals. */
function relayBannerText(){
  const m = relayMismatch(); if(!m) return "";
  const seen = m.seen == null ? t("relay_ver_unknown") : String(m.seen);
  return t("relay_ver_banner").replace("{relay}", seen).replace("{need}", String(m.need));
}

/* What a relay URL actually answered. An Apps Script deployment whose access is not "Anyone"
   returns a Google sign-in page to every unauthenticated caller, which is HTML, not JSON. That
   is a completely different fault from a stale deployment and it needs its own name: prospects
   have no Google account, so a restricted deployment can never collect a single page open. */
function classifyRelayBody(body){
  const s=String(body||"").trim();
  if(!s) return { kind:"net" };
  /* One explicit contract: any relay response carrying relay_version is authoritative, so the
     Connection health line reads the same single field the sync and send paths read (noteRelayVersion),
     from the same relay constant (RELAY_VERSION), on every endpoint. This is the drift this round ends:
     the version is no longer scraped from prose in one place and read as a field in another. */
  if(s.charAt(0)==="{" || s.charAt(0)==="["){
    try{ const j=JSON.parse(s);
      if(j && j.relay_version!=null){ const jv=Number(j.relay_version);
        return { kind: jv===REQUIRED_RELAY? "current":"old", ver:jv, version:"Thrive relay v"+jv }; }
    }catch(e){}
  }
  /* Fallback for a relay built before the contract, whose bare GET is the prose line. "current" is
     read from REQUIRED_RELAY, never a literal: the day the relay became v5 a hardcoded "v4" here would
     have turned a correct deployment into a reported fault, which is the exact class of drift this ends. */
  if(/Thrive relay/i.test(s)){
    const m=/v(\d+)/i.exec(s); const ver=m? Number(m[1]) : null;
    return { kind: ver===REQUIRED_RELAY? "current":"old", ver:ver, version:s.slice(0,90) };
  }
  // Only a Google page counts as "not open to Anyone". Any other HTML is simply the wrong URL.
  if(/accounts\.google\.com|ServiceLogin|Web word processing|Google Drive|Google Accounts|google\.com\/accounts/i.test(s))
    return { kind:"signin" };
  return { kind:"other", version:(/^<!doctype|^<html/i.test(s)? t("sy_v_html") : s.slice(0,90)) };
}
async function connCheck(candidate, onStep){
  const steps=[];
  const add=(k,ok,detail,fix,link)=>{
    const s={k, ok, detail:detail||"", fix:fix||"", link:link||""};
    steps.push(s); if(typeof onStep==="function"){ try{ onStep(steps); }catch(e){} }
    return ok;
  };
  try{ await syncBootstrap(); }catch(e){}
  const ep=(candidate||"").trim()||getSyncEndpoint();
  const tail=u=>String(u||"").replace(/\/exec.*$/,"").slice(-12);

  if(!add("conn_url", !!ep, tail(ep), "", ep)) return steps;

  let body="";
  try{ const r=await fetchT(ep,{cache:"no-store"},9000); body=await r.text(); }catch(e){ body=""; }
  const v=classifyRelayBody(body);
  if(!add("conn_v4", v.kind==="current",
          v.kind==="signin"? t("sy_v_signin") : (v.version||t("sy_err_net")),
          v.kind==="signin"? t("conn_v4_fix_access") : "")) return steps;

  const auth=syncAuth();
  if(!add("conn_key", !!auth)) return steps;

  // Apps Script cold-starts, and a phone on a weak network makes that worse, so one slow round
  // is not a verdict. Try twice before calling a link broken.
  const post=async (body, tries)=>{
    let last=null;
    for(let i=0;i<(tries||2);i++){
      try{
        const r=await fetchT(ep,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify(body)},25000);
        const txt=await r.text();
        try{ return JSON.parse(txt); }
        catch(e){ return { ok:false, error: classifyRelayBody(txt).kind==="signin"? t("sy_v_signin") : txt.slice(0,90) }; }
      }catch(e){ last=e; }
    }
    return { ok:false, error:String((last&&last.message)||last||"failed"), timeout:!!(last&&last.timeout) };
  };
  // The fix printed under a failed link must match the failure that actually happened. A
  // timeout is not a wrong key, and saying so sent us hunting for a key that was correct.
  const why=j=> (j&&j.timeout)? t("conn_slow_fix")
              : (j&&/SYNC_KEY not set/i.test(j.error||""))? t("conn_nokey_fix") : "";

  const getj=await post({op:"state_get", auth:auth});
  if(!add("conn_sync", !!(getj&&getj.ok), (getj&&getj.error)||"", why(getj))) return steps;

  const pj=await post({op:"state_put", auth:auth, data:syncSnapshot()});
  add("conn_push", !!(pj&&pj.ok), (pj&&pj.error)||"", why(pj));

  const hj=await post({op:"hits_get", auth:auth});
  add("conn_hits", !!(hj&&hj.ok), (hj&&hj.ok)? ((hj.events||[]).length+" "+t("conn_events")) : (hj&&hj.error)||"", why(hj));

  // The link that was invisible until now: is this URL the one the repo publishes to every device?
  let filed="";
  try{ const r=await fetchT("./sync.json",{cache:"no-store"},8000); if(r.ok){ const j=await r.json(); filed=(j&&j.ep)||""; } }catch(e){}
  add("conn_repo", !!filed && filed===ep, filed? tail(filed) : t("conn_no_file"));

  // The passcode is the boundary, so publishing has to work here too, not only on one device.
  const gc=ghConfig();
  add("conn_publish", ghReady(), ghReady()? (gc.owner+"/"+gc.repo) : "");
  return steps;
}

function initSettings(){
  renderStorageMeter();
  renderRepliesPanel();
  renderReputation();
  const el=id=>document.getElementById(id);
  const c=ghConfig();
  el("gh_owner").value=c.owner||"thriveiii";
  el("gh_repo").value=c.repo||"thrive-console";
  el("gh_branch").value=c.branch||"main";
  el("gh_token").value=c.token||"";
  el("ep2").value=getEndpoint();
  function persist(){ setGhConfig({ owner:el("gh_owner").value.trim(), repo:el("gh_repo").value.trim(),
    branch:el("gh_branch").value.trim()||"main", token:el("gh_token").value.trim() }); }
  function status(){ el("ghStatus").textContent = ghReady()?t("gh_connected"):t("gh_not_connected");
    el("ghStatus").className="pill "+(ghReady()?"ok":"warn"); }
  function result(msg, kind){ const r=el("ghResult"); if(!r) return; r.hidden=false; r.textContent=msg; r.className="gh-result "+(kind||""); }

  /* ---- connection health panel ---- */
  const CONN_STEPS=["conn_url","conn_v4","conn_key","conn_sync","conn_push","conn_hits","conn_repo","conn_publish"];
  function connRender(steps, running){
    const list=el("connList"); if(!list) return;
    const byKey={}; (steps||[]).forEach(s=>{ byKey[s.k]=s; });
    list.innerHTML=CONN_STEPS.map(k=>{
      const s=byKey[k];
      const mark=!s? '<span class="conn-i conn-wait">·</span>'
                   : (s.ok? '<span class="conn-i conn-ok">✓</span>' : '<span class="conn-i conn-bad">✕</span>');
      // The URL is a real link: opening it in a private window is the one test that settles
      // whether the deployment is truly public, and no amount of console code can do it for you.
      const det=s&&s.detail? (s.link
        ? '<a class="conn-d" href="'+esc(s.link)+'" target="_blank" rel="noopener">'+esc(s.detail)+'</a>'
        : '<span class="conn-d">'+esc(s.detail)+'</span>') : "";
      const fix=(s&&!s.ok)? '<span class="conn-fix">'+esc(s.fix||t(k+"_fix"))+'</span>' : "";
      return '<li class="conn-row'+(s&&!s.ok?" bad":"")+'">'+mark+'<span class="conn-t">'+esc(t(k))+'</span>'+det+fix+'</li>';
    }).join("");
    const note=el("connNote"); if(!note) return;
    if(running){ note.hidden=false; note.textContent=t("testing"); note.className="gh-result"; return; }
    /* §3: a version mismatch outranks every other verdict here, because until the
       relay is redeployed no other check can pass and attempting a send is
       pointless. The banner carries the five taps that fix it and a link to the
       ritual in docs/RELAY.md, so the knowledge lives where the failure shows. */
    const mm=relayMismatch();
    if(mm){
      note.hidden=false; note.className="gh-result warn";
      note.innerHTML='<strong>'+esc(relayBannerText())+'</strong>'
        +' <a class="conn-d" href="../docs/RELAY.md" target="_blank" rel="noopener">'+esc(t("relay_ver_ritual"))+'</a>';
      return;
    }
    const all=CONN_STEPS.every(k=>byKey[k]&&byKey[k].ok);
    note.hidden=false;
    note.textContent = all? t("conn_all_ok") : t("conn_broken");
    note.className="gh-result "+(all?"ok":"warn");
  }
  // Rows fill in as each check answers, and a throw still ends with a verdict on screen
  // rather than a panel stuck on "Testing..." forever.
  async function connRun(candidate){
    connRender([], true);
    let steps=[];
    try{ steps=await connCheck(candidate, s=>connRender(s, true)); }
    catch(e){ steps=steps||[]; }
    finally{ connRender(steps, false); }
    return steps;
  }
  if(el("connRun")) el("connRun").addEventListener("click", ()=> connRun(el("sy_ep")?el("sy_ep").value:""));
  // SYNC_KEY is derived from the passcode at unlock, so an unlocked device already holds the
  // exact value Script properties needs. Hunting for it in a file was never necessary.
  if(el("connKey")) el("connKey").addEventListener("click", async ()=>{
    const k=syncAuth();
    if(!k){ toast(t("sy_need_unlock")); return; }
    let done=false;
    try{ await navigator.clipboard.writeText(k); done=true; }catch(e){}
    if(!done){ try{ const ta=document.createElement("textarea"); ta.value=k;
      ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta);
      ta.select(); done=document.execCommand("copy"); document.body.removeChild(ta); }catch(e){} }
    toast(done? t("conn_key_copied") : t("cmp_copy_err"));
  });
  if(el("connFix")) el("connFix").addEventListener("click", async ()=>{
    const note=el("connNote");
    const ep=((el("sy_ep")&&el("sy_ep").value)||getSyncEndpoint()||"").trim();
    if(!ep){ note.hidden=false; note.className="gh-result warn"; note.textContent=t("sy_need_ep"); return; }
    connRender([], true);
    // 1. never adopt a URL that is not the relay this build was written for. The
    //    version this line names is REQUIRED_RELAY, never a literal, so it cannot
    //    drift the way a hardcoded "v4" did the day the relay became v5.
    let version="";
    try{ const r=await fetchT(ep,{cache:"no-store"}); version=(await r.text()).slice(0,120).trim(); }catch(e){}
    if(!(/Thrive relay/i.test(version) && new RegExp("v"+REQUIRED_RELAY+"\\b").test(version))){
      connRender(await connCheck(ep), false);
      note.hidden=false; note.className="gh-result warn";
      note.textContent="✕ "+(version||t("sy_err_net"))+": "+t("sy_v_howto");
      return;
    }
    // 2. one relay for email, sync and analytics on this device
    const now=Date.now();
    setSyncEndpoint(ep); setEmailEndpoint(ep); stampSyncEp(now); touchScalars();
    if(el("sy_ep")) el("sy_ep").value=ep;
    if(el("em_ep")) el("em_ep").value=ep;
    // 3. publish it to the repo so every other device finds it with nothing to type
    let repoMsg="";
    if(ghReady()){
      try{ await ghPutFile("library/sync.json", JSON.stringify({ep:ep, up:now})+"\n", "Publish relay endpoint"); }
      catch(e){ repoMsg=t("gh_err")+": "+e.message; }
    } else repoMsg=t("sy_no_repo");
    // 4. seal the publishing credentials so every device gains them, then push and pull
    try{ await vaultRefresh(); }catch(e){}
    try{ await syncPush(); }catch(e){}
    try{ await syncNow(); }catch(e){}
    logActivity("settings","","relay repair");
    const steps=await connCheck(ep);
    connRender(steps, false);
    if(repoMsg){ note.hidden=false; note.className="gh-result warn"; note.textContent=t("sy_local_only")+" "+repoMsg; }
  });
  connRun("");
  // A device that just unlocked gains its publishing credentials a moment later, when the
  // first sync round opens the vault. Refresh the page once when that lands, so the panel and
  // the fields show what the device actually holds instead of what it held at load.
  let __connRefreshed=false;
  onThrive("sync","settings",function(){
    try{ syCounts(); }catch(e){}
    if(!__connRefreshed && ghReady() && !el("gh_token").value){
      __connRefreshed=true;
      const c2=ghConfig();
      el("gh_owner").value=c2.owner||""; el("gh_repo").value=c2.repo||"";
      el("gh_branch").value=c2.branch||"main"; el("gh_token").value=c2.token||"";
      status(); connRun("");
    }
  });

  el("ghSave").addEventListener("click", async ()=>{
    persist(); logActivity("settings","","github config"); status();
    // Sealed here, so every other device that unlocks with the passcode can publish too.
    const sealed=await vaultRefresh();
    if(sealed) try{ await syncPush(); }catch(e){}
    toast(sealed? t("gh_shared") : t("settings_saved"));
    connRun("");
  });
  el("ghTest").addEventListener("click", async ()=>{
    persist(); status(); result(t("testing"), "");
    try{ const r=await ghVerify();
      const canPush=!!(r.permissions&&r.permissions.push);
      const line=(canPush?"✓ ":"✕ ")+r.full_name+(canPush?" · "+t("gh_can_write"):" · "+t("gh_read_only"));
      result(line, canPush?"ok":"warn");
      el("ghStatus").textContent=canPush?t("gh_connected"):t("gh_read_only"); el("ghStatus").className="pill "+(canPush?"ok":"warn");
    }
    catch(e){ result("✕ "+t("gh_test_fail")+": "+e.message, "warn"); }
  });
  el("epSave2").addEventListener("click",()=>{ setEndpoint(el("ep2").value.trim()); toast(t("ins_saved")); });
  if(el("em_ep")){
    el("em_ep").value=getEmailEndpoint();
    if(el("em_name")) el("em_name").value=getFromName();
    el("emSave").addEventListener("click",()=>{
      setEmailEndpoint(el("em_ep").value.trim());
      if(el("em_name")) setFromName(el("em_name").value.trim());
      touchScalars(); scheduleSyncPush();
      logActivity("settings","","email"); toast(t("settings_saved"));
    });
  }
  if(el("sy_ep")){
    el("sy_ep").value=getSyncEndpoint()||getEmailEndpoint();
    const syStatus=el("syStatus");
    function syShow(msg, cls){ syStatus.hidden=false; syStatus.textContent=msg; syStatus.className="gh-result "+(cls||""); }
    // What this device actually holds, so "where did my sends go?" is answerable at a glance.
    /* How full the shared store is, and what the console shed to keep it under the relay's
       hard cap. A store that is filling up is a number you watch, not a sync that stops. */
    function sizeLine(){
      const z=syncSize();
      if(!z.bytes) return "";
      const warn=z.pct>=80 || z.shed;
      const note = z.shed==="html" ? t("sy_shed_html")
                 : z.shed==="html+log" ? t("sy_shed_log")
                 : z.shed==="over" ? t("sy_shed_over") : "";
      return '<br><span class="'+(warn?"warn-line":"ok-line")+'">'+
        esc(t("sy_size").replace("{pct}", z.pct))+(note? " "+esc(note) : "")+'</span>';
    }
    function syCounts(){
      const c=el("syCounts"); if(!c) return;
      const mail=getMailLog(), sent=mail.filter(m=>m.status==="sent").length;
      // Two URLs on one settings page is the single most expensive confusion this console has
      // produced, so the page states plainly whether they are the same relay.
      const se=getSyncEndpoint(), ee=getEmailEndpoint();
      const agree=(se&&ee)? (se===ee?'<span class="ok-line">✓ '+esc(t("sy_one_relay"))+'</span>'
                                    :'<span class="warn-line" data-icon="alert">'+esc(t("sy_two_relays"))+'</span>') : "";
      /* Every count that travels, so "is my other device the same as this one" is a thing you
         read rather than a thing you hope. And anything this device is holding that the shared
         store could not carry is named, because a mirror is allowed a physical limit and is
         never allowed a quiet one. */
      const held=unmirrored();
      c.innerHTML='<b>'+sent+'</b> '+t("sy_c_sent")+' · <b>'+getThreads().length+'</b> '+t("sy_c_threads")+
        ' · <b>'+getSendStamps().length+'</b> '+t("sy_c_stamps")+' · <b>'+getDrafts().length+'</b> '+t("sy_c_opps")+
        ' · <b>'+getEmailTemplates().length+'</b> '+t("sy_c_msgtpl")+
        ' · <b>'+getCustomTemplates().length+'</b> '+t("sy_c_pagetpl")+
        ' · <b>'+Object.keys(tombs()).length+'</b> '+t("sy_c_removed")+
        (agree?'<br>'+agree:"")+
        (held.length? '<br><span class="warn-line" data-icon="alert">'+boardText(getLang(),"sy_held",held.length,
          {list: esc(held.map(x=>String(x).replace(/^tpl:/,"")).join("، "))})+'</span>' : "")+
        sizeLine();
    }
    function sySummary(){
      syCounts();
      const last=syncLast();
      if(last){ try{ syShow("✓ "+t("sy_last")+" "+new Date(last).toLocaleString(getLang()==="ar"?"ar":"en",{dateStyle:"medium",timeStyle:"short"}), "ok"); return; }catch(e){} }
      if(getSyncEndpoint()) syShow(t("sy_ready"),"");
    }
    sySummary();
    if(el("syPush")) el("syPush").addEventListener("click", async ()=>{
      if(!syncAuth()){ toast(t("sy_need_unlock")); return; }
      syShow(t("sy_syncing"),"");
      const ok=await syncPush();
      if(ok){ sySummary(); toast(t("sy_pushed")); }
      else syShow("✕ "+t("sy_fail")+(syncErrHint()?": "+syncErrHint():""),"warn");
    });
    // Check a URL BEFORE trusting it. Apps Script hands out a new URL per deployment, so it is
    // easy to end up calling an old one that still serves the previous code.
    async function verifyUrl(ep){
      let body="";
      try{ const r=await fetchT(ep,{cache:"no-store"},9000); body=await r.text(); }
      catch(e){ return { ok:false, version:"", msg:t("sy_err_net") }; }
      const v=classifyRelayBody(body);
      if(v.kind==="signin") return { ok:false, version:t("sy_v_signin"), msg:t("conn_v4_fix_access") };
      if(v.kind==="net")    return { ok:false, version:"", msg:t("sy_err_net") };
      if(v.kind==="other")  return { ok:false, version:v.version, msg:t("sy_v_notrelay") };
      if(v.kind==="old")    return { ok:false, version:v.version, msg:t("sy_v_old") };
      return { ok:true, version:v.version };
    }
    if(el("syVerify")) el("syVerify").addEventListener("click", async ()=>{
      const ep=el("sy_ep").value.trim();
      if(!ep){ toast(t("sy_need_ep")); return; }
      syShow(t("testing"),"");
      const v=await verifyUrl(ep);
      syShow((v.ok?"✓ ":"✕ ")+(v.version||"–")+(v.ok?"":": "+v.msg), v.ok?"ok":"warn");
    });
    el("syEnable").addEventListener("click", async ()=>{
      const ep=el("sy_ep").value.trim();
      if(!ep){ toast(t("sy_need_ep")); return; }
      // Refuse to publish a URL that is not the required relay version: publishing a stale one breaks every device.
      const v=await verifyUrl(ep);
      if(!v.ok){ syShow("✕ "+(v.version||"–")+": "+v.msg+" "+t("sy_v_howto"), "warn"); return; }
      const now=Date.now();
      setSyncEndpoint(ep); setEmailEndpoint(ep); stampSyncEp(now);   // one relay: email, sync, analytics
      // and the email box above must show it too, or the page looks like it holds two
      // different relays and the reader goes back to pasting the URL twice.
      if(el("em_ep")) el("em_ep").value=ep;
      touchScalars();
      // commit library/sync.json so every device that unlocks the gate finds the endpoint itself
      let published=false, epErr="";
      if(ghReady()){
        try{ await ghPutFile("library/sync.json", JSON.stringify({ep:ep, up:now})+"\n", "Enable live sync"); published=true; }
        catch(e){ epErr=t("gh_err")+": "+e.message; }
      } else epErr=t("sy_no_repo");
      logActivity("settings","","sync");
      const ok=await syncNow();
      // A relay saved on one device only is not "published to all devices". Saying so in green
      // is how a phone kept calling a dead URL while the iPad reported success.
      if(!published){ syCounts(); syShow(t("sy_local_only")+" "+epErr, "warn"); return; }
      if(ok) sySummary(); else if(syncErrHint()) syShow("✕ "+t("sy_fail")+": "+syncErrHint(),"warn");
    });
    el("syNow").addEventListener("click", async ()=>{
      syShow(t("sy_syncing"),"");
      const ok=await syncNow();
      if(ok) sySummary(); else syShow("✕ "+t("sy_fail")+(syncErrHint()?": "+syncErrHint():""),"warn");
    });
  }
  if(el("q_daily")){
    const cfg=quotaCfg(); el("q_daily").value=cfg.daily; el("q_monthly").value=cfg.monthly;
    const ro=el("quotaReadout");
    function showUsage(){
      if(!ro) return; const u=quotaUsage();
      const cls=u.dayFull||u.monthFull?"full":(u.dayLeft<=Math.max(3,Math.ceil(u.dailyCap*0.1))?"near":"ok");
      ro.className="quota-readout "+cls;
      ro.innerHTML='<b>'+u.day+' / '+u.dailyCap+'</b> '+t("cmp_quota_today_l")+' · <b>'+u.month+' / '+u.monthlyCap+'</b> '+t("cmp_quota_month_l")+
        (u.dayFull&&u.freeInMs>0? ' · '+t("cmp_quota_resets")+' '+fmtDur(u.freeInMs):'');
    }
    showUsage();
    el("qSave").addEventListener("click",()=>{
      setQuotaCfg({ daily:el("q_daily").value, monthly:el("q_monthly").value });
      touchScalars(); scheduleSyncPush();
      showUsage(); logActivity("settings","","quota"); toast(t("settings_saved"));
    });
  }
  const bkExport=el("bkExport"), bkFile=el("bkFile");
  if(bkExport) bkExport.addEventListener("click",()=>{
    download("thrive-console-backup.json", JSON.stringify(exportBackup(),null,2), "application/json"); logActivity("backup","","");
  });
  if(bkFile) bkFile.addEventListener("change",e=>{ const f=e.target.files[0]; if(!f) return;
    const fr=new FileReader();
    fr.onload=()=>{ try{ importBackup(JSON.parse(fr.result)); logActivity("restore","",""); toast(t("restored_ok")); setTimeout(()=>location.reload(),1200); }
      catch(ex){ toast(t("restore_err")+": "+ex.message); } bkFile.value=""; };
    fr.readAsText(f); });
  onThrive("lang","settings-gh",status); status();
}

/* ---------- templates gallery ---------- */
const APPROVED_TEMPLATES = [
  { id:"en-opp1", name_en:"The Signal Brief", name_ar:"موجز الإشارة", lang:"EN",
    desc_en:"Respect-first single page. Signal hero, quote, three proof points, the gap, the six-part monthly system, CTA. Fits any prospect.",
    desc_ar:"صفحة واحدة تقود بالاحترام. رمز إشاري، اقتباس، ثلاث نقاط، الفجوة، منظومة الستة، ودعوة. تصلح لأي فرصة.",
    example:"../opp/ludic-lillian/" },
  { id:"ar-opp1", name_en:"The Signal Brief (Arabic)", name_ar:"موجز الإشارة", lang:"AR",
    desc_en:"The Arabic RTL edition of the Signal Brief, set in the Alyamama typeface. Same structure, right to left.",
    desc_ar:"النسخة العربية RTL من موجز الإشارة، بخط اليمامة. البنية نفسها، من اليمين إلى اليسار.",
    example:"../templates/ar-opp1/preview.html" }
];
function initTemplates(){
  const el=id=>document.getElementById(id);
  let pendingHTML=null;
  // Migrate any pre-taxonomy items to their type before the lists draw, so nothing renders typeless.
  const __mig=migrateItemTypes();
  if(__mig.pages) try{ scheduleSyncPush(); }catch(e){}

  function renderBuiltin(){
    const l=getLang();
    el("builtinList").innerHTML = APPROVED_TEMPLATES.map(tp=>`
      <div class="item">
        <div class="thumb"><iframe src="${tp.example}" loading="lazy" title="${esc(tp.id)}"></iframe></div>
        <div class="item-body">
          <div class="id">${esc(tp.id)} · ${esc(tp.lang)}</div>
          <h3>${l==="ar"?esc(tp.name_ar):esc(tp.name_en)}</h3>
          <span class="badge sent">${t("status_approved")}</span>
          <p>${l==="ar"?esc(tp.desc_ar):esc(tp.desc_en)}</p>
          <div class="actions">
            <a class="btn sm" href="${viewHref("editor","t="+encodeURIComponent(tp.id))}">${t("use_template")}</a>
            <a class="btn ghost sm" href="../templates/${encodeURIComponent(tp.id)}/template.html" download="${esc(tp.id)}.html">${t("dl_template")}</a>
            <a class="btn ghost sm" href="${esc(tp.example)}" target="_blank" rel="noopener">${t("open_page")}</a>
          </div>
        </div>
      </div>`).join("");
  }
  function renderCustom(){
    const all=getCustomTemplates();
    const list=localeTemplates(all, localeTab());
    const host=el("customList");
    host.innerHTML=localeTabBar("tplLocTabs")+
      (list.length? list.map(ct=>`
        <div class="tpl kind-page">
          <div class="tpl-b">
            <div class="name">${ic("page",16)}${esc(ct.name||ct.id)}</div>
            <!-- An editable template ALWAYS shows its type, field count and locale. That is
                 what distinguishes it on sight from a ready offer, which has no fields and
                 belongs to one prospect. WO-013 §3.4. -->
            <div class="id">${esc(ct.id)} · <span class="kind-tag">${esc(t("type_editable"))}</span>
              · ${esc(t("loc_"+String(localeOf(ct)||"en").toLowerCase()))}
              · ${esc(boardText(getLang(),"kd_fields", (ct.fields||ThriveKinds.fillableFields(ct.html||"")).length))}
              ${ct.type_migrated?`· <span class="type-mig">${esc(t("type_migrated"))}</span>`:""}</div>
          </div>
          <!-- Editable template actions only: edit it, generate an offer from it, activate it. -->
          <div class="tpl-a">
            <a class="btn ghost sm" href="${viewHref("editor","t="+encodeURIComponent(ct.id))}">${t("tpl_edit")}</a>
            <a class="btn ghost sm" href="${viewHref("editor","t="+encodeURIComponent(ct.id)+"&gen=offer")}">${t("tpl_gen_offer")}</a>
            <button class="btn ghost sm" data-pubtpl="${esc(ct.id)}">${t("publish")}</button>
            <button class="btn ghost sm" data-cp="${esc(ct.id)}">${t(localeTab()==="EN"?"loc_counterpart":"loc_counterpart_en")}</button>
            <button class="btn ghost sm" data-dl="${esc(ct.id)}">${t("dl_template")}</button>
            <button class="btn ghost sm danger" data-del="${esc(ct.id)}">${t("tpl_delete")}</button>
          </div>
        </div>`).join("") : "")+
      localeEmpty(localeTab(), list.length)+
      migrationPanel();
    if(typeof applyIcons==="function") applyIcons(host);
    window.__renderPageTpls=renderCustom;
    host.querySelectorAll("[data-loc]").forEach(b=>b.addEventListener("click",()=>setLocaleTab(b.getAttribute("data-loc"))));
    bindMigration(host, renderCustom);
    /* A counterpart copies the structure and leaves the content empty. It never machine
       translates: a translated shelf reads as a shelf until somebody sends from it. */
    host.querySelectorAll("[data-cp]").forEach(b=>b.addEventListener("click",()=>{
      const src=getCustomTemplate(b.getAttribute("data-cp")); if(!src) return;
      const other=localeTab()==="EN"?"AR":"EN";
      let id=src.id+"-"+other.toLowerCase(); let n=2;
      while(getCustomTemplate(id)) id=src.id+"-"+other.toLowerCase()+"-"+(n++);
      saveCustomTemplate({ id:id, name:(src.name||src.id)+" ("+t("loc_"+other.toLowerCase())+")",
        locale:other, lang:other, html:"", created:new Date().toISOString() });
      logActivity("tpl_add", id, "counterpart");
      toast(t("loc_counterpart_made"));
      setLocaleTab(other);   /* redraws both lists, so the counterpart is on screen already */
    }));
    host.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", async ()=>{
      const id=b.getAttribute("data-del");
      const opps=await mergedOpps();
      const d=ThriveLifecycle.templateDeletion(id, opps);
      if(!d.allowed){
        toast(boardText(getLang(),"tpl_del_blocked",d.blocking.length,{list:d.blocking.slice(0,3).join(", ")}));
        return;
      }
      if(!confirm(d.affected.length
        ? boardText(getLang(),"tpl_del_affects",d.affected.length)
        : t("tpl_confirm_del"))) return;
      d.patches.forEach(pt=>saveDraft(pt));
      removeCustomTemplate(id); logActivity("tpl_remove", id, "");
      try{ scheduleSyncPush(); }catch(e){}
      renderCustom();
    }));
    host.querySelectorAll("[data-dl]").forEach(b=>b.addEventListener("click",()=>{
      const ct=getCustomTemplate(b.getAttribute("data-dl")); if(ct) download(ct.id+".html", ct.html||"");
    }));
    host.querySelectorAll("[data-pubtpl]").forEach(b=>b.addEventListener("click", async ()=>{
      const ct=getCustomTemplate(b.getAttribute("data-pubtpl")); if(!ct) return;
      b.disabled=true; const old=b.textContent; b.textContent=t("publishing");
      try{ await publishTemplate(ct); logActivity("tpl_publish", ct.id, ""); toast(t("tpl_published")); }
      catch(e){ toast(t("tpl_pub_err")+": "+e.message); }
      finally{ b.disabled=false; b.textContent=old; }
    }));
  }


  /* ---- upload, and the question it can no longer skip ---------------------
     An uploaded .html used to be ambiguous: nothing told the console whether it
     was a skeleton to build from or a finished page for one prospect, so the
     same gesture did two different things and nobody could predict which. Now
     the file declares itself, and when it does not, the console ASKS. It never
     guesses: guessing from field count files a finished page with a stray token
     as a template, and both failures are silent. */
  const dz=el("tplDz"), file=el("tplFile");
  let pendingRead=null;                              // the classification, once read

  function reportBox(){
    let b=el("tplReport");
    if(!b){ b=document.createElement("div"); b.id="tplReport"; b.className="kd-report";
            dz.parentNode.insertBefore(b, dz.nextSibling); }
    return b;
  }
  /* Every upload ends with ONE SENTENCE saying what the console decided and
     where the thing went. A file that vanishes into the right place without
     saying so is the same experience as one that vanished into the wrong one. */
  function said(msg, cls){
    const b=reportBox();
    b.innerHTML='<p class="kd-said '+(cls||"")+'">'+ic(cls==="bad"?"alert":"check")+esc(msg)+'</p>';
  }

  function showRead(c, fname){
    const b=reportBox();
    /* Cleared on every read. Without this, reading a good template and then an
       ambiguous file left the previous classification standing, and pressing Add
       would have saved the ambiguous file under the earlier file's answer. */
    pendingRead=null;
    if(!c.ok){
      const why = c.error==="kd_err_kind" ? t("kd_err_kind").replace("{k}", c.errorDetail||"")
                : t(c.error);
      said(why, "bad");
      pendingRead=null;
      return;
    }
    if(c.ask){
      /* One question, with the name and a preview, and two clear choices. */
      b.innerHTML='<div class="kd-ask">'+
        '<p class="kd-q">'+esc(t("kd_ask").replace("{f}", fname))+'</p>'+
        '<div class="kd-prev"><iframe title="'+esc(fname)+'" sandbox=""></iframe></div>'+
        '<div class="bar">'+
          '<button class="btn" type="button" data-kd="page-template">'+ic("page")+esc(t("kd_is_template"))+'</button>'+
          '<button class="btn ghost" type="button" data-kd="offer">'+ic("spark")+esc(t("kd_is_offer"))+'</button>'+
        '</div></div>';
      const fr=b.querySelector("iframe");
      if(fr) fr.srcdoc=pendingHTML||"";
      b.querySelectorAll("[data-kd]").forEach(btn=>btn.addEventListener("click",()=>{
        const d=ThriveKinds.decide(pendingHTML, fname, btn.getAttribute("data-kd"));
        pendingHTML=d.html||pendingHTML;
        showRead(d, fname);
      }));
      return;
    }
    pendingRead=c;
    if(c.kind==="offer"){
      b.innerHTML='<p class="kd-said">'+ic("spark")+esc(t("kd_read_offer"))+'</p>'+
        '<div class="bar"><button class="btn" type="button" id="kdMakeOpp">'+esc(t("kd_make_opp"))+'</button></div>';
      const mk=el("kdMakeOpp");
      if(mk) mk.addEventListener("click", async ()=>{ await makeOfferOpportunity(c, fname); });
      return;
    }
    /* A page template: show the fields BEFORE it is saved, and name every
       unknown one. An unknown field still substitutes as empty, which is a
       usable template with a hole in it, and the person is told which hole. */
    const warn=c.warnings.map(w=>'<p class="kd-warn">'+ic("alert")+
      esc(t("kd_warn_unknown"))+' <span class="mono-iso">'+esc(w.fields.join(", "))+'</span></p>').join("");
    b.innerHTML='<div class="kd-ok">'+
      '<p class="kd-said">'+ic("page")+esc(t("kd_read_template"))+'</p>'+
      '<p class="kd-line"><b>'+esc(t("kd_locale"))+'</b> '+esc(t("loc_"+c.locale.toLowerCase()))+'</p>'+
      '<p class="kd-line"><b>'+esc(boardText(getLang(),"kd_fields", c.fields.length))+'</b></p>'+
      '<ul class="kd-fields">'+c.fields.map(x=>'<li><span class="mono-iso">'+esc(x)+'</span>'+
        (ThriveKinds.KNOWN_FIELDS.indexOf(x)<0? ' <span class="kd-unk">'+esc(t("kd_unknown"))+'</span>':'')+
        '</li>').join("")+'</ul>'+
      (c.quoteBlock? '<p class="kd-line">'+esc(t("kd_quote_block"))+'</p>':'')+
      warn+'</div>';
    el("tpl_lang").value=c.locale;
    if(!el("tpl_id").value) el("tpl_id").value=slugify(c.name||fname.replace(/\.html?$/i,""));
    if(!el("tpl_name").value) el("tpl_name").value=c.name||fname.replace(/\.html?$/i,"");
  }

  /* A finished offer belongs to one prospect, so it lands on the board and never
     in the Library. That is the Library rule made operational rather than
     printed and ignored. */
  async function makeOfferOpportunity(c, fname){
    const biz=c.name||fname.replace(/\.html?$/i,"");
    let slug=slugify(biz), n=2;
    const have=getDrafts();
    while(have.some(d=>d.slug===slug)) slug=slugify(biz)+"-"+(n++);
    saveDraft({ slug:slug, business:biz, mode:"upload", html:pendingHTML, type:T_OFFER,
                doc_lang:c.locale||"", published:false, up:Date.now() });   // a ready offer, typed at creation
    logActivity("opp_add", slug, "offer upload");
    said(t("kd_went_board").replace("{biz}", biz), "");
    pendingHTML=null; pendingRead=null;
    dz.innerHTML=t("upload_dz");
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
  }

  function readTpl(f){
    if(!/\.html?$/i.test(f.name)){ toast(t("need_html")); return; }
    const fr=new FileReader();
    fr.onload=()=>{ pendingHTML=fr.result;
      dz.innerHTML=t("uploaded")+"<b>"+esc(f.name)+"</b>";
      showRead(ThriveKinds.classify(pendingHTML, f.name), f.name);
    };
    fr.onerror=()=>toast(t("read_err"));
    fr.readAsText(f);
  }
  dz.addEventListener("click",()=>file.click());
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("over"); if(e.dataTransfer.files[0]) readTpl(e.dataTransfer.files[0]);});
  file.addEventListener("change",e=>{ if(e.target.files[0]) readTpl(e.target.files[0]); });

  el("tplAdd").addEventListener("click",()=>{
    if(!pendingHTML){ toast(t("tpl_need_file")); return; }
    /* The file has to have been read and accepted as a page template. Saving a
       file the validator refused, or one nobody answered the question about, is
       how a finished page ended up in the Library in the first place. */
    if(!pendingRead || pendingRead.kind!=="page-template"){ toast(t("kd_not_template")); return; }
    const id=slugify(el("tpl_id").value)|| slugify(el("tpl_name").value);
    if(!id){ toast(t("tpl_need_id")); return; }
    const reserved=APPROVED_TEMPLATES.some(t2=>t2.id===id);
    if(reserved){ toast(t("tpl_id_taken")); return; }
    // An existing custom id would be silently overwritten, so ask first.
    if(getCustomTemplate(id) && !confirm(t("tpl_confirm_overwrite"))) return;
    const loc=pendingRead.locale||el("tpl_lang").value||"EN";
    const ok=saveCustomTemplate({ id, name:el("tpl_name").value.trim()||id, lang:loc, locale:loc,
      fields:pendingRead.fields.slice(),
      html:pendingHTML, created:new Date().toISOString() });
    if(!ok) return;
    logActivity("tpl_add", id, el("tpl_name").value.trim());
    const wentTo=t("loc_"+loc.toLowerCase());
    pendingHTML=null; pendingRead=null; dz.innerHTML=t("upload_dz");
    el("tpl_id").value=""; el("tpl_name").value="";
    said(t("kd_went_library").replace("{loc}", wentTo), "");
    toast(t("tpl_added")); renderCustom();
  });

  /* ---- a starting point, so the first upload is not blind -----------------
     The shipped skeleton with its declarations and its fields in place and its
     content emptied. Somebody building a new template starts from something
     that already works instead of guessing the contract from documentation. */
  const blankBar=el("tplBlank");
  if(blankBar) blankBar.querySelectorAll("[data-blank]").forEach(b=>b.addEventListener("click", async ()=>{
    const loc=b.getAttribute("data-blank");
    const src=loc==="AR" ? "ar-opp1" : "en-opp1";
    const html=await fetchTemplateHtml(src);
    if(!html){ toast(t("kd_blank_err")); return; }
    const name=t("kd_blank_name")+" "+t("loc_"+loc.toLowerCase());
    download("thrive-blank-"+loc.toLowerCase()+".html", ThriveKinds.blankFrom(html, loc, name));
    said(t("kd_blank_done"), "");
  }));

  /* ---- email templates: full, explicit CRUD (new · edit · duplicate · delete) ---- */
  const etBox=el("etEditor");
  let etEditingId=null;                                    // null = creating a new template
  function etOpen(id){
    if(!etBox) return;
    const list=getEmailTemplates(), rec=id?list.find(x=>x.id===id):null;
    etEditingId = rec?rec.id:null;
    el("etEditorH").textContent = rec?t("et_edit_h"):t("et_new_h");
    el("et_name").value = rec?(rec.name||""):"";
    el("et_id").value = rec?rec.id:"";
    el("et_id").readOnly = !!rec;                          // ids are stable once created (compose links use them)
    el("et_subject").value = rec?(rec.subject||""):"{{MONTH}} at Thrive";
    el("et_body").value = rec?(rec.html||""):"Hi {{NAME}},\n\n\n\nAbdullah Thyab\nthriveiii.com";
    el("etHint").textContent = rec && rec.id==="monthly" ? t("et_default_note") : "";
    etBox.hidden=false;
    etBox.scrollIntoView({behavior:"smooth", block:"nearest"});
    setTimeout(()=>el("et_name").focus(), 60);
  }
  function etClose(){ if(etBox) etBox.hidden=true; etEditingId=null; }
  if(el("etNew")) el("etNew").addEventListener("click",()=>etOpen(null));
  if(el("etCancel")) el("etCancel").addEventListener("click", etClose);
  if(el("etSave")) el("etSave").addEventListener("click",()=>{
    const name=el("et_name").value.trim();
    if(!name){ toast(t("et_need_name")); return; }
    const body=el("et_body").value;
    if(!body.trim()){ toast(t("et_need_body")); return; }
    const id = etEditingId || slugify(el("et_id").value) || slugify(name);
    if(!id){ toast(t("tpl_need_id")); return; }
    if(!etEditingId && getEmailTemplates().some(x=>x.id===id)){ toast(t("et_id_taken")); return; }
    saveEmailTemplate({ id, name, subject:el("et_subject").value, html:body });
    logActivity("etpl_add", id, name);
    toast(t("cmp_tpl_saved")); etClose(); renderEmailTpls();
  });
  // Plain-text preview of a template body (tags stripped) so the card shows what it actually says.
  function etPreview(html){
    // A line break is a space once the tags are gone, otherwise the preview reads
    // "Hi {{NAME}},I put together", which is not what the message says.
    const d=document.createElement("div");
    d.innerHTML=String(html||"").replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi," ");
    const txt=(d.textContent||"").replace(/\s+/g," ").trim();
    return txt.length>180 ? txt.slice(0,179).replace(/\s+\S*$/,"")+"\u2026" : txt;
  }
  /* How each message has actually done, next to the message itself. The numbers already
     existed on Insights, one screen away from the place where you choose between templates,
     which is the only place the comparison is a decision rather than a fact. */
  function etStats(){
    const mail=getMailLog(), threads=getThreads(), by={};
    const row=id=>by[id]||(by[id]={sent:0, opens:0, replies:0, people:new Set(), opps:new Set(), last:""});
    mail.forEach(m=>{
      if(m.direction==="in") return;
      if(m.status!=="sent" && m.status!=="copied") return;
      const r=row(m.templateId||"");
      r.sent++;
      if(m.to) r.people.add(String(m.to).toLowerCase());
      if(m.opp) r.opps.add(m.opp);
      if(m.ts>r.last) r.last=m.ts;
    });
    threads.forEach(th=>{
      if(!th.replied) return;
      const out=th.msgs.filter(m=>m.direction!=="in" && (m.status==="sent"||m.status==="copied"));
      if(out[0] && by[out[0].templateId||""]) by[out[0].templateId||""].replies+=th.replied;
    });
    Object.keys(by).forEach(k=>{ by[k].opps.forEach(slug=>{ by[k].opens+=outreachOpens(slug); }); });
    return by;
  }
  /* A template nobody has sent has no performance, and saying "0%" about it would be a claim
     about a message that has never been tried. It says it has not been used instead. */
  function etPerf(s){
    if(!s || !s.sent) return '<p class="et-perf muted">'+esc(t("et_unused"))+'</p>';
    const people=s.people.size||s.sent;
    const rate=(a)=> Math.min(100, Math.round(a/people*100))+"%";
    return '<p class="et-perf">'+
      '<span><b>'+s.sent+'</b> '+esc(t("cmp_sent_n"))+'</span>'+
      '<span><b>'+s.opens+'</b> '+esc(t("ins_opens_n"))+'</span>'+
      '<span><b>'+rate(s.opens)+'</b> '+esc(t("home_tpl_openrate"))+'</span>'+
      '<span'+(s.replies?' class="ok-n"':'')+'><b>'+s.replies+'</b> '+esc(t("cmp_replied_n"))+'</span>'+
      '<span><b>'+rate(s.replies)+'</b> '+esc(t("home_tpl_replyrate"))+'</span></p>';
  }
  function renderEmailTpls(){
    const wrap=el("emailTplList"); if(!wrap) return;
    const all=getEmailTemplates(), stats=etStats();
    /* One locale, same rule as the page templates and same rule as the composer. */
    const list=localeTemplates(all, localeTab());
    const chrome=localeTabBar("etLocTabs");
    const tail=localeEmpty(localeTab(), list.length)+migrationPanel();
    const bindTabs=()=>{
      window.__renderMsgTpls=renderEmailTpls;
      wrap.querySelectorAll("[data-loc]").forEach(b=>b.addEventListener("click",()=>setLocaleTab(b.getAttribute("data-loc"))));
      bindMigration(wrap, renderEmailTpls);
    };
    if(!list.length){ wrap.innerHTML=chrome+tail; bindTabs(); return; }
    wrap.innerHTML = chrome + list.map(et=>{
      const usesMonth=tplUsesMonth(et);
      const bound=boundTemplate(et);          // resolved live: an edit to the template propagates here
      const tplOpts=localeTemplates(getCustomTemplates(), localeTab());
      const bindSel=`<label class="et-bind"><span>${esc(t("type_bind"))}</span>`+
        `<select class="input sm" data-etbind="${esc(et.id)}">`+
        `<option value="">${esc(t("type_bind_none"))}</option>`+
        tplOpts.map(tp=>`<option value="${esc(tp.id)}"${tp.id===et.template_ref?" selected":""}>${esc(tp.name||tp.id)}</option>`).join("")+
        `</select></label>`;
      return `
      <div class="item no-thumb">
        <div class="item-body">
          <div class="id"><span class="kind-tag">${esc(t("type_snippet"))}</span> · ${esc(et.id)}</div>
          <h3>${esc(et.name||et.id)}</h3>
          <div class="meta">
            ${et.id==="monthly"?`<span class="chip">${t("et_default")}</span>`:""}
            ${usesMonth?`<span class="chip tmpl">${t("et_asks_month")}</span>`:""}
            ${/\{\{LINK\}\}/.test(et.html||"")?`<span class="chip">${t("et_has_link")}</span>`:""}
            ${bound?`<span class="chip tmpl">${t("type_bound_to")} ${esc(bound.name||bound.id)}</span>`:""}
          </div>
          <p class="meta-line"><b>${esc(et.subject||"–")}</b></p>
          <p class="meta-line">${esc(etPreview(et.html))}</p>
          ${etPerf(stats[et.id])}
          <!-- Text snippet actions only: recall it into a message, bind it to an editable template
               (a live reference, not a copy), edit, duplicate, delete. No activate, no generate. -->
          <div class="actions">
            <a class="btn sm" href="${viewHref("compose","etpl="+encodeURIComponent(et.id))}">${t("cmp_compose_with")}</a>
            <button class="btn ghost sm" data-etedit="${esc(et.id)}">${t("cmp_link_edit")}</button>
            <button class="btn ghost sm" data-etdup="${esc(et.id)}">${t("et_duplicate")}</button>
            <button class="btn ghost sm danger" data-etdel="${esc(et.id)}">${t("tpl_delete")}</button>
          </div>
          ${bindSel}
        </div>
      </div>`;}).join("") + tail;
    bindTabs();
    // Binding a snippet to an editable template stores a reference (the template id), never a copy.
    wrap.querySelectorAll("[data-etbind]").forEach(sel=>sel.addEventListener("change",()=>{
      const id=sel.getAttribute("data-etbind"), ref=sel.value;
      saveEmailTemplate({ id:id, template_ref:ref });
      logActivity("etpl_bind", id, ref||"(none)");
      try{ scheduleSyncPush(); }catch(e){}
      renderEmailTpls();
    }));
    wrap.querySelectorAll("[data-etedit]").forEach(b=>b.addEventListener("click",()=>etOpen(b.getAttribute("data-etedit"))));
    wrap.querySelectorAll("[data-etdup]").forEach(b=>b.addEventListener("click",()=>{
      const src=getEmailTemplates().find(x=>x.id===b.getAttribute("data-etdup")); if(!src) return;
      let id=src.id+"-copy", n=2; while(getEmailTemplates().some(x=>x.id===id)) id=src.id+"-copy-"+(n++);
      saveEmailTemplate({ id, name:(src.name||src.id)+" (copy)", subject:src.subject, html:src.html });
      logActivity("etpl_add", id, "duplicate"); toast(t("et_duplicated")); renderEmailTpls();
    }));
    wrap.querySelectorAll("[data-etdel]").forEach(b=>b.addEventListener("click",()=>{
      const id=b.getAttribute("data-etdel");
      // The stock "monthly" template is restorable, so deleting it is safe and allowed.
      if(!confirm(id==="monthly"? t("et_confirm_del_default") : t("tpl_confirm_del"))) return;
      removeEmailTemplate(id); logActivity("etpl_remove", id, "");
      if(etEditingId===id) etClose();
      renderEmailTpls();
    }));
  }
  /* Two kinds of template, two tabs, and the address bar remembers which one you were on so
     "Manage" from the composer lands on messages rather than on page layouts. */
  const tabs=el("tplTabs");
  function showTab(which){
    if(!tabs) return;
    which = (which==="mail") ? "mail" : "page";
    tabs.querySelectorAll("[data-tpltab]").forEach(b=>{
      const on = b.getAttribute("data-tpltab")===which;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on?"true":"false");
    });
    document.querySelectorAll("[data-tplpane]").forEach(p=>{
      p.hidden = p.getAttribute("data-tplpane")!==which;
    });
  }
  if(tabs) tabs.querySelectorAll("[data-tpltab]").forEach(b=>b.addEventListener("click",()=>{
    showTab(b.getAttribute("data-tpltab"));
  }));
  // #email was the anchor the composer's Manage link used; keep it working as a tab request.
  const wantMail = viewParams().get("kind")==="mail" || /(^|[#?&])email\b/.test(location.hash||"");
  showTab(wantMail ? "mail" : "page");

  onThrive("lang","templates",()=>{ renderBuiltin(); renderCustom(); renderEmailTpls(); });
  renderBuiltin(); renderCustom(); renderEmailTpls();
}

/* ---------- Overview home: outreach + page performance in one room ---------- */
function fmtMs(ms){ if(!ms) return "–"; const s=Math.round(ms/1000); if(s<60) return s+"s"; const m=Math.floor(s/60); return m+"m "+(s%60)+"s"; }
function fmtWhen(ts){ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",{dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts||"–"; } }
/* roll raw beacon events into per-slug page stats */
function aggregateHits(events){
  const bySlug={};
  (events||[]).forEach(ev=>{
    const slug=ev.slug||"(unknown)";
    const o=bySlug[slug]||(bySlug[slug]={slug, opens:0, vids:new Set(), ips:new Set(), lastTs:"", dwellMs:0, dwellN:0});
    if(ev.type==="open" || !ev.type){ o.opens++; if(ev.ts>o.lastTs)o.lastTs=ev.ts; }
    if(ev.vid) o.vids.add(ev.vid);
    if(ev.ip) o.ips.add(ev.ip);
    if(ev.type==="dwell" && ev.ms){ o.dwellMs+=ev.ms; o.dwellN++; }
  });
  return Object.values(bySlug).sort((a,b)=>b.opens-a.opens);
}
async function initHome(){
  const el=id=>document.getElementById(id);
  // Every metric carries its own explanation. The ⓘ is pinned to the tile's top corner,
  // trailing edge, so top-right in English and top-left in Arabic, never inline with the
  // label (which made it wrap onto a second line and look scattered).
  const tile=(v,k,cls,tip,icon)=>'<div class="tile'+(cls?" "+cls:"")+'">'+
    (tip?'<button type="button" class="info tile-info" data-tip="'+esc(tip)+'" aria-label="'+esc(tip)+'">i</button>':'')+
    (icon?'<span class="tile-ic">'+ic(icon,18)+'</span>':'')+
    '<div class="tile-v">'+esc(String(v))+'</div>'+
    '<div class="tile-k">'+k+'</div></div>';

  function syncPill(){
    const p=el("homeSync"); if(!p) return;
    const last=syncLast();
    if(!getSyncEndpoint()){ p.textContent=t("home_sync_off"); p.className="pill warn"; return; }
    if(!last){ p.textContent=t("sy_ready"); p.className="pill"; return; }
    p.textContent=t("sy_last")+" "+fmtWhen(last); p.className="pill ok";
  }

  async function render(){
    syncPill();
    const mail=getMailLog(), q=quotaUsage(), opps=await mergedOpps();
    const hits=allHits(), pages=aggregateHits(hits);     // recipients only, own previews excluded
    /* Two counts, told apart everywhere on this page. views is every look at a page; opens are
       the looks that came after a message went out about it. One number, used for both, is
       what made a page nobody had been written to report readers. */
    const oppBySlug={}; opps.forEach(o=>{ oppBySlug[o.slug]=o; });
    const outOpens=slug=> outreachOpens(oppBySlug[slug] || slug);
    const totalViews=pages.reduce((a,p)=>a+p.opens,0);
    const totalOpens=pages.reduce((a,p)=>a+outOpens(p.slug),0);

    // ---- outreach ----
    const sent=mail.filter(m=>m.status==="sent").length;
    const replies=mail.filter(m=>m.direction==="in"||m.status==="replied").length;
    const threads=getThreads();
    const contacted=new Set(mail.filter(m=>m.to).map(m=>String(m.to).toLowerCase())).size;
    const answered=threads.filter(th=>th.replied>0).length;
    const rate=threads.length? Math.round(answered/threads.length*100) : 0;
    /* The header's state strip. The summary paragraph used to read these same numbers back as a
       sentence; the strip shows them as compact designed cells with a warm icon each, read once.
       contacted, sent, replies and totalOpens are the values computed above, so nothing new is
       derived and no number is invented here. When nothing has gone out yet, the gentle prompt
       stays as prose rather than a row of zeros. */
    const statCell=(icon,n,labelKey)=>
      '<div class="statcell"><span class="statcell-ic">'+ic(icon,16)+'</span>'+
      '<span class="statcell-n">'+n+'</span>'+
      '<span class="statcell-l">'+esc(t(labelKey))+'</span></div>';
    el("homeStory").innerHTML = sent
      ? '<div class="statstrip">'+
          statCell("channel", contacted,  "home_contacts")+
          statCell("send",    sent,       "home_sent_total")+
          statCell("mail",    replies,    "home_replies")+
          statCell("spark",   totalOpens, "home_opens")+
        '</div>'
      : '<p class="lede">'+esc(t("story_none"))+'</p>';

    el("tilesOutreach").innerHTML=
      tile(q.day+" / "+q.dailyCap, t("home_sent_today"), q.dayFull?"t-warn":"", t("tip_sent_today"))+
      tile(q.month+" / "+q.monthlyCap, t("home_sent_month"), "", t("tip_sent_month"))+
      tile(sent, t("home_sent_total"), "", t("tip_sent_total"))+
      tile(contacted, t("home_contacts"), "", t("tip_contacts"))+
      tile(replies, t("home_replies"), "", t("tip_replies"))+
      tile(rate+"%", t("home_reply_rate"), rate>0?"t-good":"", t("tip_reply_rate"));

    // ---- pages ----
    const live=opps.filter(o=>isLive(o)).length;
    const uniq=new Set(); hits.forEach(e=>e.vid&&uniq.add(e.vid));
    const dw=pages.reduce((a,r)=>{ a.ms+=r.dwellMs; a.n+=r.dwellN; return a; }, {ms:0,n:0});
    /* Six, so the group is two even rows. Follow-up left this set on purpose: it is an action,
       not a page metric, and both the board and the library already carry it as something you
       can filter by and act on rather than only look at. */
    // Each tile carries its own icon and accent so the row reads at a glance rather than as one grey
    // block. The accent is cosmetic only; the numbers and the note below are unchanged.
    el("tilesPages").innerHTML=
      tile(live, t("home_live_pages"), "acc-teal", t("tip_live_pages"), "page")+
      tile(opps.length, t("home_total_opps"), "acc-purple", t("tip_total_opps"), "archive")+
      tile(totalViews, t("home_views"), "acc-blue", t("tip_views"), "eye")+
      tile(totalOpens, t("home_opens"), "acc-gold", t("tip_opens"), "spark")+
      tile(uniq.size, t("home_unique"), "acc-rose", t("tip_unique"), "channel")+
      tile(fmtMs(dw.n? dw.ms/dw.n : 0), t("home_dwell"), "acc-green", t("tip_dwell"), "clock");
    // Honest note about where these numbers come from. "No opens yet" is a healthy state and
    // must not be reported as "not collecting": those are different problems.
    const note=el("homeDataNote");
    if(note){
      const st=hitsState(), mine=selfHitCount();
      let msg, cls;
      if(st==="live"){ cls="note";
        msg = getRemoteHits().length ? t("home_data_live") : t("home_data_none_yet"); }
      else if(st==="stale"){ cls="note warn-note";
        msg=t("home_data_stale")+(hitsError()? ' <span class="mono relay-err">'+esc(hitsError())+'</span>' : ''); }
      else { cls="note warn-note"; msg=t("home_data_local"); }
      note.className=cls;
      let extra = mine? " "+boardText(getLang(),"home_data_self",mine) : "";
      // Old local events predate self-tagging, so they cannot be told apart from real opens.
      // While collection is live they are ignored, so say so, and offer to clear them.
      const legacy=legacyLocalHits().length;
      if(legacy && st==="live") extra+=' '+boardText(getLang(),"home_data_legacy",legacy)+
        ' <button type="button" class="btn ghost sm" id="clrLegacy">'+t("home_clear_legacy")+'</button>';
      // Always offer the probe: it names the exact URL being called and what it answers.
      extra+=' <button type="button" class="btn ghost sm" id="probeRelayBtn">'+t("home_probe")+'</button>';
      note.innerHTML=msg+extra;
      const cl=document.getElementById("clrLegacy");
      if(cl) cl.addEventListener("click",()=>{ clearLocalHits(); toast(t("home_legacy_cleared")); render(); });
      const pb=document.getElementById("probeRelayBtn");
      if(pb) pb.addEventListener("click", async ()=>{
        pb.disabled=true; const o=pb.textContent; pb.textContent=t("testing");
        const p=await relayProbe();
        pb.disabled=false; pb.textContent=o;
        const box=el("homeProbe"); if(!box) return;
        box.hidden=false; box.className="note "+(p.v4?"":"warn-note");
        box.innerHTML='<b>'+t("home_probe_h")+'</b><br>'+
          t("home_probe_url")+' <span class="mono">…'+esc(p.tail)+'/exec</span><br>'+
          t("home_probe_ver")+' <span class="mono">'+esc(p.version||"–")+'</span><br>'+
          t("home_probe_sync")+' <span class="mono">'+esc(p.state)+'</span><br>'+
          t("home_probe_hits")+' <span class="mono">'+esc(p.hits)+'</span>'+
          (p.v4? '' : '<br><br>'+t("home_probe_notv4"));
      });
    }

    /* ---- per-campaign performance ----
       EVERY opportunity gets a row, including ones with no activity. Hiding quiet rows is what
       made the table look wrong: on a device whose ledger hadn't synced, the only surviving row
       was a page that had never been sent to anyone. A zero is information; an absent row is not. */
    const byOpp={}, pageBySlug={};
    pages.forEach(p=>{ pageBySlug[p.slug]=p; });
    /* views and opens stay two columns, because collapsing them is what let a page nobody had
       written to report readers. A page read before the first send is worth knowing about and
       is not an open. */
    opps.forEach(o=>{ byOpp[o.slug]={ slug:o.slug, biz:o.business||o.slug, live:isLive(o), archived:!!o.archived,
      sent:0, replies:0, views:0, opens:0, uniq:0, dwellMs:0, dwellN:0, last:"" }; });
    mail.forEach(m=>{
      const k=m.opp||""; if(!k) return;
      const r=byOpp[k]||(byOpp[k]={ slug:k, biz:k, live:false, archived:false, sent:0, replies:0, views:0, opens:0, uniq:0, dwellMs:0, dwellN:0, last:"" });
      if(m.status==="sent") r.sent++;
      if(m.direction==="in"||m.status==="replied") r.replies++;
      if(m.ts>r.last) r.last=m.ts;
    });
    Object.keys(byOpp).forEach(k=>{
      const r=byOpp[k]; r.opens=outOpens(k);
      const p=pageBySlug[k]; if(!p) return;
      r.views=p.opens; r.uniq=p.vids.size; r.dwellMs=p.dwellMs; r.dwellN=p.dwellN;
      if(p.lastTs>r.last) r.last=p.lastTs;
    });
    const rows=Object.values(byOpp)
      .filter(r=>!r.archived)                            // archived opportunities stay out of the active view
      .sort((a,b)=> (b.sent+b.opens+b.replies)-(a.sent+a.opens+a.replies) || String(a.biz).localeCompare(String(b.biz)));
    /* The story sentence counts opens the same way, so the line above the table and the table
       can never report two different numbers. */
    /* T4 glow: the highest value in each comparable column, one per column, found by Math.max
       over the rows. A column that is all zeros has no top to mark. gc() puts the resting
       accent on that one cell, and one slow cycle on it when the top changes. */
    /* The comparable value per column. Dwell is compared as the seconds the cell actually shows
       (fmtMs rounds to whole seconds), so two cells reading "35s" tie rather than splitting on a raw
       millisecond difference the eye cannot see. */
    const dwellSecs=r=> r.dwellN? Math.round((r.dwellMs/r.dwellN)/1000) : 0;
    const GCOLS=[["sent",r=>r.sent],["views",r=>r.views],["opens",r=>r.opens],
                 ["uniq",r=>r.uniq],["dwell",dwellSecs],["replies",r=>r.replies]];
    const gTop={}, gNew={};
    GCOLS.forEach(function(col){
      var name=col[0], get=col[1], mx=0;                  // start at 0: a column of zeros marks nothing
      rows.forEach(function(r){ var val=get(r); if(val>mx) mx=val; });
      // Every cell equal to the column top glows, so a tie is consistent: two equal tops both glow,
      // never one on and one off. A column of all zeros has no top to mark.
      var tops = mx>0 ? rows.filter(function(r){ return get(r)===mx; }).map(function(r){ return r.slug; }) : [];
      gTop[name]=tops;
      gNew[name]=glowChanged("col:"+name, tops.length? tops.slice().sort().join(",")+":"+mx : "none");
    });
    const gc=(name,r)=> (gTop[name] && gTop[name].indexOf(r.slug)>=0)
      ? ' class="is-glow'+(gNew[name]?" is-glow-new":"")+'"' : '';
    const hth=(label,tip)=>'<th>'+label+'<button type="button" class="info" data-tip="'+esc(tip)+'" aria-label="'+esc(tip)+'">i</button></th>';
    const num=v=>v?('<b>'+v+'</b>'):'<span class="zero">0</span>';
    el("homeCampaigns").innerHTML = rows.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("home_c_opp")+'</th>'+hth(t("cmp_sent_n"),t("tip_c_sent"))+
        hth(t("col_views"),t("tip_views"))+hth(t("ins_opens"),t("tip_opens"))+
        hth(t("ins_unique"),t("tip_unique"))+hth(t("ins_dwell"),t("tip_dwell"))+
        hth(t("cmp_replied_n"),t("tip_replies"))+hth(t("ins_last"),t("tip_c_last"))+'</tr></thead><tbody>'+
        rows.map(r=>'<tr><td><a class="link" href="'+relOpp(r.slug)+'" target="_blank" rel="noopener">'+esc(r.biz)+'</a>'+
          (r.live?'':' <span class="tag tag-plain">'+t("draft")+'</span>')+'</td>'+
          '<td'+gc("sent",r)+'>'+num(r.sent)+'</td><td'+gc("views",r)+'>'+num(r.views)+'</td><td'+gc("opens",r)+'>'+num(r.opens)+'</td><td'+gc("uniq",r)+'>'+num(r.uniq)+'</td>'+
          '<td'+gc("dwell",r)+'>'+(r.dwellN?fmtMs(r.dwellMs/r.dwellN):'<span class="zero">–</span>')+'</td>'+
          '<td'+gc("replies",r)+'>'+(r.replies?'<b class="ok-n">'+r.replies+'</b>':'<span class="zero">0</span>')+'</td>'+
          '<td class="mono">'+(r.last?esc(fmtWhen(r.last)):'<span class="zero">–</span>')+'</td></tr>').join("")+
        '</tbody></table></div>'
      : '<div class="empty">'+t("home_no_campaigns")+'</div>';

    /* ---- which message is working ----
       Per template, not per opportunity: how many went out with it, how many of the pages
       those sends pointed at were opened, and how many people answered. A template with a
       high open rate and no replies has a body problem, not a subject problem. Sends made
       with no template are grouped honestly as "no template" instead of being dropped. */
    const byTpl={};
    mail.filter(m=>m.status==="sent"||m.status==="copied").forEach(m=>{
      const id=m.templateId||"", name=m.templateName||t("home_tpl_none");
      const r=byTpl[id]||(byTpl[id]={ id, name, sent:0, opens:0, uniq:0, replies:0, people:new Set(), opps:new Set(), last:"" });
      r.name=name; r.sent++;
      if(m.to) r.people.add(String(m.to).toLowerCase());
      if(m.opp) r.opps.add(m.opp);
      if(m.ts>r.last) r.last=m.ts;
    });
    // A reply belongs to the template of the send it answers, found through its conversation.
    threads.forEach(th=>{
      if(!th.replied) return;
      const out=th.msgs.filter(m=>m.direction!=="in" && (m.status==="sent"||m.status==="copied"));
      const first=out[0]; if(!first) return;
      const r=byTpl[first.templateId||""]; if(r) r.replies+=th.replied;
    });
    /* Opens credited to a message are opens that came after it went out. Counting every view of
       the page instead would credit a template with readers it never earned. */
    Object.values(byTpl).forEach(r=>{
      r.opps.forEach(slug=>{ r.opens+=outOpens(slug); const p=pageBySlug[slug]; if(p) r.uniq+=p.vids.size; });
    });
    const tplRows=Object.values(byTpl).sort((a,b)=> b.sent-a.sent || String(a.name).localeCompare(String(b.name)));
    /* A rate is a share of something, so it cannot exceed the whole. The open rate divided
       unique visitors by people written to, and a page visited by two browsers after one send
       printed "200%", which is not a rate, it is a bug wearing a percent sign. Counted per
       person and capped, because a person who opens twice is still one person who opened. */
    const pct=(a,b)=> b? Math.min(100, Math.round(a/b*100))+"%" : "<span class=\"zero\">0%</span>";
    el("homeTemplates").innerHTML = tplRows.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("home_tpl_name")+'</th>'+hth(t("cmp_sent_n"),t("tip_tpl_sent"))+
        hth(t("ins_opens"),t("tip_tpl_opens"))+hth(t("home_tpl_openrate"),t("tip_tpl_openrate"))+
        hth(t("cmp_replied_n"),t("tip_replies"))+hth(t("home_tpl_replyrate"),t("tip_tpl_replyrate"))+
        hth(t("ins_last"),t("tip_c_last"))+'</tr></thead><tbody>'+
        tplRows.map(r=>'<tr><td><b>'+esc(r.name)+'</b></td>'+
          '<td>'+num(r.sent)+'</td><td>'+num(r.opens)+'</td>'+
          '<td>'+(r.sent? pct(r.uniq, r.people.size||r.sent) : '<span class="zero">0%</span>')+'</td>'+
          '<td>'+(r.replies?'<b class="ok-n">'+r.replies+'</b>':'<span class="zero">0</span>')+'</td>'+
          '<td>'+(r.sent? pct(r.replies, r.people.size||r.sent) : '<span class="zero">0%</span>')+'</td>'+
          '<td class="mono">'+(r.last?esc(fmtWhen(r.last)):'<span class="zero">–</span>')+'</td></tr>').join("")+
        '</tbody></table></div>'
      : '<div class="empty">'+t("home_tpl_empty")+'</div>';

    /* ---- who is paying attention ----
       One row per person, so a follow-up is a decision about a human rather than about a slug. */
    const byPerson={};
    mail.forEach(m=>{
      const who=String(m.to||"").toLowerCase(); if(!who) return;
      const r=byPerson[who]||(byPerson[who]={ to:m.to, name:m.toName||"", sent:0, replies:0, opens:0, opps:new Set(), last:"" });
      if(m.toName && !r.name) r.name=m.toName;
      if(m.status==="sent"||m.status==="copied") r.sent++;
      if(m.direction==="in"||m.status==="replied") r.replies++;
      if(m.opp) r.opps.add(m.opp);
      if(m.ts>r.last) r.last=m.ts;
    });
    Object.values(byPerson).forEach(r=>{ r.opps.forEach(slug=>{ r.opens+=outOpens(slug); }); });
    const DAY=86400000;
    const peopleRows=Object.values(byPerson).map(r=>{
      const age=r.last? (Date.now()-new Date(r.last).getTime())/DAY : 0;
      // The state is a decision, not a decoration: replied, opened but silent, or gone quiet.
      r.state = r.replies? "replied" : (r.opens? (age>3? "warm_cold":"warm") : (age>3? "cold":"sent"));
      return r;
    }).sort((a,b)=> b.replies-a.replies || b.opens-a.opens || (a.last<b.last?1:-1));
    el("homePeople").innerHTML = peopleRows.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("home_p_who")+'</th>'+hth(t("cmp_sent_n"),t("tip_tpl_sent"))+hth(t("ins_opens"),t("tip_opens"))+
        hth(t("cmp_replied_n"),t("tip_replies"))+'<th>'+t("home_p_state")+'</th>'+
        hth(t("ins_last"),t("tip_c_last"))+'</tr></thead><tbody>'+
        peopleRows.map(r=>'<tr><td><b>'+esc(r.name||r.to)+'</b>'+(r.name?'<div class="mprev mono">'+esc(r.to)+'</div>':"")+'</td>'+
          '<td>'+num(r.sent)+'</td><td>'+num(r.opens)+'</td>'+
          '<td>'+(r.replies?'<b class="ok-n">'+r.replies+'</b>':'<span class="zero">0</span>')+'</td>'+
          '<td><span class="tag tag-st-'+r.state+'">'+esc(t("home_p_"+r.state))+'</span></td>'+
          '<td class="mono">'+(r.last?esc(fmtWhen(r.last)):'<span class="zero">–</span>')+'</td></tr>').join("")+
        '</tbody></table></div>'
      : '<div class="empty">'+t("home_p_empty")+'</div>';

    /* ---- most viewed pages ----
       Traffic, not outreach: every recorded view, whether or not a message went out first.
       Only pages that were actually looked at, so this list IS "top N". */
    const opened=pages.filter(p=>p.opens>0);
    el("homeTop").innerHTML = opened.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("ins_item")+'</th>'+hth(t("col_views"),t("tip_views"))+hth(t("ins_unique"),t("tip_unique"))+
        hth(t("ins_dwell"),t("tip_dwell"))+hth(t("ins_last"),t("tip_c_last"))+'</tr></thead><tbody>'+
        opened.slice(0,10).map(r=>'<tr><td><a class="link" href="'+relOpp(r.slug)+'" target="_blank" rel="noopener">'+esc(r.slug)+'</a></td>'+
          '<td><b>'+r.opens+'</b></td><td>'+r.vids.size+'</td>'+
          '<td>'+(r.dwellN?fmtMs(r.dwellMs/r.dwellN):"–")+'</td>'+
          '<td class="mono">'+(r.lastTs?esc(fmtWhen(r.lastTs)):"–")+'</td></tr>').join("")+
        '</tbody></table></div>'
      : '<div class="empty">'+t("home_no_opens")+'</div>';
  }

  el("homeRefresh").addEventListener("click", async ()=>{
    if(syncAuth()){ await syncNow(); await fetchRemoteHits(); }
    render(); checkBeacons();
  });

  /* A page published from an uploaded file may have no beacon: it then records zero opens
     forever, which is exactly how a real campaign ends up showing 0. Detect those live pages
     and offer a one-click repair that re-publishes them with the beacon added. */
  let unmeasured=[];
  async function checkBeacons(){
    const btn=el("homeRepair"), note=el("homeRepairNote");
    if(!btn) return;
    const opps=(await mergedOpps()).filter(o=>isLive(o) && !o.archived);
    unmeasured=[];
    for(const o of opps){
      try{
        const r=await fetchT(relOpp(o.slug)+"index.html",{cache:"no-store"});
        if(!r.ok) continue;
        const html=await r.text();
        if(!hasBeacon(html)) unmeasured.push({slug:o.slug, business:o.business||o.slug, html});
      }catch(e){}
    }
    if(!unmeasured.length){ btn.hidden=true; if(note) note.hidden=true; return; }
    btn.hidden=false;
    if(note){ note.hidden=false;
      note.textContent=boardText(getLang(),"home_unmeasured",unmeasured.length,
        {list: unmeasured.map(u=>u.business).join("، ")}); }
  }
  if(el("homeRepair")) el("homeRepair").addEventListener("click", async ()=>{
    if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>goTo("settings"),900); return; }
    const btn=el("homeRepair"); btn.disabled=true; const old=btn.textContent; btn.textContent=t("publishing");
    let done=0;
    for(const u of unmeasured){
      try{ await ghPutFile("opp/"+u.slug+"/index.html", withBeacon(u.html), "Add analytics beacon to opp/"+u.slug);
        logActivity("publish", u.slug, "beacon repair"); done++; }catch(e){}
    }
    btn.disabled=false; btn.textContent=old;
    toast(done? boardText(getLang(),"home_repaired",done) : t("gh_err"));
    setTimeout(checkBeacons, 1500);
  });
  checkBeacons();
  onThrive("lang","home",render);
  onThrive("sync","home",render);
  render();
  // Collected analytics arrive a moment later. Re-render either way: a FAILED fetch is also
  // information (it tells the banner the relay isn't answering) and must not leave a stale
  // "not collecting" message on screen after the relay has been updated.
  if(syncAuth()) fetchRemoteHits().finally(()=>render());
}

/* ---------- insights (analytics) ---------- */
async function initInsights(){
  const el=id=>document.getElementById(id);
  el("epInput").value = getEndpoint();

  function fmtDur(ms){ if(!ms) return "–"; const s=Math.round(ms/1000); if(s<60) return s+"s"; const m=Math.floor(s/60); return m+"m "+(s%60)+"s"; }
  function fmtDate(ts){ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",{dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts||"–"; } }

  async function fetchData(){
    const ep=getEndpoint();
    if(ep){
      try{
        const r=await fetchT(ep,{cache:"no-store"});
        const j=await r.json();
        return { source:"remote", events: Array.isArray(j)?j : (j.events||[]) };
      }catch(e){ toast(t("ins_fetch_err")); return { source:"remote-error", events:getHits() }; }
    }
    return { source:"local", events:getHits() };
  }

  function aggregate(events){
    const bySlug={};
    events.forEach(ev=>{
      const slug=ev.slug||"(unknown)";
      const o=bySlug[slug]||(bySlug[slug]={slug, opens:0, vids:new Set(), ips:new Set(), lastTs:"", dwellMs:0, dwellN:0, days:{}});
      if(ev.type==="open" || !ev.type){ o.opens++; if(ev.ts>o.lastTs)o.lastTs=ev.ts; const d=(ev.ts||"").slice(0,10); if(d)o.days[d]=(o.days[d]||0)+1; }
      if(ev.vid) o.vids.add(ev.vid);
      if(ev.ip) o.ips.add(ev.ip);
      if(ev.type==="dwell" && ev.ms){ o.dwellMs+=ev.ms; o.dwellN++; }
    });
    return Object.values(bySlug).sort((a,b)=>b.opens-a.opens);
  }

  function spark(days){
    const keys=Object.keys(days).sort(); if(!keys.length) return "";
    const max=Math.max(...keys.map(k=>days[k]));
    return '<span class="spark">'+keys.slice(-14).map(k=>{
      const h=Math.max(3, Math.round(days[k]/max*22));
      return `<i style="height:${h}px" title="${esc(k)}: ${days[k]}"></i>`;
    }).join("")+"</span>";
  }

  async function render(){
    const {source,events}=await fetchData();
    const rows=aggregate(events);
    el("insSource").textContent = source==="remote" ? t("ins_src_remote") : t("ins_src_local");
    el("insSource").className = "pill "+(source==="remote"?"ok":"warn");
    const totOpens=rows.reduce((s,r)=>s+r.opens,0);
    const uniq=new Set(); events.forEach(e=>e.vid&&uniq.add(e.vid));
    // Average dwell PER VIEW (pool all views), not the mean of per-page means, because otherwise a
    // one-view page skews the headline as much as a hundred-view page.
    const dw=rows.reduce((a,r)=>{ a.ms+=r.dwellMs; a.n+=r.dwellN; return a; }, {ms:0,n:0});
    const avgDwell=dw.n? dw.ms/dw.n : 0;
    el("tiles").innerHTML = [
      [t("ins_total_opens"), totOpens],
      [t("ins_unique"), uniq.size],
      [t("ins_tracked"), rows.length],
      [t("ins_avg_dwell"), fmtDur(avgDwell)]
    ].map(([k,v])=>`<div class="tile"><div class="tile-v">${esc(String(v))}</div><div class="tile-k">${k}</div></div>`).join("");

    if(!rows.length){ el("insBody").innerHTML='<div class="empty">'+t("ins_empty")+'</div>'; return; }
    el("insBody").innerHTML='<div class="logwrap"><table class="logtable"><thead><tr>'+
      `<th>${t("ins_item")}</th><th>${t("ins_opens")}</th><th>${t("ins_unique")}</th><th>${t("ins_ips")}</th><th>${t("ins_dwell")}</th><th>${t("ins_last")}</th><th>${t("ins_trend")}</th></tr></thead><tbody>`+
      rows.map(r=>`<tr>
        <td><a class="link" href="${relOpp(r.slug)}" target="_blank" rel="noopener">${esc(r.slug)}</a></td>
        <td><b>${r.opens}</b></td><td>${r.vids.size}</td><td>${r.ips.size||"–"}</td>
        <td>${r.dwellN?fmtDur(r.dwellMs/r.dwellN):"–"}</td><td class="mono">${r.lastTs?esc(fmtDate(r.lastTs)):"–"}</td>
        <td>${spark(r.days)}</td></tr>`).join("")+'</tbody></table></div>';
  }

  el("epSave").addEventListener("click",()=>{ setEndpoint(el("epInput").value.trim()); toast(t("ins_saved")); render(); });
  el("insRefresh").addEventListener("click",render);
  el("insClear").addEventListener("click",()=>{ if(!confirm(t("ins_confirm_clear"))) return; try{localStorage.removeItem(HITS);}catch(e){} render(); });
  onThrive("lang","insights",render);
  render();
}

/* T4: the glow fires once on change, then rests. A full board or table re-render
   rebuilds the same HTML each time, so a class baked into that HTML would replay
   the animation on every render. This remembers, per marked slot, the signature of
   what currently holds it (a column's top slug and value, a card's lane, the
   verdict number); the caller adds .is-glow-new only when the signature is new.
   First sight is not a change, so a fresh load never storms with glows. */
var _glowSig = {};
function glowChanged(key, sig){
  var had = Object.prototype.hasOwnProperty.call(_glowSig, key);
  var prev = _glowSig[key];
  _glowSig[key] = sig;
  return had && prev !== sig;
}

/* ---------- the board ----------
   State is position. Every opportunity sits in the lane that is its state, so you learn
   where everything stands by looking rather than by reading a number, and follow-up debt
   shows up as mass on the screen instead of as something to remember.

   It derives, it never stores: there is no lane field and there must never be one, because a
   stored lane drifts from the truth the moment a beacon hit lands on another device. Every
   stage write goes through the same saveDraft plus logActivity pair the Library select uses,
   so the two surfaces can never disagree about what happened. */
async function initBoard(){
  /* §5.3: retire any `lost` records into the archive once, before the board draws,
     so no retired stage ever reaches a lane. Idempotent and safe to call on every
     load. */
  try{ migrateRetiredStatuses(); }catch(e){}
  const el=id=>document.getElementById(id);
  const lang=()=>getLang();
  const txt=(k,n,extra)=> (typeof boardText==="function")? boardText(lang(),k,n,extra) : "";
  const num=v=>'<span class="n">'+v+'</span>';

  /* The status tab bar (narrow layout). It does not build a second card list: it sets which lane is
     visible, and the same rendered lane content shows. activeTab is remembered across renders so a
     re-render never steals the operator's chosen column. */
  let activeTab=null;
  function setActiveTab(k, animate){
    activeTab=k;
    const lanes=document.getElementById("boardLanes");
    if(lanes) lanes.setAttribute("data-active-lane", k);
    document.querySelectorAll("#boardTabs .btab").forEach(btn=>{
      const on=btn.getAttribute("data-tab")===k;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", on?"true":"false");
    });
    if(animate){   // re-trigger the soft switch; CSS removes it under reduced motion
      const lane=document.querySelector('#boardLanes .lane[data-lane="'+k+'"]');
      if(lane){ lane.classList.remove("tab-in"); void lane.offsetWidth; lane.classList.add("tab-in"); }
    }
  }

  function syncPill(){
    const p=el("boardSync"); if(!p) return;
    const last=syncLast();
    if(!getSyncEndpoint()){ p.textContent=t("home_sync_off"); p.className="pill warn"; return; }
    if(!last){ p.textContent=t("sy_ready"); p.className="pill"; return; }
    p.textContent=t("sy_last")+" "+fmtWhen(last); p.className="pill ok";
  }

  /* Two counts, kept apart on purpose. opens is what answered a message you sent; views is
     every time the page was looked at. A page can be read before anybody was written to, and
     the board says so rather than promoting it into a lane it did not earn. */
  async function build(){
    const opps=await mergedOpps();
    const opens={}, views={};
    opps.forEach(o=>{ opens[o.slug]=outreachOpens(o); views[o.slug]=opensForSlug(o.slug); });
    return ThriveBoard.build(opps, { opens:opens, views:views, mail:getMailLog() });
  }

  function tokenHtml(tk){
    const cls=["tok"];
    if(tk.stalled) cls.push("is-stalled");
    if(tk.hot) cls.push("is-hot");
    if(tk.provisional) cls.push("is-provisional");
    // The meta line stays in the paragraph direction so the words read correctly; only the
    // digits inside it are isolated, by .n, never the whole line.
    let meta;
    if(tk.lane==="draft") meta=txt("tok_nopage");
    else if(tk.lane==="live") meta = tk.views>0
      // Read, but by somebody who was never written to. Real information, and not an open.
      ? txt("tok_views", tk.views).replace(String(tk.views), num(tk.views))
      : txt("tok_noemail");
    else if(tk.lane==="replied") meta=txt("tok_answered");
    else if(tk.opens>0) meta=txt("tok_opens", tk.opens).replace(String(tk.opens), num(tk.opens));
    else meta=txt("tok_idle", tk.age).replace(String(tk.age), num(tk.age));
    /* The card is a row now, not a single button: the label opens the window, the grip picks it
       up, and the overflow control is the path that needs no dragging at all. */
    /* WO-015 §6: one quiet chapter marker per card, on the cards where a chapter is
       actually in play (a contacted card), so a chapter two offer sitting in Sent
       is told apart from a first contact sitting in Sent. Not a second lane, not a
       badge cluster: one short phrase. A draft or a live card has no contact yet,
       so it carries no marker. */
    const contacted = (tk.lane==="sent"||tk.lane==="opened"||tk.lane==="replied");
    const aCh = contacted ? activeChapter(tk.slug) : 0;
    const chMark = aCh>=1
      ? '<span class="tok-chapter'+(aCh>=2?" is-offer":"")+'">'+esc(t(aCh>=2?"th_ch_offer":"th_ch_first"))+'</span>'
      : '';
    return '<div class="tok '+cls.slice(1).join(" ")+'" data-slug="'+esc(tk.slug)+'" data-lane="'+esc(tk.lane)+'">'+
      '<button class="tok-open" type="button">'+
        '<span class="tok-name">'+(tk.offer? ic("spark",13) : "")+esc(tk.biz)+'</span>'+
        '<span class="tok-meta">'+meta+chMark+'</span>'+
      '</button>'+
      '<button class="tok-more" type="button" aria-haspopup="menu" aria-label="'+esc(t("mv_menu"))+'">'+ic("chevron")+'</button>'+
      '<span class="tok-grip" aria-hidden="true">'+ic("drag")+'</span>'+
      '</div>';
  }

  /* FLIP: a token never teleports between lanes.
     First, record where every token is. Last, let the render put it where it belongs. Invert,
     put it back visually with a transform and no transition. Play, clear the transform on the
     next frame. Only transform moves, the raise is dropped on transitionend so nothing keeps
     a permanent will-change, and a reader who asked for less motion gets none of it. */
  function firstRects(){
    const m={};
    document.querySelectorAll(".tok[data-slug]").forEach(el=>{ m[el.getAttribute("data-slug")]=el.getBoundingClientRect(); });
    return m;
  }
  function playFlip(first){
    if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll(".tok[data-slug]").forEach(el=>{
      const was=first[el.getAttribute("data-slug")];
      if(!was) return;                                   // it is new: the entrance stagger owns it
      const now=el.getBoundingClientRect();
      const dx=was.left-now.left, dy=was.top-now.top;
      if(Math.abs(dx)<1 && Math.abs(dy)<1) return;       // it did not move
      el.classList.remove("enter","enter-1","enter-2","enter-3");
      el.style.transition="none";
      el.style.transform="translate("+dx+"px,"+dy+"px)";
      el.classList.add("is-moving");
      requestAnimationFrame(()=>{
        el.style.transition="transform var(--t-base) var(--e-standard)";
        el.style.transform="";
        const done=()=>{ el.classList.remove("is-moving"); el.style.transition=""; el.removeEventListener("transitionend",done); };
        el.addEventListener("transitionend", done);
        setTimeout(done, 600);                            // a transition that never fires must not strand the raise
      });
    });
  }

  async function render(){
    syncPill();
    const first=firstRects();
    const b=await build();

    ThriveBoard.LANES.forEach(k=>{
      const body=document.querySelector('[data-body="'+k+'"]');
      const count=document.querySelector('[data-count="'+k+'"]');
      if(count) count.textContent=b.lanes[k].length;
      const tabCount=document.querySelector('[data-count-tab="'+k+'"]');
      if(tabCount) tabCount.textContent=b.lanes[k].length;
      if(!body) return;
      /* The order somebody arranged on this device, applied on top of the lane's own sort.
         Anything not in the stored order keeps its place after the ones that are. */
      const ord=(cardOrder()[k]||[]);
      if(ord.length) b.lanes[k].sort((x,y)=>{
        const i=ord.indexOf(x.slug), j=ord.indexOf(y.slug);
        if(i<0 && j<0) return 0;
        if(i<0) return 1;
        if(j<0) return -1;
        return i-j;
      });
      body.innerHTML = b.lanes[k].length
        /* T4: a card in an actionable lane (a reply just in, or ready to send) carries
           the glow. glowChanged is called for every card in every lane so a later move
           INTO replied or live is seen as a change and plays one cycle; other lanes just
           record the card's position and show no glow. It reads the lane the causal
           status put the card in, so it marks a fact, not a guess. */
        ? b.lanes[k].map((tk,i)=>{
            const gnew=glowChanged("card:"+tk.slug, k);
            // replied is a standing call to action, a reply waiting for you: a resting accent, and
            // one cycle when it arrives. live (ready to send) is a moment: one cycle when it becomes
            // ready, then rest, because ready cards are many and a field of rings is the failure the
            // rule forbids. Both read the lane the causal status put the card in, so it marks a fact.
            let gcls="";
            if(k==="replied") gcls="is-glow "+(gnew?"is-glow-new ":"");
            else if(k==="live" && gnew) gcls="is-glow-new ";
            const enter=i<3 ? "enter enter-"+(i+1)+" " : "";
            return tokenHtml(tk).replace('class="tok ', 'class="tok '+enter+gcls);
          }).join("")
        /* Law 4: an icon, a sentence, and at most one action. A bare sentence in
           the middle of a field is the shrug this law exists to stop. */
        : '<div class="lane-empty">'+ic("spark",18)+'<p>'+esc(t("lane_"+k+"_empty"))+'</p></div>';
    });

    // Status tab bar: wire the taps once, then sync the active column every render (counts changed,
    // choice preserved). Default to the first column that holds a card so the operator lands on work.
    const tabsEl=document.getElementById("boardTabs");
    if(tabsEl && !tabsEl.dataset.wired){
      tabsEl.dataset.wired="1";
      tabsEl.addEventListener("click", e=>{ const btn=e.target.closest(".btab"); if(btn) setActiveTab(btn.getAttribute("data-tab"), true); });
    }
    if(!activeTab || ThriveBoard.LANES.indexOf(activeTab)<0)
      activeTab = ThriveBoard.LANES.find(k=>b.lanes[k].length) || ThriveBoard.LANES[0];
    setActiveTab(activeTab, false);

    // Direction A: one sentence, one accented number, read once. The giant duplicate figure is
    // gone. v.n is the single value ThriveBoard.verdict derived from b.summary.counts; the same
    // counts feed the pipeline strip below, so the headline number and its stage chip are one
    // value from one source, never a second figure.
    const v=ThriveBoard.verdict(b);
    const vLine=txt(v.key, v.n).replace(String(v.n), num(v.n));
    const vNew=glowChanged("counter", v.key+":"+v.n) ? " is-glow-new" : "";
    el("boardVerdict").innerHTML = '<span class="vtext'+vNew+'">'+vLine+'</span>';
    el("boardVerdictSub").innerHTML = b.summary.stalled
      ? txt("vd_sub_stalled", ThriveBoard.STALL_DAYS).replace(String(ThriveBoard.STALL_DAYS), num(ThriveBoard.STALL_DAYS))
      : txt("vd_sub_none");

    // The rose badge icon reflects the verdict, and the pipeline lights the stage the headline is
    // about. One accent (the dusty rose) across the badge, the number, and the lit chip.
    const VMAP={ vd_replied:{icon:"channel",lane:"replied"}, vd_opened:{icon:"eye",lane:"opened"},
      vd_stalled:{icon:"clock",lane:""}, vd_live:{icon:"send",lane:"live"},
      vd_quiet:{icon:"spark",lane:""}, vd_empty:{icon:"spark",lane:""} };
    const vm=VMAP[v.key]||VMAP.vd_quiet;
    if(el("boardBadge")) el("boardBadge").innerHTML=ic(vm.icon, 20);
    const PL=[["draft","lane_draft"],["live","lane_live"],["sent","lane_sent"],["opened","lane_opened"],["replied","lane_replied"]];
    el("boardPipeline").innerHTML = PL.map(([k,lbl])=>
      '<span class="plchip'+(k===vm.lane?" is-live":"")+'"><span class="pl-l">'+esc(t(lbl))+'</span>'+
      '<span class="pl-n">'+b.summary.counts[k]+'</span></span>').join("");

    // Every number here is also an action.
    const q=quotaUsage(), left=Math.max(0, q.dailyCap-q.day);
    const chips=[];
    if(b.summary.stalled) chips.push('<button class="chip warn" data-chip="stalled">'+
      txt("chip_stalled", b.summary.stalled, {d:ThriveBoard.STALL_DAYS})+' <b>'+b.summary.stalled+'</b></button>');
    chips.push('<button class="chip" data-chip="sends">'+txt("chip_sends", left)+' <b>'+left+'</b></button>');
    if(b.archived) chips.push('<button class="chip" data-chip="archived">'+txt("chip_archived")+' <b>'+b.archived+'</b></button>');
    el("boardChips").innerHTML=chips.join("");
    el("boardChips").querySelectorAll("[data-chip]").forEach(c=>c.addEventListener("click",()=>{
      const k=c.getAttribute("data-chip");
      if(k==="stalled") goTo("library","followup=1");
      else if(k==="archived") goTo("library","status=archived");
      else goTo("compose");
    }));

    const closed=b.closed.won.concat(b.closed.lost);
    el("trayCount").textContent=closed.length;
    el("trayList").innerHTML = closed.length
      ? b.closed.won.map(o=>'<span class="tray-item won">'+esc(o.business||o.slug)+'</span>').join("")+
        b.closed.lost.map(o=>'<span class="tray-item lost">'+esc(o.business||o.slug)+'</span>').join("")
      : '<div class="lane-empty">'+ic("archive",18)+'<p>'+esc(t("tray_empty"))+'</p></div>';

    const empty=b.summary.total===0 && closed.length===0;
    el("boardEmpty").hidden=!empty;
    el("boardLanes").hidden=empty;
    if(el("boardTabs")) el("boardTabs").hidden=empty;
    if(el("boardPipeline")) el("boardPipeline").hidden=empty;   // all zeros is noise on an empty board
    el("boardChips").hidden=empty;
    el("boardTray").hidden=empty;

    // A token opens the whole opportunity: what it is, its text, its page, its outreach, and
    // what has happened to it.
    playFlip(first);

    document.querySelectorAll(".tok-open").forEach(btn=>btn.addEventListener("click",()=>{
      const tk=btn.closest(".tok");
      const slug=tk.getAttribute("data-slug");
      const name=(tk.querySelector(".tok-name")||{}).textContent||slug;
      // In the shell the work opens in one centred window. On a single page there is no
      // window, and an honest page change beats a panel that is not there.
      if(window.thriveModal) window.thriveModal.open(slug, "overview", name);
      else goTo("compose","slug="+encodeURIComponent(slug));
    }));
  }

  // The tray is a posture, not a decision, so it stays on this device and never syncs.
  const BOARD_PREF="thrive_board_v1";
  function pref(){ try{ return JSON.parse(localStorage.getItem(BOARD_PREF)||"{}"); }catch(e){ return {}; } }
  function setPref(p){ try{ localStorage.setItem(BOARD_PREF, JSON.stringify(p)); }catch(e){} }
  const tray=el("trayToggle"), trayBody=el("trayBody");
  function applyTray(open){
    tray.setAttribute("aria-expanded", open?"true":"false");
    trayBody.hidden=!open;
    tray.querySelector(".tray-chev").style.transform = open? "rotate(180deg)" : "";
  }
  applyTray(!!pref().trayOpen);
  tray.addEventListener("click",()=>{
    const open=tray.getAttribute("aria-expanded")!=="true";
    applyTray(open); const p=pref(); p.trayOpen=open; setPref(p);
  });

  if(el("boardRefresh")) el("boardRefresh").addEventListener("click", async ()=>{
    try{ await fetchRemoteHits(); }catch(e){}
    try{ await syncNow(); }catch(e){}
    render();
  });
  onThrive("lang","board",render);
  onThrive("sync","board",render);
  onThrive("unlock","board",render);
  /* One way back to a fresh board. A lifecycle move changes what the lanes should say, and
     without this the board kept showing what was true before the click: the record was right,
     the model was right, and the screen was wrong, which is the worst of the three. */
  window.thriveBoardRefresh=render;
  initIntake();
  renderSyncBand();
  refreshRollup();
  initCardMenu();
  initCardDrag();
  await render();
}

/* ---------- two language axes, and they never touch ----------
   ui_lang drives the console chrome: navigation, labels, buttons, empty states. It is the
   existing thrive_lang and nothing about it changes.

   doc_lang is a property of the OPPORTUNITY. It drives the page template, the outreach text,
   the message templates offered, and the direction of the built page. Thyab can work in Arabic
   chrome on an English opportunity and nothing about the document changes.

   Conflating the two is why the English composer offered «التحديث الشهري» beside Monthly update
   in one row. That was never a translation problem. It was one variable doing two jobs.

   Nothing is renamed. `locale` is added beside the page template's existing `lang`, which keeps
   working, and doc_lang is added to the opportunity. Both are additive. */
const LOCALES=["EN","AR"];
function isArabicText(s){ return /[\u0600-\u06FF]/.test(String(s||"")); }
/* Detection, used to PROPOSE a locale and never to assign one silently. A template whose
   content is Arabic is almost certainly Arabic, but "almost certainly" is not a decision
   somebody made, so the migration shows what it found and asks. */
function detectLocale(o){
  if(!o) return "EN";
  const hay=[o.name, o.subject, o.html, o.body].filter(Boolean).join(" ");
  return isArabicText(hay) ? "AR" : "EN";
}
function localeOf(tpl){
  if(!tpl) return "";
  const v=(tpl.locale || tpl.lang || "").toUpperCase();
  return LOCALES.indexOf(v)>=0 ? v : "";
}
/* The opportunity's own language. Explicit if it has one, otherwise inferred from the page
   template it was built on, otherwise from its own words. Never from the chrome. */
function docLang(o){
  if(!o) return "EN";
  const v=(o.doc_lang||"").toUpperCase();
  if(LOCALES.indexOf(v)>=0) return v;
  const tp=getCustomTemplate&&getCustomTemplate(o.template);
  const fromTpl=localeOf(tp) || localeOf((typeof APPROVED_TEMPLATES!=="undefined"?APPROVED_TEMPLATES:[]).find(x=>x.id===o.template));
  if(fromTpl) return fromTpl;
  return isArabicText([o.business,o.outreach_text,o.html].filter(Boolean).join(" ")) ? "AR" : "EN";
}
function dirOf(locale){ return locale==="AR" ? "rtl" : "ltr"; }
/* Templates of one kind, in one locale. A template with no locale is not shown in either tab:
   it appears in the migration instead, which is the only place it can be given one. */
function localeTemplates(list, loc){ return (list||[]).filter(x=>localeOf(x)===loc); }
function unlocalised(list){ return (list||[]).filter(x=>!localeOf(x)); }


/* ---------- the two libraries ----------
   Two tabs, English and Arabic, and no combined view. A template belongs to exactly one
   document language, and a shelf that mixes them is a shelf you have to read before you can
   use it.

   A template with no locale appears in NEITHER tab. It appears in the migration, which is the
   only place a locale can be given, and the migration proposes rather than assigns: it shows
   what it read and asks. Assigning silently would put somebody's Arabic template in the
   English library and there would be no trace of the decision. */
/* It starts on the library the reader is already in. A hard "EN" meant an Arabic reader opened
   Templates on the English library, tapped "Compose with", and landed in a composer whose
   drop-down holds only Arabic templates, so the template they asked for was silently not
   selected. Two surfaces choosing a locale by two different rules is the leak WO-012 §7 opens
   with, and this was the same leak one layer up. Read once, lazily, because the language is
   settled by the time any list draws and not necessarily when this file is evaluated. */
let __localeTab=null;
function localeTab(){
  if(__localeTab===null){ try{ __localeTab = getLang()==="ar" ? "AR" : "EN"; }catch(e){ __localeTab="EN"; } }
  return __localeTab;
}
function setLocaleTab(L){
  __localeTab=L;
  /* Both libraries share the tab, so both redraw. One list obeying the tab while the other
     ignores it is worse than no tab at all: it teaches you that the control is unreliable. */
  if(typeof window.__renderPageTpls==="function") window.__renderPageTpls();
  if(typeof window.__renderMsgTpls==="function") window.__renderMsgTpls();
}
function localeTabBar(id){
  return '<div class="seg loc-tabs" role="tablist" id="'+id+'">'+
    LOCALES.map(L=>'<button role="tab" data-loc="'+L+'" class="'+(L===localeTab()?"on":"")+'" '+
      'aria-selected="'+(L===localeTab()?"true":"false")+'">'+esc(t("loc_"+L.toLowerCase()))+'</button>').join("")+
    '</div>';
}
function localeEmpty(L, n){
  const count='<span class="loc-count">'+
    esc(boardText(getLang(),"loc_count",n)).split(String(n)).join('<span class="n">'+n+'</span>')+
    ' '+esc(t("loc_counter"))+'</span>';
  if(n) return count;
  return '<div class="mw-empty">'+
    (typeof thriveIcon==="function"? thriveIcon("page",{size:32,cls:"mw-empty-i"}) : "")+
    '<p>'+esc(t(L==="AR"?"loc_empty_ar":"loc_empty_en"))+'</p></div>'+count;
}
/* The migration. Detect, then ask, one row per template, nothing written until confirmed. */
function migrationPanel(){
  const pages=unlocalised(getCustomTemplates()), msgs=unlocalised(getEmailTemplates());
  if(!pages.length && !msgs.length) return "";
  const row=(x,kind)=>{
    const d=detectLocale(x);
    return '<div class="loc-mig-row"><span class="loc-mig-name">'+esc(x.name||x.id)+'</span>'+
      '<span class="loc-mig-kind">'+esc(t(kind==="page"?"f_template":"cmp_template"))+'</span>'+
      '<span class="loc-mig-read">'+esc(t("loc_mig_detected"))+' <b>'+esc(t("loc_"+d.toLowerCase()))+'</b></span>'+
      '<select class="loc-mig-sel" data-kind="'+kind+'" data-id="'+esc(x.id)+'">'+
      LOCALES.map(L=>'<option value="'+L+'"'+(L===d?" selected":"")+'>'+esc(t("loc_"+L.toLowerCase()))+'</option>').join("")+
      '</select></div>';
  };
  return '<section class="loc-mig"><h4 class="mw-h">'+esc(t("loc_mig_h"))+'</h4>'+
    '<p class="mw-note">'+esc(t("loc_mig_sub"))+'</p>'+
    pages.map(x=>row(x,"page")).join("")+msgs.map(x=>row(x,"msg")).join("")+
    '<button class="btn sm loc-mig-save" type="button">'+esc(t("loc_mig_save"))+'</button></section>';
}
function bindMigration(scope, after){
  const b=scope.querySelector(".loc-mig-save"); if(!b) return;
  b.addEventListener("click",()=>{
    scope.querySelectorAll(".loc-mig-sel").forEach(sel=>{
      const id=sel.getAttribute("data-id"), L=sel.value;
      if(sel.getAttribute("data-kind")==="page") saveCustomTemplate({ id:id, locale:L, lang:L });
      else saveEmailTemplate({ id:id, locale:L });
    });
    logActivity("loc_migrate","", "");
    try{ scheduleSyncPush(); }catch(e){}
    toast(t("loc_mig_done"));
    if(after) after();
  });
}
/* ---------- storage survival ----------
   WebKit deletes ALL script writeable storage for an origin with no user interaction in the
   last seven days of browser use. Not part of it. All of it, at once.

   The console's entire data layer is localStorage on an iPad. So one quiet week away can erase
   every opportunity, every draft and the whole mail ledger on that device, and nothing about it
   is a bug anybody could have found by testing. The relay is the only durable copy, and until
   now nothing checked that it actually held one.

   Three things, in order of how much they matter:
     the band, which fires at three days rather than seven so it lands before the window closes;
     the completeness check, because a backup nobody has verified is a belief;
     the meter, so "what is using the space" has an answer before the space runs out. */

const SYNC_STALE_DAYS=3;
function daysSinceSync(){
  const last=syncLast();
  if(!last) return Infinity;
  const ms=Date.parse(last);
  if(isNaN(ms)) return Infinity;
  return Math.floor((Date.now()-ms)/86400000);
}
/* The band sits on the board, above the lanes, and it is not dismissable. A warning you can
   dismiss is a warning you dismiss on the day you are busiest, which is the day it matters. */
function renderSyncBand(){
  const host=document.getElementById("boardBand");
  if(!host) return;
  if(!getSyncEndpoint()){ host.hidden=true; host.innerHTML=""; return; }
  const n=daysSinceSync();
  if(n < SYNC_STALE_DAYS){ host.hidden=true; host.innerHTML=""; return; }
  const line = (n===Infinity)
    ? esc(t("st_never"))
    : esc(boardText(getLang(),"st_stale_n",n)).split(String(n)).join('<span class="n">'+n+'</span>');
  host.hidden=false;
  host.innerHTML='<div class="mw-band"><span class="mw-band-i" aria-hidden="true">!</span>'+
    '<div><b>'+esc(t("st_stale_h"))+'</b><span>'+line+' '+esc(t("st_stale_p"))+'</span></div>'+
    '<button class="btn sm" id="bandSync" type="button">'+esc(t("st_sync_now"))+'</button></div>';
  const b=document.getElementById("bandSync");
  if(b) b.addEventListener("click", async ()=>{
    b.disabled=true;
    try{ await syncNow(); }catch(e){}
    b.disabled=false;
    renderSyncBand();
  });
}

/* Does the relay actually hold what this device holds? Counts per key, compared, and any
   difference reported rather than summarised into a reassuring sentence. */
async function relayCompleteness(){
  const ep=getSyncEndpoint();
  if(!ep) return { ok:false, reason:"no_endpoint" };
  let remote=null;
  try{
    const r=await fetchT(ep, { method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({ op:"state_get", auth:syncAuth() }) });
    const j=await r.json();
    if(!j || j.ok===false) return { ok:false, reason:"relay_error" };
    /* The relay is handed an object and hands one back, but a relay of a different vintage,
       or a device that stored the blob as text, returns a string. Both are read, because a
       check that only works against one shape is a check that reports a problem that is not
       there. This one could only ever fail before: JSON.parse of an object throws. */
    remote = (typeof j.data === "string") ? JSON.parse(j.data) : (j.data || null);
  }catch(e){ return { ok:false, reason:"unreachable", detail:String(e&&e.message||e) }; }
  if(!remote) return { ok:false, reason:"empty" };

  const count=(v)=>{ try{ const p=typeof v==="string"? JSON.parse(v):v; return Array.isArray(p)? p.length : (p&&typeof p==="object"? Object.keys(p).length : 0); }catch(e){ return 0; } };
  const rows=[];
  Object.keys(SYNCED_KEYS).forEach(k=>{
    const mine=count(localStorage.getItem(k));
    const theirs=count(remote[k]);
    if(mine || theirs) rows.push({ key:k, mine:mine, theirs:theirs, short:Math.max(0, mine-theirs) });
  });
  const missing=rows.filter(r=>r.short>0);
  return { ok:true, rows:rows, missing:missing, complete:missing.length===0 };
}

function renderStorageMeter(){
  const host=document.getElementById("stMeter");
  if(!host) return;
  const s=storageBytes();
  const mb=(n)=>(n/1048576).toFixed(2);
  const pct=Math.min(100, Math.round((s.total/STORAGE_CEILING)*100));
  host.innerHTML=
    '<div class="st-bar"><span style="width:'+pct+'%"></span></div>'+
    '<p class="st-line"><b>'+esc(t("st_used"))+'</b> <span class="n">'+mb(s.total)+'</span> MiB '+
      esc(t("st_of"))+' <span class="n">5</span> MiB (<span class="n">'+pct+'</span>%)</p>'+
    '<p class="st-line"><b>'+esc(t("st_largest"))+'</b></p>'+
    '<ul class="st-keys">'+s.top.map(x=>'<li><span class="mono-iso">'+esc(x.key)+'</span>'+
      '<span class="n">'+mb(x.bytes)+'</span> MiB</li>').join("")+'</ul>'+
    '<button class="btn ghost sm" id="stCheck" type="button">'+esc(t("st_check"))+'</button>'+
    '<div id="stCheckOut" class="st-line"></div>';
  const b=document.getElementById("stCheck");
  if(b) b.addEventListener("click", async ()=>{
    const out=document.getElementById("stCheckOut");
    out.textContent=t("st_checking");
    const r=await relayCompleteness();
    if(!r.ok){ out.textContent=t(r.reason==="no_endpoint"? "sy_need_ep" : "st_cmp_err"); return; }
    if(r.complete){ out.textContent=t("st_complete"); return; }
    out.innerHTML='<b class="st-miss">'+esc(t("st_missing"))+'</b><ul class="st-keys">'+
      r.missing.map(x=>'<li><span class="mono-iso">'+esc(x.key)+'</span>'+
        '<span class="n">'+x.theirs+'</span> / <span class="n">'+x.mine+'</span></li>').join("")+'</ul>';
  });
}

/* ---------- the replies panel ----------
   Three questions on one screen, because they fail together: is the relay
   watching, what could it not attribute, and is there room in the store for what
   it finds. A full store is the reason a reply would silently fail to arrive, so
   measuring it belongs beside the thing it would break. */
async function relayOp(op, body){
  const ep=getSyncEndpoint(), auth=syncAuth();
  if(!ep) return { ok:false, error:"no_endpoint" };
  if(!auth) return { ok:false, error:"no_auth" };
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify(Object.assign({ op:op, auth:auth }, body||{})) }, 30000);
    const txt=await r.text();
    try{ return JSON.parse(txt); }catch(e){ return { ok:false, error:txt.slice(0,120) }; }
  }catch(e){ return { ok:false, error:String((e&&e.message)||e) }; }
}

function renderRepliesPanel(){
  const host=document.getElementById("rpPanel");
  if(!host) return;
  const all=getInbound();
  const real=all.filter(r=>r && r.kind!=="auto");
  const unmatched=inboundUnmatched();
  const scan=inboxScanInfo();
  const when=ts=>{ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",
    {dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts||""; } };

  let h='<p class="st-line"><b>'+esc(t("rp_have"))+'</b> <span class="n">'+real.length+'</span> '+
        esc(t("rp_of_which"))+' <span class="n">'+unmatched.length+'</span> '+esc(t("rp_unmatched_n"))+'</p>';
  h+= scan
    ? '<p class="st-line">'+esc(t("rp_last_scan"))+' '+ltr(when(scan.ts))+
      ' · <span class="n">'+(scan.ms||0)+'</span> ms</p>'
    : '<p class="st-line st-miss">'+esc(t("rp_never_scanned"))+'</p>';

  /* Named, never counted. A reply nobody could attribute is the one most likely
     to matter, because it is the one nobody is expecting. */
  if(unmatched.length){
    h+='<p class="st-line"><b class="st-miss">'+esc(t("rp_unmatched_h"))+'</b></p><ul class="st-keys">'+
      unmatched.slice(0,10).map(r=>'<li><span class="mono-iso">'+ltr(esc(r.from))+'</span>'+
        '<span>'+esc((r.subject||"").slice(0,60))+'</span></li>').join("")+'</ul>';
  }

  h+='<div class="bar">'+
     '<button class="btn ghost sm" id="rpStore" type="button">'+esc(t("rp_store_btn"))+'</button>'+
     '<button class="btn ghost sm" id="rpScan" type="button">'+esc(t("rp_scan_btn"))+'</button>'+
     '<button class="btn ghost sm" id="rpRepair" type="button">'+esc(t("rp_repair_btn"))+'</button>'+
     '</div><div id="rpOut" class="st-line"></div>';
  host.innerHTML=h;

  const out=()=>document.getElementById("rpOut");
  const busy=k=>{ const o=out(); if(o) o.textContent=t(k); };

  /* §10.1: report the real number before changing anything. The health panel had
     been saying "the relay is out of Script properties space" with no number
     behind it, and a warning nobody can measure is a warning nobody acts on. */
  const sb=document.getElementById("rpStore");
  if(sb) sb.addEventListener("click", async ()=>{
    busy("rp_working");
    const r=await relayOp("store_stats");
    const o=out(); if(!o) return;
    if(!r.ok){ o.textContent=t("rp_store_old")+" "+(r.error||""); return; }
    const p=r.properties||{}, d=r.drive||{};
    o.innerHTML='<p class="st-line"><b>'+esc(t("rp_props"))+'</b> <span class="n">'+
      Math.round((p.bytes||0)/1024)+'</span> KB '+esc(t("st_of"))+' <span class="n">500</span> KB'+
      ' (<span class="n">'+(p.pct||0)+'</span>%) · <span class="n">'+(p.keys||0)+'</span> '+esc(t("rp_keys"))+'</p>'+
      '<p class="st-line"><b>'+esc(t("rp_drive"))+'</b> <span class="n">'+
      Math.round((d.bytes||0)/1024)+'</span> KB · '+esc(r.migrated? t("rp_migrated") : t("rp_not_migrated"))+'</p>'+
      '<ul class="st-keys">'+(p.largest||[]).map(x=>'<li><span class="mono-iso">'+esc(x.key)+
      '</span><span class="n">'+Math.round(x.bytes/1024)+'</span> KB</li>').join("")+'</ul>';
  });

  const nb=document.getElementById("rpScan");
  if(nb) nb.addEventListener("click", async ()=>{
    busy("rp_working");
    const r=await relayOp("inbox_scan");
    const o=out(); if(!o) return;
    if(!r.ok){ o.textContent=t("rp_store_old")+" "+(r.error||""); return; }
    await syncNow();
    o.textContent=boardText(getLang(),"rp_scanned", r.added||0);
    renderRepliesPanel();
  });

  /* The repair pass reports before it writes. An action that walks 90 days of a
     person's inbox and changes the board is an action they get to see the size
     of first. */
  const rb=document.getElementById("rpRepair");
  if(rb) rb.addEventListener("click", async ()=>{
    busy("rp_working");
    const dry=await relayOp("inbox_repair", { days:90, dryRun:true });
    const o=out(); if(!o) return;
    if(!dry.ok){ o.textContent=t("rp_store_old")+" "+(dry.error||""); return; }
    const by=dry.byRule||{};
    /* The breakdown is one phrase carrying five numbers, so it is assembled here
       and passed in as an extra. Inflecting on five counts at once is not a thing
       any language does; the sentence inflects on the one count it is about. */
    const breakdown=t("rp_repair_by")
      .replace("{tag}", String(by.tag||0))
      .replace("{thread}", String(by.thread||0))
      .replace("{sender}", String(by.sender||0))
      .replace("{none}", String(by.none||0))
      .replace("{auto}", String(dry.auto||0));
    const msg=boardText(getLang(),"rp_repair_found", dry.count||0, { breakdown:breakdown });
    o.textContent=msg;
    if(!dry.count){ return; }
    if(!confirm(msg+"\n\n"+t("rp_repair_confirm"))) return;
    busy("rp_working");
    const real=await relayOp("inbox_repair", { days:90, dryRun:false });
    if(!real.ok){ const o2=out(); if(o2) o2.textContent=t("rp_store_old")+" "+(real.error||""); return; }
    await syncNow();
    const o3=out(); if(o3) o3.textContent=boardText(getLang(),"rp_repaired", real.count||0);
    renderRepliesPanel();
  });
}

/* ---------- the reputation panel ----------
   The published playbook for outbound in 2026 is three to eight sending domains,
   warmed over weeks, a sequencer, and volume scaled while placement is defended.
   That playbook solves a problem Thrive does not have and would destroy the
   thing Thrive is good at: three sends a day, each with a page built for one
   named business.

   So the console's job is the opposite of the playbook's. Not raising volume
   safely, but making low volume compound: never send to a suppressed address,
   never send with an unresolved placeholder, and make the numbers visible so a
   slow leak is caught while it is still slow. WO-013 §10.6. */
async function renderReputation(){
  const host=document.getElementById("repPanel");
  if(!host) return;
  const r=ThriveStore.reputation({ mail:getMailLog(), month:ThriveNumbers.localMonth() });
  const u=ThriveStore.usage();
  const pct=n=>'<span class="n">'+n+'</span>%';
  host.innerHTML=
    '<p class="rep-verdict rep-'+esc(r.verdict.replace("rep_",""))+'">'+
      ic(r.verdict==="rep_healthy"?"check":"alert")+esc(t(r.verdict))+'</p>'+
    '<ul class="st-keys">'+
      '<li><span>'+esc(t("rep_sent"))+'</span><span class="n">'+r.sent+'</span></li>'+
      '<li><span>'+esc(t("rep_hard"))+'</span><span>'+pct(r.hardRate)+' ('+r.hardBounces+')</span></li>'+
      '<li><span>'+esc(t("rep_complaints"))+'</span><span>'+pct(r.complaintRate)+' ('+r.complaints+')</span></li>'+
      '<li><span>'+esc(t("rep_suppressed"))+'</span><span class="n">'+r.suppressed+'</span></li>'+
    '</ul>'+
    '<p class="st-line">'+esc(t("rep_guidance"))+'</p>'+
    /* §10.4: the usage is measured and the threshold is recorded, and the
       migration is deliberately not built. */
    '<p class="st-line"><b>'+esc(t("rep_storage"))+'</b> <span class="n">'+
      (u.bytes/1048576).toFixed(2)+'</span> MiB · '+
      esc(u.shouldMigrate? t("rep_migrate_now") : t("rep_migrate_not"))+'</p>'+
    '<div class="bar"><button class="btn ghost sm" type="button" id="repRelay">'+
      esc(t("rep_relay_btn"))+'</button></div><div id="repOut" class="st-line"></div>';

  const b=document.getElementById("repRelay");
  if(b) b.addEventListener("click", async ()=>{
    const out=document.getElementById("repOut");
    if(out) out.textContent=t("rp_working");
    const j=await relayOp("send_stats");
    if(!out) return;
    if(!j.ok){ out.textContent=t("rp_store_old")+" "+(j.error||""); return; }
    /* The cap is read from the relay, never hardcoded, so moving to Workspace is
       a configuration change and not a code change. And the tier is shown,
       because the person reading 100 should know whether that is a product
       decision or an account limit. */
    const sc=j.scan||{}, sd=j.send||{};
    out.innerHTML='<p class="st-line">'+esc(t("rep_tier"))+' <b>'+esc(sd.tier||"")+'</b> · '+
      esc(t("rep_cap"))+' <span class="n">'+(sd.cap||0)+'</span> '+esc(t("rep_recipients"))+
      ' · '+esc(t("rep_left"))+' <span class="n">'+(sd.remainingToday||0)+'</span></p>'+
      '<p class="st-line'+(sc.overBudget?" st-miss":"")+'">'+esc(t("rep_trigger"))+' <span class="n">'+
      (sc.dailyMinutes||0)+'</span> / <span class="n">'+(sc.budgetMinutes||0)+'</span> '+
      esc(t("rep_minutes"))+(sc.overBudget? " · "+esc(t("rep_over")) : "")+'</p>';
  });
}

/* ---------- the monthly rollup ----------
   Written when a month closes and never again, because the log it would be recounted from may
   since have lost its head and the smaller answer would silently replace the true one. */
const ROLLUP="thrive_rollup_v1";
function getRollup(){ try{ return JSON.parse(localStorage.getItem(ROLLUP)||"{}"); }catch(e){ return {}; } }
function setRollup(o){ return lsSet(ROLLUP, JSON.stringify(o)); }
async function refreshRollup(){
  if(typeof ThriveNumbers==="undefined") return;
  const opps=await mergedOpps();
  const next=ThriveNumbers.buildRollup({ mail:getMailLog(), opps:opps, month:ThriveNumbers.localMonth() }, getRollup());
  if(JSON.stringify(next)!==JSON.stringify(getRollup())) setRollup(next);
}

/* The one context every number is computed from, assembled in one place so no surface has to
   remember which ledgers a quantity needs. */
async function numberCtx(){
  const opps=await mergedOpps();
  return { mail:getMailLog(), hits:allHits({self:true}), opps:opps,
           activity:getActivity(), rollup:getRollup(), inbound:getInbound(),
           today:ThriveNumbers.localDay(), month:ThriveNumbers.localMonth() };
}

/* ---------- moving a card ----------
   WCAG 2.2 Success Criterion 2.5.7: any function that uses dragging must also be operable with
   a single pointer without dragging, unless dragging is essential. It is not essential here.

   So the menu is built first and the drag is built on top of it, in that order, because a
   non-drag path added at the end is a non-drag path that gets cut when the phase runs long.
   Everything below goes through one function, applyDrop, so the menu, the drag and the
   keyboard cannot disagree about what a move means.

   A drop does not set a lane. It performs the MOVE from the lifecycle table that corresponds to
   the destination, with its guards. Dropping on Sent opens the off channel dialogue rather than
   silently marking a send, because a send is an event that happened in the world and the
   console must not invent one. */

/* Manual order is a posture, not a decision, so it stays on this device and never syncs.
   WO-012 §5.2 is explicit about that, and it is right: an order that follows you between
   devices is an order you did not ask for on the second one. */
const CARD_ORDER="thrive_card_order_v1";
function cardOrder(){ try{ return JSON.parse(localStorage.getItem(CARD_ORDER)||"{}"); }catch(e){ return {}; } }
function setCardOrder(o){ try{ localStorage.setItem(CARD_ORDER, JSON.stringify(o)); }catch(e){} }
function orderLane(lane, slugs){ const o=cardOrder(); o[lane]=slugs.slice(); setCardOrder(o); }

/* Which lifecycle move a destination lane corresponds to. A lane is not a state you set; it is
   a state you reach, and this is the mapping between the two. */
function moveForLane(from, to){
  if(to==="sent")    return "send_offchannel";
  if(to==="replied") return "record_reply";
  if(to==="draft")   return "unpublish";
  if(to==="live")    return "publish";
  return "";
}

function laneLabel(k){ return t("lane_"+k); }

/* One announcer for the whole board. Assistive technology needs to be told what happened,
   and it needs to be told once. */
function announce(msg){
  let el=document.getElementById("boardLive");
  if(!el){
    el=document.createElement("div");
    el.id="boardLive"; el.className="sr-only";
    el.setAttribute("aria-live","polite"); el.setAttribute("aria-atomic","true");
    document.body.appendChild(el);
  }
  el.textContent=msg;
}

/* The one place a card changes lane, whatever gesture asked for it. */
async function applyDrop(slug, from, to, opts){
  opts=opts||{};
  if(from===to){
    orderLane(to, opts.order||[]);
    toast(t("mv_ordered"));
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
    return { ok:true, reordered:true };
  }
  const all=await mergedOpps();
  const o=all.find(x=>x.slug===slug);
  if(!o) return { ok:false };

  if(to==="opened"){
    /* An open is recorded by the page itself. It is the one lane a person cannot put a card in,
       and saying so is more useful than a disabled control nobody can explain. */
    toast(t("dg_no_open"));
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
    return { ok:false, error:"lc_err_illegal" };
  }
  const move=moveForLane(from, to);
  if(!move || !ThriveLifecycle.can(move, o)){
    toast(t("lc_err_illegal"));
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
    return { ok:false, error:"lc_err_illegal" };
  }
  /* Sent needs evidence. The window opens on the control that can produce it. */
  if(move==="send_offchannel"){
    if(window.thriveModal) window.thriveModal.open(slug, "outreach", o.business||slug);
    else toast(t("dg_sent_ask"));
    return { ok:false, asked:true };
  }
  if(move==="record_reply"){
    const d=prompt(t("lc_reply_q"), today());
    if(d===null) return { ok:false };
    return await runMove("record_reply", slug, { replied_on:String(d).trim() });
  }
  if(move==="publish"){
    if(window.thriveModal) window.thriveModal.open(slug, "page", o.business||slug);
    return { ok:false, asked:true };
  }
  return await runMove(move, slug, opts);
}

/* ---- the non-drag path, built first -------------------------------------
   Every card carries a control that lists every legal destination for that card, plus move up
   and move down. Illegal destinations are ABSENT, not disabled: a person should not have to
   read greyed options to work out the rules, and a rule learned that way is learned wrong. */
/* WO-015 §5.2: the opinion controls. "won", "lost" and "exclude" (drop) assert an
   outcome no event backs, so they are never offered on the board or in the window.
   A dead opportunity is archived (Phase E), where the "no" lives with its whole
   thread intact. "won" is emitted only by the contracts module on a signature,
   never set by hand. These moves stay in the lifecycle table because migration and
   the future contracts module still reach them through apply(); they are removed
   only from what a person can click. Status is read, never asserted (I9). */
const RETIRED_MOVES = { mark_won:1, mark_lost:1, drop:1 };
function cardMenuFor(o, lane){
  const out=[];
  ThriveBoard.LANES.forEach(k=>{
    if(k===lane || k==="opened") return;
    const mv=moveForLane(lane, k);
    if(mv && !RETIRED_MOVES[mv] && ThriveLifecycle.can(mv, o)) out.push({ kind:"lane", to:k, label:laneLabel(k) });
  });
  ThriveLifecycle.movesFor(o).forEach(m=>{
    if(["publish","unpublish","send_email","send_offchannel","record_reply"].indexOf(m)>=0) return;
    if(RETIRED_MOVES[m]) return;                 // §5.2 an outcome is read, not clicked
    out.push({ kind:"move", move:m, label:t("lc_"+m) });
  });
  return out;
}

function initCardMenu(){
  const board=document.getElementById("boardLanes");
  if(!board || window.__thriveMenuBound) return;
  window.__thriveMenuBound=1;
  let open=null;

  function close(){ if(open){ open.remove(); open=null; } }
  document.addEventListener("click", e=>{
    if(open && !e.target.closest(".cardmenu") && !e.target.closest(".tok-more")) close();
  });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); });

  board.addEventListener("click", async e=>{
    const btn=e.target.closest && e.target.closest(".tok-more");
    if(!btn) return;
    e.preventDefault(); e.stopPropagation();
    close();
    const tok=btn.closest(".tok");
    const slug=tok.getAttribute("data-slug"), lane=tok.getAttribute("data-lane");
    const o=(await mergedOpps()).find(x=>x.slug===slug);
    if(!o) return;
    const items=cardMenuFor(o, lane);
    const menu=document.createElement("div");
    menu.className="cardmenu"; menu.setAttribute("role","menu");
    menu.innerHTML = (items.length
        ? items.map((it,i)=>'<button role="menuitem" type="button" data-mi="'+i+'">'+esc(it.label)+'</button>').join("")
        : '<span class="cardmenu-none">'+esc(t("mv_none"))+'</span>')+
      '<div class="cardmenu-sep"></div>'+
      '<button role="menuitem" type="button" data-ord="up">'+esc(t("mv_up"))+'</button>'+
      '<button role="menuitem" type="button" data-ord="down">'+esc(t("mv_down"))+'</button>';
    tok.appendChild(menu);
    open=menu;
    const first=menu.querySelector("button"); if(first) first.focus();

    menu.querySelectorAll("[data-mi]").forEach(b=>b.addEventListener("click", async ()=>{
      const it=items[+b.getAttribute("data-mi")];
      close();
      if(it.kind==="lane") await applyDrop(slug, lane, it.to, {});
      else { const op=await movePrompt(it.move, o); if(op!==null) await runMove(it.move, slug, op); }
    }));
    menu.querySelectorAll("[data-ord]").forEach(b=>b.addEventListener("click", ()=>{
      const dir=b.getAttribute("data-ord")==="up" ? -1 : 1;
      close();
      const body=tok.closest(".lane-body");
      const slugs=Array.prototype.map.call(body.querySelectorAll(".tok[data-slug]"), n=>n.getAttribute("data-slug"));
      const i=slugs.indexOf(slug), j=i+dir;
      if(i<0 || j<0 || j>=slugs.length) return;
      slugs.splice(j,0,slugs.splice(i,1)[0]);
      orderLane(lane, slugs);
      toast(t("mv_ordered"));
      if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
    }));
  });
}

/* The prompts each guarded move needs, in one place so the menu, the window and the keyboard
   ask the same questions. */
/* The one place a guarded move asks for what it needs. Returns null when the person backed out,
   which every caller treats as "do nothing" without needing to know which question was asked. */
async function movePrompt(m, o){
  const opts={};
  if(m==="drop"){
    const r=prompt(t("lc_drop_q")); if(r===null) return null;
    if(!String(r).trim()){ toast(t("lc_err_reason_text")); return null; }
    opts.reason=r;
  }
  if(m==="mark_lost"){
    const list=ThriveLifecycle.LOST_REASONS;
    const r=prompt(t("lc_lost_q")+"\n"+list.map((x,i)=>(i+1)+". "+t("lc_reason_"+x)).join("\n"));
    if(r===null) return null;
    opts.reason=list[parseInt(String(r).trim(),10)-1]||"";
    if(!opts.reason){ toast(t("lc_err_reason")); return null; }
  }
  if(m==="record_reply"){
    const r=prompt(t("lc_reply_q"), today()); if(r===null) return null;
    opts.replied_on=String(r).trim();
    /* A reply on Instagram is a reply, so the channel is asked and stored. Both
       of these are optional: pressing past them records the reply exactly as the
       inbox scan would, which is the point. The console must never make a hand
       recorded reply worth less than a scanned one. */
    const chs=ThriveLifecycle.CHANNELS;
    const c=prompt(t("rp_chan_q")+"\n"+chs.map((x,i)=>(i+1)+". "+lcChannelLabel(x)).join("\n"), "");
    if(c!==null && String(c).trim()){
      const pick=chs[parseInt(String(c).trim(),10)-1];
      if(pick) opts.channel=pick;
    }
    const n=prompt(t("rp_note_q"), "");
    if(n!==null && String(n).trim()) opts.note=String(n).trim();
  }
  if(m==="convert"){
    /* The offer needs its own outreach text; the offer PAGE is seeded from the
       opportunity's current page so there is a distinct file to publish to the
       offer path, which the writer refines later (that refinement is Track Two).
       The event is stamped here and applied through runMove, the same documented
       path archive uses. */
    const txt=prompt(t("lc_convert_q")); if(txt===null) return null;
    if(!String(txt).trim()){ toast(t("lc_err_offer_text")); return null; }
    opts.text=String(txt).trim();
    opts.at=new Date().toISOString();
    try{ opts.html=await renderOppHtml(o); }catch(e){ opts.html=(o&&o.html)||""; }
  }
  if(m==="reopen"){ if(!confirm(t("lc_reopen_q"))) return null; opts.confirmed=true; }
  if(m==="retire_page"){
    /* It asks the page once. A network answer is evidence; a network failure is not, so an
       unreachable page changes nothing rather than being recorded as gone. */
    if(!confirm(t("mv_404_q"))) return null;
    const gone=await pageIsGone((o&&o.slug)||"");
    if(gone===null){ toast(t("mv_404_err")); return null; }
    if(gone===false){ toast(t("mv_404_there")); return null; }
    toast(t("mv_404_gone"));
  }
  return opts;
}

/* ---- drag, and the keyboard, on top of the menu -------------------------
   Pointer Events rather than mouse events, so touch and trackpad take the same path. The
   handlers bind to the document once: the board re-initialises whenever the shell re-enters
   it, and a document listener registered per init is a listener that never leaves. */
function initCardDrag(){
  if(window.__thriveDragBound) return;
  window.__thriveDragBound=1;
  let st=null, hold=null, suppress=false, kb=null;

  function laneAt(x,y){
    const e=document.elementFromPoint(x,y);
    return e && e.closest ? e.closest(".lane-body[data-body]") : null;
  }
  function place(lane, y){
    const sibs=Array.prototype.filter.call(lane.querySelectorAll(".tok"), n=>n!==st.tok);
    let before=null;
    for(let i=0;i<sibs.length;i++){
      const r=sibs[i].getBoundingClientRect();
      if(y < r.top + r.height/2){ before=sibs[i]; break; }
    }
    lane.insertBefore(st.ph, before);
  }
  function begin(){
    const r=st.tok.getBoundingClientRect();
    st.dragging=true;
    st.ph=document.createElement("div");
    st.ph.className="tok-ph"; st.ph.style.height=r.height+"px";
    st.tok.parentNode.insertBefore(st.ph, st.tok);
    st.tok.style.width=r.width+"px"; st.tok.style.height=r.height+"px";
    st.tok.style.left=r.left+"px"; st.tok.style.top=r.top+"px";
    st.tok.classList.add("is-drag");
    document.body.classList.add("is-dragging");
    announce(t("mv_grab").replace("{name}", st.name).replace("{lane}", laneLabel(st.from)));
  }
  function move(e){
    if(!st) return;
    if(!st.dragging){
      const far=Math.abs(e.clientX-st.x0)>6 || Math.abs(e.clientY-st.y0)>6;
      if(!far) return;
      /* A finger that moves before the hold expires was scrolling, not picking anything up.
         A plain tap, which never gets here, still opens the window. */
      if(!st.grip && st.pointer!=="mouse"){ cancelHold(); st=null; return; }
      begin();
    }
    st.tok.style.transform="translate("+(e.clientX-st.x0)+"px,"+(e.clientY-st.y0)+"px)";
    const lane=laneAt(e.clientX, e.clientY);
    if(lane){ st.lane=lane.getAttribute("data-body"); place(lane, e.clientY); }
    /* Auto scroll within 60px of an edge of the board, so a lane off screen is reachable. */
    const board=document.getElementById("boardLanes");
    if(board){
      const r=board.getBoundingClientRect();
      if(e.clientX > r.right-60) board.scrollLeft += 12;
      else if(e.clientX < r.left+60) board.scrollLeft -= 12;
    }
  }
  function land(cur){
    cur.tok.classList.remove("is-drag");
    cur.tok.style.cssText="";
    if(cur.ph && cur.ph.parentNode){ cur.ph.parentNode.insertBefore(cur.tok, cur.ph); cur.ph.remove(); }
  }
  function finish(){
    if(!st) return;
    const cur=st; st=null; cancelHold();
    document.body.classList.remove("is-dragging");
    if(!cur.dragging) return;
    suppress=true; setTimeout(()=>{ suppress=false; }, 0);
    land(cur);
    const to=cur.lane||cur.from;
    const body=document.querySelector('[data-body="'+to+'"]');
    const order=body? Array.prototype.map.call(body.querySelectorAll(".tok[data-slug]"), n=>n.getAttribute("data-slug")) : [];
    announce(t("mv_dropped").replace("{name}", cur.name).replace("{lane}", laneLabel(to)));
    applyDrop(cur.slug, cur.from, to, { order:order });
  }
  function cancelHold(){ if(hold){ clearTimeout(hold); hold=null; } }

  document.addEventListener("pointerdown", e=>{
    if(e.button!==undefined && e.button!==0) return;
    if(!e.target.closest) return;
    if(e.target.closest(".tok-more") || e.target.closest(".cardmenu")) return;
    const tok=e.target.closest(".tok[data-slug]");
    if(!tok || !tok.closest("#boardLanes")) return;
    const grip=!!e.target.closest(".tok-grip");
    st={ tok:tok, slug:tok.getAttribute("data-slug"), from:tok.getAttribute("data-lane"),
         lane:tok.getAttribute("data-lane"), x0:e.clientX, y0:e.clientY,
         name:(tok.querySelector(".tok-name")||{}).textContent||"",
         pointer:e.pointerType, grip:grip, dragging:false, ph:null };
    if(grip){ e.preventDefault(); begin(); return; }
    /* 120ms of hold, or 6px of travel with a mouse. A plain tap opens the window. */
    if(e.pointerType!=="mouse"){ cancelHold(); hold=setTimeout(()=>{ if(st && !st.dragging) begin(); }, 120); }
  });
  document.addEventListener("pointermove", move, {passive:true});
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
  /* touch-action cannot be turned off once a gesture has begun, so the scroll a long press
     would otherwise start is refused here, and only while a card is actually held. */
  document.addEventListener("touchmove", e=>{ if(st && st.dragging) e.preventDefault(); }, {passive:false});
  document.addEventListener("click", e=>{ if(suppress){ e.preventDefault(); e.stopPropagation(); } }, true);

  /* ---- the keyboard path -----------------------------------------------
     Space picks up, Tab moves between destination lanes, Space drops, Escape cancels. It is
     the same applyDrop underneath, so a keyboard user and a finger reach the same guards. */
  document.addEventListener("keydown", e=>{
    const tok=document.activeElement && document.activeElement.closest &&
              document.activeElement.closest(".tok[data-slug]");
    if(e.key==="Escape" && kb){
      const held=kb; kb=null;
      held.tok.classList.remove("is-held");
      announce(t("mv_cancel"));
      return;
    }
    if(e.key===" " || e.key==="Spacebar"){
      if(!kb){
        if(!tok || !tok.closest("#boardLanes")) return;
        e.preventDefault();
        kb={ tok:tok, slug:tok.getAttribute("data-slug"), from:tok.getAttribute("data-lane"),
             lane:tok.getAttribute("data-lane"),
             name:(tok.querySelector(".tok-name")||{}).textContent||"" };
        tok.classList.add("is-held");
        announce(t("mv_grab").replace("{name}", kb.name).replace("{lane}", laneLabel(kb.from)));
        return;
      }
      e.preventDefault();
      const held=kb; kb=null;
      held.tok.classList.remove("is-held");
      announce(t("mv_dropped").replace("{name}", held.name).replace("{lane}", laneLabel(held.lane)));
      applyDrop(held.slug, held.from, held.lane, {});
      return;
    }
    if(e.key==="Tab" && kb){
      e.preventDefault();
      const lanes=ThriveBoard.LANES;
      let i=lanes.indexOf(kb.lane);
      i=(i + (e.shiftKey? -1 : 1) + lanes.length) % lanes.length;
      kb.lane=lanes[i];
      const body=document.querySelector('[data-body="'+kb.lane+'"]');
      const n=body? body.querySelectorAll(".tok[data-slug]").length : 0;
      announce(boardText(getLang(),"mv_over",n,{lane:laneLabel(kb.lane)}));
    }
  });
}

/* ---------- the day's batch ----------
   Three shapes, one behaviour: a page alone, a page with its manifest, or a zip of both.

   Nothing is written until the report has been shown. An import that quietly drops two of
   eleven is worse than an import that refuses, because the two that vanished are indistinguishable
   from two that were never in the file. So every page with no manifest entry and every manifest
   entry with no page is named, and a name already in the library asks per item rather than
   guessing which of the two you meant to keep.

   Everything lands in Draft. Not Ready, not Sent: it is published nowhere and sent to nobody,
   and the first lane is the only true one. */
function initIntake(){
  const el=id=>document.getElementById(id);
  const zone=el("intakeZone"), input=el("intakeFile"), out=el("intakeOut");
  if(!zone || !input || !out) return;
  if(typeof ThriveIntake==="undefined"){ zone.hidden=true; return; }

  let found=null, existing={}, choice={};

  const WARN=["no_business","no_body","no_channel","no_page","no_page_named","no_manifest_entry"];
  function status(msg, kind){ out.innerHTML='<p class="in-status '+(kind||"")+'">'+esc(msg)+'</p>'; }
  function slugFor(e){
    return e.slug_hint || ThriveIntake.slugify(e.business) ||
           ThriveIntake.slugify(e.page_file) || "opportunity";
  }
  function count(label, n, cls){
    return '<div class="in-count '+(cls||"")+'"><b>'+n+'</b><span>'+esc(label)+'</span></div>';
  }

  function card(e,i){
    const slug=slugFor(e);
    const dup=!!existing[slug];
    const warns=(e.warnings||[]).filter(w=>WARN.indexOf(w)>=0)
      .map(w=>'<span class="in-warn">'+esc(t("in_w_"+w))+'</span>').join("");
    const bits=[];
    if(e.city) bits.push(esc(e.city));
    if(e.descriptor) bits.push(esc(e.descriptor));
    const alt=(e.alternates||[]).map(a=>esc(lcChannelLabel(a.channel))).join(", ");
    return '<label class="in-card'+(dup?" is-dupe":"")+'">'+
      '<input type="checkbox" class="in-pick" data-i="'+i+'"'+(dup?"":" checked")+'>'+
      '<span class="in-body">'+
        '<span class="in-name">'+esc(e.business||"–")+'</span>'+
        (bits.length? '<span class="in-meta">'+bits.join(" · ")+'</span>':'')+
        '<span class="in-tags">'+
          (e.channel? '<span class="in-tag">'+esc(lcChannelLabel(e.channel))+
             (e.url? ' <span class="mono-iso">'+esc(e.url.replace(/^https?:\/\//,"").replace(/^mailto:/,""))+'</span>':'')+'</span>':'')+
          (alt? '<span class="in-tag">'+esc(t("in_alt"))+' '+alt+'</span>':'')+
          (e.tier? '<span class="in-tag">'+esc(t("in_tier"))+' '+esc(e.tier)+'</span>':'')+
          (e.file? '<span class="in-tag">'+esc(e.page_file||e.file.name)+'</span>':'')+
          (e.body? '<span class="in-tag">'+esc(t("ot_h"))+'</span>':'')+
          (e.prohibition? '<span class="in-warn">'+esc(t("md_prohibition"))+'</span>':'')+
          warns+
        '</span>'+
        (dup? '<span class="in-dupe-row"><b>'+esc(t("in_dupes_h"))+'</b>'+
          '<span class="mono-iso">'+esc(slug)+'</span>'+
          '<button type="button" class="btn ghost sm" data-dupe="skip" data-i="'+i+'">'+esc(t("in_dupe_skip"))+'</button>'+
          '<button type="button" class="btn ghost sm danger" data-dupe="replace" data-i="'+i+'">'+esc(t("in_dupe_repl"))+'</button>'+
          '</span>' : '')+
      '</span></label>';
  }

  function review(){
    const r=found;
    if(!r || !r.entries.length){ status(t("in_none"),"warn"); return; }
    const matched=r.entries.filter(e=>e.file).length;
    const n=r.entries.length;
    const named=(list)=> list.length
      ? '<ul class="in-named">'+list.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>' : "";

    out.innerHTML=
      '<div class="in-head"><b>'+esc(boardText(getLang(),"in_found",n))
        .split(String(n)).join('<span class="n">'+n+'</span>')+'</b>'+
        '<span class="in-actions">'+
          '<button class="btn sm" id="intakeAdd" type="button" data-icon="import">'+esc(t("in_add"))+'</button>'+
          '<button class="btn ghost sm" id="intakeCancel" type="button">'+esc(t("in_cancel"))+'</button>'+
        '</span></div>'+
      '<section class="in-report"><h4 class="mw-h">'+esc(t("in_report_h"))+'</h4>'+
        '<div class="in-counts">'+
          count(t("in_pages"), r.pages)+
          count(t("in_parsed"), r.entries.length-(r.orphanPages||[]).length)+
          count(t("in_matched"), matched)+
          count(t("in_orphan_p"), (r.orphanPages||[]).length, (r.orphanPages||[]).length?"warn":"")+
          count(t("in_orphan_e"), (r.orphanEntries||[]).length, (r.orphanEntries||[]).length?"warn":"")+
        '</div>'+
        named(r.orphanPages||[])+named(r.orphanEntries||[])+
      '</section>'+
      '<div class="in-list">'+r.entries.map(card).join("")+'</div>'+
      (r.notes? '<details class="mw-more"><summary>'+esc(t("in_notes_h"))+'</summary>'+
        '<pre class="mw-pitch" dir="auto">'+esc(r.notes)+'</pre></details>' : '');

    if(typeof applyIcons==="function") applyIcons(out);
    el("intakeCancel").addEventListener("click", reset);
    el("intakeAdd").addEventListener("click", add);
    out.querySelectorAll("[data-dupe]").forEach(b=>b.addEventListener("click", e=>{
      e.preventDefault(); e.stopPropagation();
      const i=+b.getAttribute("data-i");
      choice[i]=b.getAttribute("data-dupe");
      const box=out.querySelector('.in-pick[data-i="'+i+'"]');
      if(box) box.checked=(choice[i]==="replace");
      b.parentNode.querySelectorAll("[data-dupe]").forEach(x=>x.classList.toggle("on", x===b));
    }));
  }

  function reset(){ found=null; choice={}; out.innerHTML=""; input.value=""; }

  function add(){
    const picked=[];
    out.querySelectorAll(".in-pick").forEach(c=>{ if(c.checked) picked.push(found.entries[+c.getAttribute("data-i")]); });
    if(!picked.length){ reset(); return; }
    const seen={};
    Object.keys(existing).forEach(k=>seen[k]=1);
    let n=0;
    picked.forEach(e=>{
      const rec=ThriveIntake.toRecord(e, { today:today(), note_text:found.notes, batch:found.batch });
      let s=rec.slug;
      if(seen[s] && !existing[s]){ let k=2; while(seen[s+"-"+k]) k++; s=s+"-"+k; }
      rec.slug=s; seen[s]=1;
      saveDraft(rec);
      logActivity("in_import", rec.slug, (rec.business||"")+" · "+(found.batch.title||""));
      n++;
    });
    logActivity("in_batch", "", n+" imported, "+((found.orphanPages||[]).length)+" pages unmatched, "+
      ((found.orphanEntries||[]).length)+" entries unmatched");
    toast(boardText(getLang(),"in_added",n));
    reset();
    try{ scheduleSyncPush(); }catch(e){}
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
  }

  async function take(files){
    if(!files || !files.length) return;
    status(t("in_reading"));
    try{ existing={}; (await mergedOpps()).forEach(o=>{ existing[o.slug]=true; }); }catch(e){}
    try{
      found=await ThriveIntake.readDrop(files);
      choice={};
      review();
    }catch(e){
      status(/zip|inflate/i.test((e&&e.message)||"") ? t("in_zip_err") : t("in_none"), "warn");
    }
  }

  /* The file picker is not an afterthought. iPad Safari has no drag and drop from Files into a
     web page, so on the device this console is actually used on, the picker is the only path. */
  input.addEventListener("change", ()=>take(input.files));
  ["dragenter","dragover"].forEach(k=>zone.addEventListener(k, e=>{ e.preventDefault(); zone.classList.add("on"); }));
  ["dragleave","drop"].forEach(k=>zone.addEventListener(k, e=>{
    e.preventDefault();
    if(k==="dragleave" && zone.contains(e.relatedTarget)) return;
    zone.classList.remove("on");
  }));
  zone.addEventListener("drop", e=>{
    const dt=e.dataTransfer;
    if(dt && dt.files && dt.files.length) take(dt.files);
  });
  /* A zip dropped an inch wide of the target is a browser navigating away to open it, and a
     day's work replaced by a directory listing. Missing the box has to cost nothing. */
  if(!window.__thriveDropGuard){
    window.__thriveDropGuard=1;
    ["dragover","drop"].forEach(k=>document.addEventListener(k, e=>{
      if(e.target.closest && e.target.closest("#intakeZone")) return;
      e.preventDefault();
    }));
  }
  onThrive("lang","intake", ()=>{ if(found) review(); });
}

/* ---------- running a lifecycle move ----------
   ThriveLifecycle decides whether a move is legal and what it changes. This is the only place
   that writes the answer down. Every surface that moves a card calls runMove, so a card cannot
   end up in one state on the board and another in the library, and an activity entry cannot be
   written by one path and skipped by another.

   The undo is the patch ThriveLifecycle computed while the previous values were still known.
   Working out an inverse afterwards means guessing at what was overwritten, and the guess is
   wrong exactly when it matters. Undoing appends a correcting entry rather than deleting the
   original one: the record of what happened is not improved by removing the part you regret. */
const LC_CHANNEL_ICON={ web_form:"form", instagram:"dm", linkedin:"other", whatsapp:"whatsapp",
                        x:"other", phone:"other", other:"other" };
function lcChannelLabel(k){ return t("oc_ch_"+k) !== ("oc_ch_"+k) ? t("oc_ch_"+k) : k; }

async function runMove(move, slug, opts){
  opts=opts||{};
  const all=await mergedOpps();
  const o=all.find(x=>x.slug===slug);
  if(!o) return { ok:false, error:"lc_err_illegal" };
  const r=ThriveLifecycle.apply(move, o, opts);
  /* A move the console made on its own, from a sync round, reports through the
     board rather than through a toast. Five replies landing at once must not be
     five toasts stacked over the card the reader is trying to look at, and a
     guard that refuses one of them is a line in the log, not an interruption. */
  if(!r.ok){ if(!opts.silent) toast(t(r.error)); return r; }

  /* WO-015 Phase E, recall is chapter aware. The lifecycle restores an archived
     card to the stage it declared when it was archived, which for a converted
     opportunity may belong to chapter one, a chapter that has since closed. So a
     recall of a card whose active chapter is past the first reads its lane through
     activeChapterStage and returns it there, storing a derived stage as no
     declaration so the board reads the active chapter rather than a stale one. It
     also records which chapter it reopened into, so the documented event is
     honest. Chapter one cards and closed stage restores are untouched: this only
     fires once an offer has opened a second chapter. */
  if(move==="unarchive" && activeChapter(slug)>1){
    const merged=Object.assign({}, o, r.patch, { archived:false });
    const st=activeChapterStage(merged);
    r.patch.stage = (st==="ready"||st==="draft"||st==="live") ? "" : st;
    r.detail = "chapter "+activeChapter(slug)+", "+st;
  }

  saveDraft(Object.assign({ slug:slug }, r.patch));
  logActivity(r.action, slug, r.detail||"");
  invalidateSends();
  try{ scheduleSyncPush(); }catch(e){}

  const done=()=>{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
                   if(window.thriveModal && window.thriveModal.reread) window.thriveModal.reread(); };
  done();

  if(r.undoable){
    toast(t("lc_"+move)+" · "+t("lc_done"), { label:t("lc_undo"), fn:()=>{
      saveDraft(Object.assign({ slug:slug }, r.undo));
      // The original entry stays. This one says it was taken back.
      logActivity("lc_undo", slug, move);
      invalidateSends();
      try{ scheduleSyncPush(); }catch(e){}
      done();
      toast(t("lc_undone"));
    }});
  } else if(!opts.silent) toast(t("lc_"+move)+" · "+t("lc_done"));
  return r;
}

/* ---------- the opportunity window ----------
   One centred surface, over a dimmed board, with five tabs.

   It replaced a panel pinned to the inline-end edge. That panel was specified when this view
   was mostly a single action; it has become a workspace with several tabs, and a 580px column
   against the edge of a 1440px screen pushes the eye sideways while the board sits idle behind
   it. The problem gets worse with every tab added. A centred surface is the correct shape for
   a workspace, so this is the shape.

   Three tabs it renders itself (Overview, Text, History) and two it BORROWS: it moves the
   existing #view-editor and #view-compose nodes into #modalHost rather than duplicating their
   markup, so the document keeps exactly one editor, one composer, and one set of listeners.
   Duplicating would mean two elements carrying the same ids and a send button belonging to
   whichever copy loaded last. Only the shell has a #modal, so on a single page this whole
   layer stays dormant.

   What it borrows it MUST give back, immediately when a navigation needs it rather than after
   the closing transition. A window that takes a node out of the document owes the document
   that node back. */
function initModal(){
  const el=id=>document.getElementById(id);
  const modal=el("modal"), scrim=el("modalScrim"), body=el("modalBody"), host=el("modalHost");
  if(!modal || !body || !host) return null;

  const PANELS={ overview:"modalOverview", text:"modalText", outreach:"modalOutreach", history:"modalHistory" };
  /* Outreach shows both: the off channel flow this window renders, and the composer it
     borrows, stacked in that order. Off channel comes first because most of a batch has no
     email address at all, so it is the common case rather than the exception. */
  const BORROWED={ page:"view-editor", outreach:"view-compose" };

  let opener=null, current="", rec=null, open_=false, scrollY=0;
  const __ovSwept=new Set();   // slugs whose Overview live link has already had its one gentle sweep

  /* Where each borrowed view lives when the window does not have it. Recorded once, on the
     first borrow, from the document itself rather than assumed. */
  const home={};
  function remember(view){
    if(home[view.id]) return;
    home[view.id]={ parent:view.parentNode, next:view.nextSibling };
  }
  function giveBack(){
    Array.prototype.slice.call(host.children).forEach(n=>{
      const h=home[n.id];
      if(!h || !h.parent) return;
      n.hidden=true; n.classList.add("wrap");
      h.parent.insertBefore(n, h.next);
    });
  }

  /* ---- small pieces shared by the panels ---------------------------------
     A slug, a URL, an address and a timestamp are read left to right whatever the interface
     language is, so they are isolated rather than left to the bidi algorithm, which would
     otherwise reorder them inside an Arabic line and make them read as a different value. */
  function row(label, value){
    return '<div class="mw-row"><dt>'+esc(label)+'</dt><dd>'+value+'</dd></div>';
  }
  function stageName(st){
    if(st==="won") return t("tray_won");
    if(st==="lost") return t("tray_lost");
    return t("lane_"+st);
  }

  /* ---- the standing prohibition band -------------------------------------
     Thrive does not pitch design to a designer-owner, and two of the three in a typical batch
     are makers. So this is a guard rather than a note: it cannot be dismissed, and it sits
     above everything else in the window, because it has to be read before the message goes out
     rather than after. */
  function prohibitionBand(o){
    if(!o || !o.prohibition) return "";
    return '<div class="mw-band" role="note"><span class="mw-band-i" aria-hidden="true">!</span>'+
      '<div><b>'+esc(t("md_prohibition"))+'</b><span>'+esc(o.prohibition)+'</span></div></div>';
  }

  /* ---- notes the record carries about itself ----------------------------- */
  function recordNotes(o){
    const out=[];
    if(o.stage==="dropped" && o.drop_reason)
      out.push('<div class="mw-note-row"><b>'+esc(t("lc_note_dropped"))+'</b> '+esc(o.drop_reason)+'</div>');
    if(o.stage==="lost" && o.lost_reason)
      out.push('<div class="mw-note-row"><b>'+esc(t("lc_note_lost"))+'</b> '+esc(t("lc_reason_"+o.lost_reason))+'</div>');
    if(o.page_missing) out.push('<div class="mw-note-row">'+esc(t("lc_note_retired"))+'</div>');
    if(o.template_retired) out.push('<div class="mw-note-row">'+esc(t("lc_note_tplgone"))+'</div>');
    return out.length? '<div class="mw-notes">'+out.join("")+'</div>' : "";
  }

  /* ---- the moves bar -----------------------------------------------------
     Only the moves that are legal from where this record actually stands. Illegal ones are
     absent rather than disabled: a person should not have to read greyed options to work out
     the rules, and a rule you learn by reading disabled controls is a rule you learn wrong. */
  function movesBar(o){
    if(!o) return "";
    /* §5.2: the opinion moves are never offered in the window either. Archive is
       how a "no" is recorded; won waits for the contracts module. */
    const moves=ThriveLifecycle.movesFor(o).filter(m=> m!=="send_email" && m!=="send_offchannel" && !RETIRED_MOVES[m]);
    if(!moves.length) return "";
    const primary={ publish:1, record_reply:1, restore:1, unarchive:1 };
    return '<section class="mw-sec"><h4 class="mw-h">'+esc(t("lc_h"))+'</h4>'+
      '<div class="mw-moves">'+moves.map(m=>
        '<button type="button" class="btn '+(primary[m]?"":"ghost ")+'sm" data-move="'+esc(m)+'">'+
        esc(t("lc_"+m))+'</button>').join("")+'</div></section>';
  }

  /* Each guarded move asks for exactly what its guard requires, and nothing else. The prompts
     are deliberately plain: a confirm and a prompt are the two the document already has, and
     WO-012 §10 asks for one of each rather than a third dialogue of my own. */
  function bindMoves(box, o){
    /* One question per move, asked from one place. The window and the card menu both call
       movePrompt, so the two can never ask differently or forget the same guard. */
    box.querySelectorAll("[data-move]").forEach(b=>b.addEventListener("click", async ()=>{
      const m=b.getAttribute("data-move");
      if(m==="publish"){
        // Publishing is a network operation with its own screen. The lifecycle says it is
        // legal; the editor is what performs it.
        switchTo("page"); return;
      }
      const opts=await movePrompt(m, o);
      if(opts===null) return;
      await runMove(m, o.slug, opts);
    }));
  }

  /* ---- Outreach: the off channel send ------------------------------------
     Three steps, in the order a person actually performs them: read the message, open their
     channel, then say what you did. The console cannot witness a send made through somebody
     else's contact form, so it records your word for it and labels it as your word. What it
     will not do is invent one, and what it will not allow is sending a message that still
     says [LINK] where the page address should be. */
  /* ---- the Outreach tab ---------------------------------------------------
     It used to open on a row of send-from options, one of which rendered as a
     bare dot because its label was a literal ".". That is the wrong question in
     the wrong place: at that moment the only thing that matters is whether this
     is going by email or through one of their own channels, and everything after
     it follows from the answer.

     The choice is stored on the opportunity, so returning to the tab RESUMES
     rather than asking again, and changing it keeps what was already written. */
  function emailAddress(o){
    const c=o.channel||{};
    /* Always the bare address. A record imported before the address fix may carry "mailto:" on
       channel.to; the scheme belongs in a send href, never in what is shown or seeded here. */
    if(c.kind==="email" && c.to) return bareAddress(c.to);
    if(o.email) return bareAddress(o.email);
    /* Tier A is the manifest saying an owner address was found. An address with
       no tier is still an address; a tier with no address is not one. */
    if(/@/.test(String(c.to||""))) return bareAddress(c.to);
    return "";
  }
  function channelChoices(o){
    const out=[];
    const c=o.channel||{};
    if(c.kind && c.kind!=="email") out.push({ kind:c.kind, url:c.to||"", first:true });
    (o.channel_alternates||[]).forEach(a=>{
      if(!a || !a.channel || a.channel==="email") return;
      if(out.some(x=>x.kind===a.channel)) return;
      out.push({ kind:a.channel, url:a.url||"" });
    });
    return out;
  }
  function outreachPath(o){ return (o && o.outreach_path) || ""; }

  function renderOutreach(o){
    const box=el("modalOutreach"); if(!box) return;
    if(!o){ box.innerHTML=""; return; }
    const path=outreachPath(o);
    if(!path){ renderChannelQuestion(o); return; }
    if(path==="email") renderEmailPath(o); else renderChannelPath(o, path);
  }

  /* Two choices, sized as real decisions rather than chips. */
  function renderChannelQuestion(o){
    const box=el("modalOutreach");
    const addr=emailAddress(o);
    const chs=channelChoices(o);
    const tierA=(o.contact_tier||"").toUpperCase()==="A";
    /* Email is offered only when a Tier A address exists on the record, and it
       says the address. Offering a send you cannot make is worse than not
       offering it. */
    const emailOn = !!addr && tierA;
    let h=prohibitionBand(o)+
      '<section class="mw-sec"><h4 class="mw-h">'+ic("channel")+esc(t("och_h"))+'</h4>'+
      '<p class="mw-note">'+esc(t("och_p"))+'</p></section>'+
      '<div class="och-grid">';
    h+= emailOn
      ? '<button class="och-card" type="button" data-path="email">'+
          ic("mail",20)+'<span class="och-t">'+esc(t("och_email"))+'</span>'+
          '<span class="och-s">'+ltr(esc(addr))+'</span></button>'
      : '<div class="och-card is-off">'+ic("mail",20)+
          '<span class="och-t">'+esc(t("och_email"))+'</span>'+
          '<span class="och-s">'+esc(addr? t("och_no_tier") : t("och_no_email"))+'</span></div>';
    h+= chs.length
      ? chs.map(c=>'<button class="och-card" type="button" data-path="'+esc(c.kind)+'">'+
          ic(LC_CHANNEL_ICON[c.kind]||"channel",20)+
          '<span class="och-t">'+esc(lcChannelLabel(c.kind))+'</span>'+
          '<span class="och-s">'+(c.url? ltr(esc(c.url)) : esc(t("oc_no_url")))+'</span></button>').join("")
      : '<div class="och-card is-off">'+ic("channel",20)+
          '<span class="och-t">'+esc(t("och_own"))+'</span>'+
          '<span class="och-s">'+esc(t("och_no_channels"))+'</span></div>';
    h+='</div>';
    box.innerHTML=h;
    box.querySelectorAll("[data-path]").forEach(b=>b.addEventListener("click", async ()=>{
      saveDraft({ slug:o.slug, outreach_path:b.getAttribute("data-path") });
      logActivity("och_path", o.slug, b.getAttribute("data-path"));
      /* Re-entering the tab rather than re-rendering the panel, because the
         answer decides whether the composer is adopted at all. */
      await reread();
      await switchTo("outreach");
    }));
  }

  function changeBar(o){
    return '<div class="och-change"><button class="btn ghost sm" type="button" id="ochChange">'+
      ic("undo")+esc(t("och_change"))+'</button></div>';
  }
  function bindChange(o){
    const b=el("ochChange");
    if(b) b.addEventListener("click", async ()=>{
      /* Changing the channel must never lose what was written, so only the path
         is cleared. The body, the note and the date are properties of the
         message, not of the road it takes. */
      saveDraft({ slug:o.slug, outreach_path:"" });
      await reread();
      await switchTo("outreach");
    });
  }

  /* The email path continues into the composer, prefilled from the opportunity. */
  function renderEmailPath(o){
    const box=el("modalOutreach");
    const addr=emailAddress(o);
    box.innerHTML=prohibitionBand(o)+changeBar(o)+
      '<section class="mw-sec"><h4 class="mw-h">'+ic("mail")+esc(t("och_email_h"))+'</h4>'+
      '<p class="mw-note">'+esc(t("och_email_p"))+' <span class="mono-iso">'+esc(addr)+'</span></p>'+
      linkCard(o)+'</section>';
    /* The composer itself is adopted directly below this, so there is nothing to
       press to reach it. A button whose only job is to scroll is not a decision. */
    bindLinkCards(box); bindChange(o);
  }

  /* One calm screen, not a form. */
  function renderChannelPath(o, kind){
    const box=el("modalOutreach");
    const text=(o.outreach_text||"");
    const hasLink=text.indexOf("[LINK]")>=0;
    const all=channelChoices(o);
    const pick=all.find(c=>c.kind===kind)||{kind:kind,url:""};
    const target=pick.url? (/^https?:/i.test(pick.url)? pick.url : "https://"+pick.url) : "";
    const done=ThriveLifecycle.manualContacts(o);

    box.innerHTML=prohibitionBand(o)+changeBar(o)+
      '<section class="mw-sec"><h4 class="mw-h">'+ic(LC_CHANNEL_ICON[kind]||"channel")+
        esc(lcChannelLabel(kind))+'</h4>'+
      /* Editable, because what was actually sent is what must be recorded and
         people edit before they send. */
      '<div class="field"><label for="ocBody">'+esc(t("oc_body"))+'</label>'+
        '<textarea id="ocBody" class="input oc-body" rows="8">'+esc(text)+'</textarea></div>'+
      (hasLink? '<p class="mw-warn-line">'+ic("alert")+esc(t("oc_copy_blocked"))+'</p>' : '')+
      '<div class="mw-acts"><button type="button" class="btn ghost sm" id="ocCopy"'+
        (hasLink?" disabled":"")+'>'+ic("copy")+esc(t("oc_copy"))+'</button></div>'+
      linkCard(o)+
      (target? '<div class="mw-acts"><a class="btn ghost" href="'+esc(target)+'" target="_blank" '+
        'rel="noopener">'+ic("link")+esc(t("oc_go"))+'</a></div>'
             : '<p class="mw-empty">'+esc(t("oc_no_url"))+'</p>')+
      '</section>'+
      '<section class="mw-sec"><h4 class="mw-h">'+ic("check")+esc(t("och_sent_h"))+'</h4>'+
        '<div class="mw-off-grid">'+
          '<div class="field"><label for="ocWhen">'+esc(t("oc_when"))+'</label>'+
            '<input id="ocWhen" class="input" type="date" max="'+today()+'" value="'+today()+'"></div>'+
          '<div class="field"><label for="ocNote">'+esc(t("oc_note"))+'</label>'+
            '<input id="ocNote" class="input" autocomplete="off"></div>'+
        '</div>'+
        '<button class="btn" id="ocDo" type="button">'+ic("check")+esc(t("oc_confirm"))+'</button>'+
      '</section>'+
      '<section class="mw-sec"><h4 class="mw-h">'+esc(t("md_sends_h"))+'</h4>'+
        (done.length
          ? '<ul class="oc-list">'+done.map(c=>'<li><b>'+esc(lcChannelLabel(c.channel))+'</b>'+
              '<span class="mono-iso">'+esc(c.sent_on)+'</span>'+
              (c.note? '<span class="mw-note">'+esc(c.note)+'</span>':'')+'</li>').join("")+'</ul>'
          : '<p class="mw-empty">'+esc(t("oc_none"))+'</p>')+
      '</section>';

    bindLinkCards(box); bindChange(o);
    const copy=el("ocCopy");
    if(copy) copy.addEventListener("click", async ()=>{
      /* The [LINK] guard stays. An unsubstituted placeholder means the prospect
         received a broken message, and the console makes that impossible rather
         than detectable, because detectable is after it was sent. */
      if(hasLink){ toast(t("oc_copy_blocked")); return; }
      // The message carries the page link, so copying it to paste to a party waits on the same
      // proof as any send: the page must be live and its link must load.
      const s=await pageSendable(o); if(!s.ok){ toast(s.reason); return; }
      const body=el("ocBody").value;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(body).then(()=>toast(t("oc_copied")),
          ()=>toast(legacyCopy(body)? t("oc_copied") : t("cmp_copy_err")));
        return;
      }
      toast(legacyCopy(body)? t("oc_copied") : t("cmp_copy_err"));
    });
    const go=el("ocDo");
    if(go) go.addEventListener("click", async ()=>{
      // Recording a send to a party asserts a message went out. It cannot assert that for a page
      // that is not live, so the same proof gates it.
      const s=await pageSendable(o); if(!s.ok){ toast(s.reason); return; }
      /* The body stored is the body AS EDITED, byte for byte. Recording what was
         drafted rather than what was sent puts a message on the record that
         nobody ever received. */
      await runMove("send_offchannel", o.slug, {
        channel: kind,
        url: target,
        sent_on: el("ocWhen").value,
        body: el("ocBody").value,
        note: el("ocNote").value
      });
    });
  }

  /* ---- Text: the outreach text, which is never a template -----------------
     It is content used verbatim, not a form field to be edited, so it is shown as a block with
     a copy control. The paste box exists because the batch importer that will fill this
     automatically is a later phase, and a guard nobody can reach is a guard nobody has tested. */
  function renderText(o){
    const box=el("modalText"); if(!box) return;
    const text=(o&&o.outreach_text)||"";
    const hasLink=text.indexOf("[LINK]")>=0;
    let inner;
    if(!text){
      inner='<div class="mw-empty">'+
        '<svg class="mw-empty-i" viewBox="0 0 24 24" width="32" height="32" fill="none" '+
        'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '+
        'aria-hidden="true" focusable="false">'+
        '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'+
        '<path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>'+
        '<p>'+esc(t("ot_none"))+'</p></div>';
    } else {
      inner='<pre class="mw-pitch" dir="auto">'+esc(text)+'</pre>'+
        (hasLink? '<p class="mw-warn-line">'+esc(t("ot_link_warn"))+'</p>':'')+
        '<div class="mw-acts"><button type="button" class="btn ghost sm" id="otCopy"'+
        (hasLink?" disabled":"")+'>'+esc(t("oc_copy"))+'</button></div>';
    }
    /* Outreach text: the text symbol, no colour, and always a block of content
       with a copy control rather than a form field. WO-013 §3.4. */
    box.innerHTML='<section class="mw-sec kind-text"><h4 class="mw-h">'+ic("text")+esc(t("ot_h"))+
      ' <span class="kind-tag">'+esc(t("kd_kind_text"))+'</span></h4>'+inner+'</section>'+
      '<details class="mw-more"><summary>'+esc(t("ot_paste"))+'</summary>'+
      '<div class="field"><textarea id="otBox" class="input oc-body" rows="8">'+esc(text)+'</textarea></div>'+
      '<button class="btn ghost sm" id="otSave" type="button">'+esc(t("ot_save"))+'</button></details>';

    const c=el("otCopy");
    if(c) c.addEventListener("click", ()=>{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(()=>toast(t("oc_copied")),
          ()=>toast(legacyCopy(text)? t("oc_copied") : t("cmp_copy_err")));
        return;
      }
      toast(legacyCopy(text)? t("oc_copied") : t("cmp_copy_err"));
    });
    const sv=el("otSave");
    if(sv && o) sv.addEventListener("click", ()=>{
      saveDraft({ slug:o.slug, outreach_text:el("otBox").value });
      logActivity("text_attach", o.slug, "");
      try{ scheduleSyncPush(); }catch(e){}
      toast(t("ot_saved"));
      reread();
    });
  }

  /* ---- Overview ---------------------------------------------------------- */
  function renderOverview(o){
    const box=el("modalOverview"); if(!box) return;
    if(!o){ box.innerHTML=""; return; }
    const st=effStage(o);
    const age=(typeof ThriveBoard!=="undefined" && ThriveBoard.ageDays)
      ? ThriveBoard.ageDays(o, { mail:getMailLog() })
      : daysSince(o.sent_on);
    const rows=[];
    rows.push(row(t("mw_o_slug"), ltr(o.slug)));
    rows.push(row(t("mw_o_state"), '<span class="mw-state mw-state-'+esc(st)+'">'+esc(stageName(st))+'</span>'));
    // The age carries a number, so it goes through the plural rule rather than a flat template:
    // Arabic inflects the noun after the count and "3 يوم" is not Arabic.
    rows.push(row(t("mw_o_age"), esc(boardText(getLang(),"tok_days",age))
      .split(String(age)).join('<span class="n">'+age+'</span>')));
    if(o.location) rows.push(row(t("mw_o_where"), esc(o.location)));
    if(o.template) rows.push(row(t("mw_o_tpl"), esc(o.template)));
    if(o.sent_on) rows.push(row(t("mw_o_made"), ltr(o.sent_on)));
    // The live link has a permanent home here: Activated, the address, and a small Open and Copy, so
    // it never has to be hunted for again. The gradient border sweeps once the first time this record
    // shows the activated state, then calms.
    var ovSweep = isLive(o) && !__ovSwept.has(o.slug);
    if(isLive(o)) __ovSwept.add(o.slug);
    rows.push(row(t("mw_o_page"), isLive(o)
      ? '<div class="ov-live'+(ovSweep?" sweep":"")+'" style="--ac-ang:0deg"><div class="ov-live-in">'+
        '<span class="ov-live-tag">'+esc(t("ov_activated"))+'</span>'+
        '<a class="ov-live-url has-ic" href="'+esc(liveUrl(o.slug))+'" target="_blank" rel="noopener" dir="ltr">'+
          (typeof thriveIcon==="function"? thriveIcon("globe",{size:14}) : "")+ltr(liveUrl(o.slug))+'</a>'+
        '<span class="ov-live-acts">'+
          '<a class="btn sm" href="'+esc(liveUrl(o.slug))+'" target="_blank" rel="noopener">'+esc(t("ac_open"))+'</a>'+
          '<button type="button" class="btn sm" data-ovcopy="'+esc(o.slug)+'">'+esc(t("ac_copy"))+'</button>'+
        '</span></div></div>'
      : '<span class="mw-muted">'+esc(t("mw_o_unpub"))+'</span>'));
    box.innerHTML=prohibitionBand(o)+recordNotes(o)+
      '<dl class="mw-rows">'+rows.join("")+'</dl>'+movesBar(o);
    box.querySelectorAll("[data-ovcopy]").forEach(b=>b.addEventListener("click", async ()=>{
      var okc=await copyToClipboard(liveUrl(b.getAttribute("data-ovcopy")));
      var old=b.textContent; b.textContent=t("ac_copied"); setTimeout(()=>{ b.textContent=old; }, 1600);
      if(!okc) actionStatus("err", t("act_err_unknown"));
    }));
    bindMoves(box, o);
  }

  /* ---- The thread (WO-015 Phase A) --------------------------------------
     One continuous record per opportunity, assembled by buildThread from the
     ledger, the inbox, the opens map and the activity log, ordered oldest at
     the head to newest at the foot, because a thread is read as a story from
     first contact forward. Nothing is written or derived here (I7): it renders
     what buildThread returns and touches no storage. A reply shows the snippet
     the relay stored and a Gmail link, never a full body. */
  function renderHistory(o){
    const box=el("modalHistory"); if(!box) return;
    const slug=(o&&o.slug)||current;
    const entries=buildThread(slug);
    const when=ts=>{ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",
      {dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts||""; } };
    const label=a=>{ const k="act_"+a; const v=t(k); return v===k? a : v; };

    if(!entries.length){ box.innerHTML='<div class="mw-empty">'+ic("clock")+
      '<p>'+esc(t("mw_hist_empty"))+'</p></div>'; return; }

    function line(icn, what, detail, ts){
      return '<li class="th-line"><span class="th-icn">'+ic(icn)+'</span>'+
        '<span class="th-what">'+esc(what)+'</span>'+
        (detail? '<span class="th-detail">'+detail+'</span>':'')+
        '<span class="th-when">'+ltr(when(ts))+'</span></li>';
    }
    function replyCard(r){
      return '<li class="th-reply"><div class="rp-card">'+
        '<div class="rp-top"><span class="rp-who">'+esc(r.from||t("th_someone"))+'</span>'+
        '<span class="rp-when">'+ltr(when(r.ts))+'</span></div>'+
        (r.fromAddr? '<div class="rp-from mono">'+ltr(esc(r.fromAddr))+'</div>':'')+
        (r.subject? '<div class="rp-subj">'+esc(r.subject)+'</div>':'')+
        (r.snippet? '<p class="rp-snip">'+esc(r.snippet)+'</p>':'')+
        '<div class="rp-foot">'+
          (r.rule? '<span class="rp-rule">'+esc(t("rp_rule_"+r.rule))+'</span>':'')+
          (r.gmail? '<a class="btn ghost sm" href="'+esc(r.gmail)+'" target="_blank" rel="noopener">'+
                 ic("link")+esc(t("rp_open_gmail"))+'</a>' : '')+
        '</div></div></li>';
    }
    let html='<ol class="th-list">', lastCh=0;
    entries.forEach(e=>{
      /* The chapter divider marks where the offer began (Phase C). It appears the
         moment an entry carries a higher chapter than the one before it, so a
         thread that never converted shows no divider at all. */
      const ch=e.chapter||1;
      if(lastCh && ch>lastCh){
        html+='<li class="th-chapter"><span>'+esc(t("th_chapter_"+(ch===2?"offer":"more")))+'</span></li>';
      }
      if(ch>lastCh) lastCh=ch;
      if(e.kind==="sent"){
        html+=line("mail", t("th_sent"),
          (e.subject? esc(e.subject) : "")+(e.channel? ' <span class="th-chan">'+esc(e.channel)+'</span>':''), e.ts);
      }else if(e.kind==="open"){
        html+=line("globe", t("th_opened"), "", e.ts);
      }else if(e.kind==="reply"){
        html+=replyCard(e);
      }else if(e.kind==="auto"){
        html+=line("alert", t(e.bounce==="hard"?"rp_bounce_hard":e.bounce==="soft"?"rp_bounce_soft":"rp_auto"), "", e.ts);
      }else if(e.kind==="act"){
        html+=line("clock", label(e.action), e.detail? esc(e.detail):"", e.ts);
      }
    });
    html+='</ol>';
    box.innerHTML=html;
  }

  /* ---- tabs -------------------------------------------------------------- */
  /* The composer is only adopted when the reader has chosen the email path. The
     tab used to open on the composer AND the send options at once, which asked
     the second question before the first. WO-013 §4.1. */
  function borrows(tab){
    if(tab!=="outreach") return !!BORROWED[tab];
    return outreachPath(rec)==="email";
  }
  function show(tab){
    Object.keys(PANELS).forEach(k=>{ const p=el(PANELS[k]); if(p) p.hidden=(k!==tab); });
    host.hidden=!borrows(tab);
    modal.querySelectorAll(".modal-tab").forEach(b=>{
      const on=b.getAttribute("data-tab")===tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on?"true":"false");
    });
  }
  async function switchTo(tab, opts){
    if(!PANELS[tab] && !BORROWED[tab]) tab="overview";
    /* Each tab is a step, so back moves one tab rather than closing the window
       from four screens deep. §6.1. */
    if(opts && opts.push) pushStep(current, tab);
    if(tab==="outreach" && !borrows(tab)){
      /* The question, or the channel screen, on its own. */
      giveBack();
      show(tab);
      renderOutreach(rec);
      return;
    }
    if(BORROWED[tab]){
      const view=document.getElementById(BORROWED[tab]);
      if(!view) return;
      if(tab==="outreach") renderOutreach(rec);
      giveBack();                    // park any other borrowed view before adopting this one
      remember(view);
      if(view.parentNode!==host) host.appendChild(view);
      view.hidden=false; view.classList.remove("wrap");
      /* Back to how it looked at boot, before its init runs again. Re-running an init over a
         DOM that init already wired gives every control in it a second copy of the same
         listener, and on a composer that means one click on Send sending twice. */
      if(typeof window.thriveViewReset==="function") window.thriveViewReset(BORROWED[tab].replace(/^view-/,""));
      show(tab);
      // A borrowed view that fails to mount used to leave its buttons in place but unbound, and
      // swallowed the reason here, so a tap did nothing with no word why. Surface it instead.
      try{ if(tab==="page") await initEditor(current); else await initCompose(current); }
      catch(e){ if(typeof actionStatus==="function") actionStatus("err", t("act_mount_fail")+" "+errText(e)); }
      return;
    }
    giveBack();
    show(tab);
    if(tab==="overview"){
      // Reflect reality: the record may have just been activated in the borrowed page view, so read
      // the current state before drawing the row rather than trust a rec loaded before the commit.
      if(current){ try{ rec=(await mergedOpps()).find(x=>x.slug===current)||rec; }catch(e){ actionStatus("err", errText(e)); } }
      renderOverview(rec);
    }
    else if(tab==="text") renderText(rec);
    else renderHistory(rec);
    if(__restored) applyDraftFields(__restored);
  }

  /* ---- the copy link control --------------------------------------------
     Both paths are invoked inside the click itself. Safari rejects a clipboard write that is
     reached after an await, so nothing is awaited before either call is made. */
  function legacyCopy(text){
    try{
      const ta=document.createElement("textarea");
      ta.value=text;
      ta.setAttribute("readonly","");
      ta.className="mw-offscreen";
      document.body.appendChild(ta);
      ta.select();
      try{ ta.setSelectionRange(0, text.length); }catch(e){}   // iOS wants the explicit range
      const ok=document.execCommand("copy");
      ta.remove();
      return !!ok;
    }catch(e){ return false; }
  }
  function copyLink(){
    if(!rec || !isLive(rec)) return;
    const url=liveUrl(rec.slug);
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(
        ()=>toast(t("mw_copied")),
        ()=>toast(legacyCopy(url)? t("mw_copied") : t("cmp_copy_err")));
      return;
    }
    toast(legacyCopy(url)? t("mw_copied") : t("cmp_copy_err"));
  }
  /* The header pill and the copy control both read the record, so they are refreshed together
     and from one place. Two places that describe the same record drift the first time one of
     them is forgotten. */
  function stamp(){
    const pill=el("modalState");
    if(pill){
      const st=rec? effStage(rec) : "";
      const arch=rec && rec.archived;
      pill.textContent=arch? t("badge_archived") : (st? stageName(st) : "");
      pill.className="pill"+(arch? "" : (st? " mw-state-"+st : ""));
      pill.hidden=!(arch||st);
    }
    copyState();
  }
  function copyState(){
    const b=el("modalCopy"), why=el("modalWhy");
    const can=!!(rec && isLive(rec));
    if(b) b.disabled=!can;
    if(why){ why.hidden=can; why.textContent=can? "" : t("mw_copy_why"); }
  }

  /* ---- body scroll ------------------------------------------------------
     Fixing the body is what actually holds on iOS, and fixing it loses the scroll position,
     so the position is remembered and put back. A reader who opens a card near the bottom of
     a long board must not be returned to the top of it. */
  function lockScroll(){
    scrollY=window.scrollY||window.pageYOffset||0;
    document.body.style.top=(-scrollY)+"px";
    document.body.classList.add("modal-open");
  }
  function unlockScroll(){
    document.body.classList.remove("modal-open");
    document.body.style.top="";
    try{ window.scrollTo(0, scrollY); }catch(e){}
  }

  function focusables(){
    const f=modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(f, n=>n.offsetParent!==null);
  }

  async function open(slug, tab, title){
    /* A flow not in the registry does not open. WO-013 §7. The registry is the
       only place a multi-step interaction is declared, and declaring one without
       a back, a close and a completion fails the build. */
    const gate=ThriveFlows.canOpen("opportunity");
    if(!gate.ok){ toast(t("fl_blocked")+" "+gate.why); return; }
    tab=tab||"overview";
    opener=document.activeElement;
    current=slug||"";
    rec=null;
    // Loading the record can fail (store read); surface it rather than open a blank window in silence.
    if(current){ try{ rec=(await mergedOpps()).find(x=>x.slug===current)||null; }catch(e){ actionStatus("err", t("act_mount_fail")+" "+errText(e)); } }
    el("modalTitle").textContent=title||(rec&&rec.business)||slug||"";
    stamp();
    await switchTo(tab);
    open_=true;
    modal.hidden=false; scrim.hidden=false;
    // let the browser paint the closed state before the transition starts
    requestAnimationFrame(()=>{ modal.classList.add("on"); scrim.classList.add("on"); });
    lockScroll();
    /* Expired drafts are cleaned on load so the store does not grow. */
    try{ ThriveDrafts.clean(); }catch(e){}
    __histDepth=0; pushStep(current, tab);
    markBaseline();
    showDraftBand();
    const list=focusables();
    if(list.length) try{ list[0].focus(); }catch(e){}
  }

  /* now=true when something else needs a borrowed view in this same tick, which is what a
     navigation is. Waiting out the closing transition first would hand the view back after the
     shell had already decided what to display, and the reader would land on nothing. */
  function close(now, opts){
    if(!open_) return;
    open_=false;
    const band=el("draftBand"); if(band){ band.hidden=true; band.innerHTML=""; }
    __restored=null;
    /* The history entries this window pushed are unwound, so a back gesture
       after it has closed does not walk through tabs of a window nobody can see. */
    if(!(opts&&opts.fromHistory) && __histDepth>0){
      const n=__histDepth; __histDepth=0;
      try{ __histBusy=true; history.go(-n); setTimeout(()=>{ __histBusy=false; }, 0); }catch(e){ __histBusy=false; }
    } else __histDepth=0;
    modal.classList.remove("on"); scrim.classList.remove("on");
    unlockScroll();
    const settle=()=>{ modal.hidden=true; scrim.hidden=true; giveBack(); };
    if(now) settle(); else setTimeout(settle, 200);
    if(opener && opener.focus) try{ opener.focus(); }catch(e){}
    opener=null;
  }

  /* ---- back, and work that survives a dismissal ---------------------------
     Losing a draft by tapping outside the window was the most common frustration
     in the review, and there was no back anywhere. Both are here. §6. */

  /* Every tab and every step pushes a history entry, so the browser back gesture
     moves one step and behaves the way an iPad user expects. The entry carries
     the slug and the tab, so back out of the last tab closes the window rather
     than leaving the reader inside it with nothing to press. */
  let __histDepth=0, __histBusy=false;
  function pushStep(slug, tab){
    if(__histBusy) return;
    __histDepth++;
    try{ history.pushState({ thriveModal:{ slug:slug, tab:tab, d:__histDepth } }, ""); }catch(e){}
  }
  window.addEventListener("popstate", e=>{
    const st=e.state && e.state.thriveModal;
    if(!open_) return;
    __histBusy=true;
    try{
      if(st && st.slug===current){ __histDepth=st.d||0; switchTo(st.tab||"overview"); }
      else { __histDepth=0; close(true, {fromHistory:true}); }
    } finally { setTimeout(()=>{ __histBusy=false; }, 0); }
  });
  function goBack(){
    /* One step, whichever way the reader asked for it, so the button and the
       gesture cannot disagree about where back is. */
    if(__histDepth>0){ try{ history.back(); return; }catch(e){} }
    close();
  }

  /* Nothing a person typed disappears because a finger landed outside a box. */
  const FLOW="opportunity";
  function draftFields(){
    /* Every input inside the window, borrowed views included, keyed by id. A
       field with no id cannot be restored into, so it is not collected. */
    const out={};
    modal.querySelectorAll("input,textarea,select,[contenteditable='true']").forEach(e=>{
      if(!e.id) return;
      if(e.type==="file"||e.type==="hidden") return;
      out[e.id] = (e.getAttribute("contenteditable")==="true") ? e.innerHTML
                : (e.type==="checkbox") ? (e.checked?"1":"") : e.value;
    });
    return out;
  }
  function applyDraftFields(data){
    Object.keys(data||{}).forEach(k=>{
      const e=document.getElementById(k);
      if(!e || !modal.contains(e)) return;
      if(e.getAttribute("contenteditable")==="true") e.innerHTML=data[k];
      else if(e.type==="checkbox") e.checked=!!data[k];
      else e.value=data[k];
      try{ e.dispatchEvent(new Event("input",{bubbles:true})); }catch(_){}
    });
  }
  let __baseline="", __restored=null;
  function markBaseline(){ try{ __baseline=JSON.stringify(draftFields()); }catch(e){ __baseline=""; } }
  function isDirty(){
    try{ return JSON.stringify(draftFields())!==__baseline; }catch(e){ return false; }
  }
  const autosave=ThriveDrafts.debounce(()=>{
    if(!open_) return;
    const data=draftFields();
    if(!ThriveDrafts.isSubstantive(data)) return;
    if(!isDirty()) return;
    ThriveDrafts.save(FLOW, current, data);
  }, ThriveDrafts.DEBOUNCE_MS);
  modal.addEventListener("input", autosave);
  modal.addEventListener("change", autosave);

  function showDraftBand(){
    const band=el("draftBand"); if(!band) return;
    const d=ThriveDrafts.load(FLOW, current);
    if(!d || !ThriveDrafts.isSubstantive(d.data)){ band.hidden=true; band.innerHTML=""; return; }
    const mins=ThriveDrafts.ageMinutes(d);
    band.hidden=false;
    band.innerHTML='<span>'+esc(boardText(getLang(),"df_kept", mins))+'</span>'+
      '<button class="btn ghost sm" type="button" id="dfRestore">'+esc(t("df_restore"))+'</button>'+
      '<button class="btn ghost sm" type="button" id="dfDiscard">'+esc(t("df_discard"))+'</button>';
    const r=el("dfRestore");
    if(r) r.addEventListener("click", ()=>{
      /* Held, not just applied. Panels rebuild their fields when a tab is
         entered, so restoring once puts the work back on the tab you are on and
         loses it on the next one. It is re-applied after every tab render until
         the window closes. */
      __restored=d.data;
      applyDraftFields(d.data); band.hidden=true; band.innerHTML=""; toast(t("df_restored"));
    });
    const x=el("dfDiscard");
    if(x) x.addEventListener("click", ()=>{
      ThriveDrafts.drop(FLOW, current); band.hidden=true; band.innerHTML=""; toast(t("df_discarded"));
    });
  }

  /* Backdrop and Escape ask when there are unsaved changes, and the ask offers
     three answers rather than the usual two, because "keep editing" is the one
     a person actually wants and it was the one missing. */
  async function askBeforeClose(){
    if(!isDirty()) return true;
    const data=draftFields();
    if(!ThriveDrafts.isSubstantive(data)) return true;
    const ans=await threeWay(t("df_ask_h"), t("df_ask_p"),
      [t("df_keep"), t("df_saveclose"), t("df_throw")]);
    if(ans===0) return false;                    // keep editing
    if(ans===1){ ThriveDrafts.save(FLOW, current, data); return true; }
    ThriveDrafts.drop(FLOW, current); return true;
  }

  el("modalBack").addEventListener("click", async ()=>{ if(await askBeforeClose()) goBack(); });
  el("modalClose").addEventListener("click", async ()=>{ if(await askBeforeClose()) close(); });
  el("modalCopy").addEventListener("click", copyLink);
  scrim.addEventListener("click", async ()=>{ if(await askBeforeClose()) close(); });
  modal.querySelectorAll(".modal-tab").forEach(b=>
    b.addEventListener("click", ()=>switchTo(b.getAttribute("data-tab"), {push:true})));
  document.addEventListener("keydown", async e=>{
    if(modal.hidden) return;
    if(e.key==="Escape"){ if(await askBeforeClose()) close(); return; }
    // aria-modal is a promise to assistive technology, and a promise the keyboard has to keep
    // too: without a trap, Tab walks out of the dialog into a board the reader cannot see.
    if(e.key!=="Tab") return;
    const list=focusables();
    if(!list.length) return;
    const first=list[0], last=list[list.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    else if(!modal.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  });
  function currentTab(){
    const on=modal.querySelector(".modal-tab.on");
    return on? on.getAttribute("data-tab") : "overview";
  }
  /* Switching language re-renders only what this window draws itself.
     It must NOT re-run switchTo, and the reason is worth keeping: a borrowed tab resets its
     view to boot markup, resetting calls applyLang so the restored markup is translated,
     applyLang fires every lang hook, and this is one of them. Calling switchTo from here was
     therefore a loop through applyLang that ended in "Maximum call stack size exceeded" and a
     tab strip one click behind itself. A borrowed view has already been retranslated by the
     applyLang that got us here, so there is nothing left for this hook to do to it. */
  onThrive("lang","modal",()=>{
    if(!open_) return;
    stamp();
    const tab=currentTab();
    if(tab==="outreach"){ renderOutreach(rec); return; }   // its own panel retranslates, the composer already did
    if(BORROWED[tab]) return;
    if(tab==="overview") renderOverview(rec);
    else if(tab==="text") renderText(rec);
    else renderHistory(rec);
  });

  /* A move made inside this window changes the record the window is showing, so the window
     re-reads it rather than continuing to display what was true before the click. */
  async function reread(){
    if(!open_ || !current) return;
    // Keep the last good record on a failed re-read, but say the refresh failed rather than swallow it.
    try{ rec=(await mergedOpps()).find(x=>x.slug===current)||rec; }catch(e){ actionStatus("err", errText(e)); }
    stamp();
    const tab=currentTab();
    if(tab==="overview") renderOverview(rec);
    else if(tab==="text") renderText(rec);
    else if(tab==="outreach") renderOutreach(rec);
    else if(tab==="history") renderHistory(rec);
  }
  /* switchTo is exported so the Outreach tab can hand off to the composer
     without leaving the window. Sending it through goTo would close the window
     and lose the reader's place. */
  window.thriveModal={ open:open, close:close, isOpen:()=>open_, reread:reread, tab:switchTo };
  return window.thriveModal;
}
