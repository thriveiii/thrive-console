"""BUG 1 + BUG 2 (board.html, fails-when-broken, ZERO network).

BUG 1: a campaign zip whose page slugs ALREADY EXIST in console_pages must not drop the message or leave an
empty card. The commit now auto-suffixes a taken slug to a free one (bards-alley-2) and commits the page + its
message + recipient under it. Part A proves: a 2-folder campaign whose BOTH slugs already exist commits 2
cards, each auto-suffixed, each carrying its outreach_subject + outreach_text + a recipient - zero empty cards.
Fails-when-broken: revert libCollectRows(true) so the taken slug blocks -> zero cards commit (see the proof run).

BUG 2: a Library page card gains a Delete action that removes ONLY that one console_pages row. Part B proves:
a seeded template can be deleted (a DELETE hits console_pages?slug=eq.<slug>) and is gone from the list.

Drives the REAL board (window Full-campaign commit; the Library surface delete). Pure Python + Playwright.
Run: python3 tools/upload_dup_and_lib_delete_test.py
"""
import os, re, io, json, zipfile, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = os.environ.get("SCRATCH", "/tmp/claude-0")
os.makedirs(SCRATCH, exist_ok=True)

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- a 2-folder campaign zip; both folder slugs will already exist in console_pages ----
FOLDERS = [("bards-alley", "buyer.bards@example.test", "The Del Ray opening"),
           ("fresh-labs",  "buyer.fresh@example.test", "Fresh Labs, online")]
ZIP_PATH = os.path.join(SCRATCH, "dup_campaign.zip")
def build_zip():
    buf = io.BytesIO(); z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    for folder, to, subject in FOLDERS:
        z.writestr("%s/index.html" % folder, "<!doctype html><title>%s</title><h1>%s</h1>" % (folder, folder))
        # a heading that does NOT match the folder (folder-pairing attaches it anyway), a Subject line, a json {"to"}
        md = ("# A note unrelated to the folder name\nSubject: %s\n{\"to\":\"%s\"}\n\nHi %s team,\n\nOffer: [LINK]\n" % (subject, to, folder))
        z.writestr("%s/msg.md" % folder, md)
    z.close()
    with open(ZIP_PATH, "wb") as f: f.write(buf.getvalue())
build_zip()

# ---- stateful server: console_pages already holds BOTH campaign slugs, plus a Library template to delete ----
OPPS = {}; OPP_POSTS = []; PAGE_POSTS = []; PAGE_DELETES = []
PAGES = {
  "bards-alley": {"slug":"bards-alley", "html":"<h1>old bards</h1>", "title":"Old Bards", "task":"", "live_verified_at":"2026-01-01T00:00:00Z"},
  "fresh-labs":  {"slug":"fresh-labs",  "html":"<h1>old fresh</h1>", "title":"Old Fresh", "task":"", "live_verified_at":"2026-01-01T00:00:00Z"},
  "tpl-delete-me": {"slug":"tpl-delete-me", "html":"<h1>template</h1>", "title":"Deletable Template", "task":"welcome", "live_verified_at":"2026-01-01T00:00:00Z"},
}
def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=ROOT)); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r, o): r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(o))
def empt(r): J(r, [])
def route_opps(r):
    q = r.request
    if q.method == "POST":
        for row in json.loads(q.post_data or "[]"):
            if row.get("slug"): OPP_POSTS.append(row); OPPS[row["slug"]] = row
        return r.fulfill(status=204, body="")
    if q.method == "PATCH": return r.fulfill(status=204, body="")
    s = slug_of(q.url); return J(r, [{"slug":s, "data":(OPPS.get(s, {}).get("data", {}))}])
def route_pages(r):
    q = r.request
    if q.method == "POST":
        for row in json.loads(q.post_data or "[]"):
            if row.get("slug"): PAGE_POSTS.append(row); PAGES[row["slug"]] = row
        return r.fulfill(status=204, body="")
    if q.method == "PATCH": return r.fulfill(status=204, body="")
    if q.method == "DELETE":
        s = slug_of(q.url)
        if s: PAGE_DELETES.append(s); PAGES.pop(s, None)
        return r.fulfill(status=204, body="")
    s = slug_of(q.url)
    if s:
        p = PAGES.get(s); return J(r, [{"slug":s, "html":p.get("html",""), "live_verified_at":p.get("live_verified_at")}] if p else [])
    return J(r, [{"slug":p["slug"], "title":p.get("title"), "task":p.get("task"), "live_verified_at":p.get("live_verified_at"), "up":1, "updated_at":"2026-01-01T00:00:00Z"} for p in PAGES.values()])
def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:9999999999,email:'op@x',uid:'u1'}));}catch(e){}")
    ctx.route("**/rest/v1/**", empt); ctx.route("**/rest/v1/console_board**", empt)
    ctx.route("**/rest/v1/console_suppressions**", empt)
    ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, [{"uid":"u1","display_name":"Op","email":"op@x"}]))
    ctx.route("**/rest/v1/console_profiles**", lambda r: J(r, [{"uid":"u1","display_name":"Op","prefs":{}}]))
    ctx.route("**/rest/v1/console_members**", empt)
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_pages**", route_pages)
    ctx.route("**/rest/v1/console_mail**", empt); ctx.route("**/rest/v1/console_hits**", empt); ctx.route("**/rest/v1/console_inbound**", empt)
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True, "id":"x"}))
    ctx.route(re.compile(r"console\.thriveiii\.com/opp/.*"), lambda r: r.fulfill(status=200, body="<h1>live</h1>"))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(600)

    # ===================== BUG 1 (A): a campaign whose slugs already exist commits N cards WITH messages =====================
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_timeout(150)
    pg.evaluate("()=>window.owSelectMode('b')"); pg.wait_for_timeout(150)
    pg.click('#owTabs [data-ow-tab="page"]'); pg.wait_for_timeout(150)
    pg.click("#owPathUpload"); pg.wait_for_timeout(150)                 # unified upload path (single page or multi-page zip)
    pg.set_input_files("#owUploadFile", ZIP_PATH); pg.wait_for_timeout(1500)
    plan = pg.evaluate("()=>window.__thriveUploadPlan()")
    prows = (plan or {}).get("rows", [])
    ck("A: the plan holds both folder rows, each with its message + recipient (folder-pairing)",
       len(prows) == 2 and all(r.get("email") and "no_message" not in (r.get("warnings") or []) for r in prows),
       [(r.get("slug"), r.get("email")) for r in prows])

    pg.click("#owCommit")
    # wait for the commit to settle (status becomes ok/warn/bad)
    for _ in range(40):
        cls = pg.evaluate("()=>{var e=document.getElementById('owCommitStatus');return e?e.className:'';}")
        if "ok" in cls or "warn" in cls or "bad" in cls: break
        pg.wait_for_timeout(150)
    pg.wait_for_timeout(500)

    ck("A: TWO cards were committed (not zero: a taken slug no longer blocks the whole batch)",
       len(OPP_POSTS) == 2, [o.get("slug") for o in OPP_POSTS])
    ck("A: each committed card is AUTO-SUFFIXED off the taken slug (bards-alley-2 / fresh-labs-2)",
       sorted(o.get("slug") for o in OPP_POSTS) == ["bards-alley-2", "fresh-labs-2"], [o.get("slug") for o in OPP_POSTS])
    def data_of(row): return (row.get("data") or {})
    empties = [o.get("slug") for o in OPP_POSTS if not (str(data_of(o).get("outreach_text","")).strip() and (data_of(o).get("recipients") or []))]
    ck("A: ZERO empty cards: every committed card carries its message body AND a recipient", empties == [], empties)
    # the message + recipient survived the rename, matched to the RIGHT folder
    bards = [o for o in OPP_POSTS if o.get("slug") == "bards-alley-2"]
    ck("A: the renamed card kept its own message + recipient (bards-alley-2 <- bards-alley)",
       bool(bards) and (data_of(bards[0]).get("recipients") or [{}])[0].get("addr") == "buyer.bards@example.test"
       and "Del Ray" in str(data_of(bards[0]).get("outreach_subject","")), bards[0] if bards else None)
    ck("A: the pre-existing pages were NOT overwritten (the new pages committed under the suffixed slugs)",
       "bards-alley-2" in [pp.get("slug") for pp in PAGE_POSTS] and "fresh-labs-2" in [pp.get("slug") for pp in PAGE_POSTS],
       [pp.get("slug") for pp in PAGE_POSTS])
    pg.evaluate("()=>window.closeOppWindow && window.closeOppWindow()"); pg.wait_for_timeout(200)

    # ===================== BUG 2 (B): a Library page can be deleted and is gone =====================
    pg.click("#libBtn")                                          # the Library surface opens from the header
    pg.wait_for_selector("#lvBody [data-lib-slug='tpl-delete-me']", timeout=6000); pg.wait_for_timeout(200)
    ck("B: the Library card offers a Delete action", pg.evaluate("()=>!!document.querySelector(\"[data-lv-del='tpl-delete-me']\")"))
    # open the confirm, then confirm the delete through the two-tap UI
    pg.click("[data-lv-del='tpl-delete-me']"); pg.wait_for_timeout(200)
    ck("B: clicking Delete opens an inline confirm (not an immediate destructive delete)",
       pg.evaluate("()=>{var box=document.getElementById('lvDel-tpl-delete-me'); return !!box && !box.hidden && !!box.querySelector('.lv-del-go');}"))
    before = len(PAGE_DELETES)
    pg.evaluate("()=>{var g=document.querySelector('#lvDel-tpl-delete-me .lv-del-go'); if(g) g.click();}")
    pg.wait_for_timeout(700)
    ck("B: confirming issued a DELETE for ONLY that page (console_pages?slug=eq.tpl-delete-me)",
       PAGE_DELETES[before:] == ["tpl-delete-me"], PAGE_DELETES)
    ck("B: the deleted page is GONE from the Library list",
       pg.evaluate("()=>!document.querySelector(\"#lvBody [data-lib-slug='tpl-delete-me']\")"))
    ck("B: the OTHER pages are untouched (only the one page was deleted)",
       PAGE_DELETES == ["tpl-delete-me"] and "bards-alley" in PAGES, {"deletes":PAGE_DELETES, "pages":list(PAGES.keys())})

    ck("no page errors were thrown", len(perr) == 0, perr)
    pg.close(); ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL UPLOAD-DUP + LIB-DELETE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
