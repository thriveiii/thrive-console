"""CARD FATE (PR-CF) - retire won/lost/drop, rich archive, full delete, self-healing Library live indicator.

A card has three fates only: promote/complete, archive, delete. The arbitrary won/lost/drop declarations are
gone. Archive keeps the one opp row (all conversations by slug + notes preserved) and stamps archived_at +
archived_from. Delete is a confirmed full delete of console_opps (+ console_pages ONLY when the card owns its
page - a promoted card shares the template page via data.page_slug and never deletes it). The Library surface
re-verifies any live_verified_at-NULL template in the background: on ok it flips to live (and stamps), on a
persistent failure it flips to a RED fault, never a silent stall.

Mocked Supabase + relay + live-fetch harness. Synthetic *.example.test only. Assertions:
  (a) won/lost/drop buttons AND their handlers are gone; archive + delete are present;
  (b) archiving writes archived_at + archived_from(=the lane) and the card retains its notes + conversation;
  (c) delete (behind a real confirm) removes the opp row, and the page ONLY when unshared;
  (d) a live_verified_at-NULL template re-verifies -> live on ok (+ stamp), RED fault on persistent failure.
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
        if d is not None: print("      " + str(d)[:600])

UID = "u"; DISPLAY_NAME = "Alice Op"

# ---- stateful model -----------------------------------------------------------------------------
# console_opps: alpha (live, note + mail), owns-page (live, owns its page), promoted (live, shares tpl page).
OPPS = {
  "alpha":      {"slug":"alpha",      "business":"Alpha Co", "stage":"live", "archived":False, "data":{"notes":[{"ts":"2026-02-01T10:00:00Z","text":"first contact made","by":UID}]}},
  "owns-page":  {"slug":"owns-page",  "business":"Owns Page","stage":"live", "archived":False, "data":{}},
  "promoted":   {"slug":"promoted",   "business":"Promoted", "stage":"live", "archived":False, "data":{"page_slug":"tpl","recipients":[{"addr":"x@y.example.test","name":"","lang":""}]}},
}
# console_pages: owns-page has its own page; tpl is the shared template; two library templates for part (d).
PAGES = {
  "owns-page": {"slug":"owns-page", "title":"Owns Page",  "task":"", "html":"<h1>Own</h1>", "live_verified_at":"2026-01-01T00:00:00Z", "up":100},
  "tpl":       {"slug":"tpl",       "title":"Template",   "task":"", "html":"<h1>Tpl</h1>", "live_verified_at":"2026-01-01T00:00:00Z", "up":90},
  "lib-ok":    {"slug":"lib-ok",    "title":"Will go live","task":"القوالب","html":"<h1>OK</h1>","live_verified_at":None, "up":80},
  "lib-bad":   {"slug":"lib-bad",   "title":"Broken URL", "task":"القوالب","html":"<h1>Bad</h1>","live_verified_at":None, "up":70},
}
MAIL = { "alpha": [{"id":"m1","opp":"alpha","ts":"2026-02-02T09:00:00Z","data":{"to":"lead@alpha.example.test","subject":"Hello","kind":"outbound"}}] }
DELETED_OPPS = []; DELETED_PAGES = []; PAGE_PATCHES = []; LIVE = {}   # LIVE[slug] = "ok" | absent(404)

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""
def opp_of(url):
    m = re.search(r'opp=eq\.([^&]+)', url); return m.group(1) if m else ""

def board_rows():
    out = []
    for slug, o in OPPS.items():
        data = o.get("data") or {}
        has_page = bool(o.get("published")) or (slug in PAGES) or bool(data.get("page_slug"))
        has_email = bool(data.get("outreach_text") or data.get("outreach_subject"))
        stage = o.get("stage") or ("live" if (has_page or has_email) else "draft")
        out.append({"slug":slug, "business":o.get("business"), "stage":stage, "sent_count":0, "open_count":0,
                    "replied":False, "idle_days":None, "last_activity_ts":None, "has_page":has_page,
                    "has_email":has_email, "archived":bool(o.get("archived"))})
    return out

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
def route_board(r): J(r, board_rows())
def route_pnames(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "email":"op@thrive.test"}])
def route_profiles(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":"T"}])
def route_members(r): J(r, [{"id":UID, "role":"member"}])
def route_mail(r): J(r, MAIL.get(opp_of(r.request.url), []))
def route_opps(r):
    req = r.request; url = req.url; slug = slug_of(url)
    if req.method == "PATCH":
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        if slug and slug in OPPS: OPPS[slug].update(body)
        return r.fulfill(status=204, body="")
    if req.method == "DELETE":
        if slug and slug in OPPS: DELETED_OPPS.append(slug); del OPPS[slug]
        return r.fulfill(status=204, body="")
    if slug:
        o = OPPS.get(slug)
        return J(r, [o] if o else [])
    return J(r, list(OPPS.values()))
def route_pages(r):
    req = r.request; url = req.url; slug = slug_of(url)
    if req.method == "PATCH":
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        if slug: PAGE_PATCHES.append({"slug":slug, "body":body})
        if slug in PAGES and body.get("live_verified_at"): PAGES[slug]["live_verified_at"] = body["live_verified_at"]
        return r.fulfill(status=204, body="")
    if req.method == "DELETE":
        if slug: DELETED_PAGES.append(slug); PAGES.pop(slug, None)
        return r.fulfill(status=204, body="")
    if req.method == "POST": return r.fulfill(status=204, body="")
    if slug:
        p = PAGES.get(slug)
        return J(r, [p] if p else [])
    rows = sorted(PAGES.values(), key=lambda p: p.get("up") or 0, reverse=True)
    return J(r, [{"slug":p["slug"], "title":p.get("title"), "task":p.get("task"),
                 "live_verified_at":p.get("live_verified_at"), "up":p.get("up"), "updated_at":None} for p in rows])
def route_relay(r): J(r, {"ok":True, "id":"x", "relay_version":9})
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
def open_card(pg, slug):
    pg.evaluate("(s)=>{var c=document.querySelector('.card[data-slug=\"'+s+'\"]'); if(c) c.click();}", slug)
    pg.wait_for_function("()=>!!document.getElementById('drawer') && document.getElementById('drawer').querySelector('.act[data-act]')", timeout=8000)
def has_act(pg, act):
    return pg.evaluate("(a)=>!!document.querySelector('#drawer .act[data-act='+JSON.stringify(a)+']')", act)
def click_act(pg, act):
    pg.evaluate("(a)=>{var b=document.querySelector('#drawer .act[data-act='+JSON.stringify(a)+']'); if(b) b.click();}", act)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    pg.wait_for_function("()=>document.querySelectorAll('.card[data-slug]').length>=3", timeout=8000)

    # ===== (a) won/lost/drop are gone; archive + delete are present =====
    open_card(pg, "alpha")
    ck("(a) no 'won' action on the card", not has_act(pg, "won"))
    ck("(a) no 'lost' action on the card", not has_act(pg, "lost"))
    ck("(a) no 'drop' action on the card", not has_act(pg, "drop"))
    ck("(a) archive action IS present", has_act(pg, "archive"))
    ck("(a) delete action IS present", has_act(pg, "delete"))
    # the exhaustive action set on an open 'live' card is exactly {revert, archive, delete} (+ send when eligible) -
    # no fate declarations remain
    acts = pg.evaluate("""()=>[].map.call(document.querySelectorAll('#drawer .act[data-act]'), function(b){return b.getAttribute('data-act');})""")
    ck("(a) the action set carries none of won/lost/drop", not any(a in acts for a in ("won","lost","drop")), acts)

    # ===== (b) archive stamps archived_at + archived_from and keeps notes + conversation =====
    # the note + thread render on the ENRICHED drawer paint (after fetchDetail resolves), so wait for them
    pg.wait_for_function("()=>{var d=document.getElementById('drawer'); return d && d.textContent.indexOf('first contact made')>=0 && d.textContent.indexOf('Hello')>=0;}", timeout=8000)
    ck("(b) the open card shows its note before archiving", ("first contact made" in (pg.text_content("#drawer") or "")))
    ck("(b) the open card shows its sent conversation before archiving", ("Hello" in (pg.text_content("#drawer") or "")))
    click_act(pg, "archive")
    pg.wait_for_timeout(900)
    o = OPPS.get("alpha") or {}
    ck("(b) archive wrote archived:true", o.get("archived") is True, o)
    ck("(b) archive stamped archived_at", bool(o.get("archived_at")), o.get("archived_at"))
    ck("(b) archive stamped archived_from == the lane it was in (live)", o.get("archived_from")=="live", o.get("archived_from"))
    # re-open from the tray: the archived card keeps its note + conversation, and shows the archived facts
    pg.evaluate("()=>{var t=document.getElementById('trayToggle'); if(t) t.click();}"); pg.wait_for_timeout(300)
    open_card(pg, "alpha")
    pg.wait_for_function("()=>{var d=document.getElementById('drawer'); return d && d.textContent.indexOf('first contact made')>=0 && d.textContent.indexOf('Hello')>=0 && !!d.querySelector('.arch-facts');}", timeout=8000)
    dtxt = pg.text_content("#drawer") or ""
    ck("(b) archived card RETAINS its note", "first contact made" in dtxt)
    ck("(b) archived card RETAINS its conversation", "Hello" in dtxt)
    ck("(b) archived card shows the archived-facts section (when + from column)",
       pg.evaluate("()=>{var s=document.querySelector('#drawer .arch-facts'); return !!s && s.textContent.length>0;}"))

    # ===== (c) delete: confirm gate, opp removed, page only when unshared =====
    # c1: a card that OWNS its page -> delete removes BOTH console_opps and console_pages
    open_card(pg, "owns-page")
    click_act(pg, "delete"); pg.wait_for_timeout(300)
    ck("(c) delete is a real confirm: a 'delete_go' confirm button appears, and NOTHING deleted yet",
       has_act(pg, "delete_go") and ("owns-page" not in DELETED_OPPS))
    click_act(pg, "delete_go"); pg.wait_for_timeout(900)
    ck("(c) owns-page: the opp row was deleted", "owns-page" in DELETED_OPPS, DELETED_OPPS)
    ck("(c) owns-page: its OWNED page row was deleted too", "owns-page" in DELETED_PAGES, DELETED_PAGES)
    # c2: a PROMOTED card (data.page_slug set) -> delete removes ONLY the opp, never the shared template page
    pg.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"promoted\"]')", timeout=8000)
    open_card(pg, "promoted")
    click_act(pg, "delete"); pg.wait_for_timeout(250)
    click_act(pg, "delete_go"); pg.wait_for_timeout(900)
    ck("(c) promoted: the opp row was deleted", "promoted" in DELETED_OPPS, DELETED_OPPS)
    ck("(c) promoted: the SHARED template page was NOT deleted", "tpl" not in DELETED_PAGES and "promoted" not in DELETED_PAGES, DELETED_PAGES)
    ck("no uncaught page error (board)", not perr, perr)
    pg.close(); ctx.close()

    # ===== (d) Library live indicator: re-verify NULL templates -> live on ok, RED fault on failure =====
    LIVE["lib-ok"] = "ok"        # this template's live URL resolves
    LIVE.pop("lib-bad", None)    # this one 404s forever
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    pg2.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}"); pg2.wait_for_timeout(500)
    pg2.wait_for_function("()=>document.querySelectorAll('.lv-card').length>=3", timeout=8000)
    ck("(d) both live templates render a state chip on the surface",
       pg2.evaluate("()=>!!document.getElementById('lvState-lib-ok') && !!document.getElementById('lvState-lib-bad')"))
    # drive a fast background re-verify and await it (the auto one on open uses a wide window; this settles fast)
    pg2.evaluate("()=>window.__thriveLibraryReverify(2, 60)")
    try:
        pg2.wait_for_function("""()=>{ var a=document.getElementById('lvState-lib-ok'), b=document.getElementById('lvState-lib-bad');
            return a && b && a.classList.contains('ok') && b.classList.contains('bad'); }""", timeout=8000)
    except Exception:
        pass   # let the ck assertions below report the exact state cleanly rather than crashing
    ck("(d) the buildable template flipped to 'live' (حيّة) on ok",
       pg2.evaluate("""()=>{ var e=document.getElementById('lvState-lib-ok'); return e.classList.contains('ok') && e.textContent.indexOf('حيّة')>=0; }"""))
    ck("(d) live flip STAMPED live_verified_at on console_pages (self-memory)",
       any(pp["slug"]=="lib-ok" and pp["body"].get("live_verified_at") for pp in PAGE_PATCHES), PAGE_PATCHES)
    ck("(d) the un-resolving template flipped to a RED fault (معطّلة), not a silent stall",
       pg2.evaluate("""()=>{ var e=document.getElementById('lvState-lib-bad'); return e.classList.contains('bad') && e.textContent.indexOf('معطّلة')>=0; }"""))
    ck("(d) the faulting template was NOT stamped live",
       not any(pp["slug"]=="lib-bad" and pp["body"].get("live_verified_at") for pp in PAGE_PATCHES), PAGE_PATCHES)
    ck("(d) no letter-spacing on the Arabic state chip",
       pg2.evaluate("""()=>{ var e=document.getElementById('lvState-lib-ok'); var ls=getComputedStyle(e).letterSpacing; return ls==='normal'||ls==='0px'||ls===''; }"""))
    ck("no uncaught page error (library)", not perr2, perr2)
    pg2.close(); ctx2.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CARD-FATE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
