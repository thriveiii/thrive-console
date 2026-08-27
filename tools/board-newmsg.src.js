// ===================================================================================================
// E1 NEW MESSAGE - the editor as a STANDALONE process. A header "New message" button opens the unified
// editor in its OWN overlay (#nmScrim/#nmPanel, mirroring the profile/admin scrims), to compose and send a
// message to any recipient, with or without an opp link, with no opp required up front and no draft lost on
// accidental close. Inlined verbatim into library/board.html by tools/bundle.js AFTER the editor clone, so it
// reuses that IIFE scope: editorHtml, wireEditor, edVal, edSignature, edTick, edRenderPreview, __edBase (the
// editor); recipientPrefill, parseAddrs (the recipient field); isEmail, runSend (the send); oppReadData,
// reloadBoardData, authFetchOnce, URL_BASE, ANON, bearer, session, refresh, __writing, t, esc, root.
//
// GROUNDED IN E1_EVIDENCE.md:
//   * The send is bound to an OPP, not to a link (runSend needs findRow(slug) + a recipient + a message;
//     it never checks for a link). So New Message mints a LIGHTWEIGHT opp on first save and hands that slug
//     to the unchanged runSend. A message with no link sends (E1_EVIDENCE 3 + 5).
//   * The draft is DURABLE from the first character: the first save upserts a console_opps row (the row the
//     board and runSend read), so an accidental close never loses it (the ConTh 3 lesson). Reopening resumes
//     it from the server via a small guarded localStorage pointer.
//   * One WRITER for the standalone draft (nmSaveNow) persists subject + body + signature + recipients in a
//     single read-modify-write, so there is no data-jsonb race with the drawer's editor writer. The editor's
//     edScheduleSave routes here whenever nmActive(slug) is true (the one seam in board-editor.src.js).
// ===================================================================================================

var __nmSlug = null;       // the current standalone draft's opp slug (null when the overlay has never opened)
var __nmOpen = false;      // is the New Message overlay currently open
var __nmT = {};            // per-slug debounce timer id (the standalone writer)
var __nmSaving = false;    // the standalone writer's in-flight guard (separate from the shared __writing lock)
var NM_KEY = "thrive_nm_draft";   // guarded localStorage pointer to the unsent standalone draft slug

// The editor's save seam calls this: the standalone overlay owns the slug while it is open.
function nmActive(slug){ return !!(__nmOpen && __nmSlug && __nmSlug===slug); }

// A fresh, unique opp slug for a standalone message. Date.now()/Math.random() are available in the board
// runtime; guarded so a hostile environment still yields a usable slug.
function nmNewSlug(){
  var tp=""; try{ tp=Date.now().toString(36); }catch(e){ tp="0"; }
  var rr=""; try{ rr=Math.random().toString(36).slice(2,8); }catch(e){ rr="x"; }
  return "msg-" + tp + "-" + rr;
}
// The guarded draft pointer. All three wrapped in try/catch: a partitioned/blocked storage never throws out.
function nmStoredSlug(){ try{ var v=localStorage.getItem(NM_KEY); return v?String(v):""; }catch(e){ return ""; } }
function nmStore(slug){ try{ localStorage.setItem(NM_KEY, String(slug||"")); }catch(e){} }
function nmClearStore(){ try{ localStorage.removeItem(NM_KEY); }catch(e){} }

// The bounded create-or-update. POST console_opps with resolution=merge-duplicates, so the FIRST save inserts
// the lightweight opp row and every later save updates it - idempotent by slug. Same settle-always discipline
// as oppPatch (authFetchOnce timeout REJECTS, one refresh-retry). console_opps RLS is "for all" to the role,
// so the insert is allowed; the row the board view and runSend read is a real console_opps row.
function oppUpsert(slug, fields, retried){
  var url = URL_BASE + "/rest/v1/console_opps";
  var row = Object.assign({ slug:slug }, fields||{});
  return authFetchOnce(url, {
    method:"POST",
    headers:{ "apikey":ANON, "Authorization":"Bearer "+bearer(), "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates,return=minimal" },
    cache:"no-store", body: JSON.stringify([row])
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return oppUpsert(slug, fields, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error((r.data && r.data.message) || ("HTTP "+r.res.status)); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    return true;
  });
}

// ---- the recipient input (its own, not the drawer's sendEligible-gated field) ------------------------
function nmRecipRaw(){ var el=document.getElementById("nmRecip"); return el ? String(el.value||"") : ""; }
function nmRecipList(){ return parseAddrs(nmRecipRaw()).filter(isEmail).map(function(a){ return { addr:a, name:"", lang:"" }; }); }
function nmHasRecip(){ return nmRecipList().length > 0; }
// A short board-card label for the standalone opp: the subject, or the localized "New message" when empty.
function nmBusiness(subj){ var s=String(subj==null?"":subj).trim(); return s ? s.slice(0,140) : t("nm_h"); }

// ---- the overlay surface -----------------------------------------------------------------------------
// Reuses editorHtml for subject/body/signature/link/preview/checklist (a synthetic draft row makes it
// eligible), then adds a recipient input, a Send button, and a status line. Everything the editor renders is
// the SAME markup the drawer uses, so the light-HTML preview and the signature field behave identically.
function nmPanelHtml(slug, data){
  data = data || {};
  var row = { slug:slug, business:nmBusiness(data.outreach_subject), stage:"draft", archived:false };
  var recip = recipientPrefill(data);
  return '<div class="nm-head"><h2>'+esc(t("nm_h"))+'</h2>'+
      '<button class="link nm-x" id="nmClose" type="button">'+esc(t("pf_close"))+'</button></div>'+
    '<div class="nm-body">'+
      editorHtml(slug, row, { opp:{ data:data } })+
      '<div class="dw-sec"><h3>'+esc(t("nm_to"))+'</h3>'+
        '<textarea class="rec-in mono-iso" id="nmRecip" rows="1" dir="ltr" autocomplete="off" spellcheck="false" '+
          'placeholder="'+esc(t("nm_to_ph"))+'" aria-label="'+esc(t("nm_to"))+'">'+esc(recip)+'</textarea></div>'+
      '<div class="acts"><button class="act send" id="nmSend" type="button">'+esc(t("nm_send"))+'</button></div>'+
      '<div class="act-status" id="nmStatus"></div>'+
    '</div>';
}

function nmSetStatus(msg, cls){ var el=document.getElementById("nmStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }
// The Send button is greyed until subject + body + a valid recipient are present (a linkless message is
// allowed; runSend is still the tested backstop for the recipient).
function nmReady(slug){ return !!(edVal("edSubj").trim() && edVal("edBody").trim() && nmHasRecip()); }
function nmApplyGate(slug){ var b=document.getElementById("nmSend"); if(b) b.disabled = !nmReady(slug); }
// Refresh the editor's preview + checklist, then the New Message Send gate. Called on every field input.
function nmTick(slug){ try{ edTick(slug); }catch(e){} nmApplyGate(slug); }

function nmScheduleSave(slug, delay){
  if(__nmT[slug]) clearTimeout(__nmT[slug]);
  __nmT[slug] = setTimeout(function(){ __nmT[slug]=null; nmSaveNow(slug); }, delay||700);
}
// The ONE standalone writer: subject + body + signature + recipients in a single read-modify-write, upserted
// to the lightweight opp. Optimistic confirm-or-revert - green on a CONFIRMED write, red on failure with the
// operator's text left intact (never a phantom "Saved"). Records the guarded draft pointer on first success,
// so an accidental close resumes. Never fights the shared send lock: reschedules if one is in flight.
function nmSaveNow(slug){
  if(!nmActive(slug)) return;
  var subjEl=document.getElementById("edSubj"), bodyEl=document.getElementById("edBody");
  if(!subjEl || !bodyEl) return;
  if(__writing || __nmSaving){ nmScheduleSave(slug, 500); return; }
  __nmSaving = true;
  var subj=String(subjEl.value||""), body=String(bodyEl.value||""), sig=edSignature(), recips=nmRecipList();
  nmSetStatus(t("a_saving"), "");
  oppReadData(slug).then(function(data){
    var next = Object.assign({}, data, { outreach_subject:subj, outreach_text:body, sig:sig, recipients:recips });
    return oppUpsert(slug, { business:nmBusiness(subj), data:next, up:Date.now() }).then(function(){
      __nmSaving = false;
      __edBase[slug] = next;                 // keep the editor's preview base in sync with the persisted record
      nmStore(slug);                         // the draft is now server-durable; remember it for resume
      nmSetStatus(t("a_saved"), "ok");
      try{ edRenderPreview(slug); }catch(e){}
    });
  }).catch(function(e){
    __nmSaving = false;
    nmSetStatus((e && e.authRequired) ? t("err") : t("a_failed"), "bad");   // red, no phantom save, text kept
  });
}

// Wire the overlay after each paint. The editor fields are wired by wireEditor (its saves route to nmSaveNow
// via the edScheduleSave seam); the recipient input, close, and Send are wired here.
function nmWire(slug){
  try{ wireEditor(slug); }catch(e){}
  var rc=document.getElementById("nmRecip"); if(rc) rc.addEventListener("input", function(){ nmTick(slug); nmScheduleSave(slug, 700); });
  var cl=document.getElementById("nmClose"); if(cl) cl.addEventListener("click", function(){ closeNewMessage(); });
  var sd=document.getElementById("nmSend"); if(sd) sd.addEventListener("click", function(){ nmSend(slug); });
  nmTick(slug);
}

// Open the standalone editor overlay. Resumes the saved draft (from the guarded pointer, re-read from the
// server) or mints a fresh slug. The fresh slug is not created until the first save (an open-then-close with
// nothing typed leaves no opp behind); the pointer is stored only once a save confirms.
function openNewMessage(){
  if(__nmOpen) return;
  var sc=document.getElementById("nmScrim"), pn=document.getElementById("nmPanel");
  if(!sc || !pn) return;
  var stored = nmStoredSlug();
  var slug = stored || nmNewSlug();
  __nmSlug = slug; __nmOpen = true;
  __edBase[slug] = __edBase[slug] || {};
  pn.innerHTML = nmPanelHtml(slug, {}); sc.hidden=false; pn.scrollTop=0; nmWire(slug);   // instant empty surface
  if(stored){
    oppReadData(slug).then(function(data){                                                // resume: prefill from server
      if(!__nmOpen || __nmSlug!==slug) return;
      __edBase[slug] = data || {};
      pn.innerHTML = nmPanelHtml(slug, data||{}); pn.scrollTop=0; nmWire(slug);
    }, function(){ /* read failed: keep the empty surface, first save still upserts */ });
  }
}
// Close the overlay. The draft stays in console_opps and the guarded pointer stays set, so the next open
// resumes it - nothing is lost on an accidental close.
function closeNewMessage(){ __nmOpen=false; var sc=document.getElementById("nmScrim"); if(sc) sc.hidden=true; }

// Send the standalone message through the UNCHANGED L5 path. Flush the live fields to the opp (upsert), reload
// the board so runSend's findRow(slug) resolves, clear the draft pointer, close the overlay, then hand off to
// runSend - which optimistically shows the card sending, POSTs the light-HTML message, and writes console_mail
// only on Resend acceptance (a failure reverts the card with no phantom, and the draft remains a board opp).
function nmSend(slug){
  if(__writing || __nmSaving){ nmSetStatus(t("a_saving"), ""); nmScheduleSave(slug, 300); return; }
  var subj=edVal("edSubj"), body=edVal("edBody"), sig=edSignature(), recips=nmRecipList();
  if(!(subj.trim() && body.trim())){ nmSetStatus(t("nm_need_msg"), "bad"); return; }
  if(!recips.length){ nmSetStatus(t("nm_need_to"), "bad"); return; }
  nmSetStatus(t("s_sending"), "");
  var sd=document.getElementById("nmSend"); if(sd) sd.disabled=true;
  oppReadData(slug).then(function(data){
    var next = Object.assign({}, data, { outreach_subject:subj, outreach_text:body, sig:sig, recipients:recips });
    return oppUpsert(slug, { business:nmBusiness(subj), data:next, up:Date.now() });
  }).then(function(){
    return reloadBoardData();                          // so the lightweight opp is a board row runSend can find
  }).then(function(){
    nmClearStore(); closeNewMessage();                 // the draft graduates to the board; the card shows the send
    try{ runSend(slug); }catch(e){}                    // UNCHANGED L5 single-recipient send
  }).catch(function(e){
    var b2=document.getElementById("nmSend"); if(b2) b2.disabled=false;
    nmSetStatus((e && e.authRequired) ? t("err") : t("a_failed"), "bad");
  });
}

// Read-only hooks for board_newmsg_test:
try{
  window.__thriveNewMessageSlug = function(){ return __nmSlug; };
  window.__thriveNewMessageOpen = function(){ return __nmOpen; };
}catch(e){}
