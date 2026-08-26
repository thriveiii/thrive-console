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
