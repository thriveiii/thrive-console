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

// ---- the recipient input ---------------------------------------------------------------------------
// UNIFY: the overlay no longer has its own recipient field. It mounts the SAME #recIn (recipientHtml) the
// drawer uses, read through the one shared parser sendToList() (board-recipient.src.js). One field, one parser.
// A short board-card label for the standalone opp: the subject, or the localized "New message" when empty.
function nmBusiness(subj){ var s=String(subj==null?"":subj).trim(); return s ? s.slice(0,140) : t("nm_h"); }

// ---- the overlay surface -----------------------------------------------------------------------------
// Reuses editorHtml for subject/body/signature/link/preview/checklist (a synthetic draft row makes it
// eligible), then adds a recipient input, a Send button, and a status line. Everything the editor renders is
// the SAME markup the drawer uses, so the light-HTML preview and the signature field behave identically.
function nmPanelHtml(slug, data){
  data = data || {};
  var row = { slug:slug, business:nmBusiness(data.outreach_subject), stage:"draft", archived:false };
  return '<div class="nm-head"><h2>'+esc(t("nm_h"))+'</h2>'+
      '<button class="link nm-x" id="nmClose" type="button">'+esc(t("pf_close"))+'</button></div>'+
    '<div class="nm-body">'+
      editorHtml(slug, row, { opp:{ data:data } })+
      recipientHtml(slug, row, { opp:{ data:data } })+                      // UNIFY: the SAME #recIn field the drawer mounts
      '<div class="acts"><button class="act send" id="nmSend" type="button">'+esc(t("nm_send"))+'</button></div>'+
      '<div class="act-status" id="nmStatus" role="status" aria-live="polite"></div>'+
    '</div>';
}

function nmSetStatus(msg, cls){ var el=document.getElementById("nmStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }
// UNIFY: ONE Send gate for BOTH surfaces. Send is enabled only when subject + body + a valid recipient are
// present (a linkless message is allowed; the opp link stays optional). Never gated on the stored has_email
// flag. sendApplyGate toggles whichever Send control is mounted: the overlay's #nmSend and/or the drawer's
// board Send action (#drawer .act[data-act="send"]).
function sendReady(slug){ return !!(edVal("edSubj").trim() && edVal("edBody").trim() && sendHasRecip()); }
function sendApplyGate(slug){
  var ok = sendReady(slug);
  var nb = document.getElementById("nmSend"); if(nb) nb.disabled = !ok;
  var db = document.querySelector('#drawer .act[data-act="send"]'); if(db) db.disabled = !ok;
}
// Refresh the editor's preview + checklist, then the unified Send gate. Called on every field input.
function nmTick(slug){ try{ edTick(slug); }catch(e){} sendApplyGate(slug); }

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
  var subjEl=edEl("edSubj"), bodyEl=edEl("edBody");                     // scoped to the active surface (COMPOSE_SURFACE_EVIDENCE A1)
  if(!subjEl || !bodyEl) return;
  if(__writing || __nmSaving){ nmScheduleSave(slug, 500); return; }
  __nmSaving = true;
  var subj=String(subjEl.value||""), body=String(bodyEl.value||""), sig=edSignature(), recips=sendToList();
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
  var rc=document.getElementById("recIn"); if(rc) rc.addEventListener("input", function(){ nmTick(slug); nmScheduleSave(slug, 700); });
  var cl=document.getElementById("nmClose"); if(cl) cl.addEventListener("click", function(){ closeNewMessage(); });
  var sd=document.getElementById("nmSend"); if(sd) sd.addEventListener("click", function(){ unifiedSend(slug); });
  nmTick(slug);
}

// Open the standalone editor overlay. IDENTITY (NEWMSG_AUDIT): the "New message" action ALWAYS starts a
// FRESH compose - it mints a brand-new msg-<ts>-<rand> slug and never resumes the stored draft pointer.
// This is the fix for the resume-loop: a blocked or unsent draft used to leave thrive_nm_draft set, so the
// next New message reopened the SAME opp pre-filled with the prior subject/body, collapsing separate
// messages onto one card (sent_count is per slug). A durable draft is not lost - it persists as its own
// console_opps row / board card and is reopened by tapping THAT card (openDrawer), not by this button.
function openNewMessage(){
  if(__nmOpen) return;
  var sc=document.getElementById("nmScrim"), pn=document.getElementById("nmPanel");
  if(!sc || !pn) return;
  // ONE compose surface at a time (COMPOSE_SURFACE_EVIDENCE A1): close any open card drawer and clear its
  // DOM before mounting the overlay, so the drawer's #edSubj/#edBody/#edPreview cannot linger as a duplicate
  // set of ids ahead of the overlay's in the document. closeDrawer clears __drawerSlug and hides the scrim;
  // openDrawer rebuilds #drawer innerHTML on its next open, so emptying it here is safe.
  try{ if(typeof closeDrawer==="function") closeDrawer(); }catch(e){}
  var dz=document.getElementById("drawer"); if(dz) dz.innerHTML="";
  var slug = nmNewSlug();               // ALWAYS fresh: never resume nmStoredSlug() onto the generic button
  nmClearStore();                       // drop any stale pointer so it cannot hijack this or a later compose
  __nmSlug = slug; __nmOpen = true;
  __edBase[slug] = {};
  pn.innerHTML = nmPanelHtml(slug, {}); sc.hidden=false; pn.scrollTop=0; nmWire(slug);   // an empty compose, every time
}
// Close the overlay. FLUSH FIRST for a NON-empty compose: if a debounced save is pending, cancel the timer
// and write NOW (from the live fields), so a recipient or message typed within the debounce window is never
// lost - the draft stays as its own console_opps row / board card and is reopened by tapping that card.
// IDENTITY (NEWMSG_AUDIT): an EMPTY, never-typed compose leaves nothing behind - skip the flush (no junk
// "New message" opp) and clear the draft pointer, so a blocked send cannot leave a sticky pointer.
function closeNewMessage(){
  var slug = __nmSlug;
  var empty = !((edVal("edSubj")||"").trim() || (edVal("edBody")||"").trim());
  if(slug && __nmT[slug]){ clearTimeout(__nmT[slug]); __nmT[slug]=null; if(!empty){ try{ nmSaveNow(slug); }catch(e){} } }
  if(empty) nmClearStore();
  __nmOpen=false; var sc=document.getElementById("nmScrim"); if(sc) sc.hidden=true;
}

// Where a send-time status goes: the overlay's #nmStatus when it owns the slug, else the drawer card status.
function sendFail(slug, msg){
  if(typeof nmActive==="function" && nmActive(slug)){ nmSetStatus(msg, "bad"); }
  else { __act[slug] = { msg:msg, cls:"bad" }; if(__drawerSlug===slug) refreshDrawer(slug); }
}
// UNIFY: the ONE send path for BOTH surfaces. Persist the live subject/body/signature/recipients to the opp,
// reload the board so runSend's findRow(slug) resolves, then hand off to the UNCHANGED L5 runSend (which does
// the optimistic paint, the relay POST, and writes console_mail only on Resend acceptance). When the overlay
// owns the slug, the draft graduates: clear the pointer and close the overlay first. Gated on subject+body+
// recipient (the send controls are disabled otherwise); the opp link stays optional; upSendLiveGate (the live
// -page check for source==="upload") still runs inside runSend, unchanged.
function unifiedSend(slug){
  if(__writing || __nmSaving){ if(typeof nmActive==="function" && nmActive(slug)){ nmSetStatus(t("a_saving"), ""); nmScheduleSave(slug, 300); } return; }
  var subj=edVal("edSubj"), body=edVal("edBody"), sig=edSignature(), recips=sendToList();
  if(!(subj.trim() && body.trim())){ sendFail(slug, t("nm_need_msg")); return; }
  if(!recips.length){ sendFail(slug, t("nm_need_to")); return; }
  var over = (typeof nmActive==="function" && nmActive(slug));
  if(over){ nmSetStatus(t("s_sending"), ""); var sd=document.getElementById("nmSend"); if(sd) sd.disabled=true; }
  var row = findRow(slug) || { slug:slug };
  oppReadData(slug).then(function(data){
    var next = Object.assign({}, data, { outreach_subject:subj, outreach_text:body, sig:sig, recipients:recips });
    return oppUpsert(slug, { business:(row.business || nmBusiness(subj)), data:next, up:Date.now() });
  }).then(function(){
    return reloadBoardData();                          // so the opp is a board row runSend can find
  }).then(function(){
    // FEEDBACK: do NOT close the overlay before the send settles - otherwise a standalone send shows its result
    // NOWHERE. Run the send, then surface the SAME result string (Sent K of N / failed / capped) in the overlay.
    if(over) nmClearStore();                            // the draft has graduated to a board card; do not resume it
    return Promise.resolve(runSend(slug)).then(function(result){   // runSend resolves with { msg, cls, ... }
      if(over && result){
        nmSetStatus(result.msg, result.cls);            // green on full success, amber on partial, red on failure
        if(result.cls !== "ok"){ var sd2=document.getElementById("nmSend"); if(sd2) sd2.disabled=false; }   // let the operator retry a failed/partial send
      }
      // a drawer-originated send (over===false) shows its result via runSend's own __act[slug] + refreshDrawer
    });
  }).catch(function(e){
    var b2=document.getElementById("nmSend"); if(b2) b2.disabled=false;
    sendFail(slug, (e && e.authRequired) ? t("err") : t("a_failed"));
  });
}

// Read-only hooks for board_newmsg_test:
try{
  window.__thriveNewMessageSlug = function(){ return __nmSlug; };
  window.__thriveNewMessageOpen = function(){ return __nmOpen; };
}catch(e){}
