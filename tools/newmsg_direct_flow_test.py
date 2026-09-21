"""NEW MESSAGE direct flow (board.html): each of the 3 buttons routes DIRECTLY; upload review has per-item
include/exclude; the shared send path is untouched.

Asserts (each fails-when-broken):
  (a) ROUTING: Text -> lean compose (owModeA), Upload -> the upload surface (file input + review, NO Mode B
      4-tab shell, NO duplicate Page-tab path buttons), Pick -> the Library pick list directly.
  (b) EXCLUDE: a 3-row plan with one row excluded commits ONLY the 2 included rows (the excluded page is
      never published).
  (c) ALL-EXCLUDED is blocked with a clear message and nothing is committed.
  (d) SEND path still runs unifiedSend -> runSend with B2 (suppressed stripped) + per-recipient one-to-one:
      a 2-recipient text send with one address suppressed fires exactly ONE relay send and writes ONE
      console_mail row.
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

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))

# per-run capture buffers (reset per scenario via a fresh context)
class Cap:
    def __init__(self): self.opp_posts=[]; self.published=[]; self.sends=[]; self.mail=[]
def make_wire(cap, oppdata, board_extra, suppressed):
    def slug_of(url):
        m=re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
    def route_board(r):
        rows=list(board_extra)
        for sl,d in oppdata.items():
            rows.append({"slug":sl,"business":(d.get("business") if isinstance(d,dict) else "") or sl,"stage":"live",
              "sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z",
              "has_page":False,"has_email":True,"archived":False,"cycle":None})
        J(r, rows)
    def route_opps(r):
        req=r.request
        if req.method in ("POST","PATCH"):
            try: body=json.loads(req.post_data or "[]")
            except Exception: body=[]
            for row in (body if isinstance(body,list) else [body]):
                if isinstance(row,dict):
                    sl=row.get("slug") or slug_of(req.url)
                    cap.opp_posts.append(sl)
                    if sl: oppdata[sl]=row.get("data", oppdata.get(sl,{}))
            return r.fulfill(status=204, body="")
        sl=slug_of(req.url); d=oppdata.get(sl,{})
        return J(r, [{"slug":sl,"data":d,"archived_at":None,"archived_from":None}])
    def route_pages(r):
        u=r.request.url
        if r.request.method in ("POST","PATCH"): return r.fulfill(status=204, body="")
        if "select=html" in u: return J(r, [{"html":"<h1>x</h1>"}])
        if "select=title" in u: return J(r, [{"title":"T"}])
        if "select=slug,title" in u: return J(r, [])
        return J(r, [{"slug":slug_of(u) or "x","live_verified_at":"2026-01-01T00:00:00Z"}])
    def route_mail(r):
        if r.request.method=="POST":
            try: rows=json.loads(r.request.post_data or "[]")
            except Exception: rows=[]
            for row in (rows if isinstance(rows,list) else [rows]):
                if isinstance(row,dict) and row.get("opp"): cap.mail.append(row)
            return r.fulfill(status=204, body="")
        return J(r, [])
    def route_relay(r):
        body=r.request.post_data or ""
        try: d=json.loads(body)
        except Exception: d={"_raw":body[:120]}
        if d.get("op")=="page_publish": cap.published.append(d.get("slug"))
        elif d.get("to"): cap.sends.append(d)
        return J(r, {"ok":True,"id":"resend","relay_version":9,"delivered":True})
    def route_supp(r): J(r, [{"email":a} for a in suppressed])
    def wire(ctx):
        ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
        ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
        ctx.route("**/rest/v1/console_board**", route_board)
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_pages**", route_pages)
        ctx.route("**/rest/v1/console_mail**", route_mail)
        ctx.route("**/rest/v1/console_suppressions**", route_supp)
        for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return wire

def new_upload_page(base, b, wire, mode):
    ctx=b.new_context(); wire(ctx); pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600); pg.wait_for_selector(".lane", timeout=8000)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.evaluate("(m)=>window.owSelectMode(m)", mode)
    return ctx, pg, perr

ROW = lambda slug,email: {"slug":slug,"title":slug.title(),"task":"","email":email,"subject":"Hi "+slug,"body":"Body for "+slug,"page":{"html":"<h1>"+slug+"</h1>"},"warnings":[]}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== (a) ROUTING =====
    cap=Cap(); wire=make_wire(cap, {}, [], [])
    ctx=b.new_context(); wire(ctx); pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600); pg.wait_for_selector(".lane", timeout=8000)
    # Text
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickText"); pg.wait_for_timeout(200)
    st=pg.evaluate("""()=>({mode:window.__thriveOwState().mode, modeA:!!document.getElementById('owModeA'), tabs:document.querySelectorAll('#owTabs .ow-tab').length, recip:!!document.getElementById('owRecipPanel')})""")
    ck("(a) Text -> lean compose (owModeA), no Mode B tab shell", st["mode"]=="a" and st["modeA"] and st["tabs"]==0 and not st["recip"], st)
    # Upload
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickUpload"); pg.wait_for_timeout(200)
    su=pg.evaluate("""()=>({mode:window.__thriveOwState().mode, file:!!document.getElementById('owUploadFile'), review:!!document.getElementById('owPageReview'), msg:!!document.getElementById('owMsgPanel'), tabs:document.querySelectorAll('#owTabs .ow-tab').length, recip:!!document.getElementById('owRecipPanel'), prev:!!document.getElementById('owPreviewPanel'), pathBtn:!!document.getElementById('owPathUpload')})""")
    ck("(a) Upload -> direct upload surface (file input + review + shared message)", su["mode"]=="upload" and su["file"] and su["review"] and su["msg"], su)
    ck("(a) Upload -> NO Mode B tab shell (no tab strip, no Recipients/Preview panels)", su["tabs"]==0 and not su["recip"] and not su["prev"], su)
    ck("(a) Upload -> NO duplicate Page-tab path buttons", not su["pathBtn"], su)
    # Pick
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickLib"); pg.wait_for_timeout(300)
    sp=pg.evaluate("""()=>({mode:window.__thriveOwState().mode, list:!!document.getElementById('owPickList'), msg:!!document.getElementById('owMsgPanel'), tabs:document.querySelectorAll('#owTabs .ow-tab').length, pathBtn:!!document.getElementById('owPathPick')})""")
    ck("(a) Pick -> Library pick list directly, no Mode B shell, no path buttons", sp["mode"]=="pick" and sp["list"] and sp["tabs"]==0 and not sp["pathBtn"], sp)
    ck("(a) no uncaught error during routing", len(perr)==0, perr)
    pg.close(); ctx.close()

    # ===== (b) EXCLUDE one row -> commit only the included =====
    cap=Cap(); wire=make_wire(cap, {}, [], [])
    ctx, pg, perr = new_upload_page(base, b, wire, "upload")
    pg.wait_for_selector("#owPageReview", state="attached", timeout=6000)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    rows=[ROW("bards-alley","a@x.example"), ROW("mid-shop","b@x.example"), ROW("cafe-noor","c@x.example")]
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", rows)
    pg.wait_for_selector(".ow-acc", timeout=4000)
    naccc=pg.evaluate("()=>document.querySelectorAll('.ow-acc').length")
    ck("(b) the review renders one accordion section per row", naccc==3, naccc)
    # exclude the MIDDLE row via its real checkbox
    pg.evaluate("""()=>{ var cb=document.querySelector('[data-row-inc=\\"1\\"]'); cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true})); }""")
    pg.wait_for_timeout(150)
    res=pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug)
    # commit is async; wait for the published set to settle
    pg.wait_for_function("()=>true"); pg.wait_for_timeout(600)
    pub=sorted(cap.published)
    ck("(b) only the 2 INCLUDED pages are published", pub==["bards-alley","cafe-noor"], {"published":pub})
    ck("(b) the EXCLUDED page is never published", "mid-shop" not in cap.published, {"published":pub})
    pg.close(); ctx.close()

    # ===== (c) ALL excluded -> blocked, nothing committed =====
    cap=Cap(); wire=make_wire(cap, {}, [], [])
    ctx, pg, perr = new_upload_page(base, b, wire, "upload")
    pg.wait_for_selector("#owPageReview", state="attached", timeout=6000)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    rows=[ROW("one-x","a@x.example"), ROW("two-y","b@x.example")]
    pg.evaluate("(rows)=>window.__thriveSetUploadPlan(rows)", rows)
    pg.wait_for_selector(".ow-acc", timeout=4000)
    pg.evaluate("""()=>{ document.querySelectorAll('[data-row-inc]').forEach(function(cb){ cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true})); }); }""")
    pg.wait_for_timeout(150)
    pg.evaluate("(s)=>window.__thriveOppCommitCampaign(s)", slug); pg.wait_for_timeout(500)
    status=pg.evaluate("()=>{var e=document.getElementById('owCommitStatus');return e?e.textContent:'';}")
    ck("(c) all-excluded is blocked (nothing published, nothing upserted)", len(cap.published)==0 and len(cap.opp_posts)==0, {"published":cap.published,"opps":cap.opp_posts})
    ck("(c) a clear 'no files included' message is shown", ("included" in status.lower()) or ("مُضمَّنة" in status), status)
    pg.close(); ctx.close()

    # ===== (d) SEND path: unifiedSend -> runSend, B2 strip + per-recipient one-to-one =====
    cap=Cap(); wire=make_wire(cap, {}, [], ["blocked@x.example"])
    ctx=b.new_context(); wire(ctx); pg=ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600); pg.wait_for_selector(".lane", timeout=8000)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=6000)
    pg.click("#owPickText"); pg.wait_for_selector("#owModeA #edSubj", timeout=6000)
    slug=pg.evaluate("()=>window.__thriveOwState().slug")
    pg.fill("#edSubj", "A partnership")
    pg.fill("#edBody", "Hello, we would love to work with you.")
    pg.fill("#recIn", "keep@x.example, blocked@x.example")
    pg.wait_for_timeout(300)
    pg.evaluate("()=>{var b=document.getElementById('recSave'); if(b) b.click();}"); pg.wait_for_timeout(300)
    pg.evaluate("()=>{var b=document.getElementById('nmSend'); if(b) b.click();}")
    pg.wait_for_timeout(1200)
    tos=sorted(set(s.get("to") for s in cap.sends))
    ck("(d) exactly ONE relay send fired (B2 stripped the suppressed address; per-recipient one-to-one)", len(cap.sends)==1, {"sends":[s.get('to') for s in cap.sends]})
    ck("(d) the send went to the non-suppressed recipient only", tos==["keep@x.example"], tos)
    ck("(d) exactly one console_mail row written (send path unifiedSend -> runSend intact)", len(cap.mail)==1, cap.mail)
    pg.close(); ctx.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL NEWMSG-DIRECT-FLOW CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
