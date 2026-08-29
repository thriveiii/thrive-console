"""ARCHIVE SURFACE + FAULTED-CARD EXIT (PR-AF) - no dead ends.

Archiving used to drop a card into a hidden, unlabeled tray - it vanished. Now the Library has a labeled Archive
tab reading console_opps?archived=eq.true: each archived card shows its title, archived_at, and archived_from
(the column it was archived from), a one-tap open to its full history (the board drawer: notes + conversations +
the archive stamps), and a one-tap Restore (archived=false -> back to its lane). And every un-live card offers a
Re-activate exit - including a PROMOTED card that owns no page row of its own, whose re-activate targets the
SHARED template page (data.page_slug).

Mocked Supabase + relay harness. Synthetic *.example.test only. Assertions:
  (a) an archived card appears in the Library Archive with archived_at + archived_from and opens its full history;
  (b) Restore returns it to its lane (archived=false) and it leaves the archive list;
  (c) a promoted un-live card shows a Re-activate action that targets its page_slug (the shared template page);
  (d) no archived card is invisible (it is listed in the Archive tab).
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
OPPS = {
  # an archived card that "vanished" - it carries a note (full history) + the archive stamps
  "newmsg": {"slug":"newmsg", "business":"رسالة جديدة", "stage":"live", "archived":True,
             "archived_at":"2026-02-10T09:30:00Z", "archived_from":"live",
             "data":{"notes":[{"ts":"2026-02-09T08:00:00Z","text":"reached the buyer","by":UID}]}},
  # a promoted card that shares the template page (data.page_slug) and owns no page row of its own
  "promo":  {"slug":"promo", "business":"Promoted Card", "stage":"live", "archived":False,
             "data":{"page_slug":"tpl", "recipients":[{"addr":"x@y.example.test","name":"","lang":""}]}},
}
PAGES = { "tpl": {"slug":"tpl", "title":"Template", "task":"", "html":"<h1>Tpl</h1>", "live_verified_at":None, "up":90} }
OPP_PATCHES = []

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""

def board_rows():
    out=[]
    for slug,o in OPPS.items():
        data=o.get("data") or {}
        has_page = bool(o.get("published")) or (slug in PAGES) or bool(data.get("page_slug"))
        has_email = bool(data.get("outreach_text") or data.get("outreach_subject"))
        stage = o.get("stage") or ("live" if (has_page or has_email) else "draft")
        out.append({"slug":slug,"business":o.get("business"),"stage":stage,"sent_count":0,"open_count":0,
                    "replied":False,"idle_days":None,"last_activity_ts":None,"has_page":has_page,
                    "has_email":has_email,"archived":bool(o.get("archived"))})
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
def route_pnames(r): J(r, [{"uid":UID,"display_name":DISPLAY_NAME,"email":"op@thrive.test"}])
def route_profiles(r): J(r, [{"uid":UID,"display_name":DISPLAY_NAME,"prefs":{},"signature_title":"T"}])
def route_members(r): J(r, [{"id":UID,"role":"member"}])
def route_mail(r): J(r, [])
def route_opps(r):
    req=r.request; url=req.url; slug=slug_of(url)
    if req.method=="PATCH":
        try: body=json.loads(req.post_data or "{}")
        except Exception: body={}
        OPP_PATCHES.append({"slug":slug,"body":body})
        if slug and slug in OPPS: OPPS[slug].update(body)
        return r.fulfill(status=204, body="")
    if req.method=="DELETE":
        if slug and slug in OPPS: del OPPS[slug]
        return r.fulfill(status=204, body="")
    if "archived=eq.true" in url:
        return J(r, [o for o in OPPS.values() if o.get("archived")])
    if slug:
        o=OPPS.get(slug); return J(r, [o] if o else [])
    return J(r, list(OPPS.values()))
def route_pages(r):
    req=r.request; url=req.url; slug=slug_of(url)
    if req.method in ("PATCH","POST"): return r.fulfill(status=204, body="")
    if slug:
        p=PAGES.get(slug); return J(r, [p] if p else [])
    rows=sorted(PAGES.values(), key=lambda p:p.get("up") or 0, reverse=True)
    return J(r, [{"slug":p["slug"],"title":p.get("title"),"task":p.get("task"),
                 "live_verified_at":p.get("live_verified_at"),"up":p.get("up"),"updated_at":None} for p in rows])
def route_relay(r): J(r, {"ok":True,"id":"x","relay_version":9})
def route_live(r): r.fulfill(status=404, body="nf")   # nothing is servable here (promoted page stays un-live)

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init+="localStorage.setItem('thrive_lang','"+lang+"');"
    init+="}catch(e){}"
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
def open_archive_tab(pg):
    pg.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}"); pg.wait_for_timeout(400)
    pg.evaluate("()=>{var b=document.getElementById('lvTabArch'); if(b) b.click();}")
    pg.wait_for_function("()=>{var e=document.getElementById('lvBody'); return e && (e.querySelector('.lv-arch') || e.querySelector('.lv-empty'));}", timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== (c) promoted un-live card: Re-activate targets the shared page_slug =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    pg.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"promo\"]')", timeout=8000)
    pg.evaluate("()=>{var c=document.querySelector('.card[data-slug=\"promo\"]'); if(c) c.click();}")
    pg.wait_for_function("()=>!!document.getElementById('upActBtn')", timeout=8000)
    ck("(c) a promoted un-live card offers a Re-activate exit", pg.evaluate("()=>!!document.getElementById('upActBtn')"))
    ck("(c) the Re-activate targets the SHARED template page (data.page_slug), not the card slug",
       pg.evaluate("()=>document.getElementById('upActBtn').getAttribute('data-page-slug')")=="tpl",
       pg.evaluate("()=>document.getElementById('upActBtn').getAttribute('data-page-slug')"))
    ck("no uncaught page error (board)", not perr, perr)
    pg.close(); ctx.close()

    # ===== (a)(b)(d) Library Archive: visible, stamps, history, restore =====
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    open_archive_tab(pg2)

    ck("(d) the archived card is NOT invisible: it is listed in the Library Archive",
       pg2.evaluate("()=>!!document.querySelector('.lv-arch[data-arch-slug=\"newmsg\"]')"))
    card_txt = pg2.evaluate("()=>{var c=document.querySelector('.lv-arch[data-arch-slug=\"newmsg\"]'); return c?c.textContent:'';}")
    ck("(a) the archive card shows its title", "رسالة جديدة" in card_txt, card_txt)
    ck("(a) the archive card shows archived_at (the timestamp)", "2026-02-10" in card_txt, card_txt)
    ck("(a) the archive card shows archived_from (the localized lane it was archived from)", "جاهزة" in card_txt, card_txt)

    # (a) open full history -> the board drawer shows the note + the archive stamps
    pg2.evaluate("()=>{var b=document.querySelector('.lv-arch[data-arch-slug=\"newmsg\"] [data-lv-arch-open]'); if(b) b.click();}")
    pg2.wait_for_function("()=>{var d=document.getElementById('drawer'); return d && d.textContent.indexOf('reached the buyer')>=0;}", timeout=8000)
    ck("(a) opening the archive card opens its FULL history (notes + archive stamps in the drawer)",
       pg2.evaluate("""()=>{ var d=document.getElementById('drawer'); return d.textContent.indexOf('reached the buyer')>=0 && !!d.querySelector('.arch-facts'); }"""))
    # close the drawer, go back to the archive tab
    pg2.evaluate("()=>{var s=document.getElementById('scrim'); if(s) s.hidden=true;}")

    # (b) Restore -> archived=false, and it leaves the archive list
    open_archive_tab(pg2)
    pg2.evaluate("()=>{var b=document.querySelector('.lv-arch[data-arch-slug=\"newmsg\"] [data-lv-restore]'); if(b) b.click();}")
    try:
        pg2.wait_for_function("()=>!document.querySelector('.lv-arch[data-arch-slug=\"newmsg\"]')", timeout=8000)
    except Exception:
        pass   # let the ck assertions below report the exact state cleanly rather than crashing
    restored = [pp for pp in OPP_PATCHES if pp["slug"]=="newmsg" and pp["body"].get("archived") is False]
    ck("(b) Restore wrote archived=false to the opp", bool(restored), OPP_PATCHES)
    ck("(b) the restored card left the archive list", not OPPS.get("newmsg", {}).get("archived"), OPPS.get("newmsg"))
    ck("(b) the Archive now shows the empty state (the card returned to its lane)",
       pg2.evaluate("()=>!!document.querySelector('#lvBody .lv-empty')"))
    ck("(AR) the archive tab label is localized",
       pg2.evaluate("()=>{var t=document.getElementById('lvTabArch'); return t && t.textContent.indexOf('الأرشيف')>=0;}"))
    ck("no uncaught page error (library)", not perr2, perr2)
    pg2.close(); ctx2.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ARCHIVE-FAULT CHECKS PASS"))
raise SystemExit(1 if fails else 0)
