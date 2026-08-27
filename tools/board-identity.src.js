// ===================================================================================================
// STEP 1 IDENTITY UNIFICATION + PROFILE LINK. Inlined verbatim into library/board.html by tools/bundle.js
// (interpolated as a string, so it needs no template escaping) and runs inside board.html's IIFE alongside
// the L5 send clone and the L5.5 recipient field. It reuses that scope's session, authEmail, bearer, enc,
// authFetchOnce, URL_BASE, ANON.
//
// WHY THIS FILE IS THE ONE BRIDGE. The console has used TWO actor identities:
//   - the auth uid (session().uid == auth.uid(), board.html:298) - the durable key the profile tables
//     (console_profiles.uid, console_members.id) and the old engine's currentActor()=authUid() (app.js:296)
//     all key on. From Step 1 on, board.html's NEW writes stamp this.
//   - a legacy email - board.html's pre-Step-1 note/mail writes stamped authEmail() (board.html:413/666).
// resolveActor() below is the SINGLE place a stored actor value (uid OR legacy email) is turned into a
// person. The email branch lives ONLY here: when the old engine is retired, that one branch is deleted,
// not hunted across the code (linked-everywhere-or-nowhere).
//
// PROFILE + ROLE come from the EXISTING tables, no new table:
//   console_profile_names (uid, display_name, email)  - cross-readable projection, definer rights,
//                                                        granted to authenticated (supabase-profile-phase-b.sql:23)
//   console_profiles      (own row: prefs.signature / prefs.sig_en|ar, signature_title)
//                                                        - RLS uid=auth.uid() (operator-profile.sql:51)
//   console_members       (own row: role owner|member) - RLS id=auth.uid() (members-oversight.sql:42),
//                                                        console_admins allow-list fallback (app.js:1849)
// Every read is BOUNDED (authFetchOnce, never a hung promise) and BEST-EFFORT: any failure or a missing
// profile resolves to a safe default (no name, member role), never a black screen. No storage is touched.
// ===================================================================================================

var __identity = { uid:"", email:"", name:"", signature:"", title:"", role:"member", loaded:false };
var __profileIndex = { byUid:{}, byEmail:{} };   // from console_profile_names, powers resolveActor across operators

// The current actor as a uid: the value NEW writes stamp (matches app.js currentActor()=authUid()).
function currentUid(){ var s=session(); return (s && s.uid) || ""; }

// A bounded, best-effort REST GET: returns [] on ANY failure (never rejects, never hangs). Used for every
// identity read so a slow or missing table degrades to a safe default rather than stalling the board.
function identGet(pathq){
  return authFetchOnce(URL_BASE + "/rest/v1/" + pathq, {
    method:"GET", headers:{ "apikey":ANON, "Authorization":"Bearer "+bearer() }, cache:"no-store"
  }).then(function(r){ return Array.isArray(r.data) ? r.data : []; }, function(){ return []; });
}

// THE ONE BRIDGE. Turn a stored actor value into a person { uid, name, email }:
//   - a legacy email (has "@") is matched to console_profiles.email via the index, so a row board.html
//     wrote as an email reaches the SAME person as a row written as that person's uid. DELETE THIS BRANCH
//     when the old engine and its email writes are retired.
//   - a uid (no "@") is the durable identity, used directly; the name is filled from the index when known.
function resolveActor(v){
  var val = String(v==null?"":v).trim();
  if(!val) return { uid:"", name:"", email:"" };
  if(val.indexOf("@") >= 0){                                   // LEGACY email branch (the seam to delete later)
    var p = __profileIndex.byEmail[val.toLowerCase()];
    if(p) return { uid:p.uid||"", name:p.name||"", email:p.email||val };
    return { uid:"", name:"", email:val };
  }
  var q = __profileIndex.byUid[val];                           // uid branch (the durable key)
  if(q) return { uid:val, name:q.name||"", email:q.email||"" };
  return { uid:val, name:"", email:"" };
}

// Display helper for a stored actor value (Step 2A): the resolved display name if the profile index knows it,
// else the raw value verbatim (a uid, or a legacy email) so it is NEVER blank. Escaping stays the caller's
// job. Used by the note meta render (bundle.js noteItemHtml). A uid not in the index, or an index not yet
// settled, degrades to the raw value; a later re-render (finishIdentity below) upgrades it to the name.
function actorName(v){
  if(v==null || v==="") return "";
  try{ var r = resolveActor(v); return (r && r.name) ? r.name : String(v); }
  catch(e){ return String(v); }
}

// Signature is per-operator in console_profiles.prefs; the engine writes sig_en / sig_ar (app.js:1789), and a
// generic prefs.signature is honored too. Language-agnostic pick for now; a later step localizes it.
function pickSignature(prefs){
  prefs = (prefs && typeof prefs==="object") ? prefs : {};
  return String(prefs.signature || prefs.sig_en || prefs.sig_ar || "");
}

// Load, once, at boot: the cross-operator name index, then the current operator's own profile (signature +
// title) and role. Fire-and-forget from loadBoard(); it NEVER gates the render. Bounded and best-effort at
// every step; the safe defaults in __identity stand if anything is missing.
function loadIdentity(){
  var uid = currentUid();
  __identity.uid = uid; __identity.email = authEmail();
  return identGet("console_profile_names?select=uid,display_name,email").then(function(rows){
    __profileIndex = { byUid:{}, byEmail:{} };
    (rows||[]).forEach(function(r){
      if(!r) return;
      var rec = { uid:r.uid||"", name:r.display_name||"", email:r.email||"" };
      if(rec.uid) __profileIndex.byUid[rec.uid] = rec;
      if(rec.email) __profileIndex.byEmail[String(rec.email).toLowerCase()] = rec;
    });
    var me = uid ? __profileIndex.byUid[uid] : null;
    if(me && me.name) __identity.name = me.name;
    // own profile row (RLS own-row). select=* so an unapplied signature_title column never 400s the read.
    return uid ? identGet("console_profiles?uid=eq."+enc(uid)+"&select=*&limit=1") : [];
  }).then(function(prows){
    var pr = (prows||[])[0];
    if(pr){
      if(!__identity.name) __identity.name = pr.display_name || "";
      __identity.signature = pickSignature(pr.prefs);
      var prefs = (pr.prefs && typeof pr.prefs==="object") ? pr.prefs : {};
      __identity.title = String(pr.signature_title || prefs.title || "");   // column authoritative once applied
    }
    // role, from the DATABASE: own console_members row (owner|member), console_admins the legacy fallback.
    return uid ? identGet("console_members?id=eq."+enc(uid)+"&select=id,role&limit=1") : [];
  }).then(function(mrows){
    var m = (mrows||[])[0];
    if(m && m.role==="owner"){ __identity.role = "owner"; return finishIdentity(); }
    return (currentUid() ? identGet("console_admins?uid=eq."+enc(currentUid())+"&select=uid&limit=1") : Promise.resolve([]))
      .then(function(arows){ if((arows||[]).length) __identity.role = "owner"; return finishIdentity(); });
  }).catch(function(){ return finishIdentity(); });             // any failure: the safe defaults already stand
}
function finishIdentity(){
  __identity.loaded = true;
  // Surface for later steps (read-only). Non-secret: name/title/role/uid/email plus a hasSignature flag.
  try{ window.__thriveIdentity = { uid:__identity.uid, email:__identity.email, name:__identity.name,
        title:__identity.title, signature:__identity.signature, hasSignature:!!__identity.signature,
        role:__identity.role, loaded:true }; }catch(e){}
  // Step 2A: the profile index just settled (fire-and-forget from loadBoard, so it may finish AFTER a drawer
  // was opened). Re-paint the open drawer's notes ONCE so an actor uid that showed raw on first paint now
  // reads as the display name. One synchronous re-render, no polling, no await; guarded so it never throws.
  try{ if(__drawerSlug && typeof renderNotesInto==="function") renderNotesInto(__drawerSlug); }catch(e){}
  // Step 2D: the role just settled, so reveal (or keep hidden) the Admin header entry now that isOwner() is
  // authoritative. paintAdminSlot lives in bundle.js and is idempotent; guarded so it never throws here.
  try{ if(typeof window.__thrivePaintAdminSlot==="function") window.__thrivePaintAdminSlot(); }catch(e){}
  return __identity;
}

// Role is a DATABASE fact, surfaced here for later steps. THE RULE (stated in the PR): any future
// executive-only surface MUST gate on this DB-verified value (an RLS-protected read or a policy), never on
// hiding a button. This step only surfaces the role; it builds no executive UI.
function currentRole(){ return __identity.role || "member"; }
function isOwner(){ return currentRole()==="owner"; }

// Read-only consumer hooks for later steps (and board_identity_test): the ONE resolver and the current uid.
// resolveActor reads the live __profileIndex, so a call after loadIdentity settles sees the populated index.
try{ window.__thriveResolveActor = resolveActor; window.__thriveCurrentUid = currentUid; window.__thriveCurrentRole = currentRole; }catch(e){}

// ===================================================================================================
// STEP 2B PROFILE SETTINGS. A member-facing surface, opened from the header, showing this operator's email
// (read-only), display name (editable), and functional title (display only; an admin edits it in a later
// step). This is the FIRST board.html write to console_profiles: a bounded own-row upsert keyed on
// uid = currentUid() (== (auth.uid())::text, the live policy on the text uid column), writing ONLY
// display_name. It never sends signature_title or role, so the admin-gated columns are untouched. The
// owner/member role is not shown here at all: this surface speaks only the functional title.
// ===================================================================================================

function pfSetStatus(msg, cls){ var el=document.getElementById("pfStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }

// The panel: email (read-only, LTR), display name (editable), functional title (read-only + admin note).
function profilePanelHtml(){
  var email = authEmail();
  var name  = __identity.name  || "";
  var title = __identity.title || "";
  return '<div class="pf-head"><h2 class="pf-h2">'+esc(t("pf_title"))+'</h2>'+
      '<button class="link" id="pfClose" type="button">'+esc(t("pf_close"))+'</button></div>'+
    '<div class="dw-sec"><h3>'+esc(t("pf_email"))+'</h3>'+
      '<div class="pf-ro mono-iso" dir="ltr">'+esc(email)+'</div></div>'+
    '<div class="dw-sec"><h3>'+esc(t("pf_name"))+'</h3>'+
      '<input class="rec-in" id="pfName" type="text" autocomplete="off" spellcheck="false" '+
        'value="'+esc(name)+'" placeholder="'+esc(t("pf_name_ph"))+'" aria-label="'+esc(t("pf_name"))+'">'+
      '<div class="acts"><button class="act send" id="pfSave" type="button">'+esc(t("pf_save"))+'</button></div>'+
      '<div class="act-status" id="pfStatus"></div></div>'+
    '<div class="dw-sec"><h3>'+esc(t("pf_role_h"))+'</h3>'+
      '<div class="pf-ro">'+esc(title || t("pf_role_none"))+'</div>'+
      '<div class="pf-note">'+esc(t("pf_role_note"))+'</div></div>';
    // Step 2D: the personal profile is PERSONAL only. The team-titles roster moved to its own owner-only
    // Admin surface (openAdmin), so this panel never mixes a person's own profile with executive controls.
}

function wireProfile(){
  var c=document.getElementById("pfClose"); if(c) c.addEventListener("click", closeProfile);
  var s=document.getElementById("pfSave"); if(s) s.addEventListener("click", onSaveProfile);
}
function openProfile(){
  var sc=document.getElementById("pfScrim"), pn=document.getElementById("pfPanel");
  if(!sc || !pn) return;
  pn.innerHTML = profilePanelHtml(); sc.hidden=false; pn.scrollTop=0; wireProfile();     // instant from __identity
  var uid = currentUid();                                                                 // then refresh, best-effort
  if(uid){
    identGet("console_profiles?uid=eq."+enc(uid)+"&select=*&limit=1").then(function(rows){ // select=* so an unapplied column never 400s
      var pr=(rows||[])[0]; if(!pr) return;
      __identity.name  = (pr.display_name!=null) ? pr.display_name : __identity.name;
      var prefs = (pr.prefs && typeof pr.prefs==="object") ? pr.prefs : {};
      __identity.title = String(pr.signature_title || prefs.title || __identity.title || "");
      var scr=document.getElementById("pfScrim");
      if(scr && !scr.hidden){ var p2=document.getElementById("pfPanel"); if(p2){ p2.innerHTML=profilePanelHtml(); wireProfile(); } }
    });
  }
}
function closeProfile(){ var sc=document.getElementById("pfScrim"); if(sc) sc.hidden=true; }

// The bounded own-row upsert. Body carries ONLY the key (uid) and display_name: signature_title and role are
// never named, so they are never written. Same settle-always discipline as oppPatch (authFetchOnce timeout
// REJECTS, one refresh-retry). uid = currentUid() equals (auth.uid())::text, satisfying the own-row policy.
function profileSaveName(name, retried){
  var uid = currentUid();
  var body = { uid: uid, display_name: String(name==null?"":name) };
  return authFetchOnce(URL_BASE + "/rest/v1/console_profiles", {
    method:"POST",
    headers:{ "apikey":ANON, "Authorization":"Bearer "+bearer(), "Content-Type":"application/json",
              "Prefer":"resolution=merge-duplicates,return=representation" },
    cache:"no-store", body: JSON.stringify(body)
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return profileSaveName(name, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error((r.data && r.data.message) || ("HTTP "+r.res.status)); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    return (Array.isArray(r.data) ? r.data[0] : r.data) || body;
  });
}
// After a CONFIRMED save, reflect the new name in runtime + the resolver index so note metas show it at once
// (Step 2A actorName reads __profileIndex live), no reload. Called only on success, so no phantom save.
function applyNameLocally(name){
  var uid = currentUid();
  __identity.name = String(name==null?"":name);
  if(uid){ if(!__profileIndex.byUid[uid]) __profileIndex.byUid[uid] = { uid:uid, name:"", email:authEmail() }; __profileIndex.byUid[uid].name = __identity.name; }
  try{ if(window.__thriveIdentity) window.__thriveIdentity.name = __identity.name; }catch(e){}
  try{ if(__drawerSlug && typeof renderNotesInto==="function") renderNotesInto(__drawerSlug); }catch(e){}
}
// Optimistic confirm-or-revert: the person controls their own display_name (any format, first-name-only or
// full). Nothing is applied until the server confirms; a failure shows red and leaves the runtime name as it
// was, never a phantom save. Reuses the shared __writing guard so a save never overlaps a send or note write.
function onSaveProfile(){
  var input = document.getElementById("pfName"); if(!input) return;
  var name = String(input.value||"").trim();
  if(__writing) return; __writing = true;
  pfSetStatus(t("pf_saving"), ""); var btn=document.getElementById("pfSave"); if(btn) btn.disabled=true;
  profileSaveName(name).then(function(row){
    __writing = false; if(btn) btn.disabled=false;
    applyNameLocally((row && row.display_name!=null) ? row.display_name : name);
    var i2=document.getElementById("pfName"); if(i2) i2.value = __identity.name;
    pfSetStatus(t("pf_saved"), "ok");
  }).catch(function(e){
    __writing = false; var b2=document.getElementById("pfSave"); if(b2) b2.disabled=false;
    pfSetStatus((e && e.authRequired) ? t("err") : t("pf_failed"), "bad");
  });
}

// ===================================================================================================
// STEP 2D ADMIN EXECUTIVE SURFACE (was 2C, relocated). A SEPARATE owner-only surface, opened from its own
// header entry, NOT from the personal profile panel: the team roster with an editable functional title per
// member. This is the seed of a future executive/performance view; keeping it apart from the person's own
// profile means the two never mix. Rendered ONLY when isOwner() is true (a UI gate for convenience); the
// REAL gate is live and unchanged from 2C: console_profiles_owner_update (UPDATE, is_console_owner()) plus
// the BEFORE UPDATE trigger guard_profile_title that rejects a signature_title change unless
// is_console_owner(). The title write is keyed on the TARGET member's uid (never the admin's currentUid())
// and carries ONLY signature_title. The owner/member ROLE is never shown or edited here; role decides only
// whether this surface opens at all. The 2B own-row write (display_name only) is untouched.
// ===================================================================================================

var __roster = [];   // [{ uid, name, email, title }] loaded for an owner; role is never read into this

// The Admin panel body. Empty string for a non-owner, so a member who somehow reaches the DOM sees nothing;
// the header entry is also hidden for a member, and the RLS policy is the real gate on the write itself.
function adminPanelHtml(){
  if(!isOwner()) return "";
  return '<div class="pf-head"><h2 class="pf-h2">'+esc(t("adm_title"))+'</h2>'+
      '<button class="link" id="admClose" type="button">'+esc(t("pf_close"))+'</button></div>'+
    '<div class="dw-sec pf-admin"><h3>'+esc(t("pf_admin_h"))+'</h3>'+
      '<div class="pf-note">'+esc(t("pf_admin_note"))+'</div>'+
      '<div id="admRoster">'+rosterInnerHtml()+'</div></div>';
}
function rosterInnerHtml(){
  if(!__roster.length) return '<div class="muted" id="admRosterEmpty">'+esc(t("pf_admin_loading"))+'</div>';
  return __roster.map(function(m, i){
    // The member LABEL preference: display_name, then email (the view resolves it from auth.users, so a
    // real member always has one), then a short "unnamed" label. The raw uuid is NEVER shown as a name:
    // m.name is console_team_roster.display_name, and "unnamed" appears only if display_name AND email are
    // both truly null, which a real auth user never hits now that email comes from auth.users.
    return '<div class="pf-mem" data-uid="'+esc(m.uid)+'">'+
      '<div class="pf-mem-id"><span class="pf-mem-name">'+esc(m.name || m.email || t("unnamed"))+'</span>'+
        '<span class="pf-mem-email mono-iso" dir="ltr">'+esc(m.email||"")+'</span></div>'+
      '<input class="rec-in pf-title-in" id="pfT'+i+'" type="text" autocomplete="off" spellcheck="false" '+
        'value="'+esc(m.title||"")+'" placeholder="'+esc(t("pf_admin_ph"))+'" aria-label="'+esc(t("pf_admin_title"))+'">'+
      '<div class="acts"><button class="act send pf-title-save" data-uid="'+esc(m.uid)+'" data-i="'+i+'" type="button">'+esc(t("pf_admin_save"))+'</button></div>'+
      '<div class="act-status pf-title-status" id="pfTS'+i+'"></div></div>';
  }).join("");
}
function wireRoster(){
  [].forEach.call(document.querySelectorAll(".pf-title-save"), function(btn){
    btn.addEventListener("click", function(){ onSaveTitle(btn.getAttribute("data-uid"), btn.getAttribute("data-i")); });
  });
}
function setTitleStatus(idx, msg, cls){ var el=document.getElementById("pfTS"+idx); if(el){ el.className="act-status pf-title-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }

// Load the roster (owner only). Members come from ONE owner-gated server view, console_team_roster, which
// resolves each member's email from auth.users SERVER-SIDE (the client cannot read auth.users directly, so
// the old console_members.email mirror column was null and the email never reached the row). The view
// returns uid, email, display_name, role and enforces the owner scope itself via is_console_owner(); a
// non-owner (or signed-out) caller gets zero rows. isOwner() still gates the UI. Current titles are layered
// on from console_profiles.signature_title exactly as before, keyed on uid; a member with no title, or a
// row the reader cannot see, shows a BLANK title (never a crash). Both reads are bounded and best-effort
// (identGet over authFetchOnce).
function loadRoster(){
  if(!isOwner()) return Promise.resolve();
  return identGet("console_team_roster?select=uid,email,display_name,role&order=display_name.asc").then(function(rows){
    var members = (rows||[]).map(function(r){ return { uid:(r&&r.uid)||"", name:(r&&r.display_name)||"", email:(r&&r.email)||"" }; })
                            .filter(function(m){ return m.uid; });
    return identGet("console_profiles?select=uid,signature_title").then(function(prows){
      var byUid = {}; (prows||[]).forEach(function(p){ if(p && p.uid) byUid[p.uid] = String(p.signature_title||""); });
      __roster = members.map(function(m){ m.title = byUid[m.uid] || ""; return m; });
      var host=document.getElementById("admRoster"); if(host){ host.innerHTML = rosterInnerHtml(); wireRoster(); }
    }, function(){                                             // titles unreadable: still render the roster, blank titles
      __roster = members.map(function(m){ m.title=""; return m; });
      var host=document.getElementById("admRoster"); if(host){ host.innerHTML = rosterInnerHtml(); wireRoster(); }
    });
  }, function(){ /* roster read failed: leave the loading note, never crash */ });
}

// The title write: a PATCH (pure UPDATE) keyed on the TARGET member's uid, body ONLY { signature_title }.
// This triggers exactly console_profiles_owner_update (UPDATE) + guard_profile_title, which the server
// permits only for an owner and rejects for a member. Bounded (authFetchOnce timeout REJECTS), one
// refresh-retry, Prefer return=minimal (the owner may lack SELECT on another row, so success is the 2xx
// status, not a read-back). Never keyed on currentUid(); never carries display_name or role.
function titlePatch(targetUid, title, retried){
  var url = URL_BASE + "/rest/v1/console_profiles?uid=eq." + enc(targetUid);
  return authFetchOnce(url, {
    method:"PATCH",
    headers:{ "apikey":ANON, "Authorization":"Bearer "+bearer(), "Content-Type":"application/json", "Prefer":"return=minimal" },
    cache:"no-store", body: JSON.stringify({ signature_title: String(title==null?"":title) })
  }).then(function(r){
    if((r.res.status===401 || r.res.status===403) && !retried && session() && session().refresh_token){
      return refresh().then(function(ok){ if(ok) return titlePatch(targetUid, title, true); var e=new Error("auth"); e.authRequired=true; throw e; });
    }
    if(!r.res.ok){ var e2=new Error((r.data && r.data.message) || ("HTTP "+r.res.status)); if(r.res.status===401||r.res.status===403) e2.authRequired=true; throw e2; }
    return true;
  });
}
// Optimistic confirm-or-revert per member row: apply the typed title ONLY on a 2xx (the server policy +
// trigger accepted it), so a rejected write (a non-owner, or any failure) reverts red with no phantom save.
function onSaveTitle(targetUid, idx){
  var input = document.getElementById("pfT"+idx); if(!input || !targetUid) return;
  var title = String(input.value||"").trim();
  if(__writing) return; __writing = true;
  setTitleStatus(idx, t("pf_saving"), ""); var btn=document.querySelector('.pf-title-save[data-i="'+idx+'"]'); if(btn) btn.disabled=true;
  titlePatch(targetUid, title).then(function(){
    __writing = false; if(btn) btn.disabled=false;
    for(var i=0;i<__roster.length;i++){ if(__roster[i].uid===targetUid){ __roster[i].title = title; break; } }
    if(__profileIndex.byUid[targetUid]) __profileIndex.byUid[targetUid].title = title;   // refresh the index
    if(currentUid()===targetUid){ __identity.title = title; try{ if(window.__thriveIdentity) window.__thriveIdentity.title = title; }catch(e){} }
    setTitleStatus(idx, t("pf_saved"), "ok");
  }).catch(function(e){
    __writing = false; var b2=document.querySelector('.pf-title-save[data-i="'+idx+'"]'); if(b2) b2.disabled=false;
    setTitleStatus(idx, (e && e.authRequired) ? t("err") : t("pf_admin_failed"), "bad");   // rejected -> red, nothing applied
  });
}

// The Admin surface open/close/wire, mirroring the profile panel but on its own #admScrim/#admPanel overlay.
// openAdmin is a no-op for a non-owner (adminPanelHtml returns "" and the header entry is hidden anyway), so
// there is no way for a member to open it. On open we paint instantly from state, then load the roster.
function wireAdmin(){ var c=document.getElementById("admClose"); if(c) c.addEventListener("click", closeAdmin); }
function openAdmin(){
  if(!isOwner()) return;                                                                   // members never open this
  var sc=document.getElementById("admScrim"), pn=document.getElementById("admPanel");
  if(!sc || !pn) return;
  pn.innerHTML = adminPanelHtml(); sc.hidden=false; pn.scrollTop=0; wireAdmin();
  try{ loadRoster(); }catch(e){}                                                           // bounded, best-effort
}
function closeAdmin(){ var sc=document.getElementById("admScrim"); if(sc) sc.hidden=true; }

// Read-only hooks so bundle.js can wire the header entry and the Escape/backdrop handler without reaching
// into module internals.
try{ window.__thriveOpenAdmin = openAdmin; window.__thriveCloseAdmin = closeAdmin; window.__thriveOpenProfile = openProfile; window.__thriveCloseProfile = closeProfile; }catch(e){}
