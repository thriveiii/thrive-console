// ===================================================================================================
// UNIFIED MESSAGE EDITOR (compose + reply) - net-new on board.html (EDITOR_EVIDENCE 2: no compose surface
// exists today; the L5 send refuses when data.outreach_subject/outreach_text are both empty, board.html
// gate). Inlined verbatim into library/board.html by tools/bundle.js (interpolated as a string, so no
// template escaping; this file therefore uses NO backticks and NO dollar-brace). Runs inside board.html's
// IIFE alongside the L5 send clone (board-send.src.js) and the L5.5 recipient field (board-recipient.src.js),
// reusing their scope: esc, t, oppReadData, oppPatch, sendCompile, firstRecipient, liveUrl, MF_LINK,
// bareAddress, isEmail, findRow, refreshOppDetail, owDetailActive, reloadBoardData, __writing, __act, root,
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

// ICONS: one inline-SVG set, the single source reused across the window chrome (close), the compose
// signature chips (remove) and the add affordances. currentColor so each icon inherits the button's text
// colour and themes in light and dark; no glyph font, no icon library, no external fetch. viewBox 0 0 20 20,
// round joins, warm 1.8 stroke. Kept tiny; new names go here only (never an ad-hoc glyph in the markup).
// The one static Close button in the board shell (tools/bundle.js) inlines the same "x" path by hand.
function icon(name, size){
  var s = size || 16;
  var P = {
    // chrome / nav / meta
    x:        'M5 5l10 10M15 5L5 15',
    plus:     'M10 4v12M4 10h12',
    check:    'M4 10l4 4 8-9',
    chevron:  'M5 8l5 5 5-5',
    refresh:  'M15.5 6.5A6 6 0 1 0 16 10M15.5 3.5v3h-3',
    logout:   'M12 6V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1M9 10h8M14 7l3 3-3 3',
    library:  'M5 4h4v12H5zM11 4h4v12h-4M5 8h4M11 8h4',
    contacts: 'M7.5 9a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5M3.5 16c0-2.2 1.8-3.75 4-3.75s4 1.55 4 3.75M13 5.2a2.1 2.1 0 0 1 0 4.1M14 12.4c1.6.35 2.5 1.5 2.5 3.1',
    admin:    'M10 3.2l5.5 1.9v3.9c0 3.6-2.6 6-5.5 7.4-2.9-1.4-5.5-3.8-5.5-7.4V5.1zM7.7 9.7l1.7 1.7 3-3.4',
    profile:  'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M4.5 16.5c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6',
    compose:  'M12.5 4.5l3 3-8.5 8.5H4v-3zM11.5 5.5l3 3',
    sun:      'M10 6.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3l1.3-1.3M14 6l1.3-1.3',
    moon:     'M15.5 11.3A6.2 6.2 0 0 1 8.7 4.5a5.2 5.2 0 1 0 6.8 6.8z',
    globe:    'M10 3.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6M3.4 10h13.2M10 3.2c1.9 2 1.9 11.6 0 13.6M10 3.2c-1.9 2-1.9 11.6 0 13.6',
    // window tabs
    spark:    'M10 3v14M4 6.5l12 7M16 6.5l-12 7',
    text:     'M6 3.5h4.5L14 7v9.5H6zM10.5 3.5V7H14M8 10.5h4M8 13h4',
    page:     'M4 5h12v10H4zM4 8.2h12',
    send:     'M17 3.5L3 9l5.5 2.2L11 16l2-6zM8.5 11.2L17 3.5',
    clock:    'M10 4.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6M10 7v3.2l2.2 1.6',
    channel:  'M4 5.5h12v7.5H8.5L5 16v-3H4z',
    // lanes / states
    review:   'M2.5 10s3-4.75 7.5-4.75S17.5 10 17.5 10s-3 4.75-7.5 4.75S2.5 10 2.5 10M10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    live:     'M10 8.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7M4.5 4.5a8 8 0 0 0 0 11M15.5 4.5a8 8 0 0 1 0 11',
    opened:   'M4 8.5l6-4 6 4v7H4zM4 8.5l6 4 6-4',
    replied:  'M8 5.5L3.5 9.5 8 13.5M3.5 9.5H11a5 5 0 0 1 5 5',
    stalled:  'M10 3.8l6.5 11.4H3.5zM10 8v3.2M10 13.6v.2',
    archived: 'M3.5 5.5h13v3.5h-13zM4.5 9h11v6.5h-11zM8 12h4',
    // send journey + misc
    upload:   'M10 4v9.5M6.5 7.5L10 4l3.5 3.5M4.5 15.5h11',
    at:       'M12.8 10a2.8 2.8 0 1 0-1 2.2M12.8 7.2V10a1.9 1.9 0 0 0 3.4 1.2A7 7 0 1 0 12.8 14.7',
    greeting: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M7.5 9v.01M12.5 9v.01M7.3 12s1 1.5 2.7 1.5 2.7-1.5 2.7-1.5',
    link:     'M8.5 11.5l3-3M7.8 9.2L6.3 10.7a2.4 2.4 0 0 0 3.4 3.4l1.5-1.5M12.2 10.8l1.5-1.5a2.4 2.4 0 0 0-3.4-3.4L8.8 7.4',
    search:   'M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M13 13l3.5 3.5',
    trash:    'M4.5 6h11M8 6V4.2h4V6M6 6l.9 10h6.2L14 6',
    undo:     'M9.5 5l-5 5 5 5M4.5 10h11'
  };
  var d = P[name] || P.spark;
  return '<svg class="icn" width="' + s + '" height="' + s + '" viewBox="0 0 20 20" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false"><path d="' + d + '"></path></svg>';
}

// ICON-ONLY control: an icon that carries a permanent accessible name (aria-label + title) AND a visible
// tooltip that reveals on hover (desktop) and on tap/long-press (touch). Never an icon whose meaning is
// unreachable on touch. Used across the chrome, the window tabs and the overlays.
function iconBtn(id, name, label, extraCls){
  var lab = esc(label);
  return '<button class="iconbtn' + (extraCls ? " " + extraCls : "") + '"' + (id ? ' id="' + id + '"' : '') +
    ' type="button" aria-label="' + lab + '" title="' + lab + '" data-tip="' + lab + '">' + icon(name) + '</button>';
}
// TEXT-KEEPING control: a leading icon beside a word that MUST stay (the send journey, the lane headers).
// Icon is decorative here (aria-hidden); the word carries the meaning.
function iconText(name, label){ return '<span class="ib-ic">' + icon(name) + '</span><span class="ib-t">' + esc(label) + '</span>'; }

// ONE tooltip component, wired once on the document (idempotent). Hover + keyboard focus reveal on desktop;
// a touch tap/long-press reveals it briefly without swallowing the tap, because hover never fires on iPad.
function tipWire(){
  if (window.__thriveTipWired) return; window.__thriveTipWired = true;
  var tip = document.getElementById("thriveTip");
  if (!tip){ tip = document.createElement("div"); tip.id = "thriveTip"; tip.className = "thrive-tip"; tip.setAttribute("role","tooltip"); tip.hidden = true; document.body.appendChild(tip); }
  var hideT = null;
  function tgt(e){ return (e.target && e.target.closest) ? e.target.closest("[data-tip]") : null; }
  function show(el){
    var label = el.getAttribute("data-tip") || el.getAttribute("aria-label") || ""; if (!label) return;
    if (hideT){ clearTimeout(hideT); hideT = null; }
    tip.textContent = label; tip.dir = document.documentElement.getAttribute("dir") || "ltr"; tip.hidden = false;
    var r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width/2 - tw/2, window.innerWidth - tw - 8));
    var top = (r.bottom + 8 + th > window.innerHeight - 8) ? (r.top - th - 8) : (r.bottom + 8);
    tip.style.left = left + "px"; tip.style.top = Math.max(8, top) + "px"; tip.classList.add("on");
  }
  function hide(){ tip.classList.remove("on"); if (hideT) clearTimeout(hideT); hideT = setTimeout(function(){ tip.hidden = true; }, 180); }
  document.addEventListener("pointerover", function(e){ if (e.pointerType === "touch") return; var el = tgt(e); if (el) show(el); }, true);
  document.addEventListener("pointerout",  function(e){ if (e.pointerType === "touch") return; var el = tgt(e); if (el) hide(); }, true);
  document.addEventListener("focusin",  function(e){ var el = tgt(e); if (el) show(el); });
  document.addEventListener("focusout", function(e){ var el = tgt(e); if (el) hide(); });
  document.addEventListener("pointerdown", function(e){ if (e.pointerType !== "touch") return; var el = tgt(e); if (el){ show(el); if (hideT) clearTimeout(hideT); hideT = setTimeout(function(){ tip.classList.remove("on"); tip.hidden = true; }, 1600); } }, true);
}

// CALM GLASS SHIMMER on a surface as it arrives, in place of a hard cut. Re-triggers the one-shot CSS sweep by
// removing the class, forcing a reflow, and re-adding it. Transform/opacity only; the rule itself is
// reduced-motion guarded, so this is a no-op sheen for people who asked for less motion.
function shimmerOnce(el){
  if (!el) return;
  try{ el.classList.remove("shimmer"); void el.offsetWidth; el.classList.add("shimmer"); }catch(e){}
}

// The state glyph for a lane, so colour is never the only carrier of meaning (canon Law 4.4): every lane and
// every counter chip pairs its hue with a shape.
function laneIcon(l){
  var M = { draft:"review", live:"live", sent:"send", opened:"opened", replied:"replied",
            bounced:"stalled", failed:"stalled", other:"archived", won:"check", lost:"x" };
  return M[l] || "spark";
}

// The header identity wordmark: "THE CONSOLE" / «غرفة التحكم», localized on load and on every language toggle.
// The rotating gradient asterisk mark lives beside it (static markup in the shell); this only sets the word.
function paintBrand(){
  var w = document.getElementById("brandWord"); if (!w) return;
  w.textContent = (LANG === "ar") ? "غرفة التحكم" : "THE CONSOLE";
}

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
// G7.1: the agency line of the DEFAULT signature, localized. English reuses the send-side FROM_NAME constant
// (the correct spelling "Thrive Digital Solutions", not the old "Solutoins" mock); Arabic is the agency's own
// name. The site line is the shared agency constant, the same value the message compile uses.
var AGENCY_NAME_EN_L5 = (typeof FROM_NAME_DEFAULT_L5!=="undefined" && FROM_NAME_DEFAULT_L5) ? FROM_NAME_DEFAULT_L5 : "Thrive Digital Solutions";
var AGENCY_NAME_AR_L5 = "ثرايف للحلول الرقمية";
// Arabic detection: any Arabic-script codepoint in the text. Used to pick the default signature's language
// "per the message language" (the body's script), not the UI chrome language.
function edIsArabic(s){ return /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(String(s||"")); }
// The message language: the body's script when it has content (so a message typed in Arabic gets the Arabic
// signature even in an English UI, and vice versa), else the UI language (LANG).
function edMsgLang(){
  var body = edVal("edBody");
  if(body.trim()) return edIsArabic(body) ? "ar" : "en";
  try{ return (typeof LANG!=="undefined" && LANG==="ar") ? "ar" : "en"; }catch(e){ return "en"; }
}
// The DEFAULT signature: three lines, name / agency / site, localized. The name is the current user's OWN name
// (from runtime identity), so it is per-user, never hardcoded. Name omitted if unset (agency then site). The
// site line is the agency constant. This only FILLS the field on demand ("Use my signature"); never automatic.
function edSignatureDefault(lang){
  var id = edIdentity();
  var name = String(id.name==null?"":id.name).trim();
  var site = (typeof AGENCY_SITE_L5!=="undefined" && AGENCY_SITE_L5) ? AGENCY_SITE_L5 : "thriveiii.com";
  var agency = (lang==="ar") ? AGENCY_NAME_AR_L5 : AGENCY_NAME_EN_L5;
  var lines = [];
  if(name) lines.push(name);
  lines.push(agency);
  lines.push(site);
  return lines.join("\n");
}
// Back-compat seam name: the "Use my signature" fill, now the localized default (name / agency / site).
function edSignaturePreset(){ return edSignatureDefault(edMsgLang()); }
// The user's saved (named) signatures, from runtime identity (console_profiles.prefs.signatures). Always an
// array; each entry is { id, name, text }. Per-user by construction (own profile row).
function edSavedSigs(){ var id=edIdentity(); var a=id && id.signatures; return Array.isArray(a) ? a : []; }

// SURFACE SCOPING (COMPOSE_SURFACE_EVIDENCE A1): the editor markup (#edSubj/#edBody/#edSig/#edPreview/
// #edLink/#edStatus and the checklist items) is mounted by BOTH the drawer (#drawer) and the standalone
// New-message overlay (#nmPanel). When both exist, document.getElementById returns the FIRST in DOM order
// (the drawer, which sits before #nmPanel), so overlay reads/writes would bind to the drawer's fields.
// edRoot() returns the ACTIVE compose surface - the overlay while it is open, otherwise the drawer - and
// edEl() scopes every compose lookup to it, so a read never resolves to a hidden second copy.
function edRoot(){
  // G2: the centered window's "message without campaign" (Mode A) compose surface wins when it is active, so
  // every edEl/edVal/edRenderPreview lookup binds to the window's mounted nodes (the SAME editorHtml nodes,
  // mounted by reference - not a second editor). owComposeRoot lives in buildBoard.
  if(typeof owComposeRoot==="function"){ var w=owComposeRoot(); if(w) return w; }   // the window's compose surface (Mode A / Mode B Message tab)
  if(typeof __nmOpen!=="undefined" && __nmOpen){ var p=document.getElementById("nmPanel"); if(p) return p; }   // the "New message" overlay, if open
  return document;                                                                  // G5: the drawer is retired
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
  // Phase 2: the preview compiles for the LIVE recipients (from #recIn + the bulk field, with the primary name
  // field applied), and carries the live platform + greeting mode, so the greeting toggle and the smart-name
  // fields change the preview at once, per the first recipient.
  var recips = (typeof sendToList==="function") ? sendToList() : [];
  if(!recips.length && Array.isArray(base.recipients)) recips = base.recipients;
  return Object.assign({}, base, {
    outreach_subject:edVal("edSubj"), outreach_text:edVal("edBody"), sig:edSignature(),
    greetOn:edGreetOn(slug),                                        // OPTIONAL greeting: applied only when the suggestion is checked
    lang:(LANG==="ar" ? "ar" : (base.lang||"en")),                  // the operator's UI language, so the greeting suggestion == preview == send
    recipients:recips
  });
}
// ---- Optional greeting state (in-memory on __edBase for a live preview; persisted by the compose writer). It is
//      a single opt-in: OFF by default, applied only when the operator checks the suggestion chip. ----
function edGreetOn(slug){ var d=__edBase[slug]||{}; return d.greetOn === true; }
function edSetGreetOn(slug, on){
  if(!__edBase[slug]) __edBase[slug] = {};
  __edBase[slug].greetOn = !!on;
  edRenderPreview(slug); edScheduleSave(slug, 300);   // the exact-send preview reflects the change at once
}
// The greeting line the suggestion would prepend, for the FIRST live recipient, in the operator's UI language.
// It is a SUGGESTION only: no recipient (or a role address with no inferable person) never blocks a send; the
// chip simply shows "" or the team form. Reuses smartPerson / smartPlatform / greetingLine (no fork).
function greetSuggestText(slug, data){
  data = data || __edBase[slug] || {};
  var lang = (LANG==="ar") ? "ar" : "en";
  var first = (typeof sendToList==="function" && sendToList()[0]) || ((typeof firstRecipient==="function") ? firstRecipient(data) : null);
  if(!first || !first.addr) return "";
  var person = (first.name && String(first.name).trim()) || ((typeof smartPerson==="function") ? smartPerson(first.addr) : "");
  var platform = ((typeof smartPlatform==="function") ? smartPlatform(first.addr) : "");
  return greetingLine("name", person, platform, lang);   // "Hi Ahmed," / "Hi Kentucky team," / AR equivalents
}
// Keep the chip's suggested text current as the recipient changes (never blocks; shows "" until a recipient).
function edGreetRefresh(slug){
  var el=edEl("crGreetSugg"); if(!el) return;
  var sugg=greetSuggestText(slug, __edBase[slug]||{});
  el.textContent = sugg || t("g_greet_none");
  var wrap=edEl("crGreet"); if(wrap) wrap.classList.toggle("g-greet-empty", !sugg);
}
// FIX: the greeting control is a COMPACT opt-in in the settings ABOVE the editor - one checkbox that applies the
// inferred suggestion, no large always-visible name/platform fields. OFF by default.
function greetingHtml(slug, row, detail){
  if(!editorEligible(row)) return "";
  var data = (detail && detail.opp && detail.opp.data) || __edBase[slug] || {};
  var on = data.greetOn === true;
  var sugg = greetSuggestText(slug, data);
  return '<div class="dw-sec g-greet" id="crGreet">'+
    '<label class="g-apply"><input type="checkbox" id="crGreetOn"'+(on?" checked":"")+'>'+
      '<span class="ib-ic g-apply-ic">'+icon("greeting",16)+'</span>'+
      '<span class="g-apply-l">'+esc(t("g_greet_apply"))+'</span>'+
      '<span class="g-sugg" id="crGreetSugg" dir="auto">'+esc(sugg||t("g_greet_none"))+'</span></label>'+
    '<div class="g-hint">'+esc(t("g_greet_hint"))+'</div>'+
  '</div>';
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
    '<input class="ed-subj" id="edSubj" type="text" dir="auto" autocomplete="off" spellcheck="true" '+
      'placeholder="'+esc(t("ed_subj_ph"))+'" aria-label="'+esc(t("ed_subj"))+'" value="'+esc(subj)+'">'+
    '<textarea class="rec-in ed-body" id="edBody" rows="6" dir="auto" autocomplete="off" spellcheck="true" '+
      'placeholder="'+esc(t("ed_body_ph"))+'" aria-label="'+esc(t("ed_body"))+'">'+esc(body)+'</textarea>'+
    '<div class="acts"><button class="act" id="edLink" type="button">'+esc(t("ed_link"))+'</button></div>'+
    '<ul class="ed-checks">'+
      ck("ckSubj", subjOk, "ed_ck_subj")+ck("ckBody", bodyOk, "ed_ck_body")+
      ck("ckRecip", hasRecip, "ed_ck_recip")+ck("ckLink", linkOk, "ed_ck_link")+
    '</ul>'+
    '<div class="ed-sig-field">'+
      '<div class="ed-sig-head"><span class="ed-sig-lab">'+esc(t("ed_sig"))+'</span>'+
        '<button class="act ed-sig-use" id="edSigFill" type="button">'+esc(t("ed_sig_use"))+'</button></div>'+
      '<textarea class="rec-in ed-sig-in" id="edSig" rows="3" dir="auto" autocomplete="off" spellcheck="true" '+
        'placeholder="'+esc(t("ed_sig_ph"))+'" aria-label="'+esc(t("ed_sig"))+'">'+esc(sig)+'</textarea>'+
      // G7.1: the user's SAVED signatures - pick one to fill the field, or "+" to save the current text as a new
      // named signature. Populated from runtime identity (per-user) by edRenderSavedSigs after wiring.
      '<div class="ed-sig-saved" id="edSigSaved"></div>'+
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
function edTick(slug){ edRefreshChecks(slug); edApplyGate(slug); edRenderPreview(slug); try{ edGreetRefresh(slug); }catch(e){} try{ if(typeof owRefreshTitle==="function") owRefreshTitle(); }catch(e){} }   // the header follows the subject; the greeting chip follows the recipient

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

// Fill the Signature field with a literal block (a picked saved signature, or the default). Never automatic -
// the operator taps a control, then may edit or clear the field. After filling, refresh the preview and debounce
// a save so the chosen signature persists like any typed one. edFocus keeps the field focused; the input event
// keeps the preview/gate/checklist live and routes the debounced save (E0: signature is field-driven).
function edFillSignatureText(slug, text){
  var el=edEl("edSig"); if(!el) return;
  el.value = String(text==null?"":text);
  try{ el.dispatchEvent(new Event("input", { bubbles:true })); }catch(_){}
  try{ el.focus(); }catch(_){}
  edTick(slug); edScheduleSave(slug, 300);
}
// "Use my signature": fill the field with the DEFAULT block (name / agency / site), localized to the message
// language (the body's script), with the correct "Thrive Digital Solutions" spelling. Per-user via the name.
function edFillSignature(slug){ edFillSignatureText(slug, edSignatureDefault(edMsgLang())); }
// Pick a SAVED signature by id -> fill the field with its text.
function edPickSig(slug, id){
  var list=edSavedSigs(), s=null;
  for(var i=0;i<list.length;i++){ if(list[i] && list[i].id===id){ s=list[i]; break; } }
  if(s) edFillSignatureText(slug, s.text);
}
// "+": save the CURRENT Signature field text as a new named signature (name derived from its first non-empty
// line, so no modal). Persists to the per-user store (console_profiles.prefs.signatures) and re-renders the
// strip. A blank field is not saved (nothing to name). Best-effort persistence: a failed write shows a status
// but the strip still reflects the in-memory add so the operator is not blocked mid-compose.
function edSaveCurrentSig(slug){
  var text = String(edVal("edSig")||"").replace(/\s+$/,"");
  if(!text.trim()){ edSetStatus(slug, t("ed_sig_empty"), "bad"); return; }
  var firstLine = (text.split("\n").find(function(l){ return l.trim(); })||text).trim();
  var name = firstLine.length>40 ? firstLine.slice(0,40) : firstLine;
  var id = "sig-"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  var entry = { id:id, name:name, text:text };
  if(typeof saveSignatureEntry==="function"){
    saveSignatureEntry(entry).then(function(){ edRenderSavedSigs(slug); edSetStatus(slug, t("ed_sig_saved"), "ok"); },
                                   function(){ edRenderSavedSigs(slug); edSetStatus(slug, t("ed_sig_save_failed"), "bad"); });
  } else { edRenderSavedSigs(slug); }
}
// Remove a saved signature by id (persist + re-render).
function edRemoveSig(slug, id){
  if(typeof removeSignatureEntry==="function"){
    removeSignatureEntry(id).then(function(){ edRenderSavedSigs(slug); }, function(){ edRenderSavedSigs(slug); });
  } else { edRenderSavedSigs(slug); }
}
// Render the saved-signatures strip: one pick chip per saved signature (its name; tap to fill), each with a
// small remove control, then a "+" to save the current field text as a new one. Rebuilt from runtime identity,
// so it reflects the latest per-user set after every add/remove. Wired here (not in the static markup) because
// it is dynamic. dir="auto" on the name so an Arabic signature name reads right-to-left.
function edRenderSavedSigs(slug){
  var box=edEl("edSigSaved"); if(!box) return;
  var list=edSavedSigs();
  var chips = list.map(function(s){
    return '<span class="ed-sig-chip"><button class="ed-sig-pick" type="button" data-sig-pick="'+esc(s.id)+'" dir="auto" title="'+esc(t("ed_sig_pick"))+'">'+esc(s.name||t("ed_sig"))+'</button>'+
      '<button class="ed-sig-rm" type="button" data-sig-rm="'+esc(s.id)+'" aria-label="'+esc(t("ed_sig_remove"))+'" title="'+esc(t("ed_sig_remove"))+'">'+icon("x",14)+'</button></span>';
  }).join("");
  box.innerHTML = chips + '<button class="ed-sig-add" id="edSigAdd" type="button" title="'+esc(t("ed_sig_add"))+'">'+icon("plus",14)+' '+esc(t("ed_sig_add"))+'</button>';
  [].forEach.call(box.querySelectorAll("[data-sig-pick]"), function(b){ b.addEventListener("click", function(){ edPickSig(slug, b.getAttribute("data-sig-pick")); }); });
  [].forEach.call(box.querySelectorAll("[data-sig-rm]"), function(b){ b.addEventListener("click", function(){ edRemoveSig(slug, b.getAttribute("data-sig-rm")); }); });
  var add=box.querySelector("#edSigAdd"); if(add) add.addEventListener("click", function(){ edSaveCurrentSig(slug); });
}

function edScheduleSave(slug, delay){
  // E1 seam: when the standalone New Message overlay owns this slug, its own single writer persists the
  // message + recipient together (one read-modify-write, no data-jsonb race with the drawer writer). Every
  // editor input / link-insert / signature-fill routes here, so this is the one place that redirects the save.
  // G2: composeOwns covers BOTH the New-message overlay and the window's Mode A, so window edits autosave
  // through the same single writer (nmSaveNow) as the overlay - no forked save path.
  if(typeof composeOwns==="function" ? composeOwns(slug) : (typeof nmActive==="function" && nmActive(slug))){ if(typeof nmScheduleSave==="function") nmScheduleSave(slug, delay); return; }
  if(__edT[slug]) clearTimeout(__edT[slug]);
  __edT[slug] = setTimeout(function(){ __edT[slug]=null; edSaveNow(slug); }, delay||700);
}
// Bounded, optimistic confirm-or-revert save. The textarea IS the optimistic state; on a CONFIRMED write we
// show green (never a phantom "Saved" without persistence); on failure we show red and leave the operator's
// text intact (reverting it would lose typing). Never fights the shared send/note lock: if one is in flight,
// reschedule shortly so the text is never dropped. On the FIRST message that makes an opp sendable, reload
// the board once so the L5 gate flips and Send appears; ongoing edits do not reload (undo preserved).
function edSaveNow(slug){
  var subjEl=edEl("edSubj"), bodyEl=edEl("edBody");
  if(!subjEl || !bodyEl) return;                                        // the editor must be mounted for this opp (compose saves route to nmSaveNow via composeOwns)
  if(__writing || __edSaving){ edScheduleSave(slug, 500); return; }
  __edSaving = true;
  var subj=String(subjEl.value||""), body=String(bodyEl.value||""), sig=edSignature();
  edSetStatus(slug, t("a_saving"), "");
  oppReadData(slug).then(function(data){
    var wasEmpty = !(String(data.outreach_subject||"").trim() || String(data.outreach_text||"").trim());
    var nowHas = !!(subj.trim() || body.trim());
    var next = Object.assign({}, data, { outreach_subject:subj, outreach_text:body, sig:sig, greetOn:edGreetOn(slug), lang:(LANG==="ar"?"ar":(data.lang||"en")) });
    return oppPatch(slug, { data:next, up:Date.now() }).then(function(){
      __edSaving = false;
      __edBase[slug] = next;                                   // keep the preview base in sync with the persisted record
      var row = findRow(slug);
      var reveal = wasEmpty && nowHas && row && !row.has_email; // first message: flip the L5 gate so Send appears
      if(reveal){
        return reloadBoardData().then(function(){ edSetStatus(slug, t("a_saved"), "ok"); refreshOppDetail(slug); },
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
  edRenderSavedSigs(slug);                                     // G7.1: the per-user saved-signatures strip + "+"
  // Optional greeting (one opt-in checkbox) + the bulk "related contacts".
  var gon=edEl("crGreetOn"); if(gon) gon.addEventListener("change", function(){ edSetGreetOn(slug, gon.checked); });
  var bchk=edEl("crBulkChk"); if(bchk) bchk.addEventListener("change", function(){ var bd=edEl("crBulkBody"); if(bd) bd.hidden=!bchk.checked; edTick(slug); });
  var bin=edEl("crBulkIn"); if(bin) bin.addEventListener("input", function(){ edTick(slug); edScheduleSave(slug, 700); });
  edGreetRefresh(slug);                                        // seed the suggestion text from the current recipient
  edTick(slug);                                                // initial checklist + gate + preview
}

// Read-only hooks for later steps and board_editor_test:
//   __thriveComposeArtifact(slug): the artifact compiled from the PERSISTED record, byte-identical to what
//     runSend compiles before it POSTs (oppReadData -> firstRecipient -> sendCompile), so preview == send.
//   __thriveReplyTo(slug): the Reply-To the send stamps, proving a reply carries the opp slug (never a campaign).
try{
  window.__thriveComposeArtifact = function(slug){ return oppReadData(slug).then(function(data){ return edCompileFrom(slug, data); }); };
  window.__thriveLiveArtifact = function(slug){ return edCompileFrom(slug, edLiveData(slug)); };   // the LIVE compose (fields as typed), for greeting tests
  window.__thriveGreetSuggest = function(slug){ return greetSuggestText(slug, __edBase[slug]||{}); };
  window.__thriveReplyTo = function(slug){ try{ return outboundHeaders(slug)["Reply-To"]; }catch(e){ return ""; } };
  //   __thriveSendHeaders(slug): the exact header set the send stamps for a slug's own mode (personal 1:1 vs
  //     campaign), proving a personal send carries NO List-Unsubscribe. Derives mode from the persisted record.
  window.__thriveSendHeaders = function(slug){ return oppReadData(slug).then(function(data){ return outboundHeaders(slug, sendMode(data)); }); };
  window.__thriveEditorSignature = function(){ return edSignature(); };     // the LIVE field value (empty allowed)
  window.__thriveSignaturePreset = function(){ return edSignaturePreset(); }; // the "Use my signature" fill (localized default)
  window.__thriveSignatureDefault = function(lang){ return edSignatureDefault(lang); }; // the default block for a given language
  window.__thriveMsgLang = function(){ return edMsgLang(); };                // the detected message language (body script, else UI)
}catch(e){}
