/* Thrive Opportunity Library — shared client logic (vanilla JS, no build step) */
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

/* ---------- activity log ---------- */
function getActivity(){ try{ return JSON.parse(localStorage.getItem(LOG)||"[]"); }catch(e){ return []; } }
function setActivity(a){ try{ localStorage.setItem(LOG, JSON.stringify(a.slice(-800))); }catch(e){} }
function logActivity(action, slug, detail){
  const a=getActivity();
  a.push({ ts:new Date().toISOString(), action:action||"", slug:slug||"", detail:detail||"" });
  setActivity(a);
}
window.logActivity = logActivity;

/* ---------- custom templates (local registry) ---------- */
const TPLSTORE = "thrive_templates_v1";
function getCustomTemplates(){ try{ return JSON.parse(localStorage.getItem(TPLSTORE)||"[]"); }catch(e){ return []; } }
function setCustomTemplates(a){ try{ localStorage.setItem(TPLSTORE, JSON.stringify(a)); return true; }catch(e){ toast(t("storage_full")); return false; } }
function getCustomTemplate(id){ return getCustomTemplates().find(x=>x.id===id); }
function saveCustomTemplate(rec){ const a=getCustomTemplates(); const i=a.findIndex(x=>x.id===rec.id); if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setCustomTemplates(a); }
function removeCustomTemplate(id){ setCustomTemplates(getCustomTemplates().filter(x=>x.id!==id)); }

/* ---------- analytics (beacon hits stored same-origin) ---------- */
const HITS = "thrive_hits_v1";
const ENDPT = "thrive_endpoint";
function getHits(){ try{ return JSON.parse(localStorage.getItem(HITS)||"[]"); }catch(e){ return []; } }
function getEndpoint(){ try{ return localStorage.getItem(ENDPT)||""; }catch(e){ return ""; } }
function setEndpoint(u){ try{ u?localStorage.setItem(ENDPT,u):localStorage.removeItem(ENDPT); }catch(e){} }
function opensForSlug(slug){ let n=0; getHits().forEach(e=>{ if((e.type==="open"||!e.type)&&e.slug===slug) n++; }); return n; }

/* ---------- pipeline stages (mini CRM) ---------- */
const STAGES=["sent","opened","replied","won","lost"];
function daysSince(d){ if(!d) return 0; const ms=Date.parse(d+"T00:00:00Z"); if(isNaN(ms)) return 0; return Math.floor((Date.now()-ms)/86400000); }

/* ---------- backup / restore (everything, minus the GitHub token) ---------- */
function exportBackup(){
  return { _type:"thrive-console-backup", v:1, exported:new Date().toISOString(),
    opps:getDrafts(), templates:getCustomTemplates(), activity:getActivity(),
    hits:getHits(), endpoint:getEndpoint() };
}
function importBackup(obj){
  if(!obj || obj._type!=="thrive-console-backup") throw new Error("Not a Thrive backup file");
  if(Array.isArray(obj.opps)) setDrafts(obj.opps);
  if(Array.isArray(obj.templates)) setCustomTemplates(obj.templates);
  if(Array.isArray(obj.activity)) setActivity(obj.activity);
  if(Array.isArray(obj.hits)){ try{ localStorage.setItem(HITS, JSON.stringify(obj.hits)); }catch(e){} }
  if(typeof obj.endpoint==="string") setEndpoint(obj.endpoint);
}

/* ---------- GitHub publishing (the console's backend = the repo itself) ---------- */
const GH = "thrive_gh_v1";
function ghConfig(){ try{ return JSON.parse(localStorage.getItem(GH)||"{}"); }catch(e){ return {}; } }
function setGhConfig(c){ try{ localStorage.setItem(GH, JSON.stringify(c)); }catch(e){} }
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
  if(!r.ok) throw new Error("GitHub "+r.status+" — "+(await r.text()).slice(0,140));
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
async function publishOpp(rec){
  await ghPutFile("opp/"+rec.slug+"/index.html", rec.html||"", "Publish opp/"+rec.slug);
  const mf=await ghGetFile("library/manifest.json");
  let man = mf ? (JSON.parse(unb64(mf.content))||{}) : {};
  man.site=man.site||SITE; man.base_path=man.base_path||OPP_PATH; man.opportunities=man.opportunities||[];
  const e=manifestEntry(rec); const i=man.opportunities.findIndex(o=>o.slug===rec.slug);
  if(i>=0) man.opportunities[i]=e; else man.opportunities.push(e);
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
function setDrafts(a){ try{ localStorage.setItem(STORE, JSON.stringify(a)); }catch(e){} }
function getDraft(slug){ return getDrafts().find(x=>x.slug===slug); }
function saveDraft(rec){
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

  function isLive(o){ return !o._local || !!o.published; }
  function effStage(o){ const op=opensForSlug(o.slug); if((!o.stage||o.stage==="sent")&&op>0) return "opened"; return o.stage||"sent"; }
  function needsFollowup(o){ return isLive(o) && !o.archived && effStage(o)==="sent" && opensForSlug(o.slug)===0 && daysSince(o.sent_on)>=3; }
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
    if(!rows.length){ grid.className="empty-wrap"; grid.innerHTML='<div class="empty">'+t("empty")+'</div>'; return; }
    grid.className="grid";
    // pipeline summary
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
          ${o.html?`<button class="btn ghost sm" data-prev="${esc(o.slug)}">${t("preview")}</button>`:""}
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
      if(state.status==="followup") render();
    }));
    grid.querySelectorAll("[data-pdf]").forEach(b=>b.addEventListener("click",()=>{
      const o=state.data.find(x=>x.slug===b.getAttribute("data-pdf")); if(!o) return;
      if(isLive(o)){ const w=window.open(relOpp(o.slug),"_blank"); if(w) w.addEventListener("load",()=>setTimeout(()=>w.print(),300)); }
      else { const w=openLocalPreview(o.html); if(w) setTimeout(()=>{ try{w.print();}catch(e){} },500); }
    }));
    grid.querySelectorAll("[data-unpub]").forEach(b=>b.addEventListener("click", async ()=>{
      const slug=b.getAttribute("data-unpub"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
      if(!confirm(t("confirm_unpublish"))) return;
      b.disabled=true; b.textContent=t("publishing");
      try{
        await unpublishOpp(slug);
        // keep a local draft copy so it can be re-published/edited
        saveDraft({slug, business:o.business, template:o.template, sent_on:o.sent_on, location:o.location, phone:o.phone, status:o.status||"sent", published:false, html:o.html||"", mode:o.mode||"upload"});
        logActivity("unpublish", slug, o.business); toast(t("unpublished_ok"));
        state.data=await mergedOpps(); render();
      }catch(e){ toast(t("gh_err")+": "+e.message); b.disabled=false; b.textContent=t("unpublish"); }
    }));
    grid.querySelectorAll("[data-prev]").forEach(b=>b.addEventListener("click",()=>{
      const o=state.data.find(x=>x.slug===b.getAttribute("data-prev")); if(o) openLocalPreview(o.html);
    }));
    grid.querySelectorAll("[data-pub]").forEach(b=>b.addEventListener("click", async ()=>{
      const slug=b.getAttribute("data-pub"); const o=state.data.find(x=>x.slug===slug); if(!o) return;
      if(!o.html){ toast(t("no_content_publish")); return; }
      if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
      b.disabled=true; b.textContent=t("publishing");
      try{
        await publishOpp(o); saveDraft({slug, published:true}); o.published=true;
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

  search.addEventListener("input",e=>{ state.q=e.target.value; render(); });
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
async function initEditor(){
  let templateCache={};
  const el=id=>document.getElementById(id);
  const existing = await allSlugs();

  // add custom templates to the picker, then honor ?t=
  const tsel=el("f_template");
  getCustomTemplates().forEach(ct=>{
    if([...tsel.options].some(o=>o.value===ct.id)) return;
    const o=document.createElement("option"); o.value=ct.id; o.textContent=ct.id+" · "+(ct.name||ct.id)+" (custom)"; tsel.appendChild(o);
  });
  const tParam=new URLSearchParams(location.search).get("t");
  if(tParam && [...tsel.options].some(o=>o.value===tParam)) tsel.value=tParam;

  async function getTemplate(idT){
    if(templateCache[idT]) return templateCache[idT];
    const custom=getCustomTemplate(idT);
    if(custom){ templateCache[idT]=custom.html||""; return templateCache[idT]; }
    const r=await fetch("../templates/"+idT+"/template.html",{cache:"no-store"});
    const txt=await r.text(); templateCache[idT]=txt; return txt;
  }
  function fill(tpl, v){
    let h=tpl;
    if(!v.QUOTE || !v.QUOTE.trim()){
      h=h.replace(/<!--QUOTE_START-->[\s\S]*?<!--QUOTE_END-->/,"");
    }
    const subject=encodeURIComponent((v.BIZ||"Opportunity")+" x Thrive");
    const map={
      BIZ:esc(v.BIZ), QUOTE:esc(v.QUOTE), QUOTE_BY:esc(v.QUOTE_BY),
      PROOF1:esc(v.PROOF1), PROOF2:esc(v.PROOF2), PROOF3:esc(v.PROOF3),
      WANT:esc(v.WANT), SUBJECT:subject
    };
    Object.keys(map).forEach(k=>{ h=h.split("{{"+k+"}}").join(map[k]); });
    return h;
  }
  function values(){
    return { BIZ:el("f_biz").value, QUOTE:el("f_quote").value, QUOTE_BY:el("f_quoteby").value,
      PROOF1:el("f_proof1").value, PROOF2:el("f_proof2").value, PROOF3:el("f_proof3").value,
      WANT:el("f_want").value };
  }
  let mode="fill", uploadedHTML=null, uploadedName="";
  async function currentHTML(){
    if(mode==="upload") return uploadedHTML||"";
    const tpl=await getTemplate(el("f_template").value);
    return fill(tpl, values());
  }
  function curSlug(){ return (el("f_slug").value.trim() || slugify(el("f_biz").value)); }
  function checkCollision(){
    const s=curSlug(); const warn=el("slugWarn"); if(!warn) return;
    const editing=new URLSearchParams(location.search).get("slug");
    warn.hidden = !(s && s!==editing && existing.indexOf(s)>=0);
  }
  async function refresh(){
    const slug = curSlug();
    el("urlpill").textContent = liveUrl(slug||"<name>");
    checkCollision();
    const html=await currentHTML();
    el("frame").srcdoc = html || "<!doctype html><meta charset='utf-8'>";
  }
  let editingLive=false;
  function record(){
    const slug = curSlug(); const v=values();
    return { slug, business:el("f_biz").value.trim(),
      template: mode==="upload"?"custom":el("f_template").value,
      sent_on:el("f_sent").value, location:el("f_location").value.trim(),
      phone:el("f_phone").value.trim(), status:"sent", mode:mode, published:editingLive,
      fields:{ QUOTE:v.QUOTE, QUOTE_BY:v.QUOTE_BY, PROOF1:v.PROOF1, PROOF2:v.PROOF2, PROOF3:v.PROOF3, WANT:v.WANT } };
  }
  async function fullRecord(){ const r=record(); r.html=await currentHTML(); return r; }

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
    el(id).addEventListener("input",refresh); el(id).addEventListener("change",refresh);
  });
  el("f_location").addEventListener("input",()=>{}); el("f_phone").addEventListener("input",()=>{});
  el("f_biz").addEventListener("input",()=>{ if(!el("f_slug").dataset.touched) el("f_slug").value=slugify(el("f_biz").value); refresh(); });
  el("f_slug").addEventListener("input",()=>{ el("f_slug").dataset.touched="1"; refresh(); });

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
    const rec=await fullRecord(); const isNew = existing.indexOf(rec.slug)<0;
    saveDraft(rec);
    if(isNew) existing.push(rec.slug);
    logActivity(isNew?"create":"save", rec.slug, rec.business);
    toast(t("saved_toast"));
  });
  const pubBtn=el("publishBtn");
  if(pubBtn) pubBtn.addEventListener("click", async ()=>{
    if(!el("f_biz").value.trim()){ toast(t("need_biz")); return; }
    if(missingRequired().length){ toast(t("need_fields")); return; }
    if(!ghReady()){ toast(t("gh_needed")); setTimeout(()=>location.href="settings.html",900); return; }
    const rec=await fullRecord();
    pubBtn.disabled=true; const old=pubBtn.textContent; pubBtn.textContent=t("publishing");
    try{
      await publishOpp(rec);
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
  const editSlug=params.get("slug");
  if(editSlug){
    const all=await mergedOpps();
    const d=all.find(x=>x.slug===editSlug);
    if(d){
      editingLive = (!d._local || !!d.published);
      el("f_biz").value=d.business||""; el("f_slug").value=d.slug; el("f_slug").dataset.touched="1";
      el("f_sent").value=d.sent_on||el("f_sent").value; el("f_location").value=d.location||""; el("f_phone").value=d.phone||"";
      if(d.template && d.template!=="custom"){ el("f_template").value=d.template; }
      // restore an uploaded/custom page so editing keeps its content
      if((d.mode==="upload" || d.template==="custom") && d.html){
        mode="upload"; uploadedHTML=d.html; uploadedName=(d.slug||"page")+".html";
        el("mode_upload").classList.add("on"); el("mode_fill").classList.remove("on");
        el("fillFields").hidden=true; el("uploadBox").hidden=false;
        dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>";
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
  window.onLangApplied=()=>{ if(mode==="upload" && uploadedName) dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>"; };
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
  function renderCampaigns(){
    const wrap=el("campaigns"); if(!wrap) return;
    const mail=getMailLog();
    if(!mail.length){ wrap.innerHTML=""; return; }
    const byOpp={};
    mail.forEach(m=>{ const k=m.opp||"—"; (byOpp[k]=byOpp[k]||[]).push(m); });
    const cards=Object.keys(byOpp).map(k=>{
      const list=byOpp[k]; const sent=list.filter(m=>m.status==="sent").length;
      const replied=list.filter(m=>m.status==="replied").length;
      const last=list[list.length-1];
      return `<div class="tile"><div class="tile-v">${sent}<span class="tile-sub"> ${t("cmp_sent_n")}${replied?" · "+replied+" "+t("cmp_replied_n"):""}</span></div>
        <div class="tile-k">${esc(k)} · ${esc((last.to||"—"))}</div></div>`;
    }).join("");
    wrap.innerHTML='<h3 class="block-h">'+t("act_campaigns")+'</h3><div class="tiles">'+cards+'</div>';
  }
  function render(){
    renderCampaigns();
    let rows=getActivity().slice().reverse();
    if(cat!=="all") rows=rows.filter(r=>actCat(r.action)===cat);
    const wrap=el("logBody");
    if(!rows.length){ wrap.innerHTML='<div class="empty">'+t("act_empty")+'</div>'; return; }
    wrap.innerHTML='<div class="logwrap"><table class="logtable"><thead><tr>'+
      '<th>'+t("act_time")+'</th><th>'+t("act_category")+'</th><th>'+t("act_action")+'</th><th>'+t("act_item")+'</th><th>'+t("act_detail")+'</th></tr></thead><tbody>'+
      rows.map(r=>`<tr><td class="mono">${esc(fmt(r.ts))}</td><td><span class="tag tag-cat-${esc(actCat(r.action))}">${t("cat_"+actCat(r.action))}</span></td><td><span class="tag tag-${esc(r.action)}">${esc(actionLabel(r.action))}</span></td><td class="mono">${esc(r.slug)||"—"}</td><td>${esc(r.detail)||"—"}</td></tr>`).join("")+
      '</tbody></table></div>';
  }
  el("logRefresh").addEventListener("click",render);
  el("logReply").addEventListener("click",()=>{
    const to=prompt(t("act_reply_who")); if(!to) return;
    const opp=prompt(t("act_reply_opp"))||"";
    logActivity("reply", opp.trim(), to.trim());
    logMail({ opp:opp.trim(), to:to.trim(), subject:"(reply)", provider:"manual", status:"replied" });
    toast(t("act_reply_logged")); render();
  });
  el("logClear").addEventListener("click",()=>{
    if(!confirm(t("confirm_clear"))) return;
    setActivity([]); try{localStorage.removeItem(MAILLOG);}catch(e){} logActivity("clear","",""); render();
  });
  el("logExport").addEventListener("click",()=>{
    download("thrive-activity.json", JSON.stringify({ activity:getActivity(), mail:getMailLog() },null,2), "application/json");
  });
  window.onLangApplied=()=>{ renderChips(); render(); };
  renderChips(); render();
}

/* ---------- email compose + send ---------- */
const EMAIL_EP = "thrive_email_ep";
const FROM_EMAIL = "hi@thriveiii.com";
function getEmailEndpoint(){ try{ return localStorage.getItem(EMAIL_EP)||""; }catch(e){ return ""; } }
function setEmailEndpoint(u){ try{ u?localStorage.setItem(EMAIL_EP,u):localStorage.removeItem(EMAIL_EP); }catch(e){} }

/* email templates (reusable subject + body with merge fields) */
const ETPL = "thrive_email_templates_v1";
function getEmailTemplates(){
  let a; try{ a=JSON.parse(localStorage.getItem(ETPL)||"null"); }catch(e){ a=null; }
  if(!a){ a=[{ id:"monthly", name:"Monthly update", subject:"{{BIZ}} · Thrive",
    html:'Hi {{NAME}},<br><br>End of the month, so here is <a href="{{LINK}}">this month at Thrive</a>. We take on the work we think we’ll be proud of. If that could be yours, just say hi.<br><br>See you next month!<br><br>Abdullah Thyab<br>thriveiii.com' }]; }
  return a;
}
function setEmailTemplates(a){ try{ localStorage.setItem(ETPL, JSON.stringify(a)); return true; }catch(e){ toast(t("storage_full")); return false; } }
function saveEmailTemplate(rec){ const a=getEmailTemplates(); const i=a.findIndex(x=>x.id===rec.id); if(i>=0)a[i]={...a[i],...rec}; else a.push(rec); return setEmailTemplates(a); }
function removeEmailTemplate(id){ setEmailTemplates(getEmailTemplates().filter(x=>x.id!==id)); }
function mergeFields(str, o, name){
  return (str||"").split("{{BIZ}}").join((o&&o.business)||"")
    .split("{{LINK}}").join(o?liveUrl(o.slug):"")
    .split("{{NAME}}").join(name||"there")
    .split("{{SLUG}}").join(o?o.slug:"");
}

/* mail log — every send/copy/reply, per recipient (campaign documentation) */
const MAILLOG = "thrive_mail_v1";
function getMailLog(){ try{ return JSON.parse(localStorage.getItem(MAILLOG)||"[]"); }catch(e){ return []; } }
function setMailLog(a){ try{ localStorage.setItem(MAILLOG, JSON.stringify(a.slice(-1000))); }catch(e){} }
function logMail(rec){ const a=getMailLog(); a.push(Object.assign({ ts:new Date().toISOString() }, rec)); setMailLog(a); }

async function initCompose(){
  const el=id=>document.getElementById(id);
  const body=el("ebody");
  const params=new URLSearchParams(location.search);
  const slug=params.get("slug");
  const oppUrl = slug ? liveUrl(slug) : "";

  function cmd(c,v){ body.focus(); document.execCommand(c,false,v||null); }
  el("tbBold").addEventListener("click",()=>cmd("bold"));
  el("tbItalic").addEventListener("click",()=>cmd("italic"));
  el("tbList").addEventListener("click",()=>cmd("insertUnorderedList"));
  el("tbUnlink").addEventListener("click",()=>cmd("unlink"));
  el("tbLink").addEventListener("click",()=>{
    const sel=window.getSelection();
    if(!sel.rangeCount || sel.isCollapsed){ toast(t("cmp_select_first")); return; }
    const url=prompt(t("cmp_link_prompt"), oppUrl||"https://");
    if(url) cmd("createLink", url);
  });
  const tbOpp=el("tbOpp");
  if(slug && tbOpp){ tbOpp.hidden=false;
    tbOpp.addEventListener("click",()=>{
      const sel=window.getSelection();
      if(!sel.rangeCount || sel.isCollapsed){ toast(t("cmp_select_first")); return; }
      cmd("createLink", oppUrl);
    });
  }

  el("efrom").value=FROM_EMAIL;
  let oppObj=null;
  if(slug){ const all=await mergedOpps(); oppObj=all.find(x=>x.slug===slug)||null; }
  const nameEl=el("ename"), tplSel=el("etpl");
  function applyTemplate(tp){
    if(!tp) return;
    el("esubject").value = mergeFields(tp.subject, oppObj, nameEl?nameEl.value.trim():"");
    body.innerHTML = mergeFields(tp.html, oppObj, nameEl?nameEl.value.trim():"");
  }
  if(tplSel){
    getEmailTemplates().forEach(tp=>{ const o=document.createElement("option"); o.value=tp.id; o.textContent=tp.name; tplSel.appendChild(o); });
    const preT=params.get("etpl");
    if(preT && [...tplSel.options].some(o=>o.value===preT)) tplSel.value=preT;
    tplSel.addEventListener("change",()=>applyTemplate(getEmailTemplates().find(x=>x.id===tplSel.value)));
  }
  if(nameEl) nameEl.addEventListener("input",()=>applyTemplate(getEmailTemplates().find(x=>x.id===(tplSel?tplSel.value:"monthly"))));
  applyTemplate(getEmailTemplates().find(x=>x.id===(tplSel?tplSel.value:"monthly")) || getEmailTemplates()[0]);
  const saveT=el("eSaveTpl");
  if(saveT) saveT.addEventListener("click",()=>{
    const name=prompt(t("cmp_tpl_name")); if(!name) return;
    const id=slugify(name)||("tpl"+getEmailTemplates().length);
    saveEmailTemplate({ id, name, subject:el("esubject").value, html:body.innerHTML });
    if(tplSel && ![...tplSel.options].some(o=>o.value===id)){ const op=document.createElement("option"); op.value=id; op.textContent=name; tplSel.appendChild(op); }
    if(tplSel) tplSel.value=id;
    logActivity("etpl_add", id, name); toast(t("cmp_tpl_saved"));
  });

  function plainText(){ return body.innerText; }
  el("eCopy").addEventListener("click", async ()=>{
    try{
      const html=body.innerHTML, text=plainText();
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html],{type:"text/html"}),
          "text/plain": new Blob([text],{type:"text/plain"}) })]);
      } else { await navigator.clipboard.writeText(text); }
      const to=el("eto").value.trim(), subject=el("esubject").value.trim();
      logActivity("email_copy", slug||"", (to?to+" · ":"")+subject);
      logMail({ opp:slug||"", to:to, subject:subject, provider:"gmail-copy", status:"copied" });
      toast(t("cmp_copied"));
    }catch(e){ toast(t("cmp_copy_err")); }
  });
  el("eMail").addEventListener("click",()=>{
    const to=el("eto").value.trim(), subject=el("esubject").value.trim();
    location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(plainText());
  });
  el("eSend").addEventListener("click", async ()=>{
    const to=el("eto").value.trim();
    if(!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ toast(t("cmp_need_to")); return; }
    const ep=getEmailEndpoint();
    if(!ep){ toast(t("cmp_no_ep")); setTimeout(()=>location.href="settings.html",1100); return; }
    const payload={ from:FROM_EMAIL, to:to, subject:el("esubject").value.trim(), html:body.innerHTML, text:plainText() };
    el("eSend").disabled=true; const old=el("eSend").textContent; el("eSend").textContent=t("cmp_sending");
    try{
      const r=await fetch(ep,{ method:"POST", headers:{"Content-Type":"text/plain;charset=UTF-8"}, body:JSON.stringify(payload) });
      const txt=await r.text();
      if(!r.ok) throw new Error(r.status+" "+txt.slice(0,140));
      let id="", parsed=null; try{ parsed=JSON.parse(txt); }catch(_){}
      if(parsed && parsed.ok===false) throw new Error(parsed.error||"send failed");
      if(parsed) id=parsed.id||"";
      logActivity("email", slug||"", to+" · "+payload.subject);
      logMail({ opp:slug||"", to:to, subject:payload.subject, provider:"endpoint", status:"sent", id:id });
      toast(t("cmp_sent"));
    }catch(e){ toast(t("cmp_send_err")+": "+e.message); }
    finally{ el("eSend").disabled=false; el("eSend").textContent=old; }
  });
}

/* ---------- settings (GitHub publishing + analytics endpoint) ---------- */
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
  el("ghSave").addEventListener("click",()=>{ persist(); logActivity("settings","","github config"); toast(t("settings_saved")); status(); });
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
  if(el("em_ep")){ el("em_ep").value=getEmailEndpoint();
    el("emSave").addEventListener("click",()=>{ setEmailEndpoint(el("em_ep").value.trim()); logActivity("settings","","email endpoint"); toast(t("settings_saved")); }); }
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
    const ok=saveCustomTemplate({ id, name:el("tpl_name").value.trim()||id, lang:el("tpl_lang").value||"EN",
      html:pendingHTML, created:new Date().toISOString() });
    if(!ok) return;
    logActivity("tpl_add", id, el("tpl_name").value.trim());
    pendingHTML=null; dz.innerHTML=t("upload_dz"); el("tpl_id").value=""; el("tpl_name").value="";
    toast(t("tpl_added")); renderCustom();
  });

  function renderEmailTpls(){
    const wrap=el("emailTplList"); if(!wrap) return;
    wrap.innerHTML = getEmailTemplates().map(et=>`
      <div class="item">
        <div class="item-body">
          <div class="id">EMAIL · ${esc(et.id)}</div>
          <h3>${esc(et.name)}</h3>
          <p class="meta-line">${esc(et.subject)}</p>
          <div class="actions">
            <a class="btn sm" href="compose.html?etpl=${encodeURIComponent(et.id)}">${t("cmp_compose_with")}</a>
            ${et.id!=="monthly"?`<button class="btn ghost sm danger" data-etdel="${esc(et.id)}">${t("tpl_delete")}</button>`:""}
          </div>
        </div>
      </div>`).join("");
    wrap.querySelectorAll("[data-etdel]").forEach(b=>b.addEventListener("click",()=>{
      const id=b.getAttribute("data-etdel");
      if(!confirm(t("tpl_confirm_del"))) return;
      removeEmailTemplate(id); logActivity("etpl_remove", id, ""); renderEmailTpls();
    }));
  }
  window.onLangApplied=()=>{ renderBuiltin(); renderCustom(); renderEmailTpls(); };
  renderBuiltin(); renderCustom(); renderEmailTpls();
}

/* ---------- insights (analytics) ---------- */
async function initInsights(){
  const el=id=>document.getElementById(id);
  el("epInput").value = getEndpoint();

  function fmtDur(ms){ if(!ms) return "—"; const s=Math.round(ms/1000); if(s<60) return s+"s"; const m=Math.floor(s/60); return m+"m "+(s%60)+"s"; }
  function fmtDate(ts){ try{ return new Date(ts).toLocaleString(getLang()==="ar"?"ar":"en",{dateStyle:"medium",timeStyle:"short"}); }catch(e){ return ts||"—"; } }

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
    const dwellVals=rows.filter(r=>r.dwellN).map(r=>r.dwellMs/r.dwellN);
    const avgDwell=dwellVals.length? dwellVals.reduce((a,b)=>a+b,0)/dwellVals.length : 0;
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
        <td><b>${r.opens}</b></td><td>${r.vids.size}</td><td>${r.ips.size||"—"}</td>
        <td>${r.dwellN?fmtDur(r.dwellMs/r.dwellN):"—"}</td><td class="mono">${r.lastTs?esc(fmtDate(r.lastTs)):"—"}</td>
        <td>${spark(r.days)}</td></tr>`).join("")+'</tbody></table></div>';
  }

  el("epSave").addEventListener("click",()=>{ setEndpoint(el("epInput").value.trim()); toast(t("ins_saved")); render(); });
  el("insRefresh").addEventListener("click",render);
  el("insClear").addEventListener("click",()=>{ if(!confirm(t("ins_confirm_clear"))) return; try{localStorage.removeItem(HITS);}catch(e){} render(); });
  window.onLangApplied=render;
  render();
}
