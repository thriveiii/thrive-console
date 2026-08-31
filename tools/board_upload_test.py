"""E2 CAMPAIGN UPLOAD (board.html zip upload, fails-when-broken, ZERO real network send).

Upload a campaign zip (html pages + message texts + recipient emails) from the device: read it client-side,
match each page to its message + subject + recipient + slug, review a match table, and ONLY on approval open
draft opp cards while storing each page to console_pages. Then a page must be ACTIVATED and its live URL must
resolve (a real fetch) before any send. Stateful mock of Supabase REST + the relay + the live-page fetch
(never a real send). A real .zip fixture is built on disk so the ported reader runs for real. Assertions:
  1. a zip yields a match table (html -> text -> email -> slug); NOTHING is written before Approve;
  2. AXIOM #3 "ignores the rest": non-page files (orphan messages, README, market assessment, assets, manifest)
     are silently ignored - never surfaced as orphan/informational; only a page's own dup_slug / no_message note fires;
  3. mailto: is stripped from the recipient (a clean bare address, never "mailto:foo@bar");
  4. on Approve each html becomes a DRAFT opp AND a console_pages row (nothing before approve);
  5. send is BLOCKED until the page is activated AND verifyLive returns ok; a dead link blocks with a clear
     dead state (no false success), and once live the send goes through;
  6. the uploaded text renders in a FRAMED area, not raw off-screen;
  7. AR RTL; privacy: every address is a synthetic *.example.test placeholder.
"""
import os, re, json, io, zipfile, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = "/tmp/claude-0/-home-user-thrive-console/c3d00e60-6b80-5853-a1c6-18cd12c9bc26/scratchpad"
try: os.makedirs(SCRATCH, exist_ok=True)
except Exception: SCRATCH = "/tmp"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:600])

UID = "u"; DISPLAY_NAME = "Alice Op"; TITLE = "Growth Lead"

# ---- build a REAL campaign zip fixture (synthetic placeholders only) ------------------------------
# Two folder pages (acme-co, fresh-labs), two matching message texts (one carries a mailto: link so the
# strip is exercised), a duplicate-slug page (acme-co again), and an orphan text that matches no page.
ZIP_PATH = os.path.join(SCRATCH, "e2_campaign.zip")
def build_zip():
    buf = io.BytesIO()
    z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    z.writestr("opp/acme-co/index.html", "<!doctype html><title>Acme Co</title><h1>Acme Co</h1><p>Landing page for Acme Co.</p>")
    z.writestr("opp/fresh-labs/index.html", "<!doctype html><title>Fresh Labs</title><h1>Fresh Labs</h1><p>Landing page for Fresh Labs.</p>")
    z.writestr("opp/acme-co-2/index.html", "<!doctype html><title>Acme Co dup</title><h1>Acme Co</h1>")  # will slug to acme-co-2, distinct
    z.writestr("messages/acme-co.md", "Subject: A quick note for Acme Co\n\nHi there,\n\nWe help teams like Acme Co ship faster.\n\nReach me: buyer.acme@example.test\n")
    z.writestr("messages/fresh-labs.md", "Subject: Fresh Labs intro\n\nHello Fresh Labs,\n\nWorth a short call?\n\n<a href=\"mailto:buyer.fresh@example.test\">email me</a>\n")
    z.writestr("messages/orphan-widget.md", "Subject: Orphan\n\nThis message matches no page. buyer.orphan@example.test\n")
    z.close()
    with open(ZIP_PATH, "wb") as f: f.write(buf.getvalue())
build_zip()

# A second zip that forces a DUPLICATE slug (two pages resolving to the same slug).
DUP_ZIP = os.path.join(SCRATCH, "e2_dup.zip")
def build_dup_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    z.writestr("acme-co.html", "<h1>Acme Co</h1>")
    z.writestr("more/acme-co.html", "<h1>Acme Co again</h1>")   # same basename slug -> dup_slug
    z.writestr("acme-co.md", "Subject: Acme\n\nBody. buyer.acme@example.test")
    z.close()
    with open(DUP_ZIP, "wb") as f: f.write(buf.getvalue())
build_dup_zip()

# A third zip mirroring the device-proven BATCH13 shape: SIX pages at opp/<slug>/index.html and ONE
# CONSOLIDATED messages file holding every message + email + subject as per-opportunity sections. Plus a
# market-assessment md and a README that are NOT per-page messages (must stay informational, not errors), and
# a seventh section that matches no page (must be reported "message with no page" by name). One section uses a
# mailto: form so the strip is exercised; every body carries the [LINK] token, which must be preserved.
BATCH_ZIP = os.path.join(SCRATCH, "e2_batch13.zip")
BATCH_SLUGS = ["drip-docx", "river-sea-chocolates", "manna-pottery", "hypergoat-coffee", "godet-furniture", "clear-spring-acupuncture"]
def _sec(n, name, sendto, subject, greet):
    return ("## %d) %s — Somewhere, VA\n"
            "- **Send to:** %s · **Subject:** %s\n\n"
            "```\n%s\n\nHere is a page made for you: [LINK]\n\nThyab\nThrive Digital Solutions\nthriveiii.com\n```\n\n") % (n, name, sendto, subject, greet)
def build_batch_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    for s in BATCH_SLUGS:
        z.writestr("opp/%s/index.html" % s, "<!doctype html><title>%s</title><h1>%s</h1>" % (s, s))
    md  = "# BATCH13 research and messages\n\nInternal notes follow.\n\n"
    md += _sec(1, "Drip Docx", "hello.dripdocx@example.test", "A cleaner intake for Drip Docx", "Hi Drip Docx team,")
    md += _sec(2, "River Sea Chocolates", "hello.riversea@example.test", "A page for River Sea", "Hi River Sea Chocolates,")
    md += _sec(3, "Manna Pottery", "mailto:studio.manna@example.test", "Your studio, online", "Hi Manna Pottery,")   # mailto: strip
    md += _sec(4, "Hypergoat Coffee Roasters", "contact.hypergoat@example.test", "The Del Ray opening, louder", "Hi Hypergoat crew,")
    md += _sec(5, "Godet Furniture", "hello.godet@example.test", "Godet, on the web", "Hi Godet Furniture,")
    md += _sec(6, "Clear Spring Acupuncture", "front.clearspring@example.test", "Clear Spring, easier to book", "Hi Clear Spring team,")
    md += _sec(7, "Nobody Bakery", "owner.nobody@example.test", "A page with no landing page", "Hi Nobody Bakery,")     # matches no page
    z.writestr("BATCH13_research_and_messages.md", md)
    z.writestr("MARKET_ASSESSMENT_DMV_and_EastCoast.md", "# Market assessment\n\nThe DMV and East Coast markets. No recipient here, this is background reading.\n")
    z.writestr("README.md", "# Batch 13\n\nHow this batch was assembled. No email addresses here.\n")
    z.close()
    with open(BATCH_ZIP, "wb") as f: f.write(buf.getvalue())
build_batch_zip()

# ---- stateful server model (ALL addresses synthetic *.example.test) ------------------------------
OPPS = {}; PAGES = {}; MAIL = []; RELAY_CALLS = []; OPP_POSTS = []; PAGE_POSTS = []
STAMP = {}  # slug -> live_verified_at ISO; set ONLY by the board's pageStampLive PATCH after a real verify-live ok
LIVE = {}   # slug -> "ok" | "dead" ; the live /opp/<slug> fetch outcome

def sent_count(slug): return sum(1 for m in MAIL if m.get("opp")==slug)
def board_rows():
    rows = []
    for o in OPPS.values():
        d = o.get("data",{}) or {}
        he = bool(str(d.get("outreach_text","")).strip() or str(d.get("outreach_subject","")).strip())
        # PR1 view law: has_page and the 'live' page-signal derive SOLELY from the live_verified_at stamp,
        # not from bare console_pages row-existence. A stored-but-unstamped page is a DRAFT.
        hp = bool(STAMP.get(o["slug"]))
        sc = sent_count(o["slug"])
        stage = "sent" if sc>0 else ("live" if (he or hp) else "draft")
        rows.append({"slug":o["slug"], "business":o.get("business",""), "stage":stage, "sent_count":sc,
          "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":hp, "has_email":he, "archived":False})
    return rows

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
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

def J(route, obj, status=200):
    route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_board(r): J(r, board_rows())
def route_empty(r): J(r, [])
def route_pnames(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "email":"op@thrive.test"}])
def route_profiles(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":TITLE}])
def route_members(r): J(r, [{"id":UID, "role":"member"}])
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
    req = r.request
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"): PAGE_POSTS.append(row); PAGES[row["slug"]] = row.get("html","")
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":                                # PR1 pageStampLive: the single liveness write
        slug = slug_of(req.url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        stamp = body.get("live_verified_at")
        if slug and stamp: STAMP[slug] = stamp
        return r.fulfill(status=204, body="")
    slug = slug_of(req.url)                                   # activation reads console_pages.html back; the drawer
    # also reads live_verified_at (fetchDetail select=slug,live_verified_at) - return both, client picks fields.
    return J(r, [{"slug":slug, "html":PAGES[slug], "live_verified_at":STAMP.get(slug)}] if slug in PAGES else [])
def route_mail(r):
    req = r.request
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("opp"): MAIL.append(row)
        return r.fulfill(status=204, body="")
    return J(r, [])
def route_relay(r):
    body = r.request.post_data or ""
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True, "id":"resend_x", "relay_version":5, "delivered":True})
def route_live(r):
    # the real /opp/<slug> live fetch that verifyLive performs
    m = re.search(r"/opp/([^/?]+)", r.request.url); slug = m.group(1) if m else ""
    st = LIVE.get(slug)
    if st == "ok": return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<h1>live</h1>")
    if st == "dead": return r.fulfill(status=404, body="not found")
    return r.fulfill(status=404, body="not found")

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
    ctx.route("**/rest/v1/console_mail**", route_mail)
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
def open_upload(pg): pg.evaluate("()=>{var b=document.getElementById('uploadBtn'); if(b) b.click();}"); pg.wait_for_timeout(300)
OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    # ===== 1: the header offers Upload; the zip yields a match table; nothing written yet =====
    ck("1: the header carries an Upload button", pg.evaluate("()=>!!document.getElementById('uploadBtn')"))
    open_upload(pg)
    ck("1: Upload opens a standalone overlay (#upScrim)", pg.evaluate("()=>{var s=document.getElementById('upScrim'); return s? !s.hidden : false;}"))
    pg.set_input_files("#upFile", ZIP_PATH)
    pg.wait_for_timeout(1200)
    plan = pg.evaluate("()=>window.__thriveUploadPlan()")
    ck("1: a match table (plan) was built from the zip", bool(plan) and len(plan.get("rows",[]))>=2, {"rows": len(plan.get("rows",[])) if plan else 0})
    slugs = sorted([r["slug"] for r in (plan.get("rows",[]) if plan else [])])
    ck("1: each html derived a slug (folder-aware)", "acme-co" in slugs and "fresh-labs" in slugs, slugs)
    acme = [r for r in plan["rows"] if r["slug"]=="acme-co"][0]
    ck("1: the page matched its message subject", acme["subject"]=="A quick note for Acme Co", acme.get("subject"))
    ck("1: NOTHING was written before Approve (no console_opps / console_pages POST)", len(OPP_POSTS)==0 and len(PAGE_POSTS)==0, {"opps":len(OPP_POSTS), "pages":len(PAGE_POSTS)})

    # ===== 3: mailto stripped from the recipient (fresh-labs message carried a mailto: link) =====
    fresh = [r for r in plan["rows"] if r["slug"]=="fresh-labs"][0]
    ck("3: the recipient email is a clean BARE address (mailto stripped)",
       fresh["email"]=="buyer.fresh@example.test" and "mailto" not in fresh["email"], fresh.get("email"))
    ck("3: the acme recipient is bare too", acme["email"]=="buyer.acme@example.test", acme.get("email"))

    # ===== 2: AXIOM #3 "ignores the rest" - an orphan text (a message that matched no page) is NOT surfaced =====
    # (was: orphan-widget.md surfaced as an orphan note). Only html pages are rows; every non-page file is ignored.
    ck("2: an orphan text (no page) is IGNORED, not surfaced", not plan.get("orphanTexts"), plan.get("orphanTexts"))
    ck("2: the preview renders NO orphan line (.up-orphans)", not pg.evaluate("()=>!!document.querySelector('.up-orphans')"))

    # ===== 6: uploaded text renders FRAMED, not raw =====
    ck("6: the uploaded message renders inside a framed area (.up-frame/.up-pre), not raw off-screen",
       pg.evaluate("()=>{var f=document.querySelector('.up-frame .up-pre'); return !!f && f.textContent.indexOf('ship faster')>=0;}"))

    # ===== 4: Approve writes the opp + page AND activates on upload (publish + verify + stamp), no button =====
    LIVE["acme-co"] = "ok"; LIVE["fresh-labs"] = "ok"   # the live-verify the background activation polls will see
    pg.evaluate("()=>{var b=document.getElementById('upApprove'); if(b) b.click();}")
    pg.wait_for_timeout(1800)                            # approve writes + publishes; the background verify then stamps
    ck("4: Approve created opps (console_opps rows)", "acme-co" in OPPS and "fresh-labs" in OPPS, list(OPPS.keys()))
    ck("4: each uploaded html became a console_pages row", "acme-co" in PAGES and "fresh-labs" in PAGES, list(PAGES.keys()))
    ck("4: the opp is upload-sourced with its bare recipient",
       OPPS["acme-co"]["data"].get("source")=="upload"
       and (OPPS["acme-co"]["data"].get("recipients") or [{}])[0].get("addr")=="buyer.acme@example.test", OPPS["acme-co"]["data"])
    # ACTIVATE ON UPLOAD: the page is committed via the relay (op=page_publish) during Approve - no second click.
    ck("4: the page was PUBLISHED on upload (op=page_publish via the relay), and NO activate button exists",
       any(c.get("op")=="page_publish" and c.get("slug")=="acme-co" for c in RELAY_CALLS)
       and pg.evaluate("()=>!document.getElementById('upActBtn')"), RELAY_CALLS)
    # the background verify stamped live_verified_at (poll the mock until it lands, bounded)
    for _ in range(20):
        if STAMP.get("acme-co"): break
        pg.wait_for_timeout(300)
    ck("4: the page was live_verified ON UPLOAD (background stamp, no manual activate)", bool(STAMP.get("acme-co")), {"stamp":STAMP.get("acme-co")})

    # ===== 5: send is NOT blocked for a live-on-upload page; blocked ONLY for a definitively dead page (404) =====
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600); wait_ident(pg)
    # 5a: acme-co is live on upload -> the send goes straight through, no manual activate, no re-activate button
    pg.evaluate(OPEN, "A quick note for Acme Co")   # business == subject/title
    pg.wait_for_timeout(400)
    ck("5: no re-activate button on a live upload card (activation happened on upload)",
       pg.evaluate("()=>!document.getElementById('upActBtn')"))
    pg.evaluate("()=>{var b=document.querySelector('#drawer .act[data-act=\"send\"]'); if(b) b.click();}")
    pg.wait_for_timeout(1600)
    ck("5: a live-on-upload page sends directly (one console_mail row via L5, no activate step)", sent_count("acme-co")==1, MAIL)

    # 5b: a DEFINITIVELY DEAD page (404) still blocks the send with a clear reason
    LIVE["fresh-labs"] = "dead"; STAMP.pop("fresh-labs", None)   # force the live /opp/fresh-labs to 404
    pg.evaluate("()=>location.reload()"); pg.wait_for_timeout(700); wait_ident(pg)
    pg.evaluate(OPEN, "Fresh Labs intro")
    pg.wait_for_timeout(400)
    n_before = sent_count("fresh-labs")
    pg.evaluate("()=>{var b=document.querySelector('#drawer .act[data-act=\"send\"]'); if(b) b.click();}")
    pg.wait_for_timeout(2400)   # gate: verifyLive 404 -> retry 1.5s -> 404 -> deadlink, no send
    ck("5: a 404/410 dead page still BLOCKS the send (no console_mail)", sent_count("fresh-labs")==n_before, {"mail":sent_count("fresh-labs")})
    stD = pg.evaluate("()=>{var e=document.getElementById('actStatus'); return e?{txt:e.textContent,cls:e.className}:{};}")
    ck("5: the dead-page block shows a RED reason (not a phantom success)", "bad" in (stD.get("cls") or ""), stD)

    pg.close(); ctx.close()

    # ===== 2b: a DUPLICATE slug is flagged by name =====
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    open_upload(pg2); pg2.set_input_files("#upFile", DUP_ZIP); pg2.wait_for_timeout(1200)
    plan2 = pg2.evaluate("()=>window.__thriveUploadPlan()")
    warned = any("dup_slug" in (r.get("warnings") or []) for r in (plan2.get("rows",[]) if plan2 else []))
    ck("2b: a duplicate slug is flagged (dup_slug warning)", warned, [r.get("warnings") for r in (plan2.get("rows",[]) if plan2 else [])])
    # a page with no matching text warns no_message
    nomsg = any("no_message" in (r.get("warnings") or []) for r in (plan2.get("rows",[]) if plan2 else []))
    ck("2b: a page with no matched message warns no_message", nomsg, [r.get("warnings") for r in (plan2.get("rows",[]) if plan2 else [])])
    pg2.close(); ctx2.close()

    # ===== 7: AR RTL =====
    ctx3 = b.new_context(); wire(ctx3, lang="ar"); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(500); wait_ident(pg3)
    open_upload(pg3)
    d = pg3.evaluate("()=>{var pn=document.getElementById('upPanel'); return {dir:getComputedStyle(pn).direction, has:!!document.getElementById('upFile'), open:!document.getElementById('upScrim').hidden};}")
    ck("7: AR flips the upload overlay to RTL", d["dir"]=="rtl", d)
    ck("7: the upload surface renders under AR", d["has"] and d["open"], d)
    pg3.close(); ctx3.close()

    # ===== 8: CONSOLIDATED messages file (the BATCH13 fix) - match ALL, not some =====
    ctx4 = b.new_context(); wire(ctx4); pg4 = ctx4.new_page()
    pg4.goto(f"{base}/library/board.html", wait_until="load"); pg4.wait_for_timeout(500); wait_ident(pg4)
    open_upload(pg4); pg4.set_input_files("#upFile", BATCH_ZIP)
    opp_before = len(OPP_POSTS); page_before = len(PAGE_POSTS)
    pg4.wait_for_timeout(1500)
    plan4 = pg4.evaluate("()=>window.__thriveUploadPlan()")
    rows4 = plan4.get("rows", []) if plan4 else []
    byslug = {r["slug"]: r for r in rows4}
    ck("8: all six pages appear in the match table", sorted(byslug.keys())==sorted(BATCH_SLUGS), sorted(byslug.keys()))
    resolved = [s for s in BATCH_SLUGS if byslug.get(s) and byslug[s].get("email") and byslug[s].get("subject") and byslug[s].get("body")]
    ck("8: EVERY page resolves email + subject + body from the ONE consolidated file", sorted(resolved)==sorted(BATCH_SLUGS),
       {s: {"email":bool(byslug.get(s,{}).get("email")), "subject":bool(byslug.get(s,{}).get("subject")), "body":bool(byslug.get(s,{}).get("body"))} for s in BATCH_SLUGS})
    ck("8: no page is left 'no message' when a section exists", not any("no_message" in (r.get("warnings") or []) for r in rows4),
       [(r["slug"], r.get("warnings")) for r in rows4])
    ck("8: a specific section resolved to its slug by name (Hypergoat -> hypergoat-coffee)",
       byslug.get("hypergoat-coffee",{}).get("subject")=="The Del Ray opening, louder", byslug.get("hypergoat-coffee",{}).get("subject"))
    ck("8: mailto is stripped from a consolidated Send-to (manna-pottery)",
       byslug.get("manna-pottery",{}).get("email")=="studio.manna@example.test" and "mailto" not in byslug.get("manna-pottery",{}).get("email",""),
       byslug.get("manna-pottery",{}).get("email"))
    ck("8: the [LINK] token is preserved in the extracted body", "[LINK]" in (byslug.get("drip-docx",{}).get("body") or ""), byslug.get("drip-docx",{}).get("body"))
    # AXIOM #3 "ignores the rest": a section that matched no page, a market assessment, and a README are all
    # non-page, non-matched files - they are SILENTLY IGNORED now, never surfaced as orphan or informational.
    ck("8: a section with no page is IGNORED, not surfaced (no orphan note)", not plan4.get("orphanTexts"), plan4.get("orphanTexts"))
    ck("8: a market assessment and a README are IGNORED, not surfaced (no informational note)", not plan4.get("informational"), plan4.get("informational"))
    ck("8: the preview renders NO orphan / informational lines",
       not pg4.evaluate("()=>!!document.querySelector('.up-orphans, .up-info')"))
    ck("8: NOTHING was written before Approve (consolidated path too)",
       len(OPP_POSTS)==opp_before and len(PAGE_POSTS)==page_before, {"opps_delta":len(OPP_POSTS)-opp_before, "pages_delta":len(PAGE_POSTS)-page_before})
    # Approve: each of the six pages becomes a draft opp + a console_pages row, [LINK] carried into outreach_text
    pg4.evaluate("()=>{var b=document.getElementById('upApprove'); if(b) b.click();}")
    pg4.wait_for_timeout(1800)
    ck("8: Approve created a draft opp for all six pages", all(s in OPPS for s in BATCH_SLUGS), [s for s in BATCH_SLUGS if s not in OPPS])
    ck("8: Approve stored a console_pages row for all six pages", all(s in PAGES for s in BATCH_SLUGS), [s for s in BATCH_SLUGS if s not in PAGES])
    ck("8: the drafts are upload-sourced and carry the recipient + [LINK] body",
       OPPS["hypergoat-coffee"]["data"].get("source")=="upload"
       and (OPPS["hypergoat-coffee"]["data"].get("recipients") or [{}])[0].get("addr")=="contact.hypergoat@example.test"
       and "[LINK]" in OPPS["hypergoat-coffee"]["data"].get("outreach_text",""),
       OPPS["hypergoat-coffee"]["data"])
    ck("8: the section with no page did NOT create an opp", "nobody-bakery" not in OPPS, [k for k in OPPS if "nobody" in k])
    pg4.close(); ctx4.close()

    # ===== privacy + no error =====
    blob = json.dumps(OPP_POSTS) + json.dumps(PAGE_POSTS) + json.dumps(RELAY_CALLS) + json.dumps(MAIL)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', blob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address written is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error", not perr, perr)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-UPLOAD CHECKS PASS"))
raise SystemExit(1 if fails else 0)
