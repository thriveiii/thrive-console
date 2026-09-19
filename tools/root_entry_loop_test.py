"""ROOT ENTRY, no loop (index.html router, board root).

After the root flip (#316), entering console.thriveiii.com auto-forwarded a signed-in operator to gate.html and
took several tries to get in. Cause (docs/traces/ROOT_ENTRY_LOOP_TRACE.md): the router's expired-token branch
did its OWN network refresh to decide where to go - but Supabase refresh tokens are single-use (they rotate) and
board.html ALSO refreshes on warm boot, so the two refreshers raced the one token and the router fell to
gate.html; a slow refresh or the 12s timeout went to gate too.

The fix: the router decides on session PRESENCE only, no network. A stored session (live OR expired) -> board in
ONE hop; board.html owns the single, in-place refresh. No session -> gate. This test drives the REAL generated
index.html router and proves:
  1. a LIVE signed-in root visit reaches board.html in one hop, gate.html never requested;
  2. an EXPIRED-token root visit whose refresh is unavailable still reaches board.html (NOT gate.html) - the
     old router would have refreshed and bounced to gate here;
  3. a warm (?warm=1) post-auth visit reaches board.html;
  4. a session-less visit correctly goes to gate.html (auth is not broken).

FAILS-WHEN-BROKEN: restore the router's expired-token network refresh (toGate on failure), and case 2 lands on
gate.html instead of board.html -> the "no gate, one hop" assertion fails.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def sess_js(expires_delta):
    exp = "Math.floor(Date.now()/1000)+(%d)" % expires_delta
    return ("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'AT',refresh_token:'RT',"
            "expires_at:%s,email:'op@thrive.test',uid:'u'}));}catch(e){}" % exp)

def run_case(b, name, seed_js, path, refresh_status):
    ctx = b.new_context()
    if seed_js: ctx.add_init_script(seed_js)
    gate_hits = {"n": 0}
    navs = []
    # gate.html is stubbed so a hit is detected and the page does not auto-navigate away (URL stays gate.html).
    ctx.route("**/gate.html*", lambda r: (gate_hits.__setitem__("n", gate_hits["n"]+1),
              r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>gate-stub</title>ok"))[-1])
    # The router must NOT call refresh; board.html may. Either way, return refresh_status so nothing hangs.
    ctx.route("**/auth/v1/token**", lambda r: r.fulfill(status=refresh_status, content_type="application/json",
              body=json.dumps({"access_token":"AT2","refresh_token":"RT2","expires_at":9999999999,"user":{"id":"u"}}) if refresh_status==200 else '{"error":"invalid"}'))
    ctx.route("**/auth/v1/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    ctx.route("**/rest/v1/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = ctx.new_page()
    pg.on("framenavigated", lambda f: navs.append(f.url) if f == pg.main_frame else None)
    pg.goto(f"{base}{path}", wait_until="commit")
    # Let the deferred router (setTimeout 250) run and the single hand-off settle. Poll the URL until it reaches
    # the board or the gate stub (or time out), so the assertions read the resting destination.
    final = pg.url
    for _ in range(40):
        pg.wait_for_timeout(150)
        final = pg.url
        if "library/board.html" in final or "/gate.html" in final: break
    ctx.close()
    return {"final": final or "", "gate_hits": gate_hits["n"], "navs": navs}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # 1. LIVE signed-in visit -> board.html in one hop, gate never hit.
    r1 = run_case(b, "live", sess_js(100000), "/", 200)
    ck("1: a LIVE signed-in root visit lands on board.html", "library/board.html" in r1["final"], r1)
    ck("1: gate.html is never requested for a live session", r1["gate_hits"] == 0, r1)
    ck("1: the hand-off does not pass through gate.html (no second forward)",
       not any("/gate.html" in u for u in r1["navs"]), r1["navs"])

    # 2. EXPIRED token, refresh UNAVAILABLE (400) -> still board.html, NOT gate (the fix; old router bounced here).
    r2 = run_case(b, "expired", sess_js(-100), "/", 400)
    ck("2: an EXPIRED-token root visit lands on board.html (board owns the refresh), not gate.html",
       "library/board.html" in r2["final"], r2)
    ck("2: gate.html is never requested for an expired session (no router refresh, no bounce)",
       r2["gate_hits"] == 0, r2)
    ck("2: the hand-off does not loop through gate.html",
       not any("/gate.html" in u for u in r2["navs"]), r2["navs"])

    # 3. WARM (post-auth) visit -> board.html.
    r3 = run_case(b, "warm", sess_js(100000), "/?warm=1", 200)
    ck("3: a warm (?warm=1) post-auth visit lands on board.html", "library/board.html" in r3["final"], r3)
    ck("3: warm never requests gate.html", r3["gate_hits"] == 0, r3)

    # 4. NO session -> gate.html (auth is not broken; the gate owns sign-in).
    r4 = run_case(b, "none", "", "/", 200)
    ck("4: a session-less visit goes to gate.html (unauthenticated -> gate)",
       ("/gate.html" in r4["final"]) or (r4["gate_hits"] >= 1), r4)
    ck("4: a session-less visit does NOT land on board.html", "library/board.html" not in r4["final"], r4)

    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL ROOT-ENTRY-LOOP CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
