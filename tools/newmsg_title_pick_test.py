"""NEW MESSAGE: readable window title (A) + Library pick shows the editor only AFTER a template is chosen (B).

Asserts (each fails-when-broken):
  (A) a fresh New message header reads "New message" (never a raw msg-... slug); it follows the subject once
      typed; an existing card opened from the board still shows its real title.
  (B) in the pick entry, ONLY the Library search + list show first: the compose editor (#edSubj) is NOT in the
      DOM and the review/commit are hidden until a template is picked; after a pick they appear. Upload and text
      modes are unaffected (the editor is present up front).
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

BOARD=[{"slug":"bards-alley","business":"Bards Alley Books","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False}]
PAGES=[{"slug":"alpha-page","title":"Alpha partnership page","task":"","live_verified_at":"2026-01-01T00:00:00Z","up":"2026-02-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z"}]
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def route_pages(r):
    u=r.request.url
    if "select=html" in u: return J(r, [{"html":"<div style='padding:24px'><h1>Alpha</h1></div>"}])
    if "select=title" in u: return J(r, [{"title":"Alpha partnership page"}])
    if "select=slug,title" in u: return J(r, PAGES)
    return J(r, PAGES)
def route_opps(r):
    m=re.search(r'slug=eq\.([^&]+)', r.request.url); sl=m.group(1) if m else ""
    return J(r, [{"slug":sl,"data":{},"archived_at":None,"archived_from":None}])
def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    for tn in ["console_mail","console_hits","console_inbound","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1024,"height":820}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='bards-alley']", timeout=8000)

    # ===== (A) title =====
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000); pg.wait_for_timeout(150)
    title0=pg.evaluate("()=>window.__thriveOwTitle()")
    ck("(A) a fresh New message header is 'New message', never a msg-... slug",
       (not title0.startswith("msg-")) and title0.strip()!="" and title0.strip().lower()=="new message", repr(title0))
    pg.evaluate("()=>window.owSelectMode('a')"); pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    pg.fill("#edSubj", "A partnership for Bards Alley"); pg.wait_for_timeout(300)
    titleS=pg.evaluate("()=>window.__thriveOwTitle()")
    ck("(A) the header follows the subject once typed", titleS.strip()=="A partnership for Bards Alley" and not titleS.startswith("msg-"), repr(titleS))
    # existing card keeps its real title
    pg.evaluate("()=>window.closeOppWindow()")
    pg.evaluate("(s)=>window.openOppWindow(s,'detail')", "bards-alley"); pg.wait_for_timeout(400)
    titleE=pg.evaluate("()=>window.__thriveOwTitle()")
    ck("(A) an existing card still shows its real title (no regression)", titleE.strip()=="Bards Alley Books", repr(titleE))
    ck("(A) the raw slug is never shown as the header", not titleE.startswith("msg-"), repr(titleE))
    pg.evaluate("()=>window.closeOppWindow()")

    # ===== (B) pick order =====
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.evaluate("()=>window.owSelectMode('pick')")
    pg.wait_for_selector("#owPickList", timeout=6000)
    pg.wait_for_function("()=>document.querySelectorAll('#owPickList [data-ow-pick]').length>0", timeout=6000); pg.wait_for_timeout(150)
    before=pg.evaluate("""()=>({
        list: !!document.getElementById('owPickList'),
        editor: !!document.getElementById('edSubj'),
        reviewHidden: (function(){var e=document.getElementById('owPageReview'); return !e || e.hasAttribute('hidden');})(),
        msgHidden: (function(){var e=document.getElementById('owMsgPanel'); return !e || e.hasAttribute('hidden');})(),
        footHidden: (function(){var e=document.getElementById('owDirectFoot'); return !e || e.hasAttribute('hidden');})()
    })""")
    ck("(B) pick shows the Library list first", before["list"], before)
    ck("(B) the compose editor is NOT in the DOM before a template is picked", not before["editor"], before)
    ck("(B) the review + commit are hidden before a pick", before["reviewHidden"] and before["msgHidden"] and before["footHidden"], before)
    # pick a template (Use)
    pg.evaluate("""()=>{ var b=document.querySelector('#owPickList [data-ow-pick]'); if(b) b.click(); }""")
    pg.wait_for_selector("#owMsgPanel #edSubj", timeout=6000); pg.wait_for_timeout(200)
    after=pg.evaluate("""()=>({
        editor: !!document.getElementById('edSubj'),
        reviewShown: (function(){var e=document.getElementById('owPageReview'); return !!e && !e.hasAttribute('hidden');})(),
        acc: document.querySelectorAll('.ow-acc').length,
        footShown: (function(){var e=document.getElementById('owDirectFoot'); return !!e && !e.hasAttribute('hidden');})()
    })""")
    ck("(B) after a pick, the editor appears", after["editor"], after)
    ck("(B) after a pick, the review (accordion) + commit are revealed", after["reviewShown"] and after["acc"]>=1 and after["footShown"], after)
    pg.evaluate("()=>window.closeOppWindow()")

    # upload + text modes unaffected (editor present up front)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.evaluate("()=>window.owSelectMode('upload')")
    pg.wait_for_selector("#owMsgPanel #edSubj", timeout=6000)
    ck("(B) UPLOAD mode is unaffected (editor present up front)", pg.evaluate("()=>!!document.getElementById('edSubj')"))
    pg.evaluate("()=>window.closeOppWindow()")
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.evaluate("()=>window.owSelectMode('a')")
    pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    ck("(B) TEXT mode is unaffected (editor present up front)", pg.evaluate("()=>!!document.getElementById('edSubj')"))
    ck("no uncaught page error", len(perr)==0, perr)
    pg.close(); ctx.close(); b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL NEWMSG-TITLE-PICK CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
