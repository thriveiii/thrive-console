"""LIBRARY PROMOTE (PR-L6) - promote a live Library template into a live Operations card (board.html).

From a Library template card (a live console_pages row, slug S, title T from #272), the operator attaches a
recipient (individual or group) and the template becomes a live Operations card: a console_opps row with the
SAME slug S is minted (business = T, and crucially NO data.source, so the send stays the clean personal shape),
the recipient(s) are attached (data.recipients[]), and the board re-reads so the card appears live with the
compose surface open. The page is already live, so the link is born in the Library and wears a message in
Operations.

Same mocked Supabase + relay + live-fetch harness as library_surface_test. Synthetic *.example.test only.
Assertions (fails-when-broken):
  (a) promoting a template creates a console_opps row with the same slug, business=title, NO data.source, and
      data.recipients set (individual = one, group = several);
  (b) the promoted card appears live in Operations with the compose surface (editor + recipient), labeled by T;
  (c) a promoted 1:1 derives the clean personal shape (no open pixel / STOP footer / List-Unsubscribe) because
      data.source is unset -> sendMode == "personal";
  (d) promoting an already-promoted slug does NOT clobber the existing console_opps row (idempotency).
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

UID = "u"; DISPLAY_NAME = "Alice Op"; TITLE = "Growth Lead"

# ---- stateful server model -----------------------------------------------------------------------
# console_pages: three LIVE templates (a page row exists => has_page true in the view).
PAGES = {
  "solo-tpl":  {"slug":"solo-tpl",  "title":"Monthly report", "task":"التقرير الشهري", "html":"<h1>Solo</h1>",  "live_verified_at":"2026-02-01T00:00:00Z", "up":300},
  "group-tpl": {"slug":"group-tpl", "title":"Lead offer",     "task":"عروض العملاء المحتملين", "html":"<h1>Group</h1>", "live_verified_at":"2026-02-02T00:00:00Z", "up":250},
  "taken-tpl": {"slug":"taken-tpl", "title":"Already page",   "task":"التقرير الشهري", "html":"<h1>Taken</h1>", "live_verified_at":"2026-02-03T00:00:00Z", "up":200},
}
# console_opps: pre-seed ONLY taken-tpl (it was promoted before) so the idempotency check has a real hit.
OPPS = {
  "taken-tpl": {"slug":"taken-tpl", "business":"ORIGINAL BUSINESS",
                "data":{"recipients":[{"addr":"orig@keep.example.test","name":"","lang":""}]}},
}
OPP_POSTS = []; PAGE_POSTS = []

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""

def board_rows():
    # Faithful to docs/supabase-board-view.sql: anchored on console_opps, left-joined to console_pages by slug.
    out = []
    for slug, opp in OPPS.items():
        data = opp.get("data") or {}
        has_page = slug in PAGES                                              # a console_pages row exists
        has_email = bool((data.get("outreach_text") or data.get("outreach_subject")))
        stage = "live" if (has_page or has_email) else "draft"               # no sends -> live/draft (view:232-236)
        out.append({"slug":slug, "business":opp.get("business"), "stage":stage,
                    "sent_count":0, "open_count":0, "replied":False, "idle_days":None,
                    "last_activity_ts":None, "has_page":has_page, "has_email":has_email,
                    "archived":bool(opp.get("archived"))})
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
def route_profiles(r): J(r, [{"uid":UID, "display_name":DISPLAY_NAME, "prefs":{}, "signature_title":TITLE}])
def route_members(r): J(r, [{"id":UID, "role":"member"}])
def route_opps(r):
    req = r.request; url = req.url
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"):
                OPP_POSTS.append(row)
                cur = OPPS.get(row["slug"], {"slug":row["slug"]})
                cur.update(row)                                              # merge-duplicates (upsert by slug PK)
                OPPS[row["slug"]] = cur
        return r.fulfill(status=204, body="")
    if req.method == "PATCH":
        slug = slug_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        if slug and slug in OPPS: OPPS[slug].update(body)                    # data.recipients land here (saveRecipients)
        return r.fulfill(status=204, body="")
    slug = slug_of(url)
    if slug:
        o = OPPS.get(slug)
        return J(r, [o] if o else [])
    return J(r, list(OPPS.values()))
def route_pages(r):
    req = r.request; url = req.url
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"): PAGE_POSTS.append(row)
        return r.fulfill(status=204, body="")
    if req.method == "PATCH": return r.fulfill(status=204, body="")
    slug = slug_of(url)
    if slug:
        p = PAGES.get(slug)
        return J(r, [p] if p else [])
    rows = sorted(PAGES.values(), key=lambda p: p.get("up") or 0, reverse=True)
    out = [{"slug":p["slug"], "title":p.get("title"), "task":p.get("task"),
            "live_verified_at":p.get("live_verified_at"), "up":p.get("up"), "updated_at":None} for p in rows]
    return J(r, out)
def route_relay(r): J(r, {"ok":True, "id":"x", "relay_version":9})

def wire(ctx, lang=None):
    init="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));"
    if lang: init += "localStorage.setItem('thrive_lang','"+lang+"');"
    init += "}catch(e){}"
    ctx.add_init_script(init)
    ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
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
def open_lib_view(pg):
    pg.evaluate("()=>{var b=document.getElementById('libBtn'); if(b) b.click();}"); pg.wait_for_timeout(500)
def open_promote(pg, slug):
    pg.evaluate("(s)=>{var b=document.querySelector('.lv-card[data-lib-slug=\"'+s+'\"] [data-lv-promote]'); if(b) b.click();}", slug)
    pg.wait_for_timeout(250)
def do_promote(pg, slug, text):
    pg.fill("#lvPromIn-" + slug, text)
    return pg.evaluate("(s)=>window.__thriveLibraryPromote(s)", slug)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    open_lib_view(pg)
    pg.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=3;}", timeout=8000)
    ck("each Library card exposes a Promote action", pg.evaluate("()=>document.querySelectorAll('.lv-card [data-lv-promote]').length")>=3)

    # ===== (a) individual promote: same slug, business=title, NO source, recipient set =====
    open_promote(pg, "solo-tpl")
    ck("(a) Promote opens a recipient input on the card", pg.evaluate("()=>!!document.getElementById('lvPromIn-solo-tpl')"))
    res = do_promote(pg, "solo-tpl", "buyer@acme.example.test")
    pg.wait_for_timeout(300)
    ck("(a) the promote confirm resolved true (opp minted + recipient attached)", res is True, res)
    solo = OPPS.get("solo-tpl") or {}
    solo_post = [r for r in OPP_POSTS if r.get("slug")=="solo-tpl"]
    ck("(a) a console_opps row was minted with the SAME slug", bool(solo_post) and solo.get("slug")=="solo-tpl", solo_post)
    ck("(a) business == the template TITLE", solo.get("business")=="Monthly report", solo.get("business"))
    ck("(a) NO data.source on the minted opp (personal shape preserved)",
       ("source" not in (solo.get("data") or {})) and all("source" not in (r.get("data") or {}) for r in solo_post),
       {"data":solo.get("data")})
    rec = ((solo.get("data") or {}).get("recipients")) or []
    ck("(a) data.recipients carries the attached individual",
       len(rec)==1 and rec[0].get("addr")=="buyer@acme.example.test", rec)

    # ===== (a-group) group promote: several comma-separated recipients =====
    open_promote(pg, "group-tpl")
    do_promote(pg, "group-tpl", "one@leads.example.test, two@leads.example.test")
    pg.wait_for_timeout(300)
    grec = ((OPPS.get("group-tpl") or {}).get("data") or {}).get("recipients") or []
    ck("(a) a group promote attaches several recipients", len(grec)==2 and (OPPS.get("group-tpl") or {}).get("business")=="Lead offer", grec)

    # ===== (c) a promoted 1:1 compiles to the CLEAN personal shape (source unset -> personal) =====
    art = pg.evaluate("()=>window.__thriveComposeArtifact('solo-tpl')")
    hdr = pg.evaluate("()=>window.__thriveSendHeaders('solo-tpl')")
    ck("(c) sendMode derives 'personal' for the promoted 1:1 (source unset)", art and art.get("mode")=="personal", art.get("mode") if art else None)
    ck("(c) no List-Unsubscribe header on a personal send", isinstance(hdr, dict) and ("List-Unsubscribe" not in hdr), hdr)
    ck("(c) no STOP/postal footer in the personal artifact", art and ("Thrive Digital Solutions" not in (art.get("html") or "")) and ("Thrive Digital Solutions" not in (art.get("text") or "")))
    ck("(c) no open pixel in the personal artifact", art and ("op=hit&type=open" not in (art.get("html") or "")), (art.get("html") or "")[:200] if art else None)

    # ===== (b) the promoted card appears LIVE in Operations with the compose surface, labeled by the title =====
    pg.evaluate("()=>{var b=document.getElementById('lvClose'); if(b) b.click();}"); pg.wait_for_timeout(300)
    pg.wait_for_function("()=>!!document.querySelector('.card[data-slug=\"solo-tpl\"]')", timeout=8000)
    ck("(b) the promoted template is now a live Operations card labeled by the title",
       pg.evaluate("""()=>{ var c=document.querySelector('.card[data-slug="solo-tpl"]'); return !!c && c.textContent.indexOf('Monthly report')>=0; }"""))
    # open the drawer -> the compose surface (editor + recipient) is present, recipient prefilled
    pg.evaluate("""()=>{ var c=document.querySelector('.card[data-slug="solo-tpl"]'); if(c) c.click(); }""")
    pg.wait_for_function("()=>!!document.getElementById('edSubj')", timeout=8000)
    ck("(b) the drawer opens the compose surface (subject + body editor)",
       pg.evaluate("()=>!!(document.getElementById('edSubj') && document.getElementById('edBody'))"))
    ck("(b) the recipient field is present and prefilled with the attached recipient",
       pg.evaluate("""()=>{ var el=document.getElementById('recIn'); return !!el && el.value.indexOf('buyer@acme.example.test')>=0; }"""))
    # the card slug == the template slug, so liveUrl(slug) is the SAME live page by construction; the compose
    # surface offers the Insert-opp-link control (#edLink) that inserts exactly liveUrl(slug).
    same_slug = pg.evaluate("""()=>{ var c=document.querySelector('.card[data-slug="solo-tpl"]'); return !!c && c.getAttribute('data-slug')==='solo-tpl'; }""")
    ck("(b) the drawer's compose surface offers the live-page link control (#edLink), card slug == template slug",
       pg.evaluate("()=>!!document.getElementById('edLink')") and same_slug)
    pg.evaluate("()=>{var s=document.getElementById('scrim'); if(s){var d=document.getElementById('drawer'); } var c=document.getElementById('scrim'); if(c) c.click&&0;}")

    # ===== (d) promoting an already-promoted slug does NOT clobber the existing opp =====
    open_lib_view(pg)
    pg.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=3;}", timeout=8000)
    open_promote(pg, "taken-tpl")
    res_d = do_promote(pg, "taken-tpl", "someoneelse@new.example.test")
    pg.wait_for_timeout(300)
    taken = OPPS.get("taken-tpl") or {}
    trec = (taken.get("data") or {}).get("recipients") or []
    ck("(d) the promote confirm resolved false for an already-promoted slug", res_d is False, res_d)
    ck("(d) NO new console_opps upsert was written for the taken slug", not any(r.get("slug")=="taken-tpl" for r in OPP_POSTS), [r for r in OPP_POSTS if r.get("slug")=="taken-tpl"])
    ck("(d) the existing business was NOT clobbered", taken.get("business")=="ORIGINAL BUSINESS", taken.get("business"))
    ck("(d) the existing recipient was NOT clobbered", len(trec)==1 and trec[0].get("addr")=="orig@keep.example.test", trec)
    ck("(d) the operator is told it is already in Operations",
       (pg.text_content("#lvPromSt-taken-tpl") or "").find("Already in Operations")>=0, pg.text_content("#lvPromSt-taken-tpl"))

    ck("no uncaught page error", not perr, perr)
    pg.close(); ctx.close()

    # ===== AR RTL: the promote surface flips + localized label, no letter-spacing =====
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    open_lib_view(pg2)
    pg2.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=3;}", timeout=8000)
    open_promote(pg2, "solo-tpl")
    d = pg2.evaluate("""()=>{
      var box=document.getElementById('lvProm-solo-tpl');
      var inp=document.getElementById('lvPromIn-solo-tpl');
      var cs=inp?getComputedStyle(inp):null;
      var b=document.querySelector('.lv-card[data-lib-slug="solo-tpl"] [data-lv-promote]');
      return { dir:getComputedStyle(box).direction, has_in:!!inp, label:(b?b.textContent:''), ls:cs?cs.letterSpacing:'' };
    }""")
    ck("(d/AR) the promote box is RTL under Arabic", d["dir"]=="rtl", d)
    ck("(d/AR) the Promote action carries the localized label", "أضف مستلماً" in (d["label"] or ""), d["label"])
    ck("(d/AR) no letter-spacing on the promote input", d["ls"] in ("normal","0px",""), d["ls"])
    pg2.close(); ctx2.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LIBRARY-PROMOTE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
