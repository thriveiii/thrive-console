"""MOBILE-FIRST (board.html): on a phone the console is a clean, one-handed app, not a shrunken desktop page.

Device-proven at iPhone portrait (390x844). Asserts:
  1. THE BOARD swipes - .lanes lays out as a horizontal flex (scroll-snap), each lane near-full-width and
     legible, NOT a shrunken multi-column grid.
  2. THE CONTROL ROOM preview is tall + un-clipped (#edPreview is a large iframe, not the old 220px window).
  3. THE SEND button is reachable one-handed - the sticky .compose-send pins #nmSend inside the viewport
     without scrolling.
  4. Safe-area insets are respected (env(safe-area-inset-*) in the shipped CSS; the sheet uses 100dvh).
  5. DESKTOP stays clean - at a wide viewport .lanes is a multi-column grid (responsive, not phone-only).

FAILS-WHEN-BROKEN: the phone control-room preview is clipped (short iframe) OR the Send button is off-screen
(not sticky) OR the board is a shrunken desktop grid on the phone -> fails.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

SLUG = "alpha"
OPPS = { SLUG: {"slug":SLUG,"business":"Alpha Co","stage":"draft","archived":False,
                "data":{"outreach_subject":"A partnership for Alpha Co","outreach_text":"Hi there, we would love to work with you on this and share a page we made.",
                        "recipients":[{"addr":"sarah@bards-alley.example","name":""}]}} }
def board_rows():
    return [
      {"slug":SLUG,"business":"Alpha Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":True,"has_email":True,"archived":False},
      {"slug":"beta","business":"Beta LLC","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":True,"has_email":True,"archived":False},
      {"slug":"gamma","business":"Gamma Inc","stage":"sent","sent_count":2,"open_count":1,"replied":False,"idle_days":1,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":False,"has_email":True,"archived":False},
    ]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_opps(r):
    m=re.search(r'slug=eq\.([^&]+)', r.request.url); sl=m.group(1) if m else ""
    o=OPPS.get(sl); return J(r, [{"slug":sl,"archived_at":None,"archived_from":None,"data":(o or {}).get("data",{})}] if o else [])
def route_pages(r):
    if "select=html" in r.request.url: return J(r, [{"html":"<h1>x</h1>"}])
    if "select=title" in r.request.url: return J(r, [{"title":"T"}])
    return J(r, [])
def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    for t in ["console_mail","console_hits","console_inbound","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins"]:
        ctx.route(f"**/rest/v1/{t}**", route_empty)

# ===== source guard: safe-area + dvh in the shipped CSS =====
board_src = open(f"{ROOT}/library/board.html").read()
ck("4: safe-area insets are in the shipped CSS (notch/home-bar aware)", "env(safe-area-inset-top" in board_src and "env(safe-area-inset-bottom" in board_src)
ck("4: the opp sheet uses the dynamic viewport height (100dvh) on phone", "100dvh" in board_src)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ============ PHONE (iPhone portrait) ============
    ctx = b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True)
    wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(800)
    pg.wait_for_selector(".lane", timeout=8000)

    # 1: the board swipes, not a shrunken grid
    lanes = pg.evaluate("""()=>{
      var el=document.querySelector('.lanes'); var lane=document.querySelector('.lane');
      return { display:getComputedStyle(el).display, overflowX:getComputedStyle(el).overflowX,
               laneW:lane?Math.round(lane.getBoundingClientRect().width):0, vw:window.innerWidth,
               scrollable: el.scrollWidth > el.clientWidth + 4 };
    }""")
    ck("1: on phone the board is a horizontal flex (swipeable), not a grid", lanes["display"]=="flex", lanes)
    ck("1: a lane is near-full-width and legible, not shrunk", lanes["laneW"] > 0.6*lanes["vw"], lanes)
    ck("1: the lanes strip is horizontally scrollable (swipe between columns)", lanes["scrollable"], lanes)

    # 1b: the PAGE itself does not overflow horizontally - only .lanes scrolls. If the swipe-strip's off-screen
    # columns widen the document, the phone shrink-to-fits and zooms the WHOLE page: the layout viewport jumps
    # from the 390px device width to ~490px, clipping the control-room sheet at the right edge. The signal is
    # window.innerWidth - under shrink-to-fit BOTH it and scrollWidth inflate to 490 together, so we assert the
    # layout viewport stayed at the configured 390px device width (not that docW<=innerWidth, which is trivially
    # true once both have inflated).
    doc = pg.evaluate("""()=>({vw:window.innerWidth, docW:document.documentElement.scrollWidth, bodyW:document.body.scrollWidth})""")
    ck("1: the page does not overflow (layout viewport stays 390px, no shrink-to-fit zoom; only .lanes scrolls)",
       doc["vw"] <= 391 and doc["docW"] <= 391 and doc["bodyW"] <= 391, doc)

    # 2 + 3: the control room - un-clipped preview + a reachable (sticky) Send
    pg.evaluate("(s)=>window.openOppWindow(s,'detail')", SLUG)
    pg.wait_for_selector("#crMsgPanel #edPreview", timeout=6000)
    pg.wait_for_function("()=>{var s=document.getElementById('edSubj');return s&&s.value;}", timeout=6000)
    pg.wait_for_timeout(400)
    prev = pg.evaluate("()=>{var f=document.getElementById('edPreview');var r=f.getBoundingClientRect();return {h:Math.round(r.height)};}")
    ck("2: the message preview is TALL and un-clipped on phone (a large iframe, not the old 220px window)",
       prev["h"] >= 320, prev)
    send = pg.evaluate("""()=>{
      var b=document.getElementById('nmSend'); if(!b) return {found:false};
      var r=b.getBoundingClientRect();
      return { found:true, top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height),
               vh:window.innerHeight, sticky:getComputedStyle(b.closest('.compose-send')||b).position };
    }""")
    ck("3: the Send button exists on the MESSAGE gate", send.get("found") and send.get("h",0) > 0, send)
    ck("3: the Send button is reachable one-handed WITHOUT scrolling (pinned inside the viewport)",
       send.get("found") and send["top"] >= 0 and send["bottom"] <= send["vh"] + 2, send)
    ck("3: the Send bar is sticky on phone", send.get("sticky")=="sticky", send)
    # 2b: the control-room sheet fills the viewport and is NOT clipped at the right edge (the shrink-to-fit symptom)
    sheet = pg.evaluate("""()=>{var o=document.querySelector('.ow');var r=o.getBoundingClientRect();
        return {right:Math.round(r.right), width:Math.round(r.width), vw:window.innerWidth};}""")
    ck("2: the control-room sheet fills the 390px device viewport, not clipped at the right edge",
       sheet["vw"] <= 391 and sheet["right"] <= 391 and sheet["width"] >= 388, sheet)
    ck("no uncaught page error on phone", len(perr)==0, perr)
    pg.close(); ctx.close()

    # ============ DESKTOP (stays a clean multi-column grid) ============
    ctx2 = b.new_context(viewport={"width":1280,"height":900}); wire(ctx2)
    pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(800)
    pg2.wait_for_selector(".lane", timeout=8000)
    disp = pg2.evaluate("()=>getComputedStyle(document.querySelector('.lanes')).display")
    ck("5: on desktop the board stays a multi-column grid (responsive, not phone-only)", disp=="grid", disp)
    pg2.close(); ctx2.close()

    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL MOBILE-FIRST CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
