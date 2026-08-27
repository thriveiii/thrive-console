"""UNIFIED MESSAGE EDITOR (board.html compose + reply, fails-when-broken, ZERO real network send).

A net-new editing surface in the drawer lets the operator write subject + body for an opp, auto-inserts the
opp link as a merge token, appends the runtime signature (name + functional title from __thriveIdentity),
previews EXACTLY what will send (the same sendCompile the send path uses), and hands the composed content to
the unchanged L5 send. Stateful mock of Supabase REST (never a real send). Assertions:
  1. subject + body edits save to data.outreach_subject / data.outreach_text via oppPatch and persist across
     a full reload; the save never resets the textarea value (undo stack preserved);
  2. the signature written to data.sig is exactly name + ", " + title from identity, and appears in the
     compiled preview identically to what the send payload html carries (preview == send parity);
  3. the opp-link token inserts and tokenizes to console.thriveiii.com/opp/<slug> in the compiled html;
  4. the pre-send checklist tracks subject / body / recipient / link, and Send is disabled until the message
     (subject + body) is present;
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
SIG = DISPLAY_NAME + ", " + TITLE                    # what the editor must build and write to data.sig

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

    ck("2: identity signature is name + title", pg.evaluate("()=>window.__thriveEditorSignature()")==SIG, pg.evaluate("()=>window.__thriveEditorSignature()"))

    pg.evaluate(OPEN, "Acme Co"); pg.wait_for_timeout(500)
    ck("editor: subject + body fields render in the drawer", pg.evaluate("()=>!!(document.getElementById('edSubj')&&document.getElementById('edBody'))"))
    ck("editor: pre-fills the subject from the record", pg.evaluate("()=>document.getElementById('edSubj').value")=="Acme x Thrive")

    # edit subject + body (with a real paragraph break), insert the opp link, let the debounced save land
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
    ck("2: the signature written to data.sig is exactly name + title", last.get("sig")==SIG, last.get("sig"))

    # preview == send parity, PLAIN direction: the persisted-record compile (what runSend uses) is the plain
    # message, and the preview iframe shows byte-identical html
    art = pg.evaluate("async()=>{ return await window.__thriveComposeArtifact('acme'); }")
    txt, htm = art.get("text",""), art.get("html","")
    ck("PLAIN: the sent TEXT preserves the paragraph break (newlines not collapsed)",
       "First paragraph.\n\nSecond paragraph." in txt, txt[:300])
    ck("PLAIN: the signature is separated from the body by a blank line in the text",
       ("\n\n"+SIG) in txt, txt[-200:])
    ck("2: the compiled preview carries the exact signature (preview == send)", SIG in htm and SIG in txt, htm[:200])
    ck("3: the opp link is a plain tokenized URL in the text (channel 2, clickable in a plain email)",
       "console.thriveiii.com/opp/acme" in txt and re.search(r"[?&]r=", txt) is not None, txt[-200:])
    ck("PLAIN: the html is the minimal text-preserving form (pre-wrap), never heavy brandWrap or a pixel",
       "white-space:pre-wrap" in htm and "<img" not in htm and "op=hit" not in htm and "thrive-logo.png" not in htm, htm[:200])
    ck("2: the preview iframe html EQUALS the send payload html (no false-success gap, plain direction)",
       pg.evaluate(SRCDOC)==htm, {"srcdoc_len":len(pg.evaluate(SRCDOC) or ""), "art_len":len(htm)})

    # 4: pre-send checklist + Send-disable gate
    ck("4: with subject + body present, Send is enabled", pg.evaluate(SEND_DISABLED)==False, pg.evaluate(SEND_DISABLED))
    ck("4: the link check reads present after inserting the token", "ck-ok" in pg.evaluate(CK, "ckLink"), pg.evaluate(CK, "ckLink"))
    ck("4: the recipient check reads present (acme has a recipient)", "ck-ok" in pg.evaluate(CK, "ckRecip"), pg.evaluate(CK, "ckRecip"))
    pg.fill("#edSubj", "")   # clear the subject -> message incomplete
    pg.wait_for_timeout(150)
    ck("4: clearing the subject disables Send (pre-flight)", pg.evaluate(SEND_DISABLED)==True, pg.evaluate(SEND_DISABLED))
    ck("4: the subject check reads missing when empty", "ck-no" in pg.evaluate(CK, "ckSubj"), pg.evaluate(CK, "ckSubj"))

    # persistence across a full reload
    pg.wait_for_timeout(1200)   # let the empty-subject edit settle (does not matter what it saved)
    OPPS["acme"]["data"]["outreach_subject"] = "Acme partnership"   # restore a clean persisted subject for the reload check
    OPPS["acme"]["data"]["outreach_text"]    = body_after_insert
    OPPS["acme"]["data"]["sig"]              = SIG
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    pg.evaluate(OPEN, "Acme Co"); pg.wait_for_timeout(500)
    ck("1: after a full reload the saved subject + body are still there",
       pg.evaluate("()=>document.getElementById('edSubj').value")=="Acme partnership" and "{{LINK}}" in pg.evaluate("()=>document.getElementById('edBody').value"))
    pg.close(); ctx.close()

    # ===== 5: an opp with NO message can be given one from the board, flipping the L5 gate =====
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    pg2.evaluate(OPEN, "Fresh Co"); pg2.wait_for_timeout(500)
    ck("5: the editor renders even when the opp has no prepared message", pg2.evaluate("()=>!!document.getElementById('edSubj')"))
    ck("5: Send is absent before a message exists (no has_email)", not pg2.evaluate(HAS_SEND))
    pg2.fill("#edSubj", "Intro to Fresh")
    pg2.fill("#edBody", "Hello Fresh, see the page.")
    pg2.wait_for_timeout(1600)   # debounce + save + the one board reload that flips has_email
    ck("5: after writing a message, Send appears (the no-message gate is now satisfiable)", pg2.evaluate(HAS_SEND))
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
