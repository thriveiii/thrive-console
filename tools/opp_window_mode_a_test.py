"""G2 - Mode A ("message without campaign") inside the centered window (board.html).

Drives the REAL window Mode A (forced open via the exposed window.openOppWindow + window.owSelectMode; the
OPP_WINDOW flag stays OFF in the shipped build, so this bypasses it exactly as the device test would). Proves:
  - Mode A mounts the SHARED compose nodes (#edSubj/#edBody/#recIn/#edSig/#edPreview/#nmSend) INSIDE the window
    (#owModeA), with exactly ONE #edSubj in the DOM (no second editor);
  - the exact-send preview renders and reflects the body; Send is gated until subject+body+recipient;
  - a normal send goes out through the SAME path (runSend -> relay), one console_mail row;
  - B2 intact: a suppressed recipient is refused (no relay call); an unreadable suppression list HALTS the send
    (fail-closed, no relay call);
  - with the flag OFF, a card tap still opens the DRAWER compose unchanged.
NO email is ever sent: the relay is intercepted. All addresses are synthetic *.example.test.
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

def mkopp(slug, biz, addr):
    return {"slug":slug, "business":biz, "has_email":True, "archived":False,
            "data":{"recipients":([{"addr":addr,"name":"Buyer"}] if addr else []),
                    "outreach_subject":"{{BIZ}} x Thrive", "outreach_text":"Hi {{NAME}}, see {{LINK}} for "+biz+"."}}
OPPS = {"alpha": mkopp("alpha","Alpha Co","buyer.alpha@example.test")}
MAIL, RELAY_CALLS, ORDER = [], [], []
SUPP = {"rows": [], "fault": False}     # console_suppressions: rows to return, and a 500-fault switch (fail-closed test)

def sent_count(slug): return sum(1 for m in MAIL if m.get("opp")==slug)
def board_rows():
    out=[]
    for o in OPPS.values():
        sc=sent_count(o["slug"]); stage="sent" if sc>0 else ("live" if o.get("has_email") else "draft")
        out.append({"slug":o["slug"],"business":o["business"],"stage":stage,"sent_count":sc,"open_count":0,
          "replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":False,
          "has_email":bool(o.get("has_email")),"archived":bool(o.get("archived"))})
    return out
def slug_of(url):
    m=re.search(r'eq\.([^&]+)', url); return m.group(1) if m else ""
def slug_of_payload(body):
    try: return (json.loads(body) or {}).get("slug","")
    except Exception: return ""

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
    o=OPPS.get(slug_of(r.request.url), {"slug":"","data":{}}); J(r, [{"slug":o["slug"],"data":o.get("data",{})}])
def route_mail(r):
    req=r.request
    if req.method=="POST":
        try: rows=json.loads(req.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]):
            if isinstance(row,dict) and row.get("opp"): MAIL.append(row); ORDER.append("mail")
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_suppressions(r):
    if SUPP["fault"]: return J(r, {"message":"suppression read boom"}, status=500)   # fail-closed trigger
    return J(r, [{"email":e} for e in SUPP["rows"]])
def route_relay(r):
    body=r.request.post_data or ""; slug=slug_of_payload(body); ORDER.append("relay")
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True,"id":"resend_"+slug,"relay_version":5,"delivered":True})

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_suppressions)

def open_mode_a(pg, slug):
    pg.evaluate("(s)=>window.openOppWindow(s)", slug)
    pg.evaluate("()=>window.owSelectMode('a')")
    pg.wait_for_selector("#owModeA #edSubj", timeout=6000); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # ===== 1: Mode A mounts the SHARED compose inside the window, no duplicate editor =====
    open_mode_a(pg, "alpha")
    ck("window is open (owScrim shown), drawer stays hidden", pg.evaluate("()=>({ow:!document.getElementById('owScrim').hidden, dw:document.getElementById('scrim').hidden})")=={"ow":True,"dw":True})
    ck("Mode A mounts subject/body/recipient/signature/preview/send inside #owModeA",
       pg.evaluate("()=>{var m=document.getElementById('owModeA'); return !!(m&&m.querySelector('#edSubj')&&m.querySelector('#edBody')&&m.querySelector('#recIn')&&m.querySelector('#edSig')&&m.querySelector('#edPreview')&&m.querySelector('#nmSend'));}"))
    ck("exactly ONE #edSubj in the DOM (shared editor by reference, no second copy)", pg.evaluate("()=>document.querySelectorAll('#edSubj').length")==1, pg.evaluate("()=>document.querySelectorAll('#edSubj').length"))
    ck("no tab strip in Mode A (lean path)", pg.evaluate("()=>document.getElementById('owTabs').hidden")==True)
    ck("Mode A prefilled the subject from the record", pg.evaluate("()=>document.getElementById('edSubj').value")=="{{BIZ}} x Thrive", pg.evaluate("()=>document.getElementById('edSubj').value"))

    # ===== 2: exact-send preview renders + reflects the body =====
    srcdoc = pg.evaluate("()=>document.querySelector('#owModeA #edPreview').getAttribute('srcdoc')||''")
    ck("the exact-send preview (#edPreview) is non-empty", len(srcdoc)>0, srcdoc[:80])
    pg.fill("#owModeA #edBody", "Eid Mubarak from Thrive, wishing you a great season.")
    pg.eval_on_selector("#owModeA #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(500)
    srcdoc2 = pg.evaluate("()=>document.querySelector('#owModeA #edPreview').getAttribute('srcdoc')||''")
    ck("typing updates the preview (reflects the new body)", "Eid Mubarak from Thrive" in srcdoc2, srcdoc2[:160])

    # ===== 3: Send gate =====
    ck("Send is ENABLED with subject+body+recipient", pg.evaluate("()=>document.getElementById('nmSend').disabled")==False)
    pg.fill("#owModeA #edBody", "")
    pg.eval_on_selector("#owModeA #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(300)
    ck("Send is DISABLED when the body is empty (gate holds)", pg.evaluate("()=>document.getElementById('nmSend').disabled")==True)
    pg.fill("#owModeA #edBody", "Hello, a quick note about {{LINK}}.")
    pg.eval_on_selector("#owModeA #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(400)

    # ===== 4: a normal send goes out via the SAME path (one relay call, one mail row) =====
    SUPP["rows"]=[]; SUPP["fault"]=False
    del RELAY_CALLS[:]; del MAIL[:]; del ORDER[:]
    pg.click("#owModeA #nmSend"); pg.wait_for_timeout(1200)
    ck("a normal send called the relay once for alpha", len(RELAY_CALLS)==1 and RELAY_CALLS[0].get("slug")=="alpha", RELAY_CALLS)
    ck("a normal send wrote one console_mail row (same runSend path)", sent_count("alpha")==1, MAIL)
    ck("the result shows in the window status (#nmStatus), not the drawer", pg.evaluate("()=>{var e=document.getElementById('nmStatus'); return !!e && e.textContent.length>0;}"))

    # ===== 5: B2 - a suppressed recipient is refused, NO relay call =====
    # The suppression set is loaded once per board load (B2), so set it then RELOAD so the fresh load reads it.
    SUPP["rows"]=["buyer.alpha@example.test"]; SUPP["fault"]=False
    del RELAY_CALLS[:]; del MAIL[:]; del ORDER[:]
    pg.reload(wait_until="load"); pg.wait_for_timeout(700); pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)
    open_mode_a(pg, "alpha")
    pg.click("#owModeA #nmSend"); pg.wait_for_timeout(1200)
    ck("B2: a suppressed recipient is NOT sent to (zero relay calls)", len(RELAY_CALLS)==0, RELAY_CALLS)
    ck("B2: no console_mail row for a fully-suppressed send", sent_count("alpha")==0, MAIL)

    # ===== 6: B2 fail-closed - an unreadable suppression list HALTS the send =====
    SUPP["rows"]=[]; SUPP["fault"]=True
    del RELAY_CALLS[:]; del MAIL[:]; del ORDER[:]
    pg.reload(wait_until="load"); pg.wait_for_timeout(700); pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)
    open_mode_a(pg, "alpha")
    pg.click("#owModeA #nmSend"); pg.wait_for_timeout(1200)
    ck("B2 fail-closed: an unreadable suppression list halts the send (zero relay calls)", len(RELAY_CALLS)==0, RELAY_CALLS)
    ck("B2 fail-closed: no console_mail row when the list is unreadable", sent_count("alpha")==0, MAIL)

    # ===== 7: flag OFF - the drawer compose still works unchanged =====
    SUPP["fault"]=False; SUPP["rows"]=[]
    pg.evaluate("()=>window.closeOppWindow()")
    pg.wait_for_timeout(200)
    pg.evaluate("()=>{var c=document.querySelector('.card[data-slug=\"alpha\"]'); if(c) c.click();}")   # flag off -> drawer
    pg.wait_for_timeout(500)
    ck("with OPP_WINDOW off, a card tap opens the DRAWER (not the window)", pg.evaluate("()=>({dw:!document.getElementById('scrim').hidden, ow:document.getElementById('owScrim').hidden})")=={"dw":True,"ow":True})
    ck("the drawer's own compose still mounts #edSubj (unchanged)", pg.evaluate("()=>!!document.querySelector('#drawer #edSubj')"))

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL OPP-WINDOW-MODE-A CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
