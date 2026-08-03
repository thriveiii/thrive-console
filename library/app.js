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
      try{ action.fn(); }catch(e){}
    });
    el.appendChild(b);
  }
  el.classList.add("show");
  clearTimeout(window.__tt); window.__tt=setTimeout(()=>el.classList.remove("show"), ms);
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
  thrive_email_templates_v1:1, thrive_templates_v1:1, thrive_removed_v1:1, thrive_etpl_seed_v1:1 };
function lsSet(key, str){
  try{ localStorage.setItem(key, str); if(SYNCED_KEYS[key]) try{ scheduleSyncPush(); }catch(_){} return true; }
  catch(e){
    try{
      const h=JSON.parse(localStorage.getItem("thrive_hits_v1")||"[]"); if(h.length>150) localStorage.setItem("thrive_hits_v1", JSON.stringify(h.slice(-150)));
      const a=JSON.parse(localStorage.getItem("thrive_activity_v1")||"[]"); if(a.length>200) localStorage.setItem("thrive_activity_v1", JSON.stringify(a.slice(-200)));
      localStorage.setItem(key, str); if(SYNCED_KEYS[key]) try{ scheduleSyncPush(); }catch(_){} return true;
    }catch(e2){ try{ toast(t("storage_full")); }catch(_){} return false; }
  }
}

/* ---------- activity log ---------- */
function getActivity(){ try{ return JSON.parse(localStorage.getItem(LOG)||"[]"); }catch(e){ return []; } }
function setActivity(a){ lsSet(LOG, JSON.stringify(a.slice(-500))); }
function logActivity(action, slug, detail){
  const a=getActivity();
  a.push({ ts:new Date().toISOString(), action:action||"", slug:slug||"", detail:detail||"" });
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
const TPLSTORE = "thrive_templates_v1";
function getCustomTemplates(){ try{ return JSON.parse(localStorage.getItem(TPLSTORE)||"[]"); }catch(e){ return []; } }
function setCustomTemplates(a){ return lsSet(TPLSTORE, JSON.stringify(a)); }
function getCustomTemplate(id){ return getCustomTemplates().find(x=>x.id===id); }
function saveCustomTemplate(rec){ rec.up=Date.now(); const a=getCustomTemplates(); const i=a.findIndex(x=>x.id===rec.id); if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setCustomTemplates(a); }
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
  }catch(e){ out.version="(unreachable: "+e.message+")"; }
  out.v4=/v4/.test(out.version);
  const auth=syncAuth();
  if(!auth){ out.state=out.hits="(not unlocked, no sync credential)"; return out; }
  try{
    const r=await fetch(ep,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({op:"state_get",auth:auth})});
    const j=await r.json(); out.state = j.ok? "ok" : ("✕ "+(j.error||"failed"));
  }catch(e){ out.state="✕ "+e.message; }
  try{
    const r=await fetch(ep,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},
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
    const r=await fetch(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
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
async function doSyncRound(ep, auth){
  const g=await fetch(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:JSON.stringify({ op:"state_get", auth:auth }) });
  const gj=await g.json();
  if(!gj.ok) throw new Error(gj.error||"sync auth");
  if(gj.data) syncMergeApply(gj.data);
  const p=await fetch(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:JSON.stringify({ op:"state_put", auth:auth, data:syncSnapshot() }) });
  const pj=await p.json(); if(!pj.ok) throw new Error(pj.error||"sync put");
  try{ localStorage.setItem(SYNC_LAST, new Date().toISOString()); }catch(e){}
  // Analytics share this endpoint and credential, so refresh them in the same round. Without
  // this, a page that syncs right after unlocking never re-checks collection and sits on a
  // stale "not collecting" message no matter how the relay is actually deployed.
  try{ await fetchRemoteHits(); }catch(e){}
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
    const p=await fetch(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"},
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
  return fetch("https://api.github.com/repos/"+c.owner+"/"+c.repo+path, Object.assign({}, opts, {
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
  const r=await fetch("https://api.github.com/repos/"+c.owner+"/"+c.repo,
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
/* Finish a publish that got halfway. The page is already live, so this writes only the entry
   that lists it. */
async function finishPublish(rec){ await publishManifest(rec); logActivity("publish", rec.slug, "finished"); }
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
      return `<div class="card${arch?" is-arch":""}${live?"":" is-draft"}${fu?" needs-fu":""}">
        <div class="card-top">
          <div class="card-id"><p class="biz">${esc(o.business)||esc(o.slug)}</p>${linkRow}</div>
          ${badgeFor(o)}
        </div>
        <div class="meta">
          <span class="chip tmpl">${esc(o.template)||t("none")}</span>
          <span class="chip">${t("col_made")}: ${esc(o.sent_on)||t("none")}</span>
          ${snd.count?`<span class="chip">${t("col_sent")}: ${esc(sentDay)||t("none")}</span>`:""}
          ${live?`<span class="chip">${snd.count?t("ins_opens")+": "+outreachOpens(o):t("col_views")+": "+opensForSlug(o.slug)}</span>`:""}
          <span class="chip">${t("col_location")}: ${esc(o.location)||t("none")}</span>
          ${fu?`<span class="chip fu-chip">${t("followup")}</span>`:""}
          ${half?`<span class="chip fu-chip">${t("pub_half_chip")}</span>`:""}
        </div>
        <div class="row">
          ${primary}
          ${stageSel(o)}
        </div>
        <div class="actions actions-wrap">
          ${!live?`<button class="btn ghost sm" data-prev="${esc(o.slug)}">${t("preview")}</button>`:""}
          ${live?`<a class="btn ghost sm" href="${viewHref("compose","slug="+enc)}">${t("email_btn")}</a><button class="btn ghost sm" data-pdf="${esc(o.slug)}">PDF</button>`:""}
          <a class="btn ghost sm" href="${viewHref("editor","slug="+enc)}">${t("edit")}</a>
          <button class="btn ghost sm" data-arch="${esc(o.slug)}" data-val="${arch?"0":"1"}">${arch?t("unarchive"):t("archive")}</button>
          ${half?`<button class="btn sm" data-finish="${esc(o.slug)}">${t("pub_finish")}</button>`:""}
          ${live?`<button class="btn ghost sm danger" data-unpub="${esc(o.slug)}">${t("unpublish")}</button>`:""}
          ${(o._local&&!o.published)?`<button class="btn ghost sm danger" data-del="${esc(o.slug)}">${t("remove")}</button>`:""}
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
    grid.querySelectorAll("[data-unpub]").forEach(b=>b.addEventListener("click", async ()=>{
      const slug=b.getAttribute("data-unpub"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>goTo("settings"),900); return; }
      if(!confirm(t("confirm_unpublish"))) return;
      b.disabled=true; b.textContent=t("publishing");
      try{
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
        logActivity("unpublish", slug, o.business); toast(t("unpublished_ok"));
        state.data=await mergedOpps(); render();
      }catch(e){ toast(t("gh_err")+": "+e.message); b.disabled=false; b.textContent=t("unpublish"); }
    }));
    grid.querySelectorAll("[data-prev]").forEach(b=>b.addEventListener("click", async ()=>{
      const o=state.data.find(x=>x.slug===b.getAttribute("data-prev")); if(o) openLocalPreview(await renderOppHtml(o));
    }));
    grid.querySelectorAll("[data-pub]").forEach(b=>b.addEventListener("click", async ()=>{
      const slug=b.getAttribute("data-pub"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>goTo("settings"),900); return; }
      b.disabled=true; b.textContent=t("publishing");
      try{
        const html=await renderOppHtml(o);
        if(!html){ toast(t("no_content_publish")); b.disabled=false; b.textContent=t("publish"); return; }
        await publishOpp(Object.assign({}, o, {html})); saveDraft({slug, published:true}); o.published=true;
        logActivity("publish", slug, o.business); toast(t("published_live")); render();
      }catch(e){
        // A half publish is not a failed publish. The page is live and only its entry is
        // missing, so say which half is done and leave the record able to finish.
        if(e.half){ saveDraft({slug, published:true}); o.published=true; toast(t("pub_half")); render(); }
        else { toast(t("gh_err")+": "+e.message); b.disabled=false; b.textContent=t("publish"); }
      }
    }));
    grid.querySelectorAll("[data-finish]").forEach(b=>b.addEventListener("click", async ()=>{
      const slug=b.getAttribute("data-finish"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>goTo("settings"),900); return; }
      b.disabled=true; b.textContent=t("publishing");
      try{ await finishPublish(o); toast(t("published_live")); render(); }
      catch(e){ toast(t("gh_err")+": "+e.message); b.disabled=false; b.textContent=t("pub_finish"); }
    }));
    grid.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      const slug=b.getAttribute("data-del");
      if(!confirm(t("confirm_remove"))) return;
      removeDraft(slug); logActivity("remove", slug, "");
      state.data=state.data.filter(o=>!(o._local&&o.slug===slug)); render();
    }));
    grid.querySelectorAll("[data-arch]").forEach(b=>b.addEventListener("click",()=>{
      const slug=b.getAttribute("data-arch"); const val=b.getAttribute("data-val")==="1";
      const o=state.data.find(x=>x.slug===slug); if(!o) return;
      // carry the summary into the overlay so manifest-only items keep rendering
      saveDraft({ slug, business:o.business, template:o.template, sent_on:o.sent_on,
                  location:o.location, phone:o.phone, status:o.status||"sent", archived:val });
      o.archived=val;
      if(isLive(o) && ghReady()) setManifestArchived(slug, val).catch(()=>{}); // sync across devices
      logActivity(val?"archive":"unarchive", slug, "");
      toast(val?t("archived_toast"):t("unarchived_toast"));
      render();
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

/* ---------- editor ---------- */
async function initEditor(slugArg){
  const el=id=>document.getElementById(id);
  const existing = await allSlugs();
  // The slug currently being edited (null for a brand-new opp). Advances on first save so an
  // opp never collides with itself, and lets save/publish block collisions with OTHER opps.
  let editingSlug = viewParams().get("slug");

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

  // mode switch
  el("mode_fill").addEventListener("click",()=>{ mode="fill"; el("mode_fill").classList.add("on"); el("mode_upload").classList.remove("on");
    el("fillFields").hidden=false; el("uploadBox").hidden=true; refresh(); });
  el("mode_upload").addEventListener("click",()=>{ mode="upload"; el("mode_upload").classList.add("on"); el("mode_fill").classList.remove("on");
    el("fillFields").hidden=true; el("uploadBox").hidden=false; refresh(); });

  // upload handling
  const dz=el("dz"), fileInput=el("fileInput");
  dz.addEventListener("click",()=>fileInput.click());
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("over"); if(e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);});
  fileInput.addEventListener("change",e=>{ if(e.target.files[0]) readFile(e.target.files[0]); });
  function readFile(f){
    if(!/\.html?$/i.test(f.name)){ toast(t("need_html")); return; }
    const fr=new FileReader();
    fr.onload=()=>{ uploadedHTML=fr.result; uploadedName=f.name;
      dz.innerHTML=t("uploaded")+"<b>"+esc(f.name)+"</b>"; if(!el("f_biz").value){ el("f_biz").value=f.name.replace(/\.html?$/i,""); }
      logActivity("upload", curSlug(), f.name); refresh(); };
    fr.onerror=()=>toast(t("read_err"));
    fr.readAsText(f);
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
  if(copyLink) copyLink.addEventListener("click", ()=>{
    const url=liveUrl(curSlug()||"<name>");
    navigator.clipboard.writeText(url).then(()=>toast(t("link_copied")), ()=>toast(url));
  });
  document.querySelectorAll(".devtoggle [data-dev]").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll(".devtoggle [data-dev]").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); el("frame").classList.toggle("phone", b.getAttribute("data-dev")==="phone");
  }));

  function missingRequired(){
    if(mode==="upload") return uploadedHTML? [] : ["upload"];
    const need=[["f_proof1","f_proof1"],["f_proof2","f_proof2"],["f_proof3","f_proof3"],["f_want","f_want"]];
    return need.filter(([id])=>!el(id).value.trim()).map(([,k])=>k);
  }

  // actions
  el("dlPage").addEventListener("click", async ()=>{
    if(!el("f_biz").value.trim()){ toast(t("need_biz")); return; }
    const miss=missingRequired();
    if(miss.length){ toast(t("need_fields")); return; }
    download("index.html", await currentHTML());
    logActivity("download", curSlug(), el("f_biz").value.trim());
    toast(t("dl_toast"));
  });
  el("saveLib").addEventListener("click", async ()=>{
    if(!el("f_biz").value.trim()){ toast(t("need_biz")); return; }
    if(collides()){ toast(t("slug_taken")); return; }   // never clobber another opp's record
    const rec=await fullRecord(); const isNew = existing.indexOf(rec.slug)<0;
    saveDraft(rec);
    if(isNew) existing.push(rec.slug);
    editingSlug = rec.slug;                              // this opp is now the one we're editing
    logActivity(isNew?"create":"save", rec.slug, rec.business);
    toast(t("saved_toast"));
  });
  const pubBtn=el("publishBtn");
  if(pubBtn) pubBtn.addEventListener("click", async ()=>{
    if(!el("f_biz").value.trim()){ toast(t("need_biz")); return; }
    if(missingRequired().length){ toast(t("need_fields")); return; }
    if(collides()){ toast(t("slug_taken")); return; }   // never overwrite another opp's live page
    if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>goTo("settings"),900); return; }
    const rec=await fullRecord();
    const pubRec=Object.assign({}, rec, { html: await currentHTML() });
    pubBtn.disabled=true; const old=pubBtn.textContent; pubBtn.textContent=t("publishing");
    try{
      await publishOpp(pubRec);
      editingLive=true; rec.published=true; saveDraft(rec);
      if(existing.indexOf(rec.slug)<0) existing.push(rec.slug);
      logActivity("publish", rec.slug, rec.business);
      toast(t("published_live"));
    }catch(e){ toast(t("gh_err")+": "+e.message); }
    finally{ pubBtn.disabled=false; pubBtn.textContent=old; }
  });
  el("copyManifest").addEventListener("click", ()=>{
    if(!el("f_biz").value.trim()){ toast(t("need_biz")); return; }
    const r=record(); delete r.fields;
    navigator.clipboard.writeText(JSON.stringify(r,null,2)).then(
      ()=>{ logActivity("copy", r.slug, ""); toast(t("copied_toast")); },
      ()=>{ download("entry.json", JSON.stringify(r,null,2), "application/json"); });
  });

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
        el("mode_upload").classList.add("on"); el("mode_fill").classList.remove("on");
        el("fillFields").hidden=true; el("uploadBox").hidden=false;
        dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>";
      } else if(editingLive && !hasFields && !d._local){
        // Live opp published elsewhere (manifest-only, no local fields): pull the real page so a
        // save/publish can't overwrite it with a blank template regeneration.
        try{ const r=await fetch(relOpp(d.slug)+"index.html",{cache:"no-store"});
          if(r.ok){ const html=await r.text();
            mode="upload"; uploadedHTML=html; uploadedName=(d.slug||"page")+".html";
            el("mode_upload").classList.add("on"); el("mode_fill").classList.remove("on");
            el("fillFields").hidden=true; el("uploadBox").hidden=false;
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
function brandWrap(inner, branded){
  const name=esc(getFromName());
  const font='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
  if(!branded){
    return '<div style="font-family:'+font+';font-size:15px;line-height:1.6;color:#222">'
      +inner
      +'<div style="margin-top:18px;color:#444">– '+name+'<br><a href="https://thriveiii.com" style="color:#444;text-decoration:none">thriveiii.com</a></div>'
      +'</div>';
  }
  const logo="https://"+SITE+"/assets/thrive-logo.png";
  return '<div style="font-family:'+font+';max-width:600px;margin:0 auto;padding:10px 4px">'
    +'<img src="'+logo+'" width="42" height="42" alt="'+name+'" style="display:block;border-radius:10px;margin-bottom:16px">'
    +'<div style="font-size:15px;line-height:1.7;color:#111827">'+inner+'</div>'
    +'<div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#9aa0aa">'+name+' · thriveiii.com</div>'
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
function saveEmailTemplate(rec){ rec.up=Date.now(); const a=getEmailTemplates(); const i=a.findIndex(x=>x.id===rec.id); if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setEmailTemplates(a); }
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
  const r=Object.assign({ ts:new Date().toISOString() }, rec);
  if(!r.mid) r.mid=newMid();
  if(!r.thread) r.thread=threadKey(r.to, r.opp, r.subject);
  if(!r.direction) r.direction=(r.status==="replied"||r.status==="received")?"in":"out";
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
    const selWant = oppObj ? docLang(oppObj) : (getLang()==="ar" ? "AR" : "EN");
    tplCache.filter(tp=>(localeOf(tp) || (isArabicText((tp.subject||"")+(tp.html||"")) ? "AR" : "EN"))===selWant)
      .forEach(tp=>{ const o=document.createElement("option"); o.value=tp.id; o.textContent=tp.name; tplSel.appendChild(o); });
    // ALWAYS start blank: an empty editor with no template. A template is only pre-selected when
    // the writer explicitly asked for one via ?etpl=<id> (e.g. "Compose with" from Templates).
    tplSel.value="";
    const preT=params.get("etpl");
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
  el("eCopy").addEventListener("click", async ()=>{
    try{
      const html=brandWrap(htmlOut(), isBranded()), text=plainText();
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html],{type:"text/html"}),
          "text/plain": new Blob([text],{type:"text/plain"}) })]);
      } else { await navigator.clipboard.writeText(text); }
      const to=el("eto").value.trim(), subject=el("esubject").value.trim(), m=tplMeta();
      logActivity("email_copy", oppOf(), (to?to+" · ":"")+subject);
      logMail({ opp:oppOf(), to:to, toName:recName(), subject:subject, templateId:m.templateId, templateName:m.templateName, branded:isBranded(), preview:preview(), provider:"gmail-copy", status:"copied" });
      toast(t("cmp_copied"));
    }catch(e){ toast(t("cmp_copy_err")); }
  });
  el("eMail").addEventListener("click",()=>{
    const to=el("eto").value.trim(), subject=el("esubject").value.trim();
    location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(plainText());
  });
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
  el("eSend").addEventListener("click", async ()=>{
    const to=el("eto").value.trim();
    if(!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ toast(t("cmp_need_to")); return; }
    const ep=getEmailEndpoint();
    if(!ep){ toast(t("cmp_no_ep")); setTimeout(()=>goTo("settings"),1100); return; }
    // Resend free-tier guard: block before we would exceed the daily/monthly cap.
    const q=quotaUsage();
    if(q.dayFull){ toast(t("cmp_quota_day_hit")+(q.freeInMs>0?" "+t("cmp_quota_resets")+" "+fmtDur(q.freeInMs):"")); return; }
    if(q.monthFull){ toast(t("cmp_quota_month_hit")); return; }
    const payload={ from:FROM_EMAIL, fromName:getFromName(), to:to, subject:el("esubject").value.trim(), html:brandWrap(htmlOut(), isBranded()), text:plainText() };
    el("eSend").disabled=true; const old=el("eSend").textContent; el("eSend").textContent=t("cmp_sending");
    try{
      const r=await fetch(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"}, body:JSON.stringify(payload) });
      const txt=await r.text();
      if(!r.ok) throw new Error(r.status+" "+txt.slice(0,140));
      let id="", parsed=null; try{ parsed=JSON.parse(txt); }catch(_){}
      if(parsed && parsed.ok===false) throw new Error(parsed.error||"send failed");
      if(parsed) id=parsed.id||"";
      const m=tplMeta();
      recordSend(); renderQuota();
      logActivity("email", slug||"", to+" · "+payload.subject);
      logMail({ opp:oppOf(), to:to, toName:recName(), subject:payload.subject, templateId:m.templateId, templateName:m.templateName, branded:isBranded(), preview:preview(), provider:"endpoint", status:"sent", id:id });
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
/* What a relay URL actually answered. An Apps Script deployment whose access is not "Anyone"
   returns a Google sign-in page to every unauthenticated caller, which is HTML, not JSON. That
   is a completely different fault from a stale deployment and it needs its own name: prospects
   have no Google account, so a restricted deployment can never collect a single page open. */
function classifyRelayBody(body){
  const s=String(body||"").trim();
  if(!s) return { kind:"net" };
  if(/Thrive relay/i.test(s)) return { kind:/v4/.test(s)? "v4":"old", version:s.slice(0,90) };
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
  if(!add("conn_v4", v.kind==="v4",
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
    // 1. never adopt a URL that is not a v4 relay
    let version="";
    try{ const r=await fetch(ep,{cache:"no-store"}); version=(await r.text()).slice(0,120).trim(); }catch(e){}
    if(!(/Thrive relay/i.test(version) && /v4/.test(version))){
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
      // Refuse to publish a URL that isn't a v4 relay: publishing a stale one breaks every device.
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
    const list=localeTemplates(all, __localeTab);
    const host=el("customList");
    host.innerHTML=localeTabBar("tplLocTabs")+
      (list.length? list.map(ct=>`
        <div class="tpl">
          <div class="tpl-b">
            <div class="name">${esc(ct.name||ct.id)}</div>
            <div class="id">${esc(ct.id)} · ${esc(localeOf(ct)||"")}</div>
          </div>
          <div class="tpl-a">
            <a class="btn ghost sm" href="${viewHref("editor","t="+encodeURIComponent(ct.id))}">${t("use_template")}</a>
            <button class="btn ghost sm" data-cp="${esc(ct.id)}">${t(__localeTab==="EN"?"loc_counterpart":"loc_counterpart_en")}</button>
            <button class="btn ghost sm" data-pubtpl="${esc(ct.id)}">${t("publish")}</button>
            <button class="btn ghost sm" data-dl="${esc(ct.id)}">${t("dl_template")}</button>
            <button class="btn ghost sm danger" data-del="${esc(ct.id)}">${t("tpl_delete")}</button>
          </div>
        </div>`).join("") : "")+
      localeEmpty(__localeTab, list.length)+
      migrationPanel();
    if(typeof applyIcons==="function") applyIcons(host);
    window.__renderPageTpls=renderCustom;
    host.querySelectorAll("[data-loc]").forEach(b=>b.addEventListener("click",()=>setLocaleTab(b.getAttribute("data-loc"))));
    bindMigration(host, renderCustom);
    /* A counterpart copies the structure and leaves the content empty. It never machine
       translates: a translated shelf reads as a shelf until somebody sends from it. */
    host.querySelectorAll("[data-cp]").forEach(b=>b.addEventListener("click",()=>{
      const src=getCustomTemplate(b.getAttribute("data-cp")); if(!src) return;
      const other=__localeTab==="EN"?"AR":"EN";
      let id=src.id+"-"+other.toLowerCase(); let n=2;
      while(getCustomTemplate(id)) id=src.id+"-"+other.toLowerCase()+"-"+(n++);
      saveCustomTemplate({ id:id, name:(src.name||src.id)+" ("+t("loc_"+other.toLowerCase())+")",
        locale:other, lang:other, html:"", created:new Date().toISOString() });
      logActivity("tpl_add", id, "counterpart");
      toast(t("loc_counterpart_made"));
      __localeTab=other; renderCustom();
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


  // upload / add custom template
  const dz=el("tplDz"), file=el("tplFile");
  function readTpl(f){
    if(!/\.html?$/i.test(f.name)){ toast(t("need_html")); return; }
    const fr=new FileReader();
    fr.onload=()=>{ pendingHTML=fr.result;
      dz.innerHTML=t("uploaded")+"<b>"+esc(f.name)+"</b>";
      if(!el("tpl_id").value) el("tpl_id").value=slugify(f.name.replace(/\.html?$/i,""));
      if(!el("tpl_name").value) el("tpl_name").value=f.name.replace(/\.html?$/i,"");
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
    const id=slugify(el("tpl_id").value)|| slugify(el("tpl_name").value);
    if(!id){ toast(t("tpl_need_id")); return; }
    const reserved=APPROVED_TEMPLATES.some(t2=>t2.id===id);
    if(reserved){ toast(t("tpl_id_taken")); return; }
    // An existing custom id would be silently overwritten, so ask first.
    if(getCustomTemplate(id) && !confirm(t("tpl_confirm_overwrite"))) return;
    const ok=saveCustomTemplate({ id, name:el("tpl_name").value.trim()||id, lang:el("tpl_lang").value||"EN",
      html:pendingHTML, created:new Date().toISOString() });
    if(!ok) return;
    logActivity("tpl_add", id, el("tpl_name").value.trim());
    pendingHTML=null; dz.innerHTML=t("upload_dz"); el("tpl_id").value=""; el("tpl_name").value="";
    toast(t("tpl_added")); renderCustom();
  });

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
    const list=localeTemplates(all, __localeTab);
    const chrome=localeTabBar("etLocTabs");
    const tail=localeEmpty(__localeTab, list.length)+migrationPanel();
    const bindTabs=()=>{
      window.__renderMsgTpls=renderEmailTpls;
      wrap.querySelectorAll("[data-loc]").forEach(b=>b.addEventListener("click",()=>setLocaleTab(b.getAttribute("data-loc"))));
      bindMigration(wrap, renderEmailTpls);
    };
    if(!list.length){ wrap.innerHTML=chrome+tail; bindTabs(); return; }
    wrap.innerHTML = chrome + list.map(et=>{
      const usesMonth=tplUsesMonth(et);
      return `
      <div class="item no-thumb">
        <div class="item-body">
          <div class="id">${t("tpl_kind_mail")} · ${esc(et.id)}</div>
          <h3>${esc(et.name||et.id)}</h3>
          <div class="meta">
            ${et.id==="monthly"?`<span class="chip">${t("et_default")}</span>`:""}
            ${usesMonth?`<span class="chip tmpl">${t("et_asks_month")}</span>`:""}
            ${/\{\{LINK\}\}/.test(et.html||"")?`<span class="chip">${t("et_has_link")}</span>`:""}
          </div>
          <p class="meta-line"><b>${esc(et.subject||"–")}</b></p>
          <p class="meta-line">${esc(etPreview(et.html))}</p>
          ${etPerf(stats[et.id])}
          <div class="actions">
            <a class="btn sm" href="${viewHref("compose","etpl="+encodeURIComponent(et.id))}">${t("cmp_compose_with")}</a>
            <button class="btn ghost sm" data-etedit="${esc(et.id)}">${t("cmp_link_edit")}</button>
            <button class="btn ghost sm" data-etdup="${esc(et.id)}">${t("et_duplicate")}</button>
            <button class="btn ghost sm danger" data-etdel="${esc(et.id)}">${t("tpl_delete")}</button>
          </div>
        </div>
      </div>`;}).join("") + tail;
    bindTabs();
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
  const tile=(v,k,cls,tip)=>'<div class="tile'+(cls?" "+cls:"")+'">'+
    (tip?'<button type="button" class="info tile-info" data-tip="'+esc(tip)+'" aria-label="'+esc(tip)+'">i</button>':'')+
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
    /* One sentence that reads the numbers back, in the order a person actually cares about:
       is anyone answering, is anyone reading, and who is waiting on me. Tiles tell you what
       happened; this tells you what it means. */
    const waiting=threads.filter(th=>!th.replied).length;
    const story=[];
    if(!sent) story.push(t("story_none"));
    else{
      const L=getLang();
      story.push(boardText(L,"story_sent",contacted));
      story.push(boardText(L,"story_sent_n",sent));
      if(replies) story.push(boardText(L,"story_replies",replies,{r:rate}));
      else if(waiting) story.push(boardText(L,"story_no_replies",waiting));
      if(totalOpens) story.push(boardText(L,"story_opens",totalOpens));
      else if(totalViews) story.push(boardText(L,"story_views",totalViews));
      else if(usingCollected()) story.push(t("story_no_opens"));
    }
    el("homeStory").innerHTML=story.join(" ");

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
    el("tilesPages").innerHTML=
      tile(live, t("home_live_pages"), "", t("tip_live_pages"))+
      tile(opps.length, t("home_total_opps"), "", t("tip_total_opps"))+
      tile(totalViews, t("home_views"), "", t("tip_views"))+
      tile(totalOpens, t("home_opens"), "", t("tip_opens"))+
      tile(uniq.size, t("home_unique"), "", t("tip_unique"))+
      tile(fmtMs(dw.n? dw.ms/dw.n : 0), t("home_dwell"), "", t("tip_dwell"));
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
          '<td>'+num(r.sent)+'</td><td>'+num(r.views)+'</td><td>'+num(r.opens)+'</td><td>'+num(r.uniq)+'</td>'+
          '<td>'+(r.dwellN?fmtMs(r.dwellMs/r.dwellN):'<span class="zero">–</span>')+'</td>'+
          '<td>'+(r.replies?'<b class="ok-n">'+r.replies+'</b>':'<span class="zero">0</span>')+'</td>'+
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
        const r=await fetch(relOpp(o.slug)+"index.html",{cache:"no-store"});
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
        const r=await fetch(ep,{cache:"no-store"});
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

/* ---------- the board ----------
   State is position. Every opportunity sits in the lane that is its state, so you learn
   where everything stands by looking rather than by reading a number, and follow-up debt
   shows up as mass on the screen instead of as something to remember.

   It derives, it never stores: there is no lane field and there must never be one, because a
   stored lane drifts from the truth the moment a beacon hit lands on another device. Every
   stage write goes through the same saveDraft plus logActivity pair the Library select uses,
   so the two surfaces can never disagree about what happened. */
async function initBoard(){
  const el=id=>document.getElementById(id);
  const lang=()=>getLang();
  const txt=(k,n,extra)=> (typeof boardText==="function")? boardText(lang(),k,n,extra) : "";
  const num=v=>'<span class="n">'+v+'</span>';

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
    return '<button class="tok '+cls.slice(1).join(" ")+'" data-slug="'+esc(tk.slug)+'" type="button">'+
      '<span class="tok-name">'+esc(tk.biz)+'</span>'+
      '<span class="tok-meta">'+meta+'</span></button>';
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
      if(!body) return;
      body.innerHTML = b.lanes[k].length
        ? b.lanes[k].map((tk,i)=> tokenHtml(tk).replace('class="tok ', 'class="tok '+(i<3?"enter enter-"+(i+1)+" ":"")) ).join("")
        : '<div class="lane-empty">'+esc(t("lane_"+k+"_empty"))+'</div>';
    });

    // One sentence, chosen by priority. The console says one thing at a time.
    const v=ThriveBoard.verdict(b);
    el("boardVerdict").innerHTML = txt(v.key, v.n).replace(String(v.n), num(v.n));
    el("boardVerdictSub").innerHTML = b.summary.stalled
      ? txt("vd_sub_stalled", ThriveBoard.STALL_DAYS).replace(String(ThriveBoard.STALL_DAYS), num(ThriveBoard.STALL_DAYS))
      : txt("vd_sub_none");

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
      : '<div class="lane-empty">'+esc(t("tray_empty"))+'</div>';

    const empty=b.summary.total===0 && closed.length===0;
    el("boardEmpty").hidden=!empty;
    el("boardLanes").hidden=empty;
    el("boardChips").hidden=empty;
    el("boardTray").hidden=empty;

    // A token opens the whole opportunity: what it is, its text, its page, its outreach, and
    // what has happened to it.
    playFlip(first);

    document.querySelectorAll(".tok").forEach(tk=>tk.addEventListener("click",()=>{
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
let __localeTab="EN";
function setLocaleTab(L){
  __localeTab=L;
  /* Both libraries share the tab, so both redraw. One list obeying the tab while the other
     ignores it is worse than no tab at all: it teaches you that the control is unreliable. */
  if(typeof window.__renderPageTpls==="function") window.__renderPageTpls();
  if(typeof window.__renderMsgTpls==="function") window.__renderMsgTpls();
}
function localeTabBar(id){
  return '<div class="seg loc-tabs" role="tablist" id="'+id+'">'+
    LOCALES.map(L=>'<button role="tab" data-loc="'+L+'" class="'+(L===__localeTab?"on":"")+'" '+
      'aria-selected="'+(L===__localeTab?"true":"false")+'">'+esc(t("loc_"+L.toLowerCase()))+'</button>').join("")+
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
  if(!r.ok){ toast(t(r.error)); return r; }

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
  } else toast(t("lc_"+move)+" · "+t("lc_done"));
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
  function ltr(s){ return '<span class="mono-iso">'+esc(s)+'</span>'; }
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
    const moves=ThriveLifecycle.movesFor(o).filter(m=> m!=="send_email" && m!=="send_offchannel");
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
    box.querySelectorAll("[data-move]").forEach(b=>b.addEventListener("click", async ()=>{
      const m=b.getAttribute("data-move");
      const opts={};
      if(m==="drop"){
        const r=prompt(t("lc_drop_q")); if(r===null) return;
        if(!String(r).trim()){ toast(t("lc_err_reason_text")); return; }
        opts.reason=r;
      }
      if(m==="mark_lost"){
        const list=ThriveLifecycle.LOST_REASONS;
        const r=prompt(t("lc_lost_q")+"\n"+list.map((x,i)=>(i+1)+". "+t("lc_reason_"+x)).join("\n"));
        if(r===null) return;
        const n=parseInt(String(r).trim(),10);
        opts.reason=list[n-1]||"";
        if(!opts.reason){ toast(t("lc_err_reason")); return; }
      }
      if(m==="record_reply"){
        const r=prompt(t("lc_reply_q"), today()); if(r===null) return;
        opts.replied_on=String(r).trim();
      }
      if(m==="reopen"){ if(!confirm(t("lc_reopen_q"))) return; opts.confirmed=true; }
      if(m==="retire_page"){ if(!confirm(t("lc_retire_q"))) return; }
      if(m==="publish"){
        // Publishing is a network operation with its own screen. The lifecycle says it is
        // legal; the editor is what performs it.
        switchTo("page"); return;
      }
      await runMove(m, o.slug, opts);
    }));
  }

  /* ---- Outreach: the off channel send ------------------------------------
     Three steps, in the order a person actually performs them: read the message, open their
     channel, then say what you did. The console cannot witness a send made through somebody
     else's contact form, so it records your word for it and labels it as your word. What it
     will not do is invent one, and what it will not allow is sending a message that still
     says [LINK] where the page address should be. */
  function renderOutreach(o){
    const box=el("modalOutreach"); if(!box) return;
    if(!o){ box.innerHTML=""; return; }
    const text=(o.outreach_text||"");
    const hasLink=text.indexOf("[LINK]")>=0;
    const ch=(o.channel&&o.channel.kind)||"";
    const url=(o.channel&&o.channel.to)||"";
    const done=ThriveLifecycle.manualContacts(o);

    const step=(n,title,inner)=>'<section class="mw-sec oc-step"><h4 class="mw-h">'+
      '<span class="oc-n">'+n+'</span>'+esc(title)+'</h4>'+inner+'</section>';

    let one;
    if(!text) one='<p class="mw-empty">'+esc(t("ot_none"))+'</p>';
    else one='<pre class="mw-pitch" dir="auto">'+esc(text)+'</pre>'+
      (hasLink? '<p class="mw-warn-line">'+esc(t("oc_copy_blocked"))+'</p>' : '')+
      '<div class="mw-acts"><button type="button" class="btn ghost sm" id="ocCopy"'+
      (hasLink?" disabled":"")+'>'+esc(t("oc_copy"))+'</button></div>';

    const target=url? (/^https?:/i.test(url)? url : "https://"+url) : "";
    const two=target
      ? '<a class="btn ghost sm" href="'+esc(target)+'" target="_blank" rel="noopener">'+
        esc(t("oc_go"))+'</a><p class="mw-note">'+esc(lcChannelLabel(ch)||"")+' · '+
        '<span class="mono-iso">'+esc(url)+'</span></p>'
      : '<p class="mw-empty">'+esc(t("oc_no_url"))+'</p>';

    const sel=ThriveLifecycle.CHANNELS.map(k=>
      '<option value="'+k+'"'+(k===ch?" selected":"")+'>'+esc(lcChannelLabel(k))+'</option>').join("");
    const three=
      '<div class="mw-off-grid">'+
        '<div class="field"><label for="ocCh">'+esc(t("oc_channel"))+'</label>'+
          '<select id="ocCh" class="input">'+(ch?"":'<option value="">.</option>')+sel+'</select></div>'+
        '<div class="field"><label for="ocWhen">'+esc(t("oc_when"))+'</label>'+
          '<input id="ocWhen" class="input" type="date" max="'+today()+'" value="'+today()+'"></div>'+
      '</div>'+
      '<div class="field"><label for="ocBody">'+esc(t("oc_body"))+'</label>'+
        '<textarea id="ocBody" class="input oc-body" rows="5">'+esc(text)+'</textarea></div>'+
      '<div class="field"><label for="ocNote">'+esc(t("oc_note"))+'</label>'+
        '<input id="ocNote" class="input" autocomplete="off"></div>'+
      '<button class="btn" id="ocDo" type="button">'+esc(t("oc_confirm"))+'</button>';

    const list=done.length
      ? '<ul class="oc-list">'+done.map(c=>'<li><b>'+esc(lcChannelLabel(c.channel))+'</b>'+
          '<span class="mono-iso">'+esc(c.sent_on)+'</span>'+
          (c.note? '<span class="mw-note">'+esc(c.note)+'</span>':'')+'</li>').join("")+'</ul>'
      : '<p class="mw-empty">'+esc(t("oc_none"))+'</p>';

    box.innerHTML=prohibitionBand(o)+
      '<section class="mw-sec"><h4 class="mw-h">'+esc(t("oc_h"))+'</h4>'+
      '<p class="mw-note">'+esc(t("oc_p"))+'</p></section>'+
      step(1,t("oc_step1"),one)+step(2,t("oc_step2"),two)+step(3,t("oc_step3"),three)+
      '<section class="mw-sec"><h4 class="mw-h">'+esc(t("md_sends_h"))+'</h4>'+list+'</section>';

    const copy=el("ocCopy");
    if(copy) copy.addEventListener("click", ()=>{
      if(hasLink){ toast(t("oc_copy_blocked")); return; }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(()=>toast(t("oc_copied")),
          ()=>toast(legacyCopy(text)? t("oc_copied") : t("cmp_copy_err")));
        return;
      }
      toast(legacyCopy(text)? t("oc_copied") : t("cmp_copy_err"));
    });
    const go=el("ocDo");
    if(go) go.addEventListener("click", async ()=>{
      await runMove("send_offchannel", o.slug, {
        channel: el("ocCh").value,
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
    box.innerHTML='<section class="mw-sec"><h4 class="mw-h">'+esc(t("ot_h"))+'</h4>'+inner+'</section>'+
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
    rows.push(row(t("mw_o_page"), isLive(o)
      ? '<a class="has-ic" href="'+esc(liveUrl(o.slug))+'" target="_blank" rel="noopener">'+
        (typeof thriveIcon==="function"? thriveIcon("globe",{size:14}) : "")+ltr(liveUrl(o.slug))+'</a>'
      : '<span class="mw-muted">'+esc(t("mw_o_unpub"))+'</span>'));
    box.innerHTML=prohibitionBand(o)+recordNotes(o)+
      '<dl class="mw-rows">'+rows.join("")+'</dl>'+movesBar(o);
    bindMoves(box, o);
  }

  /* ---- History ----------------------------------------------------------
     The activity entries already recorded against this opportunity, newest first. Nothing new
     is written or derived here: it is the same log the Activity page reads. */
  function renderHistory(o){
    const box=el("modalHistory"); if(!box) return;
    const slug=(o&&o.slug)||current;
    const rows=getActivity().filter(a=>a && a.slug===slug).reverse();
    if(!rows.length){ box.innerHTML='<div class="mw-empty"><p>'+esc(t("mw_hist_empty"))+'</p></div>'; return; }
    const when=ts=>{ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",
      {dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts||""; } };
    const label=a=>{ const k="act_"+a; const v=t(k); return v===k? a : v; };
    box.innerHTML='<ol class="mw-hist">'+rows.map(a=>
      '<li><span class="mw-hist-when">'+ltr(when(a.ts))+'</span>'+
      '<span class="mw-hist-what">'+esc(label(a.action))+'</span>'+
      (a.detail? '<span class="mw-hist-detail">'+esc(a.detail)+'</span>' : '')+
      '</li>').join("")+'</ol>';
  }

  /* ---- tabs -------------------------------------------------------------- */
  function show(tab){
    Object.keys(PANELS).forEach(k=>{ const p=el(PANELS[k]); if(p) p.hidden=(k!==tab); });
    host.hidden=!BORROWED[tab];
    modal.querySelectorAll(".modal-tab").forEach(b=>{
      const on=b.getAttribute("data-tab")===tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on?"true":"false");
    });
  }
  async function switchTo(tab){
    if(!PANELS[tab] && !BORROWED[tab]) tab="overview";
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
      try{ if(tab==="page") await initEditor(current); else await initCompose(current); }catch(e){}
      return;
    }
    giveBack();
    show(tab);
    if(tab==="overview") renderOverview(rec);
    else if(tab==="text") renderText(rec);
    else renderHistory(rec);
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
    tab=tab||"overview";
    opener=document.activeElement;
    current=slug||"";
    rec=null;
    if(current){ try{ rec=(await mergedOpps()).find(x=>x.slug===current)||null; }catch(e){} }
    el("modalTitle").textContent=title||(rec&&rec.business)||slug||"";
    stamp();
    await switchTo(tab);
    open_=true;
    modal.hidden=false; scrim.hidden=false;
    // let the browser paint the closed state before the transition starts
    requestAnimationFrame(()=>{ modal.classList.add("on"); scrim.classList.add("on"); });
    lockScroll();
    const list=focusables();
    if(list.length) try{ list[0].focus(); }catch(e){}
  }

  /* now=true when something else needs a borrowed view in this same tick, which is what a
     navigation is. Waiting out the closing transition first would hand the view back after the
     shell had already decided what to display, and the reader would land on nothing. */
  function close(now){
    if(!open_) return;
    open_=false;
    modal.classList.remove("on"); scrim.classList.remove("on");
    unlockScroll();
    const settle=()=>{ modal.hidden=true; scrim.hidden=true; giveBack(); };
    if(now) settle(); else setTimeout(settle, 200);
    if(opener && opener.focus) try{ opener.focus(); }catch(e){}
    opener=null;
  }

  el("modalClose").addEventListener("click", ()=>close());
  el("modalCopy").addEventListener("click", copyLink);
  scrim.addEventListener("click", ()=>close());
  modal.querySelectorAll(".modal-tab").forEach(b=>
    b.addEventListener("click", ()=>switchTo(b.getAttribute("data-tab"))));
  document.addEventListener("keydown", e=>{
    if(modal.hidden) return;
    if(e.key==="Escape"){ close(); return; }
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
    try{ rec=(await mergedOpps()).find(x=>x.slug===current)||rec; }catch(e){}
    stamp();
    const tab=currentTab();
    if(tab==="overview") renderOverview(rec);
    else if(tab==="text") renderText(rec);
    else if(tab==="outreach") renderOutreach(rec);
    else if(tab==="history") renderHistory(rec);
  }
  window.thriveModal={ open:open, close:close, isOpen:()=>open_, reread:reread };
  return window.thriveModal;
}
