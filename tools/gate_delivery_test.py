"""SESSION_HANDOFF delivery: gate.html is version-pinned and folded into BUILD (fails-when-broken).

The SESSION_HANDOFF_FIX was correct but inert on the device: gate.html (the one file that writes the session
into the URL fragment) was not cache-busted and not part of BUILD, so a device served a stale gate.html
against a fresh shell and the fragment was never written. This locks the delivery:

  - gate.html bytes are folded into BUILD, so any change to gate.html moves BUILD;
  - every ../gate.html reference is version-pinned with ?v=BUILD (gate.js gateHref, index toGate + idxGate),
    so the browser must fetch the gate.html that matches the shell.

Source guards prove the wiring; the browser check proves the eject actually navigates to ../gate.html?v=<build>.
"""
import os, json, threading, http.server, socketserver, functools
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

BUILD = json.load(open(os.path.join(ROOT, "version.json")))["build"]

# ---- source guards -------------------------------------------------------------------------------
bundle = open(os.path.join(ROOT, "tools/bundle.js")).read()
gatej = open(os.path.join(ROOT, "library/gate.js")).read()
idx = open(os.path.join(ROOT, "index.html")).read()

ck("BUILD folds in gate.html: bundle reads gate.html and includes gateHtml in the BUILD hash input",
   'read(path.join(ROOT, "gate.html"))' in bundle
   and 'failsafe, gateHtml, GENERATOR_SRC' in bundle)
ck("gate.js gateHref version-pins ../gate.html with the build id",
   'function gateHref() { var v = buildId(); return "../gate.html" + (v ? ("?v=" + v)' in gatej)
ck("index toGate version-pins gate.html with BUILD",
   'location.replace("gate.html?v=" + BUILD)' in idx)
ck("index idx escape link version-pins gate.html with the current BUILD",
   ('href="gate.html?v=' + BUILD + '"') in idx)

# ---- browser: an eject actually navigates to ../gate.html?v=<build> ------------------------------
SEED = ("(()=>{try{"
        f"sessionStorage.setItem('thrive_gate_v2','{GATE_HASH}');"          # paint-lock passes
        "localStorage.setItem('thrive_presence',String(Date.now()));"       # presence fresh -> lobby, not passcode
        "localStorage.setItem('thrive_sync_auth','x');"
        "localStorage.removeItem('console_sb_session');"                     # no session -> needsOperator -> eject
        "}catch(e){}})()")

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    ctx.add_init_script(SEED)
    ctx.route("**/app.js*", lambda r: r.abort())
    ctx.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html", wait_until="commit")
    landed = ""
    for _ in range(40):
        landed = pg.url
        if "/gate.html" in landed:
            break
        pg.wait_for_timeout(250)
    ck("the eject navigates to gate.html carrying ?v=<build> (never a bare, cacheable gate.html)",
       "/gate.html?v=" + BUILD in landed, landed)
    ctx.close()
    b.close()

httpd.shutdown()
print("\n(build " + BUILD + ")")
print(("FAILED: " + ", ".join(fails)) if fails else "ALL GATE-DELIVERY CHECKS PASS")
raise SystemExit(1 if fails else 0)
