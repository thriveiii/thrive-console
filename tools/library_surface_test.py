"""LIBRARY SURFACE (PR-L1) - task-classified library + editable slug/title/task at upload (board.html).

PR-L1 adds: (A) editable slug/title/task per file in the Library upload review, written to console_pages
(title, task columns); (B) a standalone Library SURFACE reached from the header "المكتبة" that reads ALL
console_pages, groups by task, searches, and shows each template's live link + on-demand preview.

Same mocked Supabase + relay + live-fetch harness. Synthetic *.example.test only. Assertions:
  (a) an upload with a custom slug+title+task writes them to console_pages, and the Library lists the template
      under that task with that title;
  (b) the Library groups templates by task and search filters by title/slug/task;
  (c) each template exposes its live link (liveUrl) + a preview (pageReadHtml -> iframe);
  (d) AR RTL, no letter-spacing on Arabic text.
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

# ---- a REAL zip of ONE html template (documentation) ----------------------------------------------
LIB_ZIP = os.path.join(SCRATCH, "libsurf_one.zip")
def build_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    z.writestr("opp/raw-name/index.html", "<!doctype html><title>Raw</title><h1>Raw Name</h1><p>A documentation template body.</p>")
    z.close()
    with open(LIB_ZIP, "wb") as f: f.write(buf.getvalue())
build_zip()

# ---- stateful server model -----------------------------------------------------------------------
# Seed console_pages with two existing library templates under two tasks (for the surface + grouping).
PAGES = {
  "monthly-alpha": {"slug":"monthly-alpha", "title":"Alpha monthly report", "task":"التقرير الشهري", "html":"<h1>Alpha</h1>", "live_verified_at":"2026-02-01T00:00:00Z", "up":300},
  "leads-beta":    {"slug":"leads-beta",    "title":"Beta lead offer",     "task":"عروض العملاء المحتملين", "html":"<h1>Beta</h1>", "live_verified_at":None, "up":200},
}
OPP_POSTS = []; PAGE_POSTS = []; RELAY_CALLS = []; STAMP = {}; LIVE = {"raw-name":"ok"}

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
def route_empty(r): J(r, [])
def route_board(r): J(r, [])
def route_pnames(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "email":"op@thrive.test"}])
def route_profiles(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":TITLE}])
def route_members(r): J(r, [{"id":UID, "role":"member"}])
def route_opps(r):
    req = r.request
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"): OPP_POSTS.append(row)
        return r.fulfill(status=204, body="")
    if req.method == "PATCH": return r.fulfill(status=204, body="")
    return J(r, [])
def route_pages(r):
    req = r.request; url = req.url
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"):
                PAGE_POSTS.append(row)
                PAGES[row["slug"]] = {"slug":row["slug"], "title":row.get("title"), "task":row.get("task"),
                                      "html":row.get("html",""), "live_verified_at":STAMP.get(row["slug"]), "up":row.get("up",0)}
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":
        slug = slug_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        if slug and body.get("live_verified_at"):
            STAMP[slug] = body["live_verified_at"]
            if slug in PAGES: PAGES[slug]["live_verified_at"] = body["live_verified_at"]
        return r.fulfill(status=204, body="")
    # GET: a single-slug read (activation/preview) or the surface's select-all
    slug = slug_of(url)
    if slug:
        p = PAGES.get(slug)
        return J(r, [p] if p else [])
    # select-all for the Library surface: order by up desc
    rows = sorted(PAGES.values(), key=lambda p: p.get("up") or 0, reverse=True)
    out = [{"slug":p["slug"], "title":p.get("title"), "task":p.get("task"),
            "live_verified_at":p.get("live_verified_at"), "up":p.get("up"), "updated_at":None} for p in rows]
    return J(r, out)
def route_relay(r):
    try: RELAY_CALLS.append(json.loads(r.request.post_data or ""))
    except Exception: RELAY_CALLS.append({"_raw":(r.request.post_data or "")[:120]})
    return J(r, {"ok":True, "id":"x", "relay_version":9})
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
def open_lib_view(pg): pg.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== (a) editable upload: custom slug + title + task written to console_pages =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    open_lib_view(pg)
    ck("(A) header opens the Library SURFACE (#libViewScrim), not the upload overlay", pg.evaluate("()=>{var s=document.getElementById('libViewScrim'); return !!s && !s.hidden;}"))
    # from the surface, "Add templates" opens the upload overlay
    pg.evaluate("()=>{var b=document.getElementById('lvAdd'); if(b) b.click();}"); pg.wait_for_timeout(400)
    ck("(A) 'Add templates' opens the upload overlay (#upScrim) with a file input", pg.evaluate("()=>{var s=document.getElementById('upScrim'); return !!s && !s.hidden && !!document.getElementById('upFile');}"))
    pg.set_input_files("#upFile", LIB_ZIP); pg.wait_for_timeout(900)
    ck("(a) the review row exposes editable slug/title/task inputs",
       pg.evaluate("()=>!!(document.getElementById('libSlug-0') && document.getElementById('libTitle-0') && document.getElementById('libTask-0'))"))
    # set a clean slug, a title, and an existing task
    LIVE["quarterly-note"] = "ok"
    pg.fill("#libSlug-0", "quarterly-note")
    pg.fill("#libTitle-0", "دليل التقرير الربعي")
    pg.fill("#libTask-0", "التقرير الشهري")
    pg.wait_for_timeout(200)
    pg.evaluate("()=>{var b=document.getElementById('libApprove'); if(b) b.click();}")
    pg.wait_for_timeout(1400)
    posted = [r for r in PAGE_POSTS if r.get("slug")=="quarterly-note"]
    ck("(a) the custom slug+title+task were written to console_pages",
       len(posted)==1 and posted[0].get("title")=="دليل التقرير الربعي" and posted[0].get("task")=="التقرير الشهري",
       posted)
    ck("(a) NO console_opps row was written (page-only preserved)", len(OPP_POSTS)==0, OPP_POSTS)

    # ===== (b) the Library surface groups by task and search filters =====
    pg.evaluate("()=>{var b=document.getElementById('lvClose'); if(b) b.click();}"); pg.wait_for_timeout(200)
    open_lib_view(pg)
    pg.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=3;}", timeout=8000)
    pages = pg.evaluate("()=>window.__thriveLibraryPages()")
    ck("(b) the surface read ALL console_pages (3 templates)", isinstance(pages, list) and len(pages)==3, {"n":len(pages) if pages else 0})
    # grouping: the new template lands under its task with its title
    ck("(a/b) the new template lists under its task heading with its title",
       pg.evaluate("""()=>{
         var secs = [].slice.call(document.querySelectorAll('.lv-sec'));
         return secs.some(function(s){ var h=s.querySelector('.lv-task'); return h && h.textContent.indexOf('التقرير الشهري')>=0 && s.textContent.indexOf('دليل التقرير الربعي')>=0; });
       }"""))
    ck("(b) templates are grouped into task sections (>=2 tasks + one card each)",
       pg.evaluate("()=>document.querySelectorAll('.lv-sec').length")>=2, pg.evaluate("()=>document.querySelectorAll('.lv-sec').length"))
    # search filters by task
    pg.fill("#lvQ", "عروض")
    pg.wait_for_timeout(300)
    ck("(b) search by task narrows to the matching template(s)",
       pg.evaluate("()=>document.querySelectorAll('.lv-card').length")==1 and (pg.text_content("#lvBody") or "").find("Beta lead offer")>=0,
       {"cards":pg.evaluate("()=>document.querySelectorAll('.lv-card').length")})
    # search by title
    pg.fill("#lvQ", "Alpha monthly")
    pg.wait_for_timeout(300)
    ck("(b) search by title narrows correctly", pg.evaluate("()=>document.querySelectorAll('.lv-card').length")==1)
    # search by slug
    pg.fill("#lvQ", "leads-beta")
    pg.wait_for_timeout(300)
    ck("(b) search by slug narrows correctly", pg.evaluate("()=>document.querySelectorAll('.lv-card').length")==1)
    pg.fill("#lvQ", "")
    pg.wait_for_timeout(300)

    # ===== (c) each template exposes its live link + preview =====
    ck("(c) each card shows its live link liveUrl(slug) with Copy + Open",
       pg.evaluate("""()=>{
         var c=document.querySelector('.lv-card[data-lib-slug="monthly-alpha"]'); if(!c) return false;
         return c.textContent.indexOf('console.thriveiii.com/opp/monthly-alpha')>=0 && !!c.querySelector('[data-lv-copy]') && !!c.querySelector('[data-lv-open]');
       }"""))
    # live state chip: monthly-alpha is live (stamped), leads-beta is confirming (not stamped)
    ck("(c) the live/confirming state chip reflects live_verified_at",
       pg.evaluate("""()=>{
         var a=document.querySelector('.lv-card[data-lib-slug="monthly-alpha"] .lv-state');
         var bch=document.querySelector('.lv-card[data-lib-slug="leads-beta"] .lv-state');
         return a && bch && a.classList.contains('ok') && !bch.classList.contains('ok');
       }"""))
    # preview: click Preview -> an iframe with the html renders
    pg.evaluate("""()=>{ var c=document.querySelector('.lv-card[data-lib-slug="monthly-alpha"] [data-lv-prev]'); if(c) c.click(); }""")
    pg.wait_for_function("""()=>{ var box=document.getElementById('lvPrev-monthly-alpha'); return box && !box.hidden && box.querySelector('iframe.lv-frame'); }""", timeout=6000)
    ck("(c) Preview renders the template html in a sandboxed iframe",
       pg.evaluate("""()=>{ var f=document.querySelector('#lvPrev-monthly-alpha iframe.lv-frame'); return !!f && (f.getAttribute('srcdoc')||'').indexOf('<h1>Alpha</h1>')>=0 && f.getAttribute('sandbox')===''; }"""))
    pg.close(); ctx.close()

    # ===== (d) AR RTL + no letter-spacing on Arabic =====
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    open_lib_view(pg2)
    pg2.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=2;}", timeout=8000)
    d = pg2.evaluate("""()=>{
      var pn=document.getElementById('libViewPanel');
      var task=document.querySelector('.lv-task');
      var cs=task?getComputedStyle(task):null;
      return { dir:getComputedStyle(pn).direction, h:(pn.textContent||''), ls:cs?cs.letterSpacing:'' };
    }""")
    ck("(d) AR flips the Library surface to RTL", d["dir"]=="rtl", d)
    ck("(d) the Library surface renders under AR with the localized heading", ("المكتبة" in d["h"]) and ("المهمة" in d["h"]), d["h"][:120])
    ck("(d) no letter-spacing on the Arabic task heading", d["ls"] in ("normal","0px",""), d["ls"])
    pg2.close(); ctx2.close()

    # ===== privacy + no error =====
    ck("no uncaught page error", not perr, perr)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LIBRARY-SURFACE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
