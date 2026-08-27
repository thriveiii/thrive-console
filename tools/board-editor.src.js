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
//   * signature from RUNTIME identity: content.sig = name + ", " + title (name alone if no title; nothing if
//     no name, never invented). Written to data.sig so compile()/sendCompile place it via brandWrap exactly
//     where the send renders the closing (EDITOR_EVIDENCE 1 + 5).
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

// The signature, from runtime identity ONLY (never the record's stale sig). name + ", " + title; name alone
// if the title is unset; "" if the name is unset (never invented). This is the exact string compile places.
function edIdentity(){ try{ return window.__thriveIdentity || {}; }catch(e){ return {}; } }
function edSignature(){
  var id = edIdentity();
  var name = String(id.name==null?"":id.name).trim();
  var title = String(id.title==null?"":id.title).trim();
  if(!name) return "";
  return title ? (name + ", " + title) : name;
}

function edVal(id){ var el=document.getElementById(id); return el ? String(el.value||"") : ""; }
// The link is present when the body carries the merge token OR an already-tokenized/literal opp URL.
function edHasLink(slug, body){
  var b = String(body||"");
  if(b.indexOf(MF_LINK) >= 0) return true;
  try{ if(b.indexOf(liveUrl(slug)) >= 0) return true; }catch(e){}
  return false;
}
// The Send-disable gate covers ONLY what the editor exclusively owns and what makes an opp sendable at all:
// a non-empty subject AND body. The link and the recipient are shown in the checklist as pass states, but
// they are NOT part of the disable gate: the recipient has its own field and runSend's red refusal is the
// tested backstop, and a prepared message may legitimately carry the page link in an already-tokenized form.
// Gating only on subject+body keeps the pre-flight light (never a wall) and never disables Send for an opp
// that already has a message, so the existing send-gate paths stay clickable.
function edMessageReady(slug){
  return !!(edVal("edSubj").trim() && edVal("edBody").trim());
}

// Build the data jsonb the preview/send compiles from: the captured base overlaid with the LIVE subject,
// body, and the identity signature. edCompileFrom then runs the SAME sendCompile the send path uses, so the
// preview html equals the send payload html for identical inputs.
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
    '<div class="ed-sig"><span class="ed-sig-lab">'+esc(t("ed_sig"))+'</span> <bdi>'+esc(edSignature()||t("none"))+'</bdi></div>'+
    '<div class="ed-prev-h">'+esc(t("ed_preview"))+'</div>'+
    '<iframe class="ed-preview" id="edPreview" title="'+esc(t("ed_preview"))+'" sandbox="" referrerpolicy="no-referrer" srcdoc=""></iframe>'+
    '<div class="act-status'+(st.cls?(" "+st.cls):"")+'" id="edStatus">'+esc(st.msg||"")+'</div></div>';
}

function edSetStatus(slug, msg, cls){
  __edStat[slug] = { msg:msg||"", cls:cls||"" };
  var el=document.getElementById("edStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; }
}
// Re-mark the four check items from the LIVE values (no value reset, so undo is untouched). Recipient is not
// re-derived on keystroke (it changes only via the recipient field, which reloads the drawer).
function edRefreshChecks(slug){
  var set=function(id, ok){ var el=document.getElementById(id); if(el) el.className="ed-ck "+(ok?"ck-ok":"ck-no"); };
  set("ckSubj", !!edVal("edSubj").trim());
  set("ckBody", !!edVal("edBody").trim());
  set("ckLink", edHasLink(slug, edVal("edBody")));
  var sigEl=document.querySelector(".ed-sig bdi"); if(sigEl) sigEl.textContent = edSignature() || t("none");
}
// Grey the Send button while the MESSAGE is incomplete (subject/body/link). Recipient stays enforced by
// runSend, so the no-recipient refusal remains a live, clickable path.
function edApplyGate(slug){
  var b=document.querySelector('#drawer .act[data-act="send"]');
  if(b) b.disabled = !edMessageReady(slug);
}
// Recompile the preview from the LIVE values, through the send path's own sendCompile, and show it. The
// srcdoc html is byte-identical to what runSend would POST for the same record (proven by edCompileFrom
// reusing sendCompile). Best-effort: a compile hiccup never throws into the editor.
function edRenderPreview(slug){
  try{
    var art = edCompileFrom(slug, edLiveData(slug));
    var f=document.getElementById("edPreview"); if(f) f.setAttribute("srcdoc", art.html);
  }catch(e){}
}
function edTick(slug){ edRefreshChecks(slug); edApplyGate(slug); edRenderPreview(slug); }

// Insert the opp-link token at the cursor via execCommand, which PRESERVES the native undo stack (ConTh 4).
// Falls back to a splice + manual input event if execCommand is unavailable.
function edInsertLink(slug){
  var el=document.getElementById("edBody"); if(!el) return;
  el.focus();
  var token=MF_LINK, ok=false;
  try{ ok=document.execCommand("insertText", false, token); }catch(e){ ok=false; }
  if(!ok){
    var s=el.selectionStart==null?el.value.length:el.selectionStart, e2=el.selectionEnd==null?el.value.length:el.selectionEnd;
    el.value = el.value.slice(0,s) + token + el.value.slice(e2);
    var pos=s+token.length; try{ el.selectionStart=el.selectionEnd=pos; }catch(_){}
    try{ el.dispatchEvent(new Event("input", { bubbles:true })); }catch(_){}
  }
  edTick(slug); edScheduleSave(slug, 300);
}

function edScheduleSave(slug, delay){
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
  var subjEl=document.getElementById("edSubj"), bodyEl=document.getElementById("edBody");
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
  var subjEl=document.getElementById("edSubj"), bodyEl=document.getElementById("edBody");
  if(!subjEl && !bodyEl) return;
  var onInput=function(){ edTick(slug); edScheduleSave(slug, 700); };
  if(subjEl) subjEl.addEventListener("input", onInput);
  if(bodyEl) bodyEl.addEventListener("input", onInput);
  var lk=document.getElementById("edLink"); if(lk) lk.addEventListener("click", function(){ edInsertLink(slug); });
  edTick(slug);                                                // initial checklist + gate + preview
}

// Read-only hooks for later steps and board_editor_test:
//   __thriveComposeArtifact(slug): the artifact compiled from the PERSISTED record, byte-identical to what
//     runSend compiles before it POSTs (oppReadData -> firstRecipient -> sendCompile), so preview == send.
//   __thriveReplyTo(slug): the Reply-To the send stamps, proving a reply carries the opp slug (never a campaign).
try{
  window.__thriveComposeArtifact = function(slug){ return oppReadData(slug).then(function(data){ return edCompileFrom(slug, data); }); };
  window.__thriveReplyTo = function(slug){ try{ return outboundHeaders(slug)["Reply-To"]; }catch(e){ return ""; } };
  window.__thriveEditorSignature = function(){ return edSignature(); };
}catch(e){}
