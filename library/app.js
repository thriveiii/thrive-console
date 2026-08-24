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
/* Campaigns P2 - truthful per-recipient opens. The per-recipient token is a console_mail row id (a
   deterministic key of opp+recipient+subject, so it is known at compile, stable across re-taps, and never
   perturbs the send idempotency), tied to to_addr through its row. It rides two channels:
   1. one standard email open pixel (this GET to the relay carries r);
   2. the page link, tokenized (liveUrl?r=<token>), read by beacon.js.
   The relay writes one console_hits row with data.r = token; attribution is the join
   console_hits.data.r -> console_mail.id -> to_addr. A hit with no token stays an anonymous, campaign
   level view, never guessed onto a person. */
function recipientOpenToken(opp, to, subject){ return sendIdem(String(opp||""), String(to||""), String(subject||""), ""); }
function openPixelHtml(slug, token, ep){
  if(!ep || !token) return "";
  var u=ep+(ep.indexOf("?")<0?"?":"&")+"op=hit&type=open&slug="+encodeURIComponent(slug||"")+"&r="+encodeURIComponent(token);
  // Exactly one 1x1 pixel, standard format, same relay domain already used for page hits; no extra links,
  // the visible body is unchanged. Not display:none (some clients skip hidden images, defeating the open).
  return '<img src="'+esc(u)+'" width="1" height="1" alt="" style="width:1px;height:1px;border:0;margin:0;padding:0" referrerpolicy="no-referrer">';
}
window.recipientOpenToken=recipientOpenToken; window.openPixelHtml=openPixelHtml;
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

/* ---------- P21: the send moment ----------
   A confirmed send earns its own moment, not the generic unsaved-edits dialog. On a dispatched outreach
   send the screen shows an elegant Thrive-identity confirmation: an in-repo inline SVG asterisk mark (the
   signature motif) with a gentle radiate, and one localized line. One tap or a short auto-dismiss returns
   to the board. No dependency, no library; the mark is authored here and the radiate is CSS that respects
   prefers-reduced-motion. The send itself already ran through the confirmed-write path without blocking the
   screen (the button carried the in-progress state); this is only the arrival. */
function sendMomentMark(){
  // The asterisk signature: three strokes through one core, inside two radiating rings. currentColor only,
  // so it takes the card's accent. viewBox 64x64, centred on (32,32). Authored in-repo, no external asset.
  return '<svg class="sm-mark" viewBox="0 0 64 64" width="76" height="76" fill="none" aria-hidden="true" focusable="false">'
    + '<circle class="sm-ring sm-ring-1" cx="32" cy="32" r="13" stroke="currentColor" stroke-width="1.4"/>'
    + '<circle class="sm-ring sm-ring-2" cx="32" cy="32" r="13" stroke="currentColor" stroke-width="1.2"/>'
    + '<g class="sm-rays" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">'
    +   '<line x1="32" y1="17" x2="32" y2="47"/>'
    +   '<line x1="19" y1="24.5" x2="45" y2="39.5"/>'
    +   '<line x1="19" y1="39.5" x2="45" y2="24.5"/>'
    + '</g>'
    + '<circle class="sm-core" cx="32" cy="32" r="3.1" fill="currentColor"/>'
    + '</svg>';
}
/* Show the moment, then call onDone (which returns to the board). Tap anywhere, Enter/Escape, or a short
   timeout all resolve exactly once. It sits above everything and swallows its own keys, so a stray Escape
   lands here and never on the modal's edit-close guard - the generic dialog can never appear on a send. */
function showSendMoment(onDone){
  var prev=document.getElementById("sendMoment"); if(prev){ try{ prev.remove(); }catch(_){} }
  var scrim=document.createElement("div");
  scrim.id="sendMoment"; scrim.className="sm-scrim";
  scrim.setAttribute("role","status"); scrim.setAttribute("aria-live","polite"); scrim.tabIndex=-1;
  scrim.innerHTML='<div class="sm-card">'
    + '<div class="sm-mark-wrap">'+sendMomentMark()+'</div>'
    + '<p class="sm-line" dir="auto">'+esc(t("send_moment_line"))+'</p>'
    + '</div>';
  document.body.appendChild(scrim);
  requestAnimationFrame(function(){ scrim.classList.add("on"); });
  var done=false, tt=0;
  function finish(){
    if(done) return; done=true; clearTimeout(tt);
    scrim.classList.remove("on");
    setTimeout(function(){ try{ scrim.remove(); }catch(_){} if(typeof onDone==="function"){ try{ onDone(); }catch(_){} } }, 240);
  }
  scrim.addEventListener("click", finish);
  scrim.addEventListener("keydown", function(e){ if(e.key==="Escape"||e.key==="Enter"||e.key===" "){ e.stopPropagation(); e.preventDefault(); finish(); } });
  tt=setTimeout(finish, 2600);
  try{ scrim.focus(); }catch(_){}
}
/* After the moment, return to the board. If the composer was borrowed into the card modal, close the modal
   DIRECTLY - close() never asks, so the edit-only dialog is bypassed by construction. Standalone compose is
   a board page, so a plain navigation returns it. The card's lane is already set by the ledger row. */
function returnToBoardAfterSend(){
  try{
    if(window.thriveModal && typeof window.thriveModal.isOpen==="function" && window.thriveModal.isOpen()){
      window.thriveModal.close(true); return;
    }
  }catch(e){}
  try{ goTo("board"); }catch(_){}
}
try{ window.showSendMoment=showSendMoment; }catch(_){}   // test hook; harmless in prod
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
  thrive_email_templates_v1:1, thrive_templates_v1:1, thrive_removed_v1:1, thrive_etpl_seed_v1:1,
  /* R16 (P25): custom missions the operator opened. The seeds are implicit; only custom missions are
     stored, and they travel so a third shelf appears on every device. */
  thrive_missions_v1:1,
  /* R17 (P26): the daily drop's batch records (its documents and the opportunities it produced). The
     documents are the batch's audit trail, evidence about the day's work, so they travel with every device. */
  thrive_batches_v1:1 };
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
/* Who did this. When a real operator is signed in, their Supabase uid stamps the row, so per-operator
   performance is derivable going forward (this is the field WO-013 §10.7 reserved for exactly that).
   With no session the console is single-operator and the reserved default stands, so every historical
   row and every sandbox keeps "thyab" and nothing needs a migration. The profile subsystem reads this
   field, filtered to the signed-in operator, through the one derivation the board and Insights use. */
function currentActor(){
  try{ var u=window.ThriveSupa && ThriveSupa.authUid && ThriveSupa.authUid(); return (u && String(u)) || ACTOR; }catch(e){ return ACTOR; }
}
window.currentActor = currentActor;

/* ---------- one operator-name resolver (WO-029 Phase B) ------------------------
   Every surface that shows an actor (a comment author, a discussion reply, the activity ledger, the
   performance region) resolves the name through this ONE function, so a uid becomes a real name in
   exactly one place and no surface hardcodes a fallback label. The generic label «زميل» lives here and
   here only, returned solely for a uid that resolves to nobody (a genuinely deleted or unknown operator),
   never for a live one.

   The name comes from console_profile_names, a minimal cross-readable projection of console_profiles
   (uid, display_name, email) that any authenticated operator may read (docs/supabase-profile-phase-b.sql);
   the base table stays owner-only, so preferences and memory are never exposed. The map hydrates once on
   sign-in and caches on the device (the Stage-4 pattern). Two floors keep a name on screen even before or
   without that read: the signed-in operator resolves their OWN name from their loaded profile, and a
   comment seeds a floor from the display-name snapshot it already carries, so «زميل» appears only when no
   source anywhere knows the uid. */
var __opNames=null;                                       // { uid: { name, email } }, cross-operator
function operatorNames(){ if(__opNames) return __opNames; try{ __opNames=JSON.parse(localStorage.getItem("thrive_op_names_v1")||"null"); }catch(e){ __opNames=null; } return (__opNames=__opNames||{}); }
function opNamesCacheWrite(m){ try{ localStorage.setItem("thrive_op_names_v1", JSON.stringify(m||{})); }catch(e){} }
function operatorNameSeed(uid, name, email){              // a floor from a snapshot; never overwrites an authoritative entry
  uid=String(uid||"").trim(); if(!uid) return;
  var m=operatorNames(), cur=m[uid]||{};
  name=String(name||"").trim(); email=String(email||"").trim();
  if(!cur.name && name) cur.name=name;
  if(!cur.email && email) cur.email=email;
  m[uid]=cur; __opNames=m;
}
async function hydrateOperatorNames(){
  if(!supaOn()) return operatorNames();
  try{
    var rows=await window.ThriveSupa.rest("console_profile_names", { query:"select=uid,display_name,email" });
    var m=operatorNames();
    (rows||[]).forEach(function(r){ if(r && r.uid){ m[String(r.uid)]={ name:String(r.display_name||"").trim(), email:String(r.email||"").trim() }; } });
    __opNames=m; opNamesCacheWrite(m);
  }catch(e){}
  return operatorNames();
}
function resolveOperator(uid){
  uid=String(uid||"").trim();
  if(!uid) return t("dc_someone");
  if(uid===ACTOR) return t("op_console_history");         // the pre-stamp bucket is a real thing, not a person
  var r=operatorNames()[uid];                             // the authoritative map (the view, plus snapshot floors) wins
  if(r && (r.name||r.email)) return r.name||r.email;
  try{ if(uid===profileUid()){ var me=(profileNow().display_name||"").trim() || profileEmail(); if(me) return me; } }catch(e){}
  return t("dc_someone");                                 // a genuinely deleted or unknown uid only
}
window.resolveOperator = resolveOperator;
window.hydrateOperatorNames = hydrateOperatorNames;

function logActivity(action, slug, detail){
  const a=getActivity();
  a.push({ ts:new Date().toISOString(), action:action||"", slug:slug||"", detail:detail||"",
           actor:currentActor() });
  setActivity(a);
}
window.logActivity = logActivity;

/* ---------- paint instrumentation (Sentinel Sweep 5, Layer 1) -------------------
   The count/lane oscillation is a ghost: it has survived three targeted fixes, which means the root is
   systemic, not one bug. This turns the ghost into evidence. Behind a flag (?debug=paint in the URL, or
   localStorage thrive_debug_paint="1"), every board paint is STAMPED with a sequence number, a timestamp,
   the trigger that caused it (read from the call stack), the source stores it read (local vs the hydrated
   Supabase base), the per-lane counts, and a content hash of the derived model. Two consecutive paints
   with different hashes print DIVERGED, naming which trigger produced which counts, so the two paints
   Thyab captures on the iPad say exactly which reader disagreed. It is cheap (a no-op when the flag is
   off), permanent, and it writes nothing to any store: it only observes the one derived model the board
   already built. This is the ONLY behavioural code in this audit. */
var ThrivePaintDebug=(function(){
  var last=null, seq=0, box=null;
  function enabled(){
    try{ if(/(?:^|[?&])debug=paint(?:&|=|$)/.test(location.search||"")) return true; }catch(e){}
    try{ return localStorage.getItem("thrive_debug_paint")==="1"; }catch(e){ return false; }
  }
  function hashStr(s){ var h=0,i; for(i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return (h>>>0).toString(16); }
  function trigger(){
    try{ var st=((new Error()).stack||"").split("\n").slice(2,9), i, m;
      for(i=0;i<st.length;i++){ m=/at\s+([A-Za-z0-9_.$<>]+)/.exec(st[i]);
        if(m && !/render|build|stamp|trigger|ThrivePaintDebug|Object\.</.test(m[1])) return m[1]; }
      return (st[0]||"?").trim().replace(/^at\s+/,"");
    }catch(e){ return "?"; }
  }
  function sources(){
    var s="local";
    try{ if(typeof supaReadFlagOn==="function" && supaReadFlagOn()) s="supa(flag)"; }catch(e){}
    try{ if(window.__supa && window.__supa.hydrated && !window.__supa.degraded && window.__supa.opps) s="supa(hydrated)+local"; }catch(e){}
    return s;
  }
  function overlay(rec, prev, diverged){
    try{
      if(!box){ box=document.createElement("div"); box.id="paintDebugOverlay";
        // pointer-events:auto and touch momentum so the panel is actually SCROLLABLE on an iPad, where the
        // browser console cannot be read; it is small and cornered so it does not obstruct the board, and
        // it exists only with the debug flag on.
        box.setAttribute("style","position:fixed;inset-block-end:8px;inset-inline-start:8px;z-index:2147483647;max-inline-size:min(92vw,520px);max-block-size:40vh;overflow:auto;-webkit-overflow-scrolling:touch;background:rgba(12,12,16,.94);color:#e8e8ea;font:11px/1.4 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:8px;pointer-events:auto;white-space:pre-wrap;box-shadow:0 4px 24px rgba(0,0,0,.45)");
        document.body.appendChild(box); }
      var line="#"+rec.seq+"  "+rec.kind+"  ["+rec.trigger+"]  src="+rec.src+"  hash="+rec.hash+"\n"+
               "     lanes "+JSON.stringify(rec.lanes)+(diverged? ("\n     DIVERGED from #"+prev.seq+" ("+prev.trigger+", "+prev.hash+")") : "");
      var head=box.firstChild && box.firstChild.nodeType===1 && box.firstChild.__stamp ? null : null;
      var row=document.createElement("div"); row.__stamp=1;
      row.setAttribute("style","padding:3px 0;border-block-end:1px solid rgba(255,255,255,.08)"+(diverged?";color:#ff9db0":""));
      row.textContent=line;
      box.insertBefore(row, box.firstChild);
      while(box.childNodes.length>8) box.removeChild(box.lastChild);
    }catch(e){}
  }
  function stamp(kind, b, meta){
    if(!enabled() || !b || !b.lanes) return;
    seq++;
    var LANES=(window.ThriveBoard && ThriveBoard.LANES) || Object.keys(b.lanes);
    var lanes={}, model=[];
    LANES.forEach(function(k){ var arr=b.lanes[k]||[]; lanes[k]=arr.length;
      model.push(k+":"+arr.map(function(t){ return t.slug; }).sort().join(",")); });
    var counts=(b.summary && b.summary.counts) || {};
    var hash=hashStr(model.join("|")+"#"+JSON.stringify(counts));
    // The orchestrator (Brief A) passes the real trigger name and the resolved authority; fall back to the
    // call-stack read and the live source probe when a caller does not (backward compatible).
    var trig=(meta && meta.trigger) || trigger();
    var src=(meta && meta.src) || sources();
    var rec={ seq:seq, t:new Date().toISOString(), kind:kind, trigger:trig, src:src, lanes:lanes, hash:hash };
    var diverged=!!(last && last.hash!==hash);
    try{ console.log("%c[paint#"+rec.seq+"]","color:#c2185b;font-weight:bold",
        rec.kind, "trigger="+rec.trigger, "src="+rec.src, "lanes="+JSON.stringify(rec.lanes), "hash="+rec.hash,
        diverged? ("DIVERGED from #"+last.seq+" (was "+last.hash+", trigger "+last.trigger+")") : ""); }catch(e){}
    overlay(rec, last, diverged);
    last=rec;
  }
  return { enabled:enabled, stamp:stamp, get last(){ return last; } };
})();
window.ThrivePaintDebug=ThrivePaintDebug;

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
// Lift a tombstone so a re-created record is not removed again by the next sync. Re-import (R13) calls this
// for every slug it writes, so re-dropping a bundle after a delete re-creates the card cleanly (one truth),
// exactly as an undo does.
function liftTomb(kind, id){ const o=tombs(); if(o[kind+":"+id]!=null){ delete o[kind+":"+id]; setTombs(o); } }
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
function setCustomTemplates(a){ const ok=lsSet(TPLSTORE, JSON.stringify(a)); try{ supaMirrorTemplates(a, "page"); }catch(_){} return ok; }
function getCustomTemplate(id){ return getCustomTemplates().find(x=>x.id===id); }
function saveCustomTemplate(rec){ rec.up=Date.now(); const a=getCustomTemplates(); const i=a.findIndex(x=>x.id===rec.id);
  if(i<0 && !rec.type) rec.type=T_EDITABLE;   // a page template is an editable template, typed at creation
  if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setCustomTemplates(a); }
function removeCustomTemplate(id){ markRemoved("tpl", id); setCustomTemplates(getCustomTemplates().filter(x=>x.id!==id)); }

/* ---------- analytics (beacon hits stored same-origin) ---------- */
const HITS = "thrive_hits_v1";
const ENDPT = "thrive_endpoint";
function getHitsLocal(){ try{ return JSON.parse(localStorage.getItem(HITS)||"[]"); }catch(e){ return []; } }
function getHits(){ return getHitsLocal(); }
/* Real analytics come from the relay (a prospect's open only ever exists in THEIR browser
   otherwise). We keep them in their own bucket and merge on read, de-duplicated. */
const RHITS="thrive_hits_remote_v1";
function getRemoteHitsLocal(){ try{ return JSON.parse(localStorage.getItem(RHITS)||"[]"); }catch(e){ return []; } }
function getRemoteHits(){ return getRemoteHitsLocal(); }
function setRemoteHits(a){ try{ localStorage.setItem(RHITS, JSON.stringify(a.slice(-2000))); }catch(e){} try{ supaMirrorHits(a); }catch(_){} }
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
  const inclSelf = !!(opts && opts.includeSelf);
  const collecting = usingCollected();
  /* One durable, deduplicated source: the union of what the relay has collected and what this device
     holds, keyed by hitKey, so an open seen in either place never disappears when a sync round returns
     fewer events or has not run yet. That volatile remote-or-local switch was the open flicker, a card
     reading Opened then Sent across refreshes because outreachOpens saw the open on one read and not the
     next. The sender's own opens and self views are never counted, and while collection is live the old
     untagged local demo hits stay out. */
  const seen={}, out=[];
  // Reading from Supabase (Stage 3+): opens come from the migrated console_hits rows so a card's Opened
  // survives a truncated or retired local store. Otherwise the durable local union, exactly as before.
  const src = __boardPin ? __boardPin.hits : getRemoteHitsLocal().concat(getHitsLocal());
  src.forEach(e=>{
    if(!e) return;
    if(!inclSelf && e.self) return;                 // never the sender's own opens or self views
    if(collecting && e.self===undefined) return;    // legacy untagged local hits are excluded while collecting
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
  /* The green light is "the relay is not older than this build needs", read from
     REQUIRED_RELAY. A relay newer than required is fine (P23: the gate is >=, not
     the strict === this once tested for). */
  out.v4=(out.ver!=null && out.ver>=REQUIRED_RELAY);
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
function setEndpoint(u){ try{ u?localStorage.setItem(ENDPT,u):localStorage.removeItem(ENDPT); }catch(e){} try{ supaMirrorSetting("endpoint", u||""); }catch(_){} }
/* perf: memoise the opens-per-slug map (avoids re-parsing hits for every card each render) */
let __opensCache=null, __opensTs=0;
function opensMap(){
  const now=Date.now();
  // Brief A (F4): while a board cycle has pinned its authority, recompute from that one snapshot and never
  // serve or store the 3s TTL cache, so a cache populated by an earlier paint can never feed a newer one.
  if(!__boardPin && __opensCache && (now-__opensTs)<3000) return __opensCache;
  const m={}; allHits().forEach(e=>{ if(e.type==="open"||!e.type){ m[e.slug]=(m[e.slug]||0)+1; } });
  if(!__boardPin){ __opensCache=m; __opensTs=now; } return m;
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
  if(!__boardPin && __openTimesCache && (now-__openTimesTs)<3000) return __openTimesCache;   // F4: bypass TTL under a pin
  const m={};
  allHits().forEach(e=>{
    if(e.type && e.type!=="open") return;
    const ms=tsMs(e.ts); if(!ms) return;
    (m[e.slug]||(m[e.slug]=[])).push(ms);
  });
  if(!__boardPin){ __openTimesCache=m; __openTimesTs=now; } return m;
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
  if(!__boardPin && __sendCache && (now-__sendTs)<3000) return __sendCache;   // F4: bypass TTL under a pin
  const m={};
  getMailLog().forEach(x=>{
    if(!x || !x.opp) return;
    if(x.direction==="in") return;                        // a reply is not a send
    // A dispatched send counts, so a delivered message ALWAYS moves the card off Ready: sent and copied,
    // and pending (dispatched, delivery not yet confirmed) which resolves to sent or, only on a KNOWN
    // failure, to unsent. queued/failed/unsent do not count: an unsent send never left, so its card stays.
    if(x.status && x.status!=="sent" && x.status!=="copied" && x.status!=="pending") return;
    const r=m[x.opp]||(m[x.opp]={count:0, first:"", last:""});
    r.count++;
    const ts=String(x.ts||"");
    if(ts){ if(!r.first || ts<r.first) r.first=ts; if(ts>r.last) r.last=ts; }
  });
  if(!__boardPin){ __sendCache=m; __sendTs=now; } return m;
}
/* Brief A (F5), scoped to the board: the ONE send definition the board reads for a recipient view is a
   DELIVERED send, sent or copied (or a recorded manual contact), the SAME set the board lane uses
   (stage-model sendInfo). pending is dispatched but not delivered, so a pending-only card is Ready in the
   lane AND carries no recipient view here: the two board derivations can never disagree (the "no email yet,
   one view" impossibility is closed). This is confined to the board's model; the compose and send-once flow
   keep their own pending semantics, which are out of this brief's scope. */
function boardDeliveredSend(o){
  var slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  var rec=(typeof o==="object")? o : getDraft(slug);
  if(rec && Array.isArray(rec.manual_contacts)){
    for(var k=0;k<rec.manual_contacts.length;k++){ if(rec.manual_contacts[k] && rec.manual_contacts[k].sent_on) return true; }
  }
  var log=getMailLog();
  for(var i=0;i<log.length;i++){ var m=log[i];
    if(!m || m.opp!==slug || m.direction==="in") continue;
    if(m.status && m.status!=="sent" && m.status!=="copied") continue;
    return true;
  }
  return false;
}
function boardViews(o){ return boardDeliveredSend(o) ? outreachOpens(o) : 0; }
window.boardViews=boardViews; window.boardDeliveredSend=boardDeliveredSend;
/* The visible outbox: a card with a 'sending' send (email out, server row not confirmed). It is NOT a
   delivered send (sendIndex and boardDeliveredSend exclude it), so the card shows a marker, not Sent. */
function cardSending(o){
  var slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  if(!slug) return false;
  var log=getMailLog();
  for(var i=log.length-1;i>=0;i--){ var m=log[i];
    // 'sending' is one unconfirmed send; 'queued' is a campaign still draining through the server queue (P8).
    // Both are in-flight, so the card carries the one in-flight visual state. 'held' (paused) is not in flight.
    if(m && m.opp===slug && m.direction!=="in" && (m.status==="sending" || m.status==="queued")) return true;
  }
  return false;
}
/* The bounded lifetime of 'sending': a send unconfirmed past this window is a delivered send the server never
   recorded, so the card says so (failed + retry) rather than wait forever. 90s: long enough for a slow round
   trip, short enough that a stuck send never hangs. */
var SEND_CONFIRM_TIMEOUT_MS=90*1000;
/* A card whose send is delivered-but-unrecorded (status 'unrecorded'): the 'failed' visual state. It never
   advances to Sent on its own, shows a retry, and counts as unsynced until the record is written. */
function cardUnrecorded(o){
  var slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  if(!slug) return false;
  var log=getMailLog();
  for(var i=log.length-1;i>=0;i--){ var m=log[i];
    if(m && m.opp===slug && m.direction!=="in" && m.status==="unrecorded") return true;
  }
  return false;
}
window.cardSending=cardSending; window.cardUnrecorded=cardUnrecorded;
function invalidateSends(){ __sendCache=null; invalidateRecon(); }
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
  // INVARIANT I2, evidence-backed lanes: a send is a delivered send RECORD (a ledger row or a recorded
  // manual contact), never a declared word. The old code fabricated a phantom send here from a bare
  // stage==="sent" with no ledger and no manual contact, so a never-sent record that acquired that stamp
  // (an activated page whose manifest defaulted status:"sent", a legacy or corrupt row) derived to the
  // Sent lane and drained Ready. That backdoor is closed: no evidence, no send. A stage stamp cannot mint
  // a send; effStage clamps such a record to Ready (a page exists) or Draft (none).
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
/* The pipeline the library filters by. bounced and failed are derived delivery outcomes, not
   declarable stages (they are never in the stage picker), but they are countable states an
   opportunity can be in, so they appear here between the send outcomes and the closed ones. */
const PIPE_STAGES=["draft","live","sent","opened","bounced","failed","replied","won","lost"];
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
/* The real delivery outcome, reconciled from the relay's bounce signal. The relay's inbox scan records
   a mailer-daemon notice as an inbound `auto` record carrying bounce:"hard" or "soft" (relay
   thrive-relay.gs), attributed to the opportunity. So a non-delivery is already in the ledger; it was
   simply never read back. A hard bounce is a permanent failure to deliver (Bounced); a soft bounce is a
   temporary one the send could not confirm (Failed). A real reply proves delivery and outranks a stale
   bounce, which is why the send/open block checks replied first. */
function bounceFor(o){
  const slug=(typeof o==="string")? o : ((o&&o.slug)||""); if(!slug) return "";
  let hard=false, soft=false;
  inboundFor(slug).forEach(function(r){
    if(r && r.kind==="auto" && r.bounce){ if(r.bounce==="hard") hard=true; else soft=true; }
  });
  return hard? "hard" : (soft? "soft" : "");
}
/* One reply derivation, shared by effStage and causalStatus, so there is literally one function that
   answers "has a reply", not two copies that can disagree. A reply exists for an opportunity when a real
   inbound reply is attributed to it (kind not "auto", which is a bounce notice), or a hand recorded reply
   sits in the ledger (direction "in", or status "replied"). Derived from the records themselves, at read
   time, from whatever store holds them, so a migrated, backfilled or Supabase-read reply counts with no
   stored stamp. */
function hasReply(o){
  const slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  if(!slug) return false;
  // A reply attaches to its parent opp (Part 2): a stranded child slug resolves back to the parent, exactly
  // as the server view does, so the client and the view agree on which card is Replied.
  if(getInbound().some(function(r){ return r && r.kind!=="auto" && resolvedReplyOpp(r)===slug; })) return true;
  return getMailLog().some(function(m){ return m && m.opp===slug && (m.direction==="in" || m.status==="replied"); });
}
// Part 2: the ONE client resolver of a reply's opp key to its parent opportunity. A reply may be keyed to a
// child slug parentSlug--r-<hash> (spawnChildrenFromReplies). When that child has its own card it keeps the
// reply (a group member's card); when the child is stranded (no such card) the reply belongs to the parent,
// the same rule docs/supabase-board-view.sql applies, so the client count and the server view never disagree.
function replyParentOf(oppKey){
  var k=String(oppKey||""); var i=k.indexOf("--r-");
  if(i<0) return k;
  return getDraft(k) ? k : k.slice(0, i);
}
/* THE ONE resolver of a reply row to the opportunity it is attached to, read the same way on every surface
   (the board lane, the card badge, the History row, the Replies inbox, the count). A stored opp resolves
   through replyParentOf (child slug to parent); an EMPTY opp resolves by normalized subject the way the
   server view does (subjectLinkOpp), so a reply the relay wrote with no opp is attached at read time and a
   surface never has to trust the raw, possibly-empty inbound.opp. After this, a reply is linked everywhere
   or unlinked everywhere, never both. An auto notice (a bounce) keeps its own opp and never subject-matches. */
function resolvedReplyOpp(r){
  if(!r) return "";
  var raw=String(r.opp||"");
  if(raw) return replyParentOf(raw);                 // a stored link is trusted (child slug -> parent)
  if(r.kind==="auto" || inboundIsNoise(r)) return ""; // noise never subject-resolves, even if a subject coincides
  return subjectLinkOpp(r);                           // a real reply with no stored opp: resolve by subject
}
window.resolvedReplyOpp=resolvedReplyOpp;
// Part 3: an opportunity's replies, resolved to it, as distinct repliers in arrival order, numbered 1..N.
// Reads the confirmed console_inbound rows (server-hydrated); it never invents a reply. The card badge, the
// inbox numbering and the card's reply list all read THIS, so a reply's number agrees everywhere.
function repliesForOpp(slug){
  slug=(typeof slug==="string")? slug : ((slug&&slug.slug)||"");
  if(!slug) return [];
  var by={};
  getInbound().forEach(function(r){
    if(!r || r.kind==="auto" || resolvedReplyOpp(r)!==slug) return;
    var who=String(r.from||"").trim().toLowerCase(); if(!who) return;
    var ts=String(r.ts||"");
    if(!by[who] || ts<by[who].ts) by[who]={ from:r.from||who, addr:who, ts:ts, subject:r.subject||"", gid:inboundKey(r) };
  });
  return Object.keys(by).map(function(w){ return by[w]; })
    .sort(function(a,b){ return a.ts<b.ts?-1:(a.ts>b.ts?1:0); })
    .map(function(x,i){ x.num=i+1; return x; });
}
function replyCountFor(slug){ return repliesForOpp(slug).length; }
window.repliesForOpp=repliesForOpp; window.replyCountFor=replyCountFor; window.replyParentOf=replyParentOf;
/* Every reply the board attributes, counted once, so the Overview header agrees with the board and the
   campaign and person tables (the "tiles say 0, tables say 1" divergence): an attributed inbound reply
   (kind not "auto", an opp set) lived only in console_inbound, so a header that read the mail ledger alone
   never saw it. Deduped by opportunity and sender, so a person who wrote twice is one reply, and a reply
   present in both stores is not double counted. This is the one derivation both the header and the tables
   read. */
function repliesReceived(){
  var seen={}, n=0;
  getInbound().forEach(function(r){
    if(!r || r.kind==="auto") return;
    var op=resolvedReplyOpp(r); if(!op) return;   // the one resolved link, so the header agrees with the board
    var k=op+"|"+String(r.from||"").trim().toLowerCase();
    if(!seen[k]){ seen[k]=1; n++; }
  });
  getMailLog().forEach(function(m){
    if(!m || !(m.direction==="in" || m.status==="replied")) return;
    var k=String(m.opp||"")+"|"+String(m.to||"").trim().toLowerCase();
    if(!seen[k]){ seen[k]=1; n++; }
  });
  return n;
}
function effStage(o, opensOverride, sendOverride){
  const declared=o.stage||"";
  if(declared && declared!=="sent" && declared!=="replied") return declared;
  // A group campaign aggregates its recipients and NEVER enters Replied: a recipient's reply spawns an
  // individual child that carries the Replied state, so the campaign stays at its best non-reply state.
  // This is checked before the reply derivation, so a reply attributed to the campaign cannot move it.
  if(isGroupOpp(o)) return groupLane(o, opensOverride, sendOverride);
  if(declared==="replied") return "replied";
  // Replied is derived from the reply records, before the send gate, so it is read wherever the inbound
  // rows live and does not depend on a stored stamp. Replied wins over Opened and Sent (checked next).
  if(hasReply(o)) return "replied";
  const s=(sendOverride===undefined)? sendsFor(o) : sendOverride;
  if(!s || !s.count) return isLive(o) ? "live" : "draft";
  // A delivery outcome outranks sent and opened: a message that bounced never reached the inbox, so it
  // was never read, and it must never sit in the Sent lane wearing a successful send.
  const bounce=bounceFor(o);
  if(bounce==="hard") return "bounced";
  if(bounce==="soft") return "failed";
  const op=(opensOverride===undefined)? outreachOpens(o) : (opensOverride||0);
  return op>0 ? "opened" : "sent";
}

/* The board's stage, server-computed. The board reads console_board and buckets by the returned stage;
   it computes no stage of its own (the client-side derivation was the oscillation and the fabrication, so
   it is retired from the board). When the view holds this card, its stage stands verbatim. When the view
   does not hold it (signed out, Supabase unreachable, or a manifest card not yet in the view), the board
   shows the record's OWN state only: a declared terminal stage, else ready if a page or email is prepared,
   else draft. It NEVER re-derives sent/opened/replied from the mail, hits or inbound stores here, because a
   second derivation path is exactly how the board and the server would drift apart again. stage-model's
   laneOf delegates to this for every board card, so the board has one stage authority and only one. */
function baseStage(o){
  if(!o || typeof o!=="object") return "draft";
  var declared=o.stage||"";
  if(declared && declared!=="sent" && declared!=="replied") return declared;   // a declared terminus stands
  return isLive(o) ? "live" : "draft";                                          // else ready (page) or draft
}
function boardViewStage(o){
  if(!o || typeof o!=="object") return "draft";
  var v=boardViewRow(o.slug);
  return v ? (v.stage||baseStage(o)) : baseStage(o);
}
window.boardViewStage=boardViewStage; window.boardViewRow=boardViewRow; window.effStage=effStage;

/* THE ONE STAGE AUTHORITY, read on every surface. The board (laneOf -> hostEffStage) and the card detail
   (the Overview State row, the modal header pill, the closed-reply check) resolve a card's stage through
   THIS and only this: the server view's stage for a card the view holds, else the record's OWN base (a
   declared terminus, else ready or draft). No surface re-derives sent, opened or replied from the local
   mail, hits or inbound stores, so the board lane and the detail badge can never name two different stages
   for one card. This closes the structural gap in "list from the manifest, stage from the view": a manifest
   card absent from the view (it has no console_opps row, so no console_board row) reads draft or ready from
   its own has_page/has_email here, the SAME answer the board's lane gives it, instead of a second reading
   from effStage that the board would contradict. effStage (the local derivation) stays for the standalone
   reference page, the manifest export, and the insights/library grid; the operator-facing DETAIL stage is
   this. */
function resolvedStage(o){ return boardViewStage(o); }
window.resolvedStage=resolvedStage;

// INVARIANT I1/I2: the exported manifest carries a card's TRUE status at export time, derived from
// evidence through effStage, never a blind status:"sent" default. A never-sent card (draft or ready)
// exports no status, so a later re-import can never resurrect a phantom send; a genuinely sent, replied
// or closed card exports its real derived stage, because its evidence justifies the word.
function manifestStatusFor(o){
  const s=effStage(o);
  return LEGACY_DECLARED_STAGES[s] ? s : "";
}

/* ---------- the living card: recipient-level state (P1.5) ----------
   A campaign is one opportunity with many recipients. Each recipient's state derives from the records at
   read time, never stored (the Session 4 law, one level down). Sent, Replied and Bounced derive per
   recipient; Opened is a page signal with no recipient binding (the outreach link is shared, and a hit is
   keyed by page and visitor, not recipient), so it is reported at the campaign aggregate, not per
   recipient, until a per-recipient tracked link exists. That link is a later concern, raised in the PR. */

// The recipient roster of an opportunity: the recipients a group send recorded on it, else the distinct
// addresses its sends went to. Each is { addr, name, lang }. A single-recipient opportunity has one; a
// campaign has many; that count is the only thing that makes a card a group.
function campaignRecipients(o){
  var rec=(typeof o==="string")? getDraft(o) : o;
  var slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  var by={};
  function put(a, name, lang){ a=String(a||"").trim().toLowerCase(); if(!a) return;
    if(!by[a]) by[a]={ addr:a, name:name||"", lang:lang||"" };
    if(name && !by[a].name) by[a].name=name; if(lang && !by[a].lang) by[a].lang=lang; }
  if(rec && Array.isArray(rec.recipients)) rec.recipients.forEach(function(r){ if(r) put(r.addr, r.name, r.lang); });
  getMailLog().forEach(function(m){ if(m && m.opp===slug && m.direction!=="in" && m.to) put(m.to, m.toName||m.greeting, m.lang); });
  return Object.keys(by).map(function(a){ return by[a]; });
}
function isGroupOpp(o){ return campaignRecipients(o).length>1; }

// The best non-reply state across a campaign's recipients: any open puts it in Opened, else Sent; with no
// send it is live or draft. Never replied, never bounced at the group level, those are per recipient.
function groupLane(o, opensOverride, sendOverride){
  var s=(sendOverride===undefined)? sendsFor(o) : sendOverride;
  if(!s || !s.count) return isLive(o) ? "live" : "draft";
  var op=(opensOverride===undefined)? outreachOpens(o) : (opensOverride||0);
  if(op>0) return "opened";
  // Derivation floor: a recipient who replied by definition opened. A group never enters Replied (its child
  // carries that), but it must never read Sent while a reply sits under it, so any reply floors it to Opened.
  if(groupHasAnyReply(o)) return "opened";
  return "sent";
}
// Any real reply under a group: attributed straight to the group (not yet spawned) or to one of its spawned
// children. Read from the same inbound rows the board reads, so the floor and the child card cannot disagree.
function groupHasAnyReply(o){
  var slug=(o&&o.slug)||""; if(!slug) return false;
  var pfx=slug+"--r-";
  return getInbound().some(function(r){
    if(!r || r.kind==="auto") return false;
    return r.opp===slug || String(r.opp||"").indexOf(pfx)===0;
  });
}
// Does this card carry a conversation, so its glow is truthful? Read purely from the existing reply
// derivation (#82/#108): a reply attributed to the card itself (a normal or a spawned child card), or, for
// a group parent that never enters Replied, a reply under one of its children. Presentation reads this to
// set the .has-reply glow class; it is derivation-only, keyed on no address and hardcoded on no card.
function cardHasConversation(slug){
  slug=String(slug||""); if(!slug) return false;
  if(hasReply(slug)) return true;
  var o=getDraft(slug);
  return !!(o && isGroupOpp(o) && groupHasAnyReply(o));
}
function cardSeenHas(slug){ try{ return !!cardSeen()[slug]; }catch(e){ return false; } }
/* THE ONE VISUAL-STATE LAW. Exactly ONE state per card, by priority, each from one named source; every card
   emphasis (and only these) maps to one state. failed (cardUnrecorded, the write-gap) > in-flight
   (cardSending) > new-activity (an unseen reply/open, or an unopened conversation; clears on open) >
   awaiting-action (tk.stalled, a nudge due) > settled (neutral, no emphasis). */
function cardState(tk){
  var slug=(tk&&tk.slug)||"";
  if(!slug) return "settled";
  if(cardUnrecorded(slug)) return "failed";
  if(cardSending(slug))    return "in-flight";
  // new-activity is gated on the resolved lane, the same authority the board read: a card the board places
  // at draft or ready has, by that authority, nothing sent and so nothing answered, so a second store's
  // reply or open never lifts it to new-activity (this is the one-stage-source guarantee, kept here).
  var preSend = tk && (tk.lane==="draft" || tk.lane==="live");
  if(!preSend){
    if(cardNewActivity(slug) > 0) return "new-activity";
    if(cardHasConversation(slug) && !cardSeenHas(slug)) return "new-activity";
  }
  if(tk && tk.stalled) return "awaiting-action";
  return "settled";
}
window.cardState=cardState;

// One child opportunity per replying recipient per campaign, addressed by a deterministic slug so the same
// recipient never spawns twice.
function childSlugFor(parentSlug, addr){
  var a=String(addr||"").trim().toLowerCase(), h=0;
  for(var i=0;i<a.length;i++){ h=((h<<5)-h+a.charCodeAt(i))|0; }
  return String(parentSlug||"")+"--r-"+(h>>>0).toString(36);
}
function childForRecipient(parentSlug, addr){
  var target=childSlugFor(parentSlug, addr);
  return getDrafts().find(function(o){ return o && o.slug===target && o.spawned_from; }) || null;
}

// One recipient's state, derived: sent (a send went out), replied (a reply from this address is attributed,
// on the spawned child or still on the parent), bounced (a bounce names this address). Opened is not per
// recipient. The chip is the strongest state reached: replied, else bounced, else sent.
function recipientState(slug, addr){
  var a=String(addr||"").trim().toLowerCase();
  var sends=getMailLog().filter(function(m){ return m && m.opp===slug && m.direction!=="in" && String(m.to||"").trim().toLowerCase()===a; });
  var last=""; sends.forEach(function(m){ if(String(m.ts||"")>last) last=String(m.ts||""); });
  var child=childForRecipient(slug, a), childSlug=child? child.slug : "";
  var replied=false, replyTs="";
  function scan(list){ list.forEach(function(r){ if(r && r.kind!=="auto" && String(r.from||"").trim().toLowerCase()===a){ replied=true; if(String(r.ts||"")>replyTs) replyTs=String(r.ts||""); } }); }
  if(childSlug) scan(inboundFor(childSlug));
  scan(inboundFor(slug));                                  // a reply not yet spawned still counts
  var bounced=false;
  inboundFor(slug).forEach(function(r){ if(r && r.kind==="auto" && r.bounce && String((r.snippet||"")+" "+(r.subject||"")).toLowerCase().indexOf(a)>=0) bounced=true; });
  if(replyTs>last) last=replyTs;
  return { addr:a, sent:sends.length>0, replied:replied, child:childSlug, bounced:bounced, last:last,
           chip:(replied? "replied" : (bounced? "bounced" : "sent")) };
}

// The one derivation of a campaign's numbers, read by BOTH the card header and Insights, so the two can
// never disagree (the dual-source bug in a new costume). Replies count distinct replying recipients, not
// rows, so a person who wrote twice is one reply.
function campaignStats(slug){
  var recips=campaignRecipients(slug);
  // A queued or held row (P8) is committed but not yet a send, so it is never counted as "sent".
  var sent=getMailLog().filter(function(m){ return m && m.opp===slug && m.direction!=="in" && !mailIsQueuedLike(m); }).length;
  // Opens count the same way Insights counts them: page opens at or after the first send, so a page read
  // before anything went out is never counted as an open (the number the card shows is the Insights number).
  var s0=sendsFor(slug);
  var opens=(s0 && s0.count && typeof opensSince==="function") ? opensSince(slug, s0.first) : opensForSlug(slug);
  var uniq={}; allHits().forEach(function(e){ if(e && e.slug===slug && (!e.type||e.type==="open") && e.vid) uniq[e.vid]=1; });
  var repliers={};
  recips.forEach(function(r){ if(recipientState(slug, r.addr).replied) repliers[r.addr]=1; });
  inboundFor(slug).forEach(function(r){ if(r && r.kind!=="auto" && r.from) repliers[String(r.from).trim().toLowerCase()]=1; });
  var replies=Object.keys(repliers).length;
  // P2 two truths, never summed: token-bearing opens attribute to a person; untokened opens stay anonymous.
  var tokTo={}; getMailLog().forEach(function(m){ if(m && m.opp===slug && m.direction!=="in"){ var id=m.mid||m.id; if(id) tokTo[id]=String(m.to||"").trim().toLowerCase(); } });
  var openers={}, viewsAnon=0;
  allHits().forEach(function(e){
    if(!e || (e.type && e.type!=="open") || e.self) return;
    if(e.r && tokTo[e.r]){ openers[tokTo[e.r]]=1; }          // this open is a named recipient
    else if(e.slug===slug && !e.r){ viewsAnon++; }           // an anonymous, campaign-level page view
  });
  return { recipients:recips.length, sent:sent, opens:opens, unique:Object.keys(uniq).length,
           openersTokened:Object.keys(openers).length, viewsAnon:viewsAnon,
           replies:replies, replyRate: sent? Math.round((replies/sent)*100) : 0 };
}
window.campaignStats=campaignStats;

/* P4 Insights truth: near-duplicate address detection. FLAG ONLY, never merge - the merge is P10, by hand.
   Two addresses are a possible duplicate when they share a local part and differ only by a known typo domain
   or a domain one edit away, or when the whole address is within one edit of another. */
var TYPO_DOMAINS = { "gmial.com":"gmail.com","gmai.com":"gmail.com","gmal.com":"gmail.com","gnail.com":"gmail.com",
  "gmail.co":"gmail.com","hotmial.com":"hotmail.com","hotmal.com":"hotmail.com","yaho.com":"yahoo.com",
  "outlok.com":"outlook.com","iclod.com":"icloud.com" };
function addrDomain(a){ var i=String(a||"").indexOf("@"); return i<0?"":String(a).slice(i+1).toLowerCase(); }
function addrLocal(a){ var i=String(a||"").indexOf("@"); return i<0?String(a||"").toLowerCase():String(a).slice(0,i).toLowerCase(); }
function editDist(a,b){ a=String(a); b=String(b); var m=a.length,n=b.length,d=[],i,j;
  for(i=0;i<=m;i++){ d[i]=[i]; } for(j=0;j<=n;j++){ d[0][j]=j; }
  for(i=1;i<=m;i++) for(j=1;j<=n;j++){ var c=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c); } return d[m][n]; }
// The ONE near-duplicate predicate, shared by the Insights flag (nearDupAddrs) and the Contact Book review
// items (nearDupClusters). Two lowercased addresses are a possible duplicate when they share a local part
// and differ only by a known typo domain or a domain one edit away, or when the whole address is one edit off.
function nearDupPair(A,B){
  A=String(A||"").toLowerCase(); B=String(B||"").toLowerCase(); if(!A||!B||A===B) return false;
  if(addrLocal(A)===addrLocal(B)){
    var dA=addrDomain(A), dB=addrDomain(B);
    if(TYPO_DOMAINS[dA]===dB || TYPO_DOMAINS[dB]===dA || editDist(dA,dB)<=1) return true;
  }
  return editDist(A,B)<=1;
}
function nearDupAddrs(addrs){
  var out={}; addrs=(addrs||[]).filter(Boolean).map(function(a){ return String(a).toLowerCase(); });
  for(var i=0;i<addrs.length;i++) for(var j=i+1;j<addrs.length;j++){
    if(nearDupPair(addrs[i], addrs[j])){ out[addrs[i]]=1; out[addrs[j]]=1; }
  }
  return out;
}
window.nearDupAddrs=nearDupAddrs;
// Connected components of the near-dup graph: each returned cluster is a set of two or more addresses a human
// should review as ONE person. Same predicate as the flag, so a flagged address is exactly a clustered one.
function nearDupClusters(addrs){
  addrs=(addrs||[]).filter(Boolean).map(function(a){ return String(a).toLowerCase(); });
  addrs=addrs.filter(function(a,i){ return addrs.indexOf(a)===i; });          // unique
  var parent={}; addrs.forEach(function(a){ parent[a]=a; });
  function find(x){ while(parent[x]!==x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; }
  function uni(a,b){ parent[find(a)]=find(b); }
  for(var i=0;i<addrs.length;i++) for(var j=i+1;j<addrs.length;j++){
    if(nearDupPair(addrs[i], addrs[j])) uni(addrs[i], addrs[j]);
  }
  var by={}; addrs.forEach(function(a){ var r=find(a); (by[r]||(by[r]=[])).push(a); });
  return Object.keys(by).map(function(k){ return by[k]; }).filter(function(c){ return c.length>1; });
}

/* P4 metric dictionary: every number shown on Insights names its definition and its ONE source, so no
   surface can invent a definition. Opens-by-person and anonymous page views are separate metrics and never
   merge. Documented in docs/insights-metrics.md. */
var INSIGHTS_METRICS = {
  sent:         { def:"messages sent (status sent or copied)",                 source:"console_mail rows, status in (sent,copied)" },
  opens:        { def:"page opens at or after the first send, campaign level",  source:"campaignStats.opens (console_hits)" },
  unique:       { def:"distinct visitor ids that opened the page",              source:"campaignStats.unique (console_hits.vid)" },
  replies:      { def:"distinct replying people, incl. an extracted child",     source:"campaignStats.replies (console_inbound + recipientState)" },
  person_opens: { def:"a person's own token-bearing opens (P2), never the page total", source:"console_hits where data.r is one of the person's send ids" },
  anon_views:   { def:"page opens carrying no token; nobody is named",          source:"campaignStats.viewsAnon (console_hits, no r)" },
  bounces:      { def:"hard/soft delivery failures naming the recipient",       source:"console_inbound kind=auto with bounce" },
  // P27: the per-member oversight numbers. Each is DERIVED from the same stamped stores the board reads,
  // filtered to the member by the actor stamped on the write; no parallel counter, no invented rate.
  reply_rate:   { def:"replies earned over the opportunities the member sent to, whole percent",  source:"replies / distinct opps in console_mail where actor is the member" },
  pages:        { def:"pages the member produced (published or activated)",     source:"console_activity where actor is the member, action publish/activate" },
  edits:        { def:"page edits the member saved",                            source:"console_activity where actor is the member, action edit/save" }
};
window.INSIGHTS_METRICS=INSIGHTS_METRICS;
// P4: a campaign whose reply extracted to a child (D2) shows the reply count AND a note that the
// conversation lives on an individual card, so the campaign row and the person row tell one story.
function campaignChildCount(slug){ return getDrafts().filter(function(o){ return o && o.spawned_from && o.spawned_from.parent===slug; }).length; }

// Per-recipient companion read (D1/D7): one row per campaign recipient carrying only the signals tied to a
// single address - sent_at, opens, the reply (with its thread link: the extracted child, or the reply still
// on the parent), and a bounce naming them. Reads console_mail / console_hits / console_inbound only; no new
// store; the campaign aggregate is untouched and a reply here never lifts the campaign (D2).
// Opens are truthfully per recipient (P2): a send carries a per-recipient token (the console_mail row id) in
// its open pixel and its page link, so a hit whose r is one of this recipient's send ids is this person's
// open. A hit with no token is an anonymous, campaign-level view (campaignStats.viewsAnon) and is NEVER
// counted here, so no open is guessed onto a person. See docs/campaign-phase2.md.
function campaignRecipientLedger(slug){
  slug=String(slug||"");
  // token-bearing opens only, keyed by token; anonymous (no r) opens never enter a person's row
  var openByTok={};
  ((typeof allHits==="function")? allHits() : []).forEach(function(h){
    if(h && (!h.type||h.type==="open") && !h.self && h.r){ (openByTok[h.r]=openByTok[h.r]||[]).push(String(h.ts||"")); }
  });
  return campaignRecipients(slug).map(function(r){
    var a=String(r.addr||"").trim().toLowerCase();
    var sends=getMailLog().filter(function(m){ return m && m.opp===slug && m.direction!=="in" && String(m.to||"").trim().toLowerCase()===a; });
    var sentAt=""; sends.forEach(function(m){ var ts=String(m.ts||""); if(ts && (!sentAt || ts<sentAt)) sentAt=ts; }); // first send to this address
    var st=recipientState(slug, a), child=st.child||"";
    // the reply from this address, on the parent (pre-extraction) or the extracted child (post), latest first
    var reps=inboundFor(slug).concat(child? inboundFor(child) : [])
      .filter(function(x){ return x && x.kind!=="auto" && String(x.from||"").trim().toLowerCase()===a; })
      .sort(function(x,y){ return String(y.ts||"").localeCompare(String(x.ts||"")); });
    var link=child? { child:child } : (reps[0]? { inbound:inboundKey(reps[0]) } : null);
    // opens for THIS recipient: token-bearing hits whose r is one of this recipient's send ids (the token)
    var toks={}; sends.forEach(function(m){ var id=m.mid||m.id; if(id) toks[id]=1; });
    var openTs=[]; Object.keys(toks).forEach(function(k){ (openByTok[k]||[]).forEach(function(ts){ openTs.push(ts); }); });
    var lastOpen=""; openTs.forEach(function(ts){ if(ts>lastOpen) lastOpen=ts; });
    return { addr:a, name:r.name||"", sent:sends.length>0, sent_at:sentAt,
             open_count:openTs.length, last_open_at:lastOpen,
             replied:st.replied, reply_at:(reps[0]? String(reps[0].ts||"") : ""), reply_link:link,
             bounced:st.bounced, child:child };
  });
}
window.campaignRecipientLedger=campaignRecipientLedger;

/* ===================== P8 / D6 + R3: the durable, server-driven send queue =====================
   Starting a campaign writes one console_mail row per recipient (status queued, a jittered due, the
   compiled per-recipient body) and hands the batch to the relay, which paces and sends on a time
   trigger, so a large campaign completes with the operator's device asleep. The client starts, pauses,
   resumes, and watches; it never paces (no client timers), never blasts (one row, one recipient), and
   never counts a row sent before the relay accepts it. The ledger IS the queue: console_mail rows carry
   status queued/held/sent/failed; the relay's store.outbox is the worker's copy, reconciled back here. */
// A queued or held row is committed but not yet a send, so it is never counted as "sent".
function mailIsQueuedLike(m){ var s=(m&&m.status)||""; return s==="queued"||s==="held"; }
// Jitter config: a base gap plus a random spread between consecutive rows, never a fixed beat. Bounded so
// a warm-ramp can widen the gaps but never zero them.
var CAMPAIGN_JITTER={ baseMs:45000, spreadMs:120000, minMs:20000, maxMs:600000 };
var CAMPAIGN_WARM_CAP=40;   // a soft per-day warm-ramp ceiling, stated on screen, never silent
function campaignJitterCfg(o){
  var c=(o&&o.campaign&&o.campaign.jitter)||{};
  var base=Math.max(CAMPAIGN_JITTER.minMs, Math.min(CAMPAIGN_JITTER.maxMs, Number(c.baseMs)||CAMPAIGN_JITTER.baseMs));
  var spread=Math.max(0, Math.min(CAMPAIGN_JITTER.maxMs, c.spreadMs==null?CAMPAIGN_JITTER.spreadMs:Number(c.spreadMs)));
  return { baseMs:base, spreadMs:spread };
}
// Per-recipient due timestamps. Rows fill today up to the day's capacity (the smaller of the remaining
// daily budget and the warm-ramp cap), jittered so no two share a beat; the overflow defers to the next
// window, visibly (day>0). budget gates at queue time, exactly as the brief asks.
function campaignSchedule(o, recipients, quota, nowMs){
  var cfg=campaignJitterCfg(o), now=nowMs||Date.now();
  var warmCap=Math.max(1, Number((o&&o.campaign&&o.campaign.warmCap))||CAMPAIGN_WARM_CAP);
  var dayLeft=(quota && typeof quota.dayLeft==="number")? Math.max(0,quota.dayLeft) : recipients.length;
  var todayCap=Math.max(0, Math.min(dayLeft, warmCap));
  var rows=[], day=0, inDay=0, acc=0;
  for(var i=0;i<recipients.length;i++){
    var cap=(day===0)? todayCap : warmCap;
    if(cap<=0){ day=1; inDay=0; acc=0; cap=warmCap; }          // no budget today: the whole batch defers
    if(inDay>=cap){ day++; inDay=0; acc=0; }                   // this day is full: next window, fresh jitter
    // first row of a day gets a small initial jitter (never an instant blast); each next one base+random later
    var gap=(inDay===0)? Math.floor(Math.random()*cfg.baseMs) : (cfg.baseMs+Math.floor(Math.random()*(cfg.spreadMs+1)));
    acc+=gap;
    rows.push({ addr:recipients[i].addr, name:recipients[i].name||"", lang:recipients[i].lang||"",
                dueMs:now+day*DAY_MS+acc, day:day });
    inDay++;
  }
  return { rows:rows, todayCap:todayCap, warmCap:warmCap, deferred:rows.filter(function(r){return r.day>0;}).length };
}
/* P24: the campaign plan, computed WITHOUT side effects and WITHOUT randomness, so the operator sees the
   deliverability discipline BEFORE a single row is queued: the jitter window, today's budget, the warm-ramp
   cap, how many defer, and an estimated finish. It reuses the SAME warm-cap and jitter constants the real
   scheduler (campaignSchedule) uses, so what is shown is what will run. Only the wall-clock finish is an
   estimate, because the per-row gap is random within its stated band; the day boundaries are exact. This
   adds NO send machinery: it reads the roster and the quota and reports, exactly like the queue would pace. */
function campaignPlan(o, nowMs){
  var now=nowMs||Date.now();
  var recips=campaignRecipients(o);
  var n=recips.length;
  var cfg=campaignJitterCfg(o);
  var warmCap=Math.max(1, Number((o&&o.campaign&&o.campaign.warmCap))||CAMPAIGN_WARM_CAP);
  var quota=(typeof quotaUsage==="function")? quotaUsage() : { dayLeft:n };
  var dayLeft=(quota && typeof quota.dayLeft==="number")? Math.max(0,quota.dayLeft) : n;
  var todayCap=Math.max(0, Math.min(dayLeft, warmCap));
  // The 0-based day index of the LAST recipient: today holds todayCap, each following day holds warmCap.
  var days=0;
  if(n>todayCap) days=1+Math.floor((n-todayCap-1)/warmCap);
  var deferred=Math.max(0, n-todayCap);
  var avgGapMs=cfg.baseMs+Math.floor(cfg.spreadMs/2);
  var rowsLastDay=(days===0)? n : (n-todayCap-(days-1)*warmCap);
  var withinMs=Math.max(0, (rowsLastDay-1))*avgGapMs;
  var finishMs=now+days*DAY_MS+withinMs;
  return { n:n, jitterMinS:Math.round(cfg.baseMs/1000), jitterMaxS:Math.round((cfg.baseMs+cfg.spreadMs)/1000),
           dailyBudget:dayLeft, warmCap:warmCap, todayCap:todayCap, deferred:deferred, days:days, finishMs:finishMs };
}
try{ window.campaignPlan=campaignPlan; }catch(_){}
// The campaign plan as a panel for the campaign screen (the composer, beside Start campaign). Empty for a
// single-recipient opportunity, which has no campaign. Every number is isolated (nIso) so RTL never reorders.
function campaignPlanHtml(o){
  var recips=campaignRecipients(o);
  if(recips.length<2) return "";
  var now=Date.now(), pl=campaignPlan(o, now);
  function line(k, val){ return '<div class="cpl-row"><span class="cpl-k">'+esc(t(k))+'</span><span class="cpl-v">'+val+'</span></div>'; }
  var jitter='<bdi class="n">'+nIso(pl.jitterMinS)+'</bdi>–<bdi class="n">'+nIso(pl.jitterMaxS)+'</bdi> '+esc(t("cpl_sec"));
  var budget='<bdi class="n">'+nIso(pl.todayCap)+'</bdi> / <bdi class="n">'+nIso(pl.dailyBudget)+'</bdi> '+esc(t("cpl_today"));
  var warm='<bdi class="n">'+nIso(pl.warmCap)+'</bdi> '+esc(t("cpl_perday"));
  var finish=pl.deferred
    ? (esc(t("cpl_over"))+' '+fmtRelative("tok_days", pl.days+1))   // localized plural, numeral isolated
    : esc(t("cpl_today_done"));
  return '<section class="cg-panel cpl-panel"><h4 class="cg-h">'+ic("clock")+esc(t("cpl_h"))+' <span class="chip-st"><bdi class="n">'+nIso(pl.n)+'</bdi> '+esc(t("cpl_recips"))+'</span></h4>'+
    line("cpl_jitter", jitter)+line("cpl_budget", budget)+line("cpl_warm", warm)+line("cpl_finish", finish)+
    '<p class="mw-muted cpl-note">'+esc(t("cpl_note"))+'</p></section>';
}
try{ window.campaignPlanHtml=campaignPlanHtml; }catch(_){}
// ── THE compile function: one home for the whole outgoing artifact ──────────────────────────────────
// P9 (D8) collapsed the two P8-era compile entry points (single-send compileArtifact + campaign
// compileCampaignRow) into this ONE `compile(recipient, content)`. Every send and the preview call it, so the
// field merge, the POSTAL footer, the closing block, the tokenized page link, the P2 open pixel, and the
// deterministic idem/open token exist in exactly ONE place. Preview equals sent by construction, not by
// assertion. The composer builds `content` from the live editor (editorContent); the campaign queue builds it
// once from the captured template (buildCampaignTpl). There is no second compile path.
function mergeFieldsInto(str, name, ctx){
  var out=String(str==null?"":str);
  if(name){ out=out.replace(/\{\{\s*NAME\s*\}\}/g, name); }
  else { out=out.replace(/\{\{\s*NAME\s*\}\}/g,"").replace(/[ \t]+([,،.:;!?])/g,"$1").replace(/[ \t]{2,}/g," "); }
  out=out.split("{{BIZ}}").join((ctx&&ctx.business)||"");
  out=out.split("{{LINK}}").join((ctx&&ctx.link)||"");
  out=out.split("{{MONTH}}").join((ctx&&ctx.month)||"");
  return out.replace(/<span data-m="[^"]*"[^>]*>([\s\S]*?)<\/span>/g,"$1");   // the sent body carries clean text, never editor spans
}
/* P23 attachments and rich links. Images are stored in Supabase Storage (console-attachments) and NEVER
   base64-inlined into the body. compile() decides, in ONE place, how each stored image lands, from the
   provider's own limits (Resend: 40 MB total per message), so preview equals sent by construction:
     - at or under ATTACH_INLINE_MAX: a real email attachment (Resend fetches it from the Storage URL via
       `path`, so the relay request stays small);
     - over ATTACH_INLINE_MAX and at or under ATTACH_MAX: a hosted link in the body (a clean labelled link);
     - over ATTACH_MAX: refused with the number, never silently dropped (the composer refuses at add time;
       this is the compile-side floor so a stale draft can never smuggle one through).
   Count and running total are capped too. Every limit is a stated constant, none silent. */
const ATTACH_INLINE_MAX = 5 * 1024 * 1024;    // 5 MB: attach; above this, host and link (deliverability)
const ATTACH_MAX        = 25 * 1024 * 1024;   // 25 MB: a single image larger than this is refused, by number
const ATTACH_TOTAL_MAX  = 40 * 1024 * 1024;   // 40 MB: Resend's per-message ceiling across all attachments
const ATTACH_COUNT_MAX  = 10;                 // a sane count so one message is not a bundle

// The ONE partition. Given the stored attachment list (each already uploaded, with a url + byte size),
// returns which land as real attachments (Resend `path`), which as a hosted link in the body, and which are
// refused (with the limit that refused them). Pure and deterministic, so preview and send agree exactly.
function planAttachments(list){
  var items = Array.isArray(list) ? list : [];
  var attach = [], hosted = [], refused = [], total = 0, count = 0;
  for (var i = 0; i < items.length; i++){
    var a = items[i] || {};
    var size = Number(a.size) || 0;
    var url  = String(a.url || "");
    var name = String(a.filename || a.name || "image");
    if (!url) continue;                                                            // not uploaded: not part of the send
    if (size > ATTACH_MAX)      { refused.push({ filename:name, size:size, reason:"file",  limit:ATTACH_MAX });  continue; }
    if (count >= ATTACH_COUNT_MAX){ refused.push({ filename:name, size:size, reason:"count", limit:ATTACH_COUNT_MAX }); continue; }
    if (size <= ATTACH_INLINE_MAX && total + size <= ATTACH_TOTAL_MAX){
      attach.push({ filename:name, path:url, contentType:a.contentType || "", size:size }); total += size; count++;
    } else {
      hosted.push({ filename:name, url:url, size:size }); count++;                 // too big to attach (or would burst the total): host it
    }
  }
  return { attach:attach, hosted:hosted, refused:refused, totalBytes:total, count:count };
}
try{ window.planAttachments=planAttachments; window.__attachLimits={ inline:ATTACH_INLINE_MAX, max:ATTACH_MAX, total:ATTACH_TOTAL_MAX, count:ATTACH_COUNT_MAX }; }catch(_){}

// A hosted image becomes a clean, labelled link in the body, baked per RECIPIENT language exactly as the
// footer is (an inline ternary, not the UI-lang t()), so a per-recipient compile stays correct.
function attachHostedBlockHtml(list, lang){
  if(!list || !list.length) return "";
  var label = (lang==="ar") ? "عرض الصورة" : "View image";
  var rows = list.map(function(a){
    return '<div style="margin:6px 0"><a href="'+esc(a.url)+'" target="_blank" rel="noopener">'+esc(label)+': '+esc(a.filename)+'</a></div>';
  }).join("");
  return '<div class="att-hosted" style="margin-top:14px">'+rows+'</div>';
}
function attachHostedBlockText(list, lang){
  if(!list || !list.length) return "";
  var label = (lang==="ar") ? "عرض الصورة" : "View image";
  return "\n\n" + list.map(function(a){ return label+": "+a.filename+" "+a.url; }).join("\n");
}

// recipient: { addr, name, lang } (name is the FULL name; first-name-only is applied here from content).
// content:   { innerTpl, subjectTpl, business, link, month, sig, branded, slug, track, tokenSlug, firstName,
//              lang, rawText, attachments } -- the authored message, gathered from the live editor for a
//              send/preview or from the captured template for the campaign queue. compile owns everything
//              downstream of that, including how each attachment lands (attach vs hosted vs refused).
function compile(recipient, content){
  recipient=recipient||{}; content=content||{};
  var full=String(recipient.name==null?"":recipient.name).trim();
  var name=(content.firstName && full)? full.split(/\s+/)[0] : full;   // first-name-only, one place
  var lang=(recipient.lang==="ar" || content.lang==="ar")?"ar":"en";
  var addr=bareAddress(recipient.addr||"");
  var ctx={ business:content.business||"", link:content.link||"", month:content.month||"" };
  var inner=mergeFieldsInto(content.innerTpl, name, ctx);
  var subject=mergeFieldsInto(content.subjectTpl, name, ctx).replace(/^\s+|\s+$/g,"");
  var sig=content.sig||"";
  // P23: partition the attachments ONCE. Hosted images (too big to attach) become a clean link block in the
  // body BEFORE the footer, so preview and send render the exact same body; the attach list rides out to the
  // relay. Refused ones never reach here in a live send (the composer refuses them at add time).
  var plan=planAttachments(content.attachments||[]);
  if(plan.hosted.length) inner=inner+attachHostedBlockHtml(plan.hosted, lang);
  var html=brandWrap(inner, !!content.branded, sig)+ThriveStore.footerHtml(lang);
  // The footer (POSTAL) is attached in exactly ONE place, here, so no send can omit or diverge it.
  var rawText=(content.rawText!=null)? (content.rawText+attachHostedBlockText(plan.hosted, lang)) : toPlainText(inner, sig);
  var text=rawText+ThriveStore.footerText(lang);
  var tokenSlug=(content.tokenSlug!=null)? content.tokenSlug : (content.slug||"");
  var token=content.track ? recipientOpenToken(tokenSlug, addr, subject) : "";
  if(token && content.slug){
    var base=liveUrl(content.slug), tokd=base+(base.indexOf("?")<0?"?":"&")+"r="+encodeURIComponent(token);
    html=html.split(base).join(tokd); text=text.split(base).join(tokd);   // channel 2: the page link carries the token
    html=html+openPixelHtml(content.slug, token, getSyncEndpoint());       // channel 1: one open pixel
  }
  return { to:addr, name:name, subject:subject, html:html, text:text, token:token, lang:lang, inner:inner,
           attachments:plan.attach, hosted:plan.hosted, refused:plan.refused };
}
try{ window.__compile=compile; window.mergeFieldsInto=mergeFieldsInto; }catch(_){}
// The campaign's authored content, shaped for the ONE compile(recipient, content) -- the same content shape
// the composer's editorContent builds for a single send, so a campaign row and a single send compile to the
// exact same bytes for the same recipient (proven by tools/compile_parity_test.py).
function campaignContent(o, tpl){
  tpl=tpl||{};
  return { innerTpl:tpl.html||"", subjectTpl:tpl.subject||"",
           business:(o&&o.business)||"", link:liveUrl((o&&o.slug)||""), month:tpl.month||"",
           sig:tpl.sig||"", branded:!!tpl.branded, slug:(o&&o.slug)||"",
           track:true, firstName:!!tpl.firstName, lang:tpl.lang||"en",
           attachments:(tpl.attachments||[]) };   // P23: the same images every recipient gets, through the one compile

}
try{ window.__campaignContent=campaignContent; }catch(_){}
// Start (or top up) a campaign: write the queued ledger rows, record the day's committed sends against the
// budget, stamp the campaign control state on the opp, and hand the compiled batch to the relay. Returns a
// summary; never sends here.
function startCampaignQueue(slug, tpl){
  var o=getDraft(slug); if(!o) return { ok:false, error:"no opp" };
  var recips=(campaignRecipients(o)||[]).filter(function(r){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(r.addr||"")); });
  if(!recips.length) return { ok:false, error:"no recipients" };
  var quota=(typeof quotaUsage==="function")? quotaUsage() : { dayLeft:recips.length };
  var sched=campaignSchedule(o, recips, quota);
  // Build the authored content ONCE (it is identical for every recipient); compile() merges it per person.
  // Same content shape the composer's editorContent builds, so a campaign row and a single send are one path.
  var content=campaignContent(o, tpl);
  var batch=[], committedToday=0;
  sched.rows.forEach(function(sr){
    var art=compile(sr, content);
    var dueIso=new Date(sr.dueMs).toISOString();
    logMail({ opp:slug, to:sr.addr, toName:sr.name, subject:art.subject, status:"queued",
              mid:art.token, direction:"out", provider:"queue", due:dueIso, campaign:slug,
              preview:(art.text||"").replace(/\s+/g," ").trim().slice(0,120) });
    batch.push({ mid:art.token, opp:slug, campaign:slug, to:sr.addr, toName:sr.name,
                 subject:art.subject, html:art.html, text:art.text, due:dueIso,
                 attachments:(art.attachments&&art.attachments.length? art.attachments : undefined) });
    if(sr.day===0 && typeof recordSend==="function"){ recordSend(); committedToday++; }   // budget counts at queue time
  });
  saveDraft({ slug:slug, campaign:{ state:"sending", started:new Date().toISOString(), n:recips.length,
              warmCap:sched.warmCap, todayCap:sched.todayCap, deferred:sched.deferred } });
  try{ if(typeof pushOutbox==="function") pushOutbox(batch); }catch(_){}   // hand off; the client does not pace
  return { ok:true, n:recips.length, committedToday:committedToday, deferred:sched.deferred, batch:batch.length };
}
// Pause holds the un-sent tail (queued -> held) locally and on the relay; nothing already sent is touched.
function pauseCampaign(slug, reason){
  var log=getMailLogLocal(), n=0;
  log.forEach(function(m){ if(m && m.opp===slug && m.status==="queued"){ m.status="held"; n++; } });
  if(n) setMailLog(log);
  var o=getDraft(slug)||{slug:slug};
  saveDraft({ slug:slug, campaign:Object.assign({}, o.campaign||{}, { state:(reason==="complaint"?"paused-complaint":"paused"), paused_at:new Date().toISOString() }) });
  try{ if(typeof relayOutboxControl==="function") relayOutboxControl(slug, "pause"); }catch(_){}
  return { held:n };
}
// Resume re-queues the held tail with FRESH jitter (a new due per row) and tells the relay the new dues.
function resumeCampaign(slug){
  var o=getDraft(slug); if(!o) return { requeued:0 };
  var log=getMailLogLocal();
  var held=log.filter(function(m){ return m && m.opp===slug && m.status==="held"; });
  if(!held.length){ saveDraft({ slug:slug, campaign:Object.assign({}, o.campaign||{}, { state:"sending" }) }); return { requeued:0 }; }
  var sched=campaignSchedule(o, held.map(function(m){ return { addr:m.to, name:m.toName, lang:m.lang }; }),
                             (typeof quotaUsage==="function")? quotaUsage() : { dayLeft:held.length });
  var dues={};
  held.forEach(function(m,i){ var dueIso=new Date(sched.rows[i].dueMs).toISOString(); m.status="queued"; m.due=dueIso; dues[m.mid||m.id]=dueIso; });
  setMailLog(log);
  saveDraft({ slug:slug, campaign:Object.assign({}, o.campaign||{}, { state:"sending", resumed_at:new Date().toISOString() }) });
  try{ if(typeof relayOutboxControl==="function") relayOutboxControl(slug, "resume", dues); }catch(_){}
  return { requeued:held.length };
}
// Reconcile the ledger from the relay's outbox status: the relay owns each row's outcome. Never downgrades a
// real sent; flips queued/held/sending -> sent/failed and mirrors the terminal rows to the ledger.
function reconcileOutbox(statusRows){
  if(!Array.isArray(statusRows)) return 0;
  var log=getMailLogLocal(), byId={}, changed=0;
  log.forEach(function(m){ if(m){ var id=m.mid||m.id; if(id) byId[id]=m; } });
  statusRows.forEach(function(sr){
    var m=byId[sr.mid]; if(!m) return; var cur=m.status||"";
    if(sr.status==="sent" && cur!=="sent"){ m.status="sent"; if(sr.id) m.id=sr.id; if(sr.sent_at) m.ts=sr.sent_at; if(m.due) delete m.due; changed++; }
    else if(sr.status==="failed" && cur!=="sent"){ m.status="failed"; m.error=sr.error||"send failed"; if(m.due) delete m.due; changed++; }
    else if(sr.status==="held" && cur==="queued"){ m.status="held"; changed++; }
    else if(sr.status==="queued" && cur==="held"){ m.status="queued"; if(sr.due) m.due=sr.due; changed++; }
  });
  if(changed){ setMailLog(log); try{ statusRows.forEach(function(sr){ var m=byId[sr.mid]; if(m && (m.status==="sent"||m.status==="failed")) supaMirrorMail(m); }); }catch(_){} }
  return changed;
}
// The card's live progress: k of N sent, how many queued/held/failed, and when the next row is due.
function campaignProgress(slug){
  var o=getDraft(slug), rows=getMailLog().filter(function(m){ return m && m.opp===slug && m.direction!=="in" && m.provider==="queue"; });
  var sent=0, queued=0, held=0, failed=0, nextDue=0, now=Date.now();
  rows.forEach(function(m){
    var s=m.status||"";
    if(s==="sent"||s==="sending") sent++;
    else if(s==="queued"){ queued++; var d=Date.parse(String(m.due||"")); if(!isNaN(d) && (!nextDue || d<nextDue)) nextDue=d; }
    else if(s==="held") held++;
    else if(s==="failed") failed++;
  });
  var n=(o&&o.campaign&&o.campaign.n)||rows.length;
  var state=(o&&o.campaign&&o.campaign.state)||(rows.length? "sending":"");
  return { n:n, total:rows.length, sent:sent, queued:queued, held:held, failed:failed,
           nextDueMs:nextDue, nextInMs:nextDue? Math.max(0,nextDue-now):0, state:state,
           done:(queued===0 && held===0 && rows.length>0) };
}
try{ window.startCampaignQueue=startCampaignQueue; window.pauseCampaign=pauseCampaign;
     window.resumeCampaign=resumeCampaign; window.reconcileOutbox=reconcileOutbox;
     window.campaignProgress=campaignProgress; window.campaignSchedule=campaignSchedule; }catch(_){}

// A recipient of a group campaign who replies gets exactly one individual child opportunity, linked both
// ways: spawned_from on the child, and the parent's recipient row finds the child by that link. The
// recipient's reply re-points to the child, so the child derives Replied on its own while the parent, a
// group, never does. Idempotent: one child per recipient per campaign, ever; re-running spawns nothing and
// re-points nothing twice (a re-pointed reply now belongs to the child, which is not a group).
function spawnChildrenFromReplies(){
  var spawned=0, pairs={};
  getInbound().forEach(function(r){
    if(!r || !r.opp || r.kind==="auto") return;
    var parent=getDraft(r.opp); if(!parent || !isGroupOpp(parent)) return;
    var a=String(r.from||"").trim().toLowerCase(); if(!a) return;
    pairs[r.opp+"|"+a]={ parentSlug:r.opp, addr:a };
  });
  Object.keys(pairs).forEach(function(k){
    var pr=pairs[k], childSlug=childSlugFor(pr.parentSlug, pr.addr);
    if(getDraft(childSlug)) return;
    var parent=getDraft(pr.parentSlug);
    var roster=campaignRecipients(parent).find(function(x){ return x.addr===pr.addr; }) || { addr:pr.addr, name:"", lang:"" };
    var sendRow=getMailLog().filter(function(m){ return m && m.opp===pr.parentSlug && m.direction!=="in" && String(m.to||"").trim().toLowerCase()===pr.addr; })
      .sort(function(x,y){ return String(y.ts||"").localeCompare(String(x.ts||"")); })[0];
    saveDraft({ slug:childSlug, business:(roster.name||pr.addr), published:!!(parent&&parent.published),
      html:(parent&&parent.html)||"", spawned_from:{ parent:pr.parentSlug, addr:pr.addr }, recipients:[roster],
      lang:roster.lang||(parent&&parent.lang)||"", answered_mid:(sendRow&&(sendRow.mid||sendRow.id))||"", up:Date.now() });
    spawned++;
  });
  var inb=getInbound(), moved=0;
  var next=inb.map(function(r){
    if(!r || !r.opp || r.kind==="auto") return r;
    var parent=getDraft(r.opp); if(!parent || !isGroupOpp(parent)) return r;
    var a=String(r.from||"").trim().toLowerCase(); if(!a) return r;
    var childSlug=childSlugFor(r.opp, a);
    if(getDraft(childSlug)){ moved++; return Object.assign({}, r, { opp:childSlug }); }
    return r;
  });
  if(moved){ setInbound(next); try{ if(__supa.inbound) __supa.inbound=next.slice(); }catch(_){} }
  if(spawned || moved){ try{ invalidateSends(); }catch(_){} try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){} }
  return { spawned:spawned, moved:moved };
}

/* ---------- personalized group send (P1.5) ----------
   One template with a greeting placeholder, rendered per recipient in that recipient's language, so no
   recipient ever sees another's name or a bare placeholder. A recipient with no greeting name is blocked
   for that recipient only, never sent with an empty greeting. */
function greetingFor(recipient){ return recipient && recipient.name ? String(recipient.name).trim() : ""; }
function renderPersonalized(template, recipient){
  var name=greetingFor(recipient);
  if(!name) return { ok:false, reason:"no-greeting", subject:"", html:"" };
  var html=String((template&&template.html)||"").replace(/\{\{\s*NAME\s*\}\}/g, esc(name));
  var subj=String((template&&template.subject)||"").replace(/\{\{\s*NAME\s*\}\}/g, name);
  return { ok:true, name:name, subject:subj, html:html, lang:(recipient.lang||(template&&template.lang)||"") };
}
// The pre-send review: every recipient, the greeting that will be used, and whether it is blocked, so the
// name-to-address mapping is confirmed before a single message goes out.
function groupSendPlan(recipients, template){
  return (recipients||[]).map(function(r){
    var g=renderPersonalized(template, r);
    return { addr:r.addr, name:greetingFor(r), lang:r.lang||(template&&template.lang)||"", blocked:!g.ok, reason:g.ok? "" : g.reason };
  });
}
/* P6 / D4: "Personalize names", the display side of the {{NAME}} merge (R2). The backend above
   (renderPersonalized, greetingFor) still blocks a nameless recipient from an actual send; these
   pure helpers add only what the composer and the pre-send roster SHOW: the greeting each recipient
   will read, with the name merged in, or, for a nameless recipient, the token removed cleanly. The
   send path is untouched (P7). One token spelling only: {{NAME}}. */
// The greeting forms the chip recognizes, EN and AR. Longer forms first so a multi-word greeting
// (Good day, أهلا وسهلا) matches whole, not only its first word.
var GREET_FORMS=["Good day","Hello","Hi","Dear","أهلا وسهلا","مرحبا","يوم سعيد","عزيزي"];
function greetingHeadRe(){
  var alt=GREET_FORMS.map(function(g){ return g.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }).join("|");
  return new RegExp("^([ \\t]*)(?:"+alt+")","i");
}
// Remove the {{NAME}} token and heal the seam: a space stranded before a comma or a stop collapses,
// and a double space becomes one. So "Hi {{NAME}}," with no name reads "Hi," and never "Hi ,".
function stripNameTokenClean(s){
  return String(s==null?"":s)
    .replace(/\{\{\s*NAME\s*\}\}/g,"")
    .replace(/[ \t]+([,،.:;!?])/g,"$1")
    .replace(/[ \t]{2,}/g," ")
    .replace(/[ \t]+$/g,"");
}
// The greeting a recipient will actually read: the name merged in, or, for a nameless recipient, the
// token removed cleanly. Pure; used by the pre-send roster and the editor, never by the send.
function mergeGreetingLine(line, name){
  var s=String(line==null?"":line), nm=(name==null?"":String(name)).trim();
  return nm ? s.replace(/\{\{\s*NAME\s*\}\}/g, nm) : stripNameTokenClean(s);
}
try{ window.stripNameTokenClean=stripNameTokenClean; window.mergeGreetingLine=mergeGreetingLine;
     window.greetingHeadRe=greetingHeadRe; window.GREET_FORMS=GREET_FORMS; }catch(_){}

/* ---------- the quiet update badge (P1.5, minimal) ----------
   New opens or replies on a card since its panel was last opened. Last-seen is local presentation state,
   per device, never a stored stage: it decides only whether a small badge shows, not what a card IS. */
var CARD_SEEN="thrive_card_seen_v1";
function cardSeen(){ try{ return JSON.parse(localStorage.getItem(CARD_SEEN)||"{}"); }catch(e){ return {}; } }

// P3/R6: ONE recency clock, imported by every lane sort. A timestamp field (console_hits.ts and the rest)
// is TEXT; parse it explicitly, and a malformed value sorts LAST (0) rather than throwing.
function parseTs(ts){ var ms=Date.parse(String(ts==null?"":ts)); return isNaN(ms)? 0 : ms; }
// The card's most recent meaningful activity, as ms: the latest of our sends, a token-bearing open (a real
// person, P2), an inbound reply or bounce, and a stage change (the activity log). No per-card special case.
function lastActivityAt(o){
  var slug=(typeof o==="string")? o : ((o&&o.slug)||"");
  if(!slug) return 0;
  var latest=0; function bump(ts){ var ms=parseTs(ts); if(ms>latest) latest=ms; }
  getMailLog().forEach(function(m){ if(m && m.opp===slug) bump(m.ts); });
  inboundFor(slug).forEach(function(r){ if(r) bump(r.ts); });
  allHits().forEach(function(e){ if(e && e.slug===slug && (!e.type||e.type==="open") && e.r) bump(e.ts); });
  getActivity().forEach(function(a){ if(a && a.slug===slug) bump(a.ts); });
  return latest;
}
window.lastActivityAt=lastActivityAt;

// P3/R5: the acknowledgment is SERVER-held. last_viewed_at rides the opp record (data, additive), so a card
// seen on one device is seen on all. The local cardSeen map is only a fast offline mirror; whichever ack is
// newer wins, so the record is authoritative once it syncs.
function lastViewedAt(slug){
  var rec=getDraft(slug), srv=(rec && rec.last_viewed_at)? String(rec.last_viewed_at) : "";
  var loc=""; try{ loc=cardSeen()[slug]||""; }catch(e){}
  return srv>loc ? srv : loc;
}
window.lastViewedAt=lastViewedAt;
// Opening the card advances the view timestamp; that, by definition, clears the badge (no stored badge flag
// anywhere). It writes the local mirror always, and the opp record so the ack holds across devices.
function markCardSeen(slug){ if(!slug) return; var now=new Date().toISOString();
  try{ var m=cardSeen(); m[slug]=now; localStorage.setItem(CARD_SEEN, JSON.stringify(m)); }catch(e){}
  try{ if(getDraft(slug)) saveDraft({ slug:slug, last_viewed_at:now }); }catch(e){}   // server-held, cross-device
}
window.markCardSeen=markCardSeen;
// How many opens and replies a card has seen since it was last opened. A child counts its own recipient's
// slice; a normal or group card counts its slug's inbound replies and page opens.
function cardNewActivity(slug){
  var sinceMs=parseTs(lastViewedAt(slug));
  var n=0;
  // distinct new events since the owner last viewed: replies, bounces, and opens BY A PERSON (a token-
  // bearing hit whose r is one of this card's send ids, P2). An anonymous page view never lights the badge.
  // Compared on the parsed ms clock (parseTs), so a malformed timestamp is never counted as newer.
  inboundFor(slug).forEach(function(r){ if(r && r.kind!=="auto" && parseTs(r.ts)>sinceMs) n++; });
  inboundFor(slug).forEach(function(r){ if(r && r.kind==="auto" && r.bounce && parseTs(r.ts)>sinceMs) n++; });
  var toks={}; getMailLog().forEach(function(m){ if(m && m.opp===slug && m.direction!=="in"){ var id=m.mid||m.id; if(id) toks[id]=1; } });
  allHits().forEach(function(e){ if(e && (!e.type||e.type==="open") && !e.self && e.r && toks[e.r] && parseTs(e.ts)>sinceMs) n++; });
  var self=getDraft(slug);
  if(self && self.spawned_from && self.spawned_from.parent){
    var pa=String(self.spawned_from.addr||"").trim().toLowerCase();
    inboundFor(self.spawned_from.parent).forEach(function(r){ if(r && r.kind!=="auto" && String(r.from||"").trim().toLowerCase()===pa && parseTs(r.ts)>sinceMs) n++; });
  }
  return n;
}
window.cardNewActivity=cardNewActivity;
// The most recent new item on a card since it was last opened, so the badge can land ON it: a reply opens
// the thread scrolled to that reply, an open opens the overview scrolled to the opens summary. Reply wins a
// tie because it is the higher call to action.
function cardNewTarget(slug){
  var since=lastViewedAt(slug), newest=null;
  function consider(t){ if(!newest || t.ts>newest.ts) newest=t; }
  function scanReplies(s){ inboundFor(s).forEach(function(r){ if(r && r.kind!=="auto" && String(r.ts||"")>since) consider({ kind:"reply", tab:"history", id:inboundKey(r), ts:String(r.ts) }); }); }
  scanReplies(slug);
  var self=getDraft(slug);
  if(self && self.spawned_from && self.spawned_from.parent){
    var pa=String(self.spawned_from.addr||"").trim().toLowerCase();
    inboundFor(self.spawned_from.parent).forEach(function(r){ if(r && r.kind!=="auto" && String(r.from||"").trim().toLowerCase()===pa && String(r.ts||"")>since) consider({ kind:"reply", tab:"history", id:inboundKey(r), ts:String(r.ts) }); });
  }
  var toks={}; getMailLog().forEach(function(m){ if(m && m.opp===slug && m.direction!=="in"){ var id=m.mid||m.id; if(id) toks[id]=1; } });
  var lastOpen="";
  allHits().forEach(function(e){ if(e && (!e.type||e.type==="open") && !e.self && e.r && toks[e.r] && String(e.ts||"")>since && String(e.ts)>lastOpen) lastOpen=String(e.ts); });
  if(lastOpen && (!newest || lastOpen>newest.ts)) consider({ kind:"open", tab:"overview", id:"", ts:lastOpen });
  return newest;
}

/* ---------- per-operator memory (P1.6) ----------
   Each operator carries their own UI preferences, keyed to their Supabase user id, so the console
   calibrates per person: language, and the board's own view state (the tray, the active lane). This is
   view state, NOT access: equal rights on data still holds (P2). No new column or table is needed, the
   prefs ride the existing console_settings (key/value jsonb) as one row per operator, key op_prefs:<uid>.
   The console reads only the signed-in operator's own row, so one operator's view never leaks to another. */
var __opPrefs=null, __opApplying=false, __opSaveTimer=null;
function opPrefsKey(){ try{ var u=window.ThriveSupa && window.ThriveSupa.authUid && window.ThriveSupa.authUid(); return u ? ("op_prefs:"+u) : ""; }catch(e){ return ""; } }
async function opPrefsLoad(){
  var key=opPrefsKey(); if(!key || !supaOn()) return;
  try{
    var rows=await window.ThriveSupa.rest("console_settings", { query:"key=eq."+encodeURIComponent(key)+"&select=value" });
    __opPrefs=(rows && rows[0] && rows[0].value) || {};
  }catch(e){ __opPrefs=__opPrefs||{}; return; }
  __opApplying=true;                                       // applying must not write back and loop
  try{
    if(__opPrefs.lang==="ar" || __opPrefs.lang==="en"){ try{ localStorage.setItem("thrive_lang", __opPrefs.lang); }catch(_){} if(typeof setLang==="function") try{ setLang(__opPrefs.lang); }catch(_){} }
    if(__opPrefs.board && typeof __opPrefs.board==="object"){ try{ localStorage.setItem("thrive_board_v1", JSON.stringify(__opPrefs.board)); }catch(_){} }
  }catch(e){}
  __opApplying=false;
  try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){}
}
function opPrefRemember(k, v){
  if(__opApplying) return;
  var key=opPrefsKey(); if(!key || !supaOn()) return;     // only a signed-in operator has a memory
  __opPrefs=__opPrefs||{}; __opPrefs[k]=v;
  if(__opSaveTimer) clearTimeout(__opSaveTimer);
  __opSaveTimer=setTimeout(function(){ try{ window.ThriveSupa.upsert("console_settings", { key:key, value:__opPrefs }).catch(function(){}); }catch(e){} }, 400);
}

/* ---------- the operator profile (WO-029 Phase A) ------------------------------
   One row per operator in console_profiles, keyed to their auth.uid(), holding preferences and memory
   as JSON. RLS scopes each row to its owner (docs/supabase-operator-profile.sql), so an operator reads
   and writes only their own. It follows the Stage-4 pattern: read on sign-in, cache on device, write
   debounced. On the first read it defaults from the existing op_prefs:<uid> row and the shared
   signature, so no operator loses what they had (D2: the signature is per-operator from here on,
   seeded by what was shared). The owner tier is a database fact: console_members carries the role
   (owner | member) per operator, readable only for one's own uid (RLS read_own) and writable by no
   client, so the tier can never be self-granted and no owner address is ever a client literal. The
   legacy console_admins table is honored too when present, but console_members.role is the authority. */
var __profile=null, __profileLoaded=false, __adminTier=null, __profSaveT=null;
function profileUid(){ try{ return (window.ThriveSupa && ThriveSupa.authUid && ThriveSupa.authUid()) || ""; }catch(e){ return ""; } }
function profileEmail(){ try{ return (window.ThriveSupa && ThriveSupa.authEmail && ThriveSupa.authEmail()) || ""; }catch(e){ return ""; } }
function profileCacheKey(){ var u=profileUid(); return u? ("thrive_profile:"+u) : ""; }
function profileCacheRead(){ try{ var k=profileCacheKey(); return k? (JSON.parse(localStorage.getItem(k)||"null")) : null; }catch(e){ return null; } }
function profileCacheWrite(p){ try{ var k=profileCacheKey(); if(k) localStorage.setItem(k, JSON.stringify(p||{})); }catch(e){} }
function profileDefaults(){
  var prefs={};
  try{ if(__opPrefs && __opPrefs.lang) prefs.lang=__opPrefs.lang; }catch(e){}
  try{ prefs.sig_en=signatureFor("EN"); prefs.sig_ar=signatureFor("AR"); }catch(e){}
  return { prefs:prefs, memory:{} };
}
async function loadProfile(){
  var uid=profileUid();
  if(!uid || !supaOn()){ __profile=profileCacheRead()||profileDefaults(); __profileLoaded=true; return __profile; }
  var row=null;
  try{ var rows=await window.ThriveSupa.rest("console_profiles", { query:"uid=eq."+encodeURIComponent(uid)+"&select=uid,email,display_name,avatar,prefs,memory,created_at" }); row=rows && rows[0]; }catch(e){ row=null; }
  if(row){ __profile={ uid:uid, email:row.email||profileEmail(), display_name:row.display_name||"", avatar:row.avatar||"", prefs:row.prefs||{}, memory:row.memory||{}, created_at:row.created_at||"" }; }
  else {
    // First sign-in on this account: seed from the op_prefs defaults and write the row once so it exists.
    var d=profileDefaults();
    __profile={ uid:uid, email:profileEmail(), display_name:"", avatar:"", prefs:d.prefs, memory:d.memory };
    try{ window.ThriveSupa.upsert("console_profiles", { uid:uid, email:profileEmail(), prefs:d.prefs, memory:d.memory, updated_at:new Date().toISOString() }).catch(function(){}); }catch(e){}
  }
  __profileLoaded=true; profileCacheWrite(__profile);
  return __profile;
}
function profileNow(){ return __profile || profileCacheRead() || profileDefaults(); }
function profilePref(k, dflt){ var p=profileNow(); return (p.prefs && p.prefs[k]!==undefined) ? p.prefs[k] : dflt; }
function profileMem(k, dflt){ var p=profileNow(); return (p.memory && p.memory[k]!==undefined) ? p.memory[k] : dflt; }
function profileWrite(patch){
  var uid=profileUid(); if(!uid) return;                 // only a signed-in operator has a profile
  __profile=__profile||profileDefaults(); __profile.uid=uid; __profile.email=__profile.email||profileEmail();
  Object.assign(__profile, patch);
  profileCacheWrite(__profile);
  if(!supaOn()) return;
  if(__profSaveT) clearTimeout(__profSaveT);
  __profSaveT=setTimeout(function(){ try{ window.ThriveSupa.upsert("console_profiles", { uid:uid, email:__profile.email, display_name:__profile.display_name||"", avatar:__profile.avatar||"", prefs:__profile.prefs||{}, memory:__profile.memory||{}, updated_at:new Date().toISOString() }).catch(function(){}); }catch(e){} }, 400);
}
function setProfilePref(k, v){ var p=profileNow(); var prefs=Object.assign({}, p.prefs); prefs[k]=v; profileWrite({ prefs:prefs }); }
function setProfileMem(k, v){ var p=profileNow(); var mem=Object.assign({}, p.memory); mem[k]=v; profileWrite({ memory:mem }); }
function setProfileField(k, v){ var patch={}; patch[k]=v; profileWrite(patch); }

/* ---------- namespaced, versioned memory and preference keys (WO-029 Phase B) ----------
   Preferences and memory live under namespaced, versioned keys inside the same two jsonb columns:
   memory.pins.v1, memory.hints.v1, memory.notes.v1, prefs.signature.v1, and so on. A future need ADDS a
   key (a new namespace, or a .v2 alongside a .v1), it never migrates a table, so the shape carries
   whatever comes next without a schema change. The docs/PROFILE.md convention documents this. Reads fall
   back to the legacy flat key (memory.pins), so nothing an operator already saved is ever lost; writes
   always land on the versioned key from here on. */
var PROFILE_KEY_V="v1";
function nsKey(ns){ return ns+"."+PROFILE_KEY_V; }
function profileMemNS(ns, dflt){ var m=(profileNow().memory)||{}; var vk=nsKey(ns);
  if(m[vk]!==undefined) return m[vk]; if(m[ns]!==undefined) return m[ns]; return dflt; }
function setProfileMemNS(ns, v){ setProfileMem(nsKey(ns), v); }
function profilePrefNS(ns, dflt){ var pr=(profileNow().prefs)||{}; var vk=nsKey(ns);
  if(pr[vk]!==undefined) return pr[vk]; if(pr[ns]!==undefined) return pr[ns]; return dflt; }
function setProfilePrefNS(ns, v){ setProfilePref(nsKey(ns), v); }
window.ThriveProfileKeys = { mem:profileMemNS, setMem:setProfileMemNS, pref:profilePrefNS, setPref:setProfilePrefNS, ns:nsKey };
async function loadAdminTier(){
  var uid=profileUid();
  if(!uid || !supaOn()){ __adminTier=false; __adminTierResolved=false; return false; }
  var owner=false;
  // Primary authority: this operator's own role in console_members (RLS read_own permits reading one's own
  // row). This is the live source of the owner tier. console_admins is a LEGACY optional table, probed only
  // if console_members did not already establish the tier, so a project without it works and one with it
  // still honors it. Either way the tier is a database fact, never a client literal or a self-granted flag.
  try{ var mrows=await window.ThriveSupa.rest("console_members", { query:"id=eq."+encodeURIComponent(uid)+"&select=role" });
       if(mrows && mrows.length && mrows[0] && mrows[0].role==="owner") owner=true; }catch(e){}
  if(!owner){ try{ var arows=await window.ThriveSupa.rest("console_admins", { query:"uid=eq."+encodeURIComponent(uid)+"&select=uid" });
       if(arows && arows.length) owner=true; }catch(e){} }
  __adminTier=owner; __adminTierResolved=true; return __adminTier;
}
function isOwnerTier(){ return __adminTier===true; }
// Whether the owner tier has been established from the database yet (as opposed to the null "not asked" and
// the false "asked, not owner"). The router uses this so a slow or failed role read never BOUNCES a possible
// owner: an owner-only route is refused outright only once the role is resolved-and-not-owner.
var __adminTierResolved=false;
function ownerTierResolved(){ return __adminTierResolved===true; }
try{ window.ownerTierResolved=ownerTierResolved; }catch(_){}

/* The operator's own numbers, from the SAME derivation the board and Insights use, filtered to the
   operator by the actor stamped on the send (currentActor). No parallel store: opens and replies come
   through outreachOpens / hasReply, exactly as the board reads them, so a person's numbers can never
   disagree with the board. A new operator with no sends of their own reads honest zeros; the fuller
   cadence and outcomes-over-time are Phase B. */
var CLOSE_ACTIONS={ lc_mark_won:1, lc_mark_lost:1, lc_drop:1 };   // the three terminal moves
function operatorStats(actor){
  actor=actor||currentActor();
  var mail=getMailLog();
  var mine=mail.filter(function(m){ return m && m.actor===actor && m.direction!=="in" && m.status==="sent"; });
  var oppSet={}; mine.forEach(function(m){ if(m.opp) oppSet[m.opp]=1; });
  var opps=Object.keys(oppSet), opens=0, replies=0;
  opps.forEach(function(slug){ try{ opens+=outreachOpens(slug)||0; if(hasReply(slug)) replies++; }catch(e){} });
  var acts=getActivity().filter(function(a){ return a && a.actor===actor && /^lc_/.test(a.action||""); });
  var moved=acts.length;
  var closed=acts.filter(function(a){ return CLOSE_ACTIONS[a.action]; }).length;
  // Reply rate is replies over the opportunities this operator actually sent to, the same denominator the
  // board reasons about, as a whole percent. No sends means no rate, an honest zero, never a divide.
  var replyRate=mine.length ? Math.round((replies/opps.length)*100) : 0;
  // Cadence: this operator's own sends per day over the last week, from the SAME stamped ledger, so the
  // 3-a-day rhythm reads straight off the record. The series is oldest to newest, keyed by ISO day.
  var byDay={}; mine.forEach(function(m){ var d=String(m.ts||"").slice(0,10); if(d) byDay[d]=(byDay[d]||0)+1; });
  var cadence=[]; var today=new Date();
  for(var i=6;i>=0;i--){ var dt=new Date(today.getTime()-i*86400000); var key=dt.toISOString().slice(0,10);
    cadence.push({ day:key, n:byDay[key]||0 }); }
  return { sent:mine.length, opps:opps.length, opens:opens, replies:replies, moved:moved,
           closed:closed, replyRate:replyRate, cadence:cadence };
}
window.operatorStats = operatorStats;
/* The honest pre-stamp bucket: everything recorded before real per-operator stamping began carries the
   reserved default actor ("thyab"), so it is reported as ONE labeled bucket (console history), never split
   into or fabricated as any real operator's numbers. Returns null when there is nothing pre-stamp to show. */
function consoleHistoryStats(){
  var s=operatorStats(ACTOR);
  return (s.sent || s.moved) ? s : null;
}
window.consoleHistoryStats = consoleHistoryStats;

/* ---------- the operations ledger (WO-029 Phase B) ----------------------------
   One per-operator timeline, DERIVED from the two stores the system already keeps, never a second copy: a
   send reads from the stamped mail ledger, every other action from the stamped activity log. Both carry
   the operator, so the ledger is attribution over existing rows. Kinds: send, move (a lifecycle move, a
   stage change, a reassign or remove), comment, page (publish, activation, page removal). Anything else is
   kept honestly under "other" and shows only in the unfiltered view. Newest first, filterable, paged. */
function opLedgerKind(action){
  action=String(action||"");
  if(/^(email|send|sent|resend)$/.test(action)) return null;             // a send is read from the mail ledger, not doubled here
  if(/^comment/.test(action)) return "comment";                          // comment_add, comment_del
  if(/^(publish|unpublish|lc_publish|activate|retire_page|tpl_remove|etpl_remove)$/.test(action)) return "page";
  if(/^lc_/.test(action) || action==="stage" || action==="reassign" || action==="remove") return "move";
  return "other";
}
function operatorLedger(actor, opts){
  actor=actor||currentActor(); opts=opts||{};
  var rows=[];
  getMailLog().forEach(function(m){
    if(!m || m.actor!==actor || m.direction==="in" || m.status!=="sent") return;
    rows.push({ kind:"send", ts:m.ts||"", opp:m.opp||"", action:"send", detail:m.to||m.subject||"" });
  });
  getActivity().forEach(function(a){
    if(!a || a.actor!==actor) return;
    var k=opLedgerKind(a.action); if(!k) return;
    rows.push({ kind:k, ts:a.ts||"", opp:a.slug||"", action:a.action||"", detail:a.detail||"" });
  });
  rows.sort(function(x,y){ return String(y.ts||"").localeCompare(String(x.ts||"")); });   // newest first
  var kind=opts.kind||"all";
  if(kind!=="all") rows=rows.filter(function(r){ return r.kind===kind; });
  var total=rows.length, limit=opts.limit||0;
  return { rows:(limit>0? rows.slice(0, limit) : rows), total:total };
}
window.operatorLedger = operatorLedger;
window.ThriveProfile = { load:loadProfile, now:profileNow, pref:profilePref, mem:profileMem,
  setPref:setProfilePref, setMem:setProfileMem, setField:setProfileField,
  loadTier:loadAdminTier, isOwner:isOwnerTier, uid:profileUid, email:profileEmail, stats:operatorStats };

/* ---------- P27: members, roles, and the per-member oversight numbers -----------------------------
   The console is multi-user. A member's identity is their Supabase auth.uid() (currentActor()); the roster
   and role live in console_members (owner | member). Two roles only. The owner sees the oversight room; a
   member sees only their own performance. Every number here is DERIVED from the same stamped stores the
   board reads, filtered to the member by the actor on the write: no parallel counter, no invented rate. The
   roster read is owner-scoped at the database (RLS); the UI gates the room and a member's view to own data.
   This is authored natively for Thrive; nothing is read from or reused out of any other project. */
var MEMBERS_KEY="thrive_members_v1";                       // a local cache of the roster projection (read-only)
var __members=null;
function membersCache(){ if(__members) return __members; try{ __members=JSON.parse(localStorage.getItem(MEMBERS_KEY)||"null"); }catch(e){ __members=null; } return (__members=Array.isArray(__members)?__members:null); }
function membersCacheWrite(list){ __members=Array.isArray(list)?list:[]; try{ localStorage.setItem(MEMBERS_KEY, JSON.stringify(__members)); }catch(e){} }
async function hydrateMembers(){
  if(!supaOn()) return membersDerived();
  try{
    var rows=await window.ThriveSupa.rest("console_members", { query:"select=id,name,email,role,active&order=role.asc" });
    if(rows && rows.length){ var list=rows.map(function(r){ return { id:String(r.id||""), name:String(r.name||"").trim(), email:String(r.email||"").trim(), role:(r.role==="owner"?"owner":"member"), active:r.active!==false }; });
      membersCacheWrite(list); return list; }
  }catch(e){}
  return membersDerived();
}
// A fallback roster when console_members is not present yet (the SQL is applied device-side): derive the
// known operators from the name map so the room still lists real people. Roles default to member; the
// signed-in owner is known from the owner tier. Never invents a person.
function membersDerived(){
  var cached=membersCache(); if(cached && cached.length) return cached;
  var out=[], seen={}, names=operatorNames(); var me=currentActor();
  Object.keys(names).forEach(function(uid){ if(uid && uid!==ACTOR && !seen[uid]){ seen[uid]=1; out.push({ id:uid, name:(names[uid].name||names[uid].email||""), email:names[uid].email||"", role:"member", active:true }); } });
  if(me && me!==ACTOR && !seen[me]){ out.push({ id:me, name:(resolveOperator(me)||""), email:profileEmail()||"", role:"member", active:true }); seen[me]=1; }
  if(isOwnerTier()) out.forEach(function(m){ if(m.id===me) m.role="owner"; });
  return out;
}
function membersRoster(){ var c=membersCache(); return (c && c.length)? c : membersDerived(); }
function memberRole(uid){ uid=String(uid||currentActor()); var r=membersRoster().find(function(m){ return m.id===uid; }); if(r) return r.role; if(uid===currentActor() && isOwnerTier()) return "owner"; return "member"; }
function isOwnerMember(){ return isOwnerTier() || memberRole(currentActor())==="owner"; }
function memberName(uid){ var r=membersRoster().find(function(m){ return m.id===uid; }); return (r && (r.name||r.email)) || resolveOperator(uid); }
try{ window.hydrateMembers=hydrateMembers; window.membersRoster=membersRoster; window.memberRole=memberRole; window.isOwnerMember=isOwnerMember; window.memberName=memberName; }catch(_){}

// The per-member windowed numbers. sinceDays=0 means all time; 1/7/30 are the daily/weekly/monthly windows
// the oversight room and the member's own panel read. Every field reuses the board's own readers, so a
// member's numbers can never disagree with the board.
var PAGE_ACTIONS=/^(publish|publish_offer|tpl_publish|lc_publish|activate)$/;
var EDIT_ACTIONS=/^(draft_save|save|edit|opp_add|upload)$/;
function memberMetrics(uid, sinceDays){
  uid=String(uid||currentActor());
  var cutoff = sinceDays>0 ? (Date.now()-sinceDays*86400000) : 0;
  function inWin(ts){ if(!cutoff) return true; var tt=Date.parse(String(ts||"")); return isFinite(tt) && tt>=cutoff; }
  var mail=getMailLog();
  var mine=mail.filter(function(m){ return m && m.actor===uid && m.direction!=="in" && m.status==="sent" && inWin(m.ts); });
  var oppSet={}; mine.forEach(function(m){ if(m.opp) oppSet[m.opp]=1; });
  var opps=Object.keys(oppSet);
  var replies=0; opps.forEach(function(slug){ try{ if(hasReply(slug)) replies++; }catch(e){} });
  var replyRate=opps.length ? Math.round((replies/opps.length)*100) : 0;
  // Opens: token-bearing opens (P2) whose HIT landed in the window, attributed to one of the member's send
  // ids (all-time send ids, since a token minted anytime can be opened in the window).
  var myIds={}; mail.forEach(function(m){ if(m && m.actor===uid && m.direction!=="in"){ var id=m.mid||m.id; if(id) myIds[id]=1; } });
  var opens=0; try{ allHits().forEach(function(h){ if(!h || h.self) return; if(h.type&&h.type!=="open") return; if(h.r && myIds[h.r] && inWin(h.ts)) opens++; }); }catch(e){}
  var acts=getActivity().filter(function(a){ return a && a.actor===uid && inWin(a.ts); });
  var pages=acts.filter(function(a){ return PAGE_ACTIONS.test(a.action||""); }).length;
  var edits=acts.filter(function(a){ return EDIT_ACTIONS.test(a.action||""); }).length;
  return { sends:mine.length, opps:opps.length, replies:replies, replyRate:replyRate, opens:opens, pages:pages, edits:edits };
}
// A small daily-sends trend for a member (last n days, oldest to newest), for the sparkline.
function memberSendTrend(uid, days){
  uid=String(uid||currentActor()); days=days||14;
  var byDay={}; getMailLog().forEach(function(m){ if(m && m.actor===uid && m.direction!=="in" && m.status==="sent"){ var d=String(m.ts||"").slice(0,10); if(d) byDay[d]=(byDay[d]||0)+1; } });
  var out=[], now=new Date();
  for(var i=days-1;i>=0;i--){ var dt=new Date(now.getTime()-i*86400000); var key=dt.toISOString().slice(0,10); out.push(byDay[key]||0); }
  return out;
}
try{ window.memberMetrics=memberMetrics; window.memberSendTrend=memberSendTrend; }catch(_){}

// An in-repo sparkline: a static SVG polyline (no animation; a still line is reduced-motion by nature, and
// the CSS honors the query regardless). No number ever appears inside the SVG, so nothing to isolate.
function sparklineSvg(series, opts){
  series=(series||[]).map(function(n){ return Number(n)||0; }); opts=opts||{};
  var w=opts.w||120, h=opts.h||28, pad=2, n=series.length;
  if(n<2) return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" aria-hidden="true"></svg>';
  var max=Math.max.apply(null, series.concat([1]));
  var dx=(w-pad*2)/(n-1);
  var pts=series.map(function(v,i){ var x=pad+i*dx; var y=h-pad-(v/max)*(h-pad*2); return (Math.round(x*10)/10)+","+(Math.round(y*10)/10); }).join(" ");
  var last=series[n-1], lx=pad+(n-1)*dx, ly=h-pad-(last/max)*(h-pad*2);
  return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" aria-hidden="true" preserveAspectRatio="none">'+
    '<polyline points="'+pts+'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<circle cx="'+(Math.round(lx*10)/10)+'" cy="'+(Math.round(ly*10)/10)+'" r="2" fill="currentColor"/></svg>';
}
try{ window.sparklineSvg=sparklineSvg; }catch(_){}
// Read on sign-in; write on change. Language is the clearest per-person setting; the board view state
// (thrive_board_v1) rides along. Both already exist in the UI; no new setting is invented here. The
// onThrive registrations live below, after __hooks is declared (registerOpPrefHooks).

/* The living surface: a group card's recipients panel and its aggregate header, both read from the one
   campaignStats / recipientState derivation, so the card and Insights can never disagree. */
/* ONE date formatter for the whole console (ROOT B). Intl.DateTimeFormat, memoized per (locale,
   options), with the numbering system pinned to Latin for Arabic ("ar-u-nu-latn") so dates keep
   WESTERN digits per brand on EVERY engine. This is the fix the sandbox could not see: this build's
   Chromium ICU renders the default "ar" locale with Latin digits, but iOS WebKit's ICU renders it
   with Arabic-Indic digits, so the device showed non-brand numerals while every green
   sandbox run looked correct. Pinning the numbering system removes the engine dependence. Every
   ad-hoc date string in the console routes through fmtStamp, so there is one formatter, not eight.
   Output lands inside .mono / .mono-iso / <bdi>, which are unicode-bidi:isolate, so a date never
   reorders in RTL context. */
var __DTF={};
function dateLocale(){ try{ return (getLang()==="ar") ? "ar-u-nu-latn" : "en-US"; }catch(e){ return "en-US"; } }
function fmtStamp(ts, opts, locOverride){
  if(ts==null || ts==="") return "";
  var d=new Date(ts); if(isNaN(d.getTime())) return String(ts);
  var loc=locOverride || dateLocale(), key=loc+"|"+JSON.stringify(opts||{});
  var f=__DTF[key];
  if(f===undefined){ try{ f=new Intl.DateTimeFormat(loc, opts||{}); }catch(e){ try{ f=new Intl.DateTimeFormat("en-US", opts||{}); }catch(_){ f=null; } } __DTF[key]=f; }
  try{ return f ? f.format(d) : String(ts); }catch(e){ return String(ts); }
}
/* THE date composer. fmtStamp is the raw Intl string (for sorting, keys, non-display use); every DISPLAYED
   date is composed here, wrapped in <bdi> so its direction follows its CONTENT (Arabic date -> rtl, English
   date -> ltr) and is isolated from the surrounding run. This is the whole root of the persisting scramble:
   the earlier fix isolated dates but often through an LTR-FORCING wrapper (.mono, or ltr() -> .mono-iso),
   which is right for a Latin identifier (a slug, an address) but forces an Arabic date to render
   left-to-right, and the bidi algorithm then shuffles «2026/08/11، 3:46 م» into a scramble. A <bdi> lets the
   date keep its own reading direction inside any container, even an LTR-forced cell, so it never reorders.
   Never wrap a displayed date in ltr()/.mono; route it here. */
function fmtStampHtml(ts, opts){ var s=fmtStamp(ts, opts); return s ? '<bdi>'+esc(s)+'</bdi>' : ''; }
/* The common shorthand: a medium date with a short time, composed and isolated. Every "when" on a thread
   row, a history row, a scan line or an insights cell routes through this, never through ltr(when(...)). */
function fmtWhenHtml(ts){ return fmtStampHtml(ts, {dateStyle:"medium", timeStyle:"short"}); }
function fmtWhenShortHtml(ts){ return fmtStampHtml(ts, {dateStyle:"short", timeStyle:"short"}); }
/* The date composer for a PLAIN-TEXT sink (a .textContent status line, where no HTML wrapper is possible).
   Same isolation, baked with Unicode controls instead of a <bdi>: a first-strong isolate (U+2068 .. U+2069)
   makes the date an atomic unit that keeps its own reading direction inside a mixed Arabic line. */
function fmtStampTxt(ts, opts){ var s=fmtStamp(ts, opts); return s ? "⁨"+s+"⁩" : ""; }
/* The one numeral helper for a relative-time or counted phrase. A Western numeral dropped raw into an
   Arabic phrase ("8 days idle" / «8 أيام بلا حركة») reorders on RTL engines; wrapping it in .n
   (direction:ltr; unicode-bidi:isolate) makes the digit group an atomic segment that sits correctly in
   the phrase. Every number composed into a phrase routes through here, beside the date formatter. */
function nIso(n){ return '<span class="n">'+esc(String(n))+'</span>'; }
/* THE relative/counted-phrase composer, beside the date composer. A counted phrase ("8 days idle" /
   «8 أيام بلا حركة») must never be assembled at the call site by dropping the raw numeral into the
   template and trusting the container's direction: on an RTL engine the bare digit reorders. This composes
   the plural-correct phrase in ONE place and isolates the counted numeral (nIso -> .n), so the digit is an
   atomic LTR segment that sits correctly whatever the surrounding direction. Every counted phrase routes
   here; no call site does txt(...).replace(String(n), num(n)) or hand-rolls the split/join any more. */
function fmtRelative(key, n, extra){
  var s = boardText(getLang(), key, n, extra||{});
  return String(n).length ? s.split(String(n)).join(nIso(n)) : s;   // isolate every place the count was put
}
function campaignAggHtml(slug){
  var s=campaignStats(slug);
  function tile(lbl,val){ return '<div class="cg-tile"><span class="cg-n">'+esc(String(val))+'</span><span class="cg-l">'+esc(lbl)+'</span></div>'; }
  return '<div class="cg-agg">'+tile(t("cg_sent"),s.sent)+tile(t("cg_opens"),s.opens)+tile(t("cg_unique"),s.unique)+
    tile(t("cg_replies"),s.replies)+tile(t("cg_rate"),s.replyRate+"%")+'</div>';
}
/* ---------- P5 roster ingest (D3): paste-first recipient parsing ----------
   One parser for all three inputs (paste, CSV, add-one). Splits, trims, dedupes, validates, extracts names,
   preserves Arabic names exactly (no case change, no mangling), and flags malformed / duplicate / typo-domain
   rows for the operator to decide. It writes nothing; the roster editor commits valid rows to the opp record. */
var ROSTER_TYPO = { "gmial.com":1,"gmai.com":1,"gmal.com":1,"gnail.com":1,"gmail.co":1,"gmil.com":1,
  "hotmial.com":1,"hotmal.com":1,"hotmai.com":1,"yaho.com":1,"yahooo.com":1,"outlok.com":1,"iclod.com":1 };
function rosterValidEmail(a){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a||"").trim()); }
function rosterCleanName(s){ return String(s==null?"":s).replace(/^\s+|\s+$/g,"").replace(/^["']+|["']+$/g,"").replace(/^\s+|\s+$/g,""); }
function rosterLang(name){ return /[\u0600-\u06FF]/.test(String(name||"")) ? "ar" : "en"; }
// One line -> zero or more { name, addr }. Handles "Name <email>", a bare email, a CSV row (name+email in
// either order, header rows fall out because neither field is an email), and a comma/semicolon list of emails.
function parseRosterLine(line){
  var out=[], s=rosterCleanName(line); if(!s) return out;
  var m=s.match(/^(.*?)[<]\s*([^<>\s]+@[^<>\s]+)\s*[>]\s*$/);
  if(m){ out.push({ name:rosterCleanName(m[1]), addr:m[2].trim() }); return out; }
  var fields=s.split(/[;\t,]+/).map(function(f){ return rosterCleanName(f); }).filter(Boolean);
  var emails=fields.filter(function(f){ return f.indexOf("@")>=0; });
  if(emails.length===1 && fields.length>1){                 // a CSV row: the @ field is the email, order-free
    var nm=fields.filter(function(f){ return f.indexOf("@")<0; }).join(" ");
    out.push({ name:rosterCleanName(nm), addr:emails[0] }); return out;
  }
  emails.forEach(function(e){ out.push({ name:"", addr:e }); });   // a list of bare emails, or one email
  return out;
}
function parseRoster(text){
  var rows=[], seen={};
  String(text==null?"":text).split(/\r?\n/).forEach(function(ln){
    parseRosterLine(ln).forEach(function(e){
      var addr=String(e.addr||"").trim(), key=addr.toLowerCase(), flags=[], valid=rosterValidEmail(addr);
      if(!valid) flags.push("invalid");
      else { if(seen[key]) flags.push("dup"); var dom=addr.slice(addr.indexOf("@")+1).toLowerCase(); if(ROSTER_TYPO[dom]) flags.push("typo"); seen[key]=1; }
      rows.push({ name:e.name||"", addr:addr, lang:rosterLang(e.name), valid:valid, flags:flags });
    });
  });
  return rows;
}
window.parseRoster=parseRoster;

// P8: the campaign's in-flight control, a first-class panel on the card. Sent k of N, how many are still
// queued and when the next is due, held and failed counts, the deferred tail and the warm-ramp cap, and
// the one control (pause or resume). Counts render outside the translated strings (bdi), never a flat
// {n} template, so Arabic inflects correctly. Reads campaignProgress; the buttons start/hold nothing here,
// they set state and tell the relay.
function campaignControlHtml(o){
  if(!o || !o.slug) return "";
  var p=campaignProgress(o.slug);
  if(!p.total && !(o.campaign && o.campaign.state)) return "";
  var state=p.state||"", done=p.done;
  var stateCls=state==="paused-complaint"?"is-complaint":(state==="paused"?"is-paused":(done?"is-done":"is-sending"));
  var stateLbl=state==="paused-complaint"?t("cq_state_complaint"):(state==="paused"?t("cq_state_paused"):(done?t("cq_state_done"):t("cq_state_sending")));
  var lines='<p class="cq-line cq-k"><bdi class="n">'+p.sent+'</bdi> / <bdi class="n">'+p.n+'</bdi> '+esc(t("cq_sent_of"))+'</p>';
  if(p.queued) lines+='<p class="cq-line st-line">'+esc(t("cq_queued"))+' <bdi class="n">'+p.queued+'</bdi>'+(p.nextInMs? ' · '+esc(t("cq_next"))+' '+esc(fmtDur(p.nextInMs)) : '')+'</p>';
  if(p.held)   lines+='<p class="cq-line st-miss">'+esc(t("cq_held"))+' <bdi class="n">'+p.held+'</bdi></p>';
  if(p.failed) lines+='<p class="cq-line st-miss">'+esc(t("cq_failed"))+' <bdi class="n">'+p.failed+'</bdi></p>';
  if(o.campaign && o.campaign.deferred) lines+='<p class="cq-line st-line">'+esc(t("cq_deferred"))+' <bdi class="n">'+o.campaign.deferred+'</bdi> · '+esc(t("cq_warmcap"))+' <bdi class="n">'+((o.campaign&&o.campaign.warmCap)||CAMPAIGN_WARM_CAP)+'</bdi></p>';
  var ctrl="";
  if(!done){
    if(state==="paused"||state==="paused-complaint") ctrl='<button class="btn sm cq-resume" type="button" data-slug="'+esc(o.slug)+'">'+esc(t("cq_resume"))+'</button>';
    else ctrl='<button class="btn ghost sm cq-pause" type="button" data-slug="'+esc(o.slug)+'">'+esc(t("cq_pause"))+'</button>';
  }
  return '<section class="cg-panel cq-panel '+stateCls+'"><h4 class="cg-h">'+esc(t("cq_h"))+' <span class="chip-st">'+esc(stateLbl)+'</span></h4>'+
    lines+'<div class="cq-acts">'+ctrl+'</div></section>';
}
function recipientsPanelHtml(o){
  var recips=campaignRecipients(o);
  var rows=recips.map(function(r){
    var st=recipientState(o.slug, r.addr);
    var chip='<span class="chip-st is-'+esc(st.chip)+'">'+esc(t("rc_"+st.chip))+'</span>';
    var open=(st.chip==="replied" && st.child)? ' <button class="btn ghost sm rc-open" type="button" data-child="'+esc(st.child)+'">'+esc(t("rc_open_child"))+'</button>' : '';
    // ltr() already returns an escaped, isolated span; wrapping it in esc() again printed the tag as
    // literal text (the "<span class=mono-iso>7/31/26, 5:02 PM</span>" symptom). Insert it as markup.
    var last=st.last? '<span class="rc-last">'+fmtWhenShortHtml(st.last)+'</span>' : '';
    return '<li class="rc-row"><span class="rc-name">'+esc(r.name||t("rc_no_name"))+'</span>'+
      '<span class="rc-addr mono-iso">'+ltr(esc(r.addr))+'</span>'+chip+open+last+'</li>';
  }).join("");
  return '<section class="cg-panel"><h4 class="cg-h">'+esc(t("cg_recipients"))+' <span class="n">'+recips.length+'</span></h4>'+
    campaignAggHtml(o.slug)+'<ul class="rc-list">'+rows+'</ul></section>';
}
// P5 roster editor (D3): paste / CSV / add-one, editable rows, flags. Writes nothing but the roster on the
// opp record (additive); sending is a separate surface (P6). The stored roster is the single name source (D4).
function rosterFlagText(flags){ return (flags||[]).map(function(f){ return t("rst_flag_"+f); }).filter(Boolean).join(" · "); }
function rosterFlagsFor(addr, list, i){
  if(!rosterValidEmail(addr)) return ["invalid"];
  var flags=[], dom=addr.slice(addr.indexOf("@")+1).toLowerCase(); if(ROSTER_TYPO[dom]) flags.push("typo");
  var k=String(addr).toLowerCase();
  for(var j=0;j<list.length;j++){ if(j!==i && list[j] && String(list[j].addr||"").toLowerCase()===k){ flags.push("dup"); break; } }
  return flags;
}
function rosterRowHtml(r,i){
  var f=(r.flags||[]).filter(function(x){ return x!=="dup"; });
  var warn=f.length? ' <span class="tag tag-warn rst-flag" title="'+esc(rosterFlagText(f))+'">'+esc(rosterFlagText(f))+'</span>' : '';
  return '<div class="rst-row" data-i="'+i+'">'+
    '<input class="rst-name" type="text" dir="auto" value="'+esc(r.name||"")+'" placeholder="'+esc(t("rst_name"))+'" aria-label="'+esc(t("rst_name"))+'">'+
    '<input class="rst-email mono-iso" type="text" dir="ltr" value="'+esc(r.addr||"")+'" placeholder="'+esc(t("rst_email"))+'" aria-label="'+esc(t("rst_email"))+'">'+
    warn+'<button type="button" class="btn ghost sm rst-del" aria-label="'+esc(t("rst_remove"))+'">×</button></div>';
}
function rosterEditorHtml(o){
  var recips=(o && Array.isArray(o.recipients))? o.recipients : [];
  var rows=recips.map(rosterRowHtml).join("");
  return '<details class="cg-panel roster-ed"'+(isGroupOpp(o)?" open":"")+' data-roster="'+esc(o.slug)+'">'+
    '<summary class="cg-h">'+esc(t("rst_h"))+' <span class="n">'+recips.length+'</span></summary>'+
    '<div class="rst-rows">'+(rows||'<p class="mw-muted rst-empty">'+esc(t("rst_empty"))+'</p>')+'</div>'+
    '<textarea class="rst-paste" rows="3" placeholder="'+esc(t("rst_paste_ph"))+'"></textarea>'+
    '<div class="rst-acts"><button type="button" class="btn sm rst-parse">'+esc(t("rst_parse"))+'</button>'+
      '<label class="btn ghost sm rst-csv-l">'+esc(t("rst_csv"))+'<input type="file" class="rst-csv" accept=".csv,text/csv,text/plain" hidden></label>'+
      '<button type="button" class="btn ghost sm rst-addone">'+esc(t("rst_addone"))+'</button></div>'+
    '<div class="rst-review" hidden></div>'+
    '<p class="mw-muted rst-note">'+esc(t("rst_note"))+'</p></details>';
}
function wireRosterEditor(box, o){
  var ed=box && box.querySelector('.roster-ed[data-roster]'); if(!ed || !o) return;
  var slug=o.slug;
  function recips(){ var d=getDraft(slug); return (d && Array.isArray(d.recipients))? d.recipients.slice() : []; }
  function persist(list){ saveDraft({ slug:slug, recipients:list }); try{ if(window.thriveModal && window.thriveModal.reread) window.thriveModal.reread(); }catch(_){} }
  ed.querySelectorAll('.rst-row').forEach(function(rowEl){
    var i=parseInt(rowEl.getAttribute('data-i'),10);
    var nm=rowEl.querySelector('.rst-name'), em=rowEl.querySelector('.rst-email');
    function upd(){ var list=recips(); if(!list[i]) return; var addr=String(em.value||"").trim();
      list[i]=Object.assign({}, list[i], { name:String(nm.value||""), addr:addr, lang:rosterLang(nm.value),
        valid:rosterValidEmail(addr), flags:rosterFlagsFor(addr, list, i) }); persist(list); }
    if(nm) nm.addEventListener('change', upd);
    if(em) em.addEventListener('change', upd);
  });
  ed.querySelectorAll('.rst-del').forEach(function(btn){ btn.addEventListener('click', function(){
    var i=parseInt(btn.closest('.rst-row').getAttribute('data-i'),10); var list=recips(); list.splice(i,1); persist(list); }); });
  var addone=ed.querySelector('.rst-addone');
  if(addone) addone.addEventListener('click', function(){ var list=recips(); list.push({ name:"", addr:"", lang:"en", valid:false, flags:[] }); persist(list); });
  var parseBtn=ed.querySelector('.rst-parse'), pasteEl=ed.querySelector('.rst-paste'), review=ed.querySelector('.rst-review');
  function showReview(text){
    var parsed=parseRoster(text);
    if(!parsed.length){ review.hidden=true; review.innerHTML=""; return; }
    var have={}; recips().forEach(function(r){ if(r.addr) have[String(r.addr).toLowerCase()]=1; });
    var addable=parsed.filter(function(p){ return p.valid && p.flags.indexOf("dup")<0 && !have[p.addr.toLowerCase()]; });
    var bad=parsed.filter(function(p){ return !p.valid; }).length, dups=parsed.length-addable.length-bad;
    // P10 hygiene: a previously-bounced address WARNS before it is re-sent. The bounce set is the SAME
    // derived truth the Contact Book reads (bouncedAddrSet over console_inbound autos); nothing new is stored.
    var bset=bouncedAddrSet(parsed.map(function(p){ return p.addr; }));
    var nBounced=parsed.filter(function(p){ return bset[String(p.addr||"").toLowerCase()]; }).length;
    review.hidden=false;
    review.innerHTML='<ul class="rst-rev-list">'+parsed.map(function(p){
        var isdup=(p.flags.indexOf("dup")>=0 || have[p.addr.toLowerCase()]);
        var isBounced=!!bset[String(p.addr||"").toLowerCase()];
        var cls=!p.valid?"is-bad":(isdup?"is-dup":(isBounced?"is-bounced":(p.flags.indexOf("typo")>=0?"is-typo":"")));
        var fl=!p.valid?["invalid"]:(isdup?["dup"]:p.flags);
        return '<li class="rst-rev '+cls+'"><span class="rst-rev-nm" dir="auto">'+esc(p.name||t("rst_no_name"))+'</span>'+
          '<span class="rst-rev-em mono-iso" dir="ltr">'+esc(p.addr)+'</span>'+
          (fl.length? ' <span class="tag tag-warn">'+esc(rosterFlagText(fl))+'</span>':'')+
          (isBounced? ' <span class="tag tag-warn rst-bounced">'+esc(t("rst_flag_bounced"))+'</span>':'')+'</li>';
      }).join("")+'</ul>'+
      '<button type="button" class="btn sm rst-addvalid"'+(addable.length?'':' disabled')+'>'+esc(t("rst_add_valid"))+' <bdi class="n">'+addable.length+'</bdi></button>'+
      ' <span class="mw-muted">'+(dups?'<bdi class="n">'+dups+'</bdi> '+esc(t("rst_flag_dup")):'')+(bad?(dups?' · ':'')+'<bdi class="n">'+bad+'</bdi> '+esc(t("rst_flag_invalid")):'')+
        (nBounced?((dups||bad)?' · ':'')+'<bdi class="n">'+nBounced+'</bdi> '+esc(t("rst_flag_bounced")):'')+'</span>';
    var addBtn=review.querySelector('.rst-addvalid');
    if(addBtn) addBtn.addEventListener('click', function(){
      var list=recips(), seen={}; list.forEach(function(r){ if(r.addr) seen[String(r.addr).toLowerCase()]=1; });
      addable.forEach(function(p){ var k=p.addr.toLowerCase(); if(seen[k]) return; seen[k]=1;
        list.push({ name:p.name||"", addr:p.addr, lang:p.lang, valid:true, flags:p.flags.filter(function(f){ return f==="typo"; }) }); });
      persist(list);
    });
  }
  if(parseBtn && pasteEl) parseBtn.addEventListener('click', function(){ showReview(pasteEl.value); });
  var csv=ed.querySelector('.rst-csv');
  if(csv) csv.addEventListener('change', function(){ var f=csv.files && csv.files[0]; if(!f) return;
    var rd=new FileReader(); rd.onload=function(){ if(pasteEl) pasteEl.value=String(rd.result||""); showReview(String(rd.result||"")); };
    try{ rd.readAsText(f); }catch(_){} });
}
window.wireRosterEditor=wireRosterEditor;
try{ window.rosterEditorHtml=rosterEditorHtml; }catch(_){}
function spawnedFromHtml(o){
  return '<section class="cg-panel"><p class="st-line">'+esc(t("cg_spawned_from"))+
    ' <button class="btn ghost sm open-parent" type="button" data-parent="'+esc(o.spawned_from.parent)+'">'+esc(o.spawned_from.parent)+'</button></p></section>';
}
// The pre-send review for a personalized group send: every recipient, the greeting each will receive in
// their own language, and the ones blocked for a missing name (blocked for that recipient only, never sent
// with an empty greeting). Purely a review of groupSendPlan; it writes nothing.
function renderGroupReviewInto(host, recipients, template){
  if(!host) return;
  var plan=groupSendPlan(recipients, template);
  var blocked=plan.filter(function(p){ return p.blocked; }).length;
  var rows=plan.map(function(p){
    var greet="";
    if(!p.blocked){ var g=renderPersonalized(template, { addr:p.addr, name:p.name, lang:p.lang }); greet=g.ok? g.subject : ""; }
    return '<li class="gr-row'+(p.blocked?" gr-blocked":"")+'" dir="'+(p.lang==="ar"?"rtl":"ltr")+'">'+
      '<span class="gr-name">'+(p.name? esc(p.name) : '<span class="gr-miss">'+esc(t("gr_no_name"))+'</span>')+'</span>'+
      '<span class="gr-addr mono-iso">'+ltr(esc(p.addr))+'</span>'+
      (p.blocked? '<span class="gr-block">'+esc(t("gr_blocked"))+'</span>'
                : '<span class="gr-greet">'+esc(greet)+'</span>')+'</li>';
  }).join("");
  host.innerHTML='<h4 class="cg-h">'+esc(t("gr_review_h"))+' <span class="n">'+plan.length+'</span></h4>'+
    (blocked? '<p class="st-line st-miss"><span class="n">'+blocked+'</span> '+esc(t("gr_blocked_n"))+'</p>' : '')+
    '<ul class="gr-list">'+rows+'</ul>';
  return { total:plan.length, blocked:blocked };
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
  if(hasReply(o)) return { status:"replied", event:"inbound" };   // the one shared reply derivation
  if(declared==="replied") return { status:"replied", event:"record_reply" };
  const s=sendsFor(o);
  if(!s || !s.count) return isLive(o) ? { status:"live", event:"publish" } : { status:"draft", event:"local" };
  /* A delivery outcome is read from the relay's bounce signal, before sent or opened: a bounced or
     failed message never reached the inbox, so it is not a send and cannot have been opened. */
  const bounce=bounceFor(o);
  if(bounce==="hard") return { status:"bounced", event:"bounce" };
  if(bounce==="soft") return { status:"failed", event:"bounce" };
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
    opps:getDraftsLocal(), templates:getCustomTemplates(), activity:getActivity(),
    hits:getHits(), endpoint:getEndpoint(),
    mail:getMailLogLocal(), emailTemplates:getEmailTemplates(), fromName:getFromName() };
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
function offThrive(kind, key){ if(__hooks[kind]) delete __hooks[kind][key]; }   // Brief A (F16): a view can drop its own listener on teardown
function fireThrive(kind){
  const h=__hooks[kind]||{};
  Object.keys(h).forEach(k=>{ try{ h[k](); }catch(e){} });
}
window.onThriveSync  = function(){ fireThrive("sync"); };
window.onLangApplied = function(){ fireThrive("lang"); renderOperatorChip(); };
window.onGateUnlocked= function(){ fireThrive("unlock"); renderOperatorChip(); };
// Per-operator memory hooks, registered here now that __hooks exists: read prefs on sign-in, remember the
// language on change. (Defined earlier as hoisted functions; only the registration must follow __hooks.)
onThrive("unlock","opprefs", function(){ opPrefsLoad(); });
onThrive("lang","opprefs", function(){ try{ opPrefRemember("lang", getLang()); }catch(_){} });
// Sign-in hydrates the cross-operator name map once, so every actor surface resolves a real name.
onThrive("unlock","opnames", function(){ try{ hydrateOperatorNames(); }catch(_){} });
// Signing in lands on the LIVE board with no manual refresh. A signed-out boot hydrate leaves the read
// layer degraded and authRequired (a signed-out empty read is indistinguishable from an RLS denial), and
// that flag makes supaEnsureHydrated bail, so without this the board would keep showing the sign-in prompt
// until a manual refresh rebuilt the read state. On sign-in we clear that stale state and hydrate against
// the operator's session, then the board refreshes onto the live cards when the hydrate lands.
onThrive("unlock","supahydrate", function(){
  try{
    if(supaOn() && supaReadFlagOn() && supaSignedIn()){
      __supa.degraded=false; __supa.authRequired=false; __supa.hydrated=false; __supaHydrating=false;
      supaEnsureHydrated();   // fires supaHydrate and refreshes the board when it resolves
    }
  }catch(e){}
  try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(e){}   // paint now (local cards), no prompt
});
/* Freeze recovery: once signed in, push the local ledger so the sends the server is missing since Aug 14
   record and the count moves. Deferred so hydrate/flush settle first; idempotent. */
onThrive("unlock","mailreconcile", function(){
  setTimeout(function(){ try{ if(supaOn() && supaSignedIn()) reconcileMailToServer(); }catch(_){} }, 2500);
});
/* P27: the owner-only oversight entry. The role loads async on unlock; a member never gets the link, and the
   router refuses the route regardless (ownerOK fails closed, so a member's direct URL lands on the board).
   Once the role is known, the nav link is installed for the owner and the route is re-evaluated so an owner
   already on the board sees the link appear. */
function installOwnerNav(){
  try{
    var nav=document.querySelector("header.top .nav"); if(!nav) return;
    var existing=nav.querySelector('a[data-view="oversight"]');
    var owner=isOwnerMember();
    if(owner && !existing){
      var a=document.createElement("a"); a.href="#oversight"; a.setAttribute("data-view","oversight");
      a.setAttribute("data-i18n","nav_oversight"); a.textContent=t("nav_oversight");
      var libLink=nav.querySelector('a[data-view="library"]');
      if(libLink && libLink.parentNode) libLink.parentNode.insertBefore(a, libLink.nextSibling); else nav.insertBefore(a, nav.firstChild);
    } else if(!owner && existing && existing.parentNode){ existing.parentNode.removeChild(existing); }
  }catch(e){}
}
try{ window.installOwnerNav=installOwnerNav; }catch(_){}
onThrive("unlock","p27role", function(){
  (async function(){
    try{ await loadAdminTier(); }catch(e){}
    try{ await hydrateMembers(); }catch(e){}
    try{ installOwnerNav(); }catch(e){}
    try{ if(window.thriveOwnerRecheck) window.thriveOwnerRecheck(); }catch(e){}
  })();
});

/* The header carries the signed-in operator email and a one-tap sign-out, and nothing else about who they
   are: no role, no title, every operator equal. Sign-out returns to the operator sign-in step (gate two),
   never the passcode and never a blank board. */
function renderOperatorChip(){
  try{
    var nav=document.querySelector("header.top .nav"); if(!nav) return;
    var S=window.ThriveSupa;
    var on=!!(S && S.signedIn && S.signedIn());
    var chip=document.getElementById("opChip");
    if(!on){ if(chip && chip.parentNode) chip.parentNode.removeChild(chip); return; }
    var email=(S.authEmail && S.authEmail()) || "";
    if(!chip){
      chip=document.createElement("span"); chip.id="opChip"; chip.className="op-chip";
      chip.innerHTML='<span class="op-email mono-iso" id="opEmail"></span>'+
        '<button class="langbtn" id="opSignOut" type="button">'+esc(t("op_sign_out"))+'</button>';
      nav.appendChild(chip);   // the Lock control is gone; sign-out is the only manual auth action here
      var so=chip.querySelector("#opSignOut");
      if(so) so.addEventListener("click", function(){ if(window.thriveSignOut) window.thriveSignOut(); });
    }
    var em=chip.querySelector("#opEmail"); if(em) em.textContent=email;      // only the email, never a role
    var so2=chip.querySelector("#opSignOut"); if(so2) so2.textContent=(typeof t==="function"? t("op_sign_out") : "Sign out");
  }catch(e){}
}

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
// INVARIANT I3: >0 while an import/activate batch is staging writes. Suppresses scheduleSyncPush so no
// sync round (and no board repaint) can fire against a half-committed batch. Reset in a finally.
let __batchDepth=0;
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
  const opps=getDraftsLocal()
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
    opps, mail:getMailLogLocal(), quota:getSendStamps(), activity:getActivity(),
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
      setDrafts(mergeKeyed(getDraftsLocal(), remote.opps, "slug", "opp", allTombs,
        (r,l)=> Object.assign({}, r, (!r.html && l.html)?{html:l.html}:{})));
    } else if(remote.tombs){
      setDrafts(mergeKeyed(getDraftsLocal(), [], "slug", "opp", allTombs));
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
      getMailLogLocal().concat(remote.mail).forEach(m=>{ const k=m.mid||JSON.stringify(m); if(!seen[k]){ seen[k]=1; all.push(m); } });
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
function getInboundLocal(){ try{ return JSON.parse(localStorage.getItem(INBOUND)||"[]"); }catch(e){ return []; } }
/* The READ accessor for replies: the canonical localStorage store, into which reconcileCanonical has
   folded the migrated console_inbound rows (so a reply, the international-schools one included, survives
   a truncated or retired local store, and there is no second live copy to fork from). Under a render pin
   it reads the frozen snapshot. Writers use getInboundLocal. */
function getInbound(){ if(__boardPin) return __boardPin.inbound.slice(); return getInboundLocal(); }
function setInbound(a){ invalidateRecon(); lsSet(INBOUND, JSON.stringify((a||[]).slice(-800)));
  // A reply must reach console_inbound for the server board view to mark the card Replied; a mirror failure
  // is recorded on the diverge ledger, never swallowed, so it surfaces on the drift badge (Part 4).
  try{ supaMirrorInbound(a); }catch(e){ try{ supaRecordDiverge("mirror", "console_inbound", e&&e.message); }catch(_){} } }
function inboundFor(slug){ return getInbound().filter(r=> r && resolvedReplyOpp(r)===slug); }
/* Named on screen rather than counted: a reply nobody could attribute is the one
   most likely to be worth money, because it is the one nobody is expecting. */
function inboundUnmatched(){ return getInbound().filter(r=> r && r.kind!=="auto" && !resolvedReplyOpp(r)); }
// The ONE derivation of the unmatched-human set, read by both the board badge and the inbox header, so the
// number cannot drift. Automated mail (kind auto, plus the no-reply and platform senders inboundIsNoise
// catches) is excluded here and folded into the collapsed noise group, never counted as human.
function unmatchedHuman(){ return inboundUnmatched().filter(function(r){ return !inboundIsNoise(r); }); }

/* ---------- reply matching (P1) ----------
   The relay's tag/thread/sender rules miss a human reply that lands on the From line from a different
   address than the one we sent to, because the strongest tier (In-Reply-To) was dead: the recorded id
   was a local id, never the wire Message-ID a reply actually references. This is the console-side matcher.
   It runs over the held rows against the send ledger the console holds, records the tier that matched,
   and never guesses. Header threading for new replies is durable once the relay is redeployed to record
   the wire Message-ID and to store each reply's In-Reply-To/References (docs/RELAY.md); the held replies
   recover here by sender and subject. */

// The message ids a reply threads onto: In-Reply-To first, then References. Present only once the relay
// stores these headers on the inbound row; the held rows predate that, so they fall through to sender.
function inReplyIds(r){
  var raw=String((r&&(r.inReplyTo||r.in_reply_to))||"")+" "+String((r&&r.references)||"");
  var out=[], re=/<([^<>\s]+)>/g, m;
  while((m=re.exec(raw))) out.push(m[1]);
  return out;
}

// Noise is classified before display, so a genuine human reply is never buried under DMARC reports,
// platform notices and no-reply mail. Conservative on purpose: a real person on gmail is never noise,
// and anything uncertain stays in the visible human list, which is the safe failure (seen, not hidden).
function inboundIsNoise(r){
  if(!r) return true;
  if(r.kind==="auto") return true;                                  // the relay already flags mailer-daemon and auto-submitted
  var from=String(r.from||"").toLowerCase();
  // Confirmed on the server: console_inbound ingests everything that arrives, so the 59 rows are mostly
  // machinery, not campaign replies. A DMARC aggregate sender (noreply-dmarc-support@google.com) carries
  // the keyword in the MIDDLE of the local part, so the adjacent-to-@ pattern below misses it; catch DMARC
  // wherever it sits. And the platform report/invite domains google.com and github.com are machinery whole
  // (gmail.com and a prospect's own host are a different host, so they stay OUT and a real person is safe).
  if(/dmarc/.test(from)) return true;
  var host0=(from.split("@")[1]||"");
  if(/^(google|github)\.com$/.test(host0)) return true;
  // Local parts that never belong to a person answering an outreach page. Kept to automated words only:
  // info/support/team/hello stay OUT, since a prospect may genuinely reply from one of those.
  if(/(^|[.+_-])(no-?reply|noreply|do-?not-?reply|donotreply|no_reply|no-?return|noreturn|no_return|mailer-daemon|postmaster|bounces?|dmarc|abuse|notifications?|notify|alerts?|newsletter|digest|automated|mailer|system|updates?)@/.test(from)) return true;
  var host=(from.split("@")[1]||"");
  if(/(^|\.)(bounce|mailer|reply|em|news|notify|notifications?|alerts?|updates?|mail|email|marketing)\./.test(host)) return true;   // notify.example.com, mail.example.com
  // A named email-marketing / bulk platform whose whole mail is machinery, matched by the exact sending
  // domain (not by a local part), so a prospect who happens to write from support@ their own company is
  // untouched. sender.net is an ESP; the eVA leads sender is caught above by its noreturn@ local part.
  if(/(^|\.)sender\.net$/.test(host)) return true;
  // Known platform and email-service-provider sending domains: their mail is machinery, never a prospect.
  // Consumer and corporate mail hosts (gmail, outlook, yahoo, a company domain) are deliberately NOT here.
  if(/(mailchimp|sendgrid|amazonses|mailgun|postmarkapp|sparkpostmail|sendinblue|mandrillapp|hubspot|intercom|zendesk|atlassian|slack|stripe|paypal|instagram|facebookmail|facebook|digitalocean|linkedin|twitter|github|notion|dmarcian)\./.test(host)) return true;
  var subj=String(r.subject||"").toLowerCase();
  if(/report domain:|dmarc aggregate report|aggregate report for|delivery status notification|undeliverable|unsubscribe from this|out of office|automatic reply|auto-?reply|read receipt|verify your|confirm your|password reset|new sign-?in|new login|security alert|weekly digest|daily digest/.test(subj)) return true;
  return false;
}

/* The reply-to-opportunity LINK is the normalized subject, matched to a send we made, and nothing else.
   Proven on the server: threadId does not join (a Gmail thread id, unrelated to the send), and the sender
   address must not be the link (a prospect answers from a personal address that never received the send).
   subjLinkKey strips a leading Re:/Fwd:/رد:/إعادة توجيه: then lower-trims, the same normalization the view
   (docs/supabase-board-view.sql) applies, so the client link and the server view resolve one reply to the
   same opportunity. This path reads the send ledger only; it knows nothing of users, permissions, or
   platform roles (a reply is a "reply to a campaign", never a person's identity). */
function subjLinkKey(s){
  return String(s||"")
    .replace(/^\s*(re|fwd|fw|رد|إعادة\s*توجيه)\s*:\s*/i,"")
    .replace(/^\s*(re|fwd|fw|رد)\s*:\s*/i,"")
    .trim().toLowerCase();
}
// The opportunity a reply links to: the opp of the send whose subject the reply answers. Linked ONLY when
// every send sharing the reply's normalized subject resolves to ONE opportunity; a subject that went out
// from two campaigns is ambiguous and stays unlinked (never attached to a random opp). Returns "" when no
// send subject matches, so a reply to nothing we sent is retained as unlinked noise, never guessed.
function subjectLinkOpp(r, sends){
  if(!r) return "";
  var root=subjLinkKey(r.subject||""); if(!root) return "";
  sends=sends||outboundSends();
  var opps={};
  for(var i=0;i<sends.length;i++){
    var m=sends[i];
    if(!m || !m.opp || m.direction==="in") continue;
    if(subjLinkKey(m.subject||"")===root) opps[m.opp]=1;
  }
  var keys=Object.keys(opps);
  return keys.length===1 ? keys[0] : "";
}
window.subjLinkKey=subjLinkKey; window.subjectLinkOpp=subjectLinkOpp;
// The send ledger rows a reply could answer: outbound only, carrying an opportunity.
function outboundSends(){
  return getMailLog().filter(function(m){ return m && m.opp && m.direction!=="in" &&
    (!m.status || m.status==="sent" || m.status==="copied" || m.status==="replied"); });
}
// Match one reply to an opportunity. Identity is decided by the channel and by evidence of a prior send,
// never by who owns the address: this matcher knows nothing of operator or Auth accounts, so an operator
// address that answered a real send is a prospect reply, and an operator address that answered nothing is
// not. Returns { opp, tier, id, ambiguous } with opp "" when nothing matches, and it is the ONE matcher:
// the held re-match, the group spawn and the manual attach all resolve through this function, never a
// parallel ordering of their own.
// The attribution law, in strict priority. Higher tiers use more evidence and always win; the bare address
// never outranks a header or a subject match, and recency is only ever the last resort, never a way to beat
// a subject or header. One opportunity legitimately receives sends from several campaigns to the same
// address, so the address alone cannot decide between them: the subject root does, and recency only when no
// subject matches (flagged ambiguous, for a one-tap confirm). Tier ranks are shared with the repair pass.
var TIER_RANK={ header:3, subject:2, sender:1 };
function matchReply(r, sends){
  sends=sends||outboundSends();
  if(!r) return { opp:"", tier:"", id:"", ambiguous:false };
  // tier 1, header: In-Reply-To / References against a recorded wire Message-ID. The absolute winner: it
  // names one specific send, so it resolves even two opportunities sent to the same address, and nothing
  // below it can override it (an edited subject, a newer send, all lose to the header).
  var ids=inReplyIds(r);
  if(ids.length){
    for(var i=0;i<sends.length;i++){
      var wid=String(sends[i].msgid||sends[i].messageId||"").replace(/^<|>$/g,"").trim();
      if(wid && ids.indexOf(wid)>=0) return { opp:sends[i].opp, tier:"header", id:wid, ambiguous:false };
    }
  }
  // The address's sends. A match needs a real send record, so an address alone never attributes: a reply
  // from an address nobody wrote to (a forward from a third party, S6) has no candidate and stays unmatched.
  var from=String(r.from||"").trim().toLowerCase();
  var hits=[];
  if(from) for(var j=0;j<sends.length;j++){ if(String(sends[j].to||"").trim().toLowerCase()===from) hits.push(sends[j]); }
  if(!hits.length) return { opp:"", tier:"", id:"", ambiguous:false };
  // One opportunity ever wrote to this address: the address is unambiguous, so it decides on its own.
  var oppsAll={}; for(var h=0;h<hits.length;h++) oppsAll[hits[h].opp]=1;
  if(Object.keys(oppsAll).length===1){
    var only=hits[0]; for(var l=1;l<hits.length;l++){ if(String(hits[l].ts)>String(only.ts)) only=hits[l]; }
    return { opp:only.opp, tier:"sender", id:from, ambiguous:false };
  }
  // tier 2, subject: more than one opportunity wrote to this address, so the bare address cannot decide.
  // The normalized subject root (Re/Fwd and «رد/إعادة توجيه» stripped) selects the sends whose subject the
  // reply answers, and THOSE are the only candidates. Recency breaks ties only WITHIN them, so a newer send
  // whose subject does not match never wins over an older send whose subject does (S2). Ambiguous only when
  // the matching sends still span more than one opportunity (the same subject went to two campaigns).
  var root=subjRoot(r.subject||"");
  if(root){
    var subjHits=[]; for(var k=0;k<hits.length;k++){ if(subjRoot(hits[k].subject||"")===root) subjHits.push(hits[k]); }
    if(subjHits.length){
      var sh=subjHits[0]; for(var s2=1;s2<subjHits.length;s2++){ if(String(subjHits[s2].ts)>String(sh.ts)) sh=subjHits[s2]; }
      var subjOpps={}; for(var s=0;s<subjHits.length;s++) subjOpps[subjHits[s].opp]=1;
      return { opp:sh.opp, tier:"subject", id:root, ambiguous:Object.keys(subjOpps).length>1 };
    }
  }
  // tier 3, recency: no send's subject matches (an edited or stripped subject with no header, S4). The last
  // resort only: the most recent send to this address, always flagged ambiguous so a guess is never
  // presented as certain (the attach picker can correct it). Recency is reached ONLY here.
  var b2=hits[0]; for(var l2=1;l2<hits.length;l2++){ if(String(hits[l2].ts)>String(b2.ts)) b2=hits[l2]; }
  return { opp:b2.opp, tier:"sender", id:from, ambiguous:true };
}
// Re-match every held reply through the console matcher. The tiers run FIRST, before the noise
// classifier, so a genuine reply from a no-reply-looking address is never discarded; noise only decides
// how an UNMATCHED row is displayed, never whether it may match. Idempotent: it stamps the match reason
// (tier, the identifier it matched on, auto vs manual, and any ambiguity) on existing rows and creates no
// thread row, so a second run changes nothing. Reads the authoritative store (Supabase when reads are
// switched, else the device) and writes back to both, so the card flips to Replied by the derivation.
function rematchHeld(){
  var sends=outboundSends();
  var rows=getInbound();
  var matched=0, repaired=0, byTier={ header:0, sender:0, subject:0 }, ambiguous=0;
  var next=rows.map(function(r){
    // Machinery (a mailer-daemon bounce) is never a prospect reply. Noise is NOT a gate here: it is judged
    // only at display, after the tiers had their chance.
    if(!r || r.kind==="auto") return r;
    // A hand attach is immutable (it teaches the truth by hand), and a header match is the absolute winner,
    // so neither is ever re-evaluated. Everything else runs through the one law, held or already attributed.
    if(r.match_mode==="manual" || r.match_tier==="header") return r;
    var mm=matchReply(r, sends);
    // An attributed row keeps its attribution when the matcher now finds nothing (the sends it matched may
    // be momentarily absent); a blank opp is never written over a real one.
    if(!mm.opp) return r;
    if(!r.opp){
      matched++; byTier[mm.tier]=(byTier[mm.tier]||0)+1; if(mm.ambiguous) ambiguous++;
      var chapter=r.chapter;
      if(chapter==null){ try{ chapter=activeChapter(mm.opp); }catch(e){ chapter=1; } }
      var stamped=Object.assign({}, r, { opp:mm.opp, match_tier:mm.tier, match_id:mm.id, match_mode:"auto", chapter:chapter });
      if(mm.ambiguous) stamped.match_ambiguous=true; else delete stamped.match_ambiguous;
      return stamped;
    }
    // Repair pass. The row is already auto-attributed, but the law may now resolve it better than the stale
    // attribution did (a subject or header send that did not yet exist when it first matched). Re-point ONLY
    // on a strict tier UPGRADE (a stronger tier now names a different opportunity), or when the SAME tier now
    // names a different, non-ambiguous opportunity the old match got wrong. Never downgrade, and never demote
    // a subject match to a bare-address recency guess: recency can never take a row away from a subject.
    if(mm.opp===r.opp) return r;
    // The row may already point at the spawned CHILD of the opportunity the matcher names (a group reply's
    // child carries the parent's send-opp). That is the correct derivation, not a stale mismatch, so a child
    // is never re-pointed back onto its own parent.
    if(r.opp===childSlugFor(mm.opp, r.from)) return r;
    var cur=TIER_RANK[r.match_tier||"sender"]||0, now=TIER_RANK[mm.tier]||0;
    var upgrade=now>cur;
    var sameTierFix=(now===cur && !mm.ambiguous);
    if(!(upgrade || sameTierFix)) return r;
    repaired++; byTier[mm.tier]=(byTier[mm.tier]||0)+1; if(mm.ambiguous) ambiguous++;
    var fixed=Object.assign({}, r, { opp:mm.opp, match_tier:mm.tier, match_id:mm.id, match_mode:"auto" });
    if(mm.ambiguous) fixed.match_ambiguous=true; else delete fixed.match_ambiguous;
    return fixed;
  });
  if(matched || repaired){
    setInbound(next);
    try{ if(__supa.inbound) __supa.inbound=next.slice(); }catch(_){}
    try{ invalidateSends(); }catch(_){}
    try{ logActivity("rematch","", matched+" matched"+(repaired? (", "+repaired+" repaired") : "")+(ambiguous? (", "+ambiguous+" ambiguous") : "")); }catch(_){}
  }
  // A reply attributed to a group campaign spawns the individual child that carries its Replied state. Run
  // after matching, on the same one action, and idempotently, so re-match never doubles a child.
  var sp=spawnChildrenFromReplies();
  if(matched || repaired || sp.spawned || sp.moved){ try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){} }
  var after=getInbound();
  var held=after.filter(function(r){ return r && r.kind!=="auto" && !r.opp && !inboundIsNoise(r); }).length;
  var noise=after.filter(function(r){ return r && r.kind!=="auto" && !r.opp && inboundIsNoise(r); }).length;
  // Brief B: an attribution is a write. It goes onto the Stage 4 durable queue (setInbound ->
  // supaMirrorInbound -> supaQueueUpsert), but supaFlush only POSTs when signed in, because RLS refuses
  // an anon write. So a match made while Supabase is configured but the operator is not signed in is
  // saved on this device and QUEUED, not yet on the board (which reads Supabase). Report that honestly,
  // so the success is never hollow: pendingSupa means "sign in to sync"; a sign-in flushes it (supaHydrate).
  var touched = matched>0 || repaired>0;
  var pendingSupa = touched && supaOn() && !supaSignedIn();
  var synced = touched && supaOn() && supaSignedIn();
  return { matched:matched, repaired:repaired, byTier:byTier, ambiguous:ambiguous, spawned:sp.spawned, held:held, noise:noise,
           pendingSupa:pendingSupa, synced:synced };
}
// Attach one held reply to an opportunity by hand (the picker records this as tier manual, teaching
// nothing silently). Idempotent by the reply's own key.
function attachReply(gid, slug){
  if(!gid || !slug) return false;
  var rows=getInbound(), touched=false;
  var next=rows.map(function(r){
    if(r && inboundKey(r)===String(gid)){ touched=true;
      return Object.assign({}, r, { opp:slug, match_tier:"manual", match_mode:"manual", match_id:String(r.from||""), match_ambiguous:false }); }
    return r;
  });
  if(!touched) return false;
  setInbound(next);
  try{ if(__supa.inbound) __supa.inbound=next.slice(); }catch(_){}
  try{ invalidateSends(); }catch(_){}
  try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){}
  try{ logActivity("attach", slug, String(gid)); }catch(_){}
  return true;
}

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

  const before=getInboundLocal();   // merge the pull against the current store, not the read cache
  const merged=ThriveInbound.mergeInbound(before, j.records);
  /* Part 2: link each real reply to its opportunity by normalized subject, on write. The relay writes an
     inbound row with no opp (confirmed: opp is empty for every row), so nothing attaches until we compute
     it here. A real reply is a non-auto, non-noise row; its opp is the send whose subject it answers. A
     subject match fills opp; no match leaves it unlinked (retained noise), never attached to a random opp;
     a header or hand attach that already set opp is never overwritten. This is a superset backfill: it also
     links older rows the relay wrote before this path existed. Never reads sender address or threadId. */
  var __sends=outboundSends();
  merged.forEach(function(r){
    if(!r || r.kind==="auto" || r.opp || inboundIsNoise(r)) return;
    var opp=subjectLinkOpp(r, __sends);
    if(opp){ r.opp=opp; r.match_tier="subject"; r.match_mode="auto"; r.match_id=subjLinkKey(r.subject||""); }
  });
  /* WO-015 Phase D: attribute each reply to the chapter that was live when it
     arrived. The relay knows the slug from the reply-to tag but not the chapter,
     so a reply with no chapter reads as the opportunity's active chapter, which is
     two once the offer has gone out. Additive and idempotent: a record that
     already carries a chapter keeps it. */
  merged.forEach(r=>{ if(r && r.opp && r.chapter==null){ try{ r.chapter=activeChapter(r.opp); }catch(e){ r.chapter=1; } } });
  if(merged.length===before.length && JSON.stringify(merged)===JSON.stringify(before)) return 0;
  setInbound(merged);
  // Part 1: confirm the newly-arrived human replies reached the server, so the board (which reads the server
  // view) counts them; a failure is recorded on the diverge ledger and retried by the durable queue.
  try{
    // Confirm every reply now carrying an opp that the server does not yet hold with one: a brand-new row,
    // or an older row this pull just linked by subject (its opp was empty before). Same confirmed-write
    // discipline as the send path: supaConfirmInbound is durable-first, awaited, and records a failure on
    // the diverge ledger, so a linked reply the board must count is never dropped silently.
    var beforeOpp={}; before.forEach(function(r){ var k=inboundKey(r); if(k) beforeOpp[k]=String(r.opp||""); });
    var fresh=merged.filter(function(r){
      if(!r || r.kind==="auto" || !r.opp) return false;
      var k=inboundKey(r), prev=beforeOpp[k];
      return prev===undefined || prev==="";   // newly present, or newly linked (opp was empty before)
    });
    if(fresh.length) await supaConfirmInbound(fresh);
  }catch(_){}
  try{ if(j.scan) __inboxScan=j.scan; }catch(e){}
  /* The pull-time "replied" stamp is retired. The board derives Replied from the inbound records
     themselves (effStage -> hasReply), so a reply lands wherever the rows live, migrated or backfilled
     or read back from Supabase, with no second stored representation to drift. The reply rows written
     above by setInbound are the one source. */
  return merged.length-before.length;
}
let __inboxScan=null;
function inboxScanInfo(){ return __inboxScan; }

/* P22: reconciliation, read-only and throttled. The relay's inbox_reconcile compares the mailbox against
   what is filed and returns the gap. It runs a Gmail search, so the console asks at most every thirty
   minutes; the result feeds the board's loud "replies not filed" notice. Absent on a v5 relay, which just
   leaves the gap unknown and the notice silent. */
let __inboxRecon=null, __lastReconAt=0;
async function maybeReconcileInbound(){
  var now=Date.now();
  if(now - __lastReconAt < 30*60000) return;
  __lastReconAt=now;
  try{ var j=await relayOp("inbox_reconcile", { days:2 }); if(j && j.ok) __inboxRecon=j; }catch(_){}
}
function inboxReconInfo(){ return __inboxRecon; }

/* The ONE inbound-health read, from the heartbeat the relay stamps every sweep plus the reconciliation
   gap. delayed: the last sweep is older than three sweep intervals, so the poll may have stalled (an
   unauthorised trigger, an old deployment). backlog: the last sweep hit its read cap, or reconciliation
   found replies the mailbox has and the store does not. Silence becomes detectable. */
function inboundHealth(){
  var s=__inboxScan, out={ delayed:false, backlog:0, everyMin:15 };
  if(!s || !s.ts) return out;
  var every=Number(s.everyMin)||15; out.everyMin=every;
  var age=Date.now()-Date.parse(String(s.ts));
  if(isFinite(age) && age > every*3*60000) out.delayed=true;
  var gap=(__inboxRecon && Number(__inboxRecon.gap)>0) ? Number(__inboxRecon.gap) : 0;
  if(gap>0) out.backlog=gap;
  else if(s.capped) out.backlog=-1;   // capped: more may be waiting than one sweep reads, count unknown
  return out;
}
/* test hooks; harmless in prod (read-only health + seams to inject a heartbeat/reconciliation for a check) */
try{ if(typeof window!=="undefined"){ window.inboundHealth=inboundHealth;
  window.__inboxScanSet=function(s){ __inboxScan=s; }; window.__inboxReconSet=function(r){ __inboxRecon=r; }; } }catch(_){}

async function doSyncRound(ep, auth){
  const g=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:relayBody({ op:"state_get", auth:auth }) });
  const gj=noteRelayVersion(await g.json());
  /* §3: a version mismatch is reported as the version banner, not as a sync-auth
     failure, because the fix is a redeploy and not a credential. */
  if(!relayReady()) throw new Error(relayBannerText());
  if(!gj.ok) throw new Error(gj.error||"sync auth");
  if(gj.data) syncMergeApply(gj.data);
  // The relay merge just rewrote localStorage; fold the server-authoritative __supa copy back in so the
  // canonical stays the one reconciled truth of both transports (a no-op until __supa is hydrated).
  try{ reconcileCanonical(); }catch(e){}
  // Re-read the board's server-computed stage on the sync heartbeat, so a card whose signals changed
  // server-side (an open or a reply landed) moves forward on the next round without a manual refresh.
  try{ if(supaReadFlagOn() && supaOn()) await readBoardView(); }catch(e){}
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
  try{ await maybeReconcileInbound(); }catch(e){}
  // P8: reconcile the campaign ledger from the relay's send queue on the same heartbeat (no new timer), so
  // a queued row that the relay has since sent shows as sent the next time anybody syncs. The device that
  // started the campaign can be closed; any device that syncs advances the truth.
  try{ await pullOutbox(ep, auth); }catch(e){}
  if(typeof window.onThriveSync==="function"){ try{ window.onThriveSync(); }catch(e){} }
}
/* P8: the durable send queue's transport to the relay. The console pushes a compiled batch and reads
   status; the relay (v6+) paces and sends. All three degrade silently on a v5 relay (unknown op), so a
   campaign started before the relay is redeployed simply waits, exactly like pullInbound. */
async function pushOutbox(rows){
  const ep=getSyncEndpoint(), auth=syncAuth();
  if(!ep || !auth || !rows || !rows.length) return { ok:false };
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:relayBody({ op:"outbox_push", auth:auth, rows:rows }) });
    const j=await r.json(); noteRelayVersion(j); return j;
  }catch(e){ return { ok:false, error:String((e&&e.message)||e) }; }
}
async function relayOutboxControl(opp, action, dues){
  const ep=getSyncEndpoint(), auth=syncAuth();
  if(!ep || !auth) return { ok:false };
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:relayBody({ op:"outbox_control", auth:auth, opp:opp, action:action, dues:dues||null }) });
    const j=await r.json(); noteRelayVersion(j); return j;
  }catch(e){ return { ok:false, error:String((e&&e.message)||e) }; }
}
async function pullOutbox(ep, auth){
  let j=null;
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:relayBody({ op:"outbox_status", auth:auth }) });
    j=await r.json();
  }catch(e){ return 0; }
  if(!j || !j.ok || !Array.isArray(j.rows)) return 0;   // a v5 relay has no queue: not an error, just nothing to reconcile
  return reconcileOutbox(j.rows);
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
  // INVARIANT I3, atomic batch: while an import/activate batch is staging its writes, no sync round is
  // scheduled, so syncNow cannot fire mid-batch, remerge remote state over a half-written batch, and
  // repaint the board against partial lanes. The batch fires ONE scheduleSyncPush after it commits.
  if(__batchDepth>0) return;
  if(!syncAuth()) return;
  clearTimeout(__syncPushT); __syncPushT=setTimeout(syncNow, 4000);
}
function startLiveSync(){
  if(!document.querySelector("header.top")) return;       // console pages only
  /* P48 gate-first boot: gate.js loads BEFORE app.js now, so on a WARM session the gate resolved and left
     window.__gateUnlockedPending (finish() found onGateUnlocked undefined). Drain it here, at DOMContentLoaded,
     where every top-level onThrive("unlock",...) handler (the P111 board force-hydrate, opnames, opprefs,
     mailreconcile, p27role) is registered and the DOM exists, so the warm-boot unlock fires exactly once. */
  try{ if(window.__gateUnlockedPending){ window.__gateUnlockedPending=false; if(typeof window.onGateUnlocked==="function") window.onGateUnlocked(); } }catch(_){}
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
  // INVARIANT I1/I2: publishing a PAGE never implies a send. The status field carried only the record's
  // own status and must not invent one: it used to default to "sent", so every activated page wrote
  // status:"sent" into the manifest for a business nobody had emailed, which normalizeOpp then promoted
  // to stage:"sent". Default to empty; the lane is derived from send evidence, not from this field.
  return { slug:rec.slug, business:rec.business||"", template:rec.template||"", sent_on:rec.sent_on||"",
    location:rec.location||"", phone:rec.phone||"", status:rec.status||"" };
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
/* Brief A: the published manifest is a static per-deploy file, the same between two paints, so it is not a
   source of the oscillation. Cache it once so the board's derivation can run SYNCHRONOUSLY (no await
   between resolving the authority and painting), which is what lets one generation win deterministically
   instead of whichever async build resolves last. */
var __manifestCache=null;
async function ensureManifest(){ if(!__manifestCache){ __manifestCache=await loadManifest(); } return __manifestCache; }
function manifestNow(){ return __manifestCache || { site:SITE, list:[] }; }
/* The current store, read straight from localStorage. This is the WRITE target and the fallback: every
   write merges against it and saves to it, and a read falls back to it when Supabase reads are off or
   degraded. Stage 4 retires it; here it stays the safety net. */
function getDraftsLocal(){ try{ return JSON.parse(localStorage.getItem(STORE)||"[]"); }catch(e){ return []; } }
/* WO-029: read-side reconstruction of a group reply's child card. A group reply becomes Replied only
   through the child card spawnChildrenFromReplies mints at childSlugFor(parent, addr); the parent group
   never enters Replied. When that child opportunity never persisted (the flush race named in the PR: the
   console_opps upsert is stranded behind an in-progress supaFlush), the inbound row points at a child
   slug with no card in the read store, so effStage is never computed for it and Replied stays 0 while the
   attribution is correct. This DERIVES the missing child from the two records that DID persist, the parent
   group and the child-suffixed inbound row, so effStage reads Replied and the lane, the recipient panel
   and the badge all reflect it. Derivation-only and idempotent: it is never written back (setDrafts strips
   it), so it never re-enters the write path. Memoized, invalidated on any opp/inbound change. */
var __reconCache=null;
// Visibility counter for the net (not UI). With the flush race closed (brief: the child opp now persists),
// this should reconstruct NOTHING on fresh data. It stays as the safety net for any historic or exotic gap,
// so a non-zero count is the signal that a real child opp went missing again: a regression, made visible.
// Read window.__thriveReconCount at any time; each firing also logs one line naming the slugs it derived.
window.__thriveReconCount = window.__thriveReconCount || 0;
function invalidateRecon(){ __reconCache=null; }
function reconstructChildren(base){
  if(__reconCache) return __reconCache;
  var have={}; (base||[]).forEach(function(o){ if(o && o.slug) have[o.slug]=1; });
  var out=[], seen={};
  getInbound().forEach(function(r){
    if(!r || !r.opp || r.kind==="auto") return;
    var slug=String(r.opp), cut=slug.indexOf("--r-");
    if(cut<0 || have[slug] || seen[slug]) return;              // only a child slug with no card, once each
    var parentSlug=slug.slice(0, cut);
    var parent=(base||[]).find(function(o){ return o && o.slug===parentSlug; });
    if(!parent || !isGroupOpp(parent)) return;                 // only under a real group parent in the store
    var addr=String(r.from||"").trim().toLowerCase(); if(!addr) return;
    var roster=campaignRecipients(parent).find(function(x){ return x.addr===addr; }) || { addr:addr, name:(r.name||""), lang:"" };
    seen[slug]=1;
    out.push({ slug:slug, business:(roster.name||addr), published:!!parent.published,
      spawned_from:{ parent:parentSlug, addr:addr }, recipients:[roster],
      lang:roster.lang||parent.lang||"", _reconstructed:true });
  });
  if(out.length){
    try{ window.__thriveReconCount += out.length;
      console.warn("[thrive] reconstruction net fired (a child opp is missing from the store, flush-race regression?):",
        out.map(function(o){ return o.slug; }).join(", "), "total:", window.__thriveReconCount); }catch(_){}
  }
  __reconCache=out; return out;
}
/* The READ accessor (Stage 3). When reads are switched to Supabase and the cache is hydrated and not
   degraded, opportunities and their pages come from the stable Supabase rows (a full localStorage no
   longer breaks what is shown and the cards stop flickering). Otherwise it falls back to the current
   store, so a Supabase hiccup is never a blank or a false-empty board. Writes never call this. A missing
   group-reply child card is reconstructed on read (above), so the board counts the reply either way. */
/* Brief A: one authority per render cycle. resolveAuthority decides local-vs-supa ONCE and freezes a
   snapshot of every store the board reads; deriveBoardModel pins it (__boardPin) for the whole synchronous
   cycle, so every accessor below and every derivation reads that one snapshot, never re-choosing the
   authority per call (F1), never a live global re-read mid-build (F3), and never a stale TTL cache (F4). */
var __boardPin=null, __renderGen=0;
function resolveAuthority(){
  // ONE canonical model, no authority choice. Supabase (__supa) is folded into localStorage by
  // reconcileCanonical on every hydrate and every sync round, so localStorage IS the reconciled truth
  // and the board reads exactly it, never picking between two live copies per cycle (the store fork).
  // Kick the hydrate here so a signed-in board always has a fresh server copy to reconcile from; the
  // kick is idempotent (no-op once hydrated) and reconcileCanonical + a board refresh run when it lands.
  try{ if(supaReadFlagOn() && supaOn()) supaEnsureHydrated(); }catch(e){}
  return { kind:"canonical", opps:getDraftsLocal(), mail:getMailLogLocal(),
    inbound:getInboundLocal(), hits:getRemoteHitsLocal().concat(getHitsLocal()) };
}
function getDrafts(){
  var base=null;
  if(__boardPin){
    base=__boardPin.opps.map(function(d){ return Object.assign({}, d); });
    var pk=reconstructChildren(base);
    return pk.length ? base.concat(pk) : base;
  }
  // One canonical model: reads come from localStorage, into which reconcileCanonical has folded the
  // server-authoritative Supabase copy. The __supa read branch is retired (it was the store fork). Still
  // kick the hydrate so a signed-in device pulls a fresh server copy to reconcile from; the kick is
  // idempotent and a board refresh runs when it lands.
  if(supaReadFlagOn() && supaOn()) supaEnsureHydrated();
  if(!base) base=getDraftsLocal();
  var kids=reconstructChildren(base);
  return kids.length ? base.concat(kids) : base;
}
// A reconstructed child is derivation-only and must never be written back (constraint 1): strip it before
// any write to the device store, so it cannot re-enter the write path or mirror to Supabase.
function setDrafts(a){ invalidateRecon(); return lsSet(STORE, JSON.stringify((a||[]).filter(function(o){ return !(o && o._reconstructed); }))); }
function getDraft(slug){ return getDrafts().find(x=>x.slug===slug); }
function saveDraft(rec){
  rec.up=Date.now();                                     // freshness stamp for cross-device merge
  const a=getDraftsLocal(); const i=a.findIndex(x=>x.slug===rec.slug);   // merge against the current store, always
  // P27: attribution on the opportunity write itself, additive. Every write carries the member who made it
  // (edited_by); a first write also records the creator (created_by). So no opp write bypasses the actor, and
  // an existing creator is never overwritten (created_by is only set when the record is new).
  try{ rec.edited_by=currentActor(); rec.edited_at=new Date().toISOString(); if(i<0 && !rec.created_by) rec.created_by=currentActor(); }catch(_){}
  const merged = (i>=0) ? {...a[i], ...rec} : rec;
  if(i>=0) a[i]=merged; else a.push(merged); setDrafts(a);
  try{ supaCachePut(merged); }catch(_){}                 // keep the read cache consistent after a write
  // Stage 2 dual-write: mirror the merged record to Supabase, fire-and-forget. Never fails this save.
  try{ supaMirrorOpp(merged); }catch(_){}
}
function removeDraft(slug){ markRemoved("opp", slug); setDrafts(getDraftsLocal().filter(x=>x.slug!==slug)); try{ supaCacheDrop(slug); }catch(_){} try{ supaDeleteOpp(slug); }catch(_){} }
window.saveDraft=saveDraft;
/* INVARIANT I3, atomic batch commit: apply MANY records to the store as ONE transition. saveDraft writes
   the store once per record, so a batch of N leaves N intermediate store states, each visible to any
   repaint that races the loop; that is the scatter and the oscillation. This merges every record against
   one snapshot and writes the store EXACTLY ONCE (one lsSet, so one scheduleSyncPush), so the board only
   ever sees the store before the batch or after it, never a partial batch. Same per-record merge semantics
   as saveDraft; the cache and the Stage-4 mirror are updated per merged record after the single write. */
function commitDraftsBatch(records){
  records=(records||[]).filter(Boolean);
  if(!records.length) return [];
  const a=getDraftsLocal(); const idx={}; a.forEach((x,i)=>{ idx[x.slug]=i; });
  const merged=[];
  records.forEach(rec=>{
    rec.up=Date.now();
    const i=idx[rec.slug];
    try{ rec.edited_by=currentActor(); rec.edited_at=new Date().toISOString(); if(i===undefined && !rec.created_by) rec.created_by=currentActor(); }catch(_){}   // P27 attribution, additive
    const m = (i>=0) ? {...a[i], ...rec} : rec;
    if(i>=0) a[i]=m; else { idx[rec.slug]=a.length; a.push(m); }
    merged.push(m);
  });
  setDrafts(a);                                          // the ONE write: one store transition, one sync schedule
  merged.forEach(m=>{ try{ supaCachePut(m); }catch(_){} try{ supaMirrorOpp(m); }catch(_){} });
  return merged;
}

/* ---------- Supabase dual-write mirror (Stage 2) ----------
   Every write that lands in the current store (localStorage plus the relay) is also mirrored to the
   matching console_ row in Supabase, through the Stage 1 client. This is REVERSIBLE and SAFE: reads
   still come from the current store (Stage 3 switches that), a Supabase failure NEVER fails the user's
   action (it is fire-and-forget, caught, recorded, and shown as a divergence, never a false success and
   never swallowed), and when Supabase is unconfigured every mirror is a no-op. Isolation holds: every
   call goes through the client's console_ allow-list guard. A page's HTML is its own row (console_pages),
   never packed into the opportunity row. */
var SUPA_DIVERGE="console_sb_diverge";
function supaOn(){ return typeof window!=="undefined" && window.ThriveSupa && window.ThriveSupa.ready(); }
function supaDiverges(){ try{ return JSON.parse(localStorage.getItem(SUPA_DIVERGE)||"[]"); }catch(e){ return []; } }
function supaRecordDiverge(kind, key, msg){
  try{ var a=supaDiverges(); a.push({ kind:kind, key:key, msg:String(msg||"").slice(0,200), ts:new Date().toISOString() });
    localStorage.setItem(SUPA_DIVERGE, JSON.stringify(a.slice(-50))); }catch(e){}
  try{ logActivity("supa_diverge", kind+":"+key, String(msg||"").slice(0,120)); }catch(e){}
}

/* ---------- Stage 4: Supabase is the single source; the device is a cache ----------
   When an operator is signed in, Supabase is the authority. Reads come from it (the hydrate, gated by
   the session since the last brief). Writes are made DURABLE here: every mirror is recorded to a local
   pending queue BEFORE it is attempted, so a mirror that fails (offline, a transient error) is retried
   on the next flush (the next write, or the next sign-in) and never lives only in a device store that a
   Safari data-clear would wipe. Upserts merge by primary key and deletes are idempotent, so replaying
   the queue is safe (at-least-once). Once the queue drains, everything the operator did is in Supabase,
   and a cleared device rebuilds from it with no manual step. The local store is written alongside as a
   cache and an offline-read convenience, never as a second source of truth. The verify/backfill in
   Settings is now a one-time migration for a device that still holds records made before this queue,
   not part of the normal path. */
var PENDING="console_sb_pending";
function supaPending(){ try{ return JSON.parse(localStorage.getItem(PENDING)||"[]"); }catch(e){ return []; } }
function supaSetPending(a){ try{ localStorage.setItem(PENDING, JSON.stringify((a||[]).slice(-4000))); }catch(e){} }
function supaEnqueue(entry){ try{ var a=supaPending(); a.push(entry); supaSetPending(a); }catch(e){} }
var __supaFlushing=false, __supaFlushAgain=false;
/* Replay every queued write to Supabase, dequeuing each on success and keeping the rest for the next pass.
   Only attempts when signed in (an anon write would be refused by RLS and pointlessly churn).

   The flush race (named in #104 and #108, proven in the live data: a spawned child opportunity never
   persisted while its inbound re-point did) lived here. The old body snapshotted the queue once, and a
   second flush requested while one ran early-returned and was lost; worse, the running flush wrote its
   `left` back over the queue, ERASING any entry appended mid-flight. An entry queued microseconds after a
   flush began (the child opp, then the inbound row that points at it) was silently dropped from Supabase.

   Closed two ways, queue mechanics only:
   - Drain until empty. Each cycle re-reads the queue, so an entry appended DURING a pass is picked up in
     the same drain, in order. The queue is only ever APPENDED to elsewhere (supaEnqueue), so the snapshot
     `a` stays a prefix of the live queue and the tail that arrived mid-pass is preserved, never clobbered.
   - Coalesced trigger. A flush requested while one is running sets __supaFlushAgain instead of no-opping,
     so the intent to run is never lost even at exact timing; the running drain honours it before exiting.
   FIFO is preserved: still-unsent failures keep their place ahead of the mid-flight tail, so a child opp
   lands before the inbound row that points at it, never the pointer without its target. A pass that makes
   no progress and finds nothing new does not loop (no spin); its failures wait for the next trigger. */
async function supaFlush(){
  if(!supaOn() || !supaSignedIn()) return { flushed:0, left:supaPending().length };
  if(__supaFlushing){ __supaFlushAgain=true; return { flushed:0, left:supaPending().length, coalesced:true }; }
  __supaFlushing=true;
  var flushed=0;
  try{
    while(true){
      __supaFlushAgain=false;
      var a=supaPending();
      if(a.length){
        var left=[], progressed=false;
        for(var i=0;i<a.length;i++){
          var e=a[i];
          try{
            if(e.op==="del") await window.ThriveSupa.del(e.t, e.q);
            else if(e.t==="console_mail") await mailUpsert(e.rows);  // the frozen path: schema-drift resilient
            else await window.ThriveSupa.upsert(e.t, e.rows);
            flushed++; progressed=true;
          }catch(err){ left.push(e); supaRecordDiverge("flush", e.t, err&&err.message); }
        }
        // Anything appended while this pass ran (the queue grew past our snapshot) is preserved, in arrival
        // order, AFTER the still-unsent failures: rewrite the queue as failures ++ mid-flight tail.
        var tail=supaPending().slice(a.length);
        supaSetPending(left.concat(tail));
        if(progressed || tail.length || __supaFlushAgain) continue;   // more to do, or new work arrived
        break;                                                        // only un-sendable failures remain
      } else {
        if(__supaFlushAgain) continue;                                // an enqueue raced in as we emptied
        break;                                                        // fully drained
      }
    }
  } finally { __supaFlushing=false; }
  try{ reconcileSendingMail(); }catch(_){}   // a landed send graduates 'sending' -> 'sent' (recovery half)
  try{ reconcileStuckSending(); }catch(_){}  // a send that never confirmed within the timeout -> 'unrecorded' (visible failed)
  return { flushed:flushed, left:supaPending().length };
}
function supaQueueUpsert(table, rows){
  if(!supaOn()) return;
  supaEnqueue({ op:"upsert", t:table, rows:Array.isArray(rows)?rows:[rows] });
  supaFlush().catch(function(){});
}
function supaQueueDel(table, q){
  if(!supaOn()) return;
  supaEnqueue({ op:"del", t:table, q:q });
  supaFlush().catch(function(){});
}
window.thriveSupaPendingCount = function(){ try{ return supaPending().length; }catch(e){ return 0; } };
window.thriveSupaFlush = function(){ return supaFlush(); };

/* Templates hydrate into the local cache (Stage 4): console_templates carries the operator's custom
   email and page templates. On a cleared device the read accessors (getEmailTemplates, getCustomTemplates)
   read the local cache, so hydrate writes any Supabase template the cache is missing back into it, by id,
   idempotently. The stock-seeding logic in getEmailTemplates is untouched: this only ADDS what is absent. */
function supaMergeTemplatesToCache(rows){
  try{
    var email=[], page=[];
    (rows||[]).forEach(function(r){
      if(!r || !r.id) return;
      var rec={ id:r.id, name:r.name||"", subject:r.subject||"", html:r.html||"", lang:r.lang||"", up:r.up||Date.now() };
      (r.kind==="page" ? page : email).push(rec);
    });
    if(email.length){
      var e=JSON.parse(localStorage.getItem(ETPL)||"[]"), have={}; e.forEach(function(x){ have[x.id]=1; });
      var add=email.filter(function(x){ return !have[x.id]; });
      if(add.length) localStorage.setItem(ETPL, JSON.stringify(e.concat(add)));
    }
    if(page.length){
      var p=JSON.parse(localStorage.getItem(TPLSTORE)||"[]"), hp={}; p.forEach(function(x){ hp[x.id]=1; });
      var addp=page.filter(function(x){ return !hp[x.id]; });
      if(addp.length) localStorage.setItem(TPLSTORE, JSON.stringify(p.concat(addp)));
    }
  }catch(e){}
}
/* An opportunity becomes one console_opps row. The whole record travels in the data jsonb (forward
   compatible), minus the page html, which becomes its own console_pages row. */
function supaRowFromOpp(d){
  if(!d) return null;
  var data=Object.assign({}, d); delete data.html;
  return { slug:d.slug, business:d.business||"", stage:d.stage||"",
    published:!!d.published, archived:!!d.archived,
    outreach_subject:d.outreach_subject||"", outreach_text:d.outreach_text||"",
    channel:d.channel||null, data:data, up:d.up||Date.now() };
}
function supaMirrorOpp(d){
  if(!supaOn() || !d || !d.slug) return;
  supaQueueUpsert("console_opps", supaRowFromOpp(d));
  if(d.html) supaQueueUpsert("console_pages", { slug:d.slug, html:d.html });
}
function supaDeleteOpp(slug){
  if(!supaOn() || !slug) return;
  var q="slug=eq."+encodeURIComponent(slug);
  supaQueueDel("console_opps", q);
  supaQueueDel("console_pages", q);
}
/* Templates. console_templates carries the core columns; a page template's or snippet's type-specific
   extras (type, template_ref) have no column in the Stage 1 schema and are not mirrored in Stage 2. That
   is raised in the PR: an additive data jsonb column can carry them in a later stage if Stage 3 needs
   them. The current store remains the source of truth, so nothing is lost. */
function supaMirrorTemplates(list, kind){
  if(!supaOn() || !list || !list.length) return;
  var rows=list.map(function(rec){ return { id:rec.id, kind:kind, name:rec.name||"", subject:rec.subject||"",
    html:rec.html||"", lang:rec.lang||"", up:rec.up||Date.now() }; });
  supaQueueUpsert("console_templates", rows);
}
function supaMailRow(rec){
  // actor is a first-class column now (docs/supabase-profile-phase-b.sql), mirrored from the record's own
  // stamp so per-operator sends can be aggregated server-side; it is set only at the write site, never
  // backfilled, so a record with no actor stays honestly empty.
  return { id:rec.mid||rec.id||"", opp:rec.opp||"", status:rec.status||"", to_addr:rec.to||"",
    subject:rec.subject||"", ts:rec.ts||new Date().toISOString(), actor:rec.actor||"", data:rec, up:rec.up||Date.now() };
}
function mailOppOk(rec){ return !!String((rec&&rec.opp)||"").trim(); }
function supaMirrorMail(rec){
  if(!supaOn() || !rec) return;
  // Part 2: every console_mail row must carry its opp slug; an empty-opp row has no lane to land on (the two
  // empty-opp rows in production prove this was unguarded), so it is refused and recorded, never written.
  if(!mailOppOk(rec)){ supaRecordDiverge("write", "console_mail", "refused: empty opp"); return; }
  // 'pending'/'sending' are transient LOCAL outbox states: the server row is minted only when the relay
  // accepted the email, via supaConfirmMail. Skipping them keeps a failed/in-flight send off the server.
  if(rec.status==="pending" || rec.status==="sending" || rec.status==="unrecorded") return;   // transient/failed LOCAL states are never a server row
  supaQueueUpsert("console_mail", supaMailRow(rec));
}
/* Schema-drift resilience for console_mail (the 28-row freeze; full diagnosis in docs/supabase-mail-actor-column.sql).
   supaMailRow emits a top-level `actor` column that exists only after the manual profile-phase-b migration; a DB
   that never ran it rejects EVERY upsert, which the write path caught but never surfaced. So the write must not
   hard-depend on a column a later migration adds. */
var MAIL_OPTIONAL_COLS=["actor"];   // added by a later migration; each is ALSO inside data jsonb
function mailColMissing(e){
  // A PostgREST schema miss: the deployed table lacks a column the row names (PGRST204 / 42703 / named in the
  // message). Not an auth or network error - a shape mismatch.
  if(!e) return false;
  var body=e.body, code=(body&&(body.code||""))||"";
  if(code==="PGRST204" || code==="42703") return true;
  var msg=String((e&&e.message)||"").toLowerCase();
  return /could not find the .*column|column .* does not exist|schema cache/.test(msg);
}
function stripOptionalMailCols(row){ var r=Object.assign({}, row); MAIL_OPTIONAL_COLS.forEach(function(c){ delete r[c]; }); return r; }
/* The one console_mail writer. Try the full row; if the server is a migration behind (a missing optional
   column), drop the optional top-level columns and retry - each survives inside data jsonb, so nothing is lost
   and the send records whether or not the actor migration ran. The drift is recorded, visible, never silent. */
async function mailUpsert(rows){
  var arr=Array.isArray(rows)? rows : [rows];
  try{ return await window.ThriveSupa.upsert("console_mail", arr); }
  catch(e){
    if(mailColMissing(e)){
      try{ supaRecordDiverge("write", "console_mail", "schema behind: retried without optional column(s) ["+MAIL_OPTIONAL_COLS.join(",")+"]; run docs/supabase-mail-actor-column.sql"); }catch(_){}
      return await window.ThriveSupa.upsert("console_mail", arr.map(stripOptionalMailCols));
    }
    throw e;
  }
}
window.mailUpsert=mailUpsert;
/* The write invariant: a send is not "sent" until the SERVER has the row. The row is queued durably (retried
   by supaFlush on the next write or sign-in), then a direct upsert is AWAITED so the caller learns if the
   server holds it before reporting Sent; a failure is recorded on the diverge ledger, never swallowed. This
   closes the gap where a fire-and-forget mirror dropped the row while the board (server view) showed Sent. */
async function supaConfirmMail(rec){
  if(!mailOppOk(rec)){ supaRecordDiverge("write", "console_mail", "refused: empty opp"); return { confirmed:false, refused:true }; }
  if(!supaOn()) return { confirmed:false, noServer:true };          // no server configured: the local store IS the truth
  var row=supaMailRow(rec);
  supaEnqueue({ op:"upsert", t:"console_mail", rows:[row] });        // durable: survives the direct attempt failing
  if(!supaSignedIn()) return { confirmed:false, signedOut:true };    // RLS refuses an anon write; it flushes on sign-in
  try{
    await mailUpsert([row]);                                        // the server now holds THIS row (schema-drift resilient)
    dequeueMail(row.id);                                             // confirmed: drop it from the durable queue
    supaFlush().catch(function(){});                                 // opportunistically drain anything else queued
    return { confirmed:true };
  }catch(e){
    supaRecordDiverge("write", "console_mail", e&&e.message);
    supaFlush().catch(function(){});                                 // leave it queued; the durable retry keeps trying
    return { confirmed:false, error:(e&&e.message)||"write failed" };
  }
}
/* Drop a confirmed row from the durable queue by table + id (its direct upsert landed), so the next flush
   does not write it twice. A now-empty entry drops. Shared by the mail and inbound confirm paths. */
function dequeueRow(table, id){
  try{
    var a=supaPending(), out=[];
    for(var i=0;i<a.length;i++){ var e=a[i];
      if(e && e.t===table && e.op==="upsert"){
        var rows=(e.rows||[]).filter(function(x){ return !(x && x.id===id); });
        if(rows.length) out.push(Object.assign({}, e, { rows:rows }));
      } else out.push(e);
    }
    supaSetPending(out);
  }catch(_){}
}
function dequeueMail(id){ dequeueRow("console_mail", id); }
/* A 'sending' mail row is a send whose email is out but whose server write had not confirmed. Once its
   queued console_mail upsert has flushed (no longer in the pending queue), the server holds it, so the row
   graduates to 'sent' and the card reaches Sent on its own. Runs after every flush; writes only on change. */
function reconcileSendingMail(){
  try{
    var a=getMailLogLocal(), changed=false, queuedIds={};
    supaPending().forEach(function(e){
      if(e && e.t==="console_mail" && e.op==="upsert") (e.rows||[]).forEach(function(x){ if(x&&x.id) queuedIds[x.id]=1; });
    });
    for(var i=0;i<a.length;i++){ var m=a[i];
      if(m && m.status==="sending" && String(m.opp||"").trim()){
        var id=m.mid||m.id||"";
        if(id && !queuedIds[id]){ a[i]=Object.assign({}, m, { status:"sent", confirmPending:false }); changed=true; }
      }
    }
    if(changed){ setMailLog(a); try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){} }
  }catch(e){}
}
/* The bounded lifetime enforcer. A 'sending' row not confirmed within SEND_CONFIRM_TIMEOUT_MS is no longer
   in-flight: the email left but the row never recorded, so it moves to 'unrecorded' (the visible failed
   state) and the divergence is recorded, never swallowed. This is the timeout that stops a card hanging on
   'sending' forever. Time is injectable (nowMs) so the rule is testable; runs on the sync cadence and paint. */
function reconcileStuckSending(nowMs, silent){
  var now=(typeof nowMs==="number")? nowMs : Date.now();
  var changed=false;
  try{
    var a=getMailLogLocal();
    for(var i=0;i<a.length;i++){ var m=a[i];
      if(m && m.status==="sending" && m.direction!=="in" && String(m.opp||"").trim()){
        var since=Number(m.sending_since||0);
        // No stamp (a legacy sending row, e.g. Fleurs before this fix) is treated as already overdue, so it
        // cannot hang: it surfaces as unrecorded immediately and the operator can retry the record.
        if(!since || (now-since) > SEND_CONFIRM_TIMEOUT_MS){
          a[i]=Object.assign({}, m, { status:"unrecorded", confirmPending:false, error:"delivered, not recorded" });
          changed=true;
          try{ supaRecordDiverge("write", "console_mail", "unrecorded: send delivered, server row not confirmed within timeout ("+String(m.opp)+")"); }catch(_){}
        }
      }
    }
    // silent: the caller is the paint itself and will read the fresh log on this same pass, so do not trigger
    // a nested refresh (which would re-enter the render). Otherwise repaint so the failed state shows at once.
    if(changed){ setMailLog(a); if(!silent){ try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){} } }
  }catch(e){}
  return changed;
}
window.reconcileStuckSending=reconcileStuckSending;
/* Retry the RECORD (not the relay POST): the email already left, so the fix is to get its row onto the server.
   Move the failed row back to 'sending' with a fresh stamp, re-enqueue its confirmed write durably, and flush.
   On success reconcileSendingMail graduates it to 'sent'; if the server is still unreachable it re-ages and
   surfaces as unrecorded again, so retry never hides a real failure. */
function retryRecord(slug){
  slug=(typeof slug==="string")? slug : ((slug&&slug.slug)||"");
  if(!slug) return false;
  try{
    var a=getMailLogLocal(), row=null;
    for(var i=a.length-1;i>=0;i--){ var m=a[i];
      if(m && m.opp===slug && m.direction!=="in" && m.status==="unrecorded"){ row=Object.assign({}, m, { status:"sending", confirmPending:true, sending_since:Date.now(), error:"" }); a[i]=row; break; }
    }
    if(!row) return false;
    setMailLog(a);
    try{ supaConfirmMail(Object.assign({}, row, { status:"sent" })).then(function(){ try{ reconcileSendingMail(); }catch(_){} }); }catch(_){}
    try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){}
    return true;
  }catch(e){ return false; }
}
window.retryRecord=retryRecord;
/* Reconcile the whole local ledger to the server (Step 3). The server is missing EVERY send since Aug 14, but
   the operator's device still holds them locally with their true recipient, subject and timestamp. This walks
   that ledger and upserts every delivered send (and every one the freeze stranded as unrecorded/sending)
   through mailUpsert, so the count moves and each card leaves "sent, not recorded" for its true Sent state.
   Idempotent (upsert by id). A stranded row that lands flips locally to 'sent'; a failure is recorded, never
   hidden. Runs once per session after hydrate; also callable by hand. */
var __mailReconciling=false;
async function reconcileMailToServer(){
  if(__mailReconciling) return { pushed:0, busy:true };
  if(!supaOn() || !supaSignedIn()) return { pushed:0, offline:true };
  __mailReconciling=true;
  var pushed=0, failed=0, changed=false;
  try{
    var log=getMailLogLocal();
    var DELIVERED={ sent:1, opened:1, replied:1, copied:1 };
    for(var i=0;i<log.length;i++){ var m=log[i];
      if(!m || m.direction==="in") continue;
      if(!String(m.opp||"").trim()) continue;                       // an empty-opp row has no lane; never written
      var stranded=(m.status==="unrecorded" || m.status==="sending");
      if(!DELIVERED[m.status] && !stranded) continue;               // only real, delivered sends reach the ledger
      var writeStatus=stranded? "sent" : m.status;                  // a delivered send the freeze stranded records as Sent
      try{
        await mailUpsert([supaMailRow(Object.assign({}, m, { status:writeStatus }))]);
        pushed++;
        if(stranded){ log[i]=Object.assign({}, m, { status:"sent", confirmPending:false, error:"" }); changed=true; }
      }catch(e){ failed++; try{ supaRecordDiverge("reconcile", "console_mail", e&&e.message); }catch(_){} }
    }
    if(changed){ setMailLog(log); try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){} }
  }catch(e){}
  __mailReconciling=false;
  return { pushed:pushed, failed:failed };
}
window.reconcileMailToServer=reconcileMailToServer;
/* A team-discussion comment becomes one console_comments row. Unlike the ledger, the shape is discrete
   columns (not a data jsonb): the RLS ownership check reads `author` and the open read selects the same
   named columns back, so the schema and the client speak one vocabulary. The row travels through the SAME
   Stage-4 queue as every other mutation (no second write path); the client-minted id is the primary key,
   so a replayed upsert merges in place and never doubles a comment. author_name is a snapshot taken from
   the poster's own console_profiles at post time: the profile RLS is own-read-only, so another operator's
   name cannot be read live, and snapshotting is how a comment renders its author's real name at all. */
function supaCommentRow(c){
  return { id:c.id, opp:c.opp||"", author:c.author||"", author_name:c.author_name||"",
    body:c.body||"", parent_id:c.parent_id||null,
    created_at:c.created_at||new Date().toISOString(), updated_at:c.updated_at||new Date().toISOString() };
}
function supaMirrorComment(c){
  if(!supaOn() || !c || !c.id) return;
  supaQueueUpsert("console_comments", supaCommentRow(c));
}
function supaDeleteComment(id){
  if(!supaOn() || !id) return;
  supaQueueDel("console_comments", "id=eq."+encodeURIComponent(id));
}
/* A Contact Book person record (P10) becomes one console_contacts row: curation facts only (the merge
   grouping of addresses, a curated name, tags, a note), stamped with its author. Activity history is never
   written here; it stays derived from the ledger. Same Stage-4 queued upsert path as every other mirror. */
function supaContactRow(c){
  return { id:c.id, addresses:(c.addresses||[]), name:(c.name!=null?c.name:null),
    tags:(c.tags||[]), note:(c.note!=null?c.note:null),
    author:c.author||currentActor()||"", author_name:c.author_name||"",
    created_at:c.created_at||new Date().toISOString(), updated_at:new Date().toISOString() };
}
function supaMirrorContact(c){
  if(!supaOn() || !c || !c.id) return;
  supaQueueUpsert("console_contacts", supaContactRow(c));
}
function supaDeleteContact(id){
  if(!supaOn() || !id) return;
  supaQueueDel("console_contacts", "id=eq."+encodeURIComponent(id));
}
/* A reply (inbound) becomes one console_inbound row, keyed on the Gmail message id (the same key the
   inbound merge dedupes on), the whole record in the data jsonb. This is the store that was missed in
   Stage 2, so a migrated reply, the international-schools one included, reappears once it is read back. */
function inboundKey(r){ return String((r&&(r.gid||r.messageId||r.mid||r.id))||""); }
function supaInboundRow(r){
  return { id:inboundKey(r)||("in_"+(r&&r.ts||"")), opp:(r&&r.opp)||"", kind:(r&&r.kind)||"",
    bounce:(r&&r.bounce)||"", ts:(r&&r.ts)||"", data:r, up:(r&&r.up)||Date.now() };
}
function supaMirrorInbound(list){
  if(!supaOn() || !list || !list.length) return;
  supaQueueUpsert("console_inbound", list.map(supaInboundRow));
}
/* Part 1: a reply is not counted until the SERVER holds the console_inbound row (the send-path rule). New
   human replies are written and AWAITED, durable-first (retried by the next flush); a failure is recorded
   on the diverge ledger, never swallowed. Closes the Replies-11, lane-0 gap where replies never landed. */
async function supaConfirmInbound(list){
  list=(list||[]).filter(function(r){ return r && r.opp && r.kind!=="auto"; });
  if(!list.length) return { confirmed:true, empty:true };
  if(!supaOn()) return { confirmed:false, noServer:true };
  var rows=list.map(supaInboundRow);
  rows.forEach(function(row){ supaEnqueue({ op:"upsert", t:"console_inbound", rows:[row] }); });   // durable
  if(!supaSignedIn()) return { confirmed:false, signedOut:true };    // RLS refuses anon; flushes on sign-in
  try{
    await window.ThriveSupa.upsert("console_inbound", rows);         // the server now holds these replies
    rows.forEach(function(row){ dequeueRow("console_inbound", row.id); });
    supaFlush().catch(function(){});
    return { confirmed:true, n:rows.length };
  }catch(e){
    supaRecordDiverge("write", "console_inbound", e&&e.message);
    supaFlush().catch(function(){});
    return { confirmed:false, error:(e&&e.message)||"write failed" };
  }
}
/* An open (hit) becomes one console_hits row, keyed on hitKey (type|slug|ts|vid), the same key allHits
   dedupes on, so a re-mirror or a re-backfill updates in place and never doubles an open. */
function supaHitRow(e){
  return { id:hitKey(e), slug:(e&&e.slug)||"", type:(e&&e.type)||"open", ts:(e&&e.ts)||"",
    self:!!(e&&e.self), data:e };
}
function supaMirrorHits(list){
  if(!supaOn() || !list || !list.length) return;
  supaQueueUpsert("console_hits", list.map(supaHitRow));
}
/* Settings travel as key/value rows. Secrets are deliberately NOT mirrored: the GitHub token, the sync
   session key, and the vault key never leave for an anon-readable table. Only non-secret settings (the
   endpoint URLs, the sending caps, the from name, the closing block) are mirrored. */
function supaMirrorSetting(key, value){
  if(!supaOn() || !key) return;
  supaQueueUpsert("console_settings", { key:key, value:(value===undefined?null:value) });
}
/* One-time, idempotent backfill: copy the current store's existing opportunities, pages, templates,
   mail ledger and non-secret settings into Supabase, so it holds the full picture, not only new writes.
   Upsert by key, so running it again changes nothing. It reads the current store and never writes to it. */
async function supaBackfill(){
  if(!supaOn()) throw new Error(t("sb_need"));
  var S=window.ThriveSupa, res={ opps:0, pages:0, templates:0, mail:0, inbound:0, hits:0, settings:0, failed:0 };
  var drafts=getDraftsLocal();
  for(var i=0;i<drafts.length;i++){
    var d=drafts[i];
    try{ await S.upsertOpp(supaRowFromOpp(d)); res.opps++; }
    catch(e){ res.failed++; supaRecordDiverge("opp", d.slug, e&&e.message); }
    if(d.html){ try{ await S.upsertPage(d.slug, d.html); res.pages++; }
      catch(e){ res.failed++; supaRecordDiverge("page", d.slug, e&&e.message); } }
  }
  var tpls=getEmailTemplates().map(function(r){ return { id:r.id, kind:"email", name:r.name||"", subject:r.subject||"", html:r.html||"", lang:r.lang||"", up:r.up||Date.now() }; })
    .concat(getCustomTemplates().map(function(r){ return { id:r.id, kind:"page", name:r.name||"", subject:r.subject||"", html:r.html||"", lang:r.lang||"", up:r.up||Date.now() }; }));
  if(tpls.length){ try{ await S.upsert("console_templates", tpls); res.templates=tpls.length; }catch(e){ res.failed++; supaRecordDiverge("template", "backfill", e&&e.message); } }
  var mail=getMailLogLocal().map(supaMailRow);
  if(mail.length){ try{ await S.upsert("console_mail", mail); res.mail=mail.length; }catch(e){ res.failed++; supaRecordDiverge("mail", "backfill", e&&e.message); } }
  var inbound=getInboundLocal().map(supaInboundRow);
  if(inbound.length){ try{ await S.upsert("console_inbound", inbound); res.inbound=inbound.length; }catch(e){ res.failed++; supaRecordDiverge("inbound", "backfill", e&&e.message); } }
  // Opens: the durable union the console already trusts (remote collected plus local), deduped by
  // hitKey, so a re-run does not double an open.
  var hseen={}, hits=[];
  getRemoteHitsLocal().concat(getHitsLocal()).forEach(function(e){ if(!e) return; var k=hitKey(e); if(hseen[k]) return; hseen[k]=1; hits.push(e); });
  hits=hits.map(supaHitRow);
  if(hits.length){ try{ await S.upsert("console_hits", hits); res.hits=hits.length; }catch(e){ res.failed++; supaRecordDiverge("hits", "backfill", e&&e.message); } }
  var settings=supaSettingsRows();
  if(settings.length){ try{ await S.upsert("console_settings", settings); res.settings=settings.length; }catch(e){ res.failed++; supaRecordDiverge("setting", "backfill", e&&e.message); } }
  return res;
}
/* The non-secret settings that travel, read from the current store. */
function supaSettingsRows(){
  var rows=[];
  try{ rows.push({ key:"endpoint", value:getEndpoint()||"" }); }catch(e){}
  try{ rows.push({ key:"email_ep", value:getEmailEndpoint()||"" }); }catch(e){}
  try{ rows.push({ key:"sync_ep", value:(typeof getSyncEndpoint==="function"?getSyncEndpoint():"")||"" }); }catch(e){}
  try{ rows.push({ key:"quota", value:quotaCfg() }); }catch(e){}
  try{ rows.push({ key:"from_name", value:(typeof getFromName==="function"?getFromName():"")||"" }); }catch(e){}
  try{ rows.push({ key:"signatures", value:(typeof allSignatures==="function"?allSignatures():null) }); }catch(e){}
  return rows;
}
/* Verify agreement: the current store's opportunity and page slugs against what Supabase holds. Green
   when every one in the old store is present in Supabase; any missing on the Supabase side is named. */
async function supaVerify(){
  if(!supaOn()) throw new Error(t("sb_need"));
  var S=window.ThriveSupa;
  function missing(a, b){ var have={}; (b||[]).forEach(function(x){ have[x]=1; }); return a.filter(function(x){ return !have[x]; }); }
  // Every store that feeds a state or a reply, checked per table: each key in the current store must be
  // present in Supabase. A table that is short names the keys it is missing.
  var oldOpps=getDraftsLocal().map(function(d){ return d.slug; });
  var oldPages=getDraftsLocal().filter(function(d){ return !!d.html; }).map(function(d){ return d.slug; });
  var oldMail=getMailLogLocal().map(function(m){ return supaMailRow(m).id; });
  var oldInbound=getInboundLocal().map(function(r){ return supaInboundRow(r).id; });
  var hseen={}, oldHits=[];
  getRemoteHitsLocal().concat(getHitsLocal()).forEach(function(e){ if(!e) return; var k=hitKey(e); if(hseen[k]) return; hseen[k]=1; oldHits.push(k); });
  var newOpps=await S.listCol("console_opps","slug");
  var newPages=await S.listCol("console_pages","slug");
  var newMail=await S.listCol("console_mail","id");
  var newInbound=await S.listCol("console_inbound","id");
  var newHits=await S.listCol("console_hits","id");
  function tab(old, sup){ var m=missing(old, sup); return { old:old.length, sup:(sup||[]).length, missing:m }; }
  var opps=tab(oldOpps,newOpps), pages=tab(oldPages,newPages), mail=tab(oldMail,newMail),
      inbound=tab(oldInbound,newInbound), hits=tab(oldHits,newHits);
  var ok = !opps.missing.length && !pages.missing.length && !mail.missing.length && !inbound.missing.length && !hits.missing.length;
  return { ok:ok, opps:opps, pages:pages, mail:mail, inbound:inbound, hits:hits, diverge: supaDiverges().length };
}

/* ---------- Supabase read cache (Stage 3) ----------
   Reads switch to the complete, stable Supabase rows so a full localStorage no longer breaks the board
   and the cards stop flickering. The switch is behind one flag (console_sb_read), guarded three ways:
   it hydrates a read-through in-memory cache from Supabase (an opportunity's whole record travels in
   the data jsonb, its page html joined from console_pages); a hydrate failure marks the read degraded
   and getDrafts falls back to the current store (never a blank or a false empty); and turning the flag
   ON is refused if the Stage 2 verification shows the two stores diverge. Writes are unchanged (still
   dual, still merged against the current store), and each write also updates this cache so a read right
   after a write is consistent. Flip the flag off and reads are back to the current store instantly, at
   Stage 2, with no data change. Templates are NOT switched here: the Stage 1 console_templates row has
   no column for a snippet's type or template_ref, so reading templates back would be lossy; that waits
   for an additive column, raised in the PR. */
var READ_FLAG="console_sb_read";
var __supa={ opps:null, mail:null, inbound:null, hits:null, comments:null, contacts:null, hydrated:false, degraded:false, authRequired:false, ts:0 };
var __supaHydrating=false;
/* The board reads ONE server-computed stage. console_board computes each opp's canonical stage and its
   display fields (sent_count, open_count, replied, idle_days, has_page, has_email, archived) in one
   deterministic Postgres pass over the base tables (docs/supabase-board-view.sql). The board buckets by
   the returned stage and computes no stage of its own, so it can never compose two answers for one card
   from a different partial subset per cycle (the oscillation) and can never fabricate a state (a page with
   opens but zero sends is server-computed as live/draft, never Opened). This map is slug -> the view row,
   populated by readBoardView during the hydrate and read synchronously by boardViewStage. */
var __boardView={}, __boardViewReady=false;
function boardViewRow(slug){ return (slug && Object.prototype.hasOwnProperty.call(__boardView, slug)) ? __boardView[slug] : null; }
function boardViewOpens(slug){ var r=boardViewRow(slug); return r ? (Number(r.open_count)||0) : 0; }
function boardViewIdle(slug){ var r=boardViewRow(slug); return (r && r.idle_days!=null) ? (Number(r.idle_days)||0) : null; }
// The view is the board's stage authority when a signed-in operator reads it; signed out or offline, the
// manifest list paints each card's inert base only (the one allowed non-view path).
function boardViewIsAuthority(){ return supaReadFlagOn() && supaOn(); }
var BOARD_VIEW_COLS="select=slug,business,stage,sent_count,open_count,replied,idle_days,last_activity_ts,has_page,has_email,archived";
function indexBySlug(rows){ var by={}; (rows||[]).forEach(function(r){ if(r && r.slug) by[r.slug]=r; }); return by; }
// Read the whole board view in one query and RETURN the rows (no assignment), so the render settle can adopt
// them under its own generation guard. Throws on a read failure so the caller keeps the last-good map.
async function readBoardViewRows(){
  var S=window.ThriveSupa; if(!S || typeof S.rest!=="function") return null;
  try{ window.__bootMark="board request sent"; window.__signMark="read:sent"; }catch(_){}   // P40/P44 checkpoints (assignments only)
  var rows=await S.rest("console_board", { query:BOARD_VIEW_COLS });
  try{ window.__bootMark="board response received"; window.__signMark="read:ok"; }catch(_){}   // P40/P44 checkpoints (assignments only)
  return rows;
}
// Adopt view rows. A transient empty result never blanks a map that already loaded (adopt empty only before
// the first successful read, a genuinely empty account), so a momentary [] cannot read the board as empty.
function adoptBoardView(rows){
  if(rows==null) return false;
  var by=indexBySlug(rows);
  // P40: record the COUNT of rows the console_board read returned (never the row content), so the failsafe
  // panel can say whether an authenticated 200 carried zero rows (mechanism A) or data (mechanism B).
  try{ window.__boardRows=(rows && rows.length!=null) ? rows.length : Object.keys(by).length; window.__bootMark="payload parsed"; }catch(_){}
  if(Object.keys(by).length || !__boardViewReady) __boardView=by;
  __boardViewReady=true; return true;
}
// Read and adopt in one step. Used by the sync round; a read failure never fails the board (its own try).
async function readBoardView(){ var rows=await readBoardViewRows(); return adoptBoardView(rows); }
window.readBoardView=readBoardView;
// The board view map, set directly. This is the seam a test uses to place cards in lanes the way the
// server would (the board computes no stage of its own now, so a lane comes from a view row), and the
// seam the reference/offline board never needs. Accepts the rows console_board returns.
window.__boardViewSet=function(rows){ __boardView=indexBySlug(rows); __boardViewReady=true; };
window.__boardViewClear=function(){ __boardView={}; __boardViewReady=false; };
/* The write-invariant self-check (Part 4). The console_board view is only as complete as the console_mail
   and console_inbound rows that reached Supabase, and those are mirrored best-effort and signed-in-only, so
   a send or a reply the operator made can sit in the local ledger while the server view has not caught up.
   Since the board reads the server view, that gap would silently read as Ready or Draft. This counts the
   visible cards where the LOCAL ledger holds a delivered send or a reply that the view does NOT yet reflect,
   so the drift is a number Thyab sees the day it happens rather than weeks later. It is computed only when
   the view is actually loaded (rows present); with no view there is nothing to be behind, so it is silent. */
function boardDrift(){
  var out={ count:0, slugs:[], stuck:0 };
  try{
    // A stuck outbox is a LOCAL failure independent of the server view: a send in flight ('sending') or one
    // that timed out ('unrecorded') is a write the server does not hold, so it is unsynced by definition and
    // is counted even with no view loaded. It drains to zero the moment the row records (-> 'sent') or is
    // retired, so the indicator tracks exactly the outstanding failures.
    var stuckSlugs={};
    try{
      getMailLogLocal().forEach(function(m){
        if(m && m.direction!=="in" && (m.status==="sending" || m.status==="unrecorded") && String(m.opp||"").trim()) stuckSlugs[m.opp]=1;
      });
    }catch(_){}
    Object.keys(stuckSlugs).forEach(function(slug){ out.stuck++; out.count++; if(out.slugs.length<50) out.slugs.push(slug); });
    if(!__boardView || !Object.keys(__boardView).length) return out;   // no view: only the stuck outbox is unsynced
    var seen={};
    mergedOppsSync().forEach(function(o){
      if(!o || o.archived || seen[o.slug]) return; seen[o.slug]=1;
      if(stuckSlugs[o.slug]) return;                                    // already counted as a stuck outbox
      var v=boardViewRow(o.slug);
      var vStage=v ? String(v.stage||"") : "";
      var vReplied=!!(v && v.replied);
      var localSent=false, localReply=false;
      try{ localSent=boardDeliveredSend(o); }catch(_){}
      try{ localReply=hasReply(o.slug); }catch(_){}
      // The view is BEHIND the local ledger: a delivered send the view still files as no-send, or a reply
      // the view has not marked replied. A card the view does not hold at all counts too (its row never
      // reached the server). base-only cards with no local evidence are not drift.
      var sendDrift=localSent && (!v || vStage==="live" || vStage==="draft");
      var replyDrift=localReply && (!v || !vReplied);
      if(sendDrift || replyDrift){ out.count++; if(out.slugs.length<50) out.slugs.push(o.slug); }
    });
  }catch(_){}
  return out;
}
window.boardDrift=boardDrift;
/* Reads engage on TWO authorities, and being signed in is the one that matters on a real device.
   ROOT A of the "board reads no mail" defect: the mail, opens and replies slices only come from
   Supabase when this predicate is true, and until now it was true only when a manual Settings toggle
   had written READ_FLAG="1". That toggle is refused unless the local and Supabase stores agree, but a
   fresh signed-in device (a Private tab, a cleared Safari, a new operator) has an EMPTY local store,
   so the agree-check can never pass and the flag can never be set. The opportunities still appear,
   because they are read from the committed manifest.json, but the ledger reads from an empty local
   store and every card shows "no email yet". Post-P2 the operator session is the data authority: if an
   operator is signed in to a configured Supabase, reads come from Supabase, full stop. The manual flag
   remains an explicit opt-in for a signed-out device only. This is the one place the read intent is
   decided, so every reader (getMailLog, allHits, getInbound, getDrafts) follows one path. */
function supaReadFlagOn(){
  try{ if(supaSignedIn()) return true; }catch(e){}
  try{ return localStorage.getItem(READ_FLAG)==="1"; }catch(e){ return false; }
}
function supaReadOn(){ return supaReadFlagOn() && supaOn() && __supa.hydrated && !__supa.degraded && !!__supa.opps; }
// Reads are switched (and the cache usable) whenever a successful hydrate is in hand. The ledger, the
// replies and the opens each fall back to the current store when their slice is not present.
function supaReadable(){ return supaReadFlagOn() && supaOn() && __supa.hydrated && !__supa.degraded; }
function supaSignedIn(){ try{ return !!(window.ThriveSupa && window.ThriveSupa.signedIn && window.ThriveSupa.signedIn()); }catch(e){ return false; } }
function supaReadStatus(){
  // authRequired is a Supabase-read concern only: it is reported true only while reads are switched to
  // Supabase and it is configured, so a device-only board never shows a sign-in prompt. And it is a pure
  // function of "no session": the source ANDs in !supaSignedIn() so the locked hero can never be reported
  // while an operator is signed in, whatever the ordering of the sign-in hydrate. This is the one place the
  // signed-in state decides the prompt, so a stale authRequired left over from a signed-out read (set before
  // the sign-in resolved, or by an in-flight signed-out hydrate that lands after it) can never surface here.
  var authReq = __supa.authRequired && supaReadFlagOn() && supaOn() && !supaSignedIn();
  return { flag:supaReadFlagOn(), configured:supaOn(), hydrated:__supa.hydrated, degraded:__supa.degraded,
    authRequired:authReq, signedIn:supaSignedIn(),
    count:(__supa.opps? __supa.opps.length : 0),
    source: supaReadOn() ? "supabase" : "local" };
}
/* Join an opportunity row and its page html back into the record shape the console reads. */
function supaOppFromRow(r, pageBy){
  var d=Object.assign({}, (r&&r.data)||{});
  if(r&&r.slug) d.slug=r.slug;
  if(pageBy && r && pageBy[r.slug]!=null) d.html=pageBy[r.slug];
  return d;
}
/* ---------- one canonical store, one reconciled truth ----------
   The board used to read whichever store was current per cycle: localStorage or Supabase (__supa). Those
   two copies had FORKED into two disagreeing generations and resolveAuthority picked one per cycle, so the
   board flipped between two real worlds. Cure: one canonical model. localStorage IS the canonical; __supa
   is the server-authoritative copy; reconcileCanonical folds __supa INTO localStorage on every hydrate and
   sync round, so the two can never fork and every reader reads one reconciled truth.
   unionUp: union two ledgers by a stable id, newest `up` wins. A fact known to EITHER transport survives,
   a local-only pending the server has not confirmed is kept (local-only key). On an EXACT `up` tie the
   local record is kept (local is folded first, only a STRICTLY newer server up replaces it), exactly as
   mergeKeyed keeps the local opp on a tie: a genuinely newer server fact still wins by its higher up, but
   a device's fresh optimistic edit (an attribution not yet stamped or confirmed) is never clobbered back
   to a same-generation server copy. Keys are total (JSON fallback), so a record without an id is deduped
   by full content, exactly as the relay merge does. */
function unionUp(localArr, serverArr, keyFn){
  var by={}, order=[];
  function put(x){
    if(x==null) return;
    var k; try{ k=keyFn(x); }catch(_){ k=null; }
    if(k==null || k===""){ try{ k=" "+JSON.stringify(x); }catch(_){ k=" "+String(x); } }
    var xu=Number(x&&x.up)||0;
    if(!(k in by)){ by[k]={ x:x, up:xu }; order.push(k); return; }
    if(xu > by[k].up) by[k]={ x:x, up:xu };   // only a strictly newer write replaces; a tie keeps the local (folded first)
  }
  (localArr||[]).forEach(function(x){ put(x); });
  (serverArr||[]).forEach(function(x){ put(x); });
  return order.map(function(k){ return by[k].x; });
}
var __reconciling=false;
/* Fold the server-authoritative __supa copy into the canonical localStorage store, so the board reads
   exactly one reconciled model and the two copies can never diverge. Opportunities merge per slug by
   newest `up` (a server-recorded fact carries the newest up once written; a local optimistic edit carries
   a newer up until the server confirms it, so it is preserved), tombstones honored, a local page html
   never erased by a winner that arrives without one. The three ledgers (mail, replies, opens) union by
   their stable id via unionUp. The reconciled state is written STRAIGHT back to localStorage, directly,
   bypassing the Supabase mirror (setInbound/setRemoteHits would re-enqueue the reconciled rows back up),
   so localStorage becomes a mirror of the canonical and never a second fork. Guarded by __syncApplying
   (the writes cannot trigger a sync-push storm) and __reconciling (re-entrancy). A no-op when there is no
   authoritative server copy in hand (signed out, degraded, or not yet hydrated), so a device with no
   Supabase keeps pure-localStorage canonical. Returns true when a fold happened. */
function reconcileCanonical(){
  if(__reconciling) return false;
  if(!__supa || !__supa.hydrated || __supa.degraded || !__supa.opps) return false;
  __reconciling=true;
  var prevApplying=__syncApplying; __syncApplying=true;
  try{
    var allTombs=tombs();
    var opps=mergeKeyed(getDraftsLocal(), __supa.opps||[], "slug", "opp", allTombs,
      function(r,l){ return Object.assign({}, r, (!r.html && l.html)?{html:l.html}:{}); });
    setDrafts(opps);                                     // clean setter: no Supabase mirror, strips reconstructed
    var mail=unionUp(getMailLogLocal(), __supa.mail||[], function(m){ return m&&m.mid!=null?String(m.mid):null; });
    mail.sort(function(a,b){ return (a.ts<b.ts?-1:(a.ts>b.ts?1:0)); });
    setMailLog(mail);                                    // clean setter: no Supabase mirror
    var inbound=unionUp(getInboundLocal(), __supa.inbound||[], inboundKey);
    invalidateRecon(); lsSet(INBOUND, JSON.stringify(inbound.slice(-800)));   // direct: skip setInbound's re-mirror
    var hits=unionUp(getRemoteHitsLocal(), __supa.hits||[], hitKey);
    try{ localStorage.setItem(RHITS, JSON.stringify(hits.slice(-2000))); }catch(_){}  // direct: skip setRemoteHits's re-mirror
    try{ invalidateSends(); }catch(_){}
    try{ invalidateHits(); }catch(_){}
    return true;
  } finally { __syncApplying=prevApplying; __reconciling=false; }
}
async function supaHydrate(){
  try{ window.__bootMark="hydrate begun"; }catch(_){}   // P40 checkpoint (assignment only)
  if(!supaOn()){ __supa.hydrated=false; return false; }
  try{
    var S=window.ThriveSupa;
    // Stage 4: push any queued local writes up FIRST, so a device that made changes offline (or whose
    // last mirror failed) syncs them before the read, and the hydrate reflects everything this device did.
    try{ await supaFlush(); }catch(_){}
    var opps=await S.rest("console_opps", { query:"select=slug,data" });
    var pages=await S.rest("console_pages", { query:"select=slug,html" });
    var pageBy={}; (pages||[]).forEach(function(p){ pageBy[p.slug]=p.html; });
    __supa.opps=(opps||[]).map(function(r){ return supaOppFromRow(r, pageBy); });
    // The signed-out empty read guard. Once the anon door is closed, a signed-out read is a 200 with no
    // rows, not a 401: the anon key is a valid JWT with role anon, so it authenticates and RLS simply
    // filters every row away. An empty read while signed out is therefore indistinguishable from an RLS
    // denial, so it is not trusted as an empty board. It is marked authRequired (degrade to this device,
    // ask for a sign-in) instead of rendered as no data. A signed-in empty read is a legitimately empty
    // board and passes through; before the close a signed-out read still returns rows and passes through.
    if(supaReadFlagOn() && !supaSignedIn() && __supa.opps.length===0){
      __supa.authRequired=true; __supa.degraded=true; __supa.hydrated=false;
      __supa.opps=null; __supa.mail=null; __supa.inbound=null; __supa.hits=null; __supa.comments=null; __supa.contacts=null;
      try{ logActivity("supa_auth_required", "", "signed-out empty read"); }catch(_){}
      return false;
    }
    // The ledger, replies and opens the states derive from. Each row carries its whole record in the
    // data jsonb, so the shape read back is exactly the shape the console wrote.
    var mail=await S.rest("console_mail", { query:"select=data" });
    __supa.mail=(mail||[]).map(function(r){ return r.data||{}; });
    var inbound=await S.rest("console_inbound", { query:"select=data" });
    __supa.inbound=(inbound||[]).map(function(r){ return r.data||{}; });
    var hits=await S.rest("console_hits", { query:"select=data" });
    __supa.hits=(hits||[]).map(function(r){ return r.data||{}; });
    // The open team discussion. Discrete columns (not a data jsonb): the read selects exactly what RLS
    // owns and the client renders. Its own try, so a comment hiccup never fails the board; on failure the
    // slice stays empty and reads fall back to the local cache.
    try{
      var comments=await S.rest("console_comments",
        { query:"select=id,opp,author,author_name,body,parent_id,created_at,updated_at&order=created_at.asc" });
      __supa.comments=(comments||[]).map(function(r){ return r||{}; });
    }catch(_){ __supa.comments=(__supa.comments||[]); }
    // The Contact Book curation overlay (P10). Discrete columns, own try, so a contacts hiccup never fails
    // the board; on failure the slice stays and reads fall back to the local cache. Curation facts only:
    // the merge grouping, name, tags, note. Activity history is NEVER read here, it stays derived.
    try{
      var contacts=await S.rest("console_contacts",
        { query:"select=id,addresses,name,tags,note,author,author_name,created_at,updated_at&order=updated_at.desc" });
      __supa.contacts=(contacts||[]).map(function(r){ return r||{}; });
    }catch(_){ __supa.contacts=(__supa.contacts||[]); }
    // Templates hydrate into the local cache (its own try, so a template hiccup never fails the board).
    try{ var tpls=await S.rest("console_templates", { query:"select=id,kind,name,subject,html,lang,up" }); supaMergeTemplatesToCache(tpls||[]); }catch(_){}
    __supa.hydrated=true; __supa.degraded=false; __supa.authRequired=false; __supa.ts=Date.now();
    // The send and open indexes are memoized off the old store; rebuild them from the migrated rows.
    try{ invalidateSends(); }catch(_){}
    try{ invalidateHits(); }catch(_){}
    // Fold this fresh server copy into the canonical localStorage store, so the board reads one
    // reconciled truth and the two copies cannot fork. supaFlush ran first, so this device's own writes
    // are already up and read back; any local-only pending that did not flush is preserved by unionUp.
    try{ reconcileCanonical(); }catch(_){}
    // console_board is read by the render settle (renderBoard's first-load read) and refreshed on the sync
    // heartbeat, so the hydrate does not read it too: one read per settle, no duplicate.
    return true;
  }catch(e){
    // A denial the operator can fix by signing in (a 401/403 once the anon door is closed) is marked
    // apart from a network degrade, so the read layer prompts an honest sign-in and never a blank board.
    // Never while signed in: a 401/403 seen by a signed-in operator is a token or network fault to degrade
    // over, not a sign-in prompt, so the flag stays a pure function of "no session" at every assignment.
    // P39: a session-lost error (bearer() refusing to downgrade to anon after sign-in) is also a sign-in
    // prompt, so a session that dropped mid-use shows "sign in again", not the misleading "no data yet".
    __supa.authRequired = !!(e && (e.authRequired || e.sessionLost)) && !supaSignedIn();
    __supa.degraded=true; __supa.hydrated=false; __supa.opps=null; __supa.mail=null; __supa.inbound=null; __supa.hits=null; __supa.comments=null; __supa.contacts=null;
    supaRecordDiverge("read", "hydrate", e&&e.message);
    try{ logActivity(__supa.authRequired ? "supa_auth_required" : "supa_read_degraded", "", String((e&&e.message)||"").slice(0,120)); }catch(_){}
    return false;
  }
}
/* Fire the hydrate once, lazily, the first time a read wants Supabase. Until it lands, reads fall back
   to the current store, so nothing waits on the network. When it lands, the views refresh. */
function supaEnsureHydrated(){
  if(__supa.hydrated || __supa.degraded || __supaHydrating) return;
  if(!supaReadFlagOn() || !supaOn()) return;
  __supaHydrating=true;
  supaHydrate().then(function(){ __supaHydrating=false;
    try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(e){}
  }).catch(function(){ __supaHydrating=false; });
}
function supaCachePut(d){
  if(!__supa.opps || !d || !d.slug) return;
  var i=__supa.opps.findIndex(function(x){ return x.slug===d.slug; });
  if(i>=0) __supa.opps[i]=Object.assign({}, d); else __supa.opps.push(Object.assign({}, d));
}
function supaCacheDrop(slug){ if(__supa.opps) __supa.opps=__supa.opps.filter(function(x){ return x.slug!==slug; }); }
/* Turn the read switch on or off. Off is instant (back to Stage 2). On is refused unless Supabase is
   configured and the two stores agree, so reads never land on a half-empty Supabase; the divergence is
   named back to the caller. */
async function supaSetRead(on){
  if(!on){ try{ localStorage.setItem(READ_FLAG, "0"); }catch(e){} __supa.hydrated=false; __supa.degraded=false; return { ok:true, on:false }; }
  if(!supaOn()) return { ok:false, reason:"unconfigured" };
  var v; try{ v=await supaVerify(); }catch(e){ return { ok:false, reason:(e&&e.message)||"verify failed" }; }
  if(!v.ok){ return { ok:false, reason:"diverge", verify:v }; }
  try{ localStorage.setItem(READ_FLAG, "1"); }catch(e){}
  __supa.degraded=false;
  await supaHydrate();
  return { ok:__supa.hydrated, on:true, degraded:__supa.degraded };
}

/* ---------- one import writer ----------
   The board intake and the editor batch import both land here, so a fix on one covers both and they
   cannot drift. Each item is {entry, host}: host true means also publish the page (the editor path);
   the board never hosts. Every import LANDS on the active board, where the confirmation says it went:
   an imported record clears the archived flag, so replacing or re-importing an archived opportunity
   surfaces it in Draft rather than staying silently archived. A slug already in the library updates
   in place and keeps its send and activation lifecycle (a sent opportunity is not knocked back to a
   draft); a duplicate that appears only inside this one batch gets a numeric suffix so siblings never
   overwrite each other. Returns an honest tally: only what actually landed, named by kind. */
/* ---------- R12/R13 (P19): the opportunity lifecycle - one delete law, one re-import law ----------
   The ledger is the truth of what was sent and received; it is never deleted, and it decides whether a
   card may be hard-deleted at all. hasLedgerHistory is the ONE predicate every lifecycle surface reads:
   a card with any real mail row, any resolved inbound reply, or any token-bearing open has history and
   can only be archived; a card with none is a draft in the true sense and can be removed cleanly. */
function oppLedgerCounts(slug){
  if(!slug) return { mail:0, inbound:0, hits:0 };
  var mail=0, inbound=0, hits=0;
  try{ mail=getMailLog().filter(function(m){ return m && m.opp===slug; }).length; }catch(_){}
  try{ inbound=inboundFor(slug).length; }catch(_){}
  try{ hits=allHits().filter(function(e){ return e && e.slug===slug && e.r; }).length; }catch(_){}
  return { mail:mail, inbound:inbound, hits:hits };
}
function hasLedgerHistory(slug){
  var c=oppLedgerCounts(slug);
  return (c.mail>0) || (c.inbound>0) || (c.hits>0);
}
// The lifecycle meta the re-import reader (R13) classifies each existing slug by: archived? has history?
// Built here, in the client, because only the client can read the three ledgers. One builder, both surfaces.
function oppExistingMeta(records){
  var map={};
  (records||[]).forEach(function(o){
    if(!o || !o.slug) return;
    map[o.slug]={ archived:!!o.archived, hasHistory:hasLedgerHistory(o.slug) };
  });
  return map;
}
// A safe delete gate: only a zero-history card may be hard-deleted; anything with ledger history archives.
function canHardDelete(o){ return !!o && !hasLedgerHistory(o.slug); }

async function writeImport(items, ctx){
  ctx=ctx||{};
  const existing=ctx.existing||{};
  const seen={}; Object.keys(existing).forEach(k=>seen[k]=1);
  const tally={ imported:0, updated:0, hosted:0, incomplete:0, failed:0, slugs:[] };
  // INVARIANT I3, atomic batch: every record is MINTED and its page HOSTED in the loop, but nothing is
  // written to the store until the loop is done. The records are staged, then committed as ONE store
  // transition (commitDraftsBatch) after the loop, while __batchDepth suppresses any sync round. So the
  // board is never repainted against a half-written batch: it sees the store before the batch or after
  // it, never a partial one. Every creation still flows through the one mint (ThriveIntake.toRecord).
  const staged=[];
  __batchDepth++;
  try{
    for(let i=0;i<items.length;i++){
      const it=items[i]||{}, e=it.entry; if(!e) continue;
      try{
        const rec=ThriveIntake.toRecord(e, { today:today(), note_text:ctx.notes, batch:ctx.batch });
        let s=rec.slug;
        // R13: the ONE re-import classifier (ThriveIntake.importPlan) decides new vs update vs update_locked
        // vs decision. A decision (an archived slug) is resolved only by Thyab's explicit per-row choice,
        // carried on it.decision; without it the row is left pending, never written silently.
        let plan=ThriveIntake.importPlan(s, existing);
        if(plan==="decision"){
          const d=it.decision;
          if(d==="new"){ plan="new"; }                                            // import as a fresh, suffixed card
          else if(d==="restore"){ plan=(existing[s]&&existing[s].hasHistory)?"update_locked":"update"; }  // restore-and-update
          else { tally.pending=(tally.pending||0)+1; continue; }                   // unresolved: not written
        }
        const isNew=(plan==="new");
        // A slug collision only matters for a NEW record; an update keeps its slug. An import-as-new over an
        // existing (or archived) slug is suffixed so it never overwrites the card it was told to spare.
        if(isNew && (seen[s] || existing[s])){ let k=2; while(seen[s+"-"+k]||existing[s+"-"+k]) k++; s=s+"-"+k; }
        rec.slug=s; seen[s]=1;
        const html=(e.file&&e.file.html)||"";
        // Update in place without knocking a sent or activated opportunity back to a draft.
        if(!isNew){ delete rec.published; delete rec.stage; delete rec.sent_on; }
        // A card that already sent something never has its body or subject silently changed under it.
        if(plan==="update_locked"){ delete rec.outreach_text; delete rec.outreach_subject; }
        // Archived flag: a NEW card is unarchived and a RESTORE explicitly unarchives; a plain update never
        // touches it (deleted here so the stored value survives the merge), so a re-import never silently
        // un-archives - or un-deletes - a card. The tombstone is lifted so a re-created slug stays created.
        if(isNew || it.decision==="restore"){ rec.archived=false; } else { delete rec.archived; }
        liftTomb("opp", s);
        if(it.host){
          await publishOpp(Object.assign({}, rec, { slug:s, published:false, stage:(rec.stage||""), html:html }));
          rec.published=true; tally.hosted++;
        }
        staged.push(rec);                               // staged, not yet written: the store stays whole
        if(isNew) tally.imported++; else tally.updated++;
        if(!e.subject && !e.body) tally.incomplete++;   // stored, but named text-less rather than hidden
        tally.slugs.push(s);
        logActivity("in_import", s, (rec.business||"")+(it.host?" · hosted":""));
        if(rec.outreach_text || rec.outreach_subject) logActivity("in_import", s, t("bt_text_stored"));
      }catch(err){ tally.failed++; logActivity("publish_half", (e.slug_hint||e.business||""), String((err&&err.message)||err)); }
    }
    commitDraftsBatch(staged);                          // the ONE atomic store write for the whole batch
  } finally { __batchDepth--; }
  try{ scheduleSyncPush(); }catch(_){}                  // one sync round, after the batch has fully landed
  return tally;
}
/* One confirmation, built from the tally, so both surfaces report the same honest counts: only what
   landed, and new, updated, hosted, incomplete, skipped and failed named distinctly. */
function importResultMsg(tally, skipped){
  tally=tally||{}; const parts=[];
  parts.push(boardText(getLang(),"imp_new", tally.imported||0));
  if(tally.updated) parts.push(boardText(getLang(),"imp_updated", tally.updated));
  if(tally.pending) parts.push(boardText(getLang(),"imp_pending", tally.pending));  // R13: archived-slug rows still awaiting Thyab's restore-or-new choice
  if(tally.hosted) parts.push(boardText(getLang(),"bt_hosted", tally.hosted));
  if(tally.incomplete) parts.push(boardText(getLang(),"bt_incomplete", tally.incomplete));
  if(skipped) parts.push(boardText(getLang(),"imp_skipped", skipped));
  if(tally.failed) parts.push(boardText(getLang(),"bt_failed", tally.failed));
  return parts.join(" ");
}
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
  getDraftsLocal().forEach(function(d){
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

/* ---- legacy parity: default the fields the board now assumes, on read -------
   A card made before Stage 4 carries the old shape: the manifest wrote a `status`
   (only ever "sent") where the derivation now reads `stage`, and an early record can
   lack a roster entirely. Nothing here is written back: this returns a normalized
   copy for the read view (the board, the window, the library all read mergedOpps),
   exactly like the #108 reconstruction pattern defaults on read and setDrafts strips
   the derived rows before any write. If the map should persist, it is the additive
   SQL in docs/supabase-lifecycle-legacy.sql that Thyab runs, never a blind mass write.

   Only the stages the derivation honors as a DECLARATION are carried across from a
   legacy `status`: sent, opened, replied, won, lost, dropped, bounced, failed. The
   pre-send states (draft, ready, live) are deliberately left empty so isLive and the
   send evidence keep deriving them, because those are the states the new model reads
   from evidence rather than from a claim the record makes about itself. */
const LEGACY_DECLARED_STAGES={ sent:1, opened:1, replied:1, won:1, lost:1, dropped:1, bounced:1, failed:1 };
function normalizeOpp(o){
  if(!o || typeof o!=="object") return o;
  const n=o;
  // A legacy status stands in for a missing stage, so a card sent months ago reads as Sent,
  // not as a never-sent Ready, and a Won/Lost card keeps its terminus instead of re-deriving.
  if(!n.stage && n.status && LEGACY_DECLARED_STAGES[n.status]) n.stage=n.status;
  // An empty roster where one is absent, so the group and recipient reads never touch undefined.
  if(!Array.isArray(n.recipients)) n.recipients=[];
  if(!Array.isArray(n.manual_contacts)) n.manual_contacts=[];
  return n;
}

/* The synchronous core: assemble the read view from the cached manifest plus the current drafts. Every
   screen reads through here. When the board has pinned an authority (deriveBoardModel), getDrafts returns
   that one frozen snapshot, so this whole assembly is deterministic for the cycle. */
function mergedOppsSync(){
  const list=manifestNow().list||[];
  const bySlug={};
  list.forEach(o=>{ bySlug[o.slug]={...o, _local:false, _edited:false}; });
  getDrafts().forEach(d=>{
    if(bySlug[d.slug]) bySlug[d.slug]={...bySlug[d.slug], ...d, _local:false, _edited:true};
    else bySlug[d.slug]={...d, _local:true, _edited:false};
  });
  const rows=Object.values(bySlug);
  // Normalize the read view once, in the one place every screen reads through. Each row here is a
  // fresh spread (never the stored object), so defaulting a field cannot mutate what is on disk.
  rows.forEach(o=>{ o.archived=!!o.archived; normalizeOpp(o); });
  return rows;
}
async function mergedOpps(){ await ensureManifest(); return mergedOppsSync(); }
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
      // R16 (P25): search over business name, slug, date and language (plus the legacy location/template),
      // so an elegant search across the mission shelves finds a page by any of the facts on its card.
      rows=rows.filter(o=>[o.business,o.location,o.template,o.slug,o.sent_on,(o.doc_lang||docLang(o)),
        ((o.doc_lang||docLang(o))==="AR"?"arabic عربي":"english")].join(" ").toLowerCase().includes(q)); }
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
    function cardHtml(o){
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
        // Follow up in one tap: open the composer bound to this opportunity with the follow-up (nudge)
        // template already chosen in the opportunity's own language. Pure wiring of the existing ?etpl=
        // preselect and the stock nudge template; the send path is untouched. Offered only where the
        // console already says a follow-up is due (a live opportunity the follow-up filter flags).
        + (live&&fu?`<a class="btn ghost sm" data-fu="${esc(o.slug)}" href="${viewHref("compose","slug="+enc+"&etpl="+(docLang(o)==="AR"?"opp-nudge-ar":"opp-nudge"))}">${t("flw_send")}</a>`:``)
        + (isOffer?``:`<a class="btn ghost sm" href="${viewHref("editor","slug="+enc)}">${t("edit")}</a>`)
        + `<button class="btn ghost sm" data-arch="${esc(o.slug)}" data-val="${arch?"0":"1"}">${arch?t("unarchive"):t("archive")}</button>`
        + (half?`<button class="btn sm" data-finish="${esc(o.slug)}">${t("pub_finish")}</button>`:``)
        + (live?`<button class="btn ghost sm danger" data-unpub="${esc(o.slug)}">${t("unpublish")}</button>`:``)
        + ((o._local&&!o.published&&canHardDelete(o))?`<button class="btn ghost sm danger" data-del="${esc(o.slug)}">${t("remove")}</button>`:``);
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
          ${live&&snd.count?`<span class="fact">${t("ins_opens")}: ${outreachOpens(o)}</span>`:""}
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
    }

    /* R16 (P25): the Library is organized BY MISSION. The filtered, sorted rows are grouped onto their
       mission shelves (missionOf), each shelf leading with its base template as the source of truth, its
       requirements manifest (an external design is produced against it), then the filed pages. Both seeded
       missions always show, with counts, even when a search empties one, so the two-shelf structure holds.
       The card markup is UNCHANGED, so every data-* handler wired below on `grid` still finds every card. */
    const L=getLang();
    function manifestHtml(m){
      const items=(m.manifest||[]).map(function(it){ return '<li class="mf-item">'+ic("check",13)+'<span>'+esc((L==="ar")?(it.ar||it.en):(it.en||it.ar))+'</span></li>'; }).join("");
      if(!items) return "";
      return '<details class="shelf-manifest"><summary class="shelf-manifest-s">'+ic("check",14)+esc(t("lib_manifest"))+'</summary>'+
        '<p class="shelf-manifest-p">'+esc(t("lib_manifest_sub"))+'</p><ul class="mf-list">'+items+'</ul></details>';
    }
    function baseTemplateHtml(m){
      const tpls=(m.templates||[]);
      var body;
      if(tpls.length){
        body=tpls.map(function(id){ var ap=(typeof APPROVED_TEMPLATES!=="undefined")? APPROVED_TEMPLATES.find(function(x){ return x.id===id; }) : null;
          var nm=ap? ((L==="ar")?(ap.name_ar||ap.name_en):(ap.name_en||ap.name_ar)) : id;
          return '<a class="btn ghost sm" href="'+viewHref("editor","mission="+encodeURIComponent(m.id)+"&t="+encodeURIComponent(id))+'"><span class="mono-iso">'+esc(id)+'</span> · '+esc(nm)+'</a>'; }).join("");
      } else {
        body='<span class="shelf-base-note">'+esc(t("lib_base_upload"))+'</span>'+
          '<a class="btn ghost sm" href="'+viewHref("editor","mission="+encodeURIComponent(m.id))+'" data-icon="import">'+esc(t("lib_base_new"))+'</a>';
      }
      return '<div class="shelf-base"><span class="shelf-base-tag">'+ic("check",13)+esc(t("lib_base_truth"))+'</span><div class="shelf-base-body">'+body+'</div></div>';
    }
    function shelfHtml(m, cards){
      var count=cards.length;
      var cardsHtml=count? cards.map(cardHtml).join("") : '<div class="shelf-empty">'+esc(t("lib_shelf_empty"))+'</div>';
      var canDel=!(MISSION_SEED.some(function(s){ return s.id===m.id; }));
      return '<section class="shelf" data-mission="'+esc(m.id)+'">'+
        '<header class="shelf-h"><div class="shelf-id"><h2 class="shelf-t" dir="auto">'+esc(missionName(m,L))+'</h2>'+
          '<span class="shelf-count">'+nIso(count)+' '+esc(t("lib_pages"))+'</span></div>'+
          (canDel? '<button type="button" class="btn ghost sm danger shelf-del" data-mdel="'+esc(m.id)+'">'+esc(t("lib_mission_del"))+'</button>' : '')+'</header>'+
        ((m.tagline_en||m.tagline_ar)? '<p class="shelf-tag" dir="auto">'+esc((L==="ar")?(m.tagline_ar||m.tagline_en):(m.tagline_en||m.tagline_ar))+'</p>' : '')+
        baseTemplateHtml(m)+manifestHtml(m)+
        '<div class="shelf-cards grid">'+cardsHtml+'</div></section>';
    }
    const _missions=getMissions();
    const byMission={}; _missions.forEach(function(m){ byMission[m.id]=[]; });
    rows.forEach(function(o){ var mid=missionOf(o); (byMission[mid]=byMission[mid]||[]).push(o); });
    grid.className="shelves";
    grid.innerHTML = _missions.map(function(m){ return shelfHtml(m, byMission[m.id]||[]); }).join("");
    // A custom mission's shelf can be removed once empty (its pages, if any, fall back to the default shelf).
    grid.querySelectorAll("[data-mdel]").forEach(function(b){ b.addEventListener("click", function(){
      var id=b.getAttribute("data-mdel");
      if(!confirm(t("lib_mission_del_confirm"))) return;
      removeMission(id); render();
    }); });

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
        // INVARIANT I1: unpublishing returns a page to Draft; it never asserts a send. The carried status
        // used to default to "sent" (status:o.status||"sent"), stamping a phantom send on a record whose
        // page was just taken down. The real send state lives in the ledger; no status is written here.
        const back={slug, business:o.business, template:o.template, sent_on:o.sent_on, location:o.location, phone:o.phone, published:false, mode:useUpload?"upload":(o.mode||(o.template&&o.template!=="custom"?"fill":"upload")), fields:o.fields||{}};
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
      const gone=state.data.find(o=>o.slug===slug);
      // R12 (P19): the delete law, at the source. A card that has grown ledger history can never be hard
      // deleted, only archived; the guard here holds even if a stale control slipped through the render.
      if(gone && !canHardDelete(gone)) return;
      if(!confirm(t("lc_delete_confirm").split("{name}").join((gone&&gone.business)||slug))) return;
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
                  location:o.location||"", phone:o.phone||"", status:manifestStatusFor(o) };
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

/* ---------- outreach composer undo/redo ----------
   Native undo is dead in the composer for the same reason it was in the editor: the outreach window
   rebuilds its view from a boot snapshot on every entry (thriveViewReset sets el.innerHTML), and the
   composer re-hydrates the message body with `.innerHTML =` and the closing block and plain-text
   alternative with `.value =` on restore. A recreated node has an empty native undo stack, and a
   programmatic assignment clears whatever stack a fresh page had. So the history cannot live in the
   DOM. It lives here, in memory, keyed by the editing slug and the field id, so it survives every
   re-render and the auto-save. Depth is capped so memory stays bounded. This changes nothing that is
   saved; it only lets the field step back and forward.

   Two field shapes are handled by one store. The message body #ebody is contenteditable, so its
   snapshot is innerHTML plus a caret offset counted in characters over the text; the closing block
   #sigBox and the plain-text alternative #plainBox are textareas, so their snapshot is value plus the
   selection range. The type is read from the live node, never assumed. */
var ThriveEditHistory = (function(){
  var CAP = 100;                 // per-field snapshots kept; older ones fall off the bottom
  var COALESCE = 600;            // ms: a burst of typing in one field collapses to one undo step
  var store = {};                // fieldId -> { stack:[{v,...}], idx, ts }
  var slug = null;               // the document these histories belong to
  var lastId = "";               // the field the icons act on (survives re-render: an id, not a node)
  var applying = false;          // true while we set a value ourselves, so it is not recorded as an edit
  function isCE(f){ return !!(f && f.isContentEditable); }
  function curV(f){ return isCE(f) ? f.innerHTML : f.value; }
  // Caret position as a character count over the field's text, so it survives an innerHTML rebuild.
  function caretOffset(root){
    try{
      var sel = window.getSelection && window.getSelection();
      if(!sel || !sel.rangeCount) return null;
      var r = sel.getRangeAt(0);
      if(!root.contains(r.startContainer)) return null;
      var pre = r.cloneRange(); pre.selectNodeContents(root); pre.setEnd(r.startContainer, r.startOffset);
      return pre.toString().length;
    }catch(e){ return null; }
  }
  function restoreCaret(root, off){
    if(off == null) return;
    try{
      var sel = window.getSelection && window.getSelection(); if(!sel) return;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      var node, count = 0, target = null, toff = 0;
      while((node = walker.nextNode())){
        var len = node.nodeValue.length;
        if(count + len >= off){ target = node; toff = off - count; break; }
        count += len;
      }
      var r = document.createRange();
      if(target){ r.setStart(target, Math.max(0, Math.min(toff, target.nodeValue.length))); }
      else { r.selectNodeContents(root); r.collapse(false); }
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }catch(e){}
  }
  function snap(f){
    if(isCE(f)) return { v: f.innerHTML, c: caretOffset(f) };
    return { v: f.value, s: (f.selectionStart==null?f.value.length:f.selectionStart), e: (f.selectionEnd==null?f.value.length:f.selectionEnd) };
  }
  function reset(s){ if(s!==slug){ store = {}; slug = s; lastId = ""; } }   // a new document starts fresh
  function seed(f){ if(!store[f.id]) store[f.id] = { stack:[snap(f)], idx:0, ts:0 }; }
  function ensure(f){ seed(f); return store[f.id]; }
  function record(f){
    if(applying) return;
    var h = ensure(f), now = nowMs(), top = h.stack[h.idx];
    if(top && top.v === curV(f)){                 // caret move only: refresh the caret, add no step
      if(isCE(f)) top.c = caretOffset(f); else { top.s = f.selectionStart; top.e = f.selectionEnd; }
      return;
    }
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
    if(isCE(f)){ f.innerHTML = s.v; restoreCaret(f, s.c); }
    else { f.value = s.v; try{ f.setSelectionRange(s.s, s.e); }catch(e){} }
    try{ f.dispatchEvent(new Event("input", { bubbles:true })); }catch(e){}   // let the preview, links and save follow
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

/* ---------- one ingest report, shared by every drop/upload surface (P14) ----------
   The batch report and its warn-before-write gate are rendered here, once, from the tolerant resolver's
   report (ThriveIntake.readBatch -> resolveBatch). Both the editor's "Upload HTML" mode and the board's
   "Today's batch" drop mount THIS renderer into their own container, so there is one resolver and one
   report on screen wherever a batch is dropped. The old board path (readDrop + a second review renderer)
   is retired; this is what replaces it. */
const ING_REASON={ no_page:"btr_page_pending", no_manifest_entry:"in_w_no_manifest_entry",
  no_text:"btr_no_text", duplicate_slug:"btr_dupe", exists_would_overwrite:"btr_exists",
  missing_business:"in_w_no_business", no_channel:"in_w_no_channel", needs_message:"in_prov_needs" };
function ingReasonLabel(x){ return t(ING_REASON[x]||x); }
// R8 provenance: the rung of the tolerant ladder that resolved each opportunity, shown quietly so the
// truth is visible ("read from opp.md" vs "read from research md" vs "needs message"), never guessed.
const ING_PROV={ opp_md:"in_prov_opp", manifest_json:"in_prov_json", research_md:"in_prov_research",
  page_partial:"in_prov_partial", needs_message:"in_prov_needs" };
function ingProvLabel(p){ return p? t(ING_PROV[p]||p) : ""; }
function ingCell(v){ return '<td class="bt-c">'+(v?'<span class="bt-y" data-icon="check"></span>':'<span class="bt-n">·</span>')+'</td>'; }
// Every report row is storable: toRecord always supplies a name (business, else the slug). A row with a
// real page is additionally hostable; a missing page is "stored now, page hosted later", never dropped.
function ingStorable(r){ return true; }
function ingHostable(r){ return r.hasPage; }
/* P16: the truthful count line - pages, matched, to-confirm, needs-message, orphan sections. Counts are
   rendered OUTSIDE the translated labels, in an isolated <bdi class="n">, so a Western numeral never
   reverses inside an Arabic phrase. Six pages plus six sections read as six matched, never eight rows. */
function ingCountLine(rep){
  const c=rep.counts||{};
  const part=(n,key)=> '<span class="ing-c"><bdi class="n">'+n+'</bdi> '+esc(t(key))+'</span>';
  const bits=[part(c.pages||0,"in_c_pages")];
  // R13 (P19): the re-import tally reads new / updates / needs-decision, so a re-dropped bundle says at a
  // glance how many cards it creates versus heals versus leaves for Thyab to decide. Shown only when nonzero.
  if(c.new) bits.push(part(c.new,"in_c_new"));
  if(c.updates) bits.push(part(c.updates,"in_c_updates"));
  if(c.decision) bits.push(part(c.decision,"in_c_decision"));
  bits.push(part(c.matched||0,"in_c_matched"));
  if(c.confirm) bits.push(part(c.confirm,"in_c_confirm"));
  if(c.needs) bits.push(part(c.needs,"in_c_needs"));
  if(c.orphans) bits.push(part(c.orphans,"in_c_orphans"));
  return '<p class="ing-count">'+bits.join('<span class="ing-sep" aria-hidden="true">·</span>')+'</p>';
}
// CONFIRM: a page and a candidate section shown together (score 1 or an unresolved tie). One tap Joins them
// or marks Not a match. Never auto-imported, never auto-split.
function ingConfirmBlock(rep){
  const list=rep.confirm||[]; if(!list.length) return "";
  const rows=list.map((cf,i)=>
    '<div class="ing-row ing-confirm-row">'+
      '<div class="ing-row-main"><span class="ing-biz">'+esc(cf.business)+'</span>'+
        '<span class="ing-note">'+esc(t("in_confirm_hint"))+': <span class="mono-iso" dir="ltr">'+esc(cf.page_slug)+'</span></span></div>'+
      '<div class="ing-row-act">'+
        '<button type="button" class="btn ghost sm ing-accept" data-ci="'+i+'" data-icon="check">'+esc(t("in_accept"))+'</button>'+
        '<button type="button" class="btn ghost sm ing-reject" data-ci="'+i+'">'+esc(t("in_reject"))+'</button>'+
      '</div></div>').join("");
  return '<div class="ing-block ing-confirm"><h5 class="ing-h">'+esc(t("in_confirm_h"))+'</h5>'+rows+'</div>';
}
// ORPHAN: a section that matched no page. Surfaced in its own list with the nearest page as a suggestion.
// It is NOT a row among the pages and creates nothing on its own; Create card is the only, explicit path.
function ingOrphanBlock(rep){
  const list=rep.orphanSections||[]; if(!list.length) return "";
  const rows=list.map((o,i)=>
    '<div class="ing-row ing-orphan-row">'+
      '<div class="ing-row-main"><span class="ing-biz">'+esc(o.business)+'</span>'+
        (o.suggest? '<span class="ing-suggest">'+esc(t("in_orphan_near"))+' <span class="mono-iso" dir="ltr">'+esc(o.suggest)+'</span></span>':'')+'</div>'+
      '<div class="ing-row-act"><button type="button" class="btn ghost sm ing-make" data-oi="'+i+'">'+esc(t("in_orphan_make"))+'</button></div>'+
    '</div>').join("");
  return '<div class="ing-block ing-orphan"><h5 class="ing-h">'+esc(t("in_orphan_h"))+'</h5>'+rows+'</div>';
}
// REPAIR on re-drop: a card already in the store whose send-to and subject equal a page now joined, under a
// different slug, is a previously spawned ghost. One tap Merge archives it; the page card keeps everything.
function ingDupBlock(rep){
  const list=rep.duplicates||[]; if(!list.length) return "";
  const rows=list.map((d,i)=>
    '<div class="ing-row ing-dup-row">'+
      '<div class="ing-row-main"><span class="mono-iso" dir="ltr">'+esc(d.ghost_slug)+'</span>'+
        '<span class="ing-note">'+esc(t("in_dup_note"))+' <span class="mono-iso" dir="ltr">'+esc(d.page_slug)+'</span></span></div>'+
      '<div class="ing-row-act"><button type="button" class="btn ghost sm ing-merge" data-di="'+i+'" data-icon="check">'+esc(t("in_dup_merge"))+'</button></div>'+
    '</div>').join("");
  return '<div class="ing-block ing-dup"><h5 class="ing-h">'+esc(t("in_dup_h"))+'</h5>'+rows+'</div>';
}
// R13 (P19): the per-row re-import action, read from the ONE classifier (report row .action). new is the
// default; an existing card reads "updates"; a card with ledger history reads "history kept, body unchanged";
// an archived slug asks Thyab, on the row, to restore-and-update or import-as-new - never resolved silently.
function ingActionHtml(r){
  const a=r.action;
  if(a==="update") return '<span class="bt-act is-update">'+esc(t("in_act_updates"))+'</span>';
  if(a==="update_locked") return '<span class="bt-act is-locked">'+esc(t("in_act_history"))+'</span>';
  if(a==="decision"){
    if(r.decision==="restore") return '<span class="bt-act is-update">'+esc(t("in_dec_restored"))+'</span>';
    if(r.decision==="new") return '<span class="bt-act is-new">'+esc(t("in_dec_asnew"))+'</span>';
    return '<span class="bt-act is-decision">'+esc(t("in_act_archived"))+'</span>'+
      '<span class="bt-dec">'+
        '<button type="button" class="btn ghost sm bt-restore" data-dec="'+esc(r.slug)+'">'+esc(t("in_dec_restore"))+'</button>'+
        '<button type="button" class="btn ghost sm bt-asnew" data-dec="'+esc(r.slug)+'">'+esc(t("in_dec_new"))+'</button>'+
      '</span>';
  }
  return '<span class="bt-act is-new">'+esc(t("in_act_new"))+'</span>';
}
// Recompute the report's tallies after a CONFIRM is joined/rejected, an orphan is created, or a ghost merged.
function recountBatch(rep){
  rep.matched=rep.rows.filter(r=>r.verdict==="matched").length;
  rep.warned=rep.rows.filter(r=>r.verdict==="warned").length;
  rep.counts={ pages:rep.rows.length, matched:rep.matched, confirm:(rep.confirm||[]).length,
    needs:rep.rows.filter(r=>r.needs_message).length, orphans:(rep.orphanSections||[]).length };
}
// Join a CONFIRM: the section takes the candidate page's slug and page, becoming a matched row in place of
// that page's needs-message row. In-memory only; the ONE write is still the batch Approve, so no double-write.
function acceptConfirm(batch, cf){
  const rep=batch.report, sec=cf.entry;
  const row=(rep.rows||[]).find(r=>r.slug===cf.page_slug);
  if(row){
    sec.slug_hint=cf.page_slug; sec.file=(row.entry&&row.entry.file)||sec.file||null;
    sec.provenance="research_md"; sec.needs_message=false;
    row.entry=sec; row.verdict="matched"; row.provenance="research_md"; row.match_rule=cf.rule||"overlap";
    row.needs_message=false; row.reasons=[]; row.hasBody=!!sec.body; row.hasSubject=!!sec.subject;
    row.hasSendTo=!!(sec.email||sec.url||(sec.channel&&sec.channel!=="")); row.hasPage=!!sec.file; row.hasManifest=true;
  }
  rep.confirm=(rep.confirm||[]).filter(x=>x!==cf);
  recountBatch(rep);
}
function ingReportInner(batch){
  const rep=batch.report, rows=rep.rows;
  const canSave=rows.filter(ingStorable).length;
  const canHost=rows.filter(ingHostable).length;
  const incomplete=rows.filter(r=>r.reasons.indexOf("no_text")>=0).length;
  let summary=boardText(getLang(),"bt_summary",canSave);
  if(canHost>0) summary+=" "+boardText(getLang(),"bt_hosted",canHost);
  if(incomplete>0) summary+=" "+boardText(getLang(),"bt_incomplete",incomplete);
  const head='<tr><th>'+esc(t("bt_slug"))+'</th><th>'+esc(t("bt_html"))+'</th><th>'+esc(t("bt_mfst"))+
    '</th><th>'+esc(t("bt_subj"))+'</th><th>'+esc(t("bt_body"))+'</th><th>'+esc(t("bt_send"))+
    '</th><th>'+esc(t("bt_source"))+'</th><th>'+esc(t("bt_verdict"))+'</th></tr>';
  const body=rows.map(r=>{
    // A resolved opportunity shows the rung that resolved it; a "needs message" row is never blocked, it
    // offers a one-tap Write action that creates the card and opens the composer to write by hand.
    const prov = r.provenance
      ? '<span class="bt-prov bt-prov-'+esc(r.provenance)+'">'+esc(ingProvLabel(r.provenance))+'</span>' : '';
    const shownReasons = r.reasons.filter(x=> x!=="needs_message" || !r.provenance);
    const verdict = r.verdict==="matched"
      ? '<span class="bt-ok">'+esc(t("bt_matched"))+'</span>'
      : (r.needs_message
          ? '<button type="button" class="btn ghost sm bt-write" data-write="'+esc(r.slug)+'" data-icon="send">'+esc(t("bt_write"))+'</button>'
            +(shownReasons.length?' <span class="bt-warn">'+shownReasons.map(x=>esc(ingReasonLabel(x))).join(", ")+'</span>':'')
          : '<span class="bt-warn">'+r.reasons.map(x=>esc(ingReasonLabel(x))).join(", ")+'</span>');
    // P17: the human reads the business display name; the slug stays, isolated ltr, as the small identity
    // beneath it. The business name keeps its natural direction so an Arabic name renders right-to-left.
    const bizName = (r.business && r.business!==r.slug) ? '<span class="bt-biz">'+esc(r.business)+'</span>' : '';
    // R13: the action (new / updates / history-kept / decision) leads the last cell; the field verdict follows,
    // except a decision row shows only its two explicit choices, never a stray "matched".
    const actionHtml = ingActionHtml(r);
    const verdictHtml = (r.action==="decision" && !r.decision) ? "" : verdict;
    return '<tr class="'+(r.verdict==="matched"?"is-matched":"is-warned")+(r.needs_message?" is-needs":"")+' bt-a-'+esc(r.action||"new")+'">'+
      '<td class="bt-id">'+bizName+'<span class="mono-iso bt-slug" dir="ltr">'+esc(r.slug)+'</span></td>'+
      ingCell(r.hasPage)+ingCell(r.hasManifest)+ingCell(r.hasSubject)+ingCell(r.hasBody)+ingCell(r.hasSendTo)+
      '<td>'+prov+'</td>'+
      '<td class="bt-verdict">'+actionHtml+(verdictHtml?' '+verdictHtml:'')+'</td></tr>';
  }).join("");
  // A dropped .docx/.pdf the reader cannot open is named as an unreadable instruction file, never vanished.
  const unreadable=(batch.unreadable&&batch.unreadable.length)
    ? '<div class="note warn-note">'+esc(t("bt_unreadable"))+': '+esc(batch.unreadable.join(", "))+'</div>' : '';
  const html=
    '<h4 class="sec-h" data-icon="check">'+esc(t("in_report_h"))+'</h4>'+
    (batch.jsonError? '<div class="note warn-note">'+esc(t("bt_jsonerr"))+': '+esc(batch.jsonError)+'</div>':'')+
    unreadable+
    '<div class="bt-wrap"><table class="bt">'+head+body+'</table></div>'+
    ingCountLine(rep)+
    '<p class="hint">'+esc(summary)+'</p>'+
    ingConfirmBlock(rep)+ingOrphanBlock(rep)+ingDupBlock(rep)+
    '<div class="bar bar-actions">'+
      '<button class="btn" id="batchApprove" data-icon="send"'+(canSave?'':' disabled')+'>'+esc(t("bt_approve"))+'</button>'+
      '<button class="btn ghost" id="batchDiscard">'+esc(t("in_cancel"))+'</button>'+
    '</div>';
  return { html:html, canSave:canSave };
}
// Mount the resolver report into a container and wire its gate. opts: onDiscard(), onApprove(batch),
// onWrite(batch) [before the composer opens]. The one writer (writeImport) is reached from onApprove/onWrite.
function mountIngestReport(container, batch, opts){
  opts=opts||{};
  if(!batch || !batch.report || !batch.report.rows.length){ container.hidden=true; container.innerHTML=""; return; }
  const built=ingReportInner(batch);
  container.innerHTML=built.html; container.hidden=false;
  if(typeof applyIcons==="function") applyIcons(container);
  const db=container.querySelector("#batchDiscard"); if(db) db.addEventListener("click",()=>{ if(opts.onDiscard) opts.onDiscard(); });
  const ab=container.querySelector("#batchApprove");
  if(ab && built.canSave) ab.addEventListener("click", ()=> runAction("batchApprove", { working:t("publishing"), run: ()=> opts.onApprove(batch) }));
  container.querySelectorAll(".bt-write").forEach(btn=>btn.addEventListener("click", ()=>{
    const slug=btn.getAttribute("data-write")||"";
    runAction("batchWrite", { working:t("publishing"), run: async ()=>{ await opts.onWrite(batch); if(slug) goTo("compose", "slug="+encodeURIComponent(slug)); } });
  }));
  // P16: the CONFIRM and ORPHAN actions. Join / Not-a-match are in-memory (the one write is still Approve);
  // Create-card and Merge write, each an explicit tap. Every action re-mounts so the count line stays true.
  const remount=()=>mountIngestReport(container, batch, opts);
  // R13 (P19): an ARCHIVED-slug collision is resolved on its row - restore-and-update or import-as-new. The
  // choice is recorded on the row (in-memory) and read by the one writer at Approve; never resolved silently.
  container.querySelectorAll(".bt-restore").forEach(btn=>btn.addEventListener("click", ()=>{
    const row=(batch.report.rows||[]).find(r=>r.slug===btn.getAttribute("data-dec")); if(row){ row.decision="restore"; remount(); }
  }));
  container.querySelectorAll(".bt-asnew").forEach(btn=>btn.addEventListener("click", ()=>{
    const row=(batch.report.rows||[]).find(r=>r.slug===btn.getAttribute("data-dec")); if(row){ row.decision="new"; remount(); }
  }));
  container.querySelectorAll(".ing-accept").forEach(btn=>btn.addEventListener("click", ()=>{
    const cf=(batch.report.confirm||[])[+btn.getAttribute("data-ci")];
    if(cf){ acceptConfirm(batch, cf); remount(); }
  }));
  container.querySelectorAll(".ing-reject").forEach(btn=>btn.addEventListener("click", ()=>{
    const i=+btn.getAttribute("data-ci"), rep=batch.report;
    rep.confirm=(rep.confirm||[]).filter((_,k)=>k!==i); recountBatch(rep); remount();
  }));
  container.querySelectorAll(".ing-make").forEach(btn=>btn.addEventListener("click", ()=>{
    const o=(batch.report.orphanSections||[])[+btn.getAttribute("data-oi")]; if(!o) return;
    runAction("ingOrphanMake", { working:t("publishing"), run: async ()=>{
      let existing={}; try{ existing=oppExistingMeta(await mergedOpps()); }catch(_){}
      const tally=await writeImport([{ entry:o.entry, host:false }], { existing:existing, notes:batch.notes, batch:batch.batch });
      batch.report.orphanSections=(batch.report.orphanSections||[]).filter(x=>x!==o); recountBatch(batch.report); remount();
      return importResultMsg(tally,0);
    } });
  }));
  container.querySelectorAll(".ing-merge").forEach(btn=>btn.addEventListener("click", ()=>{
    const d=(batch.report.duplicates||[])[+btn.getAttribute("data-di")]; if(!d) return;
    runAction("ingMerge", { working:t("publishing"), run: async ()=>{
      saveDraft({ slug:d.ghost_slug, archived:true });        // the page card keeps everything; the ghost archives
      try{ scheduleSyncPush(); }catch(_){}
      batch.report.duplicates=(batch.report.duplicates||[]).filter(x=>x!==d); recountBatch(batch.report); remount();
      return t("in_dup_merge")+" · "+d.ghost_slug;
    } });
  }));
}
// The shared write: every storable row is imported through the one writer (writeImport), idempotent by
// slug. host decides whether a row's page is also published (the editor hosts; the board never does).
async function ingWriteRows(batch, host){
  const rows=batch.report.rows.filter(ingStorable);
  let existing={};
  try{ existing=oppExistingMeta(await mergedOpps()); }catch(_){}
  // R17 (P26): mint ONE batch id + date so every opportunity this drop writes links to it, and the drop's
  // documents ride with it. A numbered batch (a document says "Batch 13") is idempotent by its number, so a
  // re-drop updates the same record. The id/date are threaded through the existing writeImport -> toRecord
  // ctx.batch, so the opp link needs no new write path.
  const _docs=batch.documents||[];
  const _n=batchNumberFrom(_docs);
  const _date=today();
  const _bid=batchIdFor(_n, Date.now());
  const _bctx=Object.assign({}, batch.batch, { id:_bid, date:_date });
  // R13: the row's action decision (restore / import-as-new for an archived slug) rides to the writer.
  const tally=await writeImport(rows.map(r=>({ entry:r.entry, host: host? ingHostable(r) : false, decision:r.decision })),
    { existing:existing, notes:batch.notes, batch:_bctx });
  // Keep the drop whole: persist the batch record (its documents + the slugs it produced). Only when the
  // drop actually landed opportunities or carried documents; a no-op drop writes no batch. A document NEVER
  // becomes a card here - this stores the files beside the cards, it does not import them.
  try{
    if((tally.slugs&&tally.slugs.length) || _docs.length){
      const prev=getBatch(_bid)||{};
      const slugs=Array.from(new Set([].concat(prev.slugs||[], tally.slugs||[])));
      saveBatch({ id:_bid, date:(prev.date||_date), n:_n||prev.n||0,
        title:(batch.batch&&batch.batch.title)||prev.title||"",
        documents:_docs.length?_docs:(prev.documents||[]),
        slugs:slugs, up:Date.now() });
      logActivity("in_batch", _bid, _docs.length+" documents, "+(tally.slugs||[]).length+" opportunities");
    }
  }catch(_){}
  return tally;
}

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
    const mSelR=el("f_mission");
    return { slug, business:el("f_biz").value.trim(),
      template: mode==="upload"?"custom":el("f_template").value,
      // R16 (P25): every page is filed under a mission. The select never rests on the "New mission"
      // sentinel (the change-handler resolves it before it lands), so this is always a real mission id.
      mission: (mSelR && mSelR.value && mSelR.value!=="__new__") ? mSelR.value : MISSION_DEFAULT,
      sent_on:el("f_sent").value, location:el("f_location").value.trim(),
      // INVARIANT I1: a record the editor builds is a page, not a send. It used to hardcode status:"sent",
      // so a brand-new or edited opportunity carried a phantom sent-status; the real Sent state comes from
      // the send ledger, never from this stamp. No status is written; the lane derives from evidence.
      phone:el("f_phone").value.trim(), mode:mode, published:editingLive,
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

  /* R16 (P25): the mission this page is filed under, and the ONE-editor parameterization. The mission
     select carries every mission plus a "New mission" option; choosing a mission binds the template family
     (its base templates for a fill mission like the Prospect Offer, or upload mode for a ratified design
     like the Monthly Report) and shows the requirements manifest. record() stamps the mission, so nothing
     is ever filed unfiled. There is no per-mission editor fork: this is the same initEditor, parameterized. */
  const mSel=el("f_mission"), mManifest=el("missionManifest");
  const NEW_MISSION="__new__";
  let lastMission = mSel ? mSel.value : MISSION_DEFAULT;
  function fillMissionSelect(sel){
    if(!mSel) return;
    var cur=sel || mSel.value || MISSION_DEFAULT, L=getLang();
    mSel.innerHTML=getMissions().map(function(m){ return '<option value="'+esc(m.id)+'">'+esc(missionName(m,L))+'</option>'; }).join("")+
      '<option value="'+NEW_MISSION+'">'+esc(t("f_mission_new"))+'</option>';
    if(cur && [].some.call(mSel.options,function(o){ return o.value===cur; })) mSel.value=cur;
  }
  function renderMissionManifest(){
    if(!mManifest || !mSel) return;
    var m=getMission(mSel.value); if(!m || !(m.manifest||[]).length){ mManifest.hidden=true; mManifest.innerHTML=""; return; }
    var L=getLang();
    mManifest.hidden=false;
    mManifest.innerHTML='<summary class="ed-manifest-s">'+ic("check",14)+esc(t("lib_manifest"))+'</summary>'+
      '<p class="shelf-manifest-p">'+esc(t("lib_manifest_sub"))+'</p><ul class="mf-list">'+
      (m.manifest||[]).map(function(it){ return '<li class="mf-item">'+ic("check",13)+'<span>'+esc((L==="ar")?(it.ar||it.en):(it.en||it.ar))+'</span></li>'; }).join("")+'</ul>';
  }
  function applyMission(){
    if(!mSel) return;
    var m=getMission(mSel.value), tpls=(m&&m.templates)||[];
    if(tpls.length){
      // Bind the template picker to THIS mission's base-template family (drop other missions' built-ins,
      // ensure the family is present); custom templates the operator added stay available.
      [].slice.call(tsel.options).forEach(function(o){ if(APPROVED_TEMPLATES.some(function(a){ return a.id===o.value; }) && tpls.indexOf(o.value)<0) o.remove(); });
      tpls.forEach(function(id){ if(![].some.call(tsel.options,function(o){ return o.value===id; })){ var ap=APPROVED_TEMPLATES.find(function(x){ return x.id===id; }); var o=document.createElement("option"); o.value=id; o.textContent=id+" · "+(ap?(getLang()==="ar"?ap.name_ar:ap.name_en):id); tsel.insertBefore(o, tsel.firstChild); } });
      if(tpls.indexOf(tsel.value)<0) tsel.value=tpls[0];
      var tf=el("templateField"); if(tf) tf.style.display="";
    } else {
      var tf2=el("templateField"); if(tf2) tf2.style.display="none";
      if(mode!=="upload") setMode("upload");                 // a ratified report is uploaded against its manifest, not filled
    }
    renderMissionManifest();
    if(typeof refreshLive==="function") refreshLive();
  }
  function openNewMissionPrompt(){
    var name=window.prompt(t("f_mission_new_q"), "");
    if(name===null || !String(name).trim()) return null;
    name=String(name).trim();
    var id=slugify(name)||("mission-"+Date.now().toString(36));
    var seedM=getMission(MISSION_DEFAULT)||MISSION_SEED[0];
    var m=addMission({ id:id, name_en:name, name_ar:name, manifest:(seedM.manifest||[]).slice() });
    fillMissionSelect(m?m.id:MISSION_DEFAULT);
    try{ logActivity("mission_new", "", name); }catch(_){}
    return m;
  }
  fillMissionSelect();
  var missionParam=viewParams().get("mission");
  if(missionParam && getMission(missionParam) && mSel) mSel.value=missionParam;
  if(mSel){
    lastMission=mSel.value;
    mSel.addEventListener("change", function(){
      if(mSel.value===NEW_MISSION){
        var m=openNewMissionPrompt();
        if(!m){ mSel.value=lastMission; return; }
        mSel.value=m.id;
      }
      lastMission=mSel.value;
      applyMission();
    });
  }
  applyMission();

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

  /* The editor's "Upload HTML" mode reads through the ONE resolver (readBatch) and renders through the ONE
     shared report renderer (mountIngestReport), the same the board's "Today's batch" drop uses. */
  async function runBatch(files){
    dz.innerHTML=esc(t("in_reading"));
    let out=null;
    try{
      const existingRecords=await mergedOpps();                 // full records, so re-drop can heal a ghost card
      out=await ThriveIntake.readBatch(files, { existing:oppExistingMeta(existingRecords), existingSlugs:existingRecords.map(o=>o.slug), existingRecords:existingRecords });
    }catch(e){
      dz.innerHTML=esc(t("upload_dz"));
      toast(/zip|inflate/i.test((e&&e.message)||"") ? t("in_zip_err") : t("in_none"));
      return;
    }
    dz.innerHTML=esc(t("upload_dz"));
    batch=out;
    if(!out.report.rows.length){ toast(t("in_none")); }
    renderBatch();
  }
  // Render through the ONE shared report renderer. Discard clears; Approve hosts the paged rows; a
  // needs-message Write stores drafts (no hosting) then opens the composer.
  function renderBatch(){
    mountIngestReport(batchPanel, batch, {
      onDiscard: ()=>{ batch=null; renderBatch(); },
      onApprove: (b)=> approveBatch(),
      onWrite: async (b)=>{ await ingWriteRows(b, false); batch=null; batchPanel.hidden=true; batchPanel.innerHTML=""; }
    });
  }
  async function approveBatch(){
    if(!batch) throw new Error(t("bt_nothing"));
    const rows=batch.report.rows.filter(ingStorable);
    if(!rows.length) throw new Error(t("bt_nothing"));
    // GitHub is needed only for the pages that get hosted. A text-only batch (no page in the
    // package) saves its drafts locally without it, rather than being blocked at the door.
    const needGh=rows.some(ingHostable);
    if(needGh && !ghReady()){ setTimeout(()=>goTo("settings"),900); throw new Error(t("gh_needed")); }
    // One writer, shared with the board intake: paged rows are hosted, every row is persisted idempotently
    // by slug, and the confirmation counts only what landed.
    const tally=await ingWriteRows(batch, true);
    logActivity("in_batch", "", tally.imported+" imported, "+tally.updated+" updated, "+tally.hosted+
      " hosted, "+tally.incomplete+" without text, "+tally.failed+" failed");
    const msg=importResultMsg(tally, 0);
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
      // R16 (P25): the editor opens on the page's own mission, so an edit stays filed where it was.
      // applyMission binds the mission's template family before the specific template value is restored.
      if(mSel){ var pm=missionOf(d); if(getMission(pm)){ mSel.value=pm; lastMission=pm; applyMission(); } }
      el("f_biz").value=d.business||""; el("f_slug").value=d.slug; el("f_slug").dataset.touched="1";
      el("f_sent").value=d.sent_on||el("f_sent").value; el("f_location").value=d.location||""; el("f_phone").value=d.phone||"";
      if(d.template && d.template!=="custom" && [].some.call(el("f_template").options,function(o){return o.value===d.template;})){ el("f_template").value=d.template; }
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

  /* Undo and redo do not live on this page editor. They belong on the outreach message text (the
     composer in the Outreach tab), where they are wired in initCompose. An earlier concern placed
     them here by reading the request too broadly; this scopes them to the message text and only there. */

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
  function fmt(ts){ return fmtWhenHtml(ts) || esc(String(ts==null?"":ts)); }   // isolated date markup (bdi)

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
    if(m.status==="pending") return t("mst_pending");     // dispatched, delivery being confirmed
    if(m.status==="sending") return t("mst_sending");     // email out, waiting on the server ledger confirm
    if(m.status==="unsent") return t("mst_unsent");       // a known failure: it did not leave
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
        return '<div class="msg"><div class="msg-top">'+dir+'<span class="mono msg-time">'+fmt(m.ts)+'</span>'+
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
        '<div class="th-side"><span class="th-counts">'+counts+'</span><span class="mono th-last">'+fmt(th.last)+'</span>'+
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
        const all=getMailLogLocal().map(m=> (m.mid && ids[m.mid])? Object.assign({}, m, {opp:opp}) : m);
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
    const when=k=>{   // returns isolated markup: a plain label, or the composed date in a <bdi>
      const today=dk(new Date().toISOString()), yest=dk(new Date(Date.now()-DAY).toISOString());
      if(k===today) return esc(t("act_today"));
      if(k===yest) return esc(t("act_yesterday"));
      try{ return fmtStampHtml(k+"T12:00:00Z", {weekday:"long", day:"numeric", month:"long"}) || esc(k); }
      catch(e){ return esc(k); }
    };
    wrap.innerHTML='<h3 class="block-h">'+esc(t("act_story_h"))+'</h3>'+
      '<p class="sub">'+esc(t("act_story_sub"))+'</p>'+
      '<ol class="story-days">'+keys.map(k=>{
        const d=days[k], said=[];
        const L=getLang();
        if(d.sent){ said.push(fmtRelative("act_s_sent",d.sent)); said.push(fmtRelative("act_s_to",d.people.size)); }
        if(d.replies) said.push(fmtRelative("act_s_replies",d.replies));
        if(d.published) said.push(fmtRelative("act_s_published",d.published));
        if(d.opens) said.push(fmtRelative("act_s_opens",d.opens));
        return '<li><span class="story-when">'+when(k)+'</span><span class="story-said">'+
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
      rows.map(r=>`<tr><td class="mono">${fmt(r.ts)}</td><td><span class="tag tag-cat-${esc(actCat(r.action))}">${t("cat_"+actCat(r.action))}</span></td><td><span class="tag tag-${esc(r.action)}">${esc(actionLabel(r.action))}</span></td><td class="mono">${esc(r.slug)||"–"}</td><td>${esc(r.detail)||"–"}</td></tr>`).join("")+
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
    download("thrive-activity.json", JSON.stringify({ activity:getActivity(), mail:getMailLogLocal() },null,2), "application/json");
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
function setEmailEndpoint(u){ try{ u?localStorage.setItem(EMAIL_EP,u):localStorage.removeItem(EMAIL_EP); }catch(e){} try{ supaMirrorSetting("email_ep", u||""); }catch(_){} }
function getFromName(){ try{ return (localStorage.getItem(FROM_NAME_KEY)||"Thrive"); }catch(e){ return "Thrive"; } }
function setFromName(v){ try{ v?localStorage.setItem(FROM_NAME_KEY, v):localStorage.removeItem(FROM_NAME_KEY); }catch(e){} try{ supaMirrorSetting("from_name", v||""); }catch(_){} }

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
function setQuotaCfg(c){ try{ localStorage.setItem(QUOTA_CFG, JSON.stringify({ daily:Math.max(1,parseInt(c.daily,10)||100), monthly:Math.max(1,parseInt(c.monthly,10)||3000) })); }catch(e){} try{ supaMirrorSetting("quota", quotaCfg()); }catch(_){} }
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
/* The one shared three-way question, used wherever a close would lose unsaved work. Each choice declares
   its ROLE, so styling and the default focus follow meaning rather than position: one primary (the safe,
   recommended action, styled and focused), the rest secondary, and one quiet-destructive marked danger.
   One choice is the CANCEL: Escape and a backdrop click resolve to it, because the gesture that dismisses a
   question must never be the gesture that loses or discards work. Resolves the index of the chosen button. */
function threeWay(title, body, choices){
  return new Promise(resolve=>{
    const old=document.getElementById("threeWay");
    if(old) old.remove();
    let cancelIx=0; choices.forEach((c,i)=>{ if(c && c.cancel) cancelIx=i; });
    const box=document.createElement("div");
    box.id="threeWay"; box.className="tw-scrim";
    box.innerHTML='<div class="tw-box" role="alertdialog" aria-modal="true" aria-labelledby="twT">'+
      '<h3 class="tw-t" id="twT">'+esc(title)+'</h3>'+
      '<p class="tw-p">'+esc(body)+'</p>'+
      '<div class="tw-acts">'+choices.map((c,i)=>
        '<button class="btn'+(c.kind==="primary"?"":" ghost")+(c.kind==="danger"?" danger":"")+'" type="button" '+
        'data-tw="'+i+'"'+(c.kind==="primary"?' data-tw-primary="1"':'')+'>'+esc(c.label)+'</button>').join("")+
      '</div></div>';
    document.body.appendChild(box);
    const done=i=>{ box.remove(); resolve(i); };
    box.querySelectorAll("[data-tw]").forEach(b=>
      b.addEventListener("click",()=>done(parseInt(b.getAttribute("data-tw"),10))));
    box.addEventListener("keydown", e=>{ if(e.key==="Escape"){ e.stopPropagation(); done(cancelIx); } });
    box.addEventListener("click", e=>{ if(e.target===box) done(cancelIx); });
    const focusBtn=box.querySelector('[data-tw-primary="1"]') || box.querySelector("[data-tw]");
    if(focusBtn) focusBtn.focus();
  });
}

/* ---------- P24: the two explicit send paths, offered as a choice ----------
   The machinery for both a one-brief send and a dozens-campaign already exists (single Send and Start
   campaign in the Outreach tab; the P5 roster in Overview; P6 personalize, P7 preview, P8 paced queue). What
   was missing was the OFFER: a clear "Send" that names the two paths and routes into the right one. This is
   pure navigation. It builds NO send machinery: it opens the existing composer for a single, and the existing
   campaign screen (or the roster, if none is built yet) for a campaign, so the one system stays the one path.
     - فردي (single): the Outreach tab, composer prefilled from the card's primary channel (P18).
     - حملة (campaign): the campaign screen (Outreach) when a roster of many already exists, else the roster
       editor (Overview) so the operator builds it first. From there: personalize, preview, the paced queue. */
async function openSendChooser(slug, name){
  var all=[]; try{ all=await mergedOpps(); }catch(e){}
  function oppBySlug(s){ return all.find(function(x){ return x && x.slug===s; })||null; }
  var scrim=document.getElementById("sendChoose"); if(scrim) scrim.remove();
  scrim=document.createElement("div"); scrim.id="sendChoose"; scrim.className="tw-scrim send-scrim";
  document.body.appendChild(scrim);
  function close(){ if(scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim); }
  scrim.addEventListener("click", function(e){ if(e.target===scrim) close(); });
  scrim.addEventListener("keydown", function(e){ if(e.key==="Escape"){ e.stopPropagation(); close(); } });
  function go(s, tab, nm){ close(); if(window.thriveModal) window.thriveModal.open(s, tab, nm||s); }

  function paths(o){
    var addr=emailAddress(o), recips=campaignRecipients(o), group=recips.length>1;
    var nm=o.business||o.slug||"";
    var box=document.createElement("div"); box.className="tw-box send-box"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-labelledby","sendChooseT");
    box.innerHTML='<h3 class="tw-t" id="sendChooseT">'+esc(t("send_which_h"))+'</h3>'+
      '<p class="tw-p" dir="auto">'+esc(nm)+'</p>'+
      '<div class="send-grid">'+
        '<button class="send-card'+(addr?"":" is-off")+'" type="button" data-mode="single"'+(addr?"":' disabled')+'>'+
          ic("mail",22)+'<span class="send-t">'+esc(t("send_single"))+'</span>'+
          '<span class="send-d">'+esc(t("send_single_p"))+'</span>'+
          '<span class="send-meta mono-iso">'+(addr? ltr(esc(bareAddress(addr))) : esc(t("send_no_email")))+'</span></button>'+
        '<button class="send-card" type="button" data-mode="campaign">'+
          ic("send",22)+'<span class="send-t">'+esc(t("send_campaign"))+'</span>'+
          '<span class="send-d">'+esc(t("send_campaign_p"))+'</span>'+
          '<span class="send-meta">'+(group? ('<bdi class="n">'+nIso(recips.length)+'</bdi> '+esc(t("send_recips"))) : esc(t("send_build_roster")))+'</span></button>'+
      '</div>'+
      '<div class="send-foot"><button class="btn ghost sm" type="button" data-cancel="1">'+esc(t("close"))+'</button></div>';
    scrim.innerHTML=""; scrim.appendChild(box);
    box.querySelector("[data-cancel]").addEventListener("click", close);
    box.querySelectorAll("[data-mode]").forEach(function(b){ b.addEventListener("click", function(){
      var mode=b.getAttribute("data-mode");
      if(mode==="single"){ go(o.slug, "outreach", nm); }
      else if(group){ go(o.slug, "outreach", nm); }                     // a roster of many exists: the campaign screen
      else { go(o.slug, "overview", nm); toast(t("send_campaign_needroster")); }   // build the roster first (P5, in Overview)
    }); });
    var f=box.querySelector(".send-card:not([disabled])"); if(f) f.focus();
  }

  function picker(){
    var sendable=all.filter(function(o){ return o && !(o.spawned_from && o.spawned_from.parent) && emailAddress(o); }).slice(0,12);
    var box=document.createElement("div"); box.className="tw-box send-box"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-labelledby","sendChooseT");
    box.innerHTML='<h3 class="tw-t" id="sendChooseT">'+esc(t("send_pick_h"))+'</h3>'+
      '<p class="tw-p">'+esc(t("send_pick_p"))+'</p>'+
      '<ul class="send-list">'+ (sendable.length
        ? sendable.map(function(o){ var recips=campaignRecipients(o);
            return '<li><button class="send-op" type="button" data-slug="'+esc(o.slug)+'"><span class="send-op-n" dir="auto">'+esc(o.business||o.slug)+'</span>'+
              '<span class="send-op-m">'+(recips.length>1
                ? ('<bdi class="n">'+nIso(recips.length)+'</bdi> '+esc(t("send_recips")))
                : ('<span class="mono-iso">'+ltr(esc(bareAddress(emailAddress(o)||"")))+'</span>'))+'</span></button></li>';
          }).join("")
        : '<li class="send-empty">'+esc(t("send_pick_none"))+'</li>')+'</ul>'+
      '<div class="send-foot"><button class="btn ghost sm" type="button" data-cancel="1">'+esc(t("close"))+'</button></div>';
    scrim.innerHTML=""; scrim.appendChild(box);
    box.querySelector("[data-cancel]").addEventListener("click", close);
    box.querySelectorAll("[data-slug]").forEach(function(b){ b.addEventListener("click", function(){
      var o=oppBySlug(b.getAttribute("data-slug")); if(o) paths(o);
    }); });
    var f=box.querySelector(".send-op"); if(f) f.focus();
  }

  var o=slug? oppBySlug(slug) : null;
  if(o) paths(o); else picker();
}
try{ window.openSendChooser=openSendChooser; }catch(_){}

/* ---------- R14 (P20): the one signature system, per sender ----------
   A signature is a saved text block: a sender DISPLAY NAME (the only variable) plus a FIXED agency block
   (Thrive Digital Solutions, thriveiii.com). Each member (Thyab, Agha, Basel, ...) manages their own set,
   stored per ACTOR in the profile prefs under the namespaced signature.v1 key - additive, synced, never a
   schema change. The compile path appends EXACTLY ONE of these (the sender's default, or the one chosen for
   that send); the legacy closing block and every template-embedded sign-off are removed from the pipeline so
   a second closing is structurally impossible. The compliance footer (POSTAL) stays separate, appended once.
   Rendered as clean text, EN or AR to match the message, no images, no styling beyond the existing tokens. */
const AGENCY_NAME = "Thrive Digital Solutions";    // the fixed agency name (never per-user)
const AGENCY_SITE = "thriveiii.com";               // the fixed site
const SIGN = "thrive_signature_v1";                // legacy per-device {EN,AR} blob, read only to migrate
function sigLegacyName(loc){
  try{ var all=JSON.parse(localStorage.getItem(SIGN)||"{}"); var v=all[(loc==="AR")?"AR":"EN"];
    if(typeof v==="string" && v.trim()) return v.split("\n")[0].trim(); }catch(e){}
  return "";
}
function sigSeedName(){ try{ return (resolveOperator(currentActor())||getFromName()||"").trim(); }catch(e){ return (getFromName()||"").trim(); } }
function sigNewId(){ return "sig-"+Date.now().toString(36)+"-"+Math.floor(Math.random()*1e6).toString(36); }
// The ONE store: the signed-in actor's signature set, {list:[{id,label,name_en,name_ar}], def:id}. Seeded
// additively from the legacy blob or the operator's resolved name, so no one loses the block they had.
function sigStore(){
  var st=null;
  try{ st = (typeof profilePrefNS==="function") ? profilePrefNS("signature", null) : null; }catch(e){}
  if(st && Array.isArray(st.list) && st.list.length) return { list:st.list.slice(), def:st.def||st.list[0].id };
  var en=sigLegacyName("EN")||sigSeedName(), ar=sigLegacyName("AR")||en;
  var seed={ id:"sig-default", label:(en||ar||"Signature"), name_en:en, name_ar:ar };
  return { list:[seed], def:seed.id };
}
function sigList(){ return sigStore().list; }
function sigById(id){ var l=sigList(); for(var i=0;i<l.length;i++){ if(l[i].id===id) return l[i]; } return null; }
function sigDefault(){ var st=sigStore(); return sigById(st.def) || st.list[0] || null; }
function sigPersist(st){ try{ if(typeof setProfilePrefNS==="function") setProfilePrefNS("signature", st); }catch(e){} }
function sigAdd(name_en, name_ar){
  var st=sigStore(); var s={ id:sigNewId(), label:(String(name_en||name_ar||"").trim()||"Signature"),
    name_en:String(name_en||"").trim(), name_ar:String(name_ar||"").trim() };
  st.list.push(s); if(!st.def) st.def=s.id; sigPersist(st); return s;
}
function sigUpdate(id, patch){
  var st=sigStore(); for(var i=0;i<st.list.length;i++){ if(st.list[i].id===id){
    st.list[i]=Object.assign({}, st.list[i], patch);
    if(patch.name_en!==undefined || patch.name_ar!==undefined)
      st.list[i].label=(st.list[i].name_en||st.list[i].name_ar||"Signature").trim()||"Signature";
    sigPersist(st); return st.list[i]; } }
  return null;
}
function sigRemove(id){
  var st=sigStore(); st.list=st.list.filter(function(s){ return s.id!==id; });
  if(st.def===id) st.def=(st.list[0]||{}).id||""; sigPersist(st);
}
function sigSetDefault(id){ var st=sigStore(); if(sigById(id)){ st.def=id; sigPersist(st); } }
// Render ONE signature as clean text in the message's language: the sender name (Arabic name for an Arabic
// send, English otherwise) above the fixed agency block. No images, no styling.
function renderSignature(sig, loc){
  if(!sig) return "";
  var nm=(loc==="AR") ? (sig.name_ar||sig.name_en) : (sig.name_en||sig.name_ar);
  nm=String(nm||"").trim();
  return (nm ? nm+"\n" : "") + AGENCY_NAME + "\n" + AGENCY_SITE;
}
// The ONE resolver kept by name for its call sites: the actor's default signature, in the given locale.
function signatureFor(loc){ return renderSignature(sigDefault(), (loc==="AR")?"AR":"EN"); }
function signatureForId(id, loc){ return renderSignature(sigById(id)||sigDefault(), (loc==="AR")?"AR":"EN"); }
/* The per-sender signature manager, rendered into the profile page. Lists the actor's own signatures with
   a live preview of each (name above the fixed agency block), a set-default control, inline edit of the
   name only, and delete; below the list, one add form. Every mutation goes through the sig* helpers (which
   persist per-actor, additively) and then re-renders, so the surface always mirrors the store. `flash` is
   the "Saved." pulse from initProfile; it may be omitted (a no-op) when called from elsewhere. */
function renderSignatures(flash){
  var host=document.getElementById("pfSigList"); if(!host) return;
  var ping=(typeof flash==="function") ? flash : function(){};
  var def=sigDefault(), defId=def? def.id : "";
  var list=sigList(), rows="";
  for(var i=0;i<list.length;i++){
    var s=list[i], isDef=(s.id===defId);
    var prev=esc(renderSignature(s, (getLang && getLang()==="ar")?"AR":"EN"));
    rows+='<li class="sig-item'+(isDef?" sig-item-def":"")+'" data-id="'+esc(s.id)+'">'
      + '<div class="sig-item-top">'
      +   '<span class="sig-item-label">'+esc(s.label||s.name_en||s.name_ar||t("sig_h"))+'</span>'
      +   (isDef ? '<span class="sig-item-badge" data-i18n="sig_default">'+esc(t("sig_default"))+'</span>' : '')
      + '</div>'
      + '<pre class="sig-item-prev oc-body">'+prev+'</pre>'
      + '<div class="sig-item-act">'
      +   (isDef ? '' : '<button type="button" class="btn ghost sm" data-sig-act="default" data-i18n="sig_make_default">'+esc(t("sig_make_default"))+'</button>')
      +   '<button type="button" class="btn ghost sm" data-sig-act="edit" data-i18n="edit">'+esc(t("edit"))+'</button>'
      +   (list.length>1 ? '<button type="button" class="btn ghost sm danger" data-sig-act="remove" data-i18n="remove">'+esc(t("remove"))+'</button>' : '')
      + '</div>'
      + '</li>';
  }
  host.innerHTML=rows;
  // per-row actions (default / edit / remove), delegated once per render
  var items=host.querySelectorAll(".sig-item");
  for(var j=0;j<items.length;j++){ (function(li){
    var id=li.getAttribute("data-id");
    var btns=li.querySelectorAll("[data-sig-act]");
    for(var k=0;k<btns.length;k++){ (function(btn){
      btn.addEventListener("click", function(){
        var act=btn.getAttribute("data-sig-act");
        if(act==="default"){ sigSetDefault(id); ping(); renderSignatures(flash); }
        else if(act==="remove"){ sigRemove(id); ping(); renderSignatures(flash); }
        else if(act==="edit"){ sigEditRow(li, id, flash); }
      });
    })(btns[k]); }
  })(items[j]); }
  // add form (present once in the markup, re-wired idempotently by a guard flag)
  var addBtn=document.getElementById("pfSigAdd");
  if(addBtn && !addBtn.__wired){ addBtn.__wired=true;
    addBtn.addEventListener("click", function(){
      var en=document.getElementById("pfSigNewEn"), ar=document.getElementById("pfSigNewAr");
      var ve=en? en.value.trim() : "", va=ar? ar.value.trim() : "";
      if(!ve && !va) return;
      sigAdd(ve, va); if(en) en.value=""; if(ar) ar.value="";
      ping(); renderSignatures(flash);
    });
  }
}
/* Inline edit of one row: swap the preview for two name inputs (EN/AR) plus save/cancel. Only the sender
   name is editable; the agency block is fixed and never surfaced as an input. */
function sigEditRow(li, id, flash){
  var s=sigById(id); if(!s) return;
  var ping=(typeof flash==="function") ? flash : function(){};
  li.innerHTML='<div class="sig-item-edit">'
    + '<label class="sig-edit-l" data-i18n="sig_name_en">'+esc(t("sig_name_en"))+'</label>'
    + '<input type="text" class="input" dir="ltr" data-sig-en value="'+esc(s.name_en||"")+'">'
    + '<label class="sig-edit-l" data-i18n="sig_name_ar">'+esc(t("sig_name_ar"))+'</label>'
    + '<input type="text" class="input" dir="rtl" data-sig-ar value="'+esc(s.name_ar||"")+'">'
    + '<div class="sig-item-act">'
    +   '<button type="button" class="btn sm" data-sig-save data-i18n="sig_save">'+esc(t("sig_save"))+'</button>'
    +   '<button type="button" class="btn ghost sm" data-sig-cancel data-i18n="sig_cancel">'+esc(t("sig_cancel"))+'</button>'
    + '</div></div>';
  var enI=li.querySelector("[data-sig-en]"), arI=li.querySelector("[data-sig-ar]");
  li.querySelector("[data-sig-save]").addEventListener("click", function(){
    sigUpdate(id, { name_en:enI.value.trim(), name_ar:arI.value.trim() });
    ping(); renderSignatures(flash);
  });
  li.querySelector("[data-sig-cancel]").addEventListener("click", function(){ renderSignatures(flash); });
  if(enI) enI.focus();
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
  // R14 (P20): the closing is the ONE signature the compile resolved and nothing else. There is NO invented
  // name/site fallback here any more - that was the second closing source. A body with no signature simply
  // has no closing, never a fabricated one, so a second sign-off is structurally impossible.
  const closing = sigHtml ? '<div style="margin-top:18px;color:#444">'+sigHtml+'</div>' : '';
  if(!branded){
    return '<div style="font-family:'+font+';font-size:15px;line-height:1.6;color:#222">'
      +inner+closing+'</div>';
  }
  const logo="https://"+SITE+"/assets/thrive-logo.png";
  return '<div style="font-family:'+font+';max-width:600px;margin:0 auto;padding:10px 4px">'
    +'<img src="'+logo+'" width="42" height="42" alt="'+name+'" style="display:block;border-radius:10px;margin-bottom:16px">'
    +'<div style="font-size:15px;line-height:1.7;color:#111827">'+inner+'</div>'
    +(sigHtml? '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#9aa0aa">'+sigHtml+'</div>' : '')
    +'</div>';
}

/* email templates (reusable subject + body with merge fields) */
const ETPL = "thrive_email_templates_v1";
/* The monthly template is month-aware ({{MONTH}}: the composer asks which month) and ships
   with NO embedded opportunity link: the writer decides which words carry it (guided flow). */
const ETPL_MONTHLY = { id:"monthly", locale:"EN", name:"Monthly update", subject:"{{MONTH}} at Thrive",
  html:'Hi {{NAME}},<br><br>End of the month, so here is {{MONTH}} at Thrive. We take on the work we think we’ll be proud of. If that could be yours, just say hi.<br><br>See you next month!' };
/* Arabic edition of the stock template, a real Arabic message, not a translation of labels
   around English text. Greeting is «مرحبًا فلان،», not "Hi …". */
const ETPL_MONTHLY_AR = { id:"monthly-ar", locale:"AR", name:"التحديث الشهري", subject:"{{MONTH}} في ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>مع نهاية الشهر، هذا هو {{MONTH}} في ثرايف. نحن نختار العمل الذي نفخر به. إن كان ذلك يناسبك، تكفي كلمة.<br><br>إلى الشهر القادم!' };
/* The two that matter on the day you publish a page: the message that sends it, and the one
   that follows up when nothing came back. Both carry the link inside real words rather than
   as a bare URL, and neither states anything about the recipient: every fact in them is a
   merge field or something you type. They are a starting point, and you edit them. */
const ETPL_OPP = { id:"opp-intro", locale:"EN", name:"Send an opportunity page", subject:"{{BIZ}} x Thrive",
  html:'Hi {{NAME}},<br><br>I put together <a href="{{LINK}}">a short page for {{BIZ}}</a>. One screen, no form to fill in. It says what I noticed and what I would do about it.<br><br>If it is worth a conversation, just reply. If not, no reply needed.' };
const ETPL_OPP_AR = { id:"opp-intro-ar", locale:"AR", name:"إرسال صفحة فرصة", subject:"{{BIZ}} مع ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>أعددت <a href="{{LINK}}">صفحة قصيرة لـ {{BIZ}}</a>. شاشة واحدة، بلا نموذج تملؤه. فيها ما لاحظته وما أقترح فعله.<br><br>إن كانت تستحق حديثًا، يكفي أن تردّ. وإن لم تكن، فلا حاجة للرد.' };
const ETPL_NUDGE = { id:"opp-nudge", locale:"EN", name:"Follow up once", subject:"Re: {{BIZ}} x Thrive",
  html:'Hi {{NAME}},<br><br>Bringing <a href="{{LINK}}">the page for {{BIZ}}</a> back to the top of your inbox, in case it arrived on a busy day.<br><br>If the timing is wrong, tell me and I will leave it there.' };
const ETPL_NUDGE_AR = { id:"opp-nudge-ar", locale:"AR", name:"متابعة واحدة", subject:"إعادة: {{BIZ}} مع ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>أعيد <a href="{{LINK}}">صفحة {{BIZ}}</a> إلى أعلى بريدك، فربما وصلت في يوم مزدحم.<br><br>وإن كان التوقيت غير مناسب، أخبرني وأتركها عند هذا الحد.' };

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
  // Legacy parity: an old message template made before the type taxonomy carries no type. Default it
  // on read (a message template is a text snippet, exactly as saveEmailTemplate stamps a new one), so
  // it lists and opens like any other. The render path already guards every string field with ||, so
  // a template missing a subject, name or html draws with the same defaults rather than a broken row.
  return a.map(x=> (x && !x.type) ? {...x, type:T_SNIPPET} : x);
}
function setEmailTemplates(a){ const ok=lsSet(ETPL, JSON.stringify(a)); try{ supaMirrorTemplates(a, "email"); }catch(_){} return ok; }
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
    .split("{{NAME}}").join('<span data-m="name" contenteditable="false">'+esc(name||"there")+'</span>')
    .split("{{MONTH}}").join('<span data-m="month">'+esc(month||"")+'</span>')
    .split("{{SLUG}}").join(esc(o?o.slug:""));
}
function tplUsesMonth(tp){ return !!tp && /\{\{MONTH\}\}/.test((tp.subject||"")+(tp.html||"")); }

/* mail log: every send/copy/reply, per recipient (campaign documentation) */
const MAILLOG = "thrive_mail_v1";
function getMailLogLocal(){ try{ return JSON.parse(localStorage.getItem(MAILLOG)||"[]"); }catch(e){ return []; } }
/* The READ accessor for the ledger: the canonical localStorage store, into which reconcileCanonical has
   folded the migrated console_mail rows, so Sent, Opened and Replied derive from the complete reconciled
   ledger rather than a truncated local store and no card falls back to Ready, with no second live copy to
   fork from. Under a render pin it reads the frozen snapshot. Writers (logMail, the sync merge, reassign)
   use getMailLogLocal. */
function getMailLog(){ if(__boardPin) return __boardPin.mail.slice(); return getMailLogLocal(); }
function setMailLog(a){ const ok=lsSet(MAILLOG, JSON.stringify(a.slice(-800))); invalidateSends(); return ok; }

/* ---------- the open team discussion (console_comments) ----------
   Every operator writes, replies and reads inside any card, openly: one shared room, not private notes.
   A comment is stamped with the REAL operator (currentActor(), which is the Supabase auth.uid() once
   signed in) and carries a snapshot of the poster's display name taken from their own console_profiles at
   post time. The snapshot is deliberate: the profile RLS is own-read-only, so another operator's name
   cannot be read live; snapshotting is the only way a comment renders its author's real name. Writes go
   through the SAME Stage-4 queue as every other mutation (supaMirrorComment / supaDeleteComment), so a
   signed-out post is durably queued and drains on sign-in, and there is no second write path. The read
   accessor prefers the hydrated Supabase slice and falls back to the local cache, exactly like the ledger.
   The discussion NEVER leaves the console: it is read here and rendered in the card, and no send composer
   reads console_comments or __supa.comments, so it can never reach an outbound surface. */
const COMMENTS="thrive_comments_v1";
function getCommentsLocal(){ try{ return JSON.parse(localStorage.getItem(COMMENTS)||"[]"); }catch(e){ return []; } }
function setCommentsLocal(a){ try{ localStorage.setItem(COMMENTS, JSON.stringify((a||[]).slice(-5000))); }catch(e){} }
function getComments(){ if(supaReadable() && __supa.comments) return __supa.comments.slice(); return getCommentsLocal(); }
// Mint a stable client id that is also the Stage-4 idempotency key (the row's primary key), so a replayed
// upsert merges in place. Time-ordered prefix keeps the local list roughly sortable even before hydrate.
function mintCommentId(){
  var t=Date.now().toString(36), r=Math.floor((1+Math.random())*0x1000000).toString(36).slice(1);
  return "c_"+t+"_"+r;
}
// Write to BOTH the local cache and the hydrated read slice, so an open card reflects the change at once,
// whether it is reading from Supabase or the device. The mirror then queues the durable write.
function commentCachePut(c){
  var a=getCommentsLocal(), i=a.findIndex(function(x){ return x && x.id===c.id; });
  if(i>=0) a[i]=c; else a.push(c); setCommentsLocal(a);
  if(__supa.comments){ var j=__supa.comments.findIndex(function(x){ return x && x.id===c.id; });
    if(j>=0) __supa.comments[j]=c; else __supa.comments.push(c); }
}
function commentCacheDrop(id){
  setCommentsLocal(getCommentsLocal().filter(function(x){ return x && x.id!==id; }));
  if(__supa.comments) __supa.comments=__supa.comments.filter(function(x){ return x && x.id!==id; });
}

/* ---------- the Contact Book curation overlay (console_contacts, P10) ----------
   The Book holds ONLY curation facts a human decides: which addresses are one person (the merge grouping),
   the person's curated name, tags, a note. The activity history is NEVER stored here; it stays derived from
   the ledger (see buildContacts), so a merge is reversible by dropping the row and the ledger is untouched.
   Same shape as the discussion store: a local cache mirrors the hydrated read slice for instant reflection,
   and writes go through the ONE Stage-4 queue (supaMirrorContact / supaDeleteContact), never a second path. */
const CONTACTS="thrive_contacts_v1";
function getContactsLocal(){ try{ return JSON.parse(localStorage.getItem(CONTACTS)||"[]"); }catch(e){ return []; } }
function setContactsLocal(a){ try{ localStorage.setItem(CONTACTS, JSON.stringify((a||[]).slice(-5000))); }catch(e){} }
function getContacts(){ if(supaReadable() && __supa.contacts) return __supa.contacts.slice(); return getContactsLocal(); }
function mintContactId(){
  var t=Date.now().toString(36), r=Math.floor((1+Math.random())*0x1000000).toString(36).slice(1);
  return "ct_"+t+"_"+r;
}
function contactCachePut(c){
  var a=getContactsLocal(), i=a.findIndex(function(x){ return x && x.id===c.id; });
  if(i>=0) a[i]=c; else a.push(c); setContactsLocal(a);
  if(__supa.contacts){ var j=__supa.contacts.findIndex(function(x){ return x && x.id===c.id; });
    if(j>=0) __supa.contacts[j]=c; else __supa.contacts.push(c); }
}
function contactCacheDrop(id){
  setContactsLocal(getContactsLocal().filter(function(x){ return x && x.id!==id; }));
  if(__supa.contacts) __supa.contacts=__supa.contacts.filter(function(x){ return x && x.id!==id; });
}
function contactPending(id){
  try{ return supaPending().some(function(e){ return e && e.t==="console_contacts" &&
    ((e.op==="upsert" && (e.rows||[]).some(function(r){ return r && r.id===id; })) ||
     (e.op==="del" && String(e.q||"").indexOf(encodeURIComponent(id))>=0)); }); }catch(e){ return false; }
}
// A comment is still queued (not yet confirmed to Supabase) while an upsert for its id sits in the pending
// queue. This is the honest queued state the card shows, and it clears when the queue drains on sign-in.
function commentPending(id){
  try{ return supaPending().some(function(e){ return e && e.op==="upsert" && e.t==="console_comments" &&
    (e.rows||[]).some(function(r){ return r && r.id===id; }); }); }catch(e){ return false; }
}
// Every comment for one opportunity, oldest first (the room reads top to bottom).
function commentsForOpp(slug){
  return getComments().filter(function(c){ return c && c.opp===slug; })
    .sort(function(a,b){ return String(a.created_at||"").localeCompare(String(b.created_at||"")); });
}
function postComment(slug, body, parentId){
  var text=String(body==null?"":body).trim();
  if(!slug || !text) return null;
  var now=new Date().toISOString();
  var prof=(typeof profileNow==="function" && profileNow())||{};
  var c={ id:mintCommentId(), opp:slug, author:currentActor(),
    author_name:String(prof.display_name||"").trim(), body:text,
    parent_id:parentId||null, created_at:now, updated_at:now };
  commentCachePut(c);
  try{ logActivity("comment_add", slug, c.id); }catch(_){}
  supaMirrorComment(c);
  return c;
}
function editComment(id, body){
  var text=String(body==null?"":body).trim(); if(!id || !text) return null;
  var mine=getComments().find(function(c){ return c && c.id===id; }); if(!mine) return null;
  if(mine.author!==currentActor()) return null;                 // own only, mirrors the RLS update policy
  var c=Object.assign({}, mine, { body:text, updated_at:new Date().toISOString() });
  commentCachePut(c); supaMirrorComment(c); return c;
}
function deleteComment(id){
  var mine=getComments().find(function(c){ return c && c.id===id; }); if(!mine) return false;
  if(mine.author!==currentActor()) return false;                // own only, mirrors the RLS delete policy
  commentCacheDrop(id);
  try{ logActivity("comment_del", mine.opp, id); }catch(_){}
  supaDeleteComment(id); return true;
}
window.ThriveComments={ list:commentsForOpp, post:postComment, edit:editComment, del:deleteComment,
  all:getComments, pending:commentPending };

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
// A wire Message-ID for an outbound send, in RFC822 angle-bracket form on the console's own domain, so a
// reply's In-Reply-To carries it back and the header tier can thread on it. Recorded on the mail row.
function newMessageId(){ try{ return "<c"+Date.now().toString(36)+Math.random().toString(36).slice(2,10)+"@thriveiii.com>"; }catch(e){ return "<c"+(getMailLog().length+1)+"@thriveiii.com>"; } }
// Central ledger writer: stamps a unique message id, resolves the thread, and fixes direction.
function logMail(rec){
  const a=getMailLogLocal();
  const r=Object.assign({ ts:new Date().toISOString(), actor:currentActor() }, rec);
  if(!r.mid) r.mid=newMid();
  if(!r.actor) r.actor=currentActor();
  if(!r.thread) r.thread=threadKey(r.to, r.opp, r.subject);
  if(!r.direction) r.direction=(r.status==="replied"||r.status==="received")?"in":"out";
  /* WO-015 I8: a mail record carries its chapter. One is the first contact, two is
     the offer. It defaults to one, so every record written before this reads as
     the first contact with nothing to migrate. */
  if(r.chapter==null) r.chapter=1;
  if(r.templateId===undefined) r.templateId="";
  if(r.templateName===undefined) r.templateName="";
  a.push(r); setMailLog(a);   // invalidates the send index: a send changes a lane immediately
  // The ledger row must reach Supabase for the server board view to see the send; the mirror is queued
  // durably (supaFlush drains on sign-in), but a failure here is recorded on the diverge ledger, never
  // swallowed, so an incomplete ledger surfaces (the drift badge) instead of vanishing (Part 4).
  try{ supaMirrorMail(r); }catch(e){ try{ supaRecordDiverge("mirror", "console_mail", e&&e.message); }catch(_){} }
  return r;
}
/* Exactly-once send (LAUNCH BLOCKER fix). A send's identity is its intent, not the click: the same
   message to the same address for the same opportunity is one intent, and a retry of it must reach the
   prospect AT MOST ONCE. This key is stable across retries of that intent (content-hashed), so the guard
   below and the relay's Idempotency-Key both key on the same thing, and a re-tap reconciles rather than
   sending twice. A genuinely different message hashes to a different key and is a new send. */
function sendIdem(opp, to, subject, body){
  var s=String(opp||"")+""+String(to||"").trim().toLowerCase()+""+String(subject||"")+""+String(body||"");
  var h=0; for(var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; }
  var h2=0; for(var j=s.length-1;j>=0;j--){ h2=((h2<<5)-h2+s.charCodeAt(j))|0; }   // a second pass so distinct
  return "snd_"+(h>>>0).toString(36)+(h2>>>0).toString(36);                        // messages do not collide
}
function findMailRowByIdem(idem){
  if(!idem) return null;
  var a=getMailLogLocal();
  for(var i=a.length-1;i>=0;i--){ if(a[i] && a[i].idem===idem) return a[i]; }       // newest match
  return null;
}
// Update the intent's row in place WITHOUT mirroring. On the send path the one awaited server write is owned
// by supaConfirmMail, so a pending/sending/unsent row stays local and a confirmed 'sent' is not re-mirrored.
function updateMailByIdemLocal(idem, patch){
  if(!idem) return null;
  var a=getMailLogLocal();
  for(var i=a.length-1;i>=0;i--){
    if(a[i] && a[i].idem===idem){ a[i]=Object.assign({}, a[i], patch||{}); setMailLog(a); return a[i]; }
  }
  return null;
}
// As updateMailByIdemLocal, but also mirrors the row (the mirror itself skips pending/sending and empty opp).
function updateMailByIdem(idem, patch){
  var row=updateMailByIdemLocal(idem, patch);
  if(row){ try{ supaMirrorMail(row); }catch(_){} }
  return row;
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
      // A known failure is not a send: an unsent row is the durable record of an attempt that the relay
      // did not confirm (kept, keyed by intent, so a retry reconciles), never a message in the thread.
      // A pending row stays, because it is in flight and has already advanced the card. This is what
      // keeps the thread unchanged when a reply genuinely fails.
      if(m.status==="unsent") return;
      out.push({ kind:"sent", ts:m.ts, to:m.to||"", toName:m.toName||"", actor:m.actor||"",
                 subject:m.subject||"", body:(m.preview||m.body||""), channel:m.provider||"", status:m.status||"sent",
                 templateName:m.templateName||"", chapter:m.chapter||1, mid:m.mid });
    }
  });

  // 2. the relay inbox: real replies carry a snippet and a Gmail link, autos are
  //    machinery (a bounce) shown and labelled, never counted as a reply.
  inboundFor(slug).forEach(r=>{
    if(r.kind==="auto"){
      out.push({ kind:"auto", ts:r.ts, bounce:r.bounce||"", from:r.from||"" });
    }else{
      // The attachment label reflects the RESOLVED match, not the raw relay r.rule (which is empty for a
      // subject-linked reply and made the History row read "not matched" while the board showed it attached).
      // Every reply reaching here belongs to this slug (inboundFor resolves it), so it is matched: prefer the
      // console match_tier (subject/header/manual/sender), else the relay rule, else "subject" (it resolved by
      // subject). "not matched" (rule none) can only surface for a genuinely unattached reply, never here.
      var etier=r.match_tier || (r.rule && r.rule!=="none" ? r.rule : "") || "subject";
      out.push({ kind:"reply", ts:r.ts, source:"inbox", id:inboundKey(r), from:(r.name||r.from||""),
                 fromAddr:r.from||"", subject:r.subject||"", snippet:(r.snippet||"").slice(0,600),
                 rule:etier, tier:etier, ambiguous:!!r.match_ambiguous,
                 chapter:r.chapter||1, gmail:(typeof ThriveInbound!=="undefined"&&ThriveInbound.gmailLink)?ThriveInbound.gmailLink(r):"" });
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

  // 5. a spawned child also carries the campaign send it answered, to its one recipient, so the child card
  //    shows the full conversation (the send that was answered, then the reply that spawned it).
  const self=getDraft(slug);
  if(self && self.spawned_from && self.spawned_from.parent){
    const pa=String(self.spawned_from.addr||"").trim().toLowerCase();
    getMailLog().forEach(m=>{
      if(!m || m.opp!==self.spawned_from.parent || m.direction==="in") return;
      if(String(m.to||"").trim().toLowerCase()!==pa) return;
      out.push({ kind:"sent", ts:m.ts, to:m.to||"", toName:m.toName||"", subject:m.subject||"",
                 body:(m.preview||m.body||""), channel:m.provider||"", status:m.status||"sent", templateName:m.templateName||"", chapter:m.chapter||1, mid:m.mid });
    });
  }

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

/* ---------- WO-020: a real reply editor and durable, correctly-rendered threads ----------
   The thread could be read but not answered, and an Arabic reply bidi-reordered into tangled lines
   because its text carried no direction of its own. threadListHtml renders each message isolated in
   its own reading direction (dir="auto", unicode-bidi:isolate), so Arabic reads right-to-left with
   joined letters and English left-to-right, side by side, never interleaved; every reply body is
   escaped at render, so a hostile body is inert. replyTarget resolves who a reply answers and what it
   threads onto, scoped to this slug's own ledger and inbox so one prospect's thread never crosses into
   another's. sendThreadReply answers from hi@thriveiii.com through the relay, carrying In-Reply-To and
   References plus a fresh Message-ID, and logs the outbound so it appears in the thread in order. */

// Who a thread reply goes to, in which language, and what message it threads onto. A spawned child
// answers its one named recipient; a single opportunity answers the address that actually replied,
// else its recorded recipient. Everything is read from THIS slug only: no cross-thread leak by design.
function replyTarget(slug){
  slug=String(slug||""); const o=getDraft(slug)||{};
  let addr="", name="", lang=(getLang()==="ar"?"ar":"en"), subject="", inReplyTo="", refs=[];
  const replies=inboundFor(slug).filter(r=>r && r.kind!=="auto")
    .sort((a,b)=> String(a.ts)<String(b.ts)?1:-1);
  if(replies.length){
    const r0=replies[0];
    addr=String(r0.from||"").trim(); name=String(r0.name||"").trim(); subject=r0.subject||"";
    const rid=String(r0.messageId||r0.mid||"").trim(); if(rid) inReplyTo=rid.replace(/^<|>$/g,"");
    (inReplyIds(r0)||[]).forEach(x=>refs.push(String(x).replace(/^<|>$/g,"")));
  }
  if(o.spawned_from && o.spawned_from.addr){ addr=String(o.spawned_from.addr).trim(); if(!name) name=String(o.spawned_from.name||"").trim(); }
  if(!addr){ const recs=campaignRecipients(o); if(recs && recs.length){ addr=String(recs[0].addr||"").trim(); if(!name) name=String(recs[0].name||"").trim(); } }
  const rec=(campaignRecipients(o)||[]).find(x=> String(x.addr||"").trim().toLowerCase()===addr.toLowerCase());
  if(rec && rec.lang){ lang=(rec.lang==="ar"?"ar":"en"); }
  else if(/[\u0600-\u06FF]/.test(subject)) lang="ar";
  if(!inReplyTo){
    const sends=getMailLog().filter(m=> m && m.opp===slug && m.direction!=="in" && m.msgid)
      .sort((a,b)=> String(a.ts)<String(b.ts)?1:-1);
    if(sends.length) inReplyTo=String(sends[0].msgid||"").replace(/^<|>$/g,"");
  }
  return { addr:addr, name:name, lang:lang, subject:subject, inReplyTo:inReplyTo, refs:refs };
}

// A greeting and a closing in the RECIPIENT's language (not the UI language), so the operator writes
// the middle. Message content, so it is composed here rather than through the UI dictionary.
function replyGreeting(tgt){
  const ar=(tgt && tgt.lang==="ar"); const nm=(tgt && tgt.name)? (" "+String(tgt.name).trim()) : "";
  const hi = ar ? ("مرحبًا"+nm+"،") : ("Hi"+nm+",");
  // R14 (P20): no sign-off scaffolded into the reply body - the signature is appended ONCE by compile, so a
  // hand-typed "Best, Thrive Digital Solutions" here would be the second closing. Just the greeting and room.
  return hi+"\n\n";
}

// The thread as HTML: each message escaped and isolated in its own direction. Pure and testable.
/* A reply body renders with every LINE direction-isolated, so a mixed line, the worst case being a Gmail
   quote header (an Arabic date, a Latin sender and address, a URL, angle brackets, all in one line), reads
   in order instead of being reordered by the bidi algorithm into a scramble. Rendering only: every piece
   passes through esc first, so the #99 XSS guarantee holds unchanged; then embedded URLs and email
   addresses are wrapped in <bdi> so they stay left-to-right inside an Arabic line and wrap instead of
   overflowing, and a leading bracket or the trailing one sits outside the isolated run, on the correct
   side. A quoted line (a leading ">" or a "wrote:" header) renders as a quieter block. */
/* A "left-to-right run" is a URL, an email address, OR a bare domain (a host with a real TLD, with an
   optional path): each is a Latin run that MUST be isolated, because a bare "console.thriveiii.com" inside
   an Arabic line reorders and collides exactly as a full URL does. The scheme URL, the www URL and the email
   are tried first so they win; the bare-domain alternative is last, so it only catches what the earlier ones
   did not. Ordinary Latin words carry no dot and no @, so they are left to the line's own dir="auto". */
var RE_REPLY_TOKEN=/(https?:\/\/[^\s]+|www\.[^\s]+|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+|[a-zA-Z0-9][a-zA-Z0-9\-]*(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
function renderReplyLine(raw){
  var out="", last=0, m; RE_REPLY_TOKEN.lastIndex=0;
  while((m=RE_REPLY_TOKEN.exec(raw))){
    out+=esc(raw.slice(last, m.index));
    var tok=m[0], lead="", trail="";
    while(/^[<«("'\[]/.test(tok)){ lead+=tok.charAt(0); tok=tok.slice(1); }         // a bracket belongs outside the run
    while(tok && /[)\]>»,.;:،!؟"']$/.test(tok)){ trail=tok.slice(-1)+trail; tok=tok.slice(0,-1); }
    out+=esc(lead)+(tok? '<bdi class="rp-ltr">'+esc(tok)+'</bdi>' : "")+esc(trail);
    last=m.index+m[0].length;
  }
  out+=esc(raw.slice(last));
  return out;
}
function isQuotedLine(raw){
  var s=String(raw==null?"":raw);
  if(/^\s*>/.test(s)) return true;                            // a quoted line
  if(/(?:wrote|كتب)\s*:\s*$/i.test(s)) return true;           // a "...wrote:" header ending in a colon
  // A Gmail quote header opens with "On <date> ... wrote:" or the Arabic "في <date> ... كتب ...". \b is not
  // used: it keys on \w, so it never fires after an Arabic word; the opener plus the verb is the signal.
  if(/^\s*(?:On\s|في\s|بتاريخ\s)/i.test(s) && /(?:wrote|كتب)/i.test(s)) return true;
  return false;
}
function renderReplyBody(text){
  var lines=String(text==null?"":text).split(/\r?\n/);
  return lines.map(function(raw){
    var inner=renderReplyLine(raw);                          // an empty line keeps its height via .rp-line:empty
    return '<span class="rp-line'+(isQuotedLine(raw)?" rp-quote":"")+'" dir="auto">'+inner+'</span>';
  }).join("");
}

/* ---- the thread grows up: parse the reply into typed blocks, then render each in its own layout ----
   Per-line isolation (renderReplyBody) sets a base direction per line, but it cannot ORDER a single
   physical line that mixes right-to-left and left-to-right runs. Basel's Gmail quote header is exactly
   that: "في <arabic date>، كتب <Latin name> <address>:" arrives as ONE line, and the bidi algorithm
   reorders the Arabic date, the Latin name and the address into an unreadable scramble no line-level dir
   can fix. The structural answer is to stop rendering that raw run at all: parse the header into its
   parts and RECOMPOSE it from isolated pieces, so the bidi problem disappears by construction.

   Everything here is derivation at RENDER time only: the stored body is never rewritten, and every part
   still passes through esc before it reaches the DOM, so the #99 XSS guarantee holds unchanged. The
   parser works on text (split lines, match patterns), never on injected HTML. On any body it cannot
   structure - an exotic header it cannot parse, or a plain message with no quote - it returns null and
   the caller falls back to the per-line isolated rendering, so the result is never worse than today. */
function isQuoteHeaderLine(raw){
  var s=String(raw==null?"":raw);
  // The opener plus the verb is the signal. \b is avoided (it keys on \w and never fires after Arabic).
  if(/^\s*(?:On\s|في\s|بتاريخ\s)/i.test(s) && /(?:wrote|كتب)/i.test(s)) return true;
  if(/(?:wrote|كتب)\s*:\s*$/i.test(s)) return true;
  return false;
}
/* Split the "On <date>, <name> <address> wrote:" header (English) or "في <date>، كتب <name> <address>:"
   header (Arabic) into its parts, tolerant of the date carrying its own commas and the word في. Returns
   null when the line is header-shaped but does not parse, so the caller degrades to full isolation. */
function parseQuoteHeader(line){
  var s=String(line==null?"":line).trim();
  // The date is captured GREEDILY: a Gmail date carries its own commas ("Mon, Aug 3, 2026 at 9:37 PM"),
  // so the separator before the name is the LAST comma before "<name> <address>", not the first. The name
  // is then lazy up to the address. Arabic mirrors this with "، كتب" as the separator.
  var m=/^On\s+(.+),\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*wrote\s*:?\.?$/i.exec(s);
  if(m) return { lang:"en", lead:"On", verb:"wrote", date:m[1].trim(), name:m[2].trim(), address:m[3].trim() };
  m=/^(في|بتاريخ)\s+(.+)،\s*كتب\s+(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*:?\.?$/.exec(s);
  if(m) return { lang:"ar", lead:m[1], verb:"كتب", date:m[2].trim(), name:m[3].trim(), address:m[4].trim() };
  // Tolerant fallbacks: an address with no angle brackets (still one clean recomposition).
  m=/^On\s+(.+),\s*(.+?)\s*(\S+@\S+\.\S+)\s*wrote\s*:?\.?$/i.exec(s);
  if(m) return { lang:"en", lead:"On", verb:"wrote", date:m[1].trim(), name:m[2].trim(), address:m[3].trim() };
  m=/^(في|بتاريخ)\s+(.+)،\s*كتب\s+(.+?)\s*(\S+@\S+\.\S+)\s*:?\.?$/.exec(s);
  if(m) return { lang:"ar", lead:m[1], verb:"كتب", date:m[2].trim(), name:m[3].trim(), address:m[4].trim() };
  return null;
}
/* The first line that begins the quoted original, or -1 when the body is all new text. Beyond the classic
   ">" prefix and the Gmail/Arabic "wrote:" / "كتب:" header, this recognises the two quote styles that carry
   NEITHER marker and were the "full original dumped" break: the Outlook field block (a From: / المرسل: line
   immediately leading a Sent/To/Subject field, and their Arabic equivalents) and the separator rules
   ("-----Original Message-----", a forwarded-message banner, a long dash or underscore rule). Finding the
   boundary is what lets the original always land in the collapsed block instead of flat under the answer. */
function quoteStartIndex(lines){
  for(var i=0;i<lines.length;i++){
    var s=String(lines[i]==null?"":lines[i]);
    if(/^\s*>/.test(s)) return i;                                   // a classic quoted line
    if(isQuoteHeaderLine(s)) return i;                              // "On <date> ... wrote:" / "في <date> ... كتب"
    if(/^\s*-{3,}\s*(?:original message|forwarded message|الرسالة الأصلية|رسالة (?:معاد|مُعاد))/i.test(s)) return i;
    if(/^\s*[-_]{5,}\s*$/.test(s)) return i;                        // a long dash or underscore rule (Outlook)
    // The Outlook field block: a From: / المرسل: line that immediately leads a Sent/To/Subject field.
    if(/^\s*(?:from|من|المرسل)\s*:\s*\S/i.test(s)){
      for(var j=i+1;j<Math.min(lines.length,i+5);j++){
        if(/^\s*(?:sent|date|to|cc|subject|أُرسلت|أرسلت|التاريخ|إلى|نسخة|الموضوع)\s*:/i.test(String(lines[j]==null?"":lines[j]))) return i;
      }
    }
  }
  return -1;
}
/* Parse a reply body into ordered typed blocks. Returns null unless it produced a real quote structure
   (a parsed header or quoted history), so a plain single-direction message renders exactly as before. */
function parseReplyBody(text){
  var lines=String(text==null?"":text).split(/\r?\n/), n=lines.length, blocks=[];
  var qs=quoteStartIndex(lines); if(qs<0) qs=n;
  // 1) the new message: everything before the quoted original begins.
  var msg=lines.slice(0, qs);
  while(msg.length && !msg[msg.length-1].trim()) msg.pop();
  // A signature block (an "-- " sig delimiter inside the message) is split off and muted.
  var sig=null, sd=-1;
  for(var k=0;k<msg.length;k++){ if(/^\s*--\s*$/.test(msg[k])){ sd=k; break; } }
  if(sd>=0){ sig=msg.slice(sd+1).join("\n"); msg=msg.slice(0,sd); while(msg.length && !msg[msg.length-1].trim()) msg.pop(); }
  if(msg.join("\n").trim()) blocks.push({ type:"message", text:msg.join("\n") });
  var structured=false, i=qs;
  // 2) a recomposable Gmail/Arabic header at the boundary, rebuilt from isolated parts. An unparsable header
  //    shape (or an Outlook/separator boundary) is NOT an abort: it is left for the quoted-history block
  //    below, so the answer still reads first and the original is still separated in the collapsible quote,
  //    never rendered as one flat tangle of answer + header + quote.
  if(i<n && isQuoteHeaderLine(lines[i])){
    var hp=parseQuoteHeader(lines[i]);
    if(hp){ blocks.push({ type:"quoteHeader", parts:hp }); structured=true; i++; }
  }
  // 3) the quoted history: the remaining lines, one leading "> " stripped, as a quiet collapsible block.
  var hist=[];
  for(; i<n; i++){ hist.push(String(lines[i]==null?"":lines[i]).replace(/^\s?>\s?/, "")); }
  while(hist.length && !hist[0].trim()) hist.shift();
  while(hist.length && !hist[hist.length-1].trim()) hist.pop();
  if(hist.length){ blocks.push({ type:"quote", text:hist.join("\n") }); structured=true; }
  if(sig && sig.trim()) blocks.push({ type:"signature", text:sig });
  return structured ? blocks : null;
}
/* Recompose the quote header as a clean line from isolated parts. Each variable part (date, name,
   address) is its own <bdi>, so the container's direction orders the SIBLINGS in DOM order and no part
   can bidi-reorder against another: the scramble is gone by construction. dir="auto" lets the header take
   the base direction of its own language (Arabic or English) with no branch. Every part is escaped. */
function renderQuoteHeader(pt){
  var date = '<bdi class="rp-qh-date">'+esc(pt.date)+'</bdi>';
  var name = pt.name ? '<bdi class="rp-qh-name">'+esc(pt.name)+'</bdi>' : '';
  var addr = pt.address ? '<bdi class="rp-qh-addr rp-ltr">'+esc(pt.address)+'</bdi>' : '';
  var lead = '<span class="rp-qh-t">'+esc(pt.lead)+' </span>';
  var inner;
  if(pt.lang==="ar"){
    inner = lead+date+'<span class="rp-qh-t">، '+esc(pt.verb)+' </span>'+name+(name&&addr?' ':'')+addr;
  } else {
    inner = lead+date+'<span class="rp-qh-t">, </span>'+name+(name&&addr?' ':'')+addr+'<span class="rp-qh-t"> '+esc(pt.verb)+':</span>';
  }
  return '<div class="rp-qhead" dir="auto">'+inner+'</div>';
}
/* The thread body, structured. A parsed body renders block by block; an unstructured or exotic body
   falls straight back to the per-line isolated rendering (never worse than today), losing no content. */
function renderReplyBodyStructured(text){
  var blocks=parseReplyBody(text);
  if(!blocks) return renderReplyBody(text);
  return blocks.map(function(bk){
    if(bk.type==="message")   return '<div class="rp-msg">'+renderReplyBody(bk.text)+'</div>';
    if(bk.type==="signature") return '<div class="rp-sig">'+renderReplyBody(bk.text)+'</div>';
    if(bk.type==="quoteHeader") return renderQuoteHeader(bk.parts);
    // quoted history: a quieter, indented, collapsible section, still per-line direction-correct inside.
    return '<details class="rp-quoted"><summary class="rp-quoted-sum">'+esc(t("rp_quoted_history"))+
      '</summary><div class="rp-quoted-body">'+renderReplyBody(bk.text)+'</div></details>';
  }).join("");
}
/* ---- R10 · the message model: one named shape, read once, used everywhere ----------------------------
   The thread once collapsed a message into an undifferentiated blob and the renderer guessed at it: the
   subject was shown as the body, the real body was buried inside the quoted reply, and an outbound send
   carried no body at all. The cure is a message OBJECT with named fields. Every message - our send, their
   reply - is read once into this shape and every surface reads its fields; nothing re-parses a blob
   downstream (the one-source law, applied to messages).

     { time, from, fromAddr, to, toAddr, subject, body, quoted, direction }

   splitReplyBody separates the new text from the quoted original ONCE, with the same quote detector the
   renderer already uses (quoteStartIndex), so the "On <date> X wrote:" header and everything below it is
   `quoted`, never `body`, and the subject (a distinct field) is never mistaken for either. Outbound reads
   the compiled body the ledger already stored (m.preview / m.body); a message with no body carries body:""
   and its zone is simply omitted, never faked. Pure derivation: the stored row is never rewritten. */
function splitReplyBody(text){
  var raw=String(text==null?"":text);
  var lines=raw.split(/\r?\n/);
  var qs=quoteStartIndex(lines);
  if(qs<0) return { body:raw.replace(/\s+$/,""), quoted:"" };   // all new text, no quoted original
  var body=lines.slice(0,qs).join("\n").replace(/\s+$/,"");
  var quoted=lines.slice(qs).join("\n").replace(/^\s+|\s+$/g,"");
  return { body:body, quoted:quoted };
}
function buildMessage(e){
  if(!e) return null;
  var out=(e.kind==="sent");
  var raw=out ? (e.body!=null? e.body : (e.preview||"")) : (e.snippet||"");
  var sp=splitReplyBody(raw);
  return {
    direction: out ? "out" : "in",
    time: e.ts,
    from: out ? getFromName() : (e.from||t("th_someone")),
    fromAddr: out ? FROM_EMAIL : (e.fromAddr||""),
    to: out ? (e.toName||e.to||"") : getFromName(),
    toAddr: out ? (e.to||"") : FROM_EMAIL,
    subject: e.subject||"",
    body: sp.body,
    quoted: sp.quoted
  };
}
/* The header line reads sender, then recipient, so who wrote to whom is never in doubt. Each name is its
   own direction-isolated part (dir="auto"), the recipient quietly muted behind one localized "to" label,
   so an Arabic name and a Latin name never reorder against each other and the line reads the same in both
   languages. */
function msgWhoLine(msg){
  var from='<span class="msg-from" dir="auto">'+esc(msg.from)+'</span>';
  var to=msg.to ? ' <span class="msg-to"><span class="msg-to-t">'+esc(t("th_to"))+'</span> <bdi dir="auto">'+esc(msg.to)+'</bdi></span>' : '';
  return from+to;
}
/* The body zone from the model: the answer as its own block, then the quoted prior thread as a quiet
   collapsible section beneath it, recomposed from isolated parts so a mixed-direction quote header never
   scrambles. Both are absent-tolerant: no body, no block; no quote, no section. One renderer, one path. */
function renderQuotedSection(quoted){
  var raw=String(quoted==null?"":quoted); if(!raw.trim()) return "";
  var lines=raw.split(/\r?\n/), head="", rest=lines;
  if(lines.length && isQuoteHeaderLine(lines[0])){
    var hp=parseQuoteHeader(lines[0]);
    if(hp){ head=renderQuoteHeader(hp); rest=lines.slice(1); }
  }
  var hist=rest.map(function(x){ return String(x==null?"":x).replace(/^\s?>\s?/,""); });
  while(hist.length && !hist[0].trim()) hist.shift();
  while(hist.length && !hist[hist.length-1].trim()) hist.pop();
  var inner=head+(hist.length? '<div class="rp-quoted-body">'+renderReplyBody(hist.join("\n"))+'</div>' : '');
  if(!inner) return "";
  return '<details class="rp-quoted"><summary class="rp-quoted-sum">'+esc(t("rp_quoted_history"))+'</summary>'+inner+'</details>';
}
function renderMessageBody(msg){
  if(!msg) return "";
  var parts="";
  if(msg.body && msg.body.trim()) parts+='<div class="rp-snip" dir="auto">'+renderReplyBody(msg.body)+'</div>';
  parts+=renderQuotedSection(msg.quoted);
  return parts;
}
/* The rendered thread self-identifies. This marker is painted in a corner of the History conversation the
   moment it opens, analogous to the build stamp but scoped to THIS component, so it is obvious on device
   whether the current renderer is the one on screen. It exists because the conversation view once appeared
   unchanged across fixes and the only way to be certain WHICH renderer is mounted is to have it announce
   itself. There is exactly one card-History renderer (threadListHtml, mounted by renderHistory into
   #modalHistory); bump this string whenever the thread renderer is rebuilt, so a stale copy is unmissable. */
var THREAD_RENDERER_VERSION="v2";
function threadRendererTag(){ return "thread "+THREAD_RENDERER_VERSION; }
/* Runtime proof of the mounted renderer. Walks the OPEN History DOM (#modalHistory) and reports: the marker
   text, the container's declared renderer, the count of msgBubble bubbles, and - the decisive check - which
   leaf element actually holds the reply's on-screen text ("Open in Gmail" / "matched by the subject") and
   which data-renderer owns it. If a second render path ever mounts, the reply text will resolve to a
   container this renderer did not stamp, and that shows here instead of being guessed from source. Exposed as
   a global and logged on every History render, so the truth is one console line on device. Pure read. */
function threadRendererReport(){
  var box=(typeof document!=="undefined") && document.getElementById("modalHistory");
  if(!box) return { mounted:false };
  var needles=[]; try{ needles=[t("rp_open_gmail"), t("rp_rule_subject")].filter(Boolean); }catch(e){}
  var holder=null, all=box.querySelectorAll("*");
  for(var i=0;i<all.length && !holder;i++){
    var elx=all[i]; if(elx.childElementCount!==0) continue;             // leaf elements only
    var txt=elx.textContent||"";
    for(var k=0;k<needles.length;k++){ if(txt.indexOf(needles[k])>=0){ holder=elx; break; } }
  }
  var owner="(none)"; if(holder){ var p=holder.closest("[data-renderer]"); owner=p? p.getAttribute("data-renderer") : "(no data-renderer ancestor)"; }
  return {
    mounted:true,
    marker: ((box.querySelector(".th-ver")||{}).textContent||"").trim(),
    historyRenderer: box.getAttribute("data-history-renderer")||"(unstamped)",
    listRenderer: box.querySelector('[data-renderer="activityTrailHtml"]') ? "activityTrailHtml@library/app.js"
      : (box.querySelector('[data-renderer="threadListHtml"]') ? "threadListHtml@library/app.js" : "(no list container)"),
    bubbles: box.querySelectorAll('[data-bubble="msgBubble"]').length,
    replyTextOwner: owner
  };
}
if(typeof window!=="undefined") window.threadRendererReport=threadRendererReport;
/* ---------- P21: the ONE message-bubble render path ----------
   The full message bubble (our send, their reply) reads from the R10 message model (buildMessage +
   renderMessageBody + msgWhoLine). It is defined ONCE here at module scope, so the conversation thread
   (threadListHtml) AND the activity trail's inline expansion (activityTrailHtml) render a message through
   the exact same code - renderMessageBody has these two call sites and no other. No copy. */
function thWhen(ts){ return fmtWhenHtml(ts) || esc(String(ts==null?"":ts)); }   // isolated date markup (bdi), never LTR-forced
// ONE bubble component. Our send and their reply share one header/body/foot skeleton and differ only by side.
function thMsgBubble(o){
  var isOut=o.side==="out";
  var cardCls=isOut ? "msg-out" : ("rp-card"+(o.latest?" is-latest":""));
  var bodyInner=(o.subjHtml||"")+(o.bodyHtml||"");
  return '<li class="'+(isOut?"th-sent":"th-reply")+'" data-bubble="msgBubble"'+(o.rid? ' data-rid="'+esc(o.rid)+'"' : '')+'>'+
    '<div class="'+cardCls+'">'+
      '<div class="rp-head">'+
        '<div class="rp-top">'+(o.leadHtml||"")+
          '<span class="rp-who" dir="auto">'+o.whoHtml+'</span>'+
          '<span class="rp-when">'+thWhen(o.ts)+'</span>'+
        '</div>'+
        (o.addr? '<div class="rp-from mono">'+ltr(esc(o.addr))+'</div>' : '')+
      '</div>'+
      (bodyInner ? '<div class="rp-body">'+bodyInner+'</div>' : '')+
      (o.footHtml ? '<div class="rp-foot">'+o.footHtml+'</div>' : '')+
    '</div></li>';
}
// A send is our side: the outgoing bubble from the R10 model. The header names sender then recipient; the
// subject is its OWN emphasized line (never the body); the compiled body is its own block beneath it.
function thSentBubble(e){
  var msg=buildMessage(e);
  return thMsgBubble({ side:"out", ts:msg.time, addr:msg.toAddr,
    whoHtml: msgWhoLine(msg),
    subjHtml: (msg.subject? '<div class="rp-subj" dir="auto">'+esc(msg.subject)+'</div>' : ''),
    bodyHtml: renderMessageBody(msg)+(e.channel? '<div class="rp-chan"><span class="th-chan">'+esc(e.channel)+'</span></div>' : '') });
}
// Their reply is the incoming bubble through the SAME builder: lead is the #N and latest mark, body is the
// subject then the structured answer (new text first, quoted original collapsed), foot the rule and Gmail link.
function thReplyBubble(r, slug){
  var repNum={}, __repMax=0; repliesForOpp(slug).forEach(function(x){ repNum[x.addr]=x.num; if(x.num>__repMax) __repMax=x.num; });
  var rn=repNum[String(r.from||"").trim().toLowerCase()];
  var latest=(rn && __repMax>1 && rn===__repMax);   // the newest reply is marked only when there is more than one
  var msg=buildMessage(r);
  return thMsgBubble({ side:"in", rid:r.id||"", latest:latest, ts:msg.time, addr:msg.fromAddr,
    leadHtml: (rn? '<span class="rp-num">#'+esc(String(rn))+'</span>' : '')+
              (latest? '<span class="rp-latest">'+esc(t("rp_latest"))+'</span>' : ''),
    whoHtml: msgWhoLine(msg),
    subjHtml: (msg.subject? '<div class="rp-subj" dir="auto">'+esc(msg.subject)+'</div>' : ''),
    bodyHtml: renderMessageBody(msg),
    footHtml: replyBasisHtml(r)+
              (r.ambiguous? '<span class="rp-ambig" data-icon="alert">'+esc(t("rp_ambiguous"))+'</span>' : '')+
              (r.gmail? '<a class="btn ghost sm" href="'+esc(r.gmail)+'" target="_blank" rel="noopener">'+ic("link")+esc(t("rp_open_gmail"))+'</a>' : '') });
}

/* How this reply was joined to its opportunity, shown from the ONE derivation (ThriveInbound.joinBasis)
   so the board, the thread and the tests read one answer. A DETERMINISTIC basis (plus-address, references,
   a hand attachment) shows inline with a certain mark; a HEURISTIC basis (sender, subject) is a tap-open
   disclosure that names itself a guess, so an operator sees at a glance which replies are certain. */
function replyBasisHtml(r){
  var jb=(typeof ThriveInbound!=="undefined" && ThriveInbound.joinBasis) ? ThriveInbound.joinBasis(r) : null;
  if(!jb || jb.basis==="unresolved") return jb ? '<span class="rp-basis is-none">'+esc(t("basis_unresolved"))+'</span>' : '';
  var lbl=t("basis_"+jb.basis.replace(/-/g,"_"));
  if(jb.deterministic) return '<span class="rp-basis is-det" title="'+esc(t("basis_certain"))+'">'+ic("check")+'<span>'+esc(lbl)+'</span></span>';
  return '<details class="rp-basis is-heur"><summary>'+ic("alert")+'<span>'+esc(lbl)+'</span></summary>'+
         '<span class="rp-basis-why" dir="auto">'+esc(t("basis_heuristic_why"))+'</span></details>';
}
function threadListHtml(slug){
  const entries=buildThread(slug);
  const when=thWhen;
  const label=a=>{ const k="act_"+a; const v=t(k); return v===k? a : v; };
  if(!entries.length) return '<div class="mw-empty">'+ic("clock")+'<p>'+esc(t("mw_hist_empty"))+'</p></div>';
  function line(icn, what, detail, ts){
    return '<li class="th-line"><span class="th-icn">'+ic(icn)+'</span>'+
      '<span class="th-what">'+esc(what)+'</span>'+
      (detail? '<span class="th-detail" dir="auto">'+detail+'</span>':'')+
      '<span class="th-when">'+when(ts)+'</span></li>';
  }
  const sentCard=e=>thSentBubble(e);
  const replyCard=r=>thReplyBubble(r, slug);
  // Runtime self-identification: the conversation list names the exact function and file that built it, so
  // the mounted renderer can be read straight off the DOM on device (the proof that ends fixing a blind copy).
  let html='<ol class="th-list" data-renderer="threadListHtml" data-file="library/app.js">', lastCh=0;
  entries.forEach(e=>{
    const ch=e.chapter||1;
    if(lastCh && ch>lastCh) html+='<li class="th-chapter"><span>'+esc(t("th_chapter_"+(ch===2?"offer":"more")))+'</span></li>';
    if(ch>lastCh) lastCh=ch;
    if(e.kind==="sent") html+=sentCard(e);
    else if(e.kind==="open") html+=line("globe", t("th_opened"), "", e.ts);
    else if(e.kind==="reply") html+=replyCard(e);
    else if(e.kind==="auto") html+=line("alert", t(e.bounce==="hard"?"rp_bounce_hard":e.bounce==="soft"?"rp_bounce_soft":"rp_auto"), "", e.ts);
    else if(e.kind==="act") html+=line("clock", label(e.action), e.detail? '<span dir="auto">'+esc(e.detail)+'</span>':"", e.ts);
  });
  return html+'</ol>';
}

/* ---------- P21 · R15: the card activity trail ----------
   The card's memory of what happened to it: who edited, who sent, when, what changed. It is one merged,
   newest-first list. Sends and replies are DERIVED from the ledger (never a second stored row); a legacy
   'email' activity row is dropped here so a send is represented exactly once. Only genuinely new operations
   (edit, save, page upload, contact confirmed, merge, archive, restore) are stored as activity rows. */
var ACT_DERIVED={ email:1 };                 // a send is a ledger event: its activity row (if any legacy exists) is dropped
var ACT_ICON={ draft_save:"edit", edit:"edit", upload:"page", page:"page", activate:"globe",
  contact:"channel", merge:"link", archive:"archive", restore:"undo", rematch:"link", attach:"link", attach_add:"link", clear:"trash" };
function cardActivity(slug){
  slug=String(slug||"");
  var entries=buildThread(slug).filter(function(e){
    return !(e && e.kind==="act" && ACT_DERIVED[e.action]);   // never double-store a ledger event as an activity row
  });
  return entries.slice().sort(function(x,y){ var dx=tsMs(x.ts)||0, dy=tsMs(y.ts)||0; return dy-dx; });  // newest-first
}
/* Render the trail, quiet typography, no chrome. A send or reply is a tappable entry that expands IN PLACE
   to the full message, rendered through the ONE P12 path (thSentBubble / thReplyBubble) - never a copy, and
   never a second surface. Every entry carries its actor and time. */
function activityTrailHtml(slug){
  slug=String(slug||"");
  var entries=cardActivity(slug);
  var label=function(a){ var k="act_"+a; var v=t(k); return v===k? a : v; };
  var opName=function(uid){ try{ return resolveOperator(uid)||""; }catch(e){ return ""; } };
  if(!entries.length) return '<div class="mw-empty">'+ic("clock")+'<p>'+esc(t("mw_hist_empty"))+'</p></div>';
  function metaHtml(who, ts){
    return '<span class="tr-meta">'+
      (who? '<span class="tr-actor" dir="auto">'+esc(who)+'</span>' : '')+
      '<span class="tr-when">'+thWhen(ts)+'</span></span>';
  }
  function quiet(icn, what, sum, who, ts){
    return '<li class="tr-item tr-line"><span class="tr-icn">'+ic(icn)+'</span>'+
      '<span class="tr-what">'+esc(what)+(sum? ' <span class="tr-sum" dir="auto">'+esc(sum)+'</span>' : '')+'</span>'+
      metaHtml(who, ts)+'</li>';
  }
  function msgRow(kind, iconName, what, sum, who, ts, bubbleHtml){
    return '<li class="tr-item tr-msg" data-tr="'+kind+'">'+
      '<button type="button" class="tr-head" aria-expanded="false">'+
        '<span class="tr-icn">'+ic(iconName)+'</span>'+
        '<span class="tr-what">'+esc(what)+(sum? ' <span class="tr-sum" dir="auto">'+esc(sum)+'</span>' : '')+'</span>'+
        metaHtml(who, ts)+
        '<span class="tr-chev" aria-hidden="true">'+ic("chevron")+'</span>'+
      '</button>'+
      '<div class="tr-expand" hidden><ol class="th-list th-embed">'+bubbleHtml+'</ol></div>'+
    '</li>';
  }
  var html='<ol class="tr-list" data-renderer="activityTrailHtml" data-file="library/app.js">';
  entries.forEach(function(e){
    if(e.kind==="sent"){
      var to=(e.toName||e.to||"").trim();
      var sum=[to, e.subject].filter(Boolean).join(" · ");
      html+=msgRow("sent", "send", t("tr_sent"), sum, opName(e.actor), e.ts, thSentBubble(e));
    } else if(e.kind==="reply"){
      html+=msgRow("reply", "mail", t("tr_reply"), e.subject||"", (e.from||"").trim(), e.ts, thReplyBubble(e, slug));
    } else if(e.kind==="open"){
      html+=quiet("globe", t("th_opened"), "", "", e.ts);
    } else if(e.kind==="auto"){
      html+=quiet("alert", t(e.bounce==="hard"?"rp_bounce_hard":e.bounce==="soft"?"rp_bounce_soft":"rp_auto"), "", "", e.ts);
    } else if(e.kind==="act"){
      html+=quiet(ACT_ICON[e.action]||"clock", label(e.action), e.detail||"", opName(e.actor)||"", e.ts);
    }
  });
  return html+'</ol>';
}
if(typeof window!=="undefined"){ window.activityTrailHtml=activityTrailHtml; window.cardActivity=cardActivity; }
/* Wire the inline expand/collapse for the trail's message entries: tapping a header toggles its in-place
   expansion (the pre-rendered P12 bubble), one scroll, no modal. Idempotent per render. */
function wireActivityTrail(box){
  if(!box) return;
  var heads=box.querySelectorAll(".tr-msg > .tr-head");
  for(var i=0;i<heads.length;i++){ (function(btn){
    btn.addEventListener("click", function(){
      var item=btn.parentNode; var exp=item.querySelector(".tr-expand");
      var open=item.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open?"true":"false");
      if(exp) exp.hidden=!open;
    });
  })(heads[i]); }
}

/* Part 2: smooth reading. Scroll the thread to its newest message, so opening the conversation (or sending
   a reply) lands on the latest exchange rather than the first contact. Pulse it optionally, the same guiding
   flash a badge uses, so a fresh reply announces itself. Reduced motion is respected: the pulse degrades to a
   static outline (the .th-flash CSS), and the scroll drops its smooth easing. Pure DOM, safe when absent. */
function scrollThreadToNewest(pulse){
  var box=document.getElementById("modalHistory"); if(!box) return;
  var msgs=box.querySelectorAll(".th-sent, .th-reply");
  var last=msgs.length ? msgs[msgs.length-1] : null; if(!last) return;
  var reduce=false; try{ reduce=window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){}
  try{ last.scrollIntoView({ block:"nearest", behavior:(reduce?"auto":"smooth") }); }catch(e){ try{ last.scrollIntoView(); }catch(_){} }
  if(pulse){ last.classList.add("th-flash"); setTimeout(function(){ try{ last.classList.remove("th-flash"); }catch(_){} }, 2200); }
}
/* Part 2: one-tap inline reply. The instant Send is pressed, our reply appears at the foot of the thread as
   an outgoing bubble with a quiet "sending" marker, so the operator sees it land immediately without leaving
   the view. The confirmed-write path then re-renders the thread from the durable ledger (renderHistory),
   replacing this optimistic bubble with the real row (pending or sent) - or dropping it when the send truly
   failed, because buildThread excludes an unsent row, so a failure is never a phantom sent reply (the error
   is surfaced by the caller's toast, never swallowed). Pure DOM; returns the node or null. */
function threadOptimisticReply(text){
  var box=document.getElementById("modalHistory"); if(!box) return null;
  var list=box.querySelector(".th-list"); if(!list) return null;
  var li=document.createElement("li");
  li.className="th-sent th-opti";
  var bodyHtml=esc(String(text==null?"":text).trim()).split("\n").join("<br>");
  li.innerHTML='<div class="msg-out">'+
    '<div class="rp-head"><div class="rp-top">'+
      '<span class="rp-who" dir="auto">'+esc(t("cmp_sending"))+'</span>'+
    '</div></div>'+
    '<div class="rp-body"><div class="rp-snip" dir="auto">'+bodyHtml+'</div></div>'+
  '</div>';
  list.appendChild(li);
  scrollThreadToNewest(true);
  return li;
}

/* ---- the open discussion, rendered inside the card ----------------------------
   One list of comments, oldest first, each with its author's real name and the one date composer, one
   level of threaded replies grouped under their parent, and a calm composer at the foot. Every body is
   escaped (esc) and direction-isolated (dir="auto"), so an Arabic comment reads right-to-left with joined
   letters and a hostile body renders as text, never as HTML. Own comments carry edit and delete; anyone's
   comment can be replied to. A comment still in the Stage-4 queue wears an honest "queued" marker until it
   drains. This is a pure builder; initModal binds the controls and re-renders after each change. */
function discussionHtml(slug){
  var mine=currentActor();
  var all=(window.ThriveComments ? ThriveComments.list(slug) : []);
  var roots=all.filter(function(c){ return !c.parent_id; });
  var kids={}; all.forEach(function(c){ if(c.parent_id){ (kids[c.parent_id]=kids[c.parent_id]||[]).push(c); } });
  // Seed the name floor from the snapshot each comment already carries, so a real name shows even before
  // (or without) the cross-operator projection hydrates; the authoritative read then refreshes it.
  all.forEach(function(c){ operatorNameSeed(c.author, c.author_name); });
  function whenHtml(ts){ return fmtWhenHtml(ts) || esc(String(ts==null?"":ts)); }
  // The one resolver: a uid becomes a real name here, «زميل» only for a genuinely unknown operator.
  function who(c){ return esc(resolveOperator(c.author)); }
  function bubble(c, isReply){
    var own=c.author===mine, pend=(window.ThriveComments && ThriveComments.pending(c.id));
    return '<li class="dc-item'+(isReply?" dc-reply":"")+'" data-cid="'+esc(c.id)+'">'+
      '<div class="dc-bubble">'+
        '<div class="dc-head"><span class="dc-who" dir="auto">'+who(c)+'</span>'+
          '<span class="dc-when">'+whenHtml(c.created_at)+'</span>'+
          (pend? '<span class="dc-pending" data-icon="clock">'+esc(t("dc_queued"))+'</span>' : '')+'</div>'+
        '<div class="dc-body" dir="auto">'+esc(c.body)+'</div>'+
        '<div class="dc-foot">'+
          (isReply? '' : '<button type="button" class="dc-act dc-reply-btn" data-cid="'+esc(c.id)+'">'+esc(t("dc_reply"))+'</button>')+
          (own? '<button type="button" class="dc-act dc-edit-btn" data-cid="'+esc(c.id)+'">'+esc(t("dc_edit"))+'</button>'+
                '<button type="button" class="dc-act dc-del-btn" data-cid="'+esc(c.id)+'">'+esc(t("dc_delete"))+'</button>' : '')+
        '</div>'+
      '</div></li>';
  }
  var list;
  if(!all.length){
    list='<div class="mw-empty">'+ic("channel")+'<p>'+esc(t("dc_empty"))+'</p></div>';
  } else {
    list='<ol class="dc-list">';
    roots.forEach(function(r){
      list+=bubble(r,false);
      (kids[r.id]||[]).forEach(function(k){ list+=bubble(k,true); });
    });
    list+='</ol>';
  }
  var composer='<form class="dc-composer" data-slug="'+esc(slug)+'" autocomplete="off">'+
    '<div class="dc-replyto" hidden><span class="dc-replyto-txt"></span>'+
      '<button type="button" class="dc-replyto-x" aria-label="'+esc(t("dc_reply_cancel"))+'">'+ic("close")+'</button></div>'+
    '<textarea class="input dc-input" dir="auto" rows="3" placeholder="'+esc(t("dc_placeholder"))+'"></textarea>'+
    '<div class="dc-bar"><span class="dc-hint sub">'+esc(t("dc_open_note"))+'</span>'+
      '<button type="submit" class="btn sm dc-send">'+esc(t("dc_send"))+'</button></div>'+
    '<div class="dc-out" role="status"></div></form>';
  return '<section class="dc-wrap"><h3 class="dc-title">'+esc(t("mw_discussion"))+'</h3>'+list+composer+'</section>';
}
window.discussionHtml = discussionHtml;

// (Audit S4) The bare-textarea reply composer (replyComposerHtml / .th-reply-box) was retired: the thread
// reply is the SAME full send editor mounted in reply mode (initCompose), so there is one composer for one
// job. The orphaned builder and its CSS are removed. replyTarget + replyGreeting (its only real logic) stay
// and are exercised through the mounted editor and sendThreadReply.

// Send a reply into the thread through the relay. From hi@thriveiii.com, threaded by In-Reply-To /
// References and a fresh Message-ID, logged as an outbound send so buildThread shows it in order.
// Never touches another slug's ledger. Self-test sends only for the device gate; sends no outreach.
/* ---- the one hardened send, shared by outreach and the thread reply ---------
   Brief 01 hardened the OUTREACH send: a stable per-intent idempotency key (the relay forwards it to
   Resend, which dedupes, so a retried POST delivers at most once), a DURABLE pending row written BEFORE
   the POST (so a timeout never strands the intent), no blind retry, and the relay's true answer as the
   outcome. That hardening lived only inside the composer's click handler, so the thread reply ran its
   own bare route: it POSTed with none of it, so a stale relay's 404 surfaced raw in the composer and no
   durable row was left to reconcile, which means a retry could double-send. This is that core, extracted
   into ONE function both entry points call. It owns the mail-row lifecycle only; the DOM, the quota and
   the toasts stay with the caller. Returns { status, idem, msgid, id?, error?, banner? }, where status
   is "sent" (the relay accepted the email AND the server holds the ledger row - the write invariant),
   "sending" (the email is out but the server has not confirmed the row yet: a visible outbox, durably
   queued, reconciled to Sent the moment the write lands), "unsent" (a true, retryable failure, the card
   does not advance), "pending" (in flight after a timeout, reconciled on the next re-tap under the same
   key), or "duplicate" (a completed send, refused by name, no second POST). */
async function relaySend(intent){
  intent=intent||{};
  const ep=getEmailEndpoint();
  if(!ep) return { status:"unsent", error:t("cmp_no_ep"), noEp:true };
  const opp=String(intent.opp||""), to=String(intent.to||"");
  const subject=String(intent.subject||""), html=String(intent.html||""), text=String(intent.text||"");
  const idem=intent.idem || sendIdem(opp, to, subject, html);
  const msgid=intent.msgid || newMessageId();
  // A known-stale relay is refused BEFORE the POST, so a send never lands in a deployment whose shape it
  // does not match (the source of the 404). relayReady is true until a response has disagreed, so a first
  // send is never blocked by this; only a relay that already answered with the wrong version is refused.
  if(!relayReady()) return { status:"unsent", idem:idem, msgid:msgid, error:relayBannerText(), banner:true };
  const prior=findMailRowByIdem(idem);
  // A completed send never sends again: refused by name. A pending or failed prior is NOT refused;
  // re-tapping reconciles under the SAME key so the relay dedupes, never a second delivery.
  if(prior && prior.status==="sent" && getMailLog().some(m=> m && m.idem===idem && m.status==="sent"))
    return { status:"duplicate", idem:idem, msgid:prior.msgid||msgid, id:prior.id||"" };
  // The durable record, written BEFORE the POST.
  if(prior){ updateMailByIdem(idem, { status:"pending", ts:new Date().toISOString(), error:"" }); }
  else { logMail(Object.assign({ opp:opp, to:to, toName:intent.toName||"", subject:subject,
      preview:String(intent.preview!=null?intent.preview:text).slice(0,600), provider:"endpoint",
      status:"pending", idem:idem, msgid:msgid, chapter:(intent.chapter!=null?intent.chapter:1) }, intent.mailExtra||{})); }
  const headers=Object.assign({}, ThriveStore.outboundHeaders(opp), intent.headers||{}, { "Message-ID": msgid });
  const payload={ v:REQUIRED_RELAY, from:FROM_EMAIL, fromName:getFromName(), to:to, subject:subject,
    html:html, text:text, idempotencyKey:idem, headers:headers, slug:opp };
  // P23: the images that land as real attachments (each { filename, path }, a Storage URL the relay hands to
  // Resend to fetch, so this request stays small). Hosted-link images are already in the body, not here.
  if(intent.attachments && intent.attachments.length) payload.attachments=intent.attachments;
  try{
    const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"}, body:JSON.stringify(payload) });
    const txt=await r.text();
    let parsed=null; try{ parsed=JSON.parse(txt); }catch(_){}
    noteRelayVersion(parsed);
    // A failed send never leaves and never touches the server ledger (updateMailByIdemLocal, no mirror), so
    // the board can never show a phantom Sent for a send that did not go out.
    if(!r.ok){ updateMailByIdemLocal(idem, { status:"unsent", error:(r.status+" "+txt.slice(0,120)) }); return { status:"unsent", idem:idem, msgid:msgid, error:(r.status+" "+String(txt).slice(0,140)) }; }
    if(parsed && !relayReady()){ updateMailByIdemLocal(idem, { status:"unsent", error:"relay behind" }); return { status:"unsent", idem:idem, msgid:msgid, error:relayBannerText(), banner:true }; }
    if(parsed && parsed.ok===false){ updateMailByIdemLocal(idem, { status:"unsent", error:(parsed.error||"send failed") }); return { status:"unsent", idem:idem, msgid:msgid, error:(parsed.error||"send failed") }; }
    const id=parsed? (parsed.id||"") : "";
    // THE WRITE INVARIANT. The relay accepted the email; it is not "sent" until the SERVER holds the row.
    // Write it and AWAIT. An empty opp is refused at the write, so an unlinked self-test mints no phantom row.
    const confRow=Object.assign({}, findMailRowByIdem(idem)||{}, { status:"sent", id:id, error:"", opp:opp, idem:idem });
    const conf=await supaConfirmMail(confRow);
    if(conf.refused){ updateMailByIdemLocal(idem, { status:"unsent", error:"missing opp" }); return { status:"unsent", idem:idem, msgid:msgid, id:id, error:"missing opp" }; }
    // Reported sent when the server confirmed, OR no server is configured (local store IS the truth), OR the
    // operator is signed out (local mode: the board is not shown signed out, the row is durably queued and
    // confirms on the next sign-in). The 'sending' outbox is reserved for the production bug - a SIGNED-IN
    // operator whose confirmed write failed (offline / server error) - where the board reads the server view
    // and would otherwise show a phantom Sent; it graduates to Sent the moment the write lands.
    if(conf.confirmed || conf.noServer || conf.signedOut){ updateMailByIdemLocal(idem, { status:"sent", id:id, error:"" }); return { status:"sent", idem:idem, msgid:msgid, id:id }; }
    updateMailByIdemLocal(idem, { status:"sending", id:id, error:"", confirmPending:true, sending_since:Date.now() });
    return { status:"sending", idem:idem, msgid:msgid, id:id, unconfirmed:true, reason:(conf.error||"unconfirmed") };
  }catch(e){
    // A timeout was in flight and MAY have delivered: leave it pending, never assert failure, never
    // blind-retry. Any other throw is a known failure: mark it unsent so the card does not advance.
    if(e && e.timeout) return { status:"pending", idem:idem, msgid:msgid, timeout:true };
    const row=findMailRowByIdem(idem); if(row && row.status==="pending"){ updateMailByIdemLocal(idem, { status:"unsent", error:(e && e.message)||"send failed" }); }
    return { status:"unsent", idem:idem, msgid:msgid, error:(e && e.message)||"send failed" };
  }
}

/* A thread reply is one entry point into relaySend, carrying the thread's In-Reply-To / References and
   a fresh Message-ID, so it inherits the exact exactly-once, true-outcome guarantee the outreach send
   has. It no longer POSTs its own route. Returns the send result plus the thread fields the caller needs. */
async function sendThreadReply(slug, bodyText){
  slug=String(slug||"");
  if(!getEmailEndpoint()) throw new Error(t("th_reply_no_ep"));
  const tgt=replyTarget(slug); if(!tgt.addr) throw new Error(t("th_reply_no_addr"));
  const body=String(bodyText||"").trim(); if(!body) throw new Error(t("th_reply_empty"));
  const baseSubj=String(tgt.subject||"").trim();
  const subject=/^\s*(re|رد)\s*:/i.test(baseSubj) ? baseSubj : ("Re: "+(baseSubj||t("th_reply_subj_fallback")));
  const html='<div dir="'+(tgt.lang==="ar"?"rtl":"ltr")+'" style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap">'+
             esc(body).replace(/\n/g,"<br>")+'</div>';
  const replyHeaders={};
  if(tgt.inReplyTo){
    replyHeaders["In-Reply-To"]="<"+tgt.inReplyTo+">";
    const chain=(tgt.refs||[]).concat([tgt.inReplyTo]).filter(function(v,i,a){ return v && a.indexOf(v)===i; });
    replyHeaders["References"]=chain.map(x=>"<"+x+">").join(" ");
  }
  const res=await relaySend({ opp:slug, to:tgt.addr, toName:tgt.name, subject:subject, html:html, text:body,
    headers:replyHeaders, preview:body, chapter:activeChapter(slug) });
  if(res.status==="duplicate") return { ok:true, duplicate:true, to:tgt.addr, msgid:res.msgid, subject:subject };
  if(res.status==="pending")   return { ok:true, pending:true, to:tgt.addr, msgid:res.msgid, subject:subject };
  // 'sending' is a real dispatch (email out, server not yet confirmed), so it belongs in the thread like a
  // sent reply; the card's outbox marker carries the not-yet-confirmed state.
  if(res.status!=="sent" && res.status!=="sending") throw new Error(res.error||"send failed");
  logActivity("email", slug, tgt.addr+" · "+subject);
  return { ok:true, sending:(res.status==="sending"), to:tgt.addr, msgid:res.msgid, subject:subject };
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

/* ---------- P21: the per-user (actor-scoped) compose working-draft ----------
   An unsaved edit is private to its author: it is stored under compose_draft.byActor[actor] on the synced
   opportunity record, so a second operator opening the same card never sees another person's in-progress
   message, and each author's draft is restored for that author on return. Additive over the legacy flat
   compose_draft (still restored, once, for continuity), and it never touches another actor's slot. */
function composeDraftGet(opp, actor){
  var cd=opp && opp.compose_draft; if(!cd) return null;
  if(cd.byActor && typeof cd.byActor==="object") return cd.byActor[actor] || null;   // v2 per-actor map: own slot only
  // legacy flat draft (pre-multi-user, one operator): restore it as this actor's continuation
  if(cd.subject!==undefined || cd.body_html!==undefined || cd.to!==undefined || cd.name!==undefined) return cd;
  return null;
}
function composeDraftSet(slug, actor, draftOrNull){
  var opp=getDraft(slug)||{}; var cd=opp.compose_draft;
  var map=(cd && cd.byActor && typeof cd.byActor==="object") ? Object.assign({}, cd.byActor) : {};
  if(draftOrNull===null) delete map[actor]; else map[actor]=draftOrNull;   // touch only this actor's slot
  saveDraft({ slug:slug, compose_draft:{ byActor: map } });
}

async function initCompose(slugArg, opts){
  const el=id=>document.getElementById(id);
  const body=el("ebody");
  let recordBody=()=>{};                 // reassigned once the undo history is wired, below
  // Reply mode (the thread composer). The SAME editor, its formatting, templates and preview, scoped to a
  // thread: the recipient is the address that replied (not the opportunity's default contact), the subject
  // defaults to "Re: ...", the send carries In-Reply-To / References so it threads by header, and the whole
  // thing is transient (it never touches the outreach compose_draft, and a reply is not a page send so the
  // live gate does not apply). Set in the seed block below, read by the send and the gate. Outreach mode
  // (no opts.reply) is unchanged in every line.
  let replyCtx=null;
  const onSent=(opts && typeof opts.onSent==="function") ? opts.onSent : null;
  const params=viewParams();
  const slug=(slugArg!==undefined&&slugArg!==null&&slugArg!=="")?slugArg:params.get("slug");
  const oppUrl = slug ? liveUrl(slug) : "";

  /* ---- P23: attachments (images from the device) --------------------------------------------------
     The composer's attachment list. Each entry is an ALREADY-UPLOADED image, stored in Supabase Storage
     (console-attachments) and referenced by URL, never base64-inlined: { key, name, type, size, url,
     path }. editorContent hands this exact list to the ONE compile(), which decides per size how each
     lands (a real attachment, a hosted link, or refused with the number), so the strip below and the
     preview show precisely what the recipient receives. The list is persisted under compose_draft (per
     author) so a reopen restores it. */
  let composeAttachments = [];
  let __attachKeyN = 0;
  function attachmentsForContent(){
    return composeAttachments.map(function(a){ return { filename:a.name, url:a.url, size:a.size, contentType:a.type }; });
  }
  // Test hook: seed the attachment list without a real upload (the sandbox cannot reach Storage), so the
  // parity proof drives the SAME composeAttachments through both live builders (editorContent + campaignTpl).
  try{ window.__seedComposeAttachments=function(list){ composeAttachments=(list||[]).map(function(a){ return { key:a.key||("a"+(++__attachKeyN)), name:a.name||a.filename||"image", type:a.type||a.contentType||"", size:Number(a.size)||0, url:a.url, path:a.path||"" }; }); renderAttachStrip(); }; }catch(_){}
  function attachTotalBytes(){ return composeAttachments.reduce(function(s,a){ return s+(Number(a.size)||0); }, 0); }
  function attachMB(bytes){ return (Math.round((Number(bytes)||0)/1048576*10)/10).toFixed(1); }   // Western numerals, one decimal
  // How this image will land, decided by the SAME thresholds compile() uses, so the label never lies.
  function attachLandingLabel(a){ return (Number(a.size)||0) <= ATTACH_INLINE_MAX ? t("cmp_att_attached") : t("cmp_att_hosted"); }
  function renderAttachStrip(){
    const host=el("eattach"); if(!host) return;
    if(!composeAttachments.length){ host.hidden=true; host.innerHTML=""; return; }
    host.hidden=false;
    host.innerHTML='<div class="eattach-h">'+esc(t("cmp_att_h"))+' <span class="pill"><bdi class="n">'+nIso(composeAttachments.length)+'</bdi></span></div>'+
      composeAttachments.map(function(a){
        return '<div class="eatt-item"><img class="eatt-thumb" src="'+esc(a.url)+'" alt="" loading="lazy">'+
          '<div class="eatt-info"><span class="eatt-name" dir="auto">'+esc(a.name)+'</span>'+
          '<span class="eatt-meta"><span class="tag tag-plain">'+esc(attachLandingLabel(a))+'</span> '+
          '<span class="eatt-size"><bdi class="n">'+nIso(attachMB(a.size))+'</bdi> '+esc(t("cmp_att_mb"))+'</span></span></div>'+
          '<button type="button" class="btn ghost sm danger eatt-rm" data-rm="'+esc(a.key)+'">'+esc(t("cmp_link_remove"))+'</button></div>';
      }).join("");
    host.querySelectorAll("[data-rm]").forEach(function(b){ b.addEventListener("click", function(){ removeAttachment(b.getAttribute("data-rm")); }); });
  }
  function removeAttachment(key){
    // Additive only: dropping it from the message never deletes the stored object (another draft may
    // reference it, and Storage is append-only here). The strip and the compiled body simply stop citing it.
    composeAttachments = composeAttachments.filter(function(a){ return a.key!==key; });
    renderAttachStrip(); refreshDriveChip(); touchCompose(); refreshPreview();
  }
  async function addAttachmentFiles(fileList){
    const files=[].slice.call(fileList||[]);
    if(!files.length) return;
    // Attachments change the send request shape and need a v8+ relay. Never drop them silently: if the
    // deployed relay cannot carry them, refuse the add with the version the operator must deploy.
    if(!relaySupportsAttachments()){ toast(t("attach_need_relay").replace("{ver}", String(ATTACH_MIN_RELAY))); return; }
    for(let i=0;i<files.length;i++){
      const f=files[i];
      if(!/^image\//i.test(f.type||"")){ toast(t("cmp_att_only_images")); continue; }
      if(composeAttachments.length>=ATTACH_COUNT_MAX){ toast(t("attach_refused_count").replace("{max}", String(ATTACH_COUNT_MAX))); break; }
      if((f.size||0)>ATTACH_MAX){ toast(t("attach_refused").replace("{mb}", String(Math.round(ATTACH_MAX/1048576)))); continue; }   // refused, with the number
      try{
        const key="a"+(++__attachKeyN)+"-"+Date.now();
        const up=await ThriveSupa.uploadAttachment(f, slug||"unfiled", key);
        composeAttachments.push({ key:key, name:up.name, type:up.type||f.type||"", size:up.size||f.size||0, url:up.url, path:up.path });
        if(slug) logActivity("attach_add", slug, up.name);       // every attachment enters the card's activity memory (P21), with its author
        renderAttachStrip(); touchCompose(); refreshPreview();
      }catch(e){ toast(t("cmp_att_upload_fail")+((e&&e.message)?(": "+e.message):"")); }
    }
  }

  /* ---- P23: rich links -- recognize the destination, label it cleanly ------------------------------
     A pasted or inserted link is recognized by its host (Instagram, X, TikTok, Facebook, LinkedIn,
     YouTube, Google Drive, or a generic URL) so a bare link reads as a clean labelled word, and the
     links manager names the type. A Google Drive link raises a sender-only reminder to check its
     sharing before the message goes, so the recipient never hits a request-access wall. */
  function linkKind(url){
    let host="", u=String(url||"").trim();
    try{ host=new URL(/^[a-z][a-z0-9+.-]*:/i.test(u)?u:("https://"+u)).hostname.replace(/^www\./,"").toLowerCase(); }catch(e){ host=""; }
    const on=h=>host===h||host.slice(-(h.length+1))==="."+h;
    if(/^mailto:/i.test(u)) return { type:"email",     label:t("cmp_lk_email") };
    if(/^tel:/i.test(u))    return { type:"phone",     label:t("cmp_lk_phone") };
    if(on("instagram.com"))                         return { type:"instagram", label:t("cmp_lk_instagram") };
    if(on("x.com")||on("twitter.com")||on("t.co"))  return { type:"x",         label:t("cmp_lk_x") };
    if(on("tiktok.com"))                            return { type:"tiktok",    label:t("cmp_lk_tiktok") };
    if(on("facebook.com")||on("fb.com")||on("fb.watch")) return { type:"facebook", label:t("cmp_lk_facebook") };
    if(on("linkedin.com")||on("lnkd.in"))           return { type:"linkedin",  label:t("cmp_lk_linkedin") };
    if(on("youtube.com")||on("youtu.be"))           return { type:"youtube",   label:t("cmp_lk_youtube") };
    if(on("drive.google.com")||on("docs.google.com")) return { type:"drive",   label:t("cmp_lk_drive") };
    return { type:"url", label:t("cmp_lk_url") };
  }
  try{ window.__linkKind=linkKind; }catch(_){}
  function refreshDriveChip(){
    const chip=el("edrivechip"); if(!chip) return;
    const anchors=[].slice.call((el("ebody")||{querySelectorAll:()=>[]}).querySelectorAll("a"));
    const hasDrive=anchors.some(a=>linkKind(a.getAttribute("href")||"").type==="drive");
    if(!hasDrive){ chip.hidden=true; chip.innerHTML=""; return; }
    chip.hidden=false;
    chip.innerHTML='<span class="edrive-ic">'+ic("alert")+'</span><span class="edrive-msg">'+esc(t("cmp_drive_reminder"))+'</span>';
  }

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
      // P23: a bare recognized link (Instagram, YouTube, Drive...) reads as its clean type word, never a
      // raw URL; a generic link with no text still shows the URL, which is clearer than a vague "Link".
      const lk=linkKind(url), auto=(lk.type!=="url")? lk.label : url;
      const a=document.createElement("a"); a.href=url; a.setAttribute("data-origin","custom"); a.textContent=text||auto;
      if(savedRange){ try{ savedRange.deleteContents(); savedRange.insertNode(a); }catch(e){ body.appendChild(a); } }
      else body.appendChild(a);
    }
    linkBar.hidden=true; editingAnchor=null; savedRange=null;
    refreshLinks(); recordBody();                        // a link inserted or edited is an undo step
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
        const origin=tpl?'<span class="tag tag-templates">'+t("cmp_link_tpl")+'</span>':'<span class="tag tag-plain">'+t("cmp_link_custom")+'</span>';
        // P23: name the recognized destination (Instagram, YouTube, Google Drive...) beside the origin.
        const lk=linkKind(a.getAttribute("href")||"");
        const kind=(lk.type!=="url")?'<span class="tag tag-kind lk-'+esc(lk.type)+'">'+esc(lk.label)+'</span>':'';
        return '<div class="elink-item"><div class="elink-info"><span class="elink-text">'+esc(a.textContent||"–")+'</span>'+kind+origin+
          '<span class="elink-url mono">'+esc(a.getAttribute("href")||"")+'</span></div>'+
          '<div class="elink-acts"><button type="button" class="btn ghost sm" data-edit="'+i+'">'+t("cmp_link_edit")+'</button>'+
          '<button type="button" class="btn ghost sm danger" data-del="'+i+'">'+t("cmp_link_remove")+'</button></div></div>';
      }).join("");
    linksBox.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{
      const a=anchors[+b.getAttribute("data-edit")]; if(!a) return; openLinkBar(null, a);
    }));
    linksBox.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      const a=anchors[+b.getAttribute("data-del")]; if(!a||!a.parentNode) return;
      const p=a.parentNode; while(a.firstChild) p.insertBefore(a.firstChild,a); p.removeChild(a); refreshLinks(); recordBody();
    }));
    renderOppStatus();
    refreshDriveChip();                                  // P23: sender-only Drive-sharing reminder follows the links
  }
  el("tbLink").addEventListener("click",()=>{ closeBars(); openLinkBar(""); });
  el("tbUnlink").addEventListener("click",()=>{ cmd("unlink"); refreshLinks(); });
  // P23: attach an image. The button gates on the relay's attachment support; the hidden input feeds
  // addAttachmentFiles, which uploads to Storage and rebuilds the strip and the preview.
  (function wireAttach(){
    const btn=el("tbAttach"), inp=el("eAttachFile");
    if(!btn || !inp) return;
    btn.addEventListener("mousedown", e=>e.preventDefault());
    btn.addEventListener("click", ()=>{
      if(!relaySupportsAttachments()){ toast(t("attach_need_relay").replace("{ver}", String(ATTACH_MIN_RELAY))); return; }
      inp.click();
    });
    inp.addEventListener("change", ()=>{ const fl=inp.files; inp.value=""; addAttachmentFiles(fl); });
  })();
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
    /* R11 (P18): the To resolves from the ONE channel model, not a separate field. emailAddress() returns the
       primary email channel's address (or any email channel's). If the primary is a non-email channel and no
       email channel exists, the composer says so rather than leaving the field silently blank. */
    const addr=emailAddress(oppObj);
    const toEl=el("eto");
    if(toEl && !toEl.value.trim() && addr) toEl.value=addr;   // the bare address, mailto lives in the send href
    if(toEl){
      const prim=primaryChannel(oppObj);
      const field=toEl.closest(".field")||toEl.parentNode;
      let note=field? field.querySelector(".eto-note") : null;
      if(!addr && prim && prim.type!=="email"){
        if(field && !note){ note=document.createElement("p"); note.className="mw-note eto-note"; field.appendChild(note); }
        if(note) note.textContent=t("ocm_not_email");
      } else if(note){ note.remove(); }
    }
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
  // The shared editor serves both outreach and reply. Clear any reply-lean marker a prior reply mount left on
  // the node, so outreach always starts from the full calm chrome; reply mode re-applies it below.
  var __composeRoot=document.getElementById("view-compose");
  if(__composeRoot){ __composeRoot.classList.remove("reply-lean"); }

  if(opts && opts.reply && slug){
    replyCtx=replyTarget(slug);
    const toEl=el("eto"), suEl=el("esubject"), nmEl=el("ename"), bd=el("ebody");
    if(toEl){ toEl.value=replyCtx.addr||""; toEl.readOnly=true; }        // the reply answers ONE address, locked
    if(nmEl && replyCtx.name){ nmEl.value=replyCtx.name; }
    if(suEl){ const bs=String(replyCtx.subject||"").trim();
      suEl.value = /^\s*(re|رد)\s*:/i.test(bs) ? bs : ("Re: "+(bs||t("th_reply_subj_fallback")));
      subjectDirty=true; }                                              // hold the Re: subject; a template will not clobber it
    if(bd && !(bd.textContent||"").trim()){                            // open on the greeting, in the recipient's language
      const g=replyGreeting(replyCtx);
      bd.innerHTML='<div dir="'+(replyCtx.lang==="ar"?"rtl":"auto")+'">'+esc(g).split("\n").join("<br>")+'</div>';
    }
    // A reply is calm by default through the ONE calm chrome: Aa reveals formatting, More reveals the
    // overflow (template, closing block, plain text), Preview stays first-class. Nothing bespoke to reply.
    // The reply-lean marker only tucks the campaign-only affordances a one-address reply never uses (the
    // personalize chip and the campaign send); recipient, subject, body, formatting, options, Preview and
    // Send all stay reachable.
    if(__composeRoot){ __composeRoot.classList.add("reply-lean"); }
  }
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
    // Keyed to the TEMPLATE language, not the UI, so the one formatter takes an explicit locale here.
    // Month name only (no numerals), Latin numbering pinned for consistency.
    return fmtStamp(Date.now(), {month:"long"}, ar ? "ar-u-nu-latn" : "en-US") || "";
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
    refreshLinks(); recordBody();                        // applying a template is a single undo step
  }
  function clearCompose(){ subjectDirty=false; el("esubject").value=""; body.innerHTML=""; if(monthWrap) monthWrap.hidden=true; refreshLinks(); recordBody(); }

  /* ---- P6 / D4: "Personalize names" ---------------------------------------
     One chip that adds the {{NAME}} merge token to the greeting. The token lives in the editor as
     the same tagged soft pill the templates use (data-m="name", contenteditable so it deletes whole):
     never raw braces, kept in sync by syncMerge, stripped to clean text on send by htmlOut. Here the
     writer adds it (after a recognized greeting, or at the cursor) and removes it again, healing the
     line so a nameless greeting reads "Hi," and never "Hi ,". {{NAME}} only (R2); nothing sends. */
  const tbPer=el("tbPersonalize");
  function personalizeActive(){ return !!body.querySelector('[data-m="name"]'); }
  function refreshPersonalizeChip(){ if(tbPer){ const on=personalizeActive(); tbPer.classList.toggle("on", on); tbPer.setAttribute("aria-pressed", on?"true":"false"); } }
  function makeNamePill(){
    const s=document.createElement("span");
    s.setAttribute("data-m","name"); s.setAttribute("contenteditable","false");
    s.textContent=recipientName()||"there";
    return s;
  }
  // The caret, only when it is a collapsed point inside the editable body (never a toolbar click).
  function bodyCaret(){
    const sel=window.getSelection();
    if(!sel || !sel.rangeCount) return null;
    const r=sel.getRangeAt(0);
    return (r.collapsed && body.contains(r.startContainer)) ? r : null;
  }
  function caretOnPill(r){ let n=r&&r.startContainer; while(n&&n!==body){ if(n.nodeType===1 && n.getAttribute && n.getAttribute("data-m")==="name") return true; n=n.parentNode; } return false; }
  // Insert the pill after a recognized greeting word, before any trailing comma, one space between.
  function insertNameAfterGreeting(){
    const re=greetingHeadRe();
    const walk=document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let node;
    while((node=walk.nextNode())){
      const m=re.exec(node.nodeValue||"");
      if(!m) continue;
      const after=m[0].length, lead=node.nodeValue.slice(0,after);
      const tail=node.nodeValue.slice(after).replace(/^[ \t]+/,"");   // drop existing spaces; re-add exactly one
      const parent=node.parentNode, pill=makeNamePill(), afterNode=document.createTextNode(tail);
      parent.replaceChild(afterNode, node);
      parent.insertBefore(pill, afterNode);
      parent.insertBefore(document.createTextNode(lead+" "), pill);
      return true;
    }
    return false;
  }
  // Insert the pill at the caret, padded with single spaces so it never glues to a neighbouring word.
  function insertNameAtCaret(r){
    if(!r) return false;
    const pill=makeNamePill(), c=r.startContainer, off=r.startOffset;
    const prevCh=(c.nodeType===3 && off>0)? c.nodeValue.charAt(off-1) : "";
    const nextCh=(c.nodeType===3 && off<c.nodeValue.length)? c.nodeValue.charAt(off) : "";
    r.insertNode(pill);
    if(nextCh && !/\s/.test(nextCh)) pill.parentNode.insertBefore(document.createTextNode(" "), pill.nextSibling);
    if(prevCh && !/\s/.test(prevCh)) pill.parentNode.insertBefore(document.createTextNode(" "), pill);
    return true;
  }
  function insertNameAtStart(){ const pill=makeNamePill(); body.insertBefore(pill, body.firstChild); if(pill.nextSibling) pill.parentNode.insertBefore(document.createTextNode(" "), pill.nextSibling); return true; }
  // Remove every name pill and heal the seam so turning personalisation off leaves no token residue.
  function removeNamesClean(){
    const spans=body.querySelectorAll('[data-m="name"]');
    if(!spans.length) return false;
    spans.forEach(s=>{ if(s.parentNode) s.parentNode.removeChild(s); });
    body.normalize();
    const walk=document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null), fix=[]; let n;
    while((n=walk.nextNode())) fix.push(n);
    fix.forEach(n=>{ n.nodeValue=String(n.nodeValue).replace(/[ \t]+([,،.:;!?])/g,"$1").replace(/[ \t]{2,}/g," "); });
    return true;
  }
  if(tbPer) tbPer.addEventListener("click", ()=>{
    const r=bodyCaret();
    if(personalizeActive()){
      if(r && !caretOnPill(r)) insertNameAtCaret(r);          // add another where the writer points
      else removeNamesClean();                                 // otherwise, toggle it off cleanly
    } else {
      insertNameAfterGreeting() || (r && insertNameAtCaret(r)) || insertNameAtStart();
    }
    syncMerge(); refreshPersonalizeChip(); recordBody(); touchCompose(); refreshPreview();
  });
  body.addEventListener("input", refreshPersonalizeChip);
  // The pre-send roster: every recipient of a campaign with the exact name that will merge and the
  // greeting each will read (the name merged, or the clean fallback for a nameless one). The P5 roster
  // rows are the single name source; this only shows what will happen. It writes nothing and sends nothing.
  function bodyNameTemplateLine(){
    const c=body.cloneNode(true);
    c.querySelectorAll('[data-m="name"]').forEach(s=>s.replaceWith(document.createTextNode("{{NAME}}")));
    const lines=String(c.innerText||c.textContent||"").split(/\r?\n/);
    for(let i=0;i<lines.length;i++){ const L=lines[i].trim(); if(L) return L; }
    return "";
  }
  function renderMergeRoster(){
    const host=el("mergeRoster"); if(!host) return;
    const recips = oppObj ? (campaignRecipients(oppObj)||[]) : [];
    const active = personalizeActive() || /\{\{\s*NAME\s*\}\}/.test(htmlOut());
    if(recips.length<2 || !active){ host.hidden=true; host.innerHTML=""; return; }
    const line=bodyNameTemplateLine();
    const rows=recips.map(r=>{
      const nm=greetingFor(r);
      const lang=(r.lang==="ar"||isArabicText(nm))?"ar":(docLoc()==="AR"?"ar":"en");
      const greet=mergeGreetingLine(line, nm);
      return '<li class="mr-row'+(nm?"":" mr-noname")+'" dir="'+(lang==="ar"?"rtl":"ltr")+'">'+
        '<span class="mr-name">'+(nm? esc(nm) : '<span class="mr-miss">'+esc(t("pn_no_name"))+'</span>')+'</span>'+
        '<span class="mr-addr mono-iso">'+ltr(esc(r.addr))+'</span>'+
        '<span class="mr-greet">'+esc(greet)+'</span></li>';
    }).join("");
    host.hidden=false;
    host.innerHTML='<h4 class="mr-h">'+esc(t("pn_roster_h"))+' <bdi class="n">'+recips.length+'</bdi></h4>'+
      '<ul class="mr-list">'+rows+'</ul>';
  }
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
  // P9 / D8 the calm chrome. The overflow (More / ⋯) holds everything real but rarely touched; Aa reveals a
  // floating format bar, which also appears on a text selection inside the body; Preview opens the
  // per-recipient preview. Formatting handlers (tbBold ...) are wired elsewhere by id and are unchanged.
  (function calmChrome(){
    var floatBar=el("eFloatBar"), aa=el("eAa"), ovfBtn=el("cmpOverflowBtn"), ovf=el("cmpOverflow"), panel=el("composePanel");
    function expand(btn,on){ if(btn) btn.setAttribute("aria-expanded", on?"true":"false"); }
    if(ovfBtn && ovf){
      ovfBtn.addEventListener("click", function(){
        var open=ovf.hidden; ovf.hidden=!open; expand(ovfBtn, open); ovfBtn.classList.toggle("has-on", open);
      });
    }
    var pinned=false;
    function bodySelection(){
      var s=window.getSelection && window.getSelection();
      if(!s || s.isCollapsed || !s.rangeCount) return null;
      var n=s.anchorNode, host=(n && n.nodeType===1)? n : (n && n.parentNode);
      return (host && body && body.contains(host)) ? s : null;
    }
    function place(){
      if(!floatBar || !panel) return;
      var rect=null, s=bodySelection();
      try{ if(s) rect=s.getRangeAt(0).getBoundingClientRect(); }catch(_){}
      if(!rect || (!rect.width && !rect.height)) rect=body.getBoundingClientRect();
      var pr=panel.getBoundingClientRect();
      // Never let the bar ride up over the rail above the body: floor its top at the body's own top so a
      // first-line selection (or a no-selection pin) parks the bar just inside the body, not on the Aa rail.
      var bodyTop=body.getBoundingClientRect().top - pr.top;
      var top=rect.top - pr.top - floatBar.offsetHeight - 8;
      if(top < bodyTop) top=bodyTop + 4;
      floatBar.style.top=Math.max(0,top)+"px";
      var left=rect.left - pr.left; left=Math.max(0, Math.min(left, pr.width - floatBar.offsetWidth - 8));
      floatBar.style.left=left+"px";
    }
    function show(){ if(!floatBar) return; floatBar.hidden=false; place(); expand(aa,true); }
    function hide(){ if(!floatBar || pinned) return; floatBar.hidden=true; expand(aa,false); }
    if(aa && floatBar){
      aa.addEventListener("click", function(){ pinned=!pinned; if(pinned) show(); else { floatBar.hidden=true; expand(aa,false); } });
    }
    if(floatBar){
      // Keep the body's text selection alive when a format button is pressed: preventDefault on mousedown so
      // the button never steals focus and the selection never collapses (the standard rich-text-toolbar move).
      floatBar.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
      document.addEventListener("selectionchange", function(){ if(bodySelection()) show(); else hide(); });
      document.addEventListener("mousedown", function(ev){
        if(pinned || floatBar.hidden) return;
        if(floatBar.contains(ev.target) || (body && body.contains(ev.target))) return;
        floatBar.hidden=true; expand(aa,false);
      });
    }
    var pbtn=el("cmpPreviewBtn"), pw=el("prevWrap");
    if(pbtn && pw){
      pbtn.addEventListener("click", function(){
        pw.open=!pw.open; expand(pbtn, pw.open);
        if(pw.open){ try{ refreshPreview(); }catch(_){} try{ pw.scrollIntoView({block:"nearest"}); }catch(_){} }
      });
    }
  })();
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
    if(replyCtx) return slug||"";                          // a reply belongs to its thread's opportunity, always
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

  /* R14 (P20): the signature the send will carry. The sender PICKS one of their managed signatures (default
     preselected); the box shows it as read-only preview text in the document's language. It is managed
     (add/edit/delete/default) in Settings, not free-typed here, so the closing is one saved block, not an
     ad-hoc second source. editorContent reads sigBox.value, so preview equals sent by construction. */
  const sigBox=el("sigBox"), sigLoc=el("sigLoc"), sigPick=el("sigPick");
  const docLoc=()=> (oppObj ? docLang(oppObj) : (getLang()==="ar"?"AR":"EN"));
  function sigChosenId(){ return (sigPick && sigPick.value) ? sigPick.value : ((sigDefault()||{}).id||""); }
  function fillSigPicker(){
    if(!sigPick) return;
    const list=sigList(), def=(sigDefault()||{}).id||"";
    sigPick.innerHTML=list.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===def?" selected":"")+'>'+esc(s.label||s.name_en||s.name_ar||"")+'</option>').join("");
    const one = list.length<2;                             // a single signature needs no chooser
    sigPick.hidden = one;
    const field=el("sigPickField"); if(field) field.hidden = one;
  }
  function loadSignature(){
    if(!sigBox) return;
    sigBox.value=signatureForId(sigChosenId(), docLoc());
    if(sigLoc) sigLoc.textContent=t("sig_using")+" "+t("loc_"+docLoc().toLowerCase());
  }
  fillSigPicker(); loadSignature();
  if(sigPick) sigPick.addEventListener("change", ()=>{ loadSignature(); refreshPreview(); });
  const sigManage=el("sigManage");
  if(sigManage) sigManage.addEventListener("click", (e)=>{ e.preventDefault(); goTo("settings"); });

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
  /* ---- P7 / D5: one compile(recipient) -> the exact artifact that lands --------------------------
     Preview and every send build the outgoing subject + HTML + text through THIS one function, so what
     the operator previews is byte-for-byte what the recipient receives: merge resolved for that person
     (or the clean fallback for a nameless one), closing block, footer (the single POSTAL source #79),
     the tokenized page link and the P2 open pixel. Preview renders this same artifact in the email-safe
     iframe; a CSP there stops the pixel from firing, so a preview never records a phantom open. One
     function, both callers; nothing composes a footer or a token anywhere else. */
  function fieldRecipient(){ return { addr:(el("eto")?el("eto").value:""), name:(nameEl?nameEl.value:""), lang:(docLoc()==="AR"?"ar":"") }; }
  function mergeNameFor(rec){
    var n=(rec && rec.name!=null ? String(rec.name) : "").replace(/^\s+|\s+$/g,"");
    if(firstEl && firstEl.checked && n) return n.split(/\s+/)[0];
    return n;
  }
  // The body as a template still carrying {{NAME}}/{{MONTH}}, so each recipient merges from the one body.
  function bodyTemplateHtml(){
    var c=body.cloneNode(true);
    c.querySelectorAll('[data-m="name"]').forEach(function(s){ s.replaceWith(document.createTextNode("{{NAME}}")); });
    c.querySelectorAll('[data-m="month"]').forEach(function(s){ s.replaceWith(document.createTextNode("{{MONTH}}")); });
    return c.innerHTML;
  }
  // Resolve the four tokens for ONE recipient. A nameless recipient drops {{NAME}} cleanly (no stray
  // comma, no double space), never a placeholder or an empty slot.
  function resolveForRecipient(str, name){
    var out=String(str||"");
    if(name){ out=out.replace(/\{\{\s*NAME\s*\}\}/g, name); }
    else { out=out.replace(/\{\{\s*NAME\s*\}\}/g,"").replace(/[ \t]+([,،.:;!?])/g,"$1").replace(/[ \t]{2,}/g," "); }
    out=out.split("{{BIZ}}").join((oppObj&&oppObj.business)||"");
    out=out.split("{{LINK}}").join(oppUrl||"");
    out=out.split("{{MONTH}}").join((monthEl?monthEl.value:"")||"");
    return out;
  }
  // The one compile. opts.track adds the per-recipient open token (pixel + tokenized link); a proof copy
  // and the preview-with-blocked-pixel both still carry it so the artifact is truthful, but eSelf passes
  // track:false so a copy to the operator never tokenizes.
  // P9 / D8: the composer gathers the authored message from the LIVE editor into a `content` object; the one
  // top-level compile(recipient, content) turns it into the exact artifact that lands. Preview and every send
  // build content the same way and call the same compile, so preview equals sent by construction. (The
  // campaign queue builds the same content shape from the captured template -- one compile path, no fork.)
  function editorContent(opts){
    opts=opts||{};
    var pbox=el("plainBox");
    return {
      innerTpl:bodyTemplateHtml(), subjectTpl:(el("esubject")?el("esubject").value:""),
      business:(oppObj&&oppObj.business)||"", link:oppUrl||"", month:(monthEl?monthEl.value:"")||"",
      sig:sigBox?sigBox.value:"", branded:isBranded(),
      slug:(oppObj&&oppObj.slug)||"", tokenSlug:oppOf(),
      firstName:!!(firstEl && firstEl.checked), lang:(docLoc()==="AR"?"ar":"en"),
      track:!!(opts.track && !replyCtx),
      rawText:(pbox && pbox.dataset.dirty==="1") ? pbox.value : null,
      attachments:attachmentsForContent()          // P23: the composer's uploaded images ride into the ONE compile
    };
  }
  try{ window.__cmpCompile=function(rec, opts){ return compile(rec||fieldRecipient(), editorContent(opts||{})); }; }catch(_){}

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
  /* P7 / D5: the recipient switcher. Preview steps the ACTUAL roster (a campaign's recipients, or the one
     field recipient for a single send: a campaign of one), so the operator sees each person's exact email
     in turn. It only chooses which recipient the preview compiles; it sends nothing. */
  var prevIdx=0;
  function previewRoster(){
    var recs = oppObj ? (campaignRecipients(oppObj)||[]) : [];
    return recs.length>1 ? recs : [fieldRecipient()];
  }
  function currentPreviewRecipient(){
    var r=previewRoster(); if(!r.length) return fieldRecipient();
    if(prevIdx<0) prevIdx=0; if(prevIdx>=r.length) prevIdx=r.length-1;
    return r[prevIdx];
  }
  function renderRecipSwitch(){
    var box=el("cmpRecipSwitch"); if(!box) return;
    var r=previewRoster();
    if(r.length<2){ box.hidden=true; return; }
    box.hidden=false;
    if(prevIdx>=r.length) prevIdx=r.length-1;
    var cur=currentPreviewRecipient(), nm=mergeNameFor(cur), lbl=el("cmpRecipLabel");
    if(lbl) lbl.innerHTML='<bdi class="n">'+(prevIdx+1)+'</bdi> / <bdi class="n">'+r.length+'</bdi> · '+
      (nm? esc(nm) : '<span class="tp-noname">'+esc(t("tp_noname"))+'</span>')+
      ' <span class="mono-iso">'+ltr(esc(bareAddress(cur.addr||"")))+'</span>';
  }
  var recPrevBtn=el("cmpPrevRecip"), recNextBtn=el("cmpNextRecip");
  function stepRecip(d){ var r=previewRoster(); if(r.length<2) return; prevIdx=(prevIdx+d+r.length)%r.length; refreshPreview(); }
  if(recPrevBtn) recPrevBtn.addEventListener("click", ()=>stepRecip(-1));
  if(recNextBtn) recNextBtn.addEventListener("click", ()=>stepRecip(1));
  // The email-safe frame. A CSP allows the site logo and data: images but blocks the relay open pixel from
  // firing, so the preview shows the pixel in the source (the truth) yet never records a phantom open.
  var PREVIEW_CSP="default-src 'none'; img-src https://"+SITE+" data:; style-src 'unsafe-inline'";
  function refreshPreview(){
    refreshSubjMeter();
    if(plainBox && plainBox.dataset.dirty!=="1") plainBox.value=composedText();
    renderPreSend();
    renderRecipSwitch();
    if(!prevFrame) return;
    var art=compile(currentPreviewRecipient(), editorContent({track:true}));
    // Dev-only divergence hook (see the true-preview test): when set, the preview bypasses compile and the
    // pixel/token vanish, so the match breaks. Undefined in production.
    var bodyHtml = (typeof window!=="undefined" && window.__previewBypassCompile) ? composedHtml() : art.html;
    // The preview is its own document (an iframe): the console stylesheet cannot reach in, and the body
    // wraps within the frame (overflow-wrap + word-break inherit) so no line escapes at any width.
    prevFrame.srcdoc='<!DOCTYPE html><html dir="'+(art.lang==="ar"?"rtl":"ltr")+'"><head><meta charset="utf-8">'+
      '<meta http-equiv="Content-Security-Policy" content="'+PREVIEW_CSP+'"></head><body '+
      'style="margin:0;padding:16px;background:#fff;overflow-wrap:anywhere;word-break:break-word">'+bodyHtml+'</body></html>';
  }
  try{ window.__cmpRefreshPreview=refreshPreview; }catch(_){}   // test hook; harmless in prod

  /* Send safety: the page is proven live before any message leaves for a party. liveState is the
     last known answer, refreshed on open and re-checked at the moment of each send. `null` means
     not yet checked; the send re-checks regardless, so a stale yes can never let a message out. */
  let liveState={ ok:null, reason:"" };
  async function checkLive(){
    if(!slug || replyCtx){ liveState={ ok:true, reason:"" }; return liveState; }   // no page, or a reply (not a page send)
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
    renderMergeRoster();   // P6: every recipient with the exact name that will merge
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
    const gated = !!slug && !replyCtx;                      // no page, or a reply (not a page send), is never gated
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
      plain: (plainBox && plainBox.dataset.dirty==="1") ? plainBox.value : "",
      attachments: composeAttachments.slice()        // P23: persist the uploaded-image list (URLs only, never bytes)
    };
  }
  function composeHasContent(s){
    return !!(String(s.body_html||"").replace(/<[^>]*>/g,"").trim() || (s.subject||"").trim()
              || s.to || s.name || (s.plain||"").trim() || (s.attachments&&s.attachments.length));
  }
  const savedTag=el("draftSaved");
  let composeDirty=false, composeLogged=false, restoring=false;
  const persistCompose=debounce(()=>{
    if(!slug || !composeDirty || restoring || replyCtx) return;   // no record, nothing typed, or a transient reply
    const s=composeState();
    if(!composeHasContent(s)) return;                 // an untouched composer writes nothing
    composeDraftSet(slug, currentActor(), Object.assign({}, s, { up:Date.now() }));   // per-user: private to its author
    if(!composeLogged){ logActivity("draft_save", slug, ""); composeLogged=true; }  // one audit line per editing session
    if(savedTag){ savedTag.textContent=t("draft_saved"); savedTag.hidden=false; }
  }, 600);
  function touchCompose(){ if(restoring) return; composeDirty=true; persistCompose(); }
  // Once the message has gone out, the working draft is done: it is cleared from the record so a
  // reopen starts fresh rather than restoring a message already sent. Additive, keyed by slug.
  function clearComposeDraft(){ if(replyCtx) return; if(slug) composeDraftSet(slug, currentActor(), null); composeDirty=false; composeLogged=false; if(savedTag) savedTag.hidden=true; }
  [["ebody","input"],["esubject","input"],["eto","input"],["ename","input"],
   ["emonth","input"],["etpl","change"],["ebrand","change"],["efirst","change"],
   ["plainBox","input"]].forEach(([id,ev])=>{ const e=el(id); if(e) e.addEventListener(ev, touchCompose); });

  /* Continue from the last saved point. If the record carries a compose_draft, the composer is
     restored to it exactly, over the fresh seed, so a reopen resumes rather than restarts. The
     restore is not an edit, so it neither marks the draft dirty nor writes anything back. */
  function restoreCompose(){
    const d=composeDraftGet(oppObj, currentActor()); if(!d) return false;   // only this actor's own unsaved draft
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
    if(Array.isArray(d.attachments)){                    // P23: restore the uploaded-image list (URLs, never bytes)
      composeAttachments=d.attachments.filter(a=>a&&a.url).map(a=>({ key:a.key||("a"+(++__attachKeyN)), name:a.name||"image", type:a.type||"", size:Number(a.size)||0, url:a.url, path:a.path||"" }));
      renderAttachStrip();
    }
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
  if(!replyCtx && restoreCompose()) toast(t("draft_restored"));   // a reply is transient: never restore the outreach draft over the greeting
  refreshPreview();
  refreshPersonalizeChip();   // P6: reflect whether the body already carries the {{NAME}} pill

  /* Undo and redo for the outreach message text, and only there. The history is keyed by the slug, so
     reopening the same message keeps its steps while a different one starts fresh, and it survives the
     auto-save re-render because it lives in memory, not in the rebuilt node. Seeded here, after the
     body and its attached text are loaded, so the base step is what the writer opens to. */
  const H=ThriveEditHistory;
  const HIST_FIELDS=["ebody","sigBox","plainBox"];     // message body (contenteditable), closing block, plain-text alternative
  const cmpUndoBtn=el("cmpUndo"), cmpRedoBtn=el("cmpRedo");
  function updateHist(){
    const id=H.last();
    if(cmpUndoBtn) cmpUndoBtn.disabled=!H.canUndo(id);
    if(cmpRedoBtn) cmpRedoBtn.disabled=!H.canRedo(id);
  }
  H.reset(slug||"");
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
  // The body also changes without a keystroke: applying a template, inserting or removing a link. Those
  // are real message edits, so they are recorded too, and the icons then step through them.
  recordBody=function(){ if(H.record){ H.record(body); H.setLast("ebody"); updateHist(); } };
  function actOn(fn){ const f=el(H.last()); if(!f) return; if(fn(f)) updateHist(); }
  if(cmpUndoBtn){ cmpUndoBtn.addEventListener("mousedown", e=>e.preventDefault());   // keep the field focused
    cmpUndoBtn.addEventListener("click", ()=> actOn(f=>H.undo(f))); }
  if(cmpRedoBtn){ cmpRedoBtn.addEventListener("mousedown", e=>e.preventDefault());
    cmpRedoBtn.addEventListener("click", ()=> actOn(f=>H.redo(f))); }
  H.setLast("ebody"); updateHist();

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
      const sb=compile(fieldRecipient(), editorContent({track:false}));   // same finished body as a real send, footer included; a proof copy to the operator never tokenizes
      const r=await fetchT(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify({ from:FROM_EMAIL, fromName:getFromName(), to:FROM_EMAIL,
          subject:"["+t("cmp_self_tag")+"] "+sb.subject,
          html:sb.html, text:sb.text }) }, 30000);
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

  /* P8 / D6: start the durable campaign queue. Shown only for a group opportunity. The authored message
     becomes the per-recipient template (the body's NAME/MONTH spans back to {{NAME}}/{{MONTH}} so each
     recipient merges); startCampaignQueue writes the queued rows and hands the batch to the relay. This
     device does not pace or send: the relay does, on its trigger. */
  // The authored message, captured as the campaign template: the same {{NAME}}/{{MONTH}}-tokenized body the
  // single-send composer reads (bodyTemplateHtml), plus subject/brand/sig/first-name/month/language. One
  // builder, so the campaign queue and the parity test see exactly what the send composes.
  function buildCampaignTpl(){
    var c=body.cloneNode(true);
    c.querySelectorAll('[data-m="name"]').forEach(function(s){ s.replaceWith(document.createTextNode("{{NAME}}")); });
    c.querySelectorAll('[data-m="month"]').forEach(function(s){ s.replaceWith(document.createTextNode("{{MONTH}}")); });
    var tp=currentTpl();
    var subjTpl=(tp && /\{\{\s*NAME\s*\}\}/.test(tp.subject||"")) ? tp.subject : el("esubject").value;
    return { subject:subjTpl, html:c.innerHTML, branded:isBranded(), sig:sigBox?sigBox.value:"",
             firstName:!!(firstEl && firstEl.checked), month:monthVal(), lang:(docLoc()==="AR"?"ar":"en"),
             attachments:attachmentsForContent() };   // P23: the same images compile per recipient through the one path
  }
  try{ window.__campaignTpl=buildCampaignTpl; }catch(_){}

  // P24: the campaign plan sits on the campaign screen, beside Start campaign, so the deliverability
  // discipline is visible before a dozens-send: the jitter window, today's budget, the warm-ramp cap, and
  // the estimated finish. Shown only for a group opportunity; a single recipient has no campaign to pace.
  (function fillCampaignPlan(){
    var host=el("cmpPlan"); if(!host) return;
    if(oppObj && typeof isGroupOpp==="function" && isGroupOpp(oppObj) && !replyCtx){
      try{ host.innerHTML=campaignPlanHtml(oppObj); host.hidden=false; }catch(_){ host.hidden=true; }
    } else { host.hidden=true; host.innerHTML=""; }
  })();
  const campBtn=el("eCampaign");
  if(campBtn){
    if(oppObj && typeof isGroupOpp==="function" && isGroupOpp(oppObj)) campBtn.hidden=false;
    campBtn.addEventListener("click", async ()=>{
      if(!oppObj || !isGroupOpp(oppObj)){ toast(t("cq_not_group")); return; }
      if(!(await ensureLive())) return;                    // the page must be proven live, exactly like a single send
      var tpl=buildCampaignTpl();
      // P23: the same attachment discipline holds for a campaign. Refuse an oversize image by number, and
      // refuse the whole campaign if the live relay cannot carry the attachments, rather than send some without.
      var camPlan=planAttachments(tpl.attachments||[]);
      if(camPlan.refused && camPlan.refused.length){ var cr=camPlan.refused[0];
        var ck=(cr.reason==="count")?"attach_refused_count":"attach_refused";
        var cn=(cr.reason==="count")?ATTACH_COUNT_MAX:Math.round((cr.limit||ATTACH_MAX)/1048576);
        toast(t(ck).replace("{max}", String(cn)).replace("{mb}", String(cn))); return; }
      if(camPlan.attach.length && !relaySupportsAttachments()){ toast(t("attach_need_relay").replace("{ver}", String(ATTACH_MIN_RELAY))); return; }
      campBtn.disabled=true;
      try{
        var res=startCampaignQueue(oppObj.slug, tpl);
        if(!res || !res.ok){ toast(t("cq_start_err")+(res&&res.error?": "+res.error:"")); return; }
        clearComposeDraft();
        toast(t("cq_started"));
        setTimeout(function(){ if(window.thriveModal) window.thriveModal.open(oppObj.slug,"overview",oppObj.business||oppObj.slug); }, 300);
      }catch(e){ toast(t("cq_start_err")+": "+(e&&e.message||e)); }
      finally{ campBtn.disabled=false; }
    });
  }

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
    // The double-send guard now keys on the send's INTENT (its idempotency key), not a 60s time window,
    // and it runs after the payload is built so it can hash the exact body. See the guard just below the
    // payload. The button also disables itself while a send is in flight, blocking a same-tick double tap.
    /* An unresolved token blocks the send. "Hi {name}" reaching a prospect is
       the failure this whole section exists to prevent, and detecting it after
       the fact is detecting it too late. */
    const left=unresolvedTokens(resolveTokens(htmlOut()+" "+el("esubject").value));
    if(left.length){ toast(t("ps_tokens_block")+" "+left.join(", ")); renderPreSend(); return; }
    /* The physical address and the one line opt out are required by US law for commercial email, and
       both are already true of Thrive. The footer is attached by compile(), the one composer, from the
       single POSTAL source, so this send carries the exact footer the self-send proof copy showed.
       List-Unsubscribe is not required at this volume and costs nothing, and it converts a spam
       complaint into an unsubscribe. The relay sends this body verbatim and adds nothing. */
    // Campaigns P2: an outreach send (never a thread reply) carries a per-recipient open token so this
    // person's opens attribute to them. The token is this send's console_mail row id, set BEFORE the body
    // is compiled so the open pixel and the tokenized page link both carry it, then cleared in finally.
    // The one compile: the send submits byte-for-byte what the preview showed for this recipient.
    const art=compile(fieldRecipient(), editorContent({track:true}));
    // P23: an oversize image is refused by number, never silently dropped. The composer refuses at add time;
    // this is the floor for a stale or synced draft carrying one through compile.
    if(art.refused && art.refused.length){ const r0=art.refused[0];
      const k=(r0.reason==="count")?"attach_refused_count":"attach_refused";
      const n=(r0.reason==="count")?ATTACH_COUNT_MAX:Math.round((r0.limit||ATTACH_MAX)/1048576);
      toast(t(k).replace("{max}", String(n)).replace("{mb}", String(n))); return; }
    // And a real attachment can never be silently dropped by an older relay: if the draft carries one but the
    // live relay predates attachment support, refuse and name the version, rather than send it without.
    if((art.attachments||[]).length && !relaySupportsAttachments()){ toast(t("attach_need_relay").replace("{ver}", String(ATTACH_MIN_RELAY))); return; }
    const subjectOut=art.subject, sb={ html:art.html, text:art.text }, sendToken=art.token, sendAtts=art.attachments||[];
    // A stable Message-ID the reply's In-Reply-To will carry back, recorded on the row so the reply
    // threads by header (the strongest tier). Passed through the relay to Resend; whether Resend keeps it
    // verbatim is a device gate, so sender and subject stay the reliable tiers underneath it.
    const msgid=newMessageId();
    // A reply threads by header: In-Reply-To names the wire id it answers, References carries the chain, so
    // the strongest attribution tier resolves it. Added only in reply mode; the outreach header set is
    // exactly as before otherwise.
    const replyHeaders={};
    if(replyCtx && replyCtx.inReplyTo){
      const chain=(replyCtx.refs||[]).concat([replyCtx.inReplyTo]).filter((v,i,a)=> v && a.indexOf(v)===i);
      replyHeaders["In-Reply-To"]="<"+replyCtx.inReplyTo+">";
      replyHeaders["References"]=chain.map(x=>"<"+x+">").join(" ");
    }
    // The whole send is now the ONE hardened relay path, shared with the thread reply (relaySend): the
    // per-intent idempotency key, the durable pending row before the POST, no blind retry, and the relay's
    // true answer as the outcome all live there. The composer keeps only what is its own: the button
    // state, the quota count, the working draft, and the reply greeting reset.
    const m=tplMeta();
    el("eSend").disabled=true; const old=el("eSend").textContent; el("eSend").textContent=t("cmp_sending");
    // Part 2: in reply mode the reply appears in the thread IMMEDIATELY (optimistic), the instant Send is
    // pressed, before the network round trip. Every outcome below reconciles it against the durable ledger
    // (reconcileReply -> renderHistory), so the optimistic bubble becomes the true row or is dropped on a
    // real failure - never a phantom. The confirmed-write path (relaySend) is unchanged.
    if(replyCtx){ try{ threadOptimisticReply(sb.text); }catch(_){} }
    const reconcileReply=function(){ if(replyCtx && onSent) try{ onSent(); }catch(_){} };
    let res;
    try{
      res=await relaySend({ opp:oppOf(), to:to, toName:recName(), subject:subjectOut,
        html:sb.html, text:sb.text, msgid:msgid, headers:replyHeaders, preview:preview(),
        chapter:sendChapter(oppOf()), attachments:sendAtts,
        mailExtra:{ templateId:m.templateId, templateName:m.templateName, branded:isBranded(), mid:(sendToken||undefined),
                    attach_n:(sendAtts.length||undefined), attach_names:(sendAtts.length? sendAtts.map(a=>a.filename).join(", ") : undefined) } });
    } finally { el("eSend").disabled=false; el("eSend").textContent=old; }
    // A completed send, refused by name: no second delivery.
    if(res.status==="duplicate"){ toast(t("cmp_dupe_block")); reconcileReply(); return; }
    // A timeout: in flight and MAY have delivered. The pending row already advanced the card; say "sent,
    // confirming" and a later re-tap reconciles under the same key, never a second delivery.
    if(res.status==="pending"){ toast(t("cmp_sent_confirming")); reconcileReply(); return; }
    // A known failure: the intent is unsent (the card did not advance) and the true error is shown. The
    // optimistic bubble is dropped by the reconcile (buildThread excludes an unsent row), so no phantom.
    if(res.status!=="sent" && res.status!=="sending"){ toast(t("cmp_send_err")+": "+(res.error||"")); reconcileReply(); return; }
    // Dispatched: the relay accepted the email. 'sent' means the server also holds the row; 'sending' means
    // not yet (a signed-in write that failed), so the card sits in a visible outbox and graduates to Sent on
    // its own. Quota counts the delivery either way (once, not per attempt); the working draft is done.
    recordSend(); renderQuota();
    // R15: the send is a ledger event (the console_mail row). The activity trail DERIVES it from the ledger,
    // so it is never written again here - one representation of the send, never a double-store.
    clearComposeDraft();                                  // the message went out, so the working draft is done
    if(replyCtx){
      // A thread reply stays in place: confirm it quietly and open a fresh greeting for the next reply, so
      // the composer is ready rather than showing a message already sent.
      toast(res.status==="sent" ? t("cmp_sent") : t("cmp_sent_queued"));
      replyCtx=replyTarget(slug);
      const g=replyGreeting(replyCtx);
      body.innerHTML='<div dir="'+(replyCtx.lang==="ar"?"rtl":"auto")+'">'+esc(g).split("\n").join("<br>")+'</div>';
      refreshLinks(); recordBody();
      if(onSent) try{ onSent(); }catch(_){}
    } else {
      // P21: an outreach brief has reached its destination. The send moment, then back to the board. The
      // card's lane is already set by the ledger row; the return closes the modal directly, so the generic
      // unsaved-edits dialog (edit flows only) can never appear on a send.
      showSendMoment(function(){ returnToBoardAfterSend(); });
    }
  });
  try{ window.__composeReady=(window.__composeReady||0)+1; }catch(_){}   // test readiness signal; harmless in prod
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
const REQUIRED_RELAY = 5;         // the OLDEST relay this console's request shapes work against
const ATTACH_MIN_RELAY = 8;       // attachments need the relay that forwards them (v8); older relays never see one
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
/* P23: the runtime gate reads "the relay is NOT OLDER than this console needs", `seen >= REQUIRED`, not
   strict equality. A relay NEWER than REQUIRED is fine: it is backward-compatible with the older request
   shape this console stamps (v:REQUIRED), and the relay's own request-version guard still refuses a NEWER
   console against an OLDER relay by name. Strict `===` made every additive relay upgrade a mismatch, which
   is why P8's queue and P22's inbound stayed dormant behind a v5 console. An OLDER (or absent) version is
   still a mismatch and still refuses the send, naming both numbers. Returns null when ready. */
function relayMismatch(){
  if(!__relayChecked) return null;
  if(__relaySeen != null && __relaySeen >= REQUIRED_RELAY) return null;   // equal or newer: ready
  return { seen: __relaySeen, need: REQUIRED_RELAY };                     // older or absent: refuse, name both
}
function relayReady(){ return relayMismatch() === null; }
// The relay version we are actually talking to (null until a response is seen), and per-capability gates.
function relaySeenVersion(){ return __relaySeen; }
function relaySupportsAttachments(){ return __relaySeen != null && __relaySeen >= ATTACH_MIN_RELAY; }
try{ window.relaySeenVersion=relaySeenVersion; window.relaySupportsAttachments=relaySupportsAttachments;
     window.noteRelayVersion=noteRelayVersion; window.relayReady=relayReady; window.relayMismatch=relayMismatch; }catch(_){}   // test hooks for the version gate
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
        // P23: "current" means NOT OLDER than the console needs (jv >= REQUIRED), matching the send gate's
        // `>=`. A NEWER relay (v8 against a v5 REQUIRED) is current, not "old"; only an older one is stale.
        return { kind: jv>=REQUIRED_RELAY? "current":"old", ver:jv, version:"Thrive relay v"+jv }; }
    }catch(e){}
  }
  /* Fallback for a relay built before the contract, whose bare GET is the prose line. "current" is
     read from REQUIRED_RELAY, never a literal: the day the relay became v5 a hardcoded "v4" here would
     have turned a correct deployment into a reported fault, which is the exact class of drift this ends. */
  if(/Thrive relay/i.test(s)){
    const m=/v(\d+)/i.exec(s); const ver=m? Number(m[1]) : null;
    return { kind: (ver!=null && ver>=REQUIRED_RELAY)? "current":"old", ver:ver, version:s.slice(0,90) };
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
  if(v.ver!=null) noteRelayVersion({ relay_version:v.ver });   // P23: the checked version feeds the same one gate + the caps line
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

/* ---------- the profile view (WO-029 Phase A) ----------------------------------
   One coherent surface: an identity header read from the sign-in, then three self-contained regions
   (Preferences, Memory, Performance), then the owner-only infrastructure zone. Every region is filled,
   nothing dead-ends. Preferences persist to console_profiles; Performance derives from the one source
   (operatorStats); the infrastructure zone is present-and-functional for the owner and removed for
   every other operator, whose tier is refused at the database (console_members.role), not merely hidden. */
/* ---------- P27: the oversight room + the shared member performance panel ------------------------------
   The owner's private surface. Per member: precise numbers first (daily / weekly / monthly windows), each
   carrying its definition from the ONE metric dictionary (INSIGHTS_METRICS), then a calm sparkline trend and
   the operations trail. The member's own-performance panel reuses memberPanelHtml with own data only, so the
   two surfaces read identical definitions from the same derivations, and a member never sees another's
   numbers. Nothing here is invented; every field comes from memberMetrics (which reuses the board readers). */
var OV_WINDOWS=[ { lab:"ov_daily", days:1 }, { lab:"ov_weekly", days:7 }, { lab:"ov_monthly", days:30 } ];
var OV_METRICS=[
  { f:"sends",     lab:"ovm_sends",   tip:"mdef_sent" },
  { f:"replies",   lab:"ovm_replies", tip:"mdef_replies" },
  { f:"replyRate", lab:"ovm_rate",    tip:"mdef_reply_rate", pct:true },
  { f:"opens",     lab:"ovm_opens",   tip:"mdef_opens" },
  { f:"pages",     lab:"ovm_pages",   tip:"mdef_pages" },
  { f:"edits",     lab:"ovm_edits",   tip:"mdef_edits" }
];
function ovCell(mk, mm){
  var v=mm[mk.f]||0;
  return '<div class="ov-cell"><span class="ov-cv">'+nIso(v)+(mk.pct?"%":"")+'</span>'+
    '<span class="ov-ck">'+esc(t(mk.lab))+'<button type="button" class="info" data-tip="'+esc(t(mk.tip))+'" aria-label="'+esc(t(mk.tip))+'">i</button></span></div>';
}
function ovWindowHtml(uid, w){
  var mm=memberMetrics(uid, w.days);
  return '<div class="ov-win"><div class="ov-win-h">'+esc(t(w.lab))+'</div><div class="ov-cells">'+
    OV_METRICS.map(function(mk){ return ovCell(mk, mm); }).join("")+'</div></div>';
}
/* One member panel, reused by the oversight room (trail:true) and the member's own profile (own:true). */
function memberPanelHtml(member, opts){
  opts=opts||{}; var uid=member.id, L=getLang();
  var nm=member.name||memberName(uid)||resolveOperator(uid);
  var roleTxt=member.role==="owner" ? t("pf_role_owner") : t("pf_role_operator");
  var trend=memberSendTrend(uid, 14);
  var head='<header class="ov-mh"><div class="ov-mid"><h3 class="ov-mn" dir="auto">'+esc(nm)+'</h3>'+
    '<span class="ov-role chip-st">'+esc(roleTxt)+'</span></div>'+
    '<div class="ov-trend" title="'+esc(t("ov_trend"))+'">'+sparklineSvg(trend,{w:132,h:30})+'</div></header>';
  var wins='<div class="ov-wins">'+OV_WINDOWS.map(function(w){ return ovWindowHtml(uid, w); }).join("")+'</div>';
  var trail="";
  if(opts.trail){
    var led=operatorLedger(uid, { limit:8 });
    var rows=(led.rows||[]).map(function(r){
      return '<div class="ov-tl-row"><span class="ov-tl-k chip-st">'+esc(t("pf_op_"+r.kind)||t("pf_op_other"))+'</span>'+
        '<span class="ov-tl-d" dir="auto">'+esc(r.detail||r.opp||"")+'</span>'+
        '<span class="ov-tl-t">'+fmtWhenHtml(r.ts)+'</span></div>';
    }).join("");
    trail='<details class="ov-trail"><summary class="ov-trail-s">'+ic("clock",14)+esc(t("ov_trail"))+' <span class="ov-tl-n">'+nIso(led.total)+'</span></summary>'+
      '<div class="ov-tl-list">'+(rows||'<p class="mw-muted">'+esc(t("ov_trail_empty"))+'</p>')+'</div></details>';
  }
  var ownNote=opts.own ? '<p class="ov-own-note">'+esc(t("ov_own_note"))+'</p>' : "";
  return '<section class="ov-member'+(opts.own?" is-own":"")+'" data-member="'+esc(uid)+'">'+head+ownNote+wins+trail+'</section>';
}
try{ window.memberPanelHtml=memberPanelHtml; }catch(_){}

async function initOversight(){
  var box=document.getElementById("ovRoom"); if(!box) return;
  try{ await loadAdminTier(); }catch(e){}
  try{ await hydrateOperatorNames(); }catch(e){}
  try{ await hydrateMembers(); }catch(e){}
  // The owner-only boundary, enforced in the UI as well as at the database (RLS). A member reaching this
  // view by any means sees nothing and is returned to the board; the room does not exist for them.
  if(!isOwnerMember()){
    box.innerHTML='<div class="empty">'+esc(t("ov_denied"))+'</div>';
    try{ location.replace("#board"); }catch(e){}
    return;
  }
  var members=membersRoster().filter(function(m){ return m && m.active!==false; });
  if(!members.length){ var me=currentActor(); members=[{ id:me, name:resolveOperator(me), role:"owner", active:true }]; }
  // Owner first, then the rest, each newest-relevant; a stable, human order.
  members.sort(function(a,b){ return (a.role==="owner"?0:1)-(b.role==="owner"?0:1); });
  var panels=members.map(function(m){ return memberPanelHtml(m, { trail:true }); }).join("");
  // The roster: the owner's read-only member list (names, roles, active). Roles are set in the Supabase SQL
  // (never self-granted from a session), so this lists rather than edits; the note says where to change them.
  var roster='<section class="ov-roster"><h3 class="ov-roster-h">'+esc(t("ov_roster"))+'</h3><div class="ov-roster-list">'+
    members.map(function(m){ return '<div class="ov-roster-row"><span class="ov-rn" dir="auto">'+esc(m.name||memberName(m.id))+'</span>'+
      '<span class="ov-re mono-iso" dir="ltr">'+esc(m.email||"")+'</span>'+
      '<span class="ov-rr chip-st">'+esc(m.role==="owner"?t("pf_role_owner"):t("pf_role_operator"))+'</span>'+
      (m.active===false?'<span class="ov-ri chip-st">'+esc(t("ov_inactive"))+'</span>':"")+'</div>'; }).join("")+
    '</div><p class="ov-roster-note">'+esc(t("ov_roster_note"))+'</p></section>';
  // The pre-stamp console-history bucket, attributed to the owner by the stated mapping (see the SQL), shown
  // as one labeled line so nothing is fabricated into a real member's numbers.
  var hist=consoleHistoryStats(), histHtml="";
  if(hist && (hist.sent||hist.moved)){
    histHtml='<section class="ov-hist"><h3 class="ov-hist-h">'+esc(t("ov_history"))+'</h3>'+
      '<p class="ov-hist-line">'+esc(t("ov_history_sub"))+' · '+esc(t("ovm_sends"))+' '+nIso(hist.sent)+' · '+esc(t("ovm_moves"))+' '+nIso(hist.moved)+'</p></section>';
  }
  box.innerHTML=panels+roster+histHtml;
}
window.initOversight=initOversight;

async function initProfile(){
  const el=id=>document.getElementById(id);
  var signedIn=false; try{ signedIn=!!profileUid(); }catch(e){}
  var prof=profileNow();
  try{ prof=await loadProfile(); }catch(e){ prof=profileNow(); }
  try{ await loadAdminTier(); }catch(e){}

  // ---- identity ----
  var email=profileEmail(), name=(prof.display_name||"").trim();
  var initSrc=(name||email||"?").trim();
  if(el("pfAvatar")) el("pfAvatar").textContent=initSrc? initSrc.charAt(0).toUpperCase() : "?";
  if(el("pfEmail")) el("pfEmail").textContent=email||t("pf_no_email");
  if(el("pfName")){ el("pfName").value=name; el("pfName").addEventListener("input", debounceProfileName); }
  if(el("pfRole")) el("pfRole").textContent=isOwnerTier()? t("pf_role_owner") : t("pf_role_operator");
  if(el("pfSince")) el("pfSince").innerHTML=prof.created_at? fmtStampHtml(prof.created_at, {year:"numeric",month:"short"}) : ('<span class="mw-muted">'+esc(t("pf_since_now"))+'</span>');
  if(el("pfSignInNote")) el("pfSignInNote").hidden=signedIn;

  // ---- preferences ----
  function setVal(id,v){ var e=el(id); if(e!=null && v!=null) e.value=v; }
  setVal("pfLang", profilePref("lang", getLang()));
  setVal("pfDensity", profilePref("density","cozy"));
  setVal("pfView", profilePref("view","board"));
  setVal("pfTz", profilePref("tz",""));
  if(el("pfDigest")) el("pfDigest").checked=!!profilePref("digest",false);
  function flashSaved(){ var s=el("pfSaved"); if(s){ s.hidden=false; clearTimeout(s.__t); s.__t=setTimeout(function(){ s.hidden=true; }, 1400); } }
  // ---- R14 (P20): the per-sender signature manager. Each member curates their own signatures here; the
  // composer appends the chosen one, once. The agency block (Thrive Digital Solutions, thriveiii.com) is
  // fixed, appended by the renderer, so only the sender NAME is edited. ----
  renderSignatures(flashSaved);
  function bindPref(id,key,ev,get){ var e=el(id); if(!e) return; e.addEventListener(ev||"change", function(){ setProfilePref(key, get? get(e) : e.value); flashSaved(); }); }
  bindPref("pfDensity","density");
  bindPref("pfView","view");
  bindPref("pfTz","tz","input");
  bindPref("pfDigest","digest","change", function(e){ return !!e.checked; });
  // Language applies immediately, per person, and rides the existing op_prefs bus as it did before.
  if(el("pfLang")) el("pfLang").addEventListener("change", function(){
    var v=el("pfLang").value; setProfilePref("lang", v); flashSaved();
    try{ localStorage.setItem("thrive_lang", v); }catch(_){}
    try{ if(typeof opPrefRemember==="function") opPrefRemember("lang", v); }catch(_){}
    try{ if(typeof setLang==="function") setLang(v); }catch(_){}
  });

  // ---- memory (namespaced, versioned keys; reads fall back to the legacy flat key) ----
  var pins=profileMemNS("pins",[]); if(el("pfMemPins")) el("pfMemPins").textContent=String(Array.isArray(pins)? pins.length : 0);
  var hints=profileMemNS("hints",[]); if(el("pfMemHints")) el("pfMemHints").textContent=String(Array.isArray(hints)? hints.length : 0);
  if(el("pfNotes")){ el("pfNotes").value=profileMemNS("notes",""); el("pfNotes").addEventListener("input", function(){ setProfileMemNS("notes", el("pfNotes").value); }); }

  // ---- performance (the one derivation, filtered to this operator) ----
  var s=operatorStats();
  if(el("pfStSent")) el("pfStSent").textContent=String(s.sent);
  if(el("pfStOpens")) el("pfStOpens").textContent=String(s.opens);
  if(el("pfStReplies")) el("pfStReplies").textContent=String(s.replies);
  if(el("pfStRate")) el("pfStRate").textContent=String(s.replyRate)+"%";
  if(el("pfStMoved")) el("pfStMoved").textContent=String(s.moved);
  if(el("pfStClosed")) el("pfStClosed").textContent=String(s.closed);
  renderCadence(el("pfCadence"), s.cadence);
  // P27: the member's OWN performance panel: the same windowed numbers (daily/weekly/monthly) and the same
  // metric-dictionary definitions the oversight room shows, but scoped to this operator's own data only. A
  // member sees exactly this one thing of the oversight surface, and never another member's numbers.
  if(el("pfWindows")){ var meUid=currentActor();
    el("pfWindows").innerHTML=memberPanelHtml({ id:meUid, name:(name||email||resolveOperator(meUid)), role:(isOwnerMember()?"owner":"member") }, { own:true }); }
  // the honest pre-stamp bucket: one labeled line, never fabricated into a real operator's numbers
  var hist=consoleHistoryStats();
  if(el("pfHistory")){ if(hist){ el("pfHistory").hidden=false;
      if(el("pfHistSent")) el("pfHistSent").textContent=String(hist.sent);
      if(el("pfHistMoved")) el("pfHistMoved").textContent=String(hist.moved);
    } else { el("pfHistory").hidden=true; } }

  // ---- operations ledger (derived per-operator timeline, filterable, paged) ----
  initOpsLedger();

  // ---- the owner-only infrastructure zone: present for the owner, ABSENT for everyone else ----
  var infra=el("pfInfra");
  if(infra){ if(isOwnerTier()){ infra.hidden=false; } else if(infra.parentNode){ infra.parentNode.removeChild(infra); } }
}
window.initProfile = initProfile;
var __pfNameT=null;
function debounceProfileName(){ var e=document.getElementById("pfName"); if(!e) return; if(__pfNameT) clearTimeout(__pfNameT);
  __pfNameT=setTimeout(function(){ setProfileField("display_name", e.value);
    var av=document.getElementById("pfAvatar"); if(av){ var s=(e.value||profileEmail()||"?").trim(); av.textContent=s? s.charAt(0).toUpperCase() : "?"; } }, 400); }

/* The cadence strip: seven columns, one per day, the daily rhythm of 3 marked by a line across the middle.
   A day that met the rhythm carries the accent. Digits stay Latin inside the isolated .n span. */
function renderCadence(host, series){
  if(!host) return; series=series||[];
  var CAP=6;   // the visual ceiling; the target of 3 sits at the mid mark
  host.innerHTML='<span class="pf-cad-target" aria-hidden="true"></span>'+series.map(function(d){
    var n=d.n||0, h=Math.max(6, Math.round(Math.min(n,CAP)/CAP*100)), hit=(n>=3)?" is-hit":"";
    return '<span class="pf-cad-col'+hit+'"><span class="pf-cad-bar" style="height:'+h+'%"></span>'+
           '<b class="pf-cad-n n">'+esc(String(n))+'</b></span>';
  }).join("");
}

/* The operations ledger render: a derived timeline, one row per action, newest first, filtered by kind and
   revealed a page at a time. The date rides the one composer (fmtWhenHtml, bdi-isolated), so an Arabic
   locale reads a right-to-left row with Latin digits and a correctly placed time. */
var OPS_PAGE=20, __opsKind="all", __opsShown=OPS_PAGE;
function opsOppTitle(slug){ if(!slug) return ""; try{ var d=(typeof getDraft==="function")? getDraft(slug) : null; return (d && d.business) || slug; }catch(e){ return slug; } }
function opsRowHtml(r){
  var icon = r.kind==="send"?"mail" : r.kind==="comment"?"channel" : r.kind==="page"?"globe" : "clock";
  var head = t("pf_op_"+r.kind) || t("pf_op_other");
  var opp = r.opp? ' <span class="pf-op-opp" dir="auto">'+esc(opsOppTitle(r.opp))+'</span>' : '';
  return '<li class="pf-op-row" data-kind="'+esc(r.kind)+'">'+
    '<span class="pf-op-ic" data-icon="'+icon+'" aria-hidden="true"></span>'+
    '<span class="pf-op-main"><span class="pf-op-act">'+esc(head)+'</span>'+opp+'</span>'+
    '<span class="pf-op-when">'+(fmtWhenHtml(r.ts)||esc(String(r.ts||"")))+'</span></li>';
}
function renderOpsLedger(){
  var list=document.getElementById("pfOpsList"); if(!list) return;
  var res=operatorLedger(null, { kind:__opsKind }), all=res.rows;
  var show=Math.min(__opsShown, all.length);
  list.innerHTML=all.slice(0, show).map(opsRowHtml).join("");
  var more=document.getElementById("pfOpsMore"); if(more) more.hidden=(show>=all.length);
  var empty=document.getElementById("pfOpsEmpty"); if(empty) empty.hidden=(all.length>0);
}
function initOpsLedger(){
  __opsKind="all"; __opsShown=OPS_PAGE;
  var filt=document.getElementById("pfOpsFilter");
  if(filt && !filt.__bound){ filt.__bound=true;
    filt.addEventListener("click", function(e){ var b=e.target && e.target.closest && e.target.closest("[data-ops-kind]"); if(!b) return;
      __opsKind=b.getAttribute("data-ops-kind"); __opsShown=OPS_PAGE;
      var tabs=filt.querySelectorAll(".pf-ops-tab"); for(var i=0;i<tabs.length;i++) tabs[i].classList.toggle("is-on", tabs[i]===b);
      renderOpsLedger(); });
  }
  var more=document.getElementById("pfOpsMore");
  if(more && !more.__bound){ more.__bound=true; more.addEventListener("click", function(){ __opsShown+=OPS_PAGE; renderOpsLedger(); }); }
  renderOpsLedger();
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
  /* P23 / Condition 2: the live relay version, always visible in Settings, with what each version lights up.
     Reads the ONE authority (relaySeenVersion, set by every sync/send/check response). A version-gated feature
     is never invisible again: P8's queue, P22's inbound signals, and P23's attachments each show live or
     "waiting for a deploy". Each capability names the version it needs, and the version the relay serves. */
  function renderRelayCaps(){
    const host=el("relayCaps"); if(!host) return;
    const seen=(typeof relaySeenVersion==="function")? relaySeenVersion() : null;
    const CAPS=[
      { key:"cap_send",    need:REQUIRED_RELAY },
      { key:"cap_queue",   need:6 },
      { key:"cap_inbound", need:7 },
      { key:"cap_attach",  need:ATTACH_MIN_RELAY }
    ];
    const verLine=(seen==null)
      ? '<span class="rc-ver rc-unknown">'+esc(t("relay_caps_unknown"))+'</span>'
      : '<span class="rc-ver">'+esc(t("relay_caps_live"))+' <b class="rc-num">v<bdi class="n">'+nIso(seen)+'</bdi></b></span>';
    const rows=CAPS.map(c=>{
      const on=(seen!=null && seen>=c.need);
      return '<li class="rc-cap '+(on?"on":"off")+'">'+
        '<span class="rc-dot">'+(on?ic("check"):ic("clock"))+'</span>'+
        '<span class="rc-name">'+esc(t(c.key))+'</span>'+
        '<span class="rc-need">'+esc(on? t("relay_cap_on") : t("relay_cap_wait").replace("{ver}", String(c.need)))+'</span></li>';
    }).join("");
    host.hidden=false;
    host.innerHTML='<div class="rc-head">'+verLine+'</div><ul class="rc-list">'+rows+'</ul>';
  }
  function connRender(steps, running){
    renderRelayCaps();
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
        ' · <b>'+getSendStamps().length+'</b> '+t("sy_c_stamps")+' · <b>'+getDraftsLocal().length+'</b> '+t("sy_c_opps")+
        ' · <b>'+getEmailTemplates().length+'</b> '+t("sy_c_msgtpl")+
        ' · <b>'+getCustomTemplates().length+'</b> '+t("sy_c_pagetpl")+
        ' · <b>'+nIso(Object.keys(tombs()).length)+'</b> '+t("sy_c_removed")+
        (agree?'<br>'+agree:"")+
        (held.length? '<br><span class="warn-line" data-icon="alert">'+fmtRelative("sy_held",held.length,
          {list: esc(held.map(x=>String(x).replace(/^tpl:/,"")).join("، "))})+'</span>' : "")+
        sizeLine();
    }
    function sySummary(){
      syCounts();
      const last=syncLast();
      if(last){ try{ syShow("✓ "+t("sy_last")+" "+fmtStampTxt(last, {dateStyle:"medium", timeStyle:"short"}), "ok"); return; }catch(e){} }
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
  /* Supabase storage (Stage 1: connection only, inert). Entered here the same way as the relay URL and
     the send endpoint. Saved to the operator's own device; nothing in the read or write path uses it
     yet, so this is shippable and does nothing until Stage 2 wires the dual-write. A failed test shows
     the real error, never a false ok. */
  if(typeof window.ThriveSupa==="object"){
    const S=window.ThriveSupa;
    // The connection (project URL + anon public key) is BAKED into the build (library/config.js), so
    // there is nothing to enter or test here: the manual fields and Save/Test are retired. A tiny
    // read-only line reports the connection; below it, the one-time migrate, the verify, and the
    // signed-out read toggle. The operator sign-in lives in the unlock flow (gate two), not here.
    const connLine=el("sbConnLine");
    if(connLine) connLine.textContent = S.ready()? t("sb_connected") : t("sb_need");
    const vout=el("sbVerifyOut");
    function verifyLine(v){
      if(!vout) return;
      const line=(lbl, o)=>{
        const ok=o.missing.length===0;
        return '<div class="'+(ok?"ok-line":"warn-line")+'">'+(ok?"✓ ":"✕ ")+esc(lbl)+": "+
          esc(t("sb_v_old"))+" "+o.old+" · "+esc(t("sb_v_sup"))+" "+o.sup+
          (o.missing.length? " · "+esc(t("sb_v_missing"))+" "+esc(o.missing.slice(0,6).join(", ")) : "")+'</div>';
      };
      vout.innerHTML=line(t("sb_v_opps"), v.opps)+line(t("sb_v_pages"), v.pages)+
        (v.mail? line(t("sb_v_mail"), v.mail) : "")+(v.inbound? line(t("sb_v_inbound"), v.inbound) : "")+(v.hits? line(t("sb_v_hits"), v.hits) : "")+
        (v.diverge? '<div class="warn-line" data-icon="alert">'+esc(v.diverge+" "+t("sb_v_diverge"))+'</div>' : '')+
        '<div class="'+(v.ok&&!v.diverge?"ok-line":"warn-line")+'">'+(v.ok&&!v.diverge? "✓ "+esc(t("sb_v_agree")) : "✕ "+esc(t("sb_v_disagree")))+'</div>';
    }
    if(el("sbVerify")) el("sbVerify").addEventListener("click", async ()=>{
      if(!S.ready()){ if(vout) vout.innerHTML='<div class="warn-line">'+esc(t("sb_need"))+'</div>'; return; }
      if(vout) vout.innerHTML='<div>'+esc(t("testing"))+'</div>';
      try{ verifyLine(await supaVerify()); }
      catch(e){ if(vout) vout.innerHTML='<div class="warn-line">✕ '+esc(t("sb_fail"))+": "+esc((e&&e.message)||"")+'</div>'; }
    });
    if(el("sbBackfill")) el("sbBackfill").addEventListener("click", ()=> runAction("sbBackfill", { working:t("sb_backfilling"), run: async ()=>{
      if(!S.ready()) throw new Error(t("sb_need"));
      const r=await supaBackfill();
      try{ verifyLine(await supaVerify()); }catch(_){}
      return t("sb_backfill_done").replace("{o}", r.opps).replace("{p}", r.pages).replace("{t}", r.templates)+
        (r.failed? " · "+r.failed+" "+t("sb_v_diverge") : "");
    }}));
    // Stage 3 read switch. On is refused unless the two stores agree; off reverts to this device at once.
    const rstat=el("sbReadStatus");
    function readShow(msg, cls){ if(!rstat) return; rstat.hidden=false; rstat.textContent=msg; rstat.className="gh-result "+(cls||""); }
    function readSrc(){
      const src=el("sbReadSrc"); if(!src) return;
      const st=supaReadStatus();
      const where = st.source==="supabase" ? t("sb_read_src_supa") : t("sb_read_src_local");
      // An auth denial names itself as "sign in", apart from a plain network degrade. Reads fall back to
      // this device meanwhile, so the board is never blank; the message says why and what to do.
      const tail = st.authRequired ? " · "+esc(t("sb_read_auth")) : (st.degraded? " · "+esc(t("sb_read_degraded")) : "");
      src.innerHTML='<b>'+esc(where)+'</b><span>'+esc(t("sb_read_src_l"))+tail+'</span>';
    }
    readSrc();
    if(el("sbReadOn")) el("sbReadOn").addEventListener("click", async ()=>{
      if(!S.ready()){ readShow(t("sb_need"),"warn"); return; }
      readShow(t("testing"),"");
      const r=await supaSetRead(true);
      if(r.ok){ readShow("✓ "+t("sb_read_switched"),"ok"); }
      else if(r.reason==="diverge"){
        const miss=(r.verify&&r.verify.opps&&r.verify.opps.missing||[]).concat(r.verify&&r.verify.pages&&r.verify.pages.missing||[]).slice(0,6);
        readShow("✕ "+t("sb_read_refused")+(miss.length? ": "+miss.join(", ") : ""),"warn");
        try{ verifyLine(r.verify); }catch(_){}
      } else { readShow("✕ "+t("sb_fail")+(r.reason? ": "+r.reason : ""),"warn"); }
      readSrc();
      try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){}
    });
    if(el("sbReadOff")) el("sbReadOff").addEventListener("click", async ()=>{
      await supaSetRead(false);
      readShow("✓ "+t("sb_read_reverted"),"ok");
      readSrc();
      try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){}
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
/* ---------- R16 (P25): the mission model ----------------------------------------------------------
   The Library is organized BY MISSION. A mission is a design family with a ratified base template, a
   human-readable requirements manifest (the checklist an external design must satisfy so it can be
   produced against it and uploaded without breakage), and the pages filed under it. Two missions ship
   seeded: the Prospect Offer (the Signal Brief the page editor already embodies, templates en-opp1 /
   ar-opp1) and the Thrive Monthly Report (a ratified design uploaded against its manifest; it has no
   fill-template in this repo, so its pages arrive as uploads). Additive: missions are stored in one
   synced key, seeded on first read; a page's mission is DERIVED from its template origin (missionOf) so
   nothing is mutated and no page is ever unfiled, and an explicit `mission` field only overrides that
   default when a page is filed through the mission question. Custom missions (a third shelf) append to
   the store. The ratified templates themselves are NOT altered here. */
const MISSIONS_KEY = "thrive_missions_v1";
const MISSION_DEFAULT = "prospect-offer";
// Each manifest item is one requirement, EN + AR, that an external design for the mission must satisfy.
const MISSION_SEED = [
  { id:"prospect-offer", seed:true, name_en:"Prospect Offer", name_ar:"عرض للعميل",
    tagline_en:"The Signal Brief. A respect-first single page sent to one prospect.",
    tagline_ar:"موجز الإشارة. صفحة واحدة تقود بالاحترام، تُرسل إلى عميل واحد.",
    templates:["en-opp1","ar-opp1"],
    manifest:[
      { id:"identity", en:"Identity slots: the business name and the opportunity link (console.thriveiii.com/opp/<slug>).", ar:"خانات الهوية: اسم النشاط ورابط الفرصة (console.thriveiii.com/opp/<slug>)." },
      { id:"blocks",   en:"Required blocks, in order: signal hero, one quote with attribution, three proof points, the gap, the six-part monthly system, one call to action.", ar:"الكتل المطلوبة بالترتيب: رمز إشاري، اقتباس مع نسبته، ثلاث نقاط إثبات، الفجوة، منظومة الأشهر الستة، دعوة واحدة للفعل." },
      { id:"fonts",    en:"Typefaces: the console's Latin face for EN; the Alyamama face for the AR edition.", ar:"الخطوط: خط الكونسول اللاتيني للإنجليزية؛ خط اليمامة للنسخة العربية." },
      { id:"rtl",      en:"RTL: the AR edition mirrors the layout, uses guillemets «», Western numerals, and no letter-spacing on Arabic.", ar:"الاتجاه: تعكس النسخة العربية التخطيط، وتستعمل «» والأرقام الغربية، وبلا تباعد بين الحروف العربية." },
      { id:"overflow", en:"Overflow: one page, no horizontal scroll; every line wraps at any width.", ar:"الفيض: صفحة واحدة بلا تمرير أفقي؛ يلتف كل سطر عند أي عرض." }
    ] },
  { id:"monthly-report", seed:true, name_en:"Thrive Monthly Report", name_ar:"تقرير ثرايف الشهري",
    tagline_en:"The monthly report sent to the Thrive community. A ratified design, uploaded against this manifest.",
    tagline_ar:"التقرير الشهري المُرسل إلى مجتمع ثرايف. تصميم مُعتمد، يُرفع وفق هذا البيان.",
    templates:[],
    manifest:[
      { id:"identity", en:"Identity slots: the Thrive brand header and the report period (the month or range).", ar:"خانات الهوية: ترويسة علامة ثرايف وفترة التقرير (الشهر أو المدى)." },
      { id:"blocks",   en:"Required blocks: the period header, the highlights, the numbers, what shipped, what is next, and the footer.", ar:"الكتل المطلوبة: ترويسة الفترة، أبرز النقاط، الأرقام، ما أُنجز، ما هو قادم، والتذييل." },
      { id:"fonts",    en:"Typefaces: the console's Latin face for EN; the Alyamama face for the AR edition.", ar:"الخطوط: خط الكونسول اللاتيني للإنجليزية؛ خط اليمامة للنسخة العربية." },
      { id:"rtl",      en:"RTL: the AR edition mirrors the layout, uses guillemets «», Western numerals, and no letter-spacing on Arabic.", ar:"الاتجاه: تعكس النسخة العربية التخطيط، وتستعمل «» والأرقام الغربية، وبلا تباعد بين الحروف العربية." },
      { id:"overflow", en:"Overflow: readable on a phone and a desktop; no horizontal scroll at any width.", ar:"الفيض: مقروء على الهاتف والحاسوب؛ بلا تمرير أفقي عند أي عرض." }
    ] }
];
// The store: the seeds, plus any custom missions the operator opened, merged so a seed is never lost and a
// custom mission persists and syncs. Seeded on first read (read-new, fall back to seed) per the memory
// convention. Returns [{ id, name_en, name_ar, templates, manifest, seed?, up? }].
function getMissions(){
  var stored=[];
  try{ stored=JSON.parse(localStorage.getItem(MISSIONS_KEY)||"[]"); }catch(e){ stored=[]; }
  if(!Array.isArray(stored)) stored=[];
  var byId={}; MISSION_SEED.forEach(function(m){ byId[m.id]=Object.assign({}, m); });
  stored.forEach(function(m){ if(m && m.id){ byId[m.id]=Object.assign({}, byId[m.id]||{}, m); } });   // custom overrides/append
  // Seed order first, then custom missions in insertion order.
  var out=MISSION_SEED.map(function(m){ return byId[m.id]; });
  stored.forEach(function(m){ if(m && m.id && !MISSION_SEED.some(function(s){ return s.id===m.id; })) out.push(byId[m.id]); });
  return out;
}
function saveMissions(list){ try{ lsSet(MISSIONS_KEY, JSON.stringify(Array.isArray(list)?list:[])); }catch(e){} }
function getMission(id){ var l=getMissions(); for(var i=0;i<l.length;i++){ if(l[i].id===id) return l[i]; } return null; }
// Add a custom mission (the "new mission" flow). Only the non-seed missions are persisted; the seeds are
// implicit, so the store stays small and a seed can never be corrupted. Idempotent by id.
function addMission(m){
  if(!m || !m.id) return null;
  var stored=[];
  try{ stored=JSON.parse(localStorage.getItem(MISSIONS_KEY)||"[]"); }catch(e){ stored=[]; }
  if(!Array.isArray(stored)) stored=[];
  if(MISSION_SEED.some(function(s){ return s.id===m.id; })) return getMission(m.id);   // never shadow a seed
  var rec={ id:m.id, name_en:m.name_en||m.id, name_ar:m.name_ar||m.name_en||m.id,
            tagline_en:m.tagline_en||"", tagline_ar:m.tagline_ar||"",
            templates:Array.isArray(m.templates)?m.templates:[], manifest:Array.isArray(m.manifest)?m.manifest:[], up:Date.now() };
  var i=stored.findIndex(function(x){ return x && x.id===m.id; });
  if(i>=0) stored[i]=Object.assign({}, stored[i], rec); else stored.push(rec);
  saveMissions(stored);
  return getMission(m.id);
}
function removeMission(id){
  if(MISSION_SEED.some(function(s){ return s.id===id; })) return false;   // a seed is permanent
  var stored=[];
  try{ stored=JSON.parse(localStorage.getItem(MISSIONS_KEY)||"[]"); }catch(e){ stored=[]; }
  if(!Array.isArray(stored)) stored=[];
  saveMissions(stored.filter(function(x){ return x && x.id!==id; }));
  return true;
}
// The one resolver: which mission a page belongs to. An explicit mission wins (set when a page is filed
// through the mission question); else the template origin (en-opp1/ar-opp1 -> prospect-offer); else the
// default. So every page is filed, nothing is ever unfiled, and no record is mutated to achieve it.
function missionOf(o){
  if(!o) return MISSION_DEFAULT;
  if(o.mission && getMission(o.mission)) return o.mission;
  var tp=o.template||"";
  if(tp){ var ms=getMissions(); for(var i=0;i<ms.length;i++){ if((ms[i].templates||[]).indexOf(tp)>=0) return ms[i].id; } }
  return MISSION_DEFAULT;
}
function missionName(m, lang){ if(!m) return ""; return (lang==="ar")? (m.name_ar||m.name_en||m.id) : (m.name_en||m.name_ar||m.id); }
try{ window.getMissions=getMissions; window.getMission=getMission; window.addMission=addMission; window.removeMission=removeMission; window.missionOf=missionOf; window.MISSION_SEED=MISSION_SEED; }catch(_){}

/* ---------- R17 (P26): the daily drop's batch records ------------------------------------------------
   A drop ships more than opportunities: its research-and-messages md, a market assessment, a playbook or
   notes, a README. The ingest ladder (P11..P17) correctly refuses to make cards from those documents, and
   until now they were LOST, though they are the batch's audit trail (sources, freshness, the owner's-eye
   review). One batch record keeps them: { id, date, n, title, documents:[{name,type,text}], slugs:[...] }.
   Every opportunity the drop creates or updates links to the batch id (record.batch_id, stamped in
   toRecord). Additive: one synced key, read newest-first (R6); no document ever becomes a card. */
const BATCHES_KEY="thrive_batches_v1";
function getBatches(){
  var list=[]; try{ list=JSON.parse(localStorage.getItem(BATCHES_KEY)||"[]"); }catch(e){ list=[]; }
  if(!Array.isArray(list)) list=[];
  return list.slice().sort(function(a,b){ return (b.up||0)-(a.up||0) || String(b.date||"").localeCompare(String(a.date||"")); });
}
function getBatch(id){ if(!id) return null; var l=getBatches(); for(var i=0;i<l.length;i++){ if(l[i].id===id) return l[i]; } return null; }
function saveBatch(rec){
  if(!rec || !rec.id) return null;
  var list=[]; try{ list=JSON.parse(localStorage.getItem(BATCHES_KEY)||"[]"); }catch(e){ list=[]; }
  if(!Array.isArray(list)) list=[];
  var i=list.findIndex(function(x){ return x && x.id===rec.id; });
  if(i>=0) list[i]=Object.assign({}, list[i], rec); else list.push(rec);
  try{ lsSet(BATCHES_KEY, JSON.stringify(list)); }catch(e){}
  return rec;
}
// The batch's own number, read from a document's filename or first lines ("Batch 13"), so a re-drop of the
// same numbered batch updates in place instead of piling up. Returns 0 when no number is present.
function batchNumberFrom(documents){
  var docs=documents||[];
  for(var i=0;i<docs.length;i++){
    var m=String(docs[i].name||"").match(/batch[^0-9]*0*(\d+)/i) || String(docs[i].text||"").slice(0,400).match(/batch[^0-9]*0*(\d+)/i);
    if(m) return parseInt(m[1],10);
  }
  return 0;
}
// A numbered batch is idempotent by its number; an unnumbered drop gets a timestamp id so two same-day drops
// stay distinct.
function batchIdFor(n, stamp){ return n>0 ? ("batch-"+n) : ("b-"+(stamp||Date.now()).toString(36)); }
// The opportunities a batch produced, resolved at READ time from the opp store by their stamped batch_id (a
// batch's own slugs list is the authoritative record; this reader lets the view show live business names).
function oppsOfBatch(id, all){
  if(!id) return [];
  return (all||[]).filter(function(o){ return o && o.batch_id===id; });
}
// A small, safe, read-only markdown renderer for a batch document. It ESCAPES everything (no HTML from a
// document ever runs), isolates each line with dir="auto" so an Arabic line reads RTL and a Latin line LTR
// in the same document, and gives headings / list items / fenced code a light treatment. No third-party
// markdown library ships on this console by design.
function inlineMd(s){ return esc(String(s==null?"":s)).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); }
function renderDocMd(text){
  var lines=String(text==null?"":text).split(/\r?\n/), out=[], inCode=false;
  for(var i=0;i<lines.length;i++){
    var raw=lines[i];
    if(/^\s*```/.test(raw)){ if(inCode){ out.push("</pre>"); inCode=false; } else { out.push('<pre class="doc-code" dir="ltr">'); inCode=true; } continue; }
    if(inCode){ out.push(esc(raw)+"\n"); continue; }
    var h=raw.match(/^(#{1,6})\s+(.*)$/);
    if(h){ out.push('<p class="doc-h doc-h'+h[1].length+'" dir="auto">'+inlineMd(h[2])+'</p>'); continue; }
    if(/^\s*[-*]\s+/.test(raw)){ out.push('<p class="doc-li" dir="auto">'+inlineMd(raw.replace(/^\s*[-*]\s+/,""))+'</p>'); continue; }
    if(/^\s*$/.test(raw)){ out.push('<p class="doc-gap"></p>'); continue; }
    out.push('<p class="doc-p" dir="auto">'+inlineMd(raw)+'</p>');
  }
  if(inCode) out.push("</pre>");
  return out.join("");
}
// The i18n label for a document type (research, market, playbook, notes, readme, document).
function docTypeLabel(type){ return t("bdoc_"+(type||"document")) || t("bdoc_document"); }
try{ window.getBatches=getBatches; window.getBatch=getBatch; window.saveBatch=saveBatch; window.batchNumberFrom=batchNumberFrom; window.batchIdFor=batchIdFor; window.oppsOfBatch=oppsOfBatch; window.renderDocMd=renderDocMd; }catch(_){}

/* ---------- R17 (P26): the Batches view ------------------------------------------------------------
   The daily drop, whole. Each batch is listed newest-first (R6) with its documents (rendered read-only on
   demand, RTL safe) and the opportunities it produced. Read-only: this view renders the batch records and
   the opp store, and turns no document into a card. Searchable by date and business. */
async function initBatches(){
  const box=document.getElementById("batchList"); if(!box) return;
  const search=document.getElementById("batchSearch");
  const refresh=document.getElementById("batchRefresh");
  let all=[]; try{ all=await mergedOpps(); }catch(_){ all=[]; }
  const want=(viewParams().get("b")||"").trim();       // an opened batch (from a card's chip): expand it

  function docHtml(d, openIt){
    return '<details class="bdoc"'+(openIt?" open":"")+'><summary class="bdoc-s">'+
      '<span class="bdoc-type">'+esc(docTypeLabel(d.type))+'</span>'+
      '<span class="bdoc-name mono-iso" dir="ltr">'+esc(d.name||"")+'</span></summary>'+
      '<div class="bdoc-body">'+renderDocMd(d.text||"")+'</div></details>';
  }
  function batchHtml(b, opps, openIt){
    const L=getLang();
    const docs=(b.documents||[]);
    const label = b.n>0 ? (esc(t("batches_n"))+" "+nIso(b.n)) : esc(t("batches_drop"));
    const oppChips = opps.length
      ? opps.map(function(o){ return '<button type="button" class="bopp-chip" data-bopp="'+esc(o.slug)+'" dir="auto">'+esc(o.business||o.slug)+'</button>'; }).join("")
      : '<span class="mw-muted">'+esc(t("batches_no_opps"))+'</span>';
    return '<section class="batch'+(openIt?" open":"")+'" data-batch="'+esc(b.id)+'">'+
      '<header class="batch-h"><div class="batch-id"><h2 class="batch-t">'+label+'</h2>'+
        '<span class="batch-date" dir="ltr">'+esc(b.date||"")+'</span></div>'+
        '<div class="batch-counts">'+
          '<span class="batch-count">'+nIso(docs.length)+' '+esc(t("batches_docs"))+'</span>'+
          '<span class="batch-count">'+nIso(opps.length)+' '+esc(t("batches_opps"))+'</span>'+
        '</div></header>'+
      (b.title? '<p class="batch-tag" dir="auto">'+esc(b.title)+'</p>' : '')+
      '<div class="batch-docs">'+(docs.length? docs.map(function(d){ return docHtml(d, openIt); }).join("") : '<p class="mw-muted">'+esc(t("batches_no_docs"))+'</p>')+'</div>'+
      '<div class="batch-opps"><span class="batch-opps-h">'+esc(t("batches_produced"))+'</span><div class="bopp-list">'+oppChips+'</div></div>'+
      '</section>';
  }
  function render(){
    const q=(search&&search.value||"").trim().toLowerCase();
    const batches=getBatches();
    const rows=batches.map(function(b){ return { b:b, opps:oppsOfBatch(b.id, all) }; }).filter(function(r){
      if(!q) return true;
      const hay=[r.b.date, r.b.title, ("batch "+(r.b.n||"")), (r.b.documents||[]).map(function(d){ return d.name+" "+d.type; }).join(" "),
        r.opps.map(function(o){ return o.business||o.slug; }).join(" ")].join(" ").toLowerCase();
      return hay.includes(q);
    });
    if(!rows.length){ box.innerHTML='<div class="empty">'+esc(t(batches.length? "batches_none_match" : "batches_empty"))+'</div>'; return; }
    box.innerHTML=rows.map(function(r){ return batchHtml(r.b, r.opps, want && r.b.id===want); }).join("");
    box.querySelectorAll("[data-bopp]").forEach(function(btn){ btn.addEventListener("click", function(){
      var slug=btn.getAttribute("data-bopp");
      try{ if(window.thriveModal) window.thriveModal.open(slug, "overview", slug); else goTo("compose","slug="+encodeURIComponent(slug)); }catch(_){}
    }); });
    if(want){ var t0=box.querySelector('[data-batch="'+CSS.escape(want)+'"]'); if(t0){ try{ t0.scrollIntoView({block:"start"}); }catch(_){} } }
  }
  if(search) search.addEventListener("input", render);
  if(refresh) refresh.addEventListener("click", async function(){ try{ all=await mergedOpps(); }catch(_){} render(); });
  render();
}
try{ window.initBatches=initBatches; }catch(_){}

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
              · ${fmtRelative("kd_fields", (ct.fields||ThriveKinds.fillableFields(ct.html||"")).length)}
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
      '<p class="kd-line"><b>'+fmtRelative("kd_fields", c.fields.length)+'</b></p>'+
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
    el("et_body").value = rec?(rec.html||""):"Hi {{NAME}},\n\n";   // R14: no embedded sign-off; the signature is appended once by compile
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
function fmtWhen(ts){ return fmtWhenHtml(ts) || esc("–"); }   // isolated date markup (bdi)
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
/* ============================ The Thrive Contact Book (P10) ============================
   One person, one record, findable. The Book is a read-plus-curation LENS over the ledger: the activity
   summary is derived live (buildContacts), the console_contacts overlay carries only curation facts (the
   merge grouping, name, tags, note). Nothing here copies history, so a merge is reversible. */

// The ONE person derivation, shared by Insights (initHome) and the Contact Book, so every summary number
// reconciles by construction. One row per address: sends, token-bearing personal opens, attributed replies,
// last activity, and the personal state. (Extracted verbatim from the Insights person block.)
function derivePeople(){
  const mail=getMailLog();
  const byPerson={};
  mail.forEach(m=>{
    const who=String(m.to||"").toLowerCase(); if(!who) return;
    const r=byPerson[who]||(byPerson[who]={ to:m.to, name:m.toName||"", sent:0, replies:0, opens:0, opps:new Set(), rk:new Set(), last:"", trackable:false, tokens:new Set(), lastOpen:"" });
    if(m.toName && !r.name) r.name=m.toName;
    if(m.status==="sent"||m.status==="copied") r.sent++;
    if(m.direction!=="in"){ const id=String(m.mid||m.id||""); if(/^snd_/.test(id)){ r.trackable=true; r.tokens.add(id); } }
    if(m.direction==="in"||m.status==="replied"){ const k=String(m.opp||"")+"|"+who; if(!r.rk.has(k)){ r.rk.add(k); r.replies++; } }
    if(m.opp) r.opps.add(m.opp);
    if(m.ts>r.last) r.last=m.ts;
  });
  getInbound().forEach(r0=>{
    if(!r0 || r0.kind==="auto" || !r0.opp) return;
    const who=String(r0.from||"").trim().toLowerCase(); if(!who) return;
    const r=byPerson[who]; if(!r) return;
    const k=String(r0.opp)+"|"+who; if(!r.rk.has(k)){ r.rk.add(k); r.replies++; }
    if(r0.ts && String(r0.ts)>String(r.last||"")) r.last=String(r0.ts);
  });
  var tokOwner={}; Object.values(byPerson).forEach(function(r){ r.tokens.forEach(function(tk){ tokOwner[tk]=r; }); });
  allHits().forEach(function(e){
    if(!e || (e.type && e.type!=="open") || e.self || !e.r) return;
    var r=tokOwner[String(e.r)]; if(!r) return;
    r.opens++; var ts=String(e.ts||""); if(ts>r.lastOpen) r.lastOpen=ts; if(ts>String(r.last||"")) r.last=ts;
  });
  const DAY=86400000;
  return Object.values(byPerson).map(r=>{
    const age=r.last? (Date.now()-new Date(r.last).getTime())/DAY : 0;
    r.state = r.replies? "replied" : (!r.trackable? "pretrack" : (r.opens? (age>3? "warm_cold":"warm") : (age>3? "cold":"sent")));
    return r;
  }).sort((a,b)=> b.replies-a.replies || b.opens-a.opens || (a.last<b.last?1:-1));
}
try{ window.derivePeople=derivePeople; }catch(_){}

function contactAddrKey(a){ return bareAddress(a).toLowerCase(); }
var CONTACT_STANDING_TAGS=["client","prospect","partner","personal","test"];
// A domain the typo table names (gmial.com etc) is malformed hygiene; so is an address with no "@".
function addrHygieneBad(a){ a=String(a||"").toLowerCase(); return a.indexOf("@")<0 || !!TYPO_DOMAINS[addrDomain(a)]; }
// A bounce is an inbound auto naming the address (the ONE bounce signal, per recipientState). Bounced-address
// index for a set of addresses, so the Book and the P5 roster paste read the SAME derived bounce truth.
function bouncedAddrSet(addrs){
  var want={}; (addrs||[]).forEach(function(a){ var k=contactAddrKey(a); if(k) want[k]=1; });
  var out={};
  getInbound().forEach(function(r){
    if(!r || r.kind!=="auto" || !r.bounce) return;
    var hay=String((r.snippet||"")+" "+(r.subject||"")+" "+(r.from||"")).toLowerCase();
    Object.keys(want).forEach(function(k){ if(hay.indexOf(k)>=0) out[k]=(r.bounce==="hard"?"hard":(out[k]||"soft")); });
  });
  return out;
}
function addressBounced(addr){ var k=contactAddrKey(addr); if(!k) return ""; var s=bouncedAddrSet([k]); return s[k]||""; }
try{ window.addressBounced=addressBounced; }catch(_){}

/* Build the Book: one record per person. Default is one person per address (derived); a console_contacts row
   overlays, grouping its addresses under one record and carrying the curated name/tags/note. Every activity
   number is derived and summed from the member addresses, never stored. Sorted newest-activity first (R6). */
function buildContacts(){
  var people=derivePeople();
  var byAddr={}; people.forEach(function(r){ byAddr[contactAddrKey(r.to)]=r; });
  var curated=getContacts();
  var owner={};                                       // addr -> curated row that owns it
  curated.forEach(function(c){ (c.addresses||[]).forEach(function(a){ var k=contactAddrKey(a); if(k) owner[k]=c; }); });
  var allAddrs={}; people.forEach(function(r){ allAddrs[contactAddrKey(r.to)]=1; });
  curated.forEach(function(c){ (c.addresses||[]).forEach(function(a){ var k=contactAddrKey(a); if(k) allAddrs[k]=1; }); });
  var bounced=bouncedAddrSet(Object.keys(allAddrs));
  function record(id, addrs, cur){
    addrs=addrs.filter(function(a,i,s){ return a && s.indexOf(a)===i; });
    var members=addrs.map(function(a){ return byAddr[a]; }).filter(Boolean);
    var sent=0,opens=0,replies=0,last=""; var opps={};
    members.forEach(function(m){ sent+=m.sent; opens+=m.opens; replies+=m.replies;
      m.opps.forEach(function(o){ opps[o]=1; });
      if(String(m.last||"")>String(last)) last=String(m.last||""); });
    // the primary display address: the member with the most sends, else the first grouped address
    var primary=addrs[0], best=-1;
    members.forEach(function(m){ if(m.sent>best){ best=m.sent; primary=contactAddrKey(m.to); } });
    var derivedName=""; members.forEach(function(m){ if(!derivedName && m.name) derivedName=m.name; });
    var name=(cur && cur.name && String(cur.name).trim()) || derivedName || primary;
    var addrRows=addrs.map(function(a){ var m=byAddr[a];
      return { addr:a, name:(m&&m.name)||"", bounced:bounced[a]||"", typo:addrHygieneBad(a) }; });
    var nBounced=addrRows.filter(function(x){ return x.bounced; }).length;
    var nTypo=addrRows.filter(function(x){ return x.typo; }).length;
    return { id:id, curated:!!cur, name:name, primary:primary, addrs:addrRows,
      tags:(cur&&cur.tags)||[], note:(cur&&cur.note)||"",
      sent:sent, opens:opens, replies:replies, campaigns:Object.keys(opps).length,
      opps:Object.keys(opps), bounces:nBounced, typos:nTypo, last:last, lastMs:parseTs(last) };
  }
  var recs=[], used={};
  curated.forEach(function(c){
    var addrs=(c.addresses||[]).map(contactAddrKey).filter(Boolean);
    addrs.forEach(function(a){ used[a]=1; });
    recs.push(record(c.id, addrs, c));
  });
  people.forEach(function(r){ var k=contactAddrKey(r.to); if(used[k]) return; used[k]=1;
    recs.push(record("addr:"+k, [k], null)); });
  recs.sort(function(a,b){ return b.lastMs-a.lastMs || (a.name<b.name?-1:(a.name>b.name?1:0)); });
  return recs;
}
try{ window.buildContacts=buildContacts; }catch(_){}

// The merge review: near-dup address clusters not yet grouped by a human. Each is a review ITEM the owner
// confirms; nothing merges on its own. Uses the ONE near-dup predicate (nearDupClusters).
function contactReviewItems(){
  var people=derivePeople();
  var byAddr={}; people.forEach(function(r){ byAddr[contactAddrKey(r.to)]=r; });
  var owned={}; getContacts().forEach(function(c){ (c.addresses||[]).forEach(function(a){ var k=contactAddrKey(a); if(k) owned[k]=1; }); });
  var addrs=Object.keys(byAddr).filter(function(a){ return !owned[a]; });
  var clusters=nearDupClusters(addrs);
  var bounced=bouncedAddrSet(addrs);
  return clusters.map(function(cl){
    var name=""; cl.forEach(function(a){ var m=byAddr[a]; if(!name && m && m.name) name=m.name; });
    return { addrs:cl, suggestName:name,
      members:cl.map(function(a){ var m=byAddr[a]||{};
        return { addr:a, name:m.name||"", sent:m.sent||0, typo:addrHygieneBad(a), bounced:bounced[a]||"" }; }) };
  }).sort(function(a,b){ return b.addrs.length-a.addrs.length; });
}
try{ window.contactReviewItems=contactReviewItems; }catch(_){}

// Curation writes: all go through the ONE Stage-4 queue. A merge groups addresses into a new person record;
// tags/name/note upsert onto the record's row (creating one for a still-derived person). Un-merge deletes.
function contactAuthorStamp(){ var prof=(typeof profileNow==="function" && profileNow())||{};
  return { author:currentActor(), author_name:String(prof.display_name||"").trim() }; }
function mergeContacts(addrs, name){
  addrs=(addrs||[]).map(contactAddrKey).filter(function(a,i,s){ return a && s.indexOf(a)===i; });
  if(!addrs.length) return null;
  var now=new Date().toISOString();
  var c=Object.assign({ id:mintContactId(), addresses:addrs, name:(String(name||"").trim()||null),
    tags:[], note:null, created_at:now, updated_at:now }, contactAuthorStamp());
  contactCachePut(c); try{ logActivity("contact_merge", "", addrs.join(",")); }catch(_){}
  supaMirrorContact(c); return c;
}
try{ window.mergeContacts=mergeContacts; }catch(_){}
function unmergeContacts(id){
  if(!id) return; contactCacheDrop(id); try{ logActivity("contact_unmerge", "", id); }catch(_){}
  supaDeleteContact(id);
}
try{ window.unmergeContacts=unmergeContacts; }catch(_){}
// Upsert curation onto a record (curated row edited in place; a still-derived person gets a fresh row that
// groups its own single address). Reversible: dropping the row returns the person to the derived default.
function saveContactCuration(rec, patch){
  if(!rec) return null;
  var existing=rec.curated ? getContacts().find(function(c){ return c && c.id===rec.id; }) : null;
  var now=new Date().toISOString();
  var base=existing || Object.assign({ id:mintContactId(),
    addresses:(rec.addrs||[]).map(function(x){ return x.addr; }), name:null, tags:[], note:null,
    created_at:now }, contactAuthorStamp());
  var c=Object.assign({}, base, patch, { updated_at:now });
  contactCachePut(c); try{ logActivity("contact_curate", "", c.id); }catch(_){}
  supaMirrorContact(c); return c;
}
try{ window.saveContactCuration=saveContactCuration; }catch(_){}

async function initContacts(){
  const el=id=>document.getElementById(id);
  try{ supaEnsureHydrated(); }catch(_){}
  var state={ q:"", sort:"recent", tag:"" };
  var searchEl=el("contactsSearch"), sortEl=el("contactsSort"), tagsEl=el("contactsTags"),
      reviewEl=el("contactsReview"), listEl=el("contactsList");
  function tagLabel(tag){ var k="contacts_tag_"+tag; var s=t(k); return s===k? tag : s; }
  function chip(text, cls){ return '<span class="cb-chip '+(cls||"")+'">'+esc(text)+'</span>'; }
  function renderReview(){
    if(!reviewEl) return;
    var items=contactReviewItems();
    if(!items.length){ reviewEl.innerHTML=""; return; }
    reviewEl.innerHTML='<div class="cb-review"><h2 class="cb-h">'+esc(t("contacts_review_h"))+
      ' <span class="cb-count"><bdi class="n">'+nIso(items.length)+'</bdi></span></h2>'+
      items.map(function(it,i){
        return '<div class="cb-item" data-ri="'+i+'"><div class="cb-item-people">'+
          it.members.map(function(m){ return '<div class="cb-cand"><b>'+esc(m.name||m.addr)+'</b>'+
            '<span class="mono cb-addr"><bdi>'+esc(m.addr)+'</bdi></span>'+
            (m.typo?' '+chip(t("contacts_typo"),"cb-warn"):"")+
            (m.bounced?' '+chip(t("contacts_bounced"),"cb-warn"):"")+'</div>'; }).join("")+
          '</div><div class="cb-item-act">'+
          '<button class="btn sm cb-merge" data-ri="'+i+'" data-icon="check">'+esc(t("contacts_merge"))+'</button>'+
          '</div></div>';
      }).join("")+'</div>';
  }
  function personMatches(r, q){
    if(!q) return true; q=q.toLowerCase();
    if(String(r.name||"").toLowerCase().indexOf(q)>=0) return true;
    if(r.addrs.some(function(a){ return a.addr.indexOf(q)>=0 || String(a.name||"").toLowerCase().indexOf(q)>=0; })) return true;
    if(r.tags.some(function(tg){ return String(tg).toLowerCase().indexOf(q)>=0 || tagLabel(tg).toLowerCase().indexOf(q)>=0; })) return true;
    if(r.opps.some(function(o){ return String(o).toLowerCase().indexOf(q)>=0; })) return true;
    return false;
  }
  function renderList(){
    if(!listEl) return;
    var recs=buildContacts();
    if(state.tag) recs=recs.filter(function(r){ return r.tags.indexOf(state.tag)>=0; });
    recs=recs.filter(function(r){ return personMatches(r, state.q); });
    if(state.sort==="name") recs=recs.slice().sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
    // tag filter row
    if(tagsEl){
      var counts={}; buildContacts().forEach(function(r){ r.tags.forEach(function(tg){ counts[tg]=(counts[tg]||0)+1; }); });
      var tags=CONTACT_STANDING_TAGS.concat(Object.keys(counts).filter(function(tg){ return CONTACT_STANDING_TAGS.indexOf(tg)<0; }));
      tagsEl.innerHTML=tags.map(function(tg){
        return '<button class="cb-tagf'+(state.tag===tg?" on":"")+'" data-tag="'+esc(tg)+'">'+esc(tagLabel(tg))+
          (counts[tg]?' <bdi class="n">'+nIso(counts[tg])+'</bdi>':"")+'</button>'; }).join("");
    }
    if(!recs.length){ listEl.innerHTML='<div class="empty">'+esc(t("contacts_empty"))+'</div>'; return; }
    listEl.innerHTML='<div class="cb-people">'+recs.map(function(r){
      var addrs=r.addrs.map(function(a){ return '<span class="cb-addr mono'+(a.typo||a.bounced?" bad":"")+'"><bdi>'+esc(a.addr)+'</bdi>'+
        (a.typo?' <span class="cb-flag" title="'+esc(t("contacts_typo"))+'">!</span>':"")+
        (a.bounced?' <span class="cb-flag" title="'+esc(t("contacts_bounced"))+'">⚑</span>':"")+'</span>'; }).join("");
      var tags=r.tags.map(function(tg){ return chip(tagLabel(tg),"cb-tag"); }).join("");
      var opps=r.opps.map(function(o){ return '<button class="cb-opp" data-opp="'+esc(o)+'" data-name="'+esc(r.name)+'">'+esc(o)+'</button>'; }).join("");
      return '<div class="cb-person" data-id="'+esc(r.id)+'">'+
        '<div class="cb-main">'+
          '<div class="cb-id"><b class="cb-name">'+esc(r.name)+'</b>'+
            (r.curated?' '+chip(t("contacts_merged"),"cb-merged"):"")+
            (r.bounces?' '+chip(t("contacts_bounced"),"cb-warn"):"")+
            (r.typos?' '+chip(t("contacts_typo"),"cb-warn"):"")+
            '<div class="cb-addrs">'+addrs+'</div>'+
            (tags?'<div class="cb-tags">'+tags+'</div>':"")+'</div>'+
          '<div class="cb-metrics">'+
            '<span title="'+esc(t("tip_tpl_sent"))+'">'+esc(t("cmp_sent_n"))+' <bdi class="n">'+nIso(r.sent)+'</bdi></span>'+
            '<span title="'+esc(t("tip_opens"))+'">'+esc(t("ins_opens"))+' <bdi class="n">'+nIso(r.opens)+'</bdi></span>'+
            '<span title="'+esc(t("tip_replies"))+'">'+esc(t("cmp_replied_n"))+' <bdi class="n">'+nIso(r.replies)+'</bdi></span>'+
            '<span title="'+esc(t("home_p_dup"))+'">'+esc(t("contacts_campaigns"))+' <bdi class="n">'+nIso(r.campaigns)+'</bdi></span>'+
            '<span class="cb-last mono">'+(r.last?fmtWhen(r.last):'<span class="zero">–</span>')+'</span>'+
          '</div>'+
        '</div>'+
        (opps?'<div class="cb-threads"><span class="cb-threads-l">'+esc(t("contacts_threads"))+'</span>'+opps+'</div>':"")+
        '<div class="cb-curate">'+
          CONTACT_STANDING_TAGS.map(function(tg){ return '<button class="cb-tagtoggle'+(r.tags.indexOf(tg)>=0?" on":"")+'" data-id="'+esc(r.id)+'" data-tag="'+esc(tg)+'">'+esc(tagLabel(tg))+'</button>'; }).join("")+
          (r.curated?'<button class="btn ghost sm cb-unmerge" data-id="'+esc(r.id)+'" data-icon="undo">'+esc(t("contacts_unmerge"))+'</button>':"")+
        '</div>'+
      '</div>';
    }).join("")+'</div>';
  }
  function refresh(){ renderReview(); renderList(); }
  // one record by id (curated id or "addr:k"), from the freshly-built list
  function recById(id){ return buildContacts().filter(function(r){ return r.id===id; })[0]; }
  if(searchEl && !searchEl.__cb){ searchEl.__cb=1; searchEl.addEventListener("input", function(){ state.q=searchEl.value.trim(); renderList(); }); }
  if(sortEl && !sortEl.__cb){ sortEl.__cb=1; sortEl.addEventListener("change", function(){ state.sort=sortEl.value; renderList(); }); }
  if(el("contactsRefresh") && !el("contactsRefresh").__cb){ el("contactsRefresh").__cb=1;
    el("contactsRefresh").addEventListener("click", function(){ try{ __supa.hydrated=false; __supa.degraded=false; supaEnsureHydrated(); }catch(_){}; refresh(); }); }
  if(tagsEl && !tagsEl.__cb){ tagsEl.__cb=1; tagsEl.addEventListener("click", function(ev){
    var b=ev.target.closest && ev.target.closest("[data-tag]"); if(!b) return;
    var tg=b.getAttribute("data-tag"); state.tag=(state.tag===tg?"":tg); renderList(); }); }
  if(reviewEl && !reviewEl.__cb){ reviewEl.__cb=1; reviewEl.addEventListener("click", function(ev){
    var b=ev.target.closest && ev.target.closest(".cb-merge"); if(!b) return;
    var items=contactReviewItems(), it=items[+b.getAttribute("data-ri")]; if(!it) return;
    if(!confirm(t("contacts_merge_confirm"))) return;          // the owner confirms every merge, never silent
    mergeContacts(it.addrs, it.suggestName); refresh(); }); }
  if(listEl && !listEl.__cb){ listEl.__cb=1; listEl.addEventListener("click", function(ev){
    var opp=ev.target.closest && ev.target.closest(".cb-opp");
    if(opp){ try{ window.thriveModal.open(opp.getAttribute("data-opp"), "history", opp.getAttribute("data-name")||""); }catch(_){}; return; }
    var tt=ev.target.closest && ev.target.closest(".cb-tagtoggle");
    if(tt){ var rec=recById(tt.getAttribute("data-id")); if(!rec) return; var tg=tt.getAttribute("data-tag");
      var tags=rec.tags.slice(); var at=tags.indexOf(tg); if(at>=0) tags.splice(at,1); else tags.push(tg);
      saveContactCuration(rec, { tags:tags }); refresh(); return; }
    var un=ev.target.closest && ev.target.closest(".cb-unmerge");
    if(un){ if(!confirm(t("contacts_unmerge_confirm"))) return; unmergeContacts(un.getAttribute("data-id")); refresh(); return; }
  }); }
  refresh();
}
try{ window.initContacts=initContacts; }catch(_){}

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
    p.innerHTML=esc(t("sy_last"))+" "+fmtStampHtml(last, {dateStyle:"medium", timeStyle:"short"}); p.className="pill ok";  // the date is direction-isolated so it never reorders in Arabic
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
    // Replies read the one board derivation, not the mail ledger alone: an attributed inbound reply that
    // lived only in console_inbound was invisible to a ledger count, so the header read 0 while the board
    // and the campaign table read 1. repliesReceived is that shared derivation.
    const replies=repliesReceived();
    const threads=getThreads();
    const contacted=new Set(mail.filter(m=>m.to).map(m=>String(m.to).toLowerCase())).size;
    // Answered reads the same attribution: a thread whose opportunity the board sees replied is answered,
    // even when the reply sits in the inbound store rather than as a ledger row on the thread.
    const answered=threads.filter(th=>th.replied>0 || (th.opp && hasReply(th.opp))).length;
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
      /* Last opened reads from the same source as the Opens count: the after-send open times. Before,
         this column took the last of any page view or send, so a page viewed before the send showed a
         Last opened time while Opens read 0. Now the number and the timestamp always agree. */
      const fs=sendsFor(k).first;
      const ot=fs ? (openTimes()[k]||[]).filter(x=>x>=tsMs(fs)) : [];
      r.lastOpen = ot.length ? new Date(Math.max.apply(null, ot)).toISOString() : "";
      const p=pageBySlug[k]; if(!p) return;
      r.views=p.opens; r.uniq=p.vids.size; r.dwellMs=p.dwellMs; r.dwellN=p.dwellN;
      if(p.lastTs>r.last) r.last=p.lastTs;
    });
    // One shared derivation: the campaign numbers on the Insights row are the exact campaignStats the card
    // header reads, so the two surfaces can never disagree. Views and dwell stay page metrics beside them.
    Object.keys(byOpp).forEach(k=>{ try{ const cs=campaignStats(k);
      byOpp[k].sent=cs.sent; byOpp[k].opens=cs.opens; byOpp[k].uniq=cs.unique; byOpp[k].replies=cs.replies; }catch(_){} });
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
          '<td'+gc("replies",r)+'>'+(r.replies?'<b class="ok-n">'+r.replies+'</b>'+(campaignChildCount(r.slug)?' <span class="mprev" data-tip="'+esc(t("ins_reply_child"))+'" title="'+esc(t("ins_reply_child"))+'">&#8627;</span>':''):'<span class="zero">0</span>')+'</td>'+
          '<td class="mono">'+(r.lastOpen?fmtWhen(r.lastOpen):'<span class="zero">–</span>')+'</td></tr>').join("")+
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
          '<td class="mono">'+(r.last?fmtWhen(r.last):'<span class="zero">–</span>')+'</td></tr>').join("")+
        '</tbody></table></div>'
      : '<div class="empty">'+t("home_tpl_empty")+'</div>';

    /* ---- who is paying attention ----
       One row per person (per address), so a follow-up is a decision about a human rather than about a slug.
       This is the ONE person derivation, shared with the Contact Book (derivePeople), so every summary number
       reconciles with Insights by construction (P4 dictionary, one source). */
    const peopleRows=derivePeople();
    // Flag near-duplicate addresses (typo domains, one-edit) for review in the Contact Book (P10). No merge.
    var dupSet=nearDupAddrs(peopleRows.map(function(r){ return r.to; }));
    el("homePeople").innerHTML = peopleRows.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("home_p_who")+'</th>'+hth(t("cmp_sent_n"),t("tip_tpl_sent"))+hth(t("ins_opens"),t("tip_opens"))+
        hth(t("cmp_replied_n"),t("tip_replies"))+'<th>'+t("home_p_state")+'</th>'+
        hth(t("ins_last"),t("tip_c_last"))+'</tr></thead><tbody>'+
        peopleRows.map(r=>'<tr><td><b>'+esc(r.name||r.to)+'</b>'+
          (dupSet[String(r.to).toLowerCase()]?' <span class="tag tag-warn" data-tip="'+esc(t("home_p_dup"))+'" title="'+esc(t("home_p_dup"))+'">'+esc(t("home_p_dup_short"))+'</span>':"")+
          (r.name?'<div class="mprev mono">'+esc(r.to)+'</div>':"")+'</td>'+
          '<td>'+num(r.sent)+'</td>'+
          '<td>'+(r.opens? num(r.opens) : (r.trackable? '<span class="zero">0</span>' : '<span class="mprev">'+esc(t("ins_pre_token"))+'</span>'))+'</td>'+
          '<td>'+(r.replies?'<b class="ok-n">'+r.replies+'</b>':'<span class="zero">0</span>')+'</td>'+
          '<td><span class="tag tag-st-'+r.state+'">'+esc(t("home_p_"+r.state))+'</span></td>'+
          '<td class="mono">'+(r.last?fmtWhen(r.last):'<span class="zero">–</span>')+'</td></tr>').join("")+
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
          '<td class="mono">'+(r.lastTs?fmtWhen(r.lastTs):"–")+'</td></tr>').join("")+
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
  function fmtDate(ts){ return fmtWhenHtml(ts) || esc("–"); }   // isolated date markup (bdi)

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
        <td>${r.dwellN?fmtDur(r.dwellMs/r.dwellN):"–"}</td><td class="mono">${r.lastTs?fmtDate(r.lastTs):"–"}</td>
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
  const num=v=>nIso(v);   // the one isolated-numeral helper, so every board number is atomic in RTL

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

  /* The warm arrival. The board is "live" once the lanes are actually shown (not the signed-out prompt,
     not the empty state). The first render that reaches that state - a cold open resolving, a sign-in
     landing, the hydrate returning the live board - plays the settle ONCE: the lanes come from a soft blur
     into focus and the count chips tick up to their values over the same half-second. A later poll or badge
     repaint does not replay it (boardLive stays true); a sign-out (back to the prompt) re-arms it. Opacity
     and filter only, and under reduced motion the settle is skipped and the numbers land at their value. */
  let boardLive=false;
  function reducedMotion(){ try{ return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }catch(e){ return false; } }
  function countUp(node, target){
    var to=parseInt(String(target).replace(/[^0-9-]/g,""),10); if(!isFinite(to)) return;
    if(reducedMotion() || to<=0){ node.textContent=String(to); return; }
    var dur=520, t0=null;
    node.textContent="0";
    function step(ts){ if(t0==null) t0=ts; var p=Math.min(1,(ts-t0)/dur);
      var e=1-Math.pow(1-p,3);                 // ease-out: it eases to rest, never a linear crawl
      node.textContent=String(Math.round(to*e));
      if(p<1){ requestAnimationFrame(step); } else { node.textContent=String(to); }
    }
    requestAnimationFrame(step);
  }
  function playBoardArrival(){
    var lanes=document.getElementById("boardLanes");
    if(lanes && !reducedMotion()){ lanes.classList.remove("board-settle"); void lanes.offsetWidth; lanes.classList.add("board-settle"); }
    // The count chips: the pipeline stage figures and the summary chip figures both count up to their value.
    document.querySelectorAll("#boardPipeline .pl-n, #boardChips [data-chip] b").forEach(function(n){
      countUp(n, (n.textContent||"").trim());
    });
  }

  function syncPill(){
    const p=el("boardSync"); if(!p) return;
    const last=syncLast();
    if(!getSyncEndpoint()){ p.textContent=t("home_sync_off"); p.className="pill warn"; return; }
    if(!last){ p.textContent=t("sy_ready"); p.className="pill"; return; }
    p.innerHTML=esc(t("sy_last"))+" "+fmtStampHtml(last, {dateStyle:"medium", timeStyle:"short"}); p.className="pill ok";  // the date is direction-isolated so it never reorders in Arabic
  }

  /* Part 4, the drift self-check on screen. boardDrift counts the visible cards whose local ledger holds a
     send or a reply the server view has not caught up to. When that is nonzero, a small warning badge shows
     the count next to the sync pill, so an incomplete ledger is visible the day it happens. Created lazily
     next to #boardSync so it needs no markup in either shell; hidden (and count cleared) when there is no
     drift. The number is bidi-isolated so it never reorders in Arabic. */
  function driftBadge(){
    var anchor=el("boardSync"); if(!anchor || !anchor.parentNode) return;
    var d; try{ d=boardDrift(); }catch(_){ d={ count:0 }; }
    var badge=document.getElementById("boardDrift");
    if(!d || !d.count){ if(badge) badge.hidden=true; return; }
    if(!badge){
      badge=document.createElement("span");
      badge.id="boardDrift"; badge.className="pill drift"; badge.setAttribute("role","status");
      anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    }
    badge.hidden=false;
    badge.title=txt("board_drift_t", d.count);
    badge.innerHTML=ic("alert",13)+" "+txt("board_drift", d.count);
  }

  /* P22: the inbound heartbeat, on the board. A stalled poll or an unfiled reply must never be silent, so a
     badge shows beside the sync pill the moment inboundHealth() says so: a quiet clock for "inbound delayed"
     (the sweep is stale), a loud alert for a backlog (the sweep hit its cap, or reconciliation found a gap).
     Created lazily beside #boardSync like the drift badge; hidden when inbound is healthy. The count is
     bidi-isolated (txt) so it never reorders in Arabic. */
  function inboundHealthBadge(){
    var anchor=el("boardSync"); if(!anchor || !anchor.parentNode) return;
    var h; try{ h=inboundHealth(); }catch(_){ h=null; }
    var badge=document.getElementById("boardInbound");
    if(!h || (!h.delayed && !h.backlog)){ if(badge) badge.hidden=true; return; }
    if(!badge){
      badge=document.createElement("span");
      badge.id="boardInbound"; badge.setAttribute("role","status");
      anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    }
    badge.hidden=false;
    if(h.backlog){
      badge.className="pill inbound-gap";                 // loud: a reply may be sitting unfiled
      badge.title=t("inbound_gap_t");
      badge.innerHTML=ic("alert",13)+" "+(h.backlog>0 ? txt("inbound_gap", h.backlog) : esc(t("inbound_backlog")));
    } else {
      badge.className="pill inbound-delay";               // quiet but visible: the sweep is stale
      badge.title=t("inbound_delay_t");
      badge.innerHTML=ic("clock",13)+" "+esc(t("inbound_delay"));
    }
  }

  /* Two counts, kept apart on purpose. opens is what answered a message you sent; views is
     every time the page was looked at. A page can be read before anybody was written to, and
     the board says so rather than promoting it into a lane it did not earn. */
  // Brief A: the board model is derived SYNCHRONOUSLY from the pinned authority (the manifest is already
  // cached by renderBoard), so there is no await between resolving the authority and painting, and one
  // generation runs to completion atomically. This is the one derived model every surface of the paint
  // consumes: lane membership and summary.counts are computed here once, so a chip and a lane header can
  // never disagree.
  function build(){
    const opps=mergedOppsSync();
    const opens={}, idle={};
    // ONE source. Stage, opens and idle all come from console_board, so a count and its lane never disagree.
    // A card the view does not hold reads zero opens and zero idle (its base stage is inert). This ctx
    // carries NO mail ledger and NO client opens: the client stage/opens/idle path that raced the view is
    // deleted, not gated, so nothing here re-derives a lane from the local stores.
    opps.forEach(o=>{ opens[o.slug]=boardViewOpens(o.slug); idle[o.slug]=boardViewIdle(o.slug)||0; });
    const model=ThriveBoard.build(opps, { opens:opens, idle:idle });
    /* Part 1: the reply itself surfaces as its OWN card in the Replied lane, beside its parent opportunity.
       These are a presentation of the confirmed replies (repliesForOpp -> resolvedReplyOpp, the one link)
       attached to a parent the SERVER view already placed in Replied; they derive no stage and are NOT
       counted as opportunities, so the lane count stays the parent cards and chips = lane header = count.
       Each carries a snippet and its Gmail key (gid) so a tap opens the thread straight at that reply. */
    try{
      (model.lanes.replied||[]).forEach(function(tk){
        tk.replies=repliesForOpp(tk.slug).map(function(x){
          var row=getInbound().filter(function(r){ return inboundKey(r)===x.gid; })[0];
          return { gid:x.gid, from:x.from, name:(row&&row.name)||x.from, num:x.num,
                   snippet:row ? String(row.snippet||row.subject||"").replace(/\s+/g," ").trim().slice(0,110) : String(x.subject||"") };
        });
      });
    }catch(_){}
    return model;
  }

  function tokenHtml(tk){
    const cls=["tok"];
    // THE ONE VISUAL-STATE LAW (Part 2). cardState gives one state; the token wears at most one emphasis class
    // plus data-state (the single hook every surface reads). The lane-literal glow (is-glow) and the
    // standalone is-hot / is-provisional treatments are retired, so emphasis never fires without a state.
    const state = cardState(tk);
    const STATE_CLASS = { "failed":"is-failed", "in-flight":"is-sending", "new-activity":"has-reply", "awaiting-action":"is-stalled" };
    if(STATE_CLASS[state]) cls.push(STATE_CLASS[state]);
    const sending = (state==="in-flight");   // the visible outbox marker for an unconfirmed send
    // The meta line stays in the paragraph direction so the words read correctly; only the
    // digits inside it are isolated, by .n, never the whole line.
    let meta;
    // The failed state speaks first: a delivered send whose row was never recorded says so plainly, with the
    // retry offered in the card (see renderOverview). This is the one meta that overrides the lane text.
    if(state==="failed") meta=txt("tok_unrecorded");
    else if(tk.lane==="draft") meta=txt("tok_nopage");
    else if(tk.lane==="live"){
      // A view is a recipient opening a link WE SENT, so a card can carry a recipient view only if a
      // delivered send exists. The server-computed open_count (tk.opens, from console_board) is already
      // send-gated, so a live card (no send) reads zero: "no email yet", never the impossible "no email
      // yet, one view". Read from the same view that set the lane, so the count and the lane cannot disagree.
      const rv=tk.opens||0;
      meta = rv>0 ? fmtRelative("tok_views", rv) : txt("tok_noemail");
    }
    else if(tk.lane==="replied") meta=txt("tok_answered");
    else if(tk.opens>0) meta=fmtRelative("tok_opens", tk.opens);
    else meta=fmtRelative("tok_idle", tk.age);
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
    const sendMark = sending
      ? '<span class="tok-sending" role="status" title="'+esc(t("tok_sending_t"))+'">'+esc(t("tok_sending"))+'</span>'
      : '';
    // Part 3: the reply-count badge. Reads the confirmed, server-hydrated replies resolved to this parent
    // (repliesForOpp), so its number is the same one the inbox and the card's reply list show. Gated on the
    // resolved lane: a card the board places at draft or ready shows no reply badge, so the badge never
    // contradicts the lane that the one authority assigned.
    const repN = (tk.lane!=="draft" && tk.lane!=="live") ? replyCountFor(tk.slug) : 0;
    const repMark = repN>0
      ? '<span class="tok-replies" title="'+esc(txt("tok_replies", repN))+'">'+ic("mail",11)+txt("tok_replies", repN)+'</span>'
      : '';
    return '<div class="tok '+cls.slice(1).join(" ")+'" data-slug="'+esc(tk.slug)+'" data-lane="'+esc(tk.lane)+'" data-state="'+esc(state)+'">'+
      '<button class="tok-open" type="button">'+
        '<span class="tok-name">'+(tk.offer? ic("spark",13) : "")+esc(tk.biz)+'</span>'+
        '<span class="tok-meta">'+meta+repMark+sendMark+chMark+'</span>'+
      '</button>'+
      '<button class="tok-more" type="button" aria-haspopup="menu" aria-label="'+esc(t("mv_menu"))+'">'+ic("chevron")+'</button>'+
      '<span class="tok-grip" aria-hidden="true">'+ic("drag")+'</span>'+
      '</div>';
  }

  /* Part 1: one reply row. A distinct element (not a .tok, so it never enters the opportunity count, the
     drag order, or the .tok selectors), carrying the sender, its per-opportunity number and a one-line
     snippet, and data-rid so a tap opens the thread straight at this reply. The latest carries a mark.
     It never sets its own width or inset: it stretches inside its .reply-group column, so it is always
     contained within the Replied lane, never bleeding past the edge. */
  function replyLaneCardHtml(tk, rep, markLatest){
    var who=esc(rep.name||rep.from||t("th_someone"));
    var snip=rep.snippet ? '<span class="reply-card-snip" dir="auto">'+esc(rep.snippet)+'</span>' : '';
    var num=rep.num ? '<span class="reply-card-num" aria-hidden="true">#'+esc(String(rep.num))+'</span>' : '';
    var mark=markLatest ? '<span class="reply-card-latest">'+esc(t("rp_latest"))+'</span>' : '';
    return '<button type="button" class="reply-card'+(markLatest?" is-latest":"")+'" data-slug="'+esc(tk.slug)+'" data-rid="'+esc(rep.gid||"")+'" '+
      'aria-label="'+esc(t("reply_card_a11y")+" "+(rep.name||rep.from||""))+'">'+
      '<span class="reply-card-mark" aria-hidden="true">'+ic("channel",13)+'</span>'+
      '<span class="reply-card-body">'+
        '<span class="reply-card-top">'+num+mark+'<span class="reply-card-who" dir="auto">'+who+'</span></span>'+
        snip+
      '</span></button>';
  }
  /* Finding 2: ONE grouped reply card per parent, bounded regardless of reply count, so twenty replies never
     stack twenty cards down the lane. It shows a header count and the LATEST reply in full; the earlier
     replies fold behind a single native <details> expander ("show N earlier replies") that opens in place
     and collapses again, with the earlier list bounded (max-height + scroll). One reply shows just that
     reply, no expander. Per-opportunity numbering (#1..#N) with the latest marked, the same numbers the
     inbox shows. The whole group is inset under its parent and contained inside the column. */
  function replyGroupHtml(tk){
    var reps=(tk.replies||[]); if(!reps.length) return "";
    var latest=reps[reps.length-1], earlier=reps.slice(0, reps.length-1);
    var head='<div class="reply-group-head">'+ic("channel",12)+'<span>'+esc(txt("tok_replies", reps.length))+'</span></div>';
    var featured=replyLaneCardHtml(tk, latest, earlier.length>0);
    var more="";
    if(earlier.length){
      more='<details class="reply-group-more"><summary>'+esc(txt("reply_earlier", earlier.length))+'</summary>'+
        '<div class="reply-group-list">'+earlier.map(function(rep){ return replyLaneCardHtml(tk, rep, false); }).join("")+'</div>'+
        '</details>';
    }
    return '<div class="reply-group" data-slug="'+esc(tk.slug)+'">'+head+featured+more+'</div>';
  }

  /* The board paints in place, stable. A card is placed by the render exactly where it belongs and
     fades in quietly (the .enter opacity fade), never sliding across the board from a prior position:
     a full re-render (a hydrate, a sign-in, a refresh) settles calmly, not in a scramble. A drag keeps
     its own live-follow motion (.is-drag), which is a direct user action, not an arrival. */
  /* Brief A: the one serialized orchestrator (F2). Every trigger, sign-in, unlock, hydrate, refresh button,
     queue drain, interval, mutation, and thriveBoardRefresh, calls renderBoard. It stamps a generation,
     awaits the manifest ONCE (the only async gap), and if a newer generation has started while it waited it
     returns without painting: the LATEST generation wins, not the last async build to resolve, the exact
     reversal of the oscillation. Past the manifest gate it resolves ONE authority (F1), pins it for the
     whole synchronous derive-and-paint so no accessor re-chooses the source and no derivation reads a live
     global (F3) or a stale TTL cache (F4), then unpins. If the board is not mounted (a heartbeat firing on
     another screen) it does nothing (F16). */
  var __boardTornDown=false;
  async function renderBoard(trigger){
    const myGen=++__renderGen;
    try{ await ensureManifest(); }catch(_){}
    try{ reconcileStuckSending(undefined, true); }catch(_){}          // enforce the sending timeout before painting (silent: this paint reads the fresh state)
    if(myGen!==__renderGen || __boardTornDown) return;              // superseded by a newer paint, or the board left
    if(!document.getElementById("boardLanes")) return;              // not mounted: a sync heartbeat on another screen
    // Never paint the empty base wholesale while the view is still loading (the racing loser that read Sent
    // 0). When the view is authority (a signed-in operator) but has NOT loaded, this settle reads and adopts
    // it BEFORE painting, generation-guarded so a read resolving after a newer settle is dropped. Once
    // loaded, the sync/hydrate rounds refresh it; renders paint the warm map with no network read.
    if(boardViewIsAuthority() && !__boardViewReady){
      var rows=null; try{ rows=await readBoardViewRows(); }catch(_){ rows=null; }
      if(myGen!==__renderGen || __boardTornDown) return;           // a newer settle started while we read: drop this one
      adoptBoardView(rows);
    }
    const source=resolveAuthority();
    __boardPin=source;
    try{
      render(trigger, source);
    } finally { __boardPin=null; }
  }

  function render(trigger, source){
    // P29 boot watchdog signal: the board is actually painting (render runs only AFTER renderBoard's bounded
    // reads resolve), so the console is up. If a read had hung forever, render would never be reached and the
    // 20s watchdog would offer a way out. The gate sets this too when a sign-in card shows.
    try{ window.__thriveBooted = true; }catch(_){}
    syncPill();
    driftBadge();
    inboundHealthBadge();
    const b=build();
    // Sentinel Sweep 5, Layer 1: stamp this paint (no-op unless ?debug=paint or the localStorage switch is on).
    try{ ThrivePaintDebug.stamp("board", b, { trigger:trigger, src:(source&&source.kind) }); }catch(_){}

    ThriveBoard.LANES.forEach(k=>{
      const body=document.querySelector('[data-body="'+k+'"]');
      const count=document.querySelector('[data-count="'+k+'"]');
      if(count) count.textContent=b.lanes[k].length;
      const tabCount=document.querySelector('[data-count-tab="'+k+'"]');
      if(tabCount) tabCount.textContent=b.lanes[k].length;
      if(!body) return;
      /* P3/R6: every lane sorts by recency, newest activity on top, from the one shared clock
         (lastActivityAt). No lane-specific sort, no manual pinning, no exceptions: the device-stored manual
         order is retired so a card with new activity always rises rather than being held down by an old
         arrangement. A malformed timestamp sorts last (lastActivityAt returns 0), never throws. */
      var __la={}; b.lanes[k].forEach(function(t){ __la[t.slug]=lastActivityAt(t.slug); });
      b.lanes[k].sort(function(x,y){ return (__la[y.slug]||0)-(__la[x.slug]||0); });
      body.innerHTML = b.lanes[k].length
        /* T4: a card in an actionable lane (a reply just in, or ready to send) carries
           the glow. glowChanged is called for every card in every lane so a later move
           INTO replied or live is seen as a change and plays one cycle; other lanes just
           record the card's position and show no glow. It reads the lane the causal
           status put the card in, so it marks a fact, not a guess. */
        ? b.lanes[k].map((tk,i)=>{
            // Part 2: the parallel lane-literal glow (is-glow / is-glow-new, driven by the lane key and a
            // position signature, not by a named card state) is RETIRED here. All card emphasis now comes from
            // the one visual-state law in tokenHtml (cardState -> data-state), so a reply waiting for you is
            // 'new-activity' (the green glow) and nothing fires on a bare lane change. Only the arrival fade
            // (opacity, not emphasis) is spliced in for the first three cards.
            const enter=i<3 ? "enter enter-"+(i+1)+" " : "";
            var out=tokenHtml(tk).replace('class="tok ', 'class="tok '+enter);
            // Part 1 + Finding 2: in Replied, the parent is followed by ONE bounded grouped reply card (the
            // latest reply plus an expander for the rest), not a stack (not counted, not a .tok).
            if(k==="replied" && tk.replies && tk.replies.length){ out+=replyGroupHtml(tk); }
            return out;
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
    const vLine=fmtRelative(v.key, v.n);
    const vNew=glowChanged("counter", v.key+":"+v.n) ? " is-glow-new" : "";
    el("boardVerdict").innerHTML = '<span class="vtext'+vNew+'">'+vLine+'</span>';
    // The hero subtitle speaks about the SAME state the headline is in, never another's line: the old
    // selection keyed the subtitle on b.summary.stalled alone, so a reply hero with any stalled card wore
    // "Untouched for N days or more." Selection and copy only, the count and recency come from the existing
    // derivations (the reply records, the opens map); the verdict logic and its thresholds are untouched.
    function heroDaysAgo(baseKey, days, extra){
      extra = extra || {};
      if(days===0) return txt(baseKey+"_today", 0, extra);
      extra.days = num(days);
      return txt(baseKey, days, extra);
    }
    function latestReplyDetail(){
      var rows=[];
      getInbound().forEach(function(r){ if(r && r.kind!=="auto" && r.opp && r.ts) rows.push({ name:String(r.name||"").trim(), from:r.from, ts:r.ts }); });
      getMailLog().forEach(function(m){ if(m && (m.direction==="in" || m.status==="replied") && m.ts) rows.push({ name:String(m.toName||"").trim(), from:m.to, ts:m.ts }); });
      if(!rows.length) return null;
      rows.sort(function(a,c){ return String(c.ts).localeCompare(String(a.ts)); });
      var r=rows[0], nm=r.name;
      if(!nm){ var a=bareAddress(r.from||""); nm=(a.split("@")[0]||a); }
      return { name:nm, days:Math.max(0, daysSince(r.ts)) };
    }
    function latestOpenDays(){
      var m=(typeof openTimes==="function")? openTimes() : {}, best=0;
      Object.keys(m).forEach(function(k){ (m[k]||[]).forEach(function(ms){ if(ms>best) best=ms; }); });
      return best? Math.max(0, Math.floor((Date.now()-best)/86400000)) : null;
    }
    var subHtml;
    if(v.key==="vd_replied"){ var rd=latestReplyDetail();
      subHtml = rd ? heroDaysAgo("vd_sub_replied", rd.days, {name:esc(rd.name)}) : txt("vd_sub_none"); }
    else if(v.key==="vd_opened"){ var od=latestOpenDays();
      subHtml = (od!=null) ? heroDaysAgo("vd_sub_opened", od) : txt("vd_sub_none"); }
    else if(v.key==="vd_stalled"){
      subHtml = fmtRelative("vd_sub_stalled", ThriveBoard.STALL_DAYS); }
    else subHtml = txt("vd_sub_none");
    el("boardVerdictSub").innerHTML = subHtml;

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
      txt("chip_stalled", b.summary.stalled, {d:nIso(ThriveBoard.STALL_DAYS)})+' <b>'+nIso(b.summary.stalled)+'</b></button>');
    chips.push('<button class="chip" data-chip="sends">'+txt("chip_sends", left)+' <b>'+nIso(left)+'</b></button>');
    if(b.archived) chips.push('<button class="chip" data-chip="archived">'+txt("chip_archived")+' <b>'+nIso(b.archived)+'</b></button>');
    el("boardChips").innerHTML=chips.join("");
    el("boardChips").querySelectorAll("[data-chip]").forEach(c=>c.addEventListener("click",()=>{
      const k=c.getAttribute("data-chip");
      if(k==="stalled") goTo("library","followup=1");
      else if(k==="archived") goTo("library","status=archived");
      else goTo("compose");
    }));

    const bounced=b.closed.bounced||[], failed=b.closed.failed||[], dropped=b.closed.dropped||[];
    // Dropped joins won/lost/bounced/failed: a closed card of any kind is countable and reachable,
    // never a row that vanishes from the board with no way back to it.
    const closed=b.closed.won.concat(b.closed.lost, dropped, bounced, failed);
    el("trayCount").textContent=closed.length;
    /* Every closed card is a real control that opens its window, so a finished card stays
       retrievable rather than being a dead label. A reply that arrived after the card closed is
       marked here (a quiet dot) so it surfaces on the board without silently reopening the card;
       opening it offers the one-tap reopen. */
    const trayItem=(o,cls,title)=>{
      const reply=cardHasConversation(o.slug);
      return '<button type="button" class="tray-item '+cls+(reply?' has-reply':'')+'" data-tray-open data-slug="'+esc(o.slug)+'"'+
        (title?' title="'+esc(title)+'"':'')+(reply?' aria-label="'+esc((o.business||o.slug)+": "+t("tray_reply"))+'"':'')+'>'+
        esc(o.business||o.slug)+(reply?'<span class="tray-dot" aria-hidden="true"></span>':'')+'</button>';
    };
    el("trayList").innerHTML = closed.length
      ? b.closed.won.map(o=>trayItem(o,"won","")).join("")+
        b.closed.lost.map(o=>trayItem(o,"lost","")).join("")+
        dropped.map(o=>trayItem(o,"dropped",t("stage_dropped"))).join("")+
        bounced.map(o=>trayItem(o,"bounced",t("stage_bounced"))).join("")+
        failed.map(o=>trayItem(o,"failed",t("stage_failed"))).join("")
      : '<div class="lane-empty">'+ic("archive",18)+'<p>'+esc(t("tray_empty"))+'</p></div>';

    // A signed-out read from Supabase (an empty 200 after the anon door closes, or a 401/403) is a call
    // to sign in, not an empty board. The prompt replaces the whole board so a locked store never reads
    // as data loss, even when this device was cleared and has nothing to fall back to. A degrade (relay
    // or network) is not this: it keeps falling back to the device, so authRequired is the only trigger.
    // The prompt is only ever the SIGNED-OUT state (#84): once an operator is signed in it is never shown,
    // even in the brief window before the sign-in hydrate resolves a stale authRequired. A signed-in
    // operator lands on the board (local cards until the hydrate lands, then the live board), never here.
    // authRequired is now session-aware at its source (supaReadStatus ANDs in !supaSignedIn()), so the board
    // reads the one signal instead of re-deciding the session here: one signed-in state machine, one prompt.
    const authReq = supaReadStatus().authRequired;
    if(authReq){
      // The header band must not say "a quiet board" over a locked store. It names the state instead.
      el("boardVerdict").innerHTML='<span class="vtext">'+esc(t("board_auth_h"))+'</span>';
      el("boardVerdictSub").innerHTML='';
      if(el("boardBadge")) el("boardBadge").innerHTML=ic("lock",20);
    }
    const empty=b.summary.total===0 && closed.length===0 && !authReq;
    if(el("boardAuth")) el("boardAuth").hidden=!authReq;
    el("boardEmpty").hidden=!empty;
    el("boardLanes").hidden=empty||authReq;
    // P40: one of the three board states (auth prompt / empty / lanes) has now been decided and shown, so
    // the boot has PAINTED. The failsafe watchdog reads this flag; set it here means a healthy boot never
    // trips the stall panel. Assignment only, no behavior change.
    try{ window.__bootPainted=true; window.__bootMark="board painted"; }catch(_){}
    if(el("boardTabs")) el("boardTabs").hidden=empty||authReq;
    if(el("boardPipeline")) el("boardPipeline").hidden=empty||authReq;   // all zeros is noise on an empty board
    el("boardChips").hidden=empty||authReq;
    el("boardTray").hidden=empty||authReq;

    // The warm arrival fires the first time the real board is on screen (lanes shown, not the prompt and
    // not the empty state), and once per arrival only: a signed-in operator lands on a board that settles
    // into focus and counts up, never a dead gap. Re-arms if the board later returns to the prompt.
    const boardShown = !authReq && !empty;
    if(boardShown && !boardLive){ try{ playBoardArrival(); }catch(_){} }
    boardLive = boardShown;

    // A token opens the whole opportunity: what it is, its text, its page, its outreach, and
    // what has happened to it.
    document.querySelectorAll(".tok-open").forEach(btn=>btn.addEventListener("click",()=>{
      const tk=btn.closest(".tok");
      const slug=tk.getAttribute("data-slug");
      const name=(tk.querySelector(".tok-name")||{}).textContent||slug;
      // In the shell the work opens in one centred window. On a single page there is no
      // window, and an honest page change beats a panel that is not there.
      // A card with new activity opens ON that update (the badge leads to what it announced); opening also
      // marks it seen, clearing the badge. A quiet card opens the overview as before.
      if(window.thriveModal){
        var tgt=null; try{ if(cardNewActivity(slug)>0) tgt=cardNewTarget(slug); }catch(_){}
        if(tgt){ window.thriveModal.open(slug, tgt.tab, name, { kind:tgt.kind, id:tgt.id }); }
        else window.thriveModal.open(slug, "overview", name);
        try{ markCardSeen(slug); paintCardBadges(); }catch(_){}
      } else goTo("compose","slug="+encodeURIComponent(slug));
    }));

    // Part 2: tapping a reply card opens the conversation thread scrolled STRAIGHT to that reply (not the
    // cold overview), with the guiding pulse (highlightTarget -> .th-flash, reduced-motion respected), so
    // reading and answering is one smooth motion. It opens the parent's thread, keyed by the reply's gid.
    document.querySelectorAll(".reply-card").forEach(btn=>btn.addEventListener("click",()=>{
      const slug=btn.getAttribute("data-slug"); if(!slug) return;
      const rid=btn.getAttribute("data-rid")||"";
      let name=slug; try{ const pr=getDraft(slug); if(pr&&pr.business) name=pr.business; }catch(_){}
      if(window.thriveModal){
        window.thriveModal.open(slug, "history", name, { kind:"reply", id:rid });
        try{ markCardSeen(slug); paintCardBadges(); }catch(_){}
      } else goTo("compose","slug="+encodeURIComponent(slug));
    }));

    // A closed card in the tray opens its window like any other card, so a finished opportunity is
    // retrievable, its reply is readable, and the reopen is one tap away.
    document.querySelectorAll("#trayList [data-tray-open]").forEach(btn=>btn.addEventListener("click",()=>{
      const slug=btn.getAttribute("data-slug"); if(!slug) return;
      const name=(btn.textContent||slug).trim();
      if(window.thriveModal) window.thriveModal.open(slug, "overview", name);
      else goTo("compose","slug="+encodeURIComponent(slug));
    }));
    try{ paintCardBadges(); refreshInboxBadge(); }catch(_){}   // quiet badges, repainted every render
  }

  // New opens or replies on a card since it was last opened show a small badge; the lane header sums them.
  // Last-seen is local presentation state, so this never changes what a card IS, only whether it glows.
  function paintCardBadges(){
    var laneNew={};
    document.querySelectorAll('#boardLanes .tok[data-slug]').forEach(function(tk){
      var slug=tk.getAttribute("data-slug"); var n=0; try{ n=cardNewActivity(slug); }catch(e){}
      var b=tk.querySelector(".card-badge");
      if(n>0){ if(!b){ b=document.createElement("span"); b.className="card-badge"; tk.appendChild(b); }
        b.textContent=String(n); b.hidden=false;
        var lane=tk.closest("[data-body]"); if(lane){ var k=lane.getAttribute("data-body"); laneNew[k]=(laneNew[k]||0)+n; } }
      else if(b){ b.hidden=true; }
    });
    document.querySelectorAll('#boardLanes [data-count]').forEach(function(c){
      var k=c.getAttribute("data-count"), n=laneNew[k]||0, ln=c.parentNode.querySelector(".lane-new");
      if(n>0){ if(!ln){ ln=document.createElement("span"); ln.className="lane-new"; c.parentNode.appendChild(ln); } ln.textContent=String(n); ln.hidden=false; }
      else if(ln){ ln.hidden=true; }
    });
  }
  function refreshInboxBadge(){
    var badge=document.getElementById("boardInboxBadge"); if(!badge) return;
    var n=0; try{ n=unmatchedHuman().length; }catch(e){}    // human only; automated is folded into noise
    if(n>0){ badge.textContent=String(n); badge.hidden=false; } else { badge.hidden=true; }
  }

  // The tray is a posture, not a decision, so it stays on this device and never syncs.
  const BOARD_PREF="thrive_board_v1";
  function pref(){ try{ return JSON.parse(localStorage.getItem(BOARD_PREF)||"{}"); }catch(e){ return {}; } }
  function setPref(p){ try{ localStorage.setItem(BOARD_PREF, JSON.stringify(p)); }catch(e){} try{ opPrefRemember("board", p); }catch(e){} }
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
    renderBoard("refresh-button");
  });
  // P24: the top-bar Send (board toolbar and the Insights toolbar, both class js-send-open) opens the
  // two-path chooser. With no card in context it lists the sendable opportunities to choose from; from a
  // card, the card's own Send passes the slug straight through.
  document.querySelectorAll(".js-send-open").forEach(b=>b.addEventListener("click", ()=>{ try{ openSendChooser(null); }catch(e){ toast(errText(e)); } }));

  // The replies inbox opens from the header. It is the one attribution surface; Settings only diagnoses
  // the relay now. Rendering it re-runs the badge count so an attach or a re-match updates the header.
  const inboxBtn=el("boardInboxBtn"), inbox=el("boardInbox"), inboxBody=el("boardInboxBody");
  if(inboxBtn && inbox) inboxBtn.addEventListener("click", ()=>{
    const open=inbox.hidden;
    inbox.hidden=!open; inboxBtn.setAttribute("aria-expanded", open?"true":"false");
    if(open) renderInboxInto(inboxBody, ()=>{ renderBoard("inbox"); refreshInboxBadge(); });
  });

  // Freshness on the board rides the ONE live-sync heartbeat (startLiveSync: a single 60s poll that
  // pulls the reply transport when the tab is visible and signed in) plus the "sync" hook below, which
  // re-renders the board and repaints its quiet badges on every completed round. A second 90s poll used
  // to run here too, pulling the same transport and repainting the same badges that render() already
  // repaints (paintCardBadges/refreshInboxBadge, above): two overlapping loops of one transport, and an
  // extra board render every 90s for nothing. It is removed; the 60s heartbeat is more frequent and
  // covers it, so no freshness is lost and the board polls once, not twice.
  try{ if(window.__boardPoll){ clearInterval(window.__boardPoll); window.__boardPoll=null; } }catch(_){}

  // Brief A: every trigger enters through the ONE serialized orchestrator, never the raw render. A late
  // generation from any of these is dropped by renderBoard's generation guard, so the latest state wins.
  onThrive("lang","board",()=>renderBoard("lang"));
  onThrive("sync","board",()=>renderBoard("sync"));
  onThrive("unlock","board",()=>renderBoard("unlock"));
  /* One way back to a fresh board. A lifecycle move changes what the lanes should say, and
     without this the board kept showing what was true before the click: the record was right,
     the model was right, and the screen was wrong, which is the worst of the three. */
  window.thriveBoardRefresh=function(){ return renderBoard("thriveBoardRefresh"); };
  // Brief A (F16): if the board is torn down and re-entered, drop the stale listeners first so a heartbeat
  // never re-reads through a detached board. Registration is keyed, so this also prevents any stacking.
  window.__boardTeardown=function(){ __boardTornDown=true; offThrive("lang","board"); offThrive("sync","board"); offThrive("unlock","board"); };
  initIntake();
  renderSyncBand();
  refreshRollup();
  initCardMenu();
  initCardDrag();
  await renderBoard("init");
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
    fmtRelative("loc_count",n)+
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
    : fmtRelative("st_stale_n",n);
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

/* The reply attribution surface: held human replies with a one-tap attach picker, the collapsed noise,
   and the console-side re-match. It moved from Settings to the board (opened from the header badge), so
   there is ONE surface that writes an attachment, not two. Rendered into whatever host it is given. */
function renderInboxInto(host, after){
  if(!host) return;
  const all=getInbound();
  const real=all.filter(r=>r && r.kind!=="auto");
  const unmatched=inboundUnmatched();
  const humanUn=unmatchedHuman();                          // the same derivation the header badge uses
  const noiseUn=unmatched.filter(r=>inboundIsNoise(r));
  const done=()=>{ renderInboxInto(host, after); try{ if(typeof after==="function") after(); }catch(_){} };

  let h='<p class="st-line"><b>'+esc(t("rp_have"))+'</b> <span class="n">'+real.length+'</span> '+
        esc(t("rp_of_which"))+' <span class="n">'+humanUn.length+'</span> '+esc(t("rp_unmatched_n"))+
        (noiseUn.length? ' · <span class="n">'+noiseUn.length+'</span> '+esc(t("rp_noise_n")) : '')+'</p>';
  h+='<div class="bar"><button class="btn sm" id="rpRematch" type="button">'+esc(t("rp_rematch_btn"))+'</button></div>';
  // Part 3: the attached replies, grouped by parent opportunity and numbered in arrival order. Each number
  // is the same one on the parent card's badge and in the card's reply list (repliesForOpp is the one
  // numbering), and each row opens its parent card, so the inbox and the card are explicitly linked.
  var oppsWithReplies=getDraftsLocal().filter(function(o){ return o && o.slug && !o.archived && replyCountFor(o.slug)>0; })
    .sort(function(a,b){ return String(a.business||a.slug).localeCompare(String(b.business||b.slug)); });
  if(oppsWithReplies.length){
    h+='<p class="st-line"><b>'+esc(t("rp_by_opp"))+'</b></p><ul class="rp-byopp">'+
      oppsWithReplies.map(function(o){
        return repliesForOpp(o.slug).map(function(x){
          return '<li class="rp-byopp-row" data-open-slug="'+esc(o.slug)+'" data-open-name="'+esc(o.business||o.slug)+'" tabindex="0" role="button">'+
            '<span class="rp-num">#'+esc(String(x.num))+'</span>'+
            '<span class="rp-byopp-who mono-iso">'+ltr(esc(x.from))+'</span>'+
            '<span class="rp-byopp-opp" dir="auto">'+esc(o.business||o.slug)+'</span></li>';
        }).join("");
      }).join("")+'</ul>';
  }
  if(humanUn.length){
    const opps=getDraftsLocal().filter(o=>o&&o.slug).slice()
      .sort((a,b)=>String(a.business||a.slug).localeCompare(String(b.business||b.slug)));
    const optHtml='<option value="">'+esc(t("rp_attach_pick"))+'</option>'+
      opps.map(o=>'<option value="'+esc(o.slug)+'">'+esc(o.business||o.slug)+'</option>').join("");
    h+='<p class="st-line"><b class="st-miss">'+esc(t("rp_unmatched_h"))+'</b></p><ul class="rp-held">'+
      humanUn.slice(0,20).map(r=>{ const gid=inboundKey(r);
        return '<li class="rp-held-row"><div class="rp-held-who"><span class="mono-iso">'+ltr(esc(r.from))+'</span>'+
          '<span class="rp-held-subj">'+esc((r.subject||"").slice(0,60))+'</span></div>'+
          '<div class="rp-attach"><select class="input sm rp-attach-sel">'+optHtml+'</select>'+
          '<button class="btn ghost sm rp-attach-btn" type="button" data-gid="'+esc(gid)+'">'+esc(t("rp_attach_btn"))+'</button></div></li>';
      }).join("")+'</ul>';
  }
  if(noiseUn.length){
    h+='<details class="rp-noise"><summary>'+esc(t("rp_noise_h"))+' <span class="n">'+noiseUn.length+'</span></summary><ul class="st-keys">'+
      noiseUn.slice(0,20).map(r=>'<li><span class="mono-iso">'+ltr(esc(r.from))+'</span>'+
        '<span>'+esc((r.subject||"").slice(0,60))+'</span></li>').join("")+'</ul></details>';
  }
  h+='<div id="rpInboxOut" class="st-line"></div>';
  host.innerHTML=h;

  const rm=host.querySelector("#rpRematch");
  if(rm) rm.addEventListener("click", ()=>{
    const o0=host.querySelector("#rpInboxOut"); if(o0) o0.textContent=t("rp_working");
    let res=null;
    try{ res=rematchHeld(); }
    catch(e){ const o=host.querySelector("#rpInboxOut"); if(o) o.textContent="✕ "+t("rp_rematch_err")+" "+((e&&e.message)||""); return; }
    const o=host.querySelector("#rpInboxOut");
    if(o){
      var line=t("rp_rematch_done").replace("{m}", res.matched).replace("{u}", res.held)+
        (res.spawned? " · "+res.spawned+" "+t("rp_spawned") : "");
      // Never a hollow success: a match made while not signed in is saved on this device and queued,
      // not yet on the Supabase-read board, so it says so and points to the one action that syncs it.
      if(res.pendingSupa) line+=" · "+t("rp_rematch_local");
      o.textContent=line;
    }
    done();
  });
  host.querySelectorAll(".rp-byopp-row").forEach(function(row){
    var open=function(){ var slug=row.getAttribute("data-open-slug"); if(!slug) return;
      var name=row.getAttribute("data-open-name")||slug;
      if(window.thriveModal) window.thriveModal.open(slug, "history", name);
      else goTo("compose","slug="+encodeURIComponent(slug)); };
    row.addEventListener("click", open);
    row.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } });
  });
  host.querySelectorAll(".rp-attach-btn").forEach(btn=>btn.addEventListener("click", ()=>{
    const gid=btn.getAttribute("data-gid");
    const sel=btn.parentNode.querySelector(".rp-attach-sel");
    const slug=sel && sel.value;
    if(!slug){ const o=host.querySelector("#rpInboxOut"); if(o) o.textContent=t("rp_attach_need"); return; }
    if(attachReply(gid, slug)){
      try{ spawnChildrenFromReplies(); }catch(_){}
      // A manual attach is a write too: say when it is device-only and queued, never a silent local loss.
      const o=host.querySelector("#rpInboxOut");
      if(o) o.textContent = (supaOn() && !supaSignedIn()) ? t("rp_attach_local") : t("rp_attach_done");
      done();
    }
  }));
}

/* Settings keeps the relay diagnostics only now (scan health, counts, measure). The reply attribution
   surface lives on the board; a pointer says so, so nobody hunts for it here. */
function renderRepliesPanel(){
  const host=document.getElementById("rpPanel");
  if(!host) return;
  const scan=inboxScanInfo();
  const when=ts=>fmtWhenHtml(ts) || esc(String(ts==null?"":ts));   // isolated date markup (bdi)

  let h='<p class="st-line">'+esc(t("rp_on_board"))+'</p>';
  h+= scan
    ? '<p class="st-line">'+esc(t("rp_last_scan"))+' '+when(scan.ts)+
      ' · <span class="n">'+(scan.ms||0)+'</span> ms</p>'
    : '<p class="st-line st-miss">'+esc(t("rp_never_scanned"))+'</p>';
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
/* An opportunity must have an end it can reach from the card. WO-015 §5.2 held these three
   outcome moves back from what a person can click, on the reasoning that an outcome should be read
   rather than asserted and that "won" waits for a contracts module. This brief reverses that: a
   board where a card can only ever be archived has no terminus, so cards accumulate with no
   won/lost/no-fit end. Won, Lost and No-fit (drop) are reachable now, each through movePrompt, which
   already asks Lost for its reason from the list and No-fit for its free text; Won is the outcome
   itself and asks for none. Each move is still guarded by the lifecycle table (Won only from a card
   that went out, and so on) and each is UNDOABLE, so a misclick is one tap back. The set stays as an
   empty map rather than being deleted, so a later decision to gate a specific outcome has one place. */
const RETIRED_MOVES = {};
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

  // P14: the board's "Today's batch" drop is the SAME path as the editor upload - one resolver
  // (ThriveIntake.readBatch -> resolveBatch), one shared report renderer (mountIngestReport). The old
  // readDrop + review() path is retired. The board never hosts a page (host:false), so every approved
  // opportunity lands as a Draft; a needs-message row keeps its one-tap Write action.
  let batch=null;
  function status(msg, kind){ out.innerHTML='<p class="in-status '+(kind||"")+'">'+esc(msg)+'</p>'; }
  function clear(){ batch=null; out.innerHTML=""; input.value=""; }
  function render(){
    mountIngestReport(out, batch, {
      onDiscard: clear,
      onApprove: async (b)=>{
        const tally=await ingWriteRows(b, false);
        logActivity("in_batch", "", tally.imported+" imported, "+tally.updated+" updated, "+
          tally.incomplete+" without text, "+tally.failed+" failed");
        clear();
        try{ scheduleSyncPush(); }catch(_){}
        if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
        return importResultMsg(tally, 0);
      },
      onWrite: async (b)=>{
        await ingWriteRows(b, false);
        clear();
        try{ scheduleSyncPush(); }catch(_){}
        if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
      }
    });
  }
  async function take(files){
    if(!files || !files.length) return;
    status(t("in_reading"));
    try{
      const existingRecords=await mergedOpps();                 // full records, so re-drop can heal a ghost card
      batch=await ThriveIntake.readBatch(files, { existing:oppExistingMeta(existingRecords), existingSlugs:existingRecords.map(o=>o.slug), existingRecords:existingRecords });
    }catch(e){
      status(/zip|inflate/i.test((e&&e.message)||"") ? t("in_zip_err") : t("in_none"), "warn"); return;
    }
    if(!batch || !batch.report.rows.length){ status(t("in_none"), "warn"); batch=null; return; }
    render();
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
  onThrive("lang","intake", ()=>{ if(batch) render(); });
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

/* R11 (P18): the ONE universal contact reader, at module scope so the Communication tab, the composer, and
   the Contact Book all resolve a channel through the SAME functions. A record imported under P18 carries
   o.channels in the R11 shape {type,value,platform,handle,tier,tier_basis,source,primary}; a legacy record
   is read into the SAME shape from its old scattered fields, so there is one model and no second store. */
function chTypeOf(kind){ var k=String(kind||"").toLowerCase();
  if(k==="email") return "email"; if(k==="web_form"||k==="form") return "form";
  if(k==="whatsapp") return "whatsapp"; if(k==="phone"||k==="tel") return "phone";
  if(["instagram","x","twitter","tiktok","facebook","linkedin"].indexOf(k)>=0) return "social"; return "other"; }
function chPlatformOf(kind){ var k=String(kind||"").toLowerCase();
  return ["instagram","x","twitter","tiktok","facebook","linkedin"].indexOf(k)>=0 ? (k==="twitter"?"x":k) : ""; }
function contactChannels(o){
  if(o && Array.isArray(o.channels) && o.channels.length) return o.channels;
  var out=[], c=(o&&o.channel)||{}, tier=((o&&o.contact_tier)||"").toUpperCase();
  var email=(c.kind==="email"&&c.to)? bareAddress(c.to) : ((o&&o.email)? bareAddress(o.email) : (/@/.test(String(c.to||""))? bareAddress(c.to):""));
  if(email) out.push({ type:"email", value:email, platform:"", handle:"", tier:tier||"", tier_basis:tier?"stated":"", source:"legacy", primary:true });
  if(c.kind && c.kind!=="email" && c.to) out.push({ type:chTypeOf(c.kind), value:c.to, platform:chPlatformOf(c.kind), handle:"", tier:tier||"", tier_basis:"", source:"legacy", primary:!email });
  ((o&&o.channel_alternates)||[]).forEach(function(a){ if(a&&a.channel&&a.channel!=="email") out.push({ type:chTypeOf(a.channel), value:a.url||"", platform:chPlatformOf(a.channel), handle:"", tier:"", tier_basis:"", source:"legacy", primary:false }); });
  return out;
}
function primaryEmailChannel(o){ var cs=contactChannels(o); return cs.find(function(c){return c.primary&&c.type==="email";}) || cs.find(function(c){return c.type==="email";}) || null; }
function primaryChannel(o){ var cs=contactChannels(o); return cs.find(function(c){return c.primary;}) || cs[0] || null; }
function emailAddress(o){ var c=primaryEmailChannel(o); return c? bareAddress(c.value) : ""; }

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

  const PANELS={ overview:"modalOverview", text:"modalText", outreach:"modalOutreach", history:"modalHistory", discussion:"modalDiscussion" };
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
    if(st==="bounced") return t("stage_bounced");
    if(st==="failed") return t("stage_failed");
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

  /* ---- a reply that arrived after the card was closed ---------------------
     A closed card does not silently reopen when a reply lands on it: the derivation holds the
     terminus (effStage returns won/lost/dropped verbatim, before the reply branch). Instead the
     reply surfaces here, with one-tap reopen. The notice is the confirmation, so the reopen it
     performs passes confirmed:true rather than raising a second dialog on top of it. */
  function closedReplyNotice(o){
    if(!o) return "";
    var st=resolvedStage(o);                               // the one authority: the same stage the board lane read
    var closed=ThriveLifecycle.CLOSED_STAGES.indexOf(st)>=0;
    if(!closed || !cardHasConversation(o.slug)) return "";
    return '<div class="mw-reopen" role="status">'+
      '<span class="mw-reopen-txt">'+esc(t("lc_reopen_notice"))+'</span>'+
      '<button type="button" class="btn sm" data-reopen="'+esc(o.slug)+'">'+esc(t("lc_reopen"))+'</button>'+
      '</div>';
  }
  /* The 'failed' visual state, spelled out: a send whose email left but whose row was never recorded within
     the timeout. It offers the one retry (retry the RECORD, not the relay POST), so the operator is never
     stuck watching an endless 'sending'. It uses the failed accent, so the card modal reads the same state
     the board token wears. */
  function unrecordedNotice(o){
    if(!o || !cardUnrecorded(o.slug)) return "";
    return '<div class="mw-unrec" role="alert">'+
      '<div class="mw-unrec-h">'+esc(t("mw_unrecorded_h"))+'</div>'+
      '<div class="mw-unrec-b">'+esc(t("mw_unrecorded_b"))+'</div>'+
      '<button type="button" class="btn sm" data-retryrec="'+esc(o.slug)+'">'+esc(t("mw_retry_record"))+'</button>'+
      '</div>';
  }

  /* ---- the moves bar -----------------------------------------------------
     Only the moves that are legal from where this record actually stands. Illegal ones are
     absent rather than disabled: a person should not have to read greyed options to work out
     the rules, and a rule you learn by reading disabled controls is a rule you learn wrong. */
  /* The terminal outcomes are the Closed states plus retire-page; they read as ONE designed control.
     Everything else that is legal (convert, and the recover/advance moves) is a promotion, never a
     sibling of the closing set, so it sits apart and above. This is presentation only: every choice keeps
     its data-move and still routes through bindMoves -> movePrompt -> runMove, so the lifecycle logic from
     the terminus PR is unchanged. */
  const CLOSE_MOVES=["mark_won","mark_lost","drop","archive","retire_page"];
  /* Minimal inline SVGs, drawn in-repo in the icon set's language (24 box, 1.6 stroke, round, currentColor),
     one per terminal outcome. Inline rather than through the sprite so the symbol set stays fixed, and each
     carries explicit width and height. */
  function ocIcon(m){
    const A='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
    const Z='</svg>';
    if(m==="mark_won")    return A+'<circle cx="12" cy="12" r="9"/><path d="M8.4 12.4l2.6 2.6 4.6-5.6"/>'+Z;      // a check in a ring
    if(m==="mark_lost")   return A+'<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'+Z;             // a cross in a ring
    if(m==="drop")        return A+'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'+Z;                        // a minus in a ring
    if(m==="archive")     return A+'<rect x="4" y="5" width="16" height="4" rx="1"/><path d="M5.5 9v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>'+Z;   // an archive box
    if(m==="retire_page") return A+'<path d="M14 3H8a2 2 0 0 0-2 2v9"/><path d="M14 3v5h5"/><path d="M6 20L20 6"/>'+Z;   // a page, struck through
    return "";
  }
  function movesBar(o){
    if(!o) return "";
    const legal=ThriveLifecycle.movesFor(o).filter(m=> m!=="send_email" && m!=="send_offchannel" && !RETIRED_MOVES[m]);
    if(!legal.length) return "";
    const closeMoves=CLOSE_MOVES.filter(m=> legal.indexOf(m)>=0);
    const advance=legal.filter(m=> CLOSE_MOVES.indexOf(m)<0);   // convert, publish, record_reply, restore, unarchive, reopen
    const primary={ convert:1, publish:1, record_reply:1, restore:1, unarchive:1, reopen:1 };
    let html='<div class="mw-outcome">';
    // Promotion / recover: primary-styled, above, apart from the closing set.
    if(advance.length){
      html+='<div class="mw-advance">'+advance.map(m=>
        '<button type="button" class="btn '+(primary[m]?"":"ghost ")+'sm" data-move="'+esc(m)+'">'+
        esc(t("lc_"+m))+'</button>').join("")+'</div>';
    }
    // The one outcome control: a labeled section, each terminal choice icon-led with a one-line description.
    if(closeMoves.length){
      html+='<section class="mw-sec mw-close"><h4 class="mw-h">'+esc(t("lc_close_h"))+'</h4>'+
        '<div class="close-set">'+closeMoves.map(m=>
          '<button type="button" class="close-opt close-'+esc(m)+'" data-move="'+esc(m)+'">'+
            '<span class="close-ic" aria-hidden="true">'+ocIcon(m)+'</span>'+
            '<span class="close-txt"><span class="close-label">'+esc(t("lc_"+m))+'</span>'+
            '<span class="close-desc">'+esc(t("lc_"+m+"_d"))+'</span></span>'+
          '</button>').join("")+'</div></section>';
    }
    // R12 (P19): delete is a record removal, not a lifecycle move. A zero-history draft can be hard-deleted
    // (حذف); a card that carries ledger history can only be archived, and the menu says so in one honest line.
    // The delete never cascades into console_mail / console_hits / console_inbound - the ledger is the truth.
    if(canHardDelete(o)){
      html+='<div class="mw-del"><button type="button" class="close-opt close-delete mw-del-btn" data-del="'+esc(o.slug)+'">'+
        '<span class="close-ic" aria-hidden="true">'+ic("trash")+'</span>'+
        '<span class="close-txt"><span class="close-label">'+esc(t("lc_delete"))+'</span>'+
        '<span class="close-desc">'+esc(t("lc_delete_d"))+'</span></span></button></div>';
    } else {
      html+='<div class="mw-del"><p class="mw-note mw-del-why">'+ic("lock")+esc(t("lc_delete_why"))+'</p></div>';
    }
    return html+'</div>';
  }
  // R12: the delete flow. One confirmation that NAMES the card, then a hard delete (tombstoned, undoable),
  // gated so a history-bearing card can never reach here. removeDraftUndoable removes the opp record and its
  // board row and queues the console_opps / console_pages delete; it never touches the ledger tables.
  async function deleteOppFlow(o){
    if(!o || !canHardDelete(o)) return;                       // the gate is the law, not just the hidden control
    const name=o.business||o.slug;
    if(!confirm(t("lc_delete_confirm").split("{name}").join(name))) return;
    removeDraftUndoable(o.slug, name);
    logActivity("lc_delete", o.slug, name);
    close(true);
    if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh();
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
    // R12: the delete control is bound here too, so the window and the card menu ask the same one question.
    box.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=> deleteOppFlow(o)));
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
  /* R11 (P18): the ONE contact reader lives at module scope (contactChannels / primaryEmailChannel /
     emailAddress, defined near lcChannelLabel). This tab, the composer, and the Contact Book all read the
     channel list through those same functions, so there is one model and no second store. */
  function channelChoices(o){
    const seen={}, out=[];
    contactChannels(o).filter(c=>c.type!=="email").forEach(c=>{
      const kind=c.platform||c.type; if(seen[kind]) return; seen[kind]=1;
      out.push({ kind:kind, url:c.value||"" });
    });
    return out;
  }
  // The channel's display type and value, RTL-safe: a social handle reads @handle, everything else its value.
  function chTypeLabel(c){
    if(c.type==="social" && c.platform){ const k="ocm_pf_"+c.platform; return t(k)!==k? t(k) : c.platform; }
    const k="ocm_type_"+c.type; return t(k)!==k? t(k) : c.type;
  }
  function chValueDisp(c){ return (c.type==="social" && c.handle) ? "@"+c.handle : (c.value||""); }
  function chTierChip(c){
    if(!c.tier) return "";
    const basis=c.tier_basis==="sighted"? t("ocm_basis_sighted") : c.tier_basis==="inferred"? t("ocm_basis_inferred") : t("ocm_basis_stated");
    return '<span class="oc-tier is-'+esc(c.tier_basis||"stated")+'"><bdi class="n">'+esc(t("ocm_tier"))+' '+esc(c.tier)+'</bdi> '+esc(basis)+'</span>';
  }
  // The full channel list: type icon, value, tier chip with basis, primary marker, and a one-tap Confirm for
  // a research-stated tier (flips basis to sighted after Thyab verifies) - never auto-upgraded.
  // R11 channel type -> an existing sprite glyph (the sprite has no phone/form/social-specific icon).
  function chIcon(c){ return c.type==="email"? "mail" : c.type==="social"? "globe" : "channel"; }
  function channelListHtml(o){
    const cs=contactChannels(o);
    if(!cs.length) return '<section class="mw-sec"><h4 class="mw-h">'+ic("channel")+esc(t("ocm_ch_h"))+'</h4><p class="mw-note">'+esc(t("och_no_channels"))+'</p></section>';
    const rows=cs.map((c,i)=>
      '<li class="oc-ch'+(c.primary?" is-primary":"")+'">'+
        ic(chIcon(c),18)+
        '<span class="oc-ch-type">'+esc(chTypeLabel(c))+'</span>'+
        '<span class="oc-ch-val mono-iso" dir="ltr">'+esc(chValueDisp(c))+'</span>'+
        chTierChip(c)+
        (c.primary?'<span class="oc-primary">'+esc(t("ocm_primary"))+'</span>':'')+
        (c.tier_basis==="stated"?'<button type="button" class="btn ghost sm oc-confirm" data-ci="'+i+'">'+esc(t("ocm_confirm"))+'</button>':'')+
      '</li>').join("");
    return '<section class="mw-sec"><h4 class="mw-h">'+ic("channel")+esc(t("ocm_ch_h"))+'</h4><ul class="oc-chs">'+rows+'</ul></section>';
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
    /* R11 (P18): email is offered when a Tier A email channel exists - stated or sighted. A stated tier is
       shown "Tier A per research, confirm" in the channel list below; the choice to send is still Thyab's. */
    const emailCh=primaryEmailChannel(o);
    const tierA=!!(emailCh && String(emailCh.tier||"").toUpperCase()==="A");
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
    h+=channelListHtml(o);                              // R11: the full channel list, every type, with tiers
    box.innerHTML=h;
    box.querySelectorAll("[data-path]").forEach(b=>b.addEventListener("click", async ()=>{
      saveDraft({ slug:o.slug, outreach_path:b.getAttribute("data-path") });
      logActivity("och_path", o.slug, b.getAttribute("data-path"));
      /* Re-entering the tab rather than re-rendering the panel, because the
         answer decides whether the composer is adopted at all. */
      await reread();
      await switchTo("outreach");
    }));
    // Confirm a research-stated tier: Thyab has verified the address, so its basis flips to sighted. Never
    // auto-upgraded; only this tap does it. The channel list is the one store, so we write it back whole.
    box.querySelectorAll(".oc-confirm").forEach(b=>b.addEventListener("click", async ()=>{
      const i=+b.getAttribute("data-ci");
      const cs=contactChannels(o).map(c=>Object.assign({}, c));
      if(cs[i]){ cs[i].tier_basis="sighted"; }
      saveDraft({ slug:o.slug, channels:cs, contact_tier:(cs.find(c=>c.primary)||cs[0]||{}).tier||o.contact_tier });
      logActivity("och_tier_confirm", o.slug, cs[i]? cs[i].type : "");
      /* reread refreshes the module record and re-renders this same channel-question screen
         (the outreach path is still empty), so the confirmed basis shows without a second call. */
      await reread();
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
    const st=resolvedStage(o);                             // the one authority: the Overview State row equals the board lane
    const age=(typeof ThriveBoard!=="undefined" && ThriveBoard.ageDays)
      ? ThriveBoard.ageDays(o, { mail:getMailLog() })
      : daysSince(o.sent_on);
    const rows=[];
    rows.push(row(t("mw_o_slug"), ltr(o.slug)));
    rows.push(row(t("mw_o_state"), '<span class="mw-state mw-state-'+esc(st)+'">'+esc(stageName(st))+'</span>'));
    // The age carries a number, so it goes through the plural rule rather than a flat template:
    // Arabic inflects the noun after the count and "3 يوم" is not Arabic.
    rows.push(row(t("mw_o_age"), fmtRelative("tok_days",age)));
    if(o.location) rows.push(row(t("mw_o_where"), esc(o.location)));
    if(o.template) rows.push(row(t("mw_o_tpl"), esc(o.template)));
    if(o.sent_on) rows.push(row(t("mw_o_made"), ltr(o.sent_on)));
    // R17 (P26): a quiet "from batch <date>" chip. The card never carries the documents; the chip opens the
    // Batches view for this drop, where its documents render read-only on demand. The date is isolated LTR so
    // an Arabic phrase never reverses the Western numerals.
    if(o.batch_id && getBatch(o.batch_id)) rows.push(row(t("mw_o_batch"),
      '<button type="button" class="mw-batch-chip" data-batchopen="'+esc(o.batch_id)+'">'+ic("page",13)+
      '<span class="mw-batch-d" dir="ltr">'+esc(o.batch_date||o.batch_id)+'</span></button>'));
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
    // A group card carries its recipients panel and campaign aggregate; a spawned child links back to its
    // campaign. Both read the one P1.5 derivation, so these numbers are the Insights numbers.
    var extra="";
    if(isGroupOpp(o)) extra+=campaignControlHtml(o)+recipientsPanelHtml(o);   // P8: the in-flight campaign control sits above the roster
    if(o.spawned_from && o.spawned_from.parent) extra+=spawnedFromHtml(o);
    else extra+=rosterEditorHtml(o);                        // P5: the roster editor (D3), any non-child opp can build a campaign
    // P24: the explicit Send, offered from the card. It opens the two-path chooser (one brief / a campaign),
    // which routes into the existing composer or campaign screen. Hidden for a child card (it answers its
    // parent's campaign) and while a campaign is already in flight (the control below owns that).
    var canSend = !(o.spawned_from && o.spawned_from.parent) && !(o.campaign && o.campaign.state==="sending");
    var sendBar = canSend ? '<div class="ov-send"><button type="button" class="btn ov-send-btn" data-sendchoose="'+esc(o.slug)+'">'+ic("send")+esc(t("send_which_cta"))+'</button></div>' : "";
    box.innerHTML=prohibitionBand(o)+recordNotes(o)+unrecordedNotice(o)+closedReplyNotice(o)+
      '<dl class="mw-rows">'+rows.join("")+'</dl>'+sendBar+extra+movesBar(o);
    try{ markCardSeen(o.slug); }catch(_){}                 // opening the card clears its badge (local only)
    box.querySelectorAll("[data-sendchoose]").forEach(b=>b.addEventListener("click", ()=>{
      try{ openSendChooser(b.getAttribute("data-sendchoose"), o.business||o.slug); }catch(e){ toast(errText(e)); }
    }));
    try{ wireRosterEditor(box, o); }catch(_){}              // P5 roster editor handlers (paste / CSV / add / edit / remove)
    // The one retry for a failed send: retry the RECORD (not the relay POST). It re-enqueues the confirmed
    // write and flushes; the modal re-renders so the state reflects the outcome.
    box.querySelectorAll("[data-retryrec]").forEach(b=>b.addEventListener("click", ()=>{
      try{ retryRecord(b.getAttribute("data-retryrec")); }catch(_){}
      try{ if(window.thriveModal && window.thriveModal.reread) window.thriveModal.reread(); }catch(_){}
    }));
    box.querySelectorAll("[data-batchopen]").forEach(b=>b.addEventListener("click", ()=>{
      try{ if(window.thriveModal && window.thriveModal.close) window.thriveModal.close(); }catch(_){}
      try{ goTo("batches","b="+encodeURIComponent(b.getAttribute("data-batchopen"))); }catch(_){}
    }));
    box.querySelectorAll("[data-ovcopy]").forEach(b=>b.addEventListener("click", async ()=>{
      var okc=await copyToClipboard(liveUrl(b.getAttribute("data-ovcopy")));
      var old=b.textContent; b.textContent=t("ac_copied"); setTimeout(()=>{ b.textContent=old; }, 1600);
      if(!okc) actionStatus("err", t("act_err_unknown"));
    }));
    var openCard=function(slug){ if(window.thriveModal) window.thriveModal.open(slug, "overview", slug);
      else goTo("compose","slug="+encodeURIComponent(slug)); };
    // P8: pause holds the campaign's un-sent tail; resume re-queues it with fresh jitter. The client sets
    // state and tells the relay; it never paces. Re-read so the panel reflects the new truth at once.
    var reread=function(){ try{ if(window.thriveModal && window.thriveModal.reread) window.thriveModal.reread(); }catch(_){} };
    box.querySelectorAll(".cq-pause").forEach(b=>b.addEventListener("click", ()=>{ try{ pauseCampaign(b.getAttribute("data-slug")); }catch(_){} reread(); }));
    box.querySelectorAll(".cq-resume").forEach(b=>b.addEventListener("click", ()=>{ try{ resumeCampaign(b.getAttribute("data-slug")); }catch(_){} reread(); }));
    box.querySelectorAll(".rc-open").forEach(b=>b.addEventListener("click", ()=>openCard(b.getAttribute("data-child"))));
    box.querySelectorAll(".open-parent").forEach(b=>b.addEventListener("click", ()=>openCard(b.getAttribute("data-parent"))));
    // The reply notice reopens on one tap; the notice already said what it does, so it does not ask again.
    box.querySelectorAll("[data-reopen]").forEach(b=>b.addEventListener("click", async ()=>{
      await runMove("reopen", b.getAttribute("data-reopen"), { confirmed:true });
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
    // The thread only: each message escaped and direction-isolated. The reply composer is no longer a bare
    // textarea rendered here; it is the full send editor, borrowed into #modalHost beneath this list by
    // switchTo (reply mode), so a reply has the same formatting, templates and preview as an outreach send.
    // When there is no address to answer, a gentle line stands in for the composer.
    // P21: the History tab is the card's activity trail (newest-first, quiet, no chrome). Each entry carries
    // its actor and time; a send or reply is a tappable entry that expands IN PLACE to its full message,
    // rendered through the one P12 bubble path (thSentBubble / thReplyBubble) - one render path, one scroll,
    // no second surface. The reply composer still mounts beneath in reply mode (switchTo).
    let html=activityTrailHtml(slug);
    if(!(replyTarget(slug)||{}).addr) html+='<p class="th-noreply sub">'+esc(t("th_reply_no_addr"))+'</p>';
    // The renderer self-identifies: a low-contrast corner marker naming the mounted renderer, so on device it
    // is obvious WHICH renderer is on screen (the proof that ends fixing a blind copy). The container carries a
    // data-renderer attribute, and threadRendererReport() walks the rendered DOM to name the exact container -
    // so a second render path, if one ever exists, is caught at runtime rather than guessed at from source.
    box.setAttribute("data-history-renderer", "renderHistory>activityTrailHtml@library/app.js");
    box.innerHTML='<div class="th-ver" aria-hidden="true" data-renderer="renderHistory">'+esc(threadRendererTag())+' · renderHistory</div>'+html;
    wireActivityTrail(box);                                // bind the inline expand/collapse toggles
    try{ if(window.console && console.info) console.info("[thread-renderer]", JSON.stringify(threadRendererReport())); }catch(_){}
  }

  /* The open team discussion. The list and composer are drawn by discussionHtml (a pure builder); this
     binds the controls and re-renders after each change, so a post, reply, edit or delete lands in place
     and the board (its card badge) refreshes. Reply repoints the one composer at a root comment; edit
     swaps a bubble body for an inline editor; delete removes an own comment. Every write is own-only at
     the store, mirroring the RLS, and goes through the Stage-4 queue, never a second path. */
  function renderDiscussion(o){
    const box=el("modalDiscussion"); if(!box) return;
    const slug=(o&&o.slug)||current;
    box.innerHTML=discussionHtml(slug);
    if(typeof applyIcons==="function") applyIcons(box);
    const rerender=()=>{ renderDiscussion(rec||o); try{ if(typeof window.thriveBoardRefresh==="function") window.thriveBoardRefresh(); }catch(_){} };
    const form=box.querySelector(".dc-composer");
    const ta=form&&form.querySelector(".dc-input");
    const out=form&&form.querySelector(".dc-out");
    const replyBar=form&&form.querySelector(".dc-replyto");
    const replyTxt=form&&form.querySelector(".dc-replyto-txt");
    const say=(kind,msg)=>{ if(out){ out.textContent=msg||""; out.className="dc-out"+(kind?(" is-"+kind):""); } };
    let parentId=null;
    const clearReply=()=>{ parentId=null; if(replyBar) replyBar.hidden=true; };
    if(form){
      form.addEventListener("submit", e=>{
        e.preventDefault();
        const c=postComment(slug, ta&&ta.value, parentId);
        if(!c){ say("err", t("dc_empty_warn")); return; }
        if(ta) ta.value=""; clearReply(); rerender();
      });
    }
    const xBtn=form&&form.querySelector(".dc-replyto-x");
    if(xBtn) xBtn.addEventListener("click", clearReply);
    box.querySelectorAll(".dc-reply-btn").forEach(b=> b.addEventListener("click", ()=>{
      // One level only: the reply attaches to the ROOT comment clicked, and the one composer is repointed.
      parentId=b.getAttribute("data-cid");
      const item=box.querySelector('.dc-item[data-cid="'+parentId+'"] .dc-who');
      const nm=item? item.textContent : "";
      if(replyTxt) replyTxt.textContent=t("dc_replying_to")+" "+nm;
      if(replyBar) replyBar.hidden=false;
      if(ta){ try{ ta.focus(); }catch(_){ } }
    }));
    box.querySelectorAll(".dc-del-btn").forEach(b=> b.addEventListener("click", ()=>{
      if(deleteComment(b.getAttribute("data-cid"))) rerender(); else say("err", t("dc_not_yours"));
    }));
    box.querySelectorAll(".dc-edit-btn").forEach(b=> b.addEventListener("click", ()=>{
      const cid=b.getAttribute("data-cid");
      const bubble=box.querySelector('.dc-item[data-cid="'+cid+'"] .dc-bubble');
      const bodyEl=bubble&&bubble.querySelector(".dc-body"); if(!bodyEl) return;
      const cur=(ThriveComments.all().find(x=>x.id===cid)||{}).body||"";
      bodyEl.innerHTML='<textarea class="input dc-edit-input" dir="auto" rows="3"></textarea>'+
        '<div class="dc-edit-bar"><button type="button" class="btn ghost sm dc-edit-cancel">'+esc(t("dc_cancel"))+'</button>'+
        '<button type="button" class="btn sm dc-edit-save">'+esc(t("dc_save"))+'</button></div>';
      const inp=bodyEl.querySelector(".dc-edit-input"); if(inp){ inp.value=cur; try{ inp.focus(); }catch(_){ } }
      bodyEl.querySelector(".dc-edit-cancel").addEventListener("click", ()=> renderDiscussion(rec||o));
      bodyEl.querySelector(".dc-edit-save").addEventListener("click", ()=>{
        if(editComment(cid, inp&&inp.value)) rerender(); else say("err", t("dc_empty_warn"));
      });
    }));
  }

  /* ---- tabs -------------------------------------------------------------- */
  /* The composer is only adopted when the reader has chosen the email path. The
     tab used to open on the composer AND the send options at once, which asked
     the second question before the first. WO-013 §4.1. */
  function borrows(tab){
    // History borrows the composer (in reply mode) whenever there is an address to answer, so the send
    // editor sits beneath the thread. The node is the same #view-compose the outreach tab borrows.
    if(tab==="history") return !!(current && (replyTarget(current)||{}).addr);
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
    if(tab==="history"){
      // The thread, with the full send editor beneath it in reply mode. The editor is the SAME node the
      // outreach tab borrows (#view-compose) and the SAME initCompose, so a reply has formatting, templates
      // and preview and there is one editor codebase, two mount points. Borrowed only when there is an
      // address to answer; otherwise the thread shows on its own.
      const view=document.getElementById("view-compose");
      if(view && borrows("history")){
        giveBack();                                    // park any other borrowed view before adopting this one
        remember(view);
        if(view.parentNode!==host) host.appendChild(view);
        view.hidden=false; view.classList.remove("wrap");
        if(typeof window.thriveViewReset==="function") window.thriveViewReset("compose");  // boot state, so init re-wires once
        show(tab);
        renderHistory(rec);                            // the thread list, above the editor
        scrollThreadToNewest(false);                   // land on the latest exchange (a tab switch: modal already visible)
        // Part 2: a sent reply reconciles from the durable ledger AND re-lands on the newest, pulsing it, so
        // the just-sent reply confirms itself in place.
        try{ await initCompose(current, { reply:true, onSent:()=>{ renderHistory(rec); scrollThreadToNewest(true); } }); }
        catch(e){ if(typeof actionStatus==="function") actionStatus("err", t("act_mount_fail")+" "+errText(e)); }
      } else {
        giveBack(); show(tab); renderHistory(rec); scrollThreadToNewest(false); // no one to answer: just the thread
      }
      if(__restored) applyDraftFields(__restored);
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
    else if(tab==="discussion") renderDiscussion(rec);
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
    const url=liveUrl(rec.slug);   // the opportunity's own PUBLIC page, never a console-internal deep link
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(
        ()=>toast(t("mw_copied")),
        ()=>toast(legacyCopy(url)? t("mw_copied") : t("cmp_copy_err")));
      return;
    }
    toast(legacyCopy(url)? t("mw_copied") : t("cmp_copy_err"));
  }
  /* Open the opportunity's own live page in a new tab, from inside the card. Same gate and same URL as
     Copy: only when the page is live, and always the public liveUrl, never a console-internal link. */
  function openLink(){
    if(!rec || !isLive(rec)) return;
    try{ window.open(liveUrl(rec.slug), "_blank", "noopener"); }catch(e){}
  }
  /* The header pill and the copy control both read the record, so they are refreshed together
     and from one place. Two places that describe the same record drift the first time one of
     them is forgotten. */
  function stamp(){
    const pill=el("modalState");
    if(pill){
      const st=rec? resolvedStage(rec) : "";               // the one authority: the header pill equals the board lane
      const arch=rec && rec.archived;
      pill.textContent=arch? t("badge_archived") : (st? stageName(st) : "");
      pill.className="pill"+(arch? "" : (st? " mw-state-"+st : ""));
      pill.hidden=!(arch||st);
    }
    copyState();
  }
  function copyState(){
    const b=el("modalCopy"), o=el("modalOpen"), why=el("modalWhy");
    const can=!!(rec && isLive(rec));   // a live page: copy and open both work; otherwise both are refused
    if(b) b.disabled=!can;
    if(o) o.disabled=!can;
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

  // A badge opens the card ON the thing it announced: scroll to the new reply (or the opens summary) and
  // flash it, so a badge always leads to its update, never a silent Overview.
  function highlightTarget(hl){
    if(!hl) return;
    setTimeout(function(){
      var target=null;
      if(hl.kind==="reply" && hl.id){
        var rows=modal.querySelectorAll("[data-rid]");
        for(var i=0;i<rows.length;i++){ if(rows[i].getAttribute("data-rid")===hl.id){ target=rows[i]; break; } }
      } else if(hl.kind==="open"){ target=modal.querySelector(".cg-agg") || modal.querySelector(".mw-state"); }
      if(!target) return;
      try{ target.scrollIntoView({ block:"center", behavior:"smooth" }); }catch(e){}
      target.classList.add("th-flash");
      setTimeout(function(){ target.classList.remove("th-flash"); }, 2200);
    }, 380);
  }
  async function open(slug, tab, title, highlight){
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
    highlightTarget(highlight);
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
    /* Three answers, each doing exactly what its label says. The safe, recommended action is primary and
       focused (save and close); continuing to edit is the secondary and the cancel (Escape / backdrop land
       here, changing nothing); discarding is the quiet-destructive one. Crucially, discard drops ONLY the
       autosaved edits for this flow (ThriveDrafts.drop, a scratch store keyed by flow+slug); it never
       deletes the opportunity card (thrive_opps_v1) or any of its saved content. */
    const ans=await threeWay(t("df_ask_h"), t("df_ask_p"), [
      { label:t("df_saveclose"), kind:"primary" },              // 0: persist the edits, then close
      { label:t("df_keep"),      kind:"ghost", cancel:true },   // 1: return to the editor, state intact
      { label:t("df_throw"),     kind:"danger" }                // 2: drop only these edits, card untouched
    ]);
    if(ans===1) return false;                                          // keep editing
    if(ans===0){ ThriveDrafts.save(FLOW, current, data); return true; } // save and close
    if(ans===2){ ThriveDrafts.drop(FLOW, current); return true; }       // discard edits (never the card)
    return false;
  }

  el("modalBack").addEventListener("click", async ()=>{ if(await askBeforeClose()) goBack(); });
  el("modalClose").addEventListener("click", async ()=>{ if(await askBeforeClose()) close(); });
  el("modalCopy").addEventListener("click", copyLink);
  if(el("modalOpen")) el("modalOpen").addEventListener("click", openLink);
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
    else if(tab==="discussion") renderDiscussion(rec);
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
    else if(tab==="discussion") renderDiscussion(rec);
    else if(tab==="history") renderHistory(rec);
  }
  /* switchTo is exported so the Outreach tab can hand off to the composer
     without leaving the window. Sending it through goTo would close the window
     and lose the reader's place. */
  window.thriveModal={ open:open, close:close, isOpen:()=>open_, reread:reread, tab:switchTo };
  return window.thriveModal;
}
