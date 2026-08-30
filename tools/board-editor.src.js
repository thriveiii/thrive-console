// ===================================================================================================
// UNIFIED MESSAGE EDITOR (compose + reply) - net-new on board.html (EDITOR_EVIDENCE 2: no compose surface
// exists today; the L5 send refuses when data.outreach_subject/outreach_text are both empty, board.html
// gate). Inlined verbatim into library/board.html by tools/bundle.js (interpolated as a string, so no
// template escaping; this file therefore uses NO backticks and NO dollar-brace). Runs inside board.html's
// IIFE alongside the L5 send clone (board-send.src.js) and the L5.5 recipient field (board-recipient.src.js),
// reusing their scope: esc, t, oppReadData, oppPatch, sendCompile, firstRecipient, liveUrl, MF_LINK,
// bareAddress, isEmail, findRow, refreshDrawer, reloadBoardData, __drawerSlug, __writing, __act, root,
// and window.__thriveIdentity (Step 2 identity).
//
// WHAT IT DOES (one surface for both first compose and reply):
//   * subject input + body textarea (textarea so newlines are real, the L5.5 lesson), pre-filled from the
//     opp record (data.outreach_subject / data.outreach_text) or empty.
//   * a SEPARATE, OPTIONAL Signature field (E0, Thyab): its own textarea (#edSig), distinct from the body.
//     Its live value IS data.sig - the single source. Empty = no signature block appended (fully optional).
//     A "Use my signature" button FILLS the field from runtime identity as three lines (name / title / site);
//     it is a convenience fill only, never an automatic injection. The editor NEVER derives or fuses a
//     signature into the body: the body is shown and sent exactly as typed.
//   * the opp link inserted as the LINK merge token (MF_LINK, built by concatenation), which sendCompile
//     tokenizes to liveUrl(slug) = console.thriveiii.com/opp/<slug> (EDITOR_EVIDENCE 3); never a hardcoded URL.
//   * a live preview compiled by the SAME sendCompile the send path uses, so preview == send (no
//     false-success gap): the preview iframe html is byte-identical to what runSend would POST.
//   * debounced auto-save to data.outreach_subject/outreach_text/sig via the bounded oppPatch (same shape
//     as L4/2B/L5.5 writes), optimistic confirm-or-revert with a visible red on failure and NEVER a phantom
//     save. No forced value reset on each keystroke, so the native textarea undo stack is preserved (ConTh 4).
//   * a light pre-send checklist (subject / body / recipient / link). The Send button is greyed while the
//     MESSAGE is incomplete (subject/body/link); the RECIPIENT check is shown but stays enforced by the
//     existing runSend gate (its red refusal is the tested backstop), so this pre-flight never walls off the
//     send path. Reply carries the opp's slug for free: the editor is bound to one slug and runSend(slug)
//     stamps outboundHeaders(slug) Reply-To hi+<slug> (EDITOR_EVIDENCE 4), never a campaign.
//   * Send itself is UNCHANGED: the editor only prepares subject/body/sig/link on the record; the actual
//     send is the existing L5 single-recipient path (runSend). No fork, no duplicate send logic.
// ===================================================================================================

var __edT = {};        // per-slug debounce timer id
var __edSaving = false; // editor's own in-flight guard (separate from the shared __writing send/note lock)
var __edBase = {};      // per-slug base data jsonb (non-message fields), captured at render for the preview compile
var __edStat = {};      // per-slug transient save status {msg,cls}, re-rendered on each drawer paint

// The editor renders for any editable opp: not archived, not a terminal tray declaration (won/lost/dropped).
// It deliberately does NOT require has_email, so an opp with NO prepared message can be given one from the
// board, flipping the L5 gate on the next reload. Sent/replied/live/draft all show it (reply is just a new
// compose on the same slug).
function editorEligible(row){
  if(!row) return false;
  if(row.archived) return false;
  if(TRAY_STAGES.indexOf((row&&row.stage)||"")>=0) return false;
  return true;
}

// E0: the signature is the operator's OWN field, not an auto-derived value. edSignature() is the LIVE value of
// the Signature textarea (#edSig) - authoritative and OPTIONAL: an empty field ships an empty data.sig, so NO
// signature block is appended (sendCompile/lightHtml render nothing when sig is empty). The editor never
// injects a signature on its own; the operator types one, fills one from identity via "Use my signature", or
// leaves it blank.
function edIdentity(){ try{ return window.__thriveIdentity || {}; }catch(e){ return {}; } }
function edSignature(){ return edVal("edSig"); }
// The "Use my signature" preset: a quiet three-line block from runtime identity, name / title / site, each on
// its own line. Title omitted if unset (name then site); name omitted if unset (site alone). This only FILLS
// the field on demand; it is never applied automatically. The site is the send-side agency constant.
function edSignaturePreset(){
  var id = edIdentity();
  var name = String(id.name==null?"":id.name).trim();
  var title = String(id.title==null?"":id.title).trim();
  var site = (typeof AGENCY_SITE_L5!=="undefined" && AGENCY_SITE_L5) ? AGENCY_SITE_L5 : "thriveiii.com";
  var lines = [];
  if(name) lines.push(name);
  if(title) lines.push(title);
  lines.push(site);
  return lines.join("\n");
}

// SURFACE SCOPING (COMPOSE_SURFACE_EVIDENCE A1): the editor markup (#edSubj/#edBody/#edSig/#edPreview/
// #edLink/#edStatus and the checklist items) is mounted by BOTH the drawer (#drawer) and the standalone
// New-message overlay (#nmPanel). When both exist, document.getElementById returns the FIRST in DOM order
// (the drawer, which sits before #nmPanel), so overlay reads/writes would bind to the drawer's fields.
// edRoot() returns the ACTIVE compose surface - the overlay while it is open, otherwise the drawer - and
// edEl() scopes every compose lookup to it, so a read never resolves to a hidden second copy.
function edRoot(){
  if(typeof __nmOpen!=="undefined" && __nmOpen){ var p=document.getElementById("nmPanel"); if(p) return p; }
  var d=document.getElementById("drawer"); if(d) return d;
  return document;
}
function edEl(id){ try{ var r=edRoot(); return r ? r.querySelector("#"+id) : null; }catch(e){ return document.getElementById(id); } }
function edVal(id){ var el=edEl(id); return el ? String(el.value||"") : ""; }
// PR-A0: the page a card points at is data.page_slug when set (a promoted card shares the template page), else
// the card's own slug. __edBase[slug] holds the opp's data (captured at render), so this needs no new argument.
function edPageSlug(slug){ var d = __edBase[slug] || {}; return (d && d.page_slug) || slug; }
// The link is present when the body carries the merge token OR an already-tokenized/literal opp URL. The literal
// check uses the SHARED page URL (edPageSlug) so a pasted template link is recognized on a promoted card too.
function edHasLink(slug, body){
  var b = String(body||"");
  if(b.indexOf(MF_LINK) >= 0) return true;
  try{ if(b.indexOf(liveUrl(edPageSlug(slug))) >= 0) return true; }catch(e){}
  return false;
}

// Build the data jsonb the preview/send compiles from: the captured base overlaid with the LIVE subject,
// body, and the operator's signature FIELD value (empty allowed). edCompileFrom then runs the SAME sendCompile
// the send path uses, so the preview html equals the send payload html for identical inputs.
function edLiveData(slug){
  var base = __edBase[slug] || {};
  return Object.assign({}, base, { outreach_subject:edVal("edSubj"), outreach_text:edVal("edBody"), sig:edSignature() });
}
function edCompileFrom(slug, data){
  var row = findRow(slug) || { slug:slug, business:(data&&data.business)||"" };
  var rcpt = firstRecipient(data) || { addr:"", name:"", lang:"" };
  return sendCompile(slug, row, data, rcpt);          // the send path's own compiler (EDITOR_EVIDENCE 1)
}

// The editor surface. Placed just before the recipient field and the Send action in the drawer, so compose
// -> recipient -> send read top to bottom. Pre-fills from the record; empty for a fresh compose.
function editorHtml(slug, row, detail){
  if(!editorEligible(row)) return "";
  var data = (detail && detail.opp && detail.opp.data) || null;
  __edBase[slug] = data || __edBase[slug] || {};       // capture base for the preview compile (enrich paint sets it)
  var subj = data ? String(data.outreach_subject||"") : (edVal("edSubj"));
  var body = data ? String(data.outreach_text||"") : (edVal("edBody"));
  var hasRecip = data ? !!firstRecipient(data) : false;
  var st = __edStat[slug] || {};
  var ck = function(id, ok, key){
    return '<li class="ed-ck '+(ok?"ck-ok":"ck-no")+'" id="'+id+'">'+esc(t(key))+'</li>';
  };
  // The signature FIELD pre-fills from the persisted record's data.sig (empty if none); on re-render inside an
  // open drawer it keeps the live typed value so a paint never clobbers an in-progress signature.
  var sig = data ? String(data.sig||"") : (edVal("edSig"));
  var subjOk = !!subj.trim(), bodyOk = !!body.trim(), linkOk = edHasLink(slug, body);
  return '<div class="dw-sec ed-sec"><h3>'+esc(t("ed_h"))+'</h3>'+
    '<input class="ed-subj" id="edSubj" type="text" autocomplete="off" spellcheck="true" '+
      'placeholder="'+esc(t("ed_subj_ph"))+'" aria-label="'+esc(t("ed_subj"))+'" value="'+esc(subj)+'">'+
    '<textarea class="rec-in ed-body" id="edBody" rows="6" autocomplete="off" spellcheck="true" '+
      'placeholder="'+esc(t("ed_body_ph"))+'" aria-label="'+esc(t("ed_body"))+'">'+esc(body)+'</textarea>'+
    '<div class="acts"><button class="act" id="edLink" type="button">'+esc(t("ed_link"))+'</button></div>'+
    '<ul class="ed-checks">'+
      ck("ckSubj", subjOk, "ed_ck_subj")+ck("ckBody", bodyOk, "ed_ck_body")+
      ck("ckRecip", hasRecip, "ed_ck_recip")+ck("ckLink", linkOk, "ed_ck_link")+
    '</ul>'+
    '<div class="ed-sig-field">'+
      '<div class="ed-sig-head"><span class="ed-sig-lab">'+esc(t("ed_sig"))+'</span>'+
        '<button class="act ed-sig-use" id="edSigFill" type="button">'+esc(t("ed_sig_use"))+'</button></div>'+
      '<textarea class="rec-in ed-sig-in" id="edSig" rows="3" autocomplete="off" spellcheck="true" '+
        'placeholder="'+esc(t("ed_sig_ph"))+'" aria-label="'+esc(t("ed_sig"))+'">'+esc(sig)+'</textarea>'+
    '</div>'+
    '<div class="ed-prev-h">'+esc(t("ed_preview"))+'</div>'+
    '<iframe class="ed-preview" id="edPreview" title="'+esc(t("ed_preview"))+'" sandbox="" referrerpolicy="no-referrer" srcdoc=""></iframe>'+
    '<div class="act-status'+(st.cls?(" "+st.cls):"")+'" id="edStatus">'+esc(st.msg||"")+'</div></div>';
}

function edSetStatus(slug, msg, cls){
  __edStat[slug] = { msg:msg||"", cls:cls||"" };
  var el=edEl("edStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; }
}
// Re-mark the four check items from the LIVE values (no value reset, so undo is untouched). Recipient is not
// re-derived on keystroke (it changes only via the recipient field, which reloads the drawer).
function edRefreshChecks(slug){
  var set=function(id, ok){ var el=edEl(id); if(el) el.className="ed-ck "+(ok?"ck-ok":"ck-no"); };
  set("ckSubj", !!edVal("edSubj").trim());
  set("ckBody", !!edVal("edBody").trim());
  set("ckLink", edHasLink(slug, edVal("edBody")));
}
// Grey the Send button while the MESSAGE is incomplete (subject/body/link). Recipient stays enforced by
// runSend, so the no-recipient refusal remains a live, clickable path.
// UNIFY: the editor delegates its Send-disable gate to the one shared gate (sendApplyGate -> sendReady =
// subject AND body AND a valid recipient), so the drawer's board Send and the overlay's Send obey the same
// rule. The link stays optional; the gate is never keyed on the stored has_email flag.
function edApplyGate(slug){ if(typeof sendApplyGate==="function") sendApplyGate(slug); }
// Recompile the preview from the LIVE values, through the send path's own sendCompile, and show it. The
// srcdoc html is byte-identical to what runSend would POST for the same record (proven by edCompileFrom
// reusing sendCompile). Best-effort: a compile hiccup never throws into the editor.
function edRenderPreview(slug){
  try{
    var art = edCompileFrom(slug, edLiveData(slug));
    var f=edEl("edPreview"); if(f) f.setAttribute("srcdoc", art.html);
  }catch(e){}
}
function edTick(slug){ edRefreshChecks(slug); edApplyGate(slug); edRenderPreview(slug); }

// Insert the opp link. With a selection, EMBED the link on the chosen phrase as a markdown link
// [selected]({{LINK}}) (ConTh 11: an anchor, not a naked URL - bodyParasHtml renders it as <a>). With no
// selection, insert the bare {{LINK}} token as before (the naked token stays supported and optional). Either
// way {{LINK}} is present, so edHasLink still clears the ckLink gate. execCommand keeps the native undo stack
// (ConTh 4); a splice fallback covers browsers without it.
function edInsertLink(slug){
  var el=edEl("edBody"); if(!el) return;
  el.focus();
  var s=el.selectionStart==null?el.value.length:el.selectionStart, e2=el.selectionEnd==null?el.value.length:el.selectionEnd;
  var sel=el.value.slice(s,e2);
  var token = sel ? ("[" + sel + "](" + MF_LINK + ")") : MF_LINK;
  var ok=false;
  try{ ok=document.execCommand("insertText", false, token); }catch(e){ ok=false; }
  if(!ok){
    el.value = el.value.slice(0,s) + token + el.value.slice(e2);
    var pos=s+token.length; try{ el.selectionStart=el.selectionEnd=pos; }catch(_){}
    try{ el.dispatchEvent(new Event("input", { bubbles:true })); }catch(_){}
  }
  edTick(slug); edScheduleSave(slug, 300);
}

// "Use my signature": a convenience FILL of the Signature field with the identity preset (name / title / site,
// each on its own line). It is never automatic - the operator taps it, then may edit or clear the field. After
// filling, refresh the preview and debounce a save so the chosen signature persists like any typed one.
function edFillSignature(slug){
  var el=edEl("edSig"); if(!el) return;
  el.value = edSignaturePreset();
  try{ el.dispatchEvent(new Event("input", { bubbles:true })); }catch(_){}
  try{ el.focus(); }catch(_){}
  edTick(slug); edScheduleSave(slug, 300);
}

function edScheduleSave(slug, delay){
  // E1 seam: when the standalone New Message overlay owns this slug, its own single writer persists the
  // message + recipient together (one read-modify-write, no data-jsonb race with the drawer writer). Every
  // editor input / link-insert / signature-fill routes here, so this is the one place that redirects the save.
  if(typeof nmActive==="function" && nmActive(slug)){ if(typeof nmScheduleSave==="function") nmScheduleSave(slug, delay); return; }
  if(__edT[slug]) clearTimeout(__edT[slug]);
  __edT[slug] = setTimeout(function(){ __edT[slug]=null; edSaveNow(slug); }, delay||700);
}
// Bounded, optimistic confirm-or-revert save. The textarea IS the optimistic state; on a CONFIRMED write we
// show green (never a phantom "Saved" without persistence); on failure we show red and leave the operator's
// text intact (reverting it would lose typing). Never fights the shared send/note lock: if one is in flight,
// reschedule shortly so the text is never dropped. On the FIRST message that makes an opp sendable, reload
// the board once so the L5 gate flips and Send appears; ongoing edits do not reload (undo preserved).
function edSaveNow(slug){
  if(__drawerSlug!==slug) return;
  var subjEl=edEl("edSubj"), bodyEl=edEl("edBody");
  if(!subjEl || !bodyEl) return;
  if(__writing || __edSaving){ edScheduleSave(slug, 500); return; }
  __edSaving = true;
  var subj=String(subjEl.value||""), body=String(bodyEl.value||""), sig=edSignature();
  edSetStatus(slug, t("a_saving"), "");
  oppReadData(slug).then(function(data){
    var wasEmpty = !(String(data.outreach_subject||"").trim() || String(data.outreach_text||"").trim());
    var nowHas = !!(subj.trim() || body.trim());
    var next = Object.assign({}, data, { outreach_subject:subj, outreach_text:body, sig:sig });
    return oppPatch(slug, { data:next, up:Date.now() }).then(function(){
      __edSaving = false;
      __edBase[slug] = next;                                   // keep the preview base in sync with the persisted record
      var row = findRow(slug);
      var reveal = wasEmpty && nowHas && row && !row.has_email; // first message: flip the L5 gate so Send appears
      if(reveal){
        return reloadBoardData().then(function(){ edSetStatus(slug, t("a_saved"), "ok"); if(__drawerSlug===slug) refreshDrawer(slug); },
                                     function(){ edSetStatus(slug, t("a_saved"), "ok"); });
      }
      edSetStatus(slug, t("a_saved"), "ok"); edRenderPreview(slug);
    });
  }).catch(function(e){
    __edSaving = false;
    edSetStatus(slug, (e && e.authRequired) ? t("err") : t("a_failed"), "bad");   // red, no phantom save; text kept
  });
}

// Wire the editor after each drawer paint (called from wireDrawer). Input listeners update the checklist,
// the Send gate, and the live preview, then debounce a save. No value is ever reset here, so undo is intact.
function wireEditor(slug){
  var subjEl=edEl("edSubj"), bodyEl=edEl("edBody");
  if(!subjEl && !bodyEl) return;
  // edTick runs edApplyGate -> sendApplyGate, which toggles BOTH the overlay's #nmSend and the drawer's board
  // Send. So completing subject/body (or recipient) LAST re-enables Send in either surface. No link term.
  var onInput=function(){ edTick(slug); edScheduleSave(slug, 700); };
  if(subjEl) subjEl.addEventListener("input", onInput);
  if(bodyEl) bodyEl.addEventListener("input", onInput);
  var sigEl=edEl("edSig"); if(sigEl) sigEl.addEventListener("input", onInput);   // E0: signature is field-driven
  var lk=edEl("edLink"); if(lk) lk.addEventListener("click", function(){ edInsertLink(slug); });
  var sf=edEl("edSigFill"); if(sf) sf.addEventListener("click", function(){ edFillSignature(slug); });
  edTick(slug);                                                // initial checklist + gate + preview
}

// Read-only hooks for later steps and board_editor_test:
//   __thriveComposeArtifact(slug): the artifact compiled from the PERSISTED record, byte-identical to what
//     runSend compiles before it POSTs (oppReadData -> firstRecipient -> sendCompile), so preview == send.
//   __thriveReplyTo(slug): the Reply-To the send stamps, proving a reply carries the opp slug (never a campaign).
try{
  window.__thriveComposeArtifact = function(slug){ return oppReadData(slug).then(function(data){ return edCompileFrom(slug, data); }); };
  window.__thriveReplyTo = function(slug){ try{ return outboundHeaders(slug)["Reply-To"]; }catch(e){ return ""; } };
  //   __thriveSendHeaders(slug): the exact header set the send stamps for a slug's own mode (personal 1:1 vs
  //     campaign), proving a personal send carries NO List-Unsubscribe. Derives mode from the persisted record.
  window.__thriveSendHeaders = function(slug){ return oppReadData(slug).then(function(data){ return outboundHeaders(slug, sendMode(data)); }); };
  window.__thriveEditorSignature = function(){ return edSignature(); };     // the LIVE field value (empty allowed)
  window.__thriveSignaturePreset = function(){ return edSignaturePreset(); }; // the "Use my signature" fill (name/title/site)
}catch(e){}
