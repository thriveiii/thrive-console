"""BOARD_WAIT contract (browser, fails-when-broken).

The #225 regression this guards against: after the gate resolved, a full-screen "loading" overlay covered
the working interface at 5s, and at 18s a full-screen Retry panel replaced the screen whose only exit was
location.reload(). The reload CANCELED the in-flight ~890 KB app.js download and restarted from zero, so any
connection needing more than 18s could never finish: an infinite reload loop that locked the operators out.

The law now: the wait is never covered, never interrupted, never auto-reloaded. One small non-blocking
banner at the bottom edge tells the truth and OFFERS a Retry; it clears itself the instant the board paints.

This proves it in a browser with app.js aborted (the board can never paint) and a signed-in session (the
gate resolves): the banner appears; the interface is NOT covered (the viewport center stays free); no
full-screen overlay ids exist; NO reload happens past the old 18s deadline (a window marker survives); and
with __boardPainted set, the banner never appears at all.
"""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
GATE_HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# Source guard: non-blocking banner only; the blocking overlays and the fail deadline are gone.
shell = open(os.path.join(ROOT, "library/console.html")).read()
ck("the shell carries the non-blocking banner and none of the blocking overlays or the fail deadline",
   "id='boardWait'" in shell and "left:12px;right:12px;bottom:14px" in shell
   and "id='bootLoading'" not in shell and "id='bootWatchdog'" not in shell
   and "__bwFail" not in shell and "setTimeout(__bwShow, 8000)" in shell)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

F = 9999999999
SEED = ("(()=>{try{"
        f"sessionStorage.setItem('thrive_gate_v2','{GATE_HASH}');"
        "localStorage.setItem('console_sb_session',JSON.stringify({access_token:'t',refresh_token:'r',expires_at:%d,email:'op@t.co',uid:'u'}));"
        "localStorage.setItem('thrive_presence',String(Date.now()));"
        "localStorage.setItem('thrive_sync_auth','x');"
        "window.__gateNoRedirect=true;"
        "}catch(e){}})()") % F

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- Scenario A: app.js aborted, the board can never paint ----
    ctxA = b.new_context()
    ctxA.add_init_script(SEED)
    ctxA.route("**/app.js*", lambda r: r.abort())
    ctxA.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = ctxA.new_page()
    pg.goto(f"{base}/library/console.html", wait_until="commit")
    pg.wait_for_timeout(500)
    pg.evaluate("()=>{ window.__probe = 'alive'; }")   # dies if the page ever reloads itself
    banner = False
    for _ in range(24):   # banner arms at 8s; poll to ~12s
        try: banner = pg.evaluate("()=>!!document.getElementById('boardWait')")
        except Exception: banner = False
        if banner: break
        pg.wait_for_timeout(500)
    ck("with the board unpainted after the gate, the small banner appears", banner)
    st = pg.evaluate("""()=>{
      var w=document.getElementById('boardWait');
      var cx=Math.floor(innerWidth/2), cy=Math.floor(innerHeight/2);
      var el=document.elementFromPoint(cx,cy);
      return {
        retry: !!(w && w.querySelector('#bwRetry')),
        centerCovered: !!(el && w && (el===w || w.contains(el))),
        fullscreen: !!(document.getElementById('bootLoading')||document.getElementById('bootWatchdog')),
        gone: !!document.getElementById('thriveGate')
      };
    }""")
    ck("the banner offers Retry but does NOT cover the interface (viewport center stays free)",
       st.get("retry") and not st.get("centerCovered") and not st.get("fullscreen"), st)
    # Cross the old 18s deadline: the page must NOT reload itself and NOTHING may replace the screen.
    pg.wait_for_timeout(9500)   # ~21s since load
    after = pg.evaluate("""()=>({
      probe: window.__probe || null,
      banner: !!document.getElementById('boardWait'),
      fullscreen: !!(document.getElementById('bootLoading')||document.getElementById('bootWatchdog')),
      centerFree: (function(){ var w=document.getElementById('boardWait'); var el=document.elementFromPoint(Math.floor(innerWidth/2),Math.floor(innerHeight/2)); return !(el && w && (el===w||w.contains(el))); })()
    })""")
    ck("past the old 18s deadline: NO self-reload (the marker survives), NO full-screen takeover, the banner just waits",
       after.get("probe") == "alive" and after.get("banner") and not after.get("fullscreen") and after.get("centerFree"), after)
    ctxA.close()

    # ---- Scenario B: the board painted; the banner never appears ----
    ctxB = b.new_context()
    ctxB.add_init_script(SEED + "; try{window.__boardPainted=true;}catch(e){}")
    ctxB.route("**/app.js*", lambda r: r.abort())
    ctxB.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg2 = ctxB.new_page()
    pg2.goto(f"{base}/library/console.html", wait_until="commit")
    pg2.wait_for_timeout(9500)   # past the 8s arm
    silent = pg2.evaluate("()=>!document.getElementById('boardWait')")
    ck("when the board has painted, the banner never appears", silent)
    ctxB.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-WAIT CHECKS PASS"))
raise SystemExit(1 if fails else 0)
