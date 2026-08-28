"""BOOT_RELIABILITY (source + browser, fails-when-broken).

The board showed a long black screen then sign-in failed with a 15 s hang. Root cause (WEIGHT_EVIDENCE):
board.html was marked no-store, so its ~200 KB re-downloaded every visit, and the auth POST hung up to
FETCH_TIMEOUT_MS=15000 before rejecting. This locks the fix:

  1. CACHEABLE SHELL: the board document no longer declares no-store (its Cache-Control meta is a plain
     revalidate hint), and publish/_headers carries an explicit revalidate-not-redownload rule for
     /library/board.html.
  2. AUTH DOES NOT HANG SILENTLY: FETCH_TIMEOUT_MS is a snappy 6000 ms, a connecting state paints while
     the request is in flight, and a connection failure (timeout/network/unavailable, distinct from a
     credential error) offers a one-tap retry.
  3. FAST FIRST PAINT: the sign-in view renders synchronously with NO network call, so a signed-out boot
     paints the form immediately (zero Supabase requests before it appears).

Source checks read the built shell and the emitted _headers. The browser checks drive board.html through
the same mocked path as standalone_board_test. Synthetic inputs only.
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
        if d is not None: print("      " + str(d)[:400])

board = open(os.path.join(ROOT, "library/board.html"), encoding="utf-8").read()
headers = open(os.path.join(ROOT, "publish/_headers"), encoding="utf-8").read()

# ---- 1. cacheable shell -------------------------------------------------------------------------
head = board[:board.index("<title>")]
meta = re.search(r'<meta http-equiv="Cache-Control"[^>]*>', head)
ck("board.html declares a Cache-Control meta", bool(meta), head[:400])
ck("the board document no longer declares no-store", bool(meta) and "no-store" not in meta.group(0), meta.group(0) if meta else None)
ck("no no-store anywhere in the board <head>", "no-store" not in head, head[-200:])
ck("publish/_headers carries an explicit /library/board.html rule",
   "/library/board.html" in headers, headers)
board_rule = headers.split("/library/board.html", 1)[1].split("/*", 1)[0] if "/library/board.html" in headers else ""
ck("the board rule revalidates (no-cache + must-revalidate) and never no-store",
   "no-cache" in board_rule and "must-revalidate" in board_rule and "no-store" not in board_rule, board_rule)

# ---- 2. snappy auth timeout ---------------------------------------------------------------------
m = re.search(r'FETCH_TIMEOUT_MS\s*=\s*(\d+)', board)
ck("the auth fetch timeout is the new snappy bound (6000 ms)", bool(m) and m.group(1) == "6000", m.group(0) if m else None)
ck("the old 15000 ms hang is gone", not re.search(r'FETCH_TIMEOUT_MS\s*=\s*15000', board))
ck("a connecting state and a retry affordance exist (EN + AR)",
   'connecting:"Connecting."' in board and 'retry:"Retry"' in board
   and 'connecting:"جارٍ الاتصال."' in board
   and 'retry:"إعادة المحاولة"' in board)
ck("the retry is offered ONLY on a connection failure, not a credential error",
   "if(offline){" in board and 'rb.addEventListener("click", submit)' in board)

# ---- 3. fast first paint: signinView renders before any network ---------------------------------
sv = board[board.index("function signinView(){"): board.index("function headerHtml(")]
paint = sv.index("root.innerHTML")
ck("signinView paints root.innerHTML", paint > 0)
ck("signinView makes NO network call before it paints (no fetch/signIn/refresh before innerHTML)",
   not re.search(r'\b(fetch|signIn|refresh|tokenPost)\s*\(', sv[:paint]), sv[:paint][-200:])
ck("connectingView is defined and painted before the warm-boot refresh",
   "function connectingView()" in board and "connectingView();   // paint at once" in board)

# ---- browser harness ----------------------------------------------------------------------------
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # B1: signed-out boot paints the sign-in form with ZERO Supabase requests (renders without network).
    pg = b.new_page()
    supa = {"n": 0}
    pg.route("**/auth/v1/**", lambda r: (supa.__setitem__("n", supa["n"] + 1), r.abort())[1])
    pg.route("**/rest/v1/**", lambda r: (supa.__setitem__("n", supa["n"] + 1), r.abort())[1])
    pg.goto(f"{base}/library/board.html", wait_until="load")
    pg.wait_for_selector("#go", timeout=6000)
    form = pg.evaluate("()=>!!(document.getElementById('go') && document.getElementById('em') && document.getElementById('pw'))")
    ck("signed-out boot renders the sign-in form", form)
    ck("and it made ZERO Supabase requests before the form appeared (no network to paint)", supa["n"] == 0, supa)
    pg.close()

    # B2: a hanging auth POST times out fast (well under the old 15 s), shows the offline message + a retry.
    pg2 = b.new_page()
    pg2.route("**/rest/v1/**", lambda r: r.abort())
    # token route hangs: never fulfilled, so only the client-side FETCH_TIMEOUT_MS can end it.
    pg2.route("**/auth/v1/token**", lambda r: None)
    pg2.goto(f"{base}/library/board.html", wait_until="load")
    pg2.wait_for_selector("#go", timeout=6000)
    pg2.fill("#em", "op@thrive.test"); pg2.fill("#pw", "correct horse")
    pg2.click("#go")
    ck("a connecting state paints while the request is in flight", pg2.wait_for_selector("#siConn", timeout=2000) is not None)
    t0 = time.time()
    pg2.wait_for_selector("#siRetry", timeout=12000)
    elapsed = time.time() - t0
    txt = pg2.evaluate("()=>document.getElementById('siErr').textContent")
    ck("a hanging auth fails fast (well under the old 15 s) and offers a one-tap retry", elapsed < 11, round(elapsed, 1))
    ck("the failure shows the offline-aware message, not a credential error",
       ("reach the service" in txt) or ("تعذّر الوصول" in txt), txt)
    pg2.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOOT-RELIABILITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
