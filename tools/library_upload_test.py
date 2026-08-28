"""LIBRARY UPLOAD (PR1) - page-only commit + live link issuance (board.html, fails-when-broken, ZERO real send).

The Library path uploads 1..N html templates for DOCUMENTATION + ACTIVATION only: NO message, NO recipient, NO
card. It reuses the SAME read/parse/preview as the campaign upload (upReadFiles/upBuildPlan) but on approval it
commits ONLY the console_pages row and runs the activation chain per file (pagePublishRelay -> verifyLivePoll ->
pageStampLive). It NEVER calls oppUpsert, so no console_opps card is created; the board view is anchored on
console_opps (docs/supabase-board-view.sql:242), so a page with no opp never appears on the Operations board.

Same mocked Supabase REST + relay + live-fetch harness as board_upload_test. Synthetic *.example.test only.
Assertions:
  (a) a Library upload of 2 html files creates 2 console_pages rows, live_verified_at stamped, and ZERO
      console_opps rows / ZERO board cards;
  (b) each template exposes a live link via liveUrl (console.thriveiii.com/opp/<slug>) with Copy + Open controls;
  (c) a file with NO message still activates (no error) in the Library path;
  (d) AR RTL on the Library overlay.
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

# ---- a REAL zip of TWO html templates and NOTHING ELSE (no message files: documentation templates) ------
LIB_ZIP = os.path.join(SCRATCH, "lib_docs.zip")
LIB_SLUGS = ["doc-alpha", "doc-beta"]
def build_lib_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    z.writestr("opp/doc-alpha/index.html", "<!doctype html><title>Doc Alpha</title><h1>Doc Alpha</h1><p>A documentation template.</p>")
    z.writestr("opp/doc-beta/index.html", "<!doctype html><title>Doc Beta</title><h1>Doc Beta</h1><p>Another documentation template.</p>")
    z.close()
    with open(LIB_ZIP, "wb") as f: f.write(buf.getvalue())
build_lib_zip()

# ---- stateful server model (ALL addresses synthetic; none needed here) ----------------------------
OPPS = {}; PAGES = {}; OPP_POSTS = []; PAGE_POSTS = []; RELAY_CALLS = []
STAMP = {}   # slug -> live_verified_at ISO; set ONLY by pageStampLive PATCH after a real verify-live ok
LIVE = {}    # slug -> "ok" | "dead"

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
def route_opps(r):
    req = r.request
    if req.method == "POST":                                  # ANY console_opps POST is a FAILURE for the Library path
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"):
                OPP_POSTS.append(row); OPPS[row["slug"]] = {"slug":row["slug"], "business":row.get("business",""), "data":row.get("data",{})}
        return r.fulfill(status=204, body="")
    if req.method == "PATCH": return r.fulfill(status=204, body="")
    slug = slug_of(req.url); o = OPPS.get(slug, {"slug":slug, "data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])
def route_pages(r):
    req = r.request
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"): PAGE_POSTS.append(row); PAGES[row["slug"]] = row.get("html","")
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":                                 # pageStampLive: the single liveness write
        slug = slug_of(req.url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        stamp = body.get("live_verified_at")
        if slug and stamp: STAMP[slug] = stamp
        return r.fulfill(status=204, body="")
    slug = slug_of(req.url)
    return J(r, [{"slug":slug, "html":PAGES[slug], "live_verified_at":STAMP.get(slug)}] if slug in PAGES else [])
def route_relay(r):
    body = r.request.post_data or ""
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True, "id":"resend_x", "relay_version":5})
def route_live(r):
    m = re.search(r"/opp/([^/?]+)", r.request.url); slug = m.group(1) if m else ""
    if LIVE.get(slug) == "ok": return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<h1>live</h1>")
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

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    # ===== the Library surface opens (its own header entry, distinct from campaign Upload) =====
    ck("the header carries a Library button", pg.evaluate("()=>!!document.getElementById('libBtn')"))
    pg.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}"); pg.wait_for_timeout(300)   # PR-L1: opens the Library surface
    pg.evaluate("()=>{var b=document.getElementById('lvAdd'); if(b) b.click();}"); pg.wait_for_timeout(300)     # Add templates -> the upload overlay
    ck("Add templates opens the upload overlay (#upScrim) with the file input", pg.evaluate("()=>{var s=document.getElementById('upScrim'); return !!s && !s.hidden && !!document.getElementById('upFile');}"))

    # ===== (a)+(c): upload 2 html files (NO message), publish page-only, activate each =====
    LIVE["doc-alpha"] = "ok"; LIVE["doc-beta"] = "ok"
    pg.set_input_files("#upFile", LIB_ZIP); pg.wait_for_timeout(1200)
    plan = pg.evaluate("()=>window.__thriveUploadPlan()")
    ck("(c) 2 documentation templates parse (no message needed, no error blocks them)",
       bool(plan) and len(plan.get("rows",[]))==2, {"rows": len(plan.get("rows",[])) if plan else 0})
    ck("Library preview offers a Publish button (libApprove), never a compose/recipient surface",
       pg.evaluate("()=>!!document.getElementById('libApprove') && !document.getElementById('recIn') && !document.getElementById('edSubj')"))
    pg.evaluate("()=>{var b=document.getElementById('libApprove'); if(b) b.click();}")
    pg.wait_for_timeout(1800)

    ck("(a) exactly 2 console_pages rows were written", sorted(PAGES.keys())==sorted(LIB_SLUGS), list(PAGES.keys()))
    ck("(a) both pages were stamped live_verified_at (the single liveness truth)",
       bool(STAMP.get("doc-alpha")) and bool(STAMP.get("doc-beta")), dict(STAMP))
    ck("(a) ZERO console_opps rows were written (page-only commit, never oppUpsert)", len(OPP_POSTS)==0, OPP_POSTS)
    ck("(a) each page was committed via the relay (op=page_publish), no send",
       sorted([c.get("slug") for c in RELAY_CALLS if c.get("op")=="page_publish"])==sorted(LIB_SLUGS)
       and all(c.get("op")=="page_publish" for c in RELAY_CALLS), RELAY_CALLS)

    # (a) ZERO board cards: the board is anchored on console_opps, so no opp -> no card
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600); wait_ident(pg)
    ncards = pg.evaluate("()=>document.querySelectorAll('.card[data-slug]').length")
    ck("(a) ZERO Operations board cards from the Library upload", ncards==0, {"cards":ncards, "opps":list(OPPS.keys())})

    # ===== (b): each template exposes a live link via liveUrl, with Copy + Open =====
    done = pg.evaluate("()=>window.__thriveLibraryDoneHtml([{slug:'doc-alpha',title:'Doc Alpha',ok:true,link:'x'},{slug:'doc-beta',title:'Doc Beta',ok:true,link:'x'}])")
    ck("(b) the done panel shows each template's live link liveUrl(slug)",
       "console.thriveiii.com/opp/doc-alpha" in done and "console.thriveiii.com/opp/doc-beta" in done, done[:300])
    ck("(b) each live template offers Copy + Open controls",
       done.count("data-lib-copy=")==2 and done.count("data-lib-open=")==2, {"copy":done.count("data-lib-copy="), "open":done.count("data-lib-open=")})

    # ===== (c) explicit: a synthetic no-message row still activates through the page-only commit =====
    LIVE["doc-nomsg"] = "ok"
    res = pg.evaluate("""async()=>{
      return await window.__thriveLibraryCommit({rows:[{slug:'doc-nomsg', title:'', page:{html:'<h1>No message template</h1>'}}]});
    }""")
    ck("(c) a template with NO message/subject/recipient activates ok (page-only)",
       isinstance(res, list) and len(res)==1 and res[0].get("ok")==True and res[0].get("link")=="https://console.thriveiii.com/opp/doc-nomsg",
       res)
    ck("(c) the no-message template still wrote NO console_opps row", len(OPP_POSTS)==0, OPP_POSTS)
    pg.close(); ctx.close()

    # ===== (d) AR RTL on the Library overlay =====
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    pg2.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}"); pg2.wait_for_timeout(300)   # surface
    pg2.evaluate("()=>{var b=document.getElementById('lvAdd'); if(b) b.click();}"); pg2.wait_for_timeout(300)     # -> upload overlay
    d = pg2.evaluate("()=>{var pn=document.getElementById('upPanel'); return {dir:getComputedStyle(pn).direction, has:!!document.getElementById('upFile'), open:!document.getElementById('upScrim').hidden, h:(pn.textContent||'')};}")
    ck("(d) AR flips the Library overlay to RTL", d["dir"]=="rtl", d)
    ck("(d) the Library surface renders under AR with the localized heading", d["has"] and d["open"] and ("المكتبة" in d["h"]), d)
    pg2.close(); ctx2.close()

    ck("no uncaught page error", not perr, perr)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LIBRARY-UPLOAD CHECKS PASS"))
raise SystemExit(1 if fails else 0)
