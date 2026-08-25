"""INDEX_RESILIENCE contract (browser + source, fails-when-broken).

Device evidence: operators were stranded FOREVER on the root index splash ("Opening the Thrive Opportunity
Library..."), tab stuck at "Loading", even in a private tab with cleared cache. The root fired TWO top-level
navigations at once (a 0s meta refresh AND the JS router), and WebKit can hang on that race so the hand-off
never commits while the index stays painted; and the index offered no way out.

The fix: (a) remove the meta refresh so there is exactly ONE deferred JS navigation, no race; (b) paint
STATIC escape links at first paint (a browser tap on an <a> works even if a hung hand-off suspends the
document's JS); (c) a ?stay=1 manual-launcher mode that suppresses the auto hand-off. This test proves the
static escapes are present, reach the sign-in page and the console, and that ?stay=1 does not navigate away.
"""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# Source guards on the generated index.
idx = open(os.path.join(ROOT, "index.html")).read()
ck("the 0s meta refresh is gone (no second racing top-level navigation)", 'http-equiv="refresh"' not in idx)
ck("static escapes are painted in the body markup (not built by a timer): sign-in, console, menu",
   'class="esc"' in idx and 'id="idxGate"' in idx and 'href="gate.html"' in idx
   and 'id="idxCon"' in idx and 'id="idxMenu"' in idx)
ck("the router is a single deferred navigation and honors ?stay=1 as a manual launcher",
   "setTimeout(decide, 250)" in idx and "stay=1" in idx)
ck("the escapes are Arabic-aware (both locales present)",
   "صفحة تسجيل الدخول" in idx and "Sign-in page" in idx)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    # ?stay=1 is the manual launcher: it must NOT auto-navigate, so we can observe the static escapes.
    pg.goto(f"{base}/index.html?stay=1", wait_until="load")
    pg.wait_for_timeout(700)  # past the 250ms hand-off defer: if stay were ignored it would have navigated
    st = pg.evaluate("""()=>{
      var w=document.getElementById('idxEsc');
      var links = w ? Array.from(w.querySelectorAll('a')).map(a=>({id:a.id, href:a.getAttribute('href'), text:(a.textContent||'').trim()})) : [];
      return {
        onIndex: /\\/index\\.html/.test(location.pathname) || location.pathname==='/' || /index\\.html/.test(location.href),
        path: location.pathname,
        escVisible: !!w && (getComputedStyle(w).display!=='none'),
        gate: links.some(l=>/gate\\.html/.test(l.href||'')),
        console: links.some(l=>/library\\/console\\.html/.test(l.href||'')),
        menu: links.some(l=>l.id==='idxMenu'),
        count: links.length
      };
    }""")
    ck("with ?stay=1 the index does NOT auto-navigate (manual launcher stays put)", st.get("onIndex"), st)
    ck("the static escape row is visible and reaches the sign-in page and the console",
       st.get("escVisible") and st.get("gate") and st.get("console") and st.get("menu"), st)
    # Tapping the sign-in escape reaches gate.html (the tiny proven page) as a fresh single navigation.
    pg.click("#idxGate")
    pg.wait_for_timeout(600)
    reached_gate = pg.evaluate("()=>/gate\\.html/.test(location.href)")
    ck("tapping the sign-in escape navigates to gate.html", reached_gate, pg.url)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL INDEX-RESILIENCE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
