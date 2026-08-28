"""UNIFIED MESSAGE EDITOR (board.html compose + reply, fails-when-broken, ZERO real network send).

A net-new editing surface in the drawer lets the operator write subject + body for an opp, insert the opp
link as a merge token, and control a SEPARATE, OPTIONAL Signature field (E0): its value IS data.sig, empty
means NO signature block, and "Use my signature" fills it with the identity preset (name / title / site).
The preview uses the SAME sendCompile the send path uses (preview == send parity), and hands the composed
content to the unchanged L5 send. Stateful mock of Supabase REST (never a real send). Assertions:
  1. subject + body edits save to data.outreach_subject / data.outreach_text via oppPatch and persist across
     a full reload; the save never resets the textarea value (undo stack preserved);
  E0. the Signature is a SEPARATE editable field distinct from the body; its value becomes data.sig and
     persists; EMPTY signature yields NO sig block in the compiled html/text (fully optional); "Use my
     signature" fills name / title / thriveiii.com as three lines and stays editable; the body renders
     verbatim with no auto-signature fused into it; the sig block grey is the darker value (not #888888);
     a multi-line sig renders with real <br> line breaks; preview == send parity is driven by the field;
  3. the opp-link token inserts and tokenizes to console.thriveiii.com/opp/<slug> in the compiled html;
  4. the pre-send checklist tracks subject / body / recipient / link, and Send is disabled until the message
     (subject + body) is present (the signature is never required);
  5. giving a message to an opp that had none flips the L5 gate so Send appears (no compose surface before);
  6. a reply carries the opp slug (Reply-To hi+<slug>@thriveiii.com), never the whole campaign;
  7. a forced write failure reverts visibly (red) with no phantom save (the record is unchanged);
  8. AR RTL; privacy: every address is a synthetic *.example.test placeholder.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:600])

# ---- identity (populates __thriveIdentity: name + functional title) ------------------------------
UID = "u"
DISPLAY_NAME = "Alice Op"
TITLE = "Growth Lead"
SIG = DISPLAY_NAME + ", " + TITLE                    # a legacy comma-form sig (used by the baked fixture only)
PRESET = DISPLAY_NAME + "\n" + TITLE + "\n" + "thriveiii.com"   # the "Use my signature" 3-line fill
FREE = "Warm regards,\nAlice Op"                     # a freely typed signature (operator authored)

# ---- opps (ALL addresses synthetic *.example.test) -----------------------------------------------
def opp(slug, biz, subject, text, addr):
    return {"slug":slug, "business":biz, "archived":False,
            "data":{"recipients":([{"addr":addr, "name":""}] if addr else []),
                    "channels":([{"type":"email","value":addr,"primary":True}] if addr else []),
                    "outreach_subject":subject, "outreach_text":text, "branded":False}}
OPPS = {
  "acme":  opp("acme","Acme Co","Acme x Thrive","Hi, a quick note.","buyer.acme@example.test"),  # edit + parity
  "fresh": opp("fresh","Fresh Co","","","known.fresh@example.test"),                              # no message yet
  "reply": opp("reply","Reply Co","Re: your note","Thanks, answering now.","buyer.reply@example.test"),
  "failw": opp("failw","Failw Co","Failw x Thrive","Body here.","buyer.failw@example.test"),      # forced PATCH 500
}
# PR-A verbatim fixture: the stored body ENDS with an old hand-typed agency closing
# (sign-off name / Thrive Digital Solutions / thriveiii.com) AND the record already carries data.sig.
# The body is now compiled and sent EXACTLY as written - that closing is NOT detected or removed;
# the separate data.sig is still appended once. (No content in the body is ever treated as a signature.)
OPPS["baked"] = {"slug":"baked", "business":"Baked Co", "archived":False,
  "data":{"recipients":[{"addr":"buyer.baked@example.test","name":""}],
          "channels":[{"type":"email","value":"buyer.baked@example.test","primary":True}],
          "outreach_subject":"Baked x Thrive",
          "outreach_text":"Hello there, a quick note.\n\nLooking forward to your reply.\n\nOld Signoff Name\nThrive Digital Solutions\nthriveiii.com",
          "sig":SIG, "branded":False}}
PATCH_CALLS = []          # captured console_opps PATCH bodies
OPP_FAULT = {}            # slug -> "500" to force a write failure

def has_msg(o):
    d=o.get("data",{}); return bool(str(d.get("outreach_subject","")).strip() or str(d.get("outreach_text","")).strip())

def board_rows():
    rows=[]
    for o in OPPS.values():
        he = has_msg(o)
        rows.append({"slug":o["slug"], "business":o["business"], "stage":("live" if he else "draft"),
          "sent_count":0, "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":False, "has_email":he, "archived":False})
    return rows

def slug_of(url):
    m=re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(route, obj, status=200):
    route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))

def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_pnames(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "email":"op@thrive.test"}])
def route_members(r):
    url=r.request.url
    if "select=id,role" in url or "select=id%2Crole" in url: return J(r, [{"id":UID, "role":"member"}])
    return J(r, [])
def route_profiles(r):
    # own-row read (loadIdentity / openProfile): supply display_name + signature_title so __thriveIdentity has them
    return J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":TITLE}])
def route_opps(r):
    req=r.request; url=req.url; slug=slug_of(url)
    if req.method == "PATCH":
        try: body=json.loads(req.post_data or "{}")
        except Exception: body={}
        PATCH_CALLS.append({"slug":slug, "body":body})
        if OPP_FAULT.get(slug) == "500":
            return J(r, {"message":"synthetic opp write failure"}, status=500)   # store NOT updated -> no phantom
        o=OPPS.get(slug)
        if o is not None and isinstance(body.get("data"), dict): o["data"]=body["data"]
        return r.fulfill(status=204, body="")
    o=OPPS.get(slug, {"slug":slug,"data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_team_roster**", route_empty)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)

OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
HAS_SEND = "()=>!!document.querySelector('#drawer .act[data-act=\"send\"]')"
SEND_DISABLED = "()=>{ var b=document.querySelector('#drawer .act[data-act=\"send\"]'); return b? !!b.disabled : null; }"
ED_STATUS = "()=>{ var e=document.getElementById('edStatus'); return e?{txt:e.textContent,cls:e.className}:{txt:'',cls:''}; }"
CK = "(id)=>{ var e=document.getElementById(id); return e? e.className : ''; }"
SRCDOC = "()=>{ var f=document.getElementById('edPreview'); return f? f.getAttribute('srcdoc') : ''; }"

def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== compose + persist + signature + link + parity (acme) =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    # E0: the identity PRESET (what "Use my signature" fills) is name / title / site, three lines - not an
    # auto-applied value. edSignaturePreset reads identity only, so it resolves before any drawer opens.
    ck("E0: the identity preset is name / title / thriveiii.com (three lines)",
       pg.evaluate("()=>window.__thriveSignaturePreset()")==PRESET, pg.evaluate("()=>window.__thriveSignaturePreset()"))

    pg.evaluate(OPEN, "Acme Co"); pg.wait_for_timeout(500)
    ck("editor: subject + body fields render in the drawer", pg.evaluate("()=>!!(document.getElementById('edSubj')&&document.getElementById('edBody'))"))
    ck("editor: pre-fills the subject from the record", pg.evaluate("()=>document.getElementById('edSubj').value")=="Acme x Thrive")

    # E0: a SEPARATE Signature field exists, distinct from the body, editable, and starts EMPTY (acme has no sig)
    ck("E0: a separate Signature field (#edSig) exists, distinct from the body (#edBody)",
       pg.evaluate("()=>{var s=document.getElementById('edSig'),b=document.getElementById('edBody'); return !!s && !!b && s!==b && s.tagName==='TEXTAREA';}"))
    ck("E0: the Signature field is editable (not disabled or readonly)",
       pg.evaluate("()=>{var s=document.getElementById('edSig'); return !s.disabled && !s.readOnly;}"))
    ck("E0: the Signature field starts EMPTY for an opp with no saved sig", pg.evaluate("()=>document.getElementById('edSig').value")=="")

    # edit subject + body (with a real paragraph break), insert the opp link, leave the SIGNATURE EMPTY, save
    pg.fill("#edSubj", "Acme partnership")
    pg.fill("#edBody", "First paragraph.\n\nSecond paragraph.\n")
    pg.evaluate("()=>{ var b=document.getElementById('edLink'); if(b) b.click(); }")   # insert the {{LINK}} token
    body_after_insert = pg.evaluate("()=>document.getElementById('edBody').value")
    ck("3: Insert opp link adds the link token to the body", "{{LINK}}" in body_after_insert, body_after_insert)
    pg.wait_for_timeout(1300)   # debounce (700) + save + preview

    ck("1: a green Saved status shows after the debounced save", "ok" in pg.evaluate(ED_STATUS)["cls"], pg.evaluate(ED_STATUS))
    ck("1: the save did NOT reset the textarea value (undo preserved)", pg.evaluate("()=>document.getElementById('edBody').value")==body_after_insert)
    pb = [c for c in PATCH_CALLS if c["slug"]=="acme"]
    last = pb[-1]["body"]["data"] if pb else {}
    ck("1: subject + body saved to data.outreach_subject / data.outreach_text",
       last.get("outreach_subject")=="Acme partnership" and "First paragraph" in str(last.get("outreach_text","")), last)
    ck("E0: an EMPTY signature field saves data.sig as empty", str(last.get("sig",""))=="", last.get("sig"))

    # E0 preview==send with an EMPTY signature: NO sig block, and the body shows verbatim
    art0 = pg.evaluate("async()=>{ return await window.__thriveComposeArtifact('acme'); }")
    txt0, htm0 = art0.get("text",""), art0.get("html","")
    ck("E0: EMPTY signature yields NO sig block in the html (no #595959 / #888888 sig div)",
       "#595959" not in htm0 and "#888888" not in htm0, htm0[:240])
    ck("E0: with no signature, the body text is rendered verbatim (no auto-sig fused in)",
       "First paragraph.\n\nSecond paragraph." in txt0 and "First paragraph" in htm0
       and "Growth Lead" not in htm0 and "Growth Lead" not in txt0, {"txt":txt0[:200]})
    ck("E0: preview iframe EQUALS the send html even with an empty signature",
       pg.evaluate(SRCDOC)==htm0, {"srcdoc_len":len(pg.evaluate(SRCDOC) or ""), "art_len":len(htm0)})

    # E0: type a FREE signature (operator authored, multi-line) -> it becomes data.sig; sig block appears
    pg.fill("#edSig", FREE)
    pg.wait_for_timeout(1300)
    pbF = [c for c in PATCH_CALLS if c["slug"]=="acme"]
    lastF = pbF[-1]["body"]["data"] if pbF else {}
    ck("E0: a freely typed signature becomes data.sig verbatim", str(lastF.get("sig",""))==FREE, lastF.get("sig"))
    artF = pg.evaluate("async()=>{ return await window.__thriveComposeArtifact('acme'); }")
    txtF, htmF = artF.get("text",""), artF.get("html","")
    ck("E0: the typed signature is a separate closing block in the DARKER grey (#595959, not #888888)",
       "#595959" in htmF and "#888888" not in htmF, htmF[-260:])
    ck("E0: the multi-line signature renders with real <br> line breaks",
       "Warm regards,<br>Alice Op" in htmF, htmF[-260:])
    ck("E0: the body still renders verbatim above the typed signature",
       "First paragraph.\n\nSecond paragraph." in txtF and ("<p " in htmF or "<p>" in htmF), htmF[:200])
    ck("E0: the signature is separated from the body by a blank line in the text", ("\n\n"+FREE) in txtF, txtF[-200:])
    ck("E0: preview iframe EQUALS the send html with the typed signature (field-driven parity)",
       pg.evaluate(SRCDOC)==htmF, {"srcdoc_len":len(pg.evaluate(SRCDOC) or ""), "art_len":len(htmF)})
    ck("3: the opp link is a plain tokenized URL in the text (channel 2, clickable in a plain email)",
       "console.thriveiii.com/opp/acme" in txtF and re.search(r"[?&]r=", txtF) is not None, txtF[-200:])
    # PERSONAL MODE (DELIVERABILITY_EVIDENCE): Acme is a standalone 1:1 opp (no data.source==="upload"), so it
    # compiles personal-shaped - NO 1x1 open pixel and NO "Reply STOP"/postal footer. (Campaign shape is proven
    # by personal_mode_test.) The channel-2 tokenized page link above is mode-independent and stays.
    ck("PERSONAL: a 1:1 compose carries NO open pixel (no op=hit, zero <img>)",
       "op=hit" not in htmF and htmF.count("<img")==0, htmF[-260:])
    ck("PERSONAL: a 1:1 compose has NO 'Reply STOP'/postal footer, no logo/table/background",
       "Reply STOP" not in htmF and "Reply STOP" not in txtF and "thrive-logo.png" not in htmF
       and "<table" not in htmF and "background" not in htmF, htmF[:220])

    # E0: "Use my signature" FILLS the field with the 3-line preset, and it stays editable
    pg.evaluate("()=>{ var b=document.getElementById('edSigFill'); if(b) b.click(); }")
    pg.wait_for_timeout(200)
    ck("E0: 'Use my signature' fills the field with name / title / thriveiii.com (three lines)",
       pg.evaluate("()=>document.getElementById('edSig').value")==PRESET, pg.evaluate("()=>document.getElementById('edSig').value"))
    ck("E0: after the preset fill the field is still editable (not locked)",
       pg.evaluate("()=>{var s=document.getElementById('edSig'); return !s.disabled && !s.readOnly;}"))
    pg.wait_for_timeout(1200)   # let the fill save
    pbP = [c for c in PATCH_CALLS if c["slug"]=="acme"]
    lastP = pbP[-1]["body"]["data"] if pbP else {}
    ck("E0: the preset signature persists to data.sig as three lines", str(lastP.get("sig",""))==PRESET, lastP.get("sig"))
    artP = pg.evaluate("async()=>{ return await window.__thriveComposeArtifact('acme'); }")
    htmP = artP.get("html","")
    ck("E0: the preset renders as three lines with <br> between name / title / site",
       (DISPLAY_NAME+"<br>"+TITLE+"<br>thriveiii.com") in htmP, htmP[-300:])

    # ===== PR-A: the body is compiled and sent VERBATIM - no signature-like text is ever removed =====
    bart = pg.evaluate("async()=>{ return await window.__thriveComposeArtifact('baked'); }")
    btx, bhm = bart.get("text",""), bart.get("html","")
    ck("PR-A: the body is sent VERBATIM - the old agency closing is NOT stripped (it remains in text + html)",
       "Old Signoff Name" in btx and "Old Signoff Name" in bhm and "Thrive Digital Solutions" in btx and "Thrive Digital Solutions" in bhm,
       {"text":btx[-260:], "html":bhm[-260:]})
    ck("PR-A: the appended identity signature (the separate data.sig field) still appears EXACTLY ONCE",
       btx.count(SIG)==1 and bhm.count(SIG)==1, {"text":btx.count(SIG), "html":bhm.count(SIG)})
    ck("PR-A: the real body content is intact",
       "Looking forward to your reply." in btx and "Looking forward to your reply." in bhm, btx[:200])

    # 4: pre-send checklist + Send-disable gate
    ck("4: with subject + body present, Send is enabled", pg.evaluate(SEND_DISABLED)==False, pg.evaluate(SEND_DISABLED))
    ck("4: the link check reads present after inserting the token", "ck-ok" in pg.evaluate(CK, "ckLink"), pg.evaluate(CK, "ckLink"))
    ck("4: the recipient check reads present (acme has a recipient)", "ck-ok" in pg.evaluate(CK, "ckRecip"), pg.evaluate(CK, "ckRecip"))
    pg.fill("#edSubj", "")   # clear the subject -> message incomplete
    pg.wait_for_timeout(150)
    ck("4: clearing the subject disables Send (pre-flight)", pg.evaluate(SEND_DISABLED)==True, pg.evaluate(SEND_DISABLED))
    ck("4: the subject check reads missing when empty", "ck-no" in pg.evaluate(CK, "ckSubj"), pg.evaluate(CK, "ckSubj"))

    # persistence across a full reload: the subject/body/SIGNATURE all restore from the persisted record
    pg.wait_for_timeout(1200)   # let the empty-subject edit settle (does not matter what it saved)
    OPPS["acme"]["data"]["outreach_subject"] = "Acme partnership"   # restore a clean persisted record for the reload check
    OPPS["acme"]["data"]["outreach_text"]    = body_after_insert
    OPPS["acme"]["data"]["sig"]              = PRESET
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    pg.evaluate(OPEN, "Acme Co"); pg.wait_for_timeout(500)
    ck("1: after a full reload the saved subject + body are still there",
       pg.evaluate("()=>document.getElementById('edSubj').value")=="Acme partnership" and "{{LINK}}" in pg.evaluate("()=>document.getElementById('edBody').value"))
    ck("E0: after a full reload the Signature FIELD restores the saved value (persisted, not lost)",
       pg.evaluate("()=>document.getElementById('edSig').value")==PRESET, pg.evaluate("()=>document.getElementById('edSig').value"))
    pg.close(); ctx.close()

    # ===== 5: an opp with NO message can be given one from the board, flipping the L5 gate =====
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    pg2.evaluate(OPEN, "Fresh Co"); pg2.wait_for_timeout(500)
    ck("5: the editor renders even when the opp has no prepared message", pg2.evaluate("()=>!!document.getElementById('edSubj')"))
    # UNIFY (c): the recipient field renders in the drawer for an editable card even when has_email is false.
    ck("5c: the recipient field #recIn renders even with no prepared message (ungated from has_email)", pg2.evaluate("()=>!!document.getElementById('recIn')"))
    # UNIFY: Send is now GATED, not hidden. Fresh Co has a recipient but no message, so Send renders DISABLED.
    ck("5: Send renders but is DISABLED before a message exists (gated on subject+body+recipient, not has_email)",
       pg2.evaluate(HAS_SEND) and pg2.evaluate(SEND_DISABLED)==True, {"has":pg2.evaluate(HAS_SEND), "dis":pg2.evaluate(SEND_DISABLED)})
    pg2.fill("#edSubj", "Intro to Fresh")
    pg2.fill("#edBody", "Hello Fresh, see the page.")
    pg2.wait_for_timeout(1600)   # debounce + save + the one board reload that flips has_email
    ck("5: after writing a message (recipient already present), Send ENABLES", pg2.evaluate(HAS_SEND) and pg2.evaluate(SEND_DISABLED)==False,
       {"has":pg2.evaluate(HAS_SEND), "dis":pg2.evaluate(SEND_DISABLED)})
    pg2.close(); ctx2.close()

    # ===== 6: a reply carries the opp slug (Reply-To hi+<slug>) =====
    ctx3 = b.new_context(); wire(ctx3); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(500); wait_ident(pg3)
    pg3.evaluate(OPEN, "Reply Co"); pg3.wait_for_timeout(400)
    rt = pg3.evaluate("()=>window.__thriveReplyTo('reply')")
    ck("6: a reply routes back to the opp slug (Reply-To hi+reply@thriveiii.com), never the campaign",
       rt=="hi+reply@thriveiii.com", rt)
    pg3.close(); ctx3.close()

    # ===== 7: forced write failure -> red, no phantom save =====
    ctx4 = b.new_context(); wire(ctx4); pg4 = ctx4.new_page()
    pg4.goto(f"{base}/library/board.html", wait_until="load"); pg4.wait_for_timeout(500); wait_ident(pg4)
    OPP_FAULT["failw"] = "500"
    before = OPPS["failw"]["data"]["outreach_subject"]
    pg4.evaluate(OPEN, "Failw Co"); pg4.wait_for_timeout(400)
    pg4.fill("#edSubj", "Should not persist")
    pg4.wait_for_timeout(1300)
    ck("7: a forced write failure shows a visible RED status", "bad" in pg4.evaluate(ED_STATUS)["cls"], pg4.evaluate(ED_STATUS))
    ck("7: no phantom save: the record's subject is unchanged", OPPS["failw"]["data"]["outreach_subject"]==before, OPPS["failw"]["data"]["outreach_subject"])
    OPP_FAULT.clear()
    pg4.close(); ctx4.close()

    # ===== 8: AR RTL =====
    ctx5 = b.new_context(); wire(ctx5, lang="ar"); pg5 = ctx5.new_page()
    pg5.goto(f"{base}/library/board.html", wait_until="load"); pg5.wait_for_timeout(500); wait_ident(pg5)
    pg5.evaluate(OPEN, "Reply Co"); pg5.wait_for_timeout(400)
    d = pg5.evaluate("()=>{ var dw=document.getElementById('drawer'); return { dir:getComputedStyle(dw).direction, hasEd:!!document.getElementById('edSubj') }; }")
    ck("8: AR flips the drawer to RTL", d["dir"]=="rtl", d)
    ck("8: the editor renders under AR", d["hasEd"], d)
    pg5.close(); ctx5.close()

    # ===== privacy + no error =====
    blob = json.dumps(PATCH_CALLS) + json.dumps([o["data"] for o in OPPS.values()])
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr and not perr2, (perr, perr2))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-EDITOR CHECKS PASS"))
raise SystemExit(1 if fails else 0)
