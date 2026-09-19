"""CONTROL ROOM send (board.html) - the Phase 1 MESSAGE gate can actually SEND.

A card tap opens the control room on the MESSAGE gate with subject/body/signature/preview/recipient. This test
proves the gate now carries a SEND button wired to the SAME send path as New-message Mode A (unifiedSend ->
runSend), so B2 (fail-closed suppression), F1, per-recipient one-to-one, and the no-message/no-recipient guards
are inherited - no fork. Stateful mock of BOTH the relay (script.google.com /exec) and Supabase REST; NO email is
ever sent (the relay is intercepted).

Assertions:
  1. the control-room MESSAGE gate renders a Send button (#crMsgPanel #nmSend);
  2. it is ENABLED for a ready opp (subject + body + recipient) and DISABLED for an opp with no recipient
     (the shared sendReady gate);
  3. clicking it runs the shared send: the relay is POSTed and exactly one console_mail row is written per
     recipient (one-to-one), the write happening AFTER the relay (unifiedSend -> runSend, unchanged);
  4. the card advances to the Sent lane exactly as a Mode A send does;
  5. the result surfaces in #nmStatus.

FAILS-WHEN-BROKEN: revert crMsgMount to composeFieldsHtml (drop the #nmSend button) -> assertion 1/3/4 fail
(no send button, no console_mail row, the card never leaves Live).
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

def mkopp(slug, biz, addr):
    return {"slug":slug, "business":biz, "has_email":True, "archived":False,
            "data":{"recipients":([{"addr":addr, "name":"Buyer "+slug}] if addr else []),
                    "outreach_subject":"A note for "+biz, "outreach_text":"Hi there, see https://console.thriveiii.com/opp/"+slug+" for "+biz+".",
                    "page_slug":slug}}
OPPS = {
  "alpha": mkopp("alpha","Alpha Co","buyer.alpha@example.test"),   # ready: subject + body + recipient
  "norec": mkopp("norec","NoRecipient Co",""),                     # eligible message, no recipient -> Send disabled
}
MAIL, RELAY_CALLS, ORDER = [], [], []
def sent_count(slug): return sum(1 for m in MAIL if (m.get("opp")==slug))
def board_rows():
    rows=[]
    for o in OPPS.values():
        sc=sent_count(o["slug"]); stage = "sent" if sc>0 else "live"
        rows.append({"slug":o["slug"],"business":o["business"],"stage":stage,"sent_count":sc,"open_count":0,
          "replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":True,
          "has_email":True,"archived":False})
    return rows
def slug_of(url):
    m=re.search(r'eq\.([^&]+)', url); return m.group(1) if m else ""
def slug_of_payload(body):
    try: return (json.loads(body) or {}).get("slug","")
    except Exception: return ""

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
def route_pages(r):
    if "select=html" in r.request.url: return J(r, [{"html":"<h1>x</h1>"}])
    if "select=title" in r.request.url: return J(r, [{"title":"T"}])
    return J(r, [{"slug":slug_of(r.request.url),"live_verified_at":"2026-01-01T00:00:00Z"}])
def route_relay(r):
    body=r.request.post_data or ""; ORDER.append("relay")
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True, "id":"resend", "relay_version":9, "delivered":True})

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", route_mail)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    # B2 fail-closed: serve an empty do-not-contact list so a normal send proceeds through the suppression-checked
    # path (without this route the fail-closed guard would correctly halt the send).
    ctx.route("**/rest/v1/console_suppressions**", route_empty)

LANE_OF = """(biz)=>{ var out=''; document.querySelectorAll('.lane').forEach(function(l){ var h=l.querySelector('h2'); if(!h) return; l.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) out=h.textContent; }); }); return out; }"""

def open_room(pg, slug):
    pg.evaluate("(s)=>window.openOppWindow(s,'detail')", slug)
    pg.wait_for_selector("#owTabs [data-cr-gate='msg']", timeout=6000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # ===== 1: the MESSAGE gate carries a Send button =====
    open_room(pg, "alpha")
    pg.wait_for_function("()=>{var s=document.getElementById('edSubj');return s&&s.value;}", timeout=6000)
    pg.wait_for_selector("#crMsgPanel #nmSend", timeout=6000)
    ck("1: the control-room MESSAGE gate renders a Send button (#crMsgPanel #nmSend)",
       pg.evaluate("()=>!!document.querySelector('#crMsgPanel #nmSend')"))
    ck("1: the Send button is placed at the bottom of the MESSAGE gate (after the preview)",
       pg.evaluate("""()=>{var p=document.getElementById('crMsgPanel'); if(!p) return false;
         var pv=p.querySelector('#edPreview'), sb=p.querySelector('#nmSend');
         return !!(pv&&sb) && (pv.compareDocumentPosition(sb) & Node.DOCUMENT_POSITION_FOLLOWING)!==0;}"""))

    # ===== 2: the shared sendReady gate - enabled when ready =====
    pg.wait_for_function("()=>{var b=document.querySelector('#crMsgPanel #nmSend');return b && !b.disabled;}", timeout=6000)
    ck("2: Send is ENABLED for a ready opp (subject + body + recipient)",
       pg.evaluate("()=>{var b=document.querySelector('#crMsgPanel #nmSend');return !!b && !b.disabled;}"))

    # ===== 3 + 4 + 5: clicking Send runs the shared path -> relay + console_mail, card to Sent, status shown =====
    ck("pre: Alpha is in the Live lane before sending", "Live" in pg.evaluate(LANE_OF, "Alpha Co"))
    pg.click("#crMsgPanel #nmSend")
    pg.wait_for_function("()=>true", timeout=100)
    for _ in range(30):
        pg.wait_for_timeout(150)
        if sent_count("alpha") >= 1: break
    ck("3: clicking Send wrote exactly one console_mail row for Alpha (runSend, one-to-one)", sent_count("alpha")==1, MAIL)
    ck("3: the relay was POSTed (the shared L5 send path ran)", len(RELAY_CALLS)>=1, RELAY_CALLS)
    ck("3: the payload carries slug=alpha (the send is for this opp)",
       (RELAY_CALLS[0] if RELAY_CALLS else {}).get("slug")=="alpha", RELAY_CALLS[:1])
    ck("3: ordering - the relay POST happened BEFORE the console_mail write (unchanged send path)",
       ORDER[:2]==["relay","mail"], ORDER)
    pg.wait_for_timeout(600)
    ck("4: Alpha advanced to the Sent lane after the send (exactly as Mode A)",
       "Sent" in pg.evaluate(LANE_OF, "Alpha Co"), pg.evaluate(LANE_OF, "Alpha Co"))
    ck("5: the result surfaced in #nmStatus", (pg.evaluate("()=>{var e=document.getElementById('nmStatus');return e?e.textContent:'';}") or "").strip()!="")

    # ===== 2b: Send is DISABLED for an opp with no recipient (the gate is real, not decorative) =====
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(200)
    open_room(pg, "norec")
    pg.wait_for_selector("#crMsgPanel #nmSend", timeout=6000); pg.wait_for_timeout(500)
    ck("2b: Send is DISABLED when there is no recipient (shared sendReady gate)",
       pg.evaluate("()=>{var b=document.querySelector('#crMsgPanel #nmSend');return !!b && b.disabled;}"))
    ck("2b: with Send disabled, no console_mail row is written for norec", sent_count("norec")==0, MAIL)

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONTROL-ROOM-SEND CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
