"""LIBRARY PUBLISH RELIABILITY (PR-L0) - commit != verify, publish timeout (board.html, fails-when-broken).

Root cause (LIBRARY_PUBLISH_EVIDENCE, main HEAD 2dee99a): a page_publish commits to GitHub (GET sha + PUT,
seconds each) but the client aborted it at the 6s sign-in timeout and reported "could not publish" even though
the commit LANDED; a committed-but-not-yet-live page (Pages build lag) was also read as a failure.

PR-L0 fixes, all in the publish/verify REPORTING (send path untouched):
  1. LONGER PUBLISH TIMEOUT: pagePublishRelay -> relayPost passes PAGE_PUBLISH_TIMEOUT_MS (30000), independent
     of the 6000ms sign-in timeout.
  2. COMMIT != VERIFY: a relay {ok:true} is PUBLISHED; verifyLivePoll runs as a NON-BLOCKING follow-up. A
     committed-but-not-live page shows "confirming", NEVER "could not publish".
  3. DISTINGUISH TIMEOUT: a client timeout on page_publish is NOT a failure (idempotent commit).

Same mocked Supabase + relay + live-fetch harness. The relay route can DELAY to exercise the timeout boundary.
Assertions:
  (a) a page_publish that takes ~7s (> 6s sign-in bound, < 30s publish bound) SUCCEEDS - reported published,
      not failed (fails-when-broken: with the old 6s bound it would abort);
  (b) a committed-but-not-yet-live page (relay ok, live-fetch 404) reports published/confirming, NEVER
      up_commit_failed;
  (c) a batch of 4 files, all committed by the relay, all report published (ok), zero console_opps.
"""
import os, re, json, time, threading, http.server, socketserver, functools
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
OPPS = {}; PAGES = {}; OPP_POSTS = []; PAGE_POSTS = []; RELAY_CALLS = []
STAMP = {}; LIVE = {}
RELAY_DELAY = {"ms": 0}   # optional per-request delay (seconds) to exercise the timeout boundary

def board_rows():
    return []
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
    if req.method == "POST":
        try: rows = json.loads(req.post_data or "[]")
        except Exception: rows = []
        for row in (rows if isinstance(rows, list) else [rows]):
            if isinstance(row, dict) and row.get("slug"): OPP_POSTS.append(row); OPPS[row["slug"]] = row
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
    if req.method == "PATCH":
        slug = slug_of(req.url)
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        if slug and body.get("live_verified_at"): STAMP[slug] = body["live_verified_at"]
        return r.fulfill(status=204, body="")
    slug = slug_of(req.url)
    return J(r, [{"slug":slug, "html":PAGES[slug], "live_verified_at":STAMP.get(slug)}] if slug in PAGES else [])
def route_relay(r):
    # The relay page_publish: optionally DELAY (to exercise the client timeout boundary), then return {ok:true}
    # as GitHub would after a successful commit.
    d = RELAY_DELAY["ms"]
    if d: time.sleep(d/1000.0)
    body = r.request.post_data or ""
    try: RELAY_CALLS.append(json.loads(body))
    except Exception: RELAY_CALLS.append({"_raw":body[:200]})
    return J(r, {"ok":True, "id":"resend_x", "relay_version":9, "slug":"x", "commit":"deadbeef"})
def route_live(r):
    m = re.search(r"/opp/([^/?]+)", r.request.url); slug = m.group(1) if m else ""
    if LIVE.get(slug) == "ok": return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<h1>live</h1>")
    return r.fulfill(status=404, body="not found")

def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+UID+"'}));}catch(e){}")
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
def plan_of(slugs):
    return {"rows": [{"slug":s, "title":s.title(), "page":{"html":"<h1>"+s+"</h1>"}} for s in slugs]}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(); wire(ctx); pg = ctx.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500); wait_ident(pg)

    # ===== (a) a page_publish that takes ~7s (> 6s sign-in bound, < 30s publish bound) SUCCEEDS =====
    LIVE["slow-one"] = "ok"
    RELAY_DELAY["ms"] = 7000            # slower than FETCH_TIMEOUT_MS (6000), faster than PAGE_PUBLISH_TIMEOUT_MS (30000)
    res = pg.evaluate("""async()=>{ return await window.__thriveLibraryCommit({rows:[{slug:'slow-one', title:'Slow One', page:{html:'<h1>slow</h1>'}}]}); }""")
    RELAY_DELAY["ms"] = 0
    # fails-when-broken discriminator: with the 30s publish bound the 7s commit RETURNS (published, not
    # confirming). Revert the override (back to 6s) and the same commit aborts at 6s -> confirming:true.
    ck("(a) a >6s (<30s) page_publish RETURNS published (commit not aborted by the 6s bound)",
       isinstance(res, list) and len(res)==1 and res[0].get("ok")==True and res[0].get("published")==True and not res[0].get("confirming"),
       res)
    ck("(a) the slow commit actually reached the relay (op=page_publish)",
       any(c.get("op")=="page_publish" and c.get("slug")=="slow-one" for c in RELAY_CALLS), RELAY_CALLS)

    # ===== (b) committed but NOT yet live -> confirming, never up_commit_failed =====
    # relay commits ok (no delay), but the live fetch stays 404 (Pages still building).
    LIVE["building-one"] = "dead"       # live fetch returns 404
    res_b = pg.evaluate("""async()=>{ return await window.__thriveLibraryCommit({rows:[{slug:'building-one', title:'Building One', page:{html:'<h1>b</h1>'}}]}); }""")
    ck("(b) a committed-but-not-live page is PUBLISHED (ok), never a failure", res_b[0].get("ok")==True and res_b[0].get("published")==True, res_b)
    done_b = pg.evaluate("()=>window.__thriveLibraryDoneHtml([{slug:'building-one', title:'Building One', ok:true, published:true, live:false, link:'x'}])")
    ck("(b) the done panel shows 'confirming' (going live), NEVER 'could not publish'",
       ("Published (going live)" in done_b) and ("Could not publish" not in done_b) and ("تعذّر نشر الصفحة" not in done_b), done_b[:300])

    # ===== (c) a batch of 4, all committed -> all published, zero console_opps =====
    for s in ["b1","b2","b3","b4"]: LIVE[s] = "ok"
    res_c = pg.evaluate("""async()=>{ return await window.__thriveLibraryCommit({rows:[
        {slug:'b1',title:'B1',page:{html:'<h1>1</h1>'}},
        {slug:'b2',title:'B2',page:{html:'<h1>2</h1>'}},
        {slug:'b3',title:'B3',page:{html:'<h1>3</h1>'}},
        {slug:'b4',title:'B4',page:{html:'<h1>4</h1>'}}
      ]}); }""")
    okN = sum(1 for x in res_c if x.get("ok") and x.get("published"))
    ck("(c) a batch of 4 committed files ALL report published (4/4)", okN==4, res_c)
    ck("(c) all 4 wrote a console_pages row", all(s in PAGES for s in ["b1","b2","b3","b4"]), list(PAGES.keys()))
    ck("(c) ZERO console_opps rows from the Library batch (page-only preserved)", len(OPP_POSTS)==0, OPP_POSTS)
    done_c = pg.evaluate("(r)=>window.__thriveLibraryDoneHtml(r)", res_c)
    ck("(c) the done panel reports none as 'could not publish'",
       "Could not publish" not in done_c and "تعذّر نشر الصفحة" not in done_c, done_c[:200])

    # ===== a REAL relay error IS still a failure (the mapping did not go too far) =====
    done_err = pg.evaluate("()=>window.__thriveLibraryDoneHtml([{slug:'bad-one', title:'Bad One', ok:false, kind:'relayreject'}])")
    ck("a genuine relay error still reports 'could not publish' (not masked)",
       "Could not publish" in done_err and "Not published" in done_err, done_err[:200])

    ck("no uncaught page error", not perr, perr)
    pg.close(); ctx.close(); b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL LIBRARY-PUBLISH CHECKS PASS"))
raise SystemExit(1 if fails else 0)
