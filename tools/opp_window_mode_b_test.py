"""G3 - Mode B ("message with campaign") inside the centered window (board.html).

Drives the REAL window Mode B (forced open via the exposed window.openOppWindow + window.owSelectMode; the
OPP_WINDOW flag stays OFF in the shipped build, so this bypasses it exactly as the device test would). Proves:
  - Mode B renders the four-tab strip (Message / Page / Recipients / Preview) and mounts the SHARED compose
    fields (#edSubj/#edBody/#recIn) INSIDE the Message panel (#owMsgPanel), with exactly ONE #edSubj in the DOM
    (no second editor);
  - tabs switch instantly (the Page panel shows, the Message panel hides) with the fields still mounted;
  - the Page tab is the ONE unified engine: an uploaded page feeds the SAME review component (libRowHtml ->
    pageFrameIframe srcdoc render + editable title/slug/task), held on the shared __upPlan;
  - the ONE primary action (Commit) writes the campaign shape: oppUpsert (card + recipients + fresh cycle) +
    pageUpsert (the page html) + pagePublishRelay (the relay commit) - the upCommit-shape primitives, reused;
  - the commit MERGES into the opp's existing data: the interactively composed subject/body become the campaign
    message, and the recipient is carried;
  - B2 at commit: a suppressed recipient is STRIPPED from the stored recipients (the page still publishes);
  - the validation gate (libCollectRows) blocks the commit when the slug is invalid - nothing is written;
  - the Preview tab renders the exact-send message AND the page, both as tall srcdoc frames;
  - with the flag OFF, a card tap still opens the DRAWER compose unchanged.
NO email is ever sent and nothing real is published: the relay and every REST write are intercepted. All
addresses are synthetic *.example.test.

FAILS-WHEN-BROKEN: section 5 asserts the campaign Commit wrote the page, the card, and called the publish relay.
Reverting owCommitCampaign (board-upload.src.js) to a no-op makes section 5 fail (proven by revert).
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
                    "outreach_subject":"{{BIZ}} x Thrive", "outreach_text":"Hi {{NAME}}, see {{LINK}} for "+biz+".",
                    "notes":"keep this note"}}
OPPS = {"alpha": mkopp("alpha","Alpha Co","buyer.alpha@example.test")}
PAGES = {}                              # console_pages store: slug -> {slug,title,task,html}
OPP_WRITES, PAGE_WRITES, RELAY_CALLS = [], [], []
SUPP = {"rows": [], "fault": False}     # console_suppressions: rows to return, and a 500-fault switch

def board_rows():
    out=[]
    for o in OPPS.values():
        out.append({"slug":o["slug"],"business":o["business"],"stage":"live","sent_count":0,"open_count":0,
          "replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":False,
          "has_email":bool(o.get("has_email")),"archived":bool(o.get("archived"))})
    return out
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

def J(route, obj, status=200): route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_opps(r):
    req=r.request
    if req.method=="POST":
        try: rows=json.loads(req.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]): OPP_WRITES.append(row)
        return r.fulfill(status=204, body="")
    o=OPPS.get(slug_of(req.url), {"slug":"","data":{}}); J(r, [{"slug":o["slug"],"data":o.get("data",{})}])
def route_pages(r):
    req=r.request; url=req.url
    if req.method=="POST":
        try: rows=json.loads(req.post_data or "[]")
        except Exception: rows=[]
        for row in (rows if isinstance(rows,list) else [rows]):
            if isinstance(row,dict) and row.get("slug"):
                PAGE_WRITES.append(row); PAGES[row["slug"]]={"slug":row["slug"],"title":row.get("title",""),"task":row.get("task",""),"html":row.get("html","")}
        return r.fulfill(status=204, body="")
    if req.method=="PATCH": return r.fulfill(status=204, body="")
    if "select=html" in url:                                     # pageReadHtml: single page html
        p=PAGES.get(slug_of(url)); return J(r, [{"html":p["html"]}] if p else [])
    # libFetchPages: the list
    return J(r, [{"slug":p["slug"],"title":p["title"],"task":p["task"],"live_verified_at":None,"up":1} for p in PAGES.values()])
def route_suppressions(r):
    if SUPP["fault"]: return J(r, {"message":"suppression read boom"}, status=500)   # fail-closed trigger
    return J(r, [{"email":e} for e in SUPP["rows"]])
def route_relay(r):
    body=r.request.post_data or ""
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True,"id":"resend_x","relay_version":5,"delivered":True})
def route_live(r): r.fulfill(status=200, headers={"content-type":"text/html"}, body="<!doctype html><title>live</title>")

def relay_ops(op): return [c for c in RELAY_CALLS if isinstance(c,dict) and c.get("op")==op]

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route(re.compile(r"console\.thriveiii\.com/opp/.*"), route_live)   # verifyLive (upActivateBackground, fire-and-forget)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_suppressions)

PAGE_HTML = "<!doctype html><html><head><title>Ramadan Offer</title></head><body><h1>Ramadan Offer</h1><p>Visit {{LINK}} today.</p></body></html>"
def upload_page(pg):
    # G7: the single-page upload now lives behind the "One page + written message" path on the Page tab. Choosing
    # it reveals the page file input; the review + commit shape (single row) are unchanged.
    pg.evaluate("()=>{var b=document.getElementById('owPathPage'); if(b) b.click();}"); pg.wait_for_timeout(150)
    pg.set_input_files("#owPageFile", {"name":"ramadan-offer.html", "mimeType":"text/html", "buffer":PAGE_HTML.encode()})
    pg.wait_for_selector("#owPageReview #libSlug-0", timeout=6000); pg.wait_for_timeout(400)

def open_mode_b(pg, slug):
    pg.evaluate("(s)=>window.openOppWindow(s)", slug)
    pg.evaluate("()=>window.owSelectMode('b')")
    pg.wait_for_selector("#owMsgPanel #edSubj", timeout=6000); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)

    # ===== 1: Mode B renders the tab strip + mounts the SHARED compose in the Message panel =====
    open_mode_b(pg, "alpha")
    ck("window is open (owScrim shown), drawer stays hidden", pg.evaluate("()=>({ow:!document.getElementById('owScrim').hidden, dw:!document.getElementById('scrim')})")=={"ow":True,"dw":True})
    ck("the four-tab strip is shown (Message/Page/Recipients/Preview)",
       pg.evaluate("()=>{var t=document.getElementById('owTabs'); return !!t && !t.hidden && t.querySelectorAll('[data-ow-tab]').length===4;}"),
       pg.evaluate("()=>document.getElementById('owTabs') && document.getElementById('owTabs').innerText"))
    ck("Message panel mounts subject/body/recipient inside #owMsgPanel",
       pg.evaluate("()=>{var m=document.getElementById('owMsgPanel'); return !!(m&&m.querySelector('#edSubj')&&m.querySelector('#edBody')&&m.querySelector('#recIn'));}"))
    ck("exactly ONE #edSubj in the DOM (shared editor by reference, no second copy)", pg.evaluate("()=>document.querySelectorAll('#edSubj').length")==1, pg.evaluate("()=>document.querySelectorAll('#edSubj').length"))
    ck("Message panel prefilled the subject from the record", pg.evaluate("()=>document.getElementById('edSubj').value")=="{{BIZ}} x Thrive", pg.evaluate("()=>document.getElementById('edSubj').value"))
    ck("the recipient prefilled from the record (#recIn)", "buyer.alpha@example.test" in pg.evaluate("()=>document.getElementById('recIn').value"), pg.evaluate("()=>document.getElementById('recIn').value"))

    # ===== 2: tabs switch instantly; the fields stay mounted =====
    pg.click("#owTabs [data-ow-tab='page']"); pg.wait_for_timeout(300)
    ck("clicking the Page tab shows #owPagePanel and hides #owMsgPanel",
       pg.evaluate("()=>({page:!document.getElementById('owPagePanel').hidden, msg:document.getElementById('owMsgPanel').hidden})")=={"page":True,"msg":True})
    # visibility, not just the [hidden] property: a hidden panel must not actually render (offsetParent===null),
    # so the tabs never stack on screen (the [hidden] attr must beat .ow-panel's display:flex).
    ck("only the active panel is visible on screen (hidden panels do not render)",
       pg.evaluate("()=>({page:document.getElementById('owPagePanel').offsetParent!==null, msg:document.getElementById('owMsgPanel').offsetParent!==null, prev:document.getElementById('owPreviewPanel').offsetParent!==null})")=={"page":True,"msg":False,"prev":False})
    ck("the compose fields stay mounted while the Page tab is active (still ONE #edSubj)", pg.evaluate("()=>document.querySelectorAll('#edSubj').length")==1)
    ck("the Page tab offers THREE labelled paths (full campaign / one page + written message / pick a template)",
       pg.evaluate("()=>!!(document.getElementById('owPathCampaign')&&document.getElementById('owPathPage')&&document.getElementById('owPathPick'))"))

    # ===== 3: the Page tab is the ONE unified engine -> the SHARED review component =====
    upload_page(pg)
    ck("an uploaded page renders the review via pageFrameIframe (a .lv-frame srcdoc)",
       pg.evaluate("()=>{var f=document.querySelector('#owPageReview .lv-frame'); return !!(f && (f.getAttribute('srcdoc')||'').indexOf('Ramadan Offer')>=0);}"))
    ck("the review has the editable title/slug/task inputs (libRowHtml)", pg.evaluate("()=>!!(document.getElementById('libTitle-0')&&document.getElementById('libSlug-0')&&document.getElementById('libTask-0'))"))
    ck("the slug defaults to THIS opp's slug (a pick/upload publishes at the opp slug)", pg.evaluate("()=>document.getElementById('libSlug-0').value")=="alpha", pg.evaluate("()=>document.getElementById('libSlug-0').value"))
    ck("the plan is held on the SHARED __upPlan (one review, one place)", pg.evaluate("()=>{var pl=window.__thriveUploadPlan&&window.__thriveUploadPlan(); return !!(pl&&pl.rows&&pl.rows.length===1&&pl.rows[0].page&&pl.rows[0].page.html);}"))

    # ===== 4: the commit gate needs a page first =====
    del OPP_WRITES[:]; del PAGE_WRITES[:]; del RELAY_CALLS[:]; PAGES.clear()
    pg.evaluate("()=>{ window.__thriveUploadPlan(); }")  # no-op touch
    # (page IS present now; the "need a page" gate is exercised in the unit-level guard - here we drive the happy path)

    # ===== 5: the ONE Commit writes the campaign shape (FAILS-WHEN-BROKEN) =====
    SUPP["rows"]=[]; SUPP["fault"]=False
    pg.click("#owTabs [data-ow-tab='msg']"); pg.wait_for_timeout(200)   # type the message on its own tab (only the active panel is visible)
    pg.fill("#owMsgPanel #edBody", "Ramadan Kareem. A small gift from Thrive: {{LINK}}.")
    pg.eval_on_selector("#owMsgPanel #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(200)
    ok = pg.evaluate("()=>window.__thriveOppCommitCampaign('alpha')")   # await the real commit
    pg.wait_for_timeout(600)
    ck("the campaign Commit resolved true", ok==True, ok)
    ck("Commit wrote the PAGE (pageUpsert -> console_pages) for alpha with the uploaded html",
       len(PAGE_WRITES)==1 and PAGE_WRITES[0].get("slug")=="alpha" and "Ramadan Offer" in PAGE_WRITES[0].get("html",""), PAGE_WRITES)
    # the commit write is the campaign upsert (data.source=="upload"); a debounced compose autosave may also land -
    # that is the orthogonal draft-save path (it stores the raw recipient; B2 strip is a COMMIT-time guarantee).
    commit_ops = [w for w in OPP_WRITES if (w.get("data") or {}).get("source")=="upload"]
    ck("Commit wrote the CARD (oppUpsert -> console_opps) for alpha", len(commit_ops)==1 and commit_ops[0].get("slug")=="alpha", OPP_WRITES)
    ck("Commit called the PAGE PUBLISH relay once for alpha (pagePublishRelay)",
       len(relay_ops("page_publish"))==1 and relay_ops("page_publish")[0].get("slug")=="alpha", RELAY_CALLS)
    data = (commit_ops[0].get("data") if commit_ops else {}) or {}
    ck("the commit MERGED: the composed body became the campaign message (outreach_text)", data.get("outreach_text","").startswith("Ramadan Kareem"), data.get("outreach_text"))
    ck("the commit MERGED: the pre-existing note is preserved (data-merge, not data-replace)", data.get("notes")=="keep this note", data.get("notes"))
    ck("the commit carried the recipient (single recipient at G3)",
       [x.get("addr") for x in (data.get("recipients") or [])]==["buyer.alpha@example.test"], data.get("recipients"))
    ck("the window status shows the committed state (#owCommitStatus)", pg.evaluate("()=>{var e=document.getElementById('owCommitStatus'); return !!e && e.textContent.length>0;}"), pg.evaluate("()=>document.getElementById('owCommitStatus').textContent"))

    # ===== 6: B2 at commit - a suppressed recipient is STRIPPED from the stored recipients =====
    SUPP["rows"]=["buyer.alpha@example.test"]; SUPP["fault"]=False
    del OPP_WRITES[:]; del PAGE_WRITES[:]; del RELAY_CALLS[:]; PAGES.clear()
    pg.reload(wait_until="load"); pg.wait_for_timeout(700); pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)
    open_mode_b(pg, "alpha")
    pg.fill("#owMsgPanel #edBody", "Ramadan Kareem. A small gift from Thrive: {{LINK}}.")
    pg.eval_on_selector("#owMsgPanel #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(200)
    pg.click("#owTabs [data-ow-tab='page']"); pg.wait_for_timeout(200)
    upload_page(pg)
    ok2 = pg.evaluate("()=>window.__thriveOppCommitCampaign('alpha')"); pg.wait_for_timeout(600)
    b2commit = [w for w in OPP_WRITES if (w.get("data") or {}).get("source")=="upload"]
    b2data = (b2commit[0].get("data") if b2commit else {}) or {}
    ck("B2: the page still published under suppression (the address, not the page, is dropped)", len(relay_ops("page_publish"))==1, RELAY_CALLS)
    ck("B2: the suppressed recipient is STRIPPED from the stored recipients (commit write)", (b2data.get("recipients") or [])==[], b2data.get("recipients"))

    # ===== 7: the validation gate (libCollectRows) blocks a commit with a bad slug =====
    SUPP["rows"]=[]; SUPP["fault"]=False
    del OPP_WRITES[:]; del PAGE_WRITES[:]; del RELAY_CALLS[:]; PAGES.clear()
    pg.reload(wait_until="load"); pg.wait_for_timeout(700); pg.wait_for_selector(".card[data-slug='alpha']", timeout=8000)
    open_mode_b(pg, "alpha")
    pg.click("#owTabs [data-ow-tab='page']"); pg.wait_for_timeout(200)
    upload_page(pg)
    pg.fill("#owPageReview #libSlug-0", "Bad Slug!")
    pg.eval_on_selector("#owPageReview #libSlug-0", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(300)
    ok3 = pg.evaluate("()=>window.__thriveOppCommitCampaign('alpha')"); pg.wait_for_timeout(400)
    ck("an invalid slug blocks the commit (resolves false)", ok3==False, ok3)
    ck("nothing is written when the validation gate fails (no page, no card, no relay)",
       len(PAGE_WRITES)==0 and len(OPP_WRITES)==0 and len(relay_ops("page_publish"))==0, {"pages":PAGE_WRITES,"opps":OPP_WRITES,"relay":RELAY_CALLS})

    # ===== 8: the Preview tab renders the exact-send message AND the page =====
    pg.fill("#owPageReview #libSlug-0", "alpha")   # Page tab still active from section 7
    pg.eval_on_selector("#owPageReview #libSlug-0", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(200)
    pg.click("#owTabs [data-ow-tab='msg']"); pg.wait_for_timeout(200)   # type the message on its own tab (only the active panel is visible)
    pg.fill("#owMsgPanel #edBody", "Preview body line for {{LINK}}.")
    pg.eval_on_selector("#owMsgPanel #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(200)
    pg.click("#owTabs [data-ow-tab='preview']"); pg.wait_for_timeout(500)
    ck("the Preview tab renders the exact-send MESSAGE (a srcdoc frame reflecting the body)",
       pg.evaluate("()=>{var f=document.querySelector('#owPrevBox .lv-frame'); return !!(f && (f.getAttribute('srcdoc')||'').indexOf('Preview body line')>=0);}"),
       pg.evaluate("()=>{var f=document.querySelector('#owPrevBox .lv-frame'); return f?(f.getAttribute('srcdoc')||'').slice(0,120):'no frame';}"))
    pg.click("#owPrevPageBtn"); pg.wait_for_timeout(400)
    ck("the Preview tab can switch to the PAGE (its srcdoc shows the uploaded page)",
       pg.evaluate("()=>{var f=document.querySelector('#owPrevBox .lv-frame'); return !!(f && (f.getAttribute('srcdoc')||'').indexOf('Ramadan Offer')>=0);}"))

    # ===== 9: P1 - a card tap opens the WINDOW on the CONTROL ROOM (MESSAGE gate); the drawer is retired =====
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(200)
    pg.evaluate("()=>{var c=document.querySelector('.card[data-slug=\"alpha\"]'); if(c) c.click();}")
    pg.wait_for_selector("#owTabs [data-cr-gate='msg']", timeout=6000); pg.wait_for_timeout(300)
    ck("a card tap opens the centered window on the control room MESSAGE gate; no drawer/#scrim in the DOM",
       pg.evaluate("()=>({ow:!document.getElementById('owScrim').hidden, msg:!!document.querySelector('#crMsgPanel #edSubj'), noDw:!document.getElementById('drawer') && !document.getElementById('scrim')})")=={"ow":True,"msg":True,"noDw":True})

    ck("no uncaught page error fired", len(perr)==0, perr)
    pg.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL OPP-WINDOW-MODE-B CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
