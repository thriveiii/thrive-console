"""G7 MODE B THREE PATHS + multi-page campaign (browser, fails-when-broken, ZERO real network send).

The Unified window, "message with campaign" (Mode B), Page tab must offer THREE clearly labelled paths, and the
FULL-CAMPAIGN path must render and commit ALL pages of a zip, not one. This is the fix for the G7-0 finding:
the Page tab called the multi-page parser upBuildPlan but discarded every page but the first (owPageOnFile
collapsed to rows[0]; owCommitCampaign committed rows[0] only).

Proves, driving the REAL window through real DOM (owNewMessage -> Mode B -> Page tab), against a mocked Supabase
+ relay (synthetic *.example.test only; no real send):
  1. Entering Mode B Page tab shows THREE labelled path choices (Full campaign / One page + written message /
     Pick a Library template).
  2. FULL CAMPAIGN: a zip of SIX pages renders ALL SIX rows (six page previews, each with its matched recipient
     + subject), and Commit creates SIX cards + SIX pages + per-row recipients - NOT one.
  3. B2: a suppressed recipient is stripped at commit (its card commits with an empty recipient list).
  4. BARE PAGE + written message: one uploaded page + a hand-written Message-tab message commits ONE card that
     carries the written subject/body (merge, not the zip's).
  5. PICK LIBRARY TEMPLATE: an existing console_pages template is listed, picked, and commits ONE card.

Fails-when-broken: revert owCampaignOnFile to keep only the first row (or route Commit through the single-row
owCommitCampaign), and assertion 2 (six rendered rows / six committed cards) fails.

Pure Python + Playwright. Run: python3 tools/opp_window_campaign_test.py
"""
import os, re, json, io, zipfile, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = os.environ.get("SCRATCH", "/tmp/claude-0")
os.makedirs(SCRATCH, exist_ok=True)
UID = "u-op-1"; DISPLAY_NAME = "Operator"; TITLE = "Owner"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- fixtures: a SIX-page campaign zip (BATCH13 shape), one bare page, one Library template -------
# Six pages at opp/<slug>/index.html plus ONE consolidated messages file (per-opportunity sections carrying
# Send to / Subject / a fenced body). One section (Hypergoat) is the one we suppress. A seventh section matches
# no page (ignored). This mirrors the device-proven shape from board_upload_test.py.
CAMP_ZIP = os.path.join(SCRATCH, "g7_campaign.zip")
SLUGS = ["drip-docx", "river-sea-chocolates", "manna-pottery", "hypergoat-coffee", "godet-furniture", "clear-spring-acupuncture"]
SUPPRESSED = "contact.hypergoat@example.test"   # section 4's recipient; must be stripped at commit
def _sec(n, name, sendto, subject, greet):
    return ("## %d) %s - Somewhere, VA\n"
            "- **Send to:** %s . **Subject:** %s\n\n"
            "```\n%s\n\nHere is a page made for you: [LINK]\n\nThyab\nThrive\n```\n\n") % (n, name, sendto, subject, greet)
def build_camp():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    for s in SLUGS:
        z.writestr("opp/%s/index.html" % s, "<!doctype html><title>%s</title><h1>%s</h1><p>Landing for %s.</p>" % (s, s, s))
    md  = "# Batch research and messages\n\nInternal notes.\n\n"
    md += _sec(1, "Drip Docx", "hello.dripdocx@example.test", "A cleaner intake for Drip Docx", "Hi Drip Docx team,")
    md += _sec(2, "River Sea Chocolates", "hello.riversea@example.test", "A page for River Sea", "Hi River Sea,")
    md += _sec(3, "Manna Pottery", "studio.manna@example.test", "Your studio, online", "Hi Manna Pottery,")
    md += _sec(4, "Hypergoat Coffee Roasters", SUPPRESSED, "The Del Ray opening, louder", "Hi Hypergoat crew,")
    md += _sec(5, "Godet Furniture", "hello.godet@example.test", "Godet, on the web", "Hi Godet Furniture,")
    md += _sec(6, "Clear Spring Acupuncture", "front.clearspring@example.test", "Clear Spring, easier to book", "Hi Clear Spring,")
    md += _sec(7, "Nobody Bakery", "owner.nobody@example.test", "A page with no landing page", "Hi Nobody Bakery,")
    z.writestr("BATCH_research_and_messages.md", md)
    z.writestr("README.md", "# Batch\n\nHow this batch was assembled. No emails here.\n")
    z.close()
    with open(CAMP_ZIP, "wb") as f: f.write(buf.getvalue())
build_camp()

BARE_HTML = os.path.join(SCRATCH, "g7_bare.html")
with open(BARE_HTML, "w") as f: f.write("<!doctype html><title>Solo Page</title><h1>Solo Page</h1><p>A single landing page.</p>")

# ---- stateful server model (ALL addresses synthetic *.example.test) ------------------------------
OPPS = {}; PAGES = {}; PAGE_POSTS = []; OPP_POSTS = []; STAMP = {}; LIVE = {}
# Seed one Library template for the pick path.
PAGES["welcome-tpl"] = {"slug":"welcome-tpl", "html":"<!doctype html><title>Welcome</title><h1>Welcome template</h1>",
                        "title":"Welcome template", "task":"welcome", "live_verified_at":"2026-01-01T00:00:00Z"}

def board_rows():
    rows = []
    for o in OPPS.values():
        d = o.get("data",{}) or {}
        he = bool(str(d.get("outreach_text","")).strip() or str(d.get("outreach_subject","")).strip())
        hp = bool(STAMP.get(o["slug"]))
        rows.append({"slug":o["slug"], "business":o.get("business",""), "stage":("live" if (he or hp) else "draft"),
          "sent_count":0, "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":hp, "has_email":he, "archived":False})
    return rows
def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""

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
def route_profiles(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":TITLE}])
def route_members(r): J(r, [{"id":UID, "role":"member"}])
def route_supp(r): J(r, [{"email":SUPPRESSED}])         # B2: one do-not-contact address (200 = a valid set)
def route_opps(r):
    req = r.request; url = req.url
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if not (isinstance(row, dict) and row.get("slug")): continue
            OPP_POSTS.append(row)
            s = row["slug"]; cur = OPPS.get(s, {"slug":s, "business":"", "data":{}})
            if "business" in row: cur["business"] = row["business"]
            if isinstance(row.get("data"), dict): cur["data"] = row["data"]
            OPPS[s] = cur
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":
        slug = slug_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        o = OPPS.get(slug)
        if o is not None and isinstance(body.get("data"), dict): o["data"] = body["data"]
        return r.fulfill(status=204, body="")
    slug = slug_of(url); o = OPPS.get(slug, {"slug":slug, "data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])
def route_pages(r):
    req = r.request; url = req.url
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"):
                PAGE_POSTS.append(row)
                PAGES[row["slug"]] = {"slug":row["slug"], "html":row.get("html",""), "title":row.get("title"),
                                      "task":row.get("task"), "live_verified_at":STAMP.get(row["slug"])}
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":
        slug = slug_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        if slug and body.get("live_verified_at"): STAMP[slug] = body["live_verified_at"]
        return r.fulfill(status=204, body="")
    slug = slug_of(url)
    if slug:
        p = PAGES.get(slug)
        return J(r, [{"slug":slug, "html":p.get("html",""), "live_verified_at":STAMP.get(slug)}] if p else [])
    # no slug filter: the Library list read (select=slug,title,task,live_verified_at,up,updated_at&order=up.desc)
    return J(r, [{"slug":p["slug"], "title":p.get("title"), "task":p.get("task"),
                  "live_verified_at":STAMP.get(p["slug"]), "up":1, "updated_at":"2026-01-01T00:00:00Z"} for p in PAGES.values()])
def route_relay(r): J(r, {"ok":True, "id":"resend_x", "relay_version":5, "delivered":True})
def route_live(r):
    m = re.search(r"/opp/([^/?]+)", r.request.url); slug = m.group(1) if m else ""
    return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<h1>live</h1>") if LIVE.get(slug)=="ok" else r.fulfill(status=404, body="no")

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
    ctx.route(re.compile(r"https://console\.thriveiii\.com/opp/.*"), route_live)
    ctx.route("**/rest/v1/console_board**", route_board)
    ctx.route("**/rest/v1/console_inbound**", route_empty)
    ctx.route("**/rest/v1/console_hits**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_supp)
    ctx.route("**/rest/v1/console_mail**", route_empty)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_profile_names**", route_pnames)
    ctx.route("**/rest/v1/console_team_roster**", route_empty)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)
    ctx.route("**/rest/v1/console_opps**", route_opps)

def wait_ident(pg, tries=40):
    for _ in range(tries):
        if pg.evaluate("()=>!!(window.__thriveIdentity && window.__thriveIdentity.loaded)"): return True
        pg.wait_for_timeout(150)
    return False

def open_mode_b_page(pg):
    """Open a fresh window on the mode selector, choose Mode B, switch to the Page tab."""
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_timeout(150)
    pg.evaluate("()=>window.owSelectMode('b')"); pg.wait_for_timeout(150)
    pg.click('#owTabs [data-ow-tab="page"]'); pg.wait_for_timeout(150)

def wait_commit_ok(pg, tries=40):
    for _ in range(tries):
        cls = pg.evaluate("()=>{var e=document.getElementById('owCommitStatus'); return e? e.className : '';}")
        if "ok" in (cls or ""): return True
        if "bad" in (cls or ""): return False
        pg.wait_for_timeout(150)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    # ===== 1: entering Mode B Page tab shows the TWO unified paths (upload / pick) =====
    open_mode_b_page(pg)
    ck("1: the Page tab is the active Mode B panel", pg.evaluate("()=>{var el=document.getElementById('owPagePanel'); return !!el && !el.hidden;}"))
    for pid in ["owPathUpload", "owPathPick"]:
        vis = pg.evaluate("(id)=>{var b=document.getElementById(id); return !!b && b.offsetParent!==null;}", pid)
        ck(f"1: path button {pid} is present and visible", vis)
    ck("1: the old separate campaign/page path buttons are gone (unified)",
       pg.evaluate("()=>!document.getElementById('owPathCampaign') && !document.getElementById('owPathPage')"))
    ck("1: the two path labels read (EN: upload a page or campaign / pick a template)",
       pg.evaluate("()=>{var t=document.querySelector('.ow-page-paths').textContent; return t.indexOf('Upload a page or campaign')>=0 && t.indexOf('Library template')>=0;}"))
    ck("1: no path chosen -> upload body hidden and review empty",
       pg.evaluate("()=>document.getElementById('owBodyUpload').hidden===true") and
       pg.evaluate("()=>document.getElementById('owPageReview').innerHTML.trim()===''"))

    # ===== 2: the unified UPLOAD path renders ALL six pages from a multi-page zip =====
    pg.click("#owPathUpload"); pg.wait_for_timeout(150)
    ck("2: choosing Upload reveals the file input, hides the pick body",
       pg.evaluate("()=>document.getElementById('owBodyUpload').hidden===false && document.getElementById('owBodyPick').hidden===true"))
    pg.set_input_files("#owUploadFile", CAMP_ZIP)
    pg.wait_for_timeout(1400)
    plan = pg.evaluate("()=>window.__thriveUploadPlan()")
    ck("2: the WHOLE plan is held (six page rows, not one)", bool(plan) and len(plan.get("rows",[]))==6, {"rows": len(plan.get("rows",[])) if plan else None})
    ck("2: the review renders one editable row per page (six slug inputs)",
       pg.eval_on_selector_all("#owPageReview [id^='libSlug-']", "els=>els.length")==6, pg.eval_on_selector_all("#owPageReview [id^='libSlug-']","els=>els.length"))
    ck("2: the review renders a page preview per page (six srcdoc iframes)",
       pg.eval_on_selector_all("#owPageReview .lv-frame", "els=>els.length")==6)
    ck("2: each row shows its matched recipient + subject (six meta lines)",
       pg.eval_on_selector_all("#owPageReview .up-meta", "els=>els.length")==6)
    ck("2: a specific match is shown (Drip Docx recipient + subject)",
       pg.evaluate("()=>document.getElementById('owPageReview').textContent.indexOf('hello.dripdocx@example.test')>=0 && document.getElementById('owPageReview').textContent.indexOf('A cleaner intake for Drip Docx')>=0"))
    ck("2: the matched count reads six", pg.evaluate("()=>{var c=document.querySelector('#owPageReview .up-count'); return !!c && c.textContent.indexOf('6')>=0;}"))

    # screenshot: the three paths + the six-row campaign review (desktop)
    pg.screenshot(path=os.path.join(SCRATCH, "g7_campaign_desktop.png"))

    # ===== 2/3: Commit creates SIX cards + SIX pages; B2 strips the suppressed recipient =====
    for s in SLUGS: LIVE[s] = "ok"
    pg.click("#owCommit")
    ok = wait_commit_ok(pg)
    pg.wait_for_timeout(600)
    ck("2: Commit succeeded (status ok)", ok, pg.evaluate("()=>{var e=document.getElementById('owCommitStatus');return e?e.textContent:'';}"))
    ck("2: SIX cards were created (one per page), not one",
       all(s in OPPS for s in SLUGS) and len([s for s in SLUGS if s in OPPS])==6, sorted(list(OPPS.keys())))
    ck("2: SIX pages were stored (console_pages), not one",
       all(s in PAGES for s in SLUGS), [s for s in SLUGS if s not in PAGES])
    # each non-suppressed card carries its one recipient; the suppressed one commits with an empty list (B2)
    def recips(slug): return (OPPS.get(slug,{}).get("data",{}) or {}).get("recipients",[]) or []
    ck("3: a non-suppressed card carries its recipient",
       len(recips("drip-docx"))==1 and recips("drip-docx")[0]["addr"]=="hello.dripdocx@example.test", recips("drip-docx"))
    ck("3: B2 - the suppressed recipient is stripped (hypergoat card commits empty recipients)",
       len(recips("hypergoat-coffee"))==0, recips("hypergoat-coffee"))
    ck("3: each card carries its OWN zip message (subject/body), not a shared one",
       (OPPS.get("river-sea-chocolates",{}).get("data",{}) or {}).get("outreach_subject","").startswith("A page for River Sea"),
       (OPPS.get("river-sea-chocolates",{}).get("data",{}) or {}).get("outreach_subject"))

    # ===== 4: a SINGLE bare page via the SAME unified upload path -> ONE card carrying the written message =====
    open_mode_b_page(pg)
    pg.click("#owPathUpload"); pg.wait_for_timeout(150)
    ck("4: choosing Upload reveals the file input (a single page works from the same control)", pg.evaluate("()=>document.getElementById('owBodyUpload').hidden===false"))
    pg.set_input_files("#owUploadFile", BARE_HTML)
    pg.wait_for_timeout(900)
    plan2 = pg.evaluate("()=>window.__thriveUploadPlan()")
    ck("4: the bare-page path holds exactly ONE row", bool(plan2) and len(plan2.get("rows",[]))==1, {"rows": len(plan2.get("rows",[])) if plan2 else None})
    # write the message on the Message tab, then commit
    pg.click('#owTabs [data-ow-tab="msg"]'); pg.wait_for_timeout(150)
    pg.fill("#owMsgPanel #edSubj", "A hand-written subject")
    pg.fill("#owMsgPanel #edBody", "This message was written by hand, not from a zip.")
    pg.fill("#owMsgPanel #recIn", "solo.buyer@example.test")
    pg.eval_on_selector("#owMsgPanel #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.eval_on_selector("#owMsgPanel #recIn", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.wait_for_timeout(300)
    before = set(OPPS.keys())
    pg.click("#owCommit")
    ok4 = wait_commit_ok(pg); pg.wait_for_timeout(500)
    new_slugs = [s for s in OPPS.keys() if s not in before]
    ck("4: the bare-page commit created exactly ONE new card", ok4 and len(new_slugs)==1, {"ok":ok4, "new":new_slugs})
    if new_slugs:
        d = OPPS[new_slugs[0]].get("data",{}) or {}
        ck("4: that card carries the HAND-WRITTEN subject/body (merge, not a zip message)",
           d.get("outreach_subject")=="A hand-written subject" and "written by hand" in str(d.get("outreach_text","")), {"subj":d.get("outreach_subject")})

    # ===== 5: PICK A LIBRARY TEMPLATE -> ONE card =====
    open_mode_b_page(pg)
    pg.click("#owPathPick"); pg.wait_for_timeout(300)
    ck("5: choosing Pick reveals the Library search + list", pg.evaluate("()=>document.getElementById('owBodyPick').hidden===false"))
    ck("5: the seeded Library template is listed",
       pg.evaluate("()=>{var l=document.getElementById('owPickList'); return !!l && l.textContent.indexOf('welcome-tpl')>=0;}"),
       pg.evaluate("()=>{var l=document.getElementById('owPickList'); return l?l.textContent:'';}"))
    pg.click('#owPickList [data-ow-pick="welcome-tpl"]'); pg.wait_for_timeout(600)
    plan5 = pg.evaluate("()=>window.__thriveUploadPlan()")
    ck("5: picking a template holds exactly ONE row with the template html",
       bool(plan5) and len(plan5.get("rows",[]))==1 and "Welcome template" in (plan5["rows"][0].get("page",{}) or {}).get("html",""),
       {"rows": len(plan5.get("rows",[])) if plan5 else None})
    pg.click('#owTabs [data-ow-tab="msg"]'); pg.wait_for_timeout(150)
    pg.fill("#owMsgPanel #edSubj", "Reusing a template")
    pg.fill("#owMsgPanel #edBody", "Body for the picked template.")
    pg.fill("#owMsgPanel #recIn", "pick.buyer@example.test")
    pg.eval_on_selector("#owMsgPanel #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.eval_on_selector("#owMsgPanel #recIn", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.wait_for_timeout(300)
    before5 = set(OPPS.keys())
    pg.click("#owCommit")
    ok5 = wait_commit_ok(pg); pg.wait_for_timeout(500)
    new5 = [s for s in OPPS.keys() if s not in before5]
    ck("5: the pick-template commit created exactly ONE new card", ok5 and len(new5)==1, {"ok":ok5, "new":new5})

    ck("no page errors were thrown during the run", len(perr)==0, perr)
    pg.close(); ctx.close()

    # ===== screenshots on the four faces (Arabic RTL too) =====
    for name, vw, vh, lang in [("desktop",1280,900,None), ("ipad",1024,768,None), ("phone",390,844,None), ("rtl",1280,900,"ar")]:
        c2 = b.new_context(viewport={"width":vw,"height":vh}); wire(c2, lang=lang); p2 = c2.new_page()
        p2.goto(f"{base}/library/board.html", wait_until="load"); p2.wait_for_timeout(500); wait_ident(p2)
        open_mode_b_page(p2)
        p2.click("#owPathUpload"); p2.wait_for_timeout(150)
        p2.set_input_files("#owUploadFile", CAMP_ZIP); p2.wait_for_timeout(1400)
        p2.screenshot(path=os.path.join(SCRATCH, f"g7_paths_{name}.png"))
        c2.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL G7 THREE-PATHS CHECKS PASS"))
raise SystemExit(1 if fails else 0)
