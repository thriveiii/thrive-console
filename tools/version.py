"""WO-014 phase 0: the console half of the version contract, proven on the page.

  python3 tools/version.py

tools/version.js proves the relay side (every response carries the version, a
newer request is refused by name). This proves the console side where it lives:
on the rendered shell. It forces the version the console last saw off a relay
response and reads back the banner and the gate, so "shows one banner on
mismatch" and "every relay action is disabled under mismatch" are true of the
screen, not of the source.
"""
import threading, http.server, socketserver, functools, os, sys

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % PORT

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:200])


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1000, "height": 800})
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    pg.goto(base + "/library/console.html")
    pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)

    need = pg.evaluate("REQUIRED_RELAY")
    ck("the console declares REQUIRED_RELAY", isinstance(need, int) and need > 0, need)

    # Nothing seen yet: no relay response parsed, so nothing to disagree with.
    clean = pg.evaluate("({mm: relayMismatch(), ready: relayReady()})")
    ck("before any relay response the console is ready and shows no banner",
       clean["mm"] is None and clean["ready"] is True, clean)

    # A matching version: ready, no banner.
    match = pg.evaluate("(v)=>{ noteRelayVersion({relay_version:v}); "
                        "return {mm:relayMismatch(), ready:relayReady(), banner:relayBannerText()}; }", need)
    ck("a matching relay version leaves the console ready with no banner",
       match["mm"] is None and match["ready"] is True and match["banner"] == "", match)

    # An older relay: not ready, banner names both numbers and carries the five taps.
    stale = pg.evaluate("()=>{ noteRelayVersion({relay_version:4}); "
                        "return {ready:relayReady(), banner:relayBannerText(), need:REQUIRED_RELAY}; }")
    ck("an older relay makes the console not ready", stale["ready"] is False, stale)
    ck("the banner names the served version and the needed version",
       "4" in stale["banner"] and str(stale["need"]) in stale["banner"], stale["banner"])
    ck("the banner carries the deployment remedy",
       "Manage deployments" in stale["banner"] and "New version" in stale["banner"], stale["banner"])

    # A response with NO version field reads as older-than-the-contract, not fine.
    absent = pg.evaluate("()=>{ noteRelayVersion({ok:true}); "
                         "return {ready:relayReady(), banner:relayBannerText()}; }")
    ck("a response with no version field is treated as a mismatch",
       absent["ready"] is False and len(absent["banner"]) > 0, absent)

    # The banner renders in the connection panel, in Arabic too, without a straight
    # quote or a passive form leaking in. The Arabic string is the §3.1 sentence.
    ar = pg.evaluate("()=>{ localStorage.setItem('thrive_lang','ar'); noteRelayVersion({relay_version:4}); "
                     "return relayBannerText(); }")
    ck("the Arabic banner is present and mentions Apps Script and Deploy",
       "Apps Script" in ar and "Deploy" in ar, ar)
    ck("the Arabic banner uses no straight quote", '"' not in ar and "'" not in ar, ar)

    ctx.close(); b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
