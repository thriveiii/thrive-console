"""PR-A PUBLISH TRUTH (board.html, fails-when-broken).

Live fault: Basel's uploaded pages (sheraton-kuwait, four-seasons-kuwait, regency-kuwait) were written to
console_pages but never committed to GitHub, yet the card read "Published, going live shortly" forever and the
Page tab showed a "Live link". The send live-gate correctly refused them. PR-A makes publishing truthful:

  (a) a member's publish COMMITS through the relay or REPORTS the failure: a confirmed {ok:true} goes to
      Publishing and then Live after the real fetch + stamp; an {ok:false} shows "Not published" with the relay's
      own reason; a 2xx with no publish result (an Apps Script error page) is a failure, never a success.
  (b) the Page tab never claims "Live link" for an unpublished page; it shows the state + a one-tap Publish. A
      page proven live (live_verified_at) shows the live link.
  (c) the send gate still blocks a page whose link does not resolve (no relay send call), and its message is
      actionable (a Publish button beside it).
  (d) static: positive-confirmation check, gate still strict, unifiedSend -> runSend intact, canon hygiene.
"""
import os, re, json, threading, http.server, socketserver, functools, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()

# ---- (d) static ------------------------------------------------------------------------------------
ck("(d) publish success requires a POSITIVE relay confirmation (d.ok !== true is a refusal)",
   re.search(r"function pagePublishRelay[\s\S]{0,1400}d\.ok !== true", src) is not None)
ck("(d) a 2xx with no publish result is a refusal, never a success",
   re.search(r"function pagePublishRelay[\s\S]{0,1400}typeof d !== \"object\"[\s\S]{0,300}relayreject", src) is not None)
ck("(d) the send live-gate still blocks a dead page (deny deadlink on 404/410)",
   re.search(r"function upSendLiveGate[\s\S]{0,1600}if\(v\.dead\) deny\(\"deadlink\"\)", src) is not None)
ck("(d) the Page tab prints the live link ONLY in the live branch",
   re.search(r'st\.key==="live"\)\s*\?\s*\'<div class="cr-field"><span class="cr-k">\'\+esc\(t\("lib_link"\)\)', src) is not None)
ck("(d) the send path is untouched: unifiedSend -> runSend",
   re.search(r"function unifiedSend[\s\S]{0,3200}runSend\(slug\)", src) is not None)
ck("(d) no em dash", "—" not in src)
ck("(d) itfGhroob 0 refs", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(d) no dusty rose " + lit, lit not in src)

# ---- browser harness -------------------------------------------------------------------------------
U_BASEL = "u_basel"
SLUG = "sheraton-kuwait"
LIVE_SLUG = "live-page"
PAGE_HTML = "<html><head><title>Sheraton</title></head><body><h1>Sheraton Kuwait Marks 60 Years</h1></body></html>"
OLD_UP = 1790749564496   # 2026-09-29, far outside the deploy window
BOARD = [
  {"slug":SLUG,"business":"Sheraton Kuwait Marks 60 Years","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-09-29T19:55:05Z","has_page":False,"has_email":True,"archived":False,"cycle":"cyabc"},
  {"slug":LIVE_SLUG,"business":"A Live Page","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-09-20T00:00:00Z","has_page":True,"has_email":True,"archived":False,"cycle":"cylive"},
]
DATA = {"source":"upload","page_title":"Sheraton","outreach_subject":"Sixty years","outreach_text":"Hello, a page for you.",
        "recipients":[{"addr":"gm@sheraton.example","name":"","lang":"en"}]}
LDATA = dict(DATA); LDATA["page_title"]="Live"

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class TSrv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
httpd = TSrv(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r, o, s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))

def make(relay_mode):
    st = {"committed":False, "relay":[], "stamps":[], "touch":[]}
    def route_relay(r):
        try: body = json.loads(r.request.post_data or "{}")
        except Exception: body = {}
        st["relay"].append(body)
        if body.get("op") == "page_publish":
            if relay_mode == "ok":
                st["committed"] = True
                return J(r, {"ok":True, "slug":body.get("slug"), "path":"opp/x/index.html", "commit":"c0ffee"})
            if relay_mode == "reject":
                return J(r, {"ok":False, "error":"github 401: Bad credentials"})
            if relay_mode == "html200":
                return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<html><body>Service invoked too many times for one day</body></html>")
        return J(r, {"ok":True, "id":"x", "relay_version":9, "delivered":True})
    def route_live(r):
        u = r.request.url
        if LIVE_SLUG in u or (SLUG in u and st["committed"]):
            return r.fulfill(status=200, headers={"content-type":"text/html"}, body="<html>live</html>")
        return r.fulfill(status=404, headers={"content-type":"text/html"}, body="This page was not found")
    def route_pages(r):
        u = r.request.url
        if r.request.method == "PATCH":
            body = json.loads(r.request.post_data or "{}")
            (st["stamps"] if "live_verified_at" in body else st["touch"]).append(body)
            return r.fulfill(status=204, body="")
        if LIVE_SLUG in u:
            return J(r, [{"slug":LIVE_SLUG,"html":PAGE_HTML,"title":"A Live Page","live_verified_at":"2026-09-20T00:00:00Z","up":OLD_UP}])
        if SLUG in u:
            return J(r, [{"slug":SLUG,"html":PAGE_HTML,"title":"Sheraton Kuwait Marks 60 Years","live_verified_at":None,"up":OLD_UP}])
        return J(r, [])
    def route_opps(r):
        u = r.request.url
        if r.request.method in ("POST","PATCH"): return r.fulfill(status=204, body="")
        if LIVE_SLUG in u: return J(r, [{"slug":LIVE_SLUG,"data":LDATA,"archived_at":None}])
        if "slug=eq." in u: return J(r, [{"slug":SLUG,"data":DATA,"archived_at":None}])
        return J(r, [])
    def wire(ctx):
        ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'alnajjarjawad97@gmail.com',uid:'"+U_BASEL+"'}));}catch(e){}")
        ctx.route(re.compile(r"script\.google\.com/.*"), route_relay)
        ctx.route(re.compile(r"console\.thriveiii\.com/opp/.*"), route_live)
        ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
        ctx.route("**/rest/v1/console_opps**", route_opps)
        ctx.route("**/rest/v1/console_pages**", route_pages)
        ctx.route("**/rest/v1/console_mail**", lambda r: (r.fulfill(status=204, body="") if r.request.method=="POST" else J(r, [])))
        ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r, []))
        for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts","console_card_members","console_watchers"]:
            ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))
    return st, wire

def boot(b, relay_mode, w=1440):
    st, wire = make(relay_mode)
    ctx = b.new_context(viewport={"width":w,"height":900}); wire(ctx)
    pg = ctx.new_page(); perr = []; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(500)
    return st, ctx, pg, perr

def open_gate(pg, slug, gate):
    pg.click(f'.card[data-slug="{slug}"]'); pg.wait_for_selector("#owTabs", timeout=6000)
    pg.click(f'#owTabs [data-cr-gate="{gate}"]')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- (b) Page tab: unpublished -> no Live link, state + Publish; live page -> Live link ------------
    st, ctx, pg, perr = boot(b, "ok")
    open_gate(pg, SLUG, "page"); pg.wait_for_selector('#crPub[data-pub-state]', timeout=6000); pg.wait_for_timeout(600)
    tab = pg.evaluate("""()=>{ var b=document.getElementById('crPub'); return { state:b.getAttribute('data-pub-state'),
        txt:b.textContent, btn:!!b.querySelector('[data-publish-page]') }; }""")
    ck("(b) unpublished page: the Page tab does NOT show a Live link", tab["state"]=="unpublished" and "Live link" not in tab["txt"], tab)
    ck("(b) unpublished page: the Page tab shows Not published + a one-tap Publish", "Not published" in tab["txt"] and tab["btn"], tab)
    ck("(b) on the Page tab, Publish is the one primary action", pg.evaluate("()=>!!document.querySelector('#crPub .act.send[data-publish-page]')"))
    pg.close(); ctx.close()

    st, ctx, pg, perr = boot(b, "ok")
    open_gate(pg, LIVE_SLUG, "page"); pg.wait_for_selector('#crPub[data-pub-state]', timeout=6000); pg.wait_for_timeout(400)
    lv = pg.evaluate("()=>{ var b=document.getElementById('crPub'); return { state:b.getAttribute('data-pub-state'), txt:b.textContent }; }")
    ck("(b) a page proven live shows the Live link", lv["state"]=="live" and "Live link" in lv["txt"] and "console.thriveiii.com/opp/"+LIVE_SLUG in lv["txt"], lv)
    pg.close(); ctx.close()

    # ---- (a1) a member's publish COMMITS: relay ok -> live fetch -> stamp ---------------------------
    st, ctx, pg, perr = boot(b, "ok")
    open_gate(pg, SLUG, "page"); pg.wait_for_selector('#crPub [data-publish-page]', timeout=6000)
    pg.click('#crPub [data-publish-page]')
    pg.wait_for_function("()=>{ var b=document.getElementById('crPub'); return b && b.getAttribute('data-pub-state')==='live'; }", timeout=15000)
    pubs = [x for x in st["relay"] if x.get("op")=="page_publish"]
    ck("(a) Basel's Publish POSTs page_publish for the card's page with its stored html",
       len(pubs)>=1 and pubs[0].get("slug")==SLUG and "Sheraton Kuwait Marks 60 Years" in pubs[0].get("html",""), [ (x.get("op"),x.get("slug")) for x in st["relay"] ])
    ck("(a) the published html carries the transit cycle + beacon", 'name="thrive-cycle" content="cyabc"' in pubs[0].get("html","") and "beacon.js" in pubs[0].get("html",""))
    ck("(a) after the relay confirms AND the live URL resolves, live_verified_at is stamped", len(st["stamps"])>=1, st["stamps"])
    ck("(a) no uncaught error (confirmed publish)", perr==[], perr)
    pg.close(); ctx.close()

    # ---- (a2) relay REFUSES -> Not published + the relay's reason; never "going live" ----------------
    st, ctx, pg, perr = boot(b, "reject")
    open_gate(pg, SLUG, "page"); pg.wait_for_selector('#crPub [data-publish-page]', timeout=6000)
    pg.click('#crPub [data-publish-page]'); pg.wait_for_timeout(1200)
    rj = pg.evaluate("()=>{ var b=document.getElementById('crPub'); return { state:b.getAttribute('data-pub-state'), txt:b.textContent }; }")
    ck("(a) a refused publish reports failure with the relay's reason", rj["state"]=="unpublished" and "github 401: Bad credentials" in rj["txt"], rj)
    ck("(a) a refused publish never claims going live / live", "going live" not in rj["txt"].lower() and "Live link" not in rj["txt"] and st["stamps"]==[], rj)
    pg.close(); ctx.close()

    # ---- (a3) a 2xx NON-JSON relay answer (Apps Script error page) is a failure, not a success -------
    st, ctx, pg, perr = boot(b, "html200")
    open_gate(pg, SLUG, "page"); pg.wait_for_selector('#crPub [data-publish-page]', timeout=6000)
    pg.click('#crPub [data-publish-page]'); pg.wait_for_timeout(1200)
    hj = pg.evaluate("()=>{ var b=document.getElementById('crPub'); return { state:b.getAttribute('data-pub-state'), txt:b.textContent }; }")
    ck("(a) a 2xx non-JSON relay answer is NOT a success (Not published, reason shown)",
       hj["state"]=="unpublished" and "did not return a publish result" in hj["txt"], hj)
    pg.close(); ctx.close()

    # ---- (a4) the Details page section: unpublished -> Not published + Publish (not "going live") ----
    st, ctx, pg, perr = boot(b, "ok")
    open_gate(pg, SLUG, "activity"); pg.wait_for_selector("#owDetail .up-act-sec", timeout=6000); pg.wait_for_timeout(500)
    dt = pg.evaluate("()=>{ var s=document.querySelector('#owDetail .up-act-sec'); return { state:s.getAttribute('data-pub-state'), txt:s.textContent, btn:!!s.querySelector('[data-publish-page]') }; }")
    ck("(a) the Details page section says Not published with a Publish button, not going live forever",
       dt["state"]=="unpublished" and dt["btn"] and "going live" not in dt["txt"].lower(), dt)
    pg.close(); ctx.close()

    # ---- (c) the gate still blocks a page that does not resolve, with an actionable Publish -------------
    st, ctx, pg, perr = boot(b, "ok")
    open_gate(pg, SLUG, "msg"); pg.wait_for_selector("#crMsgPanel #nmSend", timeout=8000); pg.wait_for_timeout(900)
    pg.evaluate("()=>{ var b=document.getElementById('nmSend'); if(b) b.disabled=false; }")
    pg.click("#crMsgPanel #nmSend"); pg.wait_for_timeout(3500)
    sends = [x for x in st["relay"] if x.get("to")]
    gate = pg.evaluate("()=>{ var s=document.getElementById('nmStatus'); var b=s?s.querySelector('[data-publish-page]'):null; var n=document.querySelectorAll('#crMsgPanel .act.send').length; return s ? { txt:s.textContent, btn:!!b, cls:b?b.className:'', gradients:n } : null; }")
    ck("(c) the gate blocks the send: the relay send op is never called for an unpublished page", sends==[], sends)
    ck("(c) the refusal is actionable: names the cause and offers a one-tap Publish",
       gate is not None and "not published" in gate["txt"].lower() and gate["btn"], gate)
    ck("(c) beside Send, Publish is a neutral button: one gradient primary action on the surface (Send)",
       gate is not None and " send" not in (" " + gate["cls"]) and gate["gradients"] == 1, gate)
    pg.close(); ctx.close()

    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL PUBLISH-TRUTH CHECKS PASS")
