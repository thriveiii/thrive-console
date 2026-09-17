"""G4.5 - the Details view (the drawer's detail/management half) inside #oppWindow (board.html).

Detail-first: a card tap opens the window on Details for that opp. This drives the REAL Details view via the
exposed window.openOppWindow(slug, "detail") seam (the same call the flipped card tap will make; OPP_WINDOW
stays OFF in the shipped build). Proves the window now covers the drawer's lower half, reusing the SAME
functions/handlers by reference (no fork):
  - the sections render: signals (dw-nums), the reply thread (the heart, from the one resolver), the record,
    notes (list + add form), and the activity timeline;
  - fate actions are present and correct for the stage (a draft shows Promote/Archive/Delete), and there is NO
    Send button (composing is a mode you enter, not a Details action);
  - add-note writes through the existing onAddNote -> console_opps PATCH (notes grow);
  - Promote writes approved_at through the existing onAction/runOppWrite;
  - Archive writes archived=true through the same path;
  - Delete is a two-tap confirm through the existing runOppDelete -> console_opps DELETE, and a deleted row
    closes the window.
No email is sent. All addresses are synthetic *.example.test.

FAILS-WHEN-BROKEN: reverting owDetailWire (board's window Details wiring) so the fate buttons are not wired
makes the Archive/Delete write assertions fail (proven by revert).
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
        if d is not None: print("      " + str(d)[:500])

SLUG = "alpha"
OPPS = { SLUG: {"slug":SLUG, "business":"Alpha Co", "stage":"draft", "archived":False,
                "data":{"recipients":[{"addr":"buyer@ex.example","name":"Buyer"}],
                        "notes":[{"ts":"2026-08-01T09:00:00Z","text":"first note","by":"u"}]}} }
MAIL = [{"id":"m1","opp":SLUG,"to_addr":"buyer@ex.example","status":"sent","ts":"2026-08-01T10:00:00Z","data":{"direction":"out","subject":"Hello"}}]
HITS = [{"id":"h1","slug":SLUG,"ts":"2026-08-02T10:00:00Z","self":False,"data":{"type":"open","r":"m1"}}]
INBOUND = [{"id":"i1","opp":SLUG,"kind":"reply","bounce":"","ts":"2026-08-03T09:00:00Z","data":{"from":"buyer@ex.example","subject":"Re: Hello","snippet":"sounds great"}}]
PATCH_WRITES, DELETE_WRITES = [], []

def board_rows():
    out=[]
    for o in OPPS.values():
        out.append({"slug":o["slug"],"business":o["business"],"stage":o.get("stage",""),"sent_count":1,"open_count":1,
          "replied":True,"idle_days":0,"last_activity_ts":"2026-08-03T09:00:00Z","has_page":False,
          "has_email":True,"archived":bool(o.get("archived"))})
    return out
def slug_eq(url):
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

def J(route, obj, status=200): route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_opps(r):
    req=r.request; url=req.url; sl=slug_eq(url)
    if req.method=="PATCH":
        try: patch=json.loads(req.post_data or "{}")
        except Exception: patch={}
        PATCH_WRITES.append({"slug":sl,"patch":patch})
        o=OPPS.get(sl)
        if o:
            if "data" in patch and isinstance(patch["data"],dict): o["data"]=patch["data"]
            if patch.get("approved_at"): o["stage"]="live"
            if patch.get("archived") is True: o["archived"]=True
        return r.fulfill(status=204, body="")
    if req.method=="DELETE":
        DELETE_WRITES.append(sl); OPPS.pop(sl, None)
        return r.fulfill(status=204, body="")
    o=OPPS.get(sl)
    return J(r, [{"slug":sl,"archived_at":None,"archived_from":None,"data":(o or {}).get("data",{})}] if o else [])
def route_mail(r): J(r, MAIL)
def route_hits(r): J(r, HITS)
def route_inbound(r): J(r, INBOUND)

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_hits)
    ctx.route("**/rest/v1/console_inbound**", route_inbound)
    ctx.route("**/rest/v1/console_pages**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_empty)

def open_detail(pg):
    pg.evaluate("(s)=>window.openOppWindow(s,'detail')", SLUG)
    pg.wait_for_selector("#owDetail .dw-sec", timeout=6000); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.on("dialog", lambda d: d.accept(""))                     # promote's approve-note prompt -> "" (proceed, no note)
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # ===== 1: the Details view renders the drawer's lower-half sections =====
    open_detail(pg)
    ck("window open on Details (#owDetail present), drawer stays hidden",
       pg.evaluate("()=>({d:!!document.getElementById('owDetail'), dw:!document.getElementById('scrim'), ow:!document.getElementById('owScrim').hidden})")=={"d":True,"dw":True,"ow":True})
    ck("signals section renders (dw-nums)", pg.evaluate("()=>!!document.querySelector('#owDetail .dw-nums')"))
    ck("the reply thread (the heart) shows the inbound reply", pg.evaluate("()=>{var m=document.querySelector('#owDetail .thread .msg.in'); return !!(m && m.textContent.indexOf('sounds great')>=0);}"),
       pg.evaluate("()=>{var t=document.querySelector('#owDetail .thread'); return t?t.textContent.slice(0,120):'no thread';}"))
    ck("the activity timeline renders (.log)", pg.evaluate("()=>!!document.querySelector('#owDetail .log')"))
    ck("notes: the existing note shows + the add-note form is present", pg.evaluate("()=>{var n=document.querySelector('#owDetail .notes-list'); return !!(n && n.textContent.indexOf('first note')>=0) && !!document.getElementById('noteIn') && !!document.getElementById('noteAdd');}"))

    # ===== 2: fate actions present + correct for a draft, and NO Send =====
    acts = pg.evaluate("()=>Array.prototype.map.call(document.querySelectorAll('#owDetail .act[data-act]'), function(b){return b.getAttribute('data-act');})")
    ck("a draft shows Promote/Archive/Delete", ("promote" in acts and "archive" in acts and "delete" in acts), acts)
    ck("NO Send button in the Details view (composing is a mode, not a Details action)", "send" not in acts, acts)

    # ===== 3: add a note -> console_opps PATCH through the existing onAddNote =====
    del PATCH_WRITES[:]
    pg.fill("#owDetail #noteIn", "second note from the window")
    pg.click("#owDetail #noteAdd"); pg.wait_for_timeout(900)
    note_patch = [w for w in PATCH_WRITES if isinstance((w.get("patch") or {}).get("data"), dict) and len(((w["patch"]["data"]).get("notes") or []))>=2]
    ck("add-note wrote console_opps with the note appended (onAddNote reused)", len(note_patch)>=1, PATCH_WRITES)

    # ===== 4: Promote writes approved_at through onAction/runOppWrite =====
    del PATCH_WRITES[:]
    pg.click("#owDetail .act[data-act='promote']"); pg.wait_for_timeout(1000)
    ck("Promote wrote approved_at (the shared approval write)", any((w.get("patch") or {}).get("approved_at") for w in PATCH_WRITES), PATCH_WRITES)

    # ===== 5: Archive writes archived=true =====
    del PATCH_WRITES[:]
    open_detail(pg)                                            # re-open fresh (row now live)
    pg.click("#owDetail .act[data-act='archive']"); pg.wait_for_timeout(1000)
    ck("Archive wrote archived=true (the shared fate write)", any((w.get("patch") or {}).get("archived") is True for w in PATCH_WRITES), PATCH_WRITES)

    # ===== 6: Delete is a two-tap confirm -> DELETE, and a deleted row closes the window =====
    del DELETE_WRITES[:]
    open_detail(pg)
    pg.click("#owDetail .act[data-act='delete']"); pg.wait_for_timeout(400)
    ck("first delete tap ARMS the confirm (delete_go appears), nothing deleted yet",
       pg.evaluate("()=>!!document.querySelector(\"#owDetail .act[data-act='delete_go']\")") and len(DELETE_WRITES)==0)
    pg.click("#owDetail .act[data-act='delete_go']"); pg.wait_for_timeout(1000)
    ck("delete_go issued console_opps DELETE (runOppDelete reused)", DELETE_WRITES==[SLUG], DELETE_WRITES)
    ck("a deleted row closes the window (owScrim hidden)", pg.evaluate("()=>document.getElementById('owScrim').hidden")==True)

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL OPP-WINDOW-DETAIL CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
