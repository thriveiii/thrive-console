"""BOARD_WATCHDOG contract (browser, fails-when-broken).

Device evidence: after the gate resolved ("boot gate resolved" on the diag strip), the board area stayed
BLACK, because app.js (~890 KB, the last script, which paints the board) had not arrived on a marginal
connection, and the old watchdog keyed on __thriveBooted (which the gate sets on resolve) so it never fired.

This proves the new board-keyed, two-phase watchdog: with app.js aborted (the board never paints) and a
signed-in session (the gate resolves and removes #thriveGate), a loading indicator appears, then a Retry
panel. And when the board DOES paint (__boardPainted set), neither ever appears.
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

# Source guard: two-phase, board-keyed, not gate-keyed.
bundle = open(os.path.join(ROOT, "tools/bundle.js")).read()
ck("watchdog keys on __boardPainted, not __thriveBooted",
   "window.__boardPainted" in bundle and "setTimeout(__bwLoading, 5000)" in bundle
   and "setTimeout(__bwFail, 18000)" in bundle and "if(window.__thriveBooted)return;" not in bundle)

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

    # ---- Scenario A: app.js aborted, board never paints -> loading then Retry ----
    ctxA = b.new_context()
    ctxA.add_init_script(SEED)
    ctxA.route("**/app.js*", lambda r: r.abort())          # the board painter never arrives
    ctxA.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = ctxA.new_page()
    pg.goto(f"{base}/library/console.html", wait_until="commit")
    loading_seen = False
    for _ in range(20):   # up to ~8s: loading fires at 5s
        try: loading_seen = pg.evaluate("()=>!!document.getElementById('bootLoading')")
        except Exception: loading_seen = False
        if loading_seen: break
        pg.wait_for_timeout(400)
    ck("with the board unpainted after the gate, a loading indicator appears (not a silent black void)", loading_seen)
    retry_seen = False
    for _ in range(32):   # up to ~13s more: Retry panel fires at 18s
        try: retry_seen = pg.evaluate("()=>!!document.getElementById('bootWatchdog')")
        except Exception: retry_seen = False
        if retry_seen: break
        pg.wait_for_timeout(500)
    ck("if the board still has not painted, the Retry panel appears", retry_seen)
    if retry_seen:
        info = pg.evaluate("""()=>{var w=document.getElementById('bootWatchdog');return {retry:!!w.querySelector('#wdRetry'), text:(w.textContent||'')};}""")
        ck("the Retry panel offers Retry and names the board/connection", info.get("retry") and ("board" in info.get("text","").lower() or "connection" in info.get("text","").lower()), info)
    ctxA.close()

    # ---- Scenario B: board paints (set __boardPainted) -> watchdog stays silent ----
    ctxB = b.new_context()
    ctxB.add_init_script(SEED + "; try{window.__boardPainted=true;}catch(e){}")
    ctxB.route("**/app.js*", lambda r: r.abort())
    ctxB.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg2 = ctxB.new_page()
    pg2.goto(f"{base}/library/console.html", wait_until="commit")
    pg2.wait_for_timeout(6500)   # past the 5s loading phase
    silent = pg2.evaluate("()=>!document.getElementById('bootLoading') && !document.getElementById('bootWatchdog')")
    ck("when the board has painted, the watchdog stays silent (no loading, no Retry)", silent)
    ctxB.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-WATCHDOG CHECKS PASS"))
raise SystemExit(1 if fails else 0)
