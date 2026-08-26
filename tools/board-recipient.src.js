// ===================================================================================================
// L5.5 RECIPIENT FIELD - put a recipient email on an opp so L5's Send gate can clear. Inlined verbatim into
// library/board.html by tools/bundle.js (interpolated as a string, so its regexes need no template escaping)
// and runs inside board.html's IIFE alongside the L5 send clone (board-send.src.js). It reuses that file's
// esc, t, bareAddress, isEmail, sendEligible, oppReadData, oppPatch, isoNow, reloadBoardData, refreshDrawer,
// __drawerSlug, __writing, __act, findRow, redInto, root.
//
// The write goes through the SAME column the engine's saveDraft({slug, recipients:list}) writes: recipients
// live inside console_opps.data (supaRowFromOpp puts them there, app.js:3882-3886), and the engine's roster
// editor persists them via saveDraft (app.js:2198). board.html writes the SAME data.recipients[] via its L4
// oppPatch (PATCH console_opps {data}), so the row the L5 gate reads (campaignRecipients / firstRecipient,
// app.js:1050) is byte-identical to an engine-written one. No new column, no new write path.
// ===================================================================================================

// The email the opp already knows, from its own R11 contact model. Mirrors contactChannels / primaryEmailChannel
// (app.js:12675-12684): channels[] (the source of truth) first, then the legacy channel.to / data.email mirror
// (seeded at intake.js:626/631). Returns "" when the opp carries no email anywhere - the field then starts empty.
function knownEmail(data){
  data = data || {};
  if(Array.isArray(data.channels)){
    var prim = data.channels.filter(function(c){ return c && c.primary && c.type==="email" && c.value; })[0];
    var any  = data.channels.filter(function(c){ return c && c.type==="email" && c.value; })[0];
    var pick = prim || any;
    if(pick) return bareAddress(pick.value);
  }
  var c = data.channel || {};
  if(c.kind==="email" && c.to) return bareAddress(c.to);
  if(data.email) return bareAddress(data.email);
  if(/@/.test(String(c.to||""))) return bareAddress(c.to);
  return "";
}
// The addresses already saved on the opp (data.recipients[]), the exact field the L5 gate reads.
function recipientAddrs(data){
  var rs = (data && Array.isArray(data.recipients)) ? data.recipients : [];
  return rs.map(function(r){ return bareAddress((r && r.addr) || ""); }).filter(Boolean);
}
// The field's pre-fill: the saved recipients if any, else the known email as an editable SUGGESTION (not saved).
function recipientPrefill(data){
  var ex = recipientAddrs(data);
  if(ex.length) return ex.join(", ");
  return knownEmail(data);
}
// Parse one or more addresses, comma / newline / semicolon separated (single AND future group send).
function parseAddrs(text){
  return String(text||"").split(/[\n,;]+/).map(function(s){ return bareAddress(s).toLowerCase(); }).filter(Boolean);
}

var __recSaved = {};   // per-slug transient "Saved." status, rendered on each drawer paint (survives the enrichment re-render)

function recipientHtml(slug, row, detail){
  if(!sendEligible(row)) return "";                    // only where Send is offered (has_email, not closed, endpoint set)
  var data = (detail && detail.opp && detail.opp.data) || null;
  var val = data ? recipientPrefill(data) : "";
  var st = __recSaved[slug] || {};
  return '<div class="dw-sec"><h3>'+esc(t("r_h"))+'</h3>'+
    '<textarea class="rec-in mono-iso" id="recIn" rows="1" dir="ltr" autocomplete="off" spellcheck="false" '+
      'placeholder="'+esc(t("r_ph"))+'" aria-label="'+esc(t("r_h"))+'">'+esc(val)+'</textarea>'+
    '<div class="acts"><button class="act send" id="recSave" type="button">'+esc(t("r_save"))+'</button></div>'+
    '<div class="act-status'+(st.cls?(" "+st.cls):"")+'" id="recStatus">'+esc(st.msg||"")+'</div></div>';
}

function setRecStatus(msg, cls){ var el=document.getElementById("recStatus"); if(el){ el.className="act-status"+(cls?(" "+cls):""); el.textContent=msg||""; } }

// Write data.recipients[] via the board's bounded oppPatch (same column as the engine's saveDraft), then read
// back to confirm it persisted. Each address becomes {addr,name,lang} - the exact shape campaignRecipients /
// firstRecipient reads (app.js:1050). Settles either way (authFetchOnce race); no storage touched.
function saveRecipients(slug, list){
  return oppReadData(slug).then(function(data){
    var next = Object.assign({}, data, { recipients: list });
    return oppPatch(slug, { data: next, up: Date.now() }).then(function(){
      return oppReadData(slug).then(function(d2){                       // read-back confirm
        var got = (d2 && Array.isArray(d2.recipients)) ? d2.recipients : [];
        if(got.length < list.length){ throw new Error("recipients did not persist"); }
        return got;
      });
    });
  });
}

// Optimistic confirm-or-revert, same discipline as L4/L5. Validate first (an @ and a dotted domain); reject empty
// or malformed with red and NO write. On success re-read the board (server truth), so L5's Send gate reads the
// saved recipient on its next tap with no manual reload, and any stale L5 "no recipient" red is cleared.
function onSaveRecipient(slug){
  var input = document.getElementById("recIn"); if(!input) return;
  var addrs = parseAddrs(input.value); setRecStatus("", "");
  if(!addrs.length){ setRecStatus(t("r_empty"), "bad"); return; }
  var bad = addrs.filter(function(a){ return !isEmail(a); });
  if(bad.length){ setRecStatus(t("r_bad"), "bad"); return; }
  if(__writing) return; __writing = true;
  setRecStatus(t("r_saving"), ""); var btn=document.getElementById("recSave"); if(btn) btn.disabled=true;
  var list = addrs.map(function(a){ return { addr:a, name:"", lang:"" }; });
  saveRecipients(slug, list).then(function(){
    return reloadBoardData();
  }).then(function(){
    __writing = false;
    if(__act[slug] && __act[slug].cls==="bad"){ delete __act[slug]; }    // clear a stale L5 "no recipient email" red
    __recSaved[slug] = { msg:t("r_saved"), cls:"ok" };
    if(__drawerSlug===slug) refreshDrawer(slug);
  }).catch(function(e){
    __writing = false; var b2=document.getElementById("recSave"); if(b2) b2.disabled=false;
    setRecStatus((e && e.authRequired) ? t("err") : t("r_failed"), "bad");
  });
}
