"""LIBRARY PROMOTE / REPEAT-PROMOTE (PR-A0) - a template fans out to N recipients as N independent cards.

A Library template is a REUSABLE asset. Promoting it no longer keys the opp on the template slug: each promote
mints its OWN unique opp slug (`<templateSlug>-<shortId>`), sets published:true (so the card is stage 'live' via
the board view WITHOUT a new console_pages row), and stores data.page_slug=templateSlug so every promoted card
points at the ONE shared template page (liveUrl(data.page_slug||slug)). No data.source -> clean personal shape.

Same mocked Supabase + relay harness. Synthetic *.example.test only. Assertions (fails-when-broken):
  (a) promoting one template to recipient A then B creates TWO console_opps rows with DISTINCT slugs, both
      published, both data.page_slug=templateSlug, both with their own recipient;
  (b) the second promote is NOT blocked (repeat-promote works);
  (c) each promoted card is stage 'live' in Operations with NO new console_pages row written;
  (d) the drawer compose link resolves to the TEMPLATE's page URL for both cards (not the unique opp slug);
  plus: the promoted send is the clean personal shape (source unset); AR RTL on the promote box.
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
TPL = "monthly-tpl"; TPL_TITLE = "Monthly report"

# ---- stateful server model -----------------------------------------------------------------------
PAGES = {
  TPL: {"slug":TPL, "title":TPL_TITLE, "task":"التقرير الشهري", "html":"<h1>Monthly</h1>", "live_verified_at":"2026-02-01T00:00:00Z", "up":300},
}
OPPS = {}; OPP_POSTS = []; PAGE_POSTS = []

def slug_of(url):
    m = re.search(r'slug=eq\.([^&]+)', url); return m.group(1) if m else ""

def board_rows():
    # Faithful to docs/supabase-board-view.sql: has_page = published OR a console_pages row exists for the slug.
    out = []
    for slug, opp in OPPS.items():
        data = opp.get("data") or {}
        has_page = bool(opp.get("published")) or (slug in PAGES)              # board-view.sql:208
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
        if slug and slug in OPPS: OPPS[slug].update(body)                    # data.recipients + outreach land here
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
    return pg.evaluate("(s)=>window.__thriveLibraryPromote(s)", slug)   # resolves to the minted opp slug (or false)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    open_lib_view(pg)
    pg.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=1;}", timeout=8000)

    # ===== (a)+(b) promote the SAME template to A, then to B =====
    open_promote(pg, TPL)
    oppA = do_promote(pg, TPL, "alpha@buyer.example.test")
    pg.wait_for_timeout(300)
    ck("(a) first promote minted an opp slug", isinstance(oppA, str) and oppA.startswith(TPL + "-"), oppA)
    # the promote box stays open after a promote; re-fill the SAME input and promote again (no re-toggle)
    oppB = do_promote(pg, TPL, "beta@buyer.example.test")
    pg.wait_for_timeout(300)
    ck("(b) the SECOND promote is NOT blocked (repeat-promote works)", isinstance(oppB, str) and oppB.startswith(TPL + "-"), oppB)
    ck("(a) the two promotes have DISTINCT slugs", isinstance(oppA, str) and isinstance(oppB, str) and oppA != oppB, {"A":oppA, "B":oppB})
    ck("(a) TWO console_opps rows exist for the one template", oppA in OPPS and oppB in OPPS and len(OPPS)==2, list(OPPS.keys()))
    a, bb = OPPS.get(oppA) or {}, OPPS.get(oppB) or {}
    ck("(a) both rows are published:true", a.get("published") is True and bb.get("published") is True, {"A":a.get("published"), "B":bb.get("published")})
    ck("(a) both rows carry data.page_slug == the template slug",
       (a.get("data") or {}).get("page_slug")==TPL and (bb.get("data") or {}).get("page_slug")==TPL,
       {"A":(a.get("data") or {}).get("page_slug"), "B":(bb.get("data") or {}).get("page_slug")})
    ck("(a) business == the template TITLE on both", a.get("business")==TPL_TITLE and bb.get("business")==TPL_TITLE, {"A":a.get("business"), "B":bb.get("business")})
    ra = ((a.get("data") or {}).get("recipients")) or []
    rb = ((bb.get("data") or {}).get("recipients")) or []
    ck("(a) each card has its OWN recipient",
       len(ra)==1 and ra[0].get("addr")=="alpha@buyer.example.test" and len(rb)==1 and rb[0].get("addr")=="beta@buyer.example.test",
       {"A":ra, "B":rb})
    ck("(a) NO data.source on either row (clean personal shape)",
       "source" not in (a.get("data") or {}) and "source" not in (bb.get("data") or {}))

    # ===== (c) each promoted card is stage 'live' with NO new console_pages row =====
    ck("(c) NO console_pages row was written by promote (shared template page reused)", len(PAGE_POSTS)==0, PAGE_POSTS)
    rows = {r["slug"]: r for r in board_rows()}
    ck("(c) both promoted cards are stage 'live' via published (no page row of their own)",
       rows.get(oppA, {}).get("stage")=="live" and rows.get(oppB, {}).get("stage")=="live" and rows.get(oppA, {}).get("has_page") and rows.get(oppB, {}).get("has_page"),
       {"A":rows.get(oppA), "B":rows.get(oppB)})

    # ===== personal shape (source unset) =====
    art = pg.evaluate("(s)=>window.__thriveComposeArtifact(s)", oppA)
    hdr = pg.evaluate("(s)=>window.__thriveSendHeaders(s)", oppA)
    ck("(personal) sendMode derives 'personal' for the promoted 1:1", art and art.get("mode")=="personal", art.get("mode") if art else None)
    ck("(personal) no List-Unsubscribe header", isinstance(hdr, dict) and ("List-Unsubscribe" not in hdr), hdr)

    # ===== (c-cont) the promoted cards appear live in Operations, labeled by the title =====
    pg.evaluate("()=>{var b=document.getElementById('lvClose'); if(b) b.click();}"); pg.wait_for_timeout(300)
    pg.wait_for_function("(s)=>!!document.querySelector('.card[data-slug=\"'+s+'\"]')", arg=oppA, timeout=8000)
    ck("(c) card A is a live Operations card labeled by the template title",
       pg.evaluate("(s)=>{var c=document.querySelector('.card[data-slug=\"'+s+'\"]'); return !!c && c.textContent.indexOf('Monthly report')>=0;}", oppA))
    ck("(c) card B is also present as its own card",
       pg.evaluate("(s)=>!!document.querySelector('.card[data-slug=\"'+s+'\"]')", oppB))

    # ===== (d) the compose link resolves to the TEMPLATE page URL (not the unique opp slug) =====
    # Seed each opp's stored body with the {{LINK}} merge token, then compile through the REAL send path
    # (__thriveComposeArtifact -> oppReadData -> edCompileFrom -> sendCompile). sendCompile substitutes {{LINK}}
    # with liveUrl(data.page_slug||slug); with page_slug=TPL both cards resolve to the ONE shared page URL.
    for opp in (oppA, oppB):
        OPPS[opp].setdefault("data", {})["outreach_text"] = "See {{" + "LINK}} please"
    artA = pg.evaluate("(s)=>window.__thriveComposeArtifact(s)", oppA)
    artB = pg.evaluate("(s)=>window.__thriveComposeArtifact(s)", oppB)
    tpl_url = "console.thriveiii.com/opp/" + TPL
    ck("(d) card A compose link resolves to the TEMPLATE page URL (not the unique opp slug)",
       artA and (tpl_url in (artA.get("html") or "")) and (("/opp/" + oppA) not in (artA.get("html") or "")),
       (artA.get("html") or "")[:300] if artA else None)
    ck("(d) card B compose link ALSO resolves to the shared TEMPLATE page URL",
       artB and (tpl_url in (artB.get("html") or "")) and (("/opp/" + oppB) not in (artB.get("html") or "")),
       (artB.get("html") or "")[:300] if artB else None)

    ck("no uncaught page error", not perr, perr)
    pg.close(); ctx.close()

    # ===== AR RTL: the promote box flips + localized label =====
    ctx2 = b.new_context(); wire(ctx2, lang="ar"); pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    open_lib_view(pg2)
    pg2.wait_for_function("()=>{var b=document.getElementById('lvBody'); return b && b.querySelectorAll('.lv-card').length>=1;}", timeout=8000)
    open_promote(pg2, TPL)
    d = pg2.evaluate("""()=>{
      var box=document.getElementById('lvProm-monthly-tpl');
      var inp=document.getElementById('lvPromIn-monthly-tpl');
      var cs=inp?getComputedStyle(inp):null;
      var b=document.querySelector('.lv-card[data-lib-slug="monthly-tpl"] [data-lv-promote]');
      return { dir:getComputedStyle(box).direction, has_in:!!inp, label:(b?b.textContent:''), ls:cs?cs.letterSpacing:'' };
    }""")
    ck("(AR) the promote box is RTL", d["dir"]=="rtl", d)
    ck("(AR) the Promote action carries the localized label", "أضف مستلماً" in (d["label"] or ""), d["label"])
    ck("(AR) no letter-spacing on the promote input", d["ls"] in ("normal","0px",""), d["ls"])
    pg2.close(); ctx2.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LIBRARY-PROMOTE (REPEAT) CHECKS PASS"))
raise SystemExit(1 if fails else 0)
