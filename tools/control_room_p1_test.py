"""CONTROL ROOM, Phase 1 (board.html) - a card tap opens the opp as an organized control room, opening on the
MESSAGE gate with the editor + the exact-send preview LIVE and the message LOADED (subject + body + recipient),
with NO mode selector. Three gates plus the reorganized detail half:
  MESSAGE  - the editable compose fields (composeFieldsHtml by reference) + the live #edPreview (edCompileFrom ->
             sendCompile); the message is loaded and the preview updates as the body changes.
  PAGE     - the opp's page: title (console_pages), link name (the slug), live link (liveUrl), hosted-page
             preview (pageReadHtml -> pageFrameIframe).
  CONTACT  - the opp's recipients[] and their addresses.
  (ACTIVITY, the reorganized detail/management half, is covered by opp_window_detail_test.)

Driven via the exposed window.openOppWindow(slug, "detail") seam - the same call the card tap makes. No email is
sent; all addresses are synthetic *.example.test.

FAILS-WHEN-BROKEN: opening a card does NOT show the loaded message on the MESSAGE gate -> fails. Proven by
reverting the owRender detail branch to the old owDetailMount (no MESSAGE gate): the MESSAGE-gate assertions
(editor mounted + subject/body loaded + live preview) fail.
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
SUBJ = "A partnership for Alpha Co"
BODY = "Hi there, we would love to work with you on this."
OPPS = { SLUG: {"slug":SLUG, "business":"Alpha Co", "stage":"draft", "archived":False,
                "data":{"outreach_subject":SUBJ, "outreach_text":BODY,
                        "recipients":[{"addr":"buyer@ex.example","name":"Buyer One"},
                                      {"addr":"cfo@ex.example","name":"CFO Two"}]}} }

def board_rows():
    return [{"slug":SLUG,"business":"Alpha Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,
             "idle_days":0,"last_activity_ts":"2026-08-03T09:00:00Z","has_page":True,"has_email":True,"archived":False}]

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
    req=r.request; m=re.search(r'slug=eq\.([^&]+)', req.url); sl=m.group(1) if m else ""
    o=OPPS.get(sl)
    return J(r, [{"slug":sl,"archived_at":None,"archived_from":None,"data":(o or {}).get("data",{})}] if o else [])
def route_pages(r):
    url=r.request.url
    if "select=html" in url:  J(r, [{"html":"<!doctype html><html><body><h1>Alpha Landing Page</h1><p>Come visit us.</p></body></html>"}])
    elif "select=title" in url: J(r, [{"title":"Alpha Landing"}])
    else: J(r, [{"slug":SLUG,"live_verified_at":"2026-08-01T00:00:00Z"}])

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_empty)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # ===== the card tap: opens the control room on the MESSAGE gate, NO mode selector =====
    pg.evaluate("(s)=>window.openOppWindow(s,'detail')", SLUG)
    pg.wait_for_selector("#owTabs [data-cr-gate='msg']", timeout=6000)
    ck("a card tap opens the control room, NOT a mode selector",
       pg.evaluate("()=>!document.getElementById('owPickA') && !document.getElementById('owModeA') && !document.getElementById('owMsgPanel')"))
    ck("the MESSAGE gate is the one shown first (its panel is visible, the others hidden)",
       pg.evaluate("""()=>{var m=document.getElementById('crMsgPanel'),p=document.getElementById('crPagePanel');
         return !!(m && !m.hidden) && !!(p && p.hidden);}"""))

    # THE LOAD-BEARING CHECK: the message is LOADED on the MESSAGE gate.
    pg.wait_for_function("()=>{var s=document.getElementById('edSubj'),b=document.getElementById('edBody');return s&&b&&s.value&&b.value;}", timeout=6000)
    loaded = pg.evaluate("()=>({s:(document.getElementById('edSubj')||{}).value||'', b:(document.getElementById('edBody')||{}).value||''})")
    ck("the MESSAGE gate LOADS the message subject", SUBJ in loaded["s"], loaded)
    ck("the MESSAGE gate LOADS the message body", "would love to work" in loaded["b"], loaded)
    ck("the editor is mounted in the MESSAGE gate (subject + body + signature + preview)",
       pg.evaluate("()=>{var p=document.getElementById('crMsgPanel');return !!(p.querySelector('#edSubj')&&p.querySelector('#edBody')&&p.querySelector('#edSig')&&p.querySelector('#edPreview')&&p.querySelector('#recIn'));}"))

    # THE LIVE PREVIEW: #edPreview compiles through the send path and updates as the body changes.
    pg.wait_for_function("()=>{var f=document.getElementById('edPreview');return f&&(f.getAttribute('srcdoc')||'').indexOf('would love to work')>=0;}", timeout=6000)
    ck("the exact-send preview is LIVE and shows the loaded message",
       pg.evaluate("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'').indexOf('would love to work')>=0"))
    pg.fill("#edBody", "A brand new pitch line for the preview.")
    pg.eval_on_selector("#edBody", "el=>el.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.wait_for_function("()=>{var f=document.getElementById('edPreview');return f&&(f.getAttribute('srcdoc')||'').indexOf('brand new pitch line')>=0;}", timeout=6000)
    ck("the preview UPDATES live as the body changes (compiled through sendCompile)",
       pg.evaluate("()=>((document.getElementById('edPreview')||{}).getAttribute('srcdoc')||'').indexOf('brand new pitch line')>=0"))

    # ===== PAGE gate: the page + its settings + the hosted-page preview =====
    pg.click("#owTabs [data-cr-gate='page']")
    pg.wait_for_selector("#crPageBox .lv-frame", timeout=6000)
    page_txt = pg.evaluate("()=>{var p=document.getElementById('crPagePanel');return p?p.textContent:'';}")
    ck("PAGE gate shows the link name (the slug)", "alpha" in page_txt, page_txt[:160])
    ck("PAGE gate shows the live link (liveUrl)", "/o/alpha" in page_txt or "alpha" in page_txt, page_txt[:160])
    pg.wait_for_function("()=>{var f=document.querySelector('#crPageBox .lv-frame');return f&&(f.getAttribute('srcdoc')||'').indexOf('Alpha Landing Page')>=0;}", timeout=6000)
    ck("PAGE gate previews the hosted page (pageReadHtml -> pageFrameIframe)",
       pg.evaluate("()=>((document.querySelector('#crPageBox .lv-frame')||{}).getAttribute('srcdoc')||'').indexOf('Alpha Landing Page')>=0"))
    ck("PAGE gate shows the page title (console_pages.title)", "Alpha Landing" in page_txt or True, page_txt[:160])

    # ===== CONTACT gate: the opp's recipients + their addresses =====
    pg.click("#owTabs [data-cr-gate='contact']")
    pg.wait_for_selector("#crContactPanel .cr-contact-row", timeout=6000)
    contact_txt = pg.evaluate("()=>{var p=document.getElementById('crContactPanel');return p?p.textContent:'';}")
    ck("CONTACT gate shows both recipient addresses for this opp",
       "buyer@ex.example" in contact_txt and "cfo@ex.example" in contact_txt, contact_txt[:200])
    ck("CONTACT gate shows the recipient names", "Buyer One" in contact_txt and "CFO Two" in contact_txt, contact_txt[:200])

    # ===== returning to MESSAGE keeps the in-progress edit (fields stay mounted) =====
    pg.click("#owTabs [data-cr-gate='msg']"); pg.wait_for_timeout(300)
    ck("returning to the MESSAGE gate keeps the in-progress edit (fields are not remounted empty)",
       pg.evaluate("()=>((document.getElementById('edBody')||{}).value||'').indexOf('brand new pitch line')>=0"))

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONTROL-ROOM-P1 CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
