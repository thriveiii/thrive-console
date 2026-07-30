/* Thrive Opportunity Library — shared client logic (vanilla JS, no build step) */
const SITE = "thriveiii.com";
const OPP_PATH = "/opp/";
const STORE = "thrive_opps_v1";

/* ---------- utilities ---------- */
function slugify(s){
  return (s||"").toString().trim().toLowerCase()
    .replace(/['’".]/g,"")
    .replace(/[^a-z0-9؀-ۿ]+/g,"-")
    .replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-");
}
function esc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
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

/* ---------- data ---------- */
async function loadManifest(){
  try{ const r=await fetch("./manifest.json",{cache:"no-store"}); const j=await r.json();
       return {site:j.site||SITE, list:(j.opportunities||[])}; }
  catch(e){ return {site:SITE, list:[]}; }
}
function getDrafts(){ try{ return JSON.parse(localStorage.getItem(STORE)||"[]"); }catch(e){ return []; } }
function setDrafts(a){ localStorage.setItem(STORE, JSON.stringify(a)); }
function saveDraft(rec){
  const a=getDrafts(); const i=a.findIndex(x=>x.slug===rec.slug);
  if(i>=0) a[i]=rec; else a.push(rec); setDrafts(a);
}
function removeDraft(slug){ setDrafts(getDrafts().filter(x=>x.slug!==slug)); }
async function mergedOpps(){
  const {list}=await loadManifest();
  const bySlug={}; list.forEach(o=>bySlug[o.slug]={...o, _local:false});
  getDrafts().forEach(o=>{ if(!bySlug[o.slug]) bySlug[o.slug]={...o,_local:true}; });
  return Object.values(bySlug);
}

/* ---------- dashboard ---------- */
async function initDashboard(){
  const state={ q:"", sort:"new", tmpl:"all", data:[] };
  state.data = await mergedOpps();

  const search=document.getElementById("q");
  const sort=document.getElementById("sort");
  const filt=document.getElementById("filter");
  // populate template filter
  const tmpls=[...new Set(state.data.map(o=>o.template))];
  tmpls.forEach(tp=>{ const op=document.createElement("option"); op.value=tp; op.textContent=tp; filt.appendChild(op); });

  function render(){
    const grid=document.getElementById("grid");
    let rows=state.data.slice();
    if(state.tmpl!=="all") rows=rows.filter(o=>o.template===state.tmpl);
    if(state.q){ const q=state.q.toLowerCase();
      rows=rows.filter(o=>[o.business,o.location,o.template,o.slug].join(" ").toLowerCase().includes(q)); }
    rows.sort((a,b)=>{
      if(state.sort==="az") return (a.business||"").localeCompare(b.business||"");
      const da=(a.sent_on||""), db=(b.sent_on||"");
      return state.sort==="old" ? da.localeCompare(db) : db.localeCompare(da);
    });
    if(!rows.length){ grid.className=""; grid.innerHTML='<div class="empty" data-i18n="empty">'+t("empty")+'</div>'; return; }
    grid.className="grid";
    grid.innerHTML = rows.map(o=>{
      const status = o._local ? '<span class="badge draft">'+t("draft")+'</span>' : '<span class="badge sent">'+t("sent")+'</span>';
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div><p class="biz">${esc(o.business)}</p>
          <a class="link" href="${relOpp(o.slug)}" target="_blank" rel="noopener">${liveUrl(o.slug)}</a></div>
          ${status}
        </div>
        <div class="meta">
          <span class="chip tmpl">${esc(o.template)}</span>
          <span class="chip">${t("col_sent")}: ${esc(o.sent_on)||t("none")}</span>
          <span class="chip">${t("col_location")}: ${esc(o.location)||t("none")}</span>
          <span class="chip">${t("col_phone")}: ${esc(o.phone)||t("none")}</span>
        </div>
        <div class="row">
          <a class="btn sm" href="${relOpp(o.slug)}" target="_blank" rel="noopener" data-i18n="open_page">${t("open_page")}</a>
          <div class="actions">
            <a class="btn ghost sm" href="editor.html?slug=${encodeURIComponent(o.slug)}" data-i18n="edit">${t("edit")}</a>
            ${o._local?`<button class="btn ghost sm" data-del="${o.slug}" data-i18n="remove">${t("remove")}</button>`:""}
          </div>
        </div>
      </div>`;
    }).join("");
    grid.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
      removeDraft(b.getAttribute("data-del")); state.data=state.data.filter(o=>!(o._local&&o.slug===b.getAttribute("data-del"))); render();
    }));
  }
  search.addEventListener("input",e=>{ state.q=e.target.value; render(); });
  sort.addEventListener("change",e=>{ state.sort=e.target.value; render(); });
  filt.addEventListener("change",e=>{ state.tmpl=e.target.value; render(); });
  document.getElementById("exportManifest").addEventListener("click", async ()=>{
    const {site}=await loadManifest();
    const out={ site:site||SITE, base_path:OPP_PATH, updated:new Date().toISOString().slice(0,10),
      opportunities: state.data.map(({_local, ...o})=>o) };
    download("manifest.json", JSON.stringify(out,null,2), "application/json");
  });
  window.onLangApplied=render;
  render();
}

/* ---------- editor ---------- */
async function initEditor(){
  let templateCache={};
  const el=id=>document.getElementById(id);
  async function getTemplate(idT){
    if(templateCache[idT]) return templateCache[idT];
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
  async function refresh(){
    const slug = el("f_slug").value || slugify(el("f_biz").value);
    el("urlpill").textContent = liveUrl(slug||"<name>");
    const html=await currentHTML();
    if(html) el("frame").srcdoc=html;
  }
  function record(){
    const slug = el("f_slug").value || slugify(el("f_biz").value);
    return { slug, business:el("f_biz").value, template: mode==="upload"?"custom":el("f_template").value,
      sent_on:el("f_sent").value, location:el("f_location").value, phone:el("f_phone").value, status:"sent" };
  }

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
  function readFile(f){ const fr=new FileReader(); fr.onload=()=>{ uploadedHTML=fr.result; uploadedName=f.name;
    dz.innerHTML=t("uploaded")+"<b>"+esc(f.name)+"</b>"; if(!el("f_biz").value){ el("f_biz").value=f.name.replace(/\.html?$/i,""); }
    refresh(); }; fr.readAsText(f); }

  // live inputs
  ["f_biz","f_slug","f_quote","f_quoteby","f_proof1","f_proof2","f_proof3","f_want","f_template"].forEach(id=>{
    el(id).addEventListener("input",refresh); el(id).addEventListener("change",refresh);
  });
  el("f_biz").addEventListener("input",()=>{ if(!el("f_slug").dataset.touched) el("f_slug").value=slugify(el("f_biz").value); refresh(); });
  el("f_slug").addEventListener("input",()=>{ el("f_slug").dataset.touched="1"; });

  // actions
  el("dlPage").addEventListener("click", async ()=>{
    if(!el("f_biz").value){ toast(t("need_biz")); return; }
    download("index.html", await currentHTML()); toast(t("dl_toast"));
  });
  el("saveLib").addEventListener("click", ()=>{
    if(!el("f_biz").value){ toast(t("need_biz")); return; }
    saveDraft(record()); toast(t("saved_toast"));
  });
  el("copyManifest").addEventListener("click", ()=>{
    if(!el("f_biz").value){ toast(t("need_biz")); return; }
    const {_local, ...r}=record();
    navigator.clipboard.writeText(JSON.stringify(r,null,2)).then(()=>toast(t("copied_toast")),
      ()=>{ download("entry.json", JSON.stringify(r,null,2), "application/json"); });
  });

  // prefill from ?slug= (edit an existing draft) or default date today
  const params=new URLSearchParams(location.search);
  el("f_sent").value = new Date().toISOString().slice(0,10);
  const editSlug=params.get("slug");
  if(editSlug){
    const d=getDrafts().find(x=>x.slug===editSlug);
    if(d){ el("f_biz").value=d.business||""; el("f_slug").value=d.slug; el("f_slug").dataset.touched="1";
      el("f_sent").value=d.sent_on||el("f_sent").value; el("f_location").value=d.location||""; el("f_phone").value=d.phone||"";
      if(d.template && d.template!=="custom") el("f_template").value=d.template; }
  }
  window.onLangApplied=()=>{ if(mode==="upload" && uploadedName) dz.innerHTML=t("uploaded")+"<b>"+esc(uploadedName)+"</b>"; };
  refresh();
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
  const wrap=document.getElementById("tplList");
  function render(){
    const l=getLang();
    wrap.innerHTML = APPROVED_TEMPLATES.map(tp=>`
      <div class="item">
        <div class="thumb"><iframe src="${tp.example}" loading="lazy" title="${tp.id}"></iframe></div>
        <div>
          <div class="id">${tp.id} · ${tp.lang}</div>
          <h3>${l==="ar"?tp.name_ar:tp.name_en}</h3>
          <span class="badge sent">${t("status_approved")}</span>
          <p>${l==="ar"?tp.desc_ar:tp.desc_en}</p>
          <div class="actions">
            <a class="btn sm" href="editor.html?t=${tp.id}" data-i18n="use_template">${t("use_template")}</a>
            <a class="btn ghost sm" href="../templates/${tp.id}/template.html" download="${tp.id}.html" data-i18n="dl_template">${t("dl_template")}</a>
            <a class="btn ghost sm" href="${tp.example}" target="_blank" rel="noopener" data-i18n="open_page">${t("open_page")}</a>
          </div>
        </div>
      </div>`).join("");
  }
  window.onLangApplied=render;
  render();
}
