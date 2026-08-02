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
function toast(msg){
  let el=document.getElementById("toast");
  if(!el){ el=document.createElement("div"); el.id="toast"; el.className="toast"; document.body.appendChild(el); }
  el.textContent=msg; el.classList.add("show");
  clearTimeout(window.__tt); window.__tt=setTimeout(()=>el.classList.remove("show"),2600);
}
function download(name, text, type){
  const blob=new Blob([text], {type:type||"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100);
}
/* quota-safe localStorage: on overflow, reclaim space from transient logs and retry once.
   Writes to synced keys also schedule a (debounced) cross-device sync push. */
const SYNCED_KEYS={ thrive_opps_v1:1, thrive_mail_v1:1, thrive_quota_v1:1, thrive_activity_v1:1, thrive_email_templates_v1:1 };
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

/* ---------- custom templates (local registry) ---------- */
const TPLSTORE = "thrive_templates_v1";
function getCustomTemplates(){ try{ return JSON.parse(localStorage.getItem(TPLSTORE)||"[]"); }catch(e){ return []; } }
function setCustomTemplates(a){ return lsSet(TPLSTORE, JSON.stringify(a)); }
function getCustomTemplate(id){ return getCustomTemplates().find(x=>x.id===id); }
function saveCustomTemplate(rec){ const a=getCustomTemplates(); const i=a.findIndex(x=>x.id===rec.id); if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setCustomTemplates(a); }
function removeCustomTemplate(id){ setCustomTemplates(getCustomTemplates().filter(x=>x.id!==id)); }

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
function clearLocalHits(){ try{ localStorage.removeItem(HITS); }catch(e){} __opensCache=null; }
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
    __opensCache=null;                                   // opens map must be recomputed
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
function opensForSlug(slug){ return opensMap()[slug]||0; }
function debounce(fn, ms){ let h; return function(){ const a=arguments, c=this; clearTimeout(h); h=setTimeout(()=>fn.apply(c,a), ms||150); }; }

/* ---------- pipeline stages (mini CRM) ---------- */
const STAGES=["sent","opened","replied","won","lost"];
/* Accepts a plain date (2026-07-01) and a full timestamp alike. It used to append a time to
   whatever it was given, so any ISO timestamp parsed as NaN and silently aged nothing: a
   ledger entry could be a month old and still read as today. */
function daysSince(d){ if(!d) return 0;
  const str=String(d); const ms=Date.parse(str.length===10? str+"T00:00:00Z" : str);
  if(isNaN(ms)) return 0; return Math.floor((Date.now()-ms)/86400000); }
/* shared opportunity predicates (used by the library grid and the Overview dashboard) */
function isLive(o){ return !o._local || !!o.published; }
/* The promotion rule lives here and only here. The opens count can be injected so a caller
   with its own map (the board derivation layer, a test) reuses this rule instead of copying
   it. A second implementation of this line is how a board and a library start disagreeing. */
function effStage(o, opensOverride){ const op=(opensOverride===undefined)?opensForSlug(o.slug):(opensOverride||0);
  if((!o.stage||o.stage==="sent")&&op>0) return "opened"; return o.stage||"sent"; }
function needsFollowup(o){ return isLive(o) && !o.archived && effStage(o)==="sent" && opensForSlug(o.slug)===0 && daysSince(o.sent_on)>=3; }

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
function syncSnapshot(){
  // drafts travel WITHOUT page html (uploads can be hundreds of KB; the repo holds live pages)
  const opps=getDrafts().map(d=>{ const c=Object.assign({},d); delete c.html; return c; });
  // The relay URL is deliberately NOT in here. It used to travel with the state, and a device
  // holding an old URL could push it back over a freshly verified one, which is how two devices
  // ended up calling two different deployments. The published truth is library/sync.json.
  return { v:1, updated:Date.now(), scalarsUp:scalarsUp(),
    opps, mail:getMailLog(), quota:getSendStamps(), activity:getActivity(),
    etpl:getEmailTemplates(), fromName:getFromName(), quotaCfg:quotaCfg(),
    vault:sealedVault() };
}
function syncMergeApply(remote){
  if(!remote || typeof remote!=="object") return false;
  __syncApplying=true;
  try{
    // drafts: per-slug, newest `up` wins; a winner without html never erases local html
    if(Array.isArray(remote.opps)){
      const loc=getDrafts(), bySlug={};
      loc.forEach(d=>{ bySlug[d.slug]=d; });
      remote.opps.forEach(r=>{
        const l=bySlug[r.slug];
        if(!l){ bySlug[r.slug]=r; return; }
        if((r.up||0)>(l.up||0)) bySlug[r.slug]=Object.assign({}, r, (!r.html&&l.html)?{html:l.html}:{});
      });
      setDrafts(Object.values(bySlug));
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
    if(Array.isArray(remote.etpl)){                       // email templates: per-id, newest wins
      const loc=getEmailTemplates(), byId={};
      loc.forEach(x=>{ byId[x.id]=x; });
      remote.etpl.forEach(r=>{ const l=byId[r.id]; if(!l || (r.up||0)>(l.up||0)) byId[r.id]=r; });
      setEmailTemplates(Object.values(byId));
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
  window.onGateUnlocked=function(){ syncNow(); };
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
async function publishOpp(rec){
  await ghPutFile("opp/"+rec.slug+"/index.html", withBeacon(rec.html||""), "Publish opp/"+rec.slug);
  const mf=await ghGetFile("library/manifest.json");
  let man = mf ? (JSON.parse(unb64(mf.content))||{}) : {};
  man.site=man.site||SITE; man.base_path=man.base_path||OPP_PATH; man.opportunities=man.opportunities||[];
  const e=manifestEntry(rec); const i=man.opportunities.findIndex(o=>o.slug===rec.slug);
  if(i>=0){ if(man.opportunities[i].archived) e.archived=true; man.opportunities[i]=e; }  // keep an archived flag across re-publish
  else man.opportunities.push(e);
  man.updated=new Date().toISOString().slice(0,10);
  await ghPutFile("library/manifest.json", JSON.stringify(man,null,2)+"\n", "Update manifest: "+rec.slug);
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
function removeDraft(slug){ setDrafts(getDrafts().filter(x=>x.slug!==slug)); }

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
      const act=state.data.filter(o=>!o.archived); const counts={}; STAGES.forEach(s=>counts[s]=0);
      act.forEach(o=>{ const s=effStage(o); counts[s]=(counts[s]||0)+1; });
      const fu=act.filter(needsFollowup).length;
      pipelineEl.innerHTML =
        STAGES.map(s=>`<button class="pl-pill pl-${s}${state.stage===s?" on":""}" data-stage-f="${s}">${t("stage_"+s)} <b>${counts[s]}</b></button>`).join("")
        + `<button class="pl-pill pl-fu${state.status==="followup"?" on":""}" data-fu="1">${t("followup")} <b>${fu}</b></button>`
        + ((state.stage||state.status==="followup"||state.tmpl!=="all"||state.q)?`<button class="pl-pill pl-clear" data-clear="1">${t("clear_filters")}</button>`:"");
      pipelineEl.querySelectorAll("[data-stage-f]").forEach(b=>b.addEventListener("click",()=>{
        const s=b.getAttribute("data-stage-f");
        state.stage = (state.stage===s)?null:s;
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

    function stageSel(o){
      if(!isLive(o)) return "";
      const cur=effStage(o);
      return `<select class="stage-sel" data-stage="${esc(o.slug)}" title="${t("stage")}">`+
        STAGES.map(s=>`<option value="${s}"${s===cur?" selected":""}>${t("stage_"+s)}</option>`).join("")+`</select>`;
    }
    grid.innerHTML = rows.map(o=>{
      const arch=o.archived, live=isLive(o), enc=encodeURIComponent(o.slug), fu=needsFollowup(o);
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
          <span class="chip">${t("col_sent")}: ${esc(o.sent_on)||t("none")}</span>
          ${live?`<span class="chip">${t("ins_opens")}: ${opensForSlug(o.slug)}</span>`:""}
          <span class="chip">${t("col_location")}: ${esc(o.location)||t("none")}</span>
          ${fu?`<span class="chip fu-chip">${t("followup")}</span>`:""}
        </div>
        <div class="row">
          ${primary}
          ${stageSel(o)}
        </div>
        <div class="actions actions-wrap">
          ${!live?`<button class="btn ghost sm" data-prev="${esc(o.slug)}">${t("preview")}</button>`:""}
          ${live?`<a class="btn ghost sm" href="compose.html?slug=${enc}">${t("email_btn")}</a><button class="btn ghost sm" data-pdf="${esc(o.slug)}">PDF</button>`:""}
          <a class="btn ghost sm" href="editor.html?slug=${enc}">${t("edit")}</a>
          <button class="btn ghost sm" data-arch="${esc(o.slug)}" data-val="${arch?"0":"1"}">${arch?t("unarchive"):t("archive")}</button>
          ${live?`<button class="btn ghost sm danger" data-unpub="${esc(o.slug)}">${t("unpublish")}</button>`:""}
          ${(o._local&&!o.published)?`<button class="btn ghost sm danger" data-del="${esc(o.slug)}">${t("remove")}</button>`:""}
        </div>
      </div>`;
    }).join("");

    grid.querySelectorAll(".stage-sel").forEach(sel=>sel.addEventListener("change",()=>{
      const slug=sel.getAttribute("data-stage"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      o.stage=sel.value; saveDraft({slug, stage:sel.value}); logActivity("stage", slug, sel.value);
      render();   // always re-render so pipeline counts + any active stage filter reflect the change
    }));
    grid.querySelectorAll("[data-pdf]").forEach(b=>b.addEventListener("click", async ()=>{
      const o=state.data.find(x=>x.slug===b.getAttribute("data-pdf")); if(!o) return;
      if(isLive(o)){ const w=window.open(relOpp(o.slug),"_blank"); if(w) w.addEventListener("load",()=>setTimeout(()=>w.print(),300)); }
      else { const w=openLocalPreview(await renderOppHtml(o)); if(w) setTimeout(()=>{ try{w.print();}catch(e){} },500); }
    }));
    grid.querySelectorAll("[data-unpub]").forEach(b=>b.addEventListener("click", async ()=>{
      const slug=b.getAttribute("data-unpub"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
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
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
      b.disabled=true; b.textContent=t("publishing");
      try{
        const html=await renderOppHtml(o);
        if(!html){ toast(t("no_content_publish")); b.disabled=false; b.textContent=t("publish"); return; }
        await publishOpp(Object.assign({}, o, {html})); saveDraft({slug, published:true}); o.published=true;
        logActivity("publish", slug, o.business); toast(t("published_live")); render();
      }catch(e){ toast(t("gh_err")+": "+e.message); b.disabled=false; b.textContent=t("publish"); }
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

  const debRender=debounce(render,140);
  window.onThriveSync=async ()=>{ state.data=await mergedOpps(); render(); };   // live refresh on sync
  search.addEventListener("input",e=>{ state.q=e.target.value; debRender(); });
  sort.addEventListener("change",e=>{ state.sort=e.target.value; render(); });
  filt.addEventListener("change",e=>{ state.tmpl=e.target.value; render(); });
  if(statusFilt) statusFilt.addEventListener("change",e=>{ state.status=e.target.value; render(); });

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
    toast(localCount? t("export_local_note").replace("{n}",localCount) : t("exported_toast"));
  });

  window.onLangApplied=render;
  render();
}

/* ---------- editor ---------- */
async function initEditor(slugArg){
  const el=id=>document.getElementById(id);
  const existing = await allSlugs();
  // The slug currently being edited (null for a brand-new opp). Advances on first save so an
  // opp never collides with itself, and lets save/publish block collisions with OTHER opps.
  let editingSlug = new URLSearchParams(location.search).get("slug");

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
  const tParam=new URLSearchParams(location.search).get("t");
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
  function refreshMeta(){ el("urlpill").textContent = liveUrl(curSlug()||"<name>"); checkCollision(); }
  async function refreshPreview(){ const html=await currentHTML(); el("frame").srcdoc = html || "<!doctype html><meta charset='utf-8'>"; }
  async function refresh(){ refreshMeta(); await refreshPreview(); }
  const debPreview=debounce(refreshPreview, 220);   // perf: don't regenerate the heavy preview on every keystroke
  function refreshLive(){ refreshMeta(); debPreview(); }
  let editingLive=false;
  function record(){
    const slug = curSlug(); const v=values();
    return { slug, business:el("f_biz").value.trim(),
      template: mode==="upload"?"custom":el("f_template").value,
      sent_on:el("f_sent").value, location:el("f_location").value.trim(),
      phone:el("f_phone").value.trim(), status:"sent", mode:mode, published:editingLive,
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
    if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
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

  // prefill from ?slug= (edit any existing opp) or default date today
  const params=new URLSearchParams(location.search);
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
  window.onLangApplied=()=>{
    relabelBuiltins();                                   // template names follow the language switch
    if(mode==="upload" && uploadedName) dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>";
  };
  refresh();
}

/* ---------- activity log page (categorised operations + campaigns) ---------- */
const ACT_CAT={ email:"emails", email_copy:"emails", reply:"emails",
  create:"pages", save:"pages", publish:"pages", unpublish:"pages", download:"pages",
  archive:"pages", unarchive:"pages", remove:"pages", stage:"pages", copy:"pages",
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
  function renderThreads(){
    const wrap=el("campaigns"); if(!wrap) return;
    let threads=getThreads();
    const total=threads.length;
    if(threadQ){ const q=threadQ.toLowerCase();
      threads=threads.filter(th=> (th.to+" "+th.toName+" "+th.opp+" "+th.templates.join(" ")).toLowerCase().includes(q)); }
    const shown=threads.length;
    const pill=(threadQ && shown!==total) ? (shown+" / "+total) : String(total);   // pill matches the visible cards
    const head='<div class="threads-head"><h3 class="block-h">'+t("act_threads")+' <span class="pill">'+pill+'</span></h3>'+
      '<input id="threadSearch" class="input sm" placeholder="'+esc(t("act_thread_search"))+'" value="'+esc(threadQ)+'"></div>';
    if(!total){ wrap.innerHTML=head+'<div class="empty">'+t("act_no_threads")+'</div>'; bindSearch(); return; }
    const cards=threads.map(th=>{
      const who=esc(th.toName? (th.toName+" · "+th.to) : th.to);
      const oppB=th.opp?'<span class="tag tag-cat-pages">'+esc(th.opp)+'</span>':'';
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
      return '<details class="thread"><summary>'+
        '<div class="th-main"><span class="th-who">'+who+'</span><span class="th-meta">'+oppB+tplB+'</span></div>'+
        '<div class="th-side"><span class="th-counts">'+counts+'</span><span class="mono th-last">'+esc(fmt(th.last))+'</span>'+
        '<button class="btn ghost sm th-reply" data-th="'+esc(th.id)+'" data-to="'+esc(th.to)+'" data-opp="'+esc(th.opp)+'">'+t("act_reply_btn")+'</button></div>'+
        '</summary><div class="thread-body">'+rows+'</div></details>';
    }).join("");
    wrap.innerHTML=head+'<div class="threads">'+cards+'</div>';
    bindSearch();
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
  function render(){
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
  window.onLangApplied=()=>{ renderChips(); render(); };
  window.onThriveSync=render;                            // ledger/threads refresh live after a sync
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
const ETPL_MONTHLY = { id:"monthly", name:"Monthly update", subject:"{{MONTH}} at Thrive",
  html:'Hi {{NAME}},<br><br>End of the month, so here is {{MONTH}} at Thrive. We take on the work we think we’ll be proud of. If that could be yours, just say hi.<br><br>See you next month!<br><br>Abdullah Thyab<br>thriveiii.com' };
/* Arabic edition of the stock template, a real Arabic message, not a translation of labels
   around English text. Greeting is «مرحبًا فلان،», not "Hi …". */
const ETPL_MONTHLY_AR = { id:"monthly-ar", name:"التحديث الشهري", subject:"{{MONTH}} في ثرايف",
  html:'مرحبًا {{NAME}}،<br><br>مع نهاية الشهر، هذا هو {{MONTH}} في ثرايف. نحن نختار العمل الذي نفخر به. إن كان ذلك يناسبك، تكفي كلمة.<br><br>إلى الشهر القادم!<br><br>عبدالله ذياب<br>thriveiii.com' };
function getEmailTemplates(){
  let a; try{ a=JSON.parse(localStorage.getItem(ETPL)||"null"); }catch(e){ a=null; }
  if(!a) a=[Object.assign({},ETPL_MONTHLY), Object.assign({},ETPL_MONTHLY_AR)];
  else{
    // migrate the two OLD stock defaults (hard-wired month / auto-embedded link) to the new one
    const i=a.findIndex(x=>x.id==="monthly");
    if(i>=0 && /<a href="\{\{LINK\}\}">(this month|July) at Thrive<\/a>/.test(a[i].html||"")){
      a[i]=Object.assign({},ETPL_MONTHLY); try{ localStorage.setItem(ETPL, JSON.stringify(a)); }catch(e){}
    }
    // add the Arabic stock template once, for consoles created before it existed
    if(!a.some(x=>x.id==="monthly-ar")){
      a=a.concat([Object.assign({},ETPL_MONTHLY_AR)]);
      try{ localStorage.setItem(ETPL, JSON.stringify(a)); }catch(e){}
    }
  }
  return a;
}
function setEmailTemplates(a){ return lsSet(ETPL, JSON.stringify(a)); }
function saveEmailTemplate(rec){ rec.up=Date.now(); const a=getEmailTemplates(); const i=a.findIndex(x=>x.id===rec.id); if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setEmailTemplates(a); }
function removeEmailTemplate(id){ setEmailTemplates(getEmailTemplates().filter(x=>x.id!==id)); }
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
function setMailLog(a){ lsSet(MAILLOG, JSON.stringify(a.slice(-800))); }
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
  a.push(r); setMailLog(a); return r;
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
  const params=new URLSearchParams(location.search);
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
  document.addEventListener("selectionchange",()=>{
    const s=window.getSelection(); if(!s.rangeCount) return;
    const r=s.getRangeAt(0);
    if(body.contains(r.commonAncestorContainer) && !r.collapsed) savedRange=r.cloneRange();
  });
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
    tplCache.forEach(tp=>{ const o=document.createElement("option"); o.value=tp.id; o.textContent=tp.name; tplSel.appendChild(o); });
    // ALWAYS start blank: an empty editor with no template. A template is only pre-selected when
    // the writer explicitly asked for one via ?etpl=<id> (e.g. "Compose with" from Templates).
    tplSel.value="";
    const preT=params.get("etpl");
    if(preT && [...tplSel.options].some(o=>o.value===preT)) tplSel.value=preT;
    tplSel.addEventListener("change",()=>{
      if(tplSel.value===""){ clearCompose(); }        // plain: back to an empty editor
      else applyTemplate(currentTpl());
    });
  }
  el("esubject").addEventListener("input",()=>{ subjectDirty=true; });
  if(nameEl) nameEl.addEventListener("input",syncMerge);
  if(firstEl) firstEl.addEventListener("change",syncMerge);
  if(monthEl) monthEl.addEventListener("input",syncMerge);
  applyTemplate(currentTpl());
  refreshLinks();
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
  el("eCopy").addEventListener("click", async ()=>{
    try{
      const html=brandWrap(htmlOut(), isBranded()), text=plainText();
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html],{type:"text/html"}),
          "text/plain": new Blob([text],{type:"text/plain"}) })]);
      } else { await navigator.clipboard.writeText(text); }
      const to=el("eto").value.trim(), subject=el("esubject").value.trim(), m=tplMeta();
      logActivity("email_copy", slug||"", (to?to+" · ":"")+subject);
      logMail({ opp:slug||"", to:to, toName:recName(), subject:subject, templateId:m.templateId, templateName:m.templateName, branded:isBranded(), preview:preview(), provider:"gmail-copy", status:"copied" });
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
  window.onThriveSync=renderQuota;                       // counter refreshes live when another device's sends arrive
  el("eSend").addEventListener("click", async ()=>{
    const to=el("eto").value.trim();
    if(!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ toast(t("cmp_need_to")); return; }
    const ep=getEmailEndpoint();
    if(!ep){ toast(t("cmp_no_ep")); setTimeout(()=>location.href="settings.html",1100); return; }
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
      logMail({ opp:slug||"", to:to, toName:recName(), subject:payload.subject, templateId:m.templateId, templateName:m.templateName, branded:isBranded(), preview:preview(), provider:"endpoint", status:"sent", id:id });
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
    note.textContent = all? "✓ "+t("conn_all_ok") : "⚠ "+t("conn_broken");
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
    if(!ep){ note.hidden=false; note.className="gh-result warn"; note.textContent="⚠ "+t("sy_need_ep"); return; }
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
    if(repoMsg){ note.hidden=false; note.className="gh-result warn"; note.textContent="⚠ "+t("sy_local_only")+" "+repoMsg; }
  });
  connRun("");
  // A device that just unlocked gains its publishing credentials a moment later, when the
  // first sync round opens the vault. Refresh the page once when that lands, so the panel and
  // the fields show what the device actually holds instead of what it held at load.
  let __connRefreshed=false;
  window.onThriveSync=function(){
    try{ syCounts(); }catch(e){}
    if(!__connRefreshed && ghReady() && !el("gh_token").value){
      __connRefreshed=true;
      const c2=ghConfig();
      el("gh_owner").value=c2.owner||""; el("gh_repo").value=c2.repo||"";
      el("gh_branch").value=c2.branch||"main"; el("gh_token").value=c2.token||"";
      status(); connRun("");
    }
  };

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
    function syCounts(){
      const c=el("syCounts"); if(!c) return;
      const mail=getMailLog(), sent=mail.filter(m=>m.status==="sent").length;
      // Two URLs on one settings page is the single most expensive confusion this console has
      // produced, so the page states plainly whether they are the same relay.
      const se=getSyncEndpoint(), ee=getEmailEndpoint();
      const agree=(se&&ee)? (se===ee?'<span class="ok-line">✓ '+esc(t("sy_one_relay"))+'</span>'
                                    :'<span class="warn-line">⚠ '+esc(t("sy_two_relays"))+'</span>') : "";
      c.innerHTML='<b>'+sent+'</b> '+t("sy_c_sent")+' · <b>'+getThreads().length+'</b> '+t("sy_c_threads")+
        ' · <b>'+getSendStamps().length+'</b> '+t("sy_c_stamps")+' · <b>'+getDrafts().length+'</b> '+t("sy_c_opps")+
        (agree?'<br>'+agree:"");
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
      if(!published){ syCounts(); syShow("⚠ "+t("sy_local_only")+" "+epErr, "warn"); return; }
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
  window.onLangApplied=status; status();
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
            <a class="btn sm" href="editor.html?t=${encodeURIComponent(tp.id)}">${t("use_template")}</a>
            <a class="btn ghost sm" href="../templates/${encodeURIComponent(tp.id)}/template.html" download="${esc(tp.id)}.html">${t("dl_template")}</a>
            <a class="btn ghost sm" href="${esc(tp.example)}" target="_blank" rel="noopener">${t("open_page")}</a>
          </div>
        </div>
      </div>`).join("");
  }
  function renderCustom(){
    const list=getCustomTemplates();
    if(!list.length){ el("customList").innerHTML='<div class="empty">'+t("tpl_none")+'</div>'; return; }
    el("customList").innerHTML = list.map(ct=>`
      <div class="item">
        <div class="thumb"><iframe srcdoc="${esc(ct.html||"").slice(0,200000).replace(/"/g,'&quot;')}" loading="lazy" title="${esc(ct.id)}"></iframe></div>
        <div class="item-body">
          <div class="id">${esc(ct.id)} · ${esc(ct.lang||"EN")}</div>
          <h3>${esc(ct.name||ct.id)}</h3>
          <span class="badge edit">${t("tpl_badge_custom")}</span>
          <p class="meta-line">${t("act_upload")}: ${esc((ct.created||"").slice(0,10))||t("none")} · ${Math.round((ct.html||"").length/1024)} KB</p>
          <div class="actions">
            <a class="btn sm" href="editor.html?t=${encodeURIComponent(ct.id)}">${t("use_template")}</a>
            <button class="btn ghost sm" data-dl="${esc(ct.id)}">${t("dl_template")}</button>
            ${ghReady()?`<button class="btn ghost sm" data-pubtpl="${esc(ct.id)}">${t("tpl_publish")}</button>`:""}
            <button class="btn ghost sm danger" data-del="${esc(ct.id)}">${t("tpl_delete")}</button>
          </div>
        </div>
      </div>`).join("");
    el("customList").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      const id=b.getAttribute("data-del");
      if(!confirm(t("tpl_confirm_del"))) return;
      removeCustomTemplate(id); logActivity("tpl_remove", id, ""); renderCustom();
    }));
    el("customList").querySelectorAll("[data-dl]").forEach(b=>b.addEventListener("click",()=>{
      const ct=getCustomTemplate(b.getAttribute("data-dl")); if(ct) download(ct.id+".html", ct.html||"");
    }));
    el("customList").querySelectorAll("[data-pubtpl]").forEach(b=>b.addEventListener("click", async ()=>{
      const ct=getCustomTemplate(b.getAttribute("data-pubtpl")); if(!ct) return;
      b.disabled=true; const old=b.textContent; b.textContent=t("publishing");
      try{ await publishTemplate(ct); logActivity("tpl_publish", ct.id, ""); toast(t("tpl_published")); }
      catch(e){ toast(t("gh_err")+": "+e.message); }
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
    const d=document.createElement("div"); d.innerHTML=String(html||"");
    return (d.textContent||"").replace(/\s+/g," ").trim().slice(0,180);
  }
  function renderEmailTpls(){
    const wrap=el("emailTplList"); if(!wrap) return;
    const list=getEmailTemplates();
    if(!list.length){ wrap.innerHTML='<div class="empty">'+t("et_none")+'</div>'; return; }
    wrap.innerHTML = list.map(et=>{
      const usesMonth=tplUsesMonth(et);
      return `
      <div class="item">
        <div class="item-body">
          <div class="id">EMAIL · ${esc(et.id)}</div>
          <h3>${esc(et.name||et.id)}</h3>
          <div class="meta">
            ${et.id==="monthly"?`<span class="chip">${t("et_default")}</span>`:""}
            ${usesMonth?`<span class="chip tmpl">${t("et_asks_month")}</span>`:""}
            ${/\{\{LINK\}\}/.test(et.html||"")?`<span class="chip">${t("et_has_link")}</span>`:""}
          </div>
          <p class="meta-line"><b>${esc(et.subject||"–")}</b></p>
          <p class="meta-line">${esc(etPreview(et.html))}</p>
          <div class="actions">
            <a class="btn sm" href="compose.html?etpl=${encodeURIComponent(et.id)}">${t("cmp_compose_with")}</a>
            <button class="btn ghost sm" data-etedit="${esc(et.id)}">${t("cmp_link_edit")}</button>
            <button class="btn ghost sm" data-etdup="${esc(et.id)}">${t("et_duplicate")}</button>
            <button class="btn ghost sm danger" data-etdel="${esc(et.id)}">${t("tpl_delete")}</button>
          </div>
        </div>
      </div>`;}).join("");
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
  window.onLangApplied=()=>{ renderBuiltin(); renderCustom(); renderEmailTpls(); };
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
      story.push(t("story_sent").replace("{n}", sent).replace("{p}", contacted));
      if(replies) story.push(t("story_replies").replace("{n}", replies).replace("{r}", rate));
      else if(waiting) story.push(t("story_no_replies").replace("{n}", waiting));
      const totalOpens=pages.reduce((a,p)=>a+p.opens,0);
      if(totalOpens) story.push(t("story_opens").replace("{n}", totalOpens));
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
    const totalOpens=pages.reduce((s,r)=>s+r.opens,0);
    const uniq=new Set(); hits.forEach(e=>e.vid&&uniq.add(e.vid));
    const dw=pages.reduce((a,r)=>{ a.ms+=r.dwellMs; a.n+=r.dwellN; return a; }, {ms:0,n:0});
    const fu=opps.filter(o=>!o.archived&&needsFollowup(o)).length;
    el("tilesPages").innerHTML=
      tile(live, t("home_live_pages"), "", t("tip_live_pages"))+
      tile(opps.length, t("home_total_opps"), "", t("tip_total_opps"))+
      tile(totalOpens, t("ins_total_opens"), "", t("tip_opens"))+
      tile(uniq.size, t("ins_unique"), "", t("tip_unique"))+
      tile(fmtMs(dw.n? dw.ms/dw.n : 0), t("ins_avg_dwell"), "", t("tip_dwell"))+
      tile(fu, t("followup"), fu?"t-warn":"", t("tip_followup"));
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
      let extra = mine? " "+t("home_data_self").replace("{n}", mine) : "";
      // Old local events predate self-tagging, so they cannot be told apart from real opens.
      // While collection is live they are ignored, so say so, and offer to clear them.
      const legacy=legacyLocalHits().length;
      if(legacy && st==="live") extra+=' '+t("home_data_legacy").replace("{n}", legacy)+
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
    opps.forEach(o=>{ byOpp[o.slug]={ slug:o.slug, biz:o.business||o.slug, live:isLive(o), archived:!!o.archived,
      sent:0, replies:0, opens:0, uniq:0, dwellMs:0, dwellN:0, last:"" }; });
    mail.forEach(m=>{
      const k=m.opp||""; if(!k) return;
      const r=byOpp[k]||(byOpp[k]={ slug:k, biz:k, live:false, archived:false, sent:0, replies:0, opens:0, uniq:0, dwellMs:0, dwellN:0, last:"" });
      if(m.status==="sent") r.sent++;
      if(m.direction==="in"||m.status==="replied") r.replies++;
      if(m.ts>r.last) r.last=m.ts;
    });
    Object.keys(byOpp).forEach(k=>{
      const p=pageBySlug[k], r=byOpp[k]; if(!p) return;
      r.opens=p.opens; r.uniq=p.vids.size; r.dwellMs=p.dwellMs; r.dwellN=p.dwellN;
      if(p.lastTs>r.last) r.last=p.lastTs;
    });
    const rows=Object.values(byOpp)
      .filter(r=>!r.archived)                            // archived opportunities stay out of the active view
      .sort((a,b)=> (b.sent+b.opens+b.replies)-(a.sent+a.opens+a.replies) || String(a.biz).localeCompare(String(b.biz)));
    const hth=(label,tip)=>'<th>'+label+'<button type="button" class="info" data-tip="'+esc(tip)+'" aria-label="'+esc(tip)+'">i</button></th>';
    const num=v=>v?('<b>'+v+'</b>'):'<span class="zero">0</span>';
    el("homeCampaigns").innerHTML = rows.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("home_c_opp")+'</th>'+hth(t("cmp_sent_n"),t("tip_c_sent"))+hth(t("ins_opens"),t("tip_opens"))+
        hth(t("ins_unique"),t("tip_unique"))+hth(t("ins_dwell"),t("tip_dwell"))+
        hth(t("cmp_replied_n"),t("tip_replies"))+hth(t("ins_last"),t("tip_c_last"))+'</tr></thead><tbody>'+
        rows.map(r=>'<tr><td><a class="link" href="'+relOpp(r.slug)+'" target="_blank" rel="noopener">'+esc(r.biz)+'</a>'+
          (r.live?'':' <span class="tag tag-plain">'+t("draft")+'</span>')+'</td>'+
          '<td>'+num(r.sent)+'</td><td>'+num(r.opens)+'</td><td>'+num(r.uniq)+'</td>'+
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
    Object.values(byTpl).forEach(r=>{
      r.opps.forEach(slug=>{ const p=pageBySlug[slug]; if(p){ r.opens+=p.opens; r.uniq+=p.vids.size; } });
    });
    const tplRows=Object.values(byTpl).sort((a,b)=> b.sent-a.sent || String(a.name).localeCompare(String(b.name)));
    const pct=(a,b)=> b? Math.round(a/b*100)+"%" : "<span class=\"zero\">0%</span>";
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
    Object.values(byPerson).forEach(r=>{ r.opps.forEach(slug=>{ const p=pageBySlug[slug]; if(p) r.opens+=p.opens; }); });
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

    // ---- most opened pages (only pages that actually have opens; this list IS "top N") ----
    const opened=pages.filter(p=>p.opens>0);
    el("homeTop").innerHTML = opened.length
      ? '<div class="logwrap"><table class="logtable"><thead><tr>'+
        '<th>'+t("ins_item")+'</th>'+hth(t("ins_opens"),t("tip_opens"))+hth(t("ins_unique"),t("tip_unique"))+
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
      note.textContent=t("home_unmeasured").replace("{n}", unmeasured.length)
        .replace("{list}", unmeasured.map(u=>u.business).join("، ")); }
  }
  if(el("homeRepair")) el("homeRepair").addEventListener("click", async ()=>{
    if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
    const btn=el("homeRepair"); btn.disabled=true; const old=btn.textContent; btn.textContent=t("publishing");
    let done=0;
    for(const u of unmeasured){
      try{ await ghPutFile("opp/"+u.slug+"/index.html", withBeacon(u.html), "Add analytics beacon to opp/"+u.slug);
        logActivity("publish", u.slug, "beacon repair"); done++; }catch(e){}
    }
    btn.disabled=false; btn.textContent=old;
    toast(done? t("home_repaired").replace("{n}", done) : t("gh_err"));
    setTimeout(checkBeacons, 1500);
  });
  checkBeacons();
  window.onLangApplied=render;
  window.onThriveSync=render;                            // live refresh when another device's data arrives
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
  window.onLangApplied=render;
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

  async function build(){
    const opps=await mergedOpps();
    const opens={}; opps.forEach(o=>{ opens[o.slug]=opensForSlug(o.slug); });
    return ThriveBoard.build(opps, { opens:opens, mail:getMailLog() });
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
    else if(tk.lane==="live") meta=txt("tok_noemail");
    else if(tk.lane==="replied") meta=txt("tok_answered");
    else if(tk.opens>0) meta=txt("tok_opens", tk.opens).replace(String(tk.opens), num(tk.opens));
    else meta=txt("tok_idle", tk.age).replace(String(tk.age), num(tk.age));
    return '<button class="tok '+cls.slice(1).join(" ")+'" data-slug="'+esc(tk.slug)+'" type="button">'+
      '<span class="tok-name">'+esc(tk.biz)+'</span>'+
      '<span class="tok-meta">'+meta+'</span></button>';
  }

  async function render(){
    syncPill();
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
      if(k==="stalled") location.href="library.html?followup=1";
      else if(k==="archived") location.href="library.html?status=archived";
      else location.href="compose.html";
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

    // A token opens the work for that opportunity. PR 4 turns this into a drawer; until then
    // it is an honest page change rather than a half-built panel.
    document.querySelectorAll(".tok").forEach(tk=>tk.addEventListener("click",()=>{
      const slug=tk.getAttribute("data-slug");
      const name=(tk.querySelector(".tok-name")||{}).textContent||slug;
      // In the shell the work opens beside you. On a single page there is no drawer, and an
      // honest page change beats a panel that is not there.
      if(window.thriveDrawer) window.thriveDrawer.open(slug, "compose", name);
      else location.href="compose.html?slug="+encodeURIComponent(slug);
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
  window.onLangApplied=render;
  window.onThriveSync=render;
  window.onGateUnlocked=render;
  await render();
}

/* ---------- the drawer ----------
   The editor and the composer open from the token that needs them, without a view change and
   without losing your place. It MOVES the existing #view-editor and #view-compose nodes into
   the drawer host rather than duplicating their markup, so the document keeps exactly one
   editor, one composer, and one set of listeners. Duplicating them would mean two elements
   with the same ids and a composer whose send button belongs to whichever copy loaded last.
   Only the shell has a #drawer, so on a single page this whole layer stays dormant. */
function initDrawer(){
  const el=id=>document.getElementById(id);
  const drawer=el("drawer"), scrim=el("drawerScrim"), body=el("drawerBody");
  if(!drawer || !body) return null;
  let opener=null, current="";

  function host(tab){
    const id = tab==="edit" ? "view-editor" : "view-compose";
    const view=document.getElementById(id);
    if(!view) return false;
    // park every other view back where it belongs before adopting this one
    Array.prototype.forEach.call(body.children, n=>{ n.hidden=true; });
    if(view.parentNode!==body) body.appendChild(view);
    view.hidden=false; view.classList.remove("wrap");
    return true;
  }
  function tabs(active){
    drawer.querySelectorAll(".drawer-tab").forEach(b=>b.classList.toggle("on", b.getAttribute("data-tab")===active));
  }

  async function open(slug, tab, title){
    tab=tab||"compose";
    opener=document.activeElement;
    current=slug||"";
    el("drawerTitle").textContent=title||slug||"";
    if(!host(tab)) return;
    tabs(tab);
    drawer.hidden=false; scrim.hidden=false;
    // let the browser paint the closed state before the transition starts
    requestAnimationFrame(()=>{ drawer.classList.add("on"); scrim.classList.add("on"); });
    document.body.style.overflow="hidden";
    try{ if(tab==="edit") await initEditor(slug); else await initCompose(slug); }catch(e){}
    const close=el("drawerClose"); if(close) close.focus();
  }
  function close(){
    drawer.classList.remove("on"); scrim.classList.remove("on");
    document.body.style.overflow="";
    setTimeout(()=>{ drawer.hidden=true; scrim.hidden=true; }, 200);
    if(opener && opener.focus) try{ opener.focus(); }catch(e){}
    opener=null;
  }
  el("drawerClose").addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !drawer.hidden) close(); });
  drawer.querySelectorAll(".drawer-tab").forEach(b=>b.addEventListener("click", ()=>{
    const tab=b.getAttribute("data-tab");
    if(!host(tab)) return;
    tabs(tab);
    try{ if(tab==="edit") initEditor(current); else initCompose(current); }catch(e){}
  }));
  window.thriveDrawer={ open:open, close:close };
  return window.thriveDrawer;
}
