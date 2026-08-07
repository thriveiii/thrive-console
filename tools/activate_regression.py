"""Regression lock for the editor Activate path. Run: python3 tools/activate_regression.py

This exists because a control looked alive but reached nothing for a day. Two facts must stay true,
and this test fails the build if either regresses:

  1  In the opportunity window (which borrows the editor view and calls initEditor(current) with no
     slug in the URL), a page's own slug must NOT read as a collision, and Activate must reach the
     real commit: two PUTs, the page and the manifest. This fails the moment initEditor stops
     honoring the slug its caller passes.
  2  The standalone editor page carries the slug in its URL and must still resolve it there, so its
     own slug is not a collision either. Both call paths are asserted.
  3  A view that fails to mount must surface a visible error through the runner surface, never leave
     an unbound button behind in silence.

The sandbox runs only Chromium and mocks api.github.com. The real GitHub commit and WebKit are the
device's to prove; what is provable here (routing, the PUT on tap, the visible outcome) is proven here.
"""
import threading, http.server, socketserver, functools, os, sys, json

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("  PASS " if c else "  FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("        " + str(d)[:300])

JIA = {"slug": "simply-jia-style", "business": "Simply Jia Style", "_local": True, "published": False,
       "mode": "fill", "template": "en-opp1",
       "fields": {"BIZ": "Simply Jia Style", "WANT": "x", "PROOF1": "a", "PROOF2": "b", "PROOF3": "c"}, "up": 1}

def new_ctx(b, put_status=200, puts=None):
    ctx = b.new_context(viewport={"width": 1100, "height": 900})
    def gh(route):
        if route.request.method == "GET":
            return route.fulfill(status=404, body=json.dumps({"message": "Not Found"}))
        if puts is not None:
            puts.append(route.request.url)
        body = "mock-error-body" if put_status != 200 else json.dumps({"content": {"sha": "s"}, "commit": {"sha": "c"}})
        return route.fulfill(status=put_status, body=body)
    ctx.route("https://api.github.com/**", gh)
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body=json.dumps({"opportunities": []})))
    return ctx

def unlock_and_seed(pg, opps):
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(600)
    pg.evaluate("""(opps)=>{
      localStorage.setItem('thrive_gh_v1', JSON.stringify({token:'t',owner:'o',repo:'r',branch:'main'}));
      localStorage.setItem('thrive_opps_v1', JSON.stringify(opps));
    }""", opps)

def act_kind(pg):
    e = pg.query_selector("#actionStatus")
    if not e or "show" not in (e.get_attribute("class") or ""): return None
    c = e.get_attribute("class")
    return "err" if "act-err" in c else ("ok" if "act-ok" in c else "work")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # 1. The window path: no slug in the URL, page's own slug is not a collision, Activate reaches the PUT.
    puts = []; ctx = new_ctx(b, 200, puts); pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    unlock_and_seed(pg, [JIA]); pg.reload(); pg.wait_for_timeout(1000)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(600)
    pg.evaluate("()=>window.thriveModal.open('simply-jia-style','overview','x')"); pg.wait_for_timeout(700)
    pg.evaluate("()=>window.thriveModal.tab('page')"); pg.wait_for_timeout(1300)
    ck("window: the page's own slug is not a false collision",
       not pg.eval_on_selector("#slugWarn", "e=>!e.hidden"))
    pg.evaluate("()=>document.getElementById('publishBtn').click()"); pg.wait_for_timeout(2000)
    ck("window: Activate reaches ghPutFile (the page is PUT)", any("index.html" in u for u in puts), puts)
    ck("window: the manifest is also PUT", any("manifest.json" in u for u in puts), puts)
    ctx.close()

    # 2. The standalone editor page resolves the slug from its URL, so its own slug is not a collision.
    ctx = new_ctx(b, 200, None); pg = ctx.new_page()
    pg.goto(f"{base}/library/editor.html?slug=simply-jia-style"); pg.wait_for_timeout(500)
    unlock_and_seed(pg, [JIA])
    pg.goto(f"{base}/library/editor.html?slug=simply-jia-style"); pg.wait_for_timeout(1200)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    ck("standalone: the slug resolves from the URL, own slug is not a collision",
       not pg.eval_on_selector("#slugWarn", "e=>!e.hidden"))
    ctx.close()

    # 3. A view that fails to mount surfaces a visible error rather than an unbound silent button.
    ctx = new_ctx(b, 200, None); pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    unlock_and_seed(pg, [JIA]); pg.reload(); pg.wait_for_timeout(1000)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(600)
    pg.evaluate("()=>window.thriveModal.open('simply-jia-style','overview','x')"); pg.wait_for_timeout(700)
    pg.evaluate("()=>{ window.allSlugs = function(){ throw new Error('forced-mount-failure'); }; }")
    pg.evaluate("()=>window.thriveModal.tab('page')"); pg.wait_for_timeout(1000)
    ck("mount failure surfaces a visible error (never an unbound silent button)", act_kind(pg) == "err")
    ctx.close()

print("\n%d failed" % len(fails))
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
