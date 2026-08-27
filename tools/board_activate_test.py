"""F2 REAL ACTIVATION for GitHub Pages (commit a static opp/<slug>/index.html via the relay). Zero real network.

The live host is GitHub Pages (static files). An uploaded page in console_pages is not served until it is
committed as opp/<slug>/index.html. board.html is a static client and must NOT hold a repo-write token, so on
Activate it POSTs the html to the relay (the same Apps Script used for send), and the relay commits it with a
server-held token. Stateful mock of Supabase REST + the relay (page_publish + send) + the live-page fetch.
Assertions:
  1. Activate POSTs op=page_publish to the relay with the slug and the html; NO GitHub token in any client payload;
  2. the beacon is injected into the html the client hands to the relay (mirror withBeacon);
  3. E2's console_pages write is untouched: activation READS console_pages.html, it does not POST it;
  4. once the live GET returns ok, activation flips to live and a send goes through (one console_mail);
  5. a page that is committed but not yet served shows an honest PUBLISHING state (not live, not a false success);
  6. send is BLOCKED until verify-live returns ok on the real /opp/<slug> URL;
  7. the relay source carries the page_publish op, the GH_TOKEN read, the slug sanitizer, and withBeacon_;
  8. AR RTL uses the تنشيط / مُنشّطة / غير مُنشّطة vocabulary; privacy: synthetic *.example.test only.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
UID = "u"; DISPLAY_NAME = "Alice Op"; TITLE = "Growth Lead"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:600])

# ---- stateful server model (all addresses synthetic *.example.test) ------------------------------
def opp(slug, biz, subject, body, addr):
    return {"slug":slug, "business":biz, "data":{"source":"upload", "page_active":False, "page_live":False,
            "page_publishing":False, "page_dead":False, "page_title":subject,
            "outreach_subject":subject, "outreach_text":body, "recipients":[{"addr":addr, "name":"", "lang":"en"}]}}
OPPS = { "acme-co": opp("acme-co", "Acme Co", "A note for Acme Co", "Hi Acme, here is a page: [LINK]", "buyer.acme@example.test"),
         "fresh-labs": opp("fresh-labs", "Fresh Labs", "Fresh Labs intro", "Hi Fresh Labs: [LINK]", "buyer.fresh@example.test") }
PAGES = { "acme-co": "<!doctype html><html><head><title>Acme Co</title></head><body><h1>Acme Co</h1></body></html>",
          "fresh-labs": "<!doctype html><html><head><title>Fresh Labs</title></head><body><h1>Fresh Labs</h1></body></html>" }
MAIL = []; RELAY_PUBLISH = []; RELAY_SEND = []; PAGE_POSTS = []; OPP_PATCHES = []
LIVE = {}   # slug -> "ok" | "dead"

def sent_count(slug): return sum(1 for m in MAIL if m.get("opp")==slug)
def board_rows():
    rows = []
    for o in OPPS.values():
        d = o.get("data",{}) or {}
        he = bool(str(d.get("outreach_text","")).strip() or str(d.get("outreach_subject","")).strip())
        sc = sent_count(o["slug"])
        stage = "sent" if sc>0 else ("live" if (he or o["slug"] in PAGES) else "draft")
        rows.append({"slug":o["slug"], "business":o.get("business",""), "stage":stage, "sent_count":sc,
          "open_count":0, "replied":False, "idle_days":0, "last_activity_ts":"2026-01-04T00:00:00Z",
          "has_page":o["slug"] in PAGES, "has_email":he, "archived":False})
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
    req = r.request; url = req.url
    if req.method == "PATCH":
        slug = slug_of(url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        o = OPPS.get(slug)
        if o is not None and isinstance(body.get("data"), dict): o["data"] = body["data"]; OPP_PATCHES.append({"slug":slug, "data":body["data"]})
        return r.fulfill(status=204, body="")
    slug = slug_of(url); o = OPPS.get(slug, {"slug":slug, "data":{}})
    return J(r, [{"slug":o["slug"], "data":o.get("data",{})}])
def route_pages(r):
    req = r.request
    if req.method == "POST":
        PAGE_POSTS.append(req.post_data or "")     # F2 must NOT write here; recorded so the test can assert it did not
        return r.fulfill(status=204, body="")
    slug = slug_of(req.url)
    html = PAGES.get(slug)
    return J(r, [{"html":html}] if html is not None else [])
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
    try: payload = json.loads(body)
    except Exception: payload = {"_raw":body[:200]}
    if payload.get("op") == "page_publish":
        RELAY_PUBLISH.append(payload)
        return J(r, {"ok":True, "slug":payload.get("slug",""), "path":"opp/"+payload.get("slug","")+"/index.html", "sha":"deadbeef", "commit":"c0ffee"})
    RELAY_SEND.append(payload)
    return J(r, {"ok":True, "id":"resend_x", "relay_version":9, "delivered":True})
def route_live(r):
    m = re.search(r"/opp/([^/?]+)", r.request.url); slug = m.group(1) if m else ""
    st = LIVE.get(slug)
    if st == "ok": return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<h1>live</h1>")
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
OPEN = """(biz)=>{ var t=null; document.querySelectorAll('.card').forEach(function(c){ if(c.textContent.indexOf(biz)>=0) t=c; }); if(t){ t.click(); return true; } return false; }"""
BEACON = '<script src="/beacon.js" defer></' + 'script>'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== 1-4: the live path - Activate commits via relay (beacon, no token), then live, then send =====
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)
    LIVE["acme-co"] = "ok"                                  # the page is servable at once, so the poll returns live
    pg.evaluate(OPEN, "Acme Co"); pg.wait_for_timeout(400)
    ck("0: the drawer shows the Activate control for an upload opp", pg.evaluate("()=>!!document.getElementById('upActBtn')"))
    pg.evaluate("()=>{var b=document.getElementById('upActBtn'); if(b) b.click();}")
    pg.wait_for_timeout(1600)
    ck("1: Activate POSTed op=page_publish to the relay with the slug", len(RELAY_PUBLISH)==1 and RELAY_PUBLISH[0].get("slug")=="acme-co", RELAY_PUBLISH)
    pub_html = (RELAY_PUBLISH[0] or {}).get("html","") if RELAY_PUBLISH else ""
    ck("1: the published html carries the page content", "<h1>Acme Co</h1>" in pub_html, pub_html[:120])
    ck("2: the beacon was injected into the committed html (mirror withBeacon)", BEACON in pub_html, pub_html[-140:])
    blob = json.dumps(RELAY_PUBLISH) + json.dumps(RELAY_SEND)
    ck("1: NO GitHub token in any client payload to the relay", not re.search(r"ghp_|github_pat|gh_token|GH_TOKEN|Authorization|Bearer", blob), blob[:200])
    ck("3: E2's console_pages write is UNTOUCHED (activation reads it, never POSTs)", len(PAGE_POSTS)==0, PAGE_POSTS)
    ck("4: activation flipped the opp to activated + live", OPPS["acme-co"]["data"].get("page_active")==True and OPPS["acme-co"]["data"].get("page_live")==True, OPPS["acme-co"]["data"])
    st = pg.evaluate("()=>{var e=document.getElementById('upState'); return e?e.className+'|'+e.textContent:'';}")
    ck("4: the drawer shows a live state", "ok" in st and "live" in st.lower(), st)
    # send now goes through (activated + live)
    pg.evaluate("()=>{var b=document.querySelector('#drawer .act[data-act=\"send\"]'); if(b) b.click();}")
    pg.wait_for_timeout(1200)
    ck("4: once activated and live, the send goes through (one console_mail)", sent_count("acme-co")==1, MAIL)
    pg.close(); ctx.close()

    # ===== 5-6: a committed-but-not-yet-served page shows PUBLISHING, and send is blocked until live =====
    ctx2 = b.new_context(); wire(ctx2); pg2 = ctx2.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500); wait_ident(pg2)
    LIVE.pop("fresh-labs", None)                            # not served yet -> live GET 404s during the poll
    pg2.evaluate(OPEN, "Fresh Labs"); pg2.wait_for_timeout(400)
    pg2.evaluate("()=>{var b=document.getElementById('upActBtn'); if(b) b.click();}")
    pg2.wait_for_timeout(11000)                             # the bounded verify-live poll (3 x 3s) then settle
    ck("5: the page committed via the relay (publishing path too)", any(x.get("slug")=="fresh-labs" for x in RELAY_PUBLISH), RELAY_PUBLISH)
    ck("5: a committed-but-unserved page is PUBLISHING, not live and not a false success",
       OPPS["fresh-labs"]["data"].get("page_active")==True and OPPS["fresh-labs"]["data"].get("page_live")==False and OPPS["fresh-labs"]["data"].get("page_publishing")==True, OPPS["fresh-labs"]["data"])
    st2 = pg2.evaluate("()=>{var e=document.getElementById('upState'); return e?e.className+'|'+e.textContent:'';}")
    ck("5: the drawer shows an honest publishing state (not live, not dead)", "publish" in st2.lower(), st2)
    n_before = sent_count("fresh-labs")
    pg2.evaluate("()=>{var b=document.querySelector('#drawer .act[data-act=\"send\"]'); if(b) b.click();}")
    pg2.wait_for_timeout(1000)
    ck("6: send is BLOCKED while the page is not yet live (no console_mail, no relay send)",
       sent_count("fresh-labs")==n_before and not any(c.get("slug")=="fresh-labs" for c in RELAY_SEND), {"mail":sent_count("fresh-labs")})
    stA = pg2.evaluate("()=>{var e=document.getElementById('actStatus'); return e?{txt:e.textContent,cls:e.className}:{};}")
    ck("6: the blocked send shows a RED reason (no phantom success)", "bad" in (stA.get("cls") or ""), stA)
    ck("no uncaught page error (publishing path)", not perr2, perr2)
    pg2.close(); ctx2.close()

    # ===== 7: the relay source carries the publish op, token read, slug sanitizer, beacon =====
    gs = open(os.path.join(ROOT, "relay", "thrive-relay.gs"), encoding="utf-8").read()
    ck("7: relay dispatches op page_publish", "op === 'page_publish'" in gs and "pagePublish_" in gs, None)
    ck("7: relay reads the token from a Script Property (GH_TOKEN), server-side only", "getProperty('GH_TOKEN')" in gs, None)
    ck("7: relay hard-sanitizes the slug to [a-z0-9-]", "^[a-z0-9][a-z0-9-]" in gs, None)
    ck("7: relay only ever writes opp/<slug>/index.html", "'opp/' + slug + '/index.html'" in gs, None)
    ck("7: relay injects the beacon into the committed html", "withBeacon_" in gs and "beacon.js" in gs, None)

    # ===== 8: AR RTL + the تنشيط/مُنشّطة vocabulary =====
    ctx3 = b.new_context(); wire(ctx3, lang="ar"); pg3 = ctx3.new_page()
    pg3.goto(f"{base}/library/board.html", wait_until="load"); pg3.wait_for_timeout(500); wait_ident(pg3)
    pg3.evaluate(OPEN, "Acme Co"); pg3.wait_for_timeout(400)
    d = pg3.evaluate("()=>{var b=document.getElementById('upActBtn'); return b?{txt:b.textContent,dir:getComputedStyle(document.getElementById('drawer')||document.body).direction}:null;}")
    ck("8: AR shows the activate control", bool(d) and (d.get("txt") or "").strip()!="", d)
    ck("8: AR activation vocab uses تنشيط", d and ("تنشيط" in (d.get("txt") or "")), d)
    b_i18n = open(os.path.join(ROOT, "tools", "bundle.js"), encoding="utf-8").read()
    ck("8: the AR dictionary carries مُنشّطة and غير مُنشّطة", "مُنشّطة" in b_i18n and "غير مُنشّطة" in b_i18n, None)
    pg3.close(); ctx3.close()

    # ===== privacy + no error =====
    allblob = json.dumps(RELAY_PUBLISH) + json.dumps(RELAY_SEND) + json.dumps(MAIL) + json.dumps(OPP_PATCHES)
    hosts = [re.split(r'[\s<">,\\]', seg, 1)[0] for seg in re.split(r'@', allblob)[1:] if seg.strip()]
    bad = [h for h in hosts if h and not h.startswith("example.test") and not h.startswith("thrive.test") and not h.startswith("thriveiii.com")]
    ck("PRIVACY: every address is a synthetic placeholder", not bad, bad)
    ck("no uncaught page error (live path)", not perr, perr)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-ACTIVATE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
