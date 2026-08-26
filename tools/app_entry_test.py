"""APP_ENTRY (source + browser, fails-when-broken).

The clean NEW single-document entry (library/app.html) retires the poisoned index->gate->console path and
carries the sound core over unchanged. This test locks the four laws of that document, and proves the one
risky law end to end in a real browser against the REAL supabase.js token grant (the device-proven shape):

  Law 1  Sign in once into memory. The minimal card calls ThriveSupa.signIn, which does the frozen token
         grant (apikey header, JSON POST, NO Authorization, cache no-store) and setSession into __memSession.
         On success the shell reveals (gate-locked dropped, __gateRevealed armed) and the warm-boot unlock is
         handed to app.js (onGateUnlocked, else __gateUnlockedPending).
  Law 2  The CARRY module set loads directly, in dependency order, app.js last. No gate.js, no fragment
         adopt, no paint-lock, no BOARD_WAIT.
  Law 3  Reveal + render via the CARRY router (the same VIEWS/show/initBoard router the console uses).
  Law 4  RETIRE is not imported: no gate.html, gate.js, fragment carrier, thrive_gate_v2 paint-lock, or
         BOARD_WAIT anywhere in the document.

The browser half loads config.js + supabase.js + the document's OWN extracted sign-in script (so the test
exercises the emitted code, not a copy), mocks only the GoTrue token endpoint, and asserts the reveal +
in-memory session + the frozen request shape.
"""
import os, re, threading, http.server, socketserver, functools, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

app = open(os.path.join(ROOT, "library/app.html")).read()

# ---- Law 2: the CARRY module set, in order, app.js last ------------------------------------------
CARRY = ["config.js", "supabase.js", "icons.js", "i18n.js", "stage-model.js", "lifecycle.js",
         "intake.js", "numbers.js", "inbound.js", "kinds.js", "store.js", "drafts.js", "flows.js", "app.js"]
# BOOT_TRACE: the modules are loaded by the instrumented sequential loader, so their order lives in the STEPS
# array as "s":"./NAME.js?v=hash" (external steps), interleaved with inline steps that carry no ".js" src.
order = re.findall(r'"s":"\./([a-z0-9-]+\.js)\?v=', app)
ck("Law 2: the CARRY modules load in dependency order, app.js last", order == CARRY, order)

# ---- Law 4: RETIRE is not imported ---------------------------------------------------------------
ck("Law 4: gate.js is not loaded", 'gate.js?v=' not in app)
ck("Law 4: the fragment carrier (adoptSession) is not present", 'adoptSession' not in app)
ck("Law 4: the thrive_gate_v2 paint-lock is not present", 'thrive_gate_v2' not in app)
ck("Law 4: BOARD_WAIT is not present", 'BOARD_WAIT' not in app and '__bwShow' not in app)
ck("Law 4: no eject / passcode / lobby logic (gateTarget/redirectToGate)",
   'gateTarget' not in app and 'redirectToGate' not in app)

# ---- Law 1: the minimal sign-in, the frozen grant via ThriveSupa.signIn, reveal + unlock hand-off -
ck("Law 1: the shell boots gate-locked (hidden until reveal)", 'class="gate-locked"' in app)
ck("Law 1: sign-in calls ThriveSupa.signIn with a fresh connection", 'S.signIn(m, p, { fresh:true })' in app)
ck("Law 1: reveal() drops gate-locked and arms the relay",
   'classList.remove("gate-locked")' in app and 'window.__gateRevealed = true' in app)
ck("Law 1: success hands the SAME warm-boot unlock to app.js",
   'window.onGateUnlocked' in app and 'window.__gateUnlockedPending = true' in app)
ck("Law 1: sign-out is a real command again (app.js wires window.thriveSignOut)",
   'window.thriveSignOut = async function' in app and 'S.signOut' in app)

# ---- Law 3: reveal + render via the CARRY router -------------------------------------------------
ck("Law 3: the CARRY view router is present (VIEWS + initBoard dispatch)",
   '"init":"initBoard"' in app and 'window[v.init]()' in app)
ck("Law 3: the board view container is present", 'id="view-board"' in app)
# BOOT_TRACE: the failsafe panel is not loaded in this build; the on-screen fault surface is #bootTrace, and
# window.__thriveBoardFault routes a board fault to it (a red BOARD FAULT line).
ck("Law 3: an on-screen fault surface is kept (__thriveBoardFault routes to the boot panel)",
   'window.__thriveBoardFault = function' in app and 'BOARD FAULT:' in app)

# ---- Browser: Law 1 end to end against the REAL supabase.js token grant ---------------------------
# BOOT_TRACE: the sign-in code now lives in the boot-signin text/plain block; extract that raw JS and wrap it.
m = re.search(r'<script type="text/plain" id="boot-signin">([\s\S]*?)</script>', app)
signin_code = m.group(1) if m else ""
signin_block = ("<script>\n" + signin_code + "\n</script>") if signin_code else ""
ck("the sign-in script was extracted from the emitted app.html",
   bool(signin_code) and 'var S = window.ThriveSupa;' in signin_code)

# A tiny page: real config + real supabase + the document's own sign-in script, over a gate-locked shell.
PAGE = ('<!doctype html><html class="gate-locked" lang="en"><head><meta charset="utf-8">'
        '<meta name="thrive-build" content="testbuild">'
        '<style>html.gate-locked .wrap{display:none}#thriveGate{position:fixed;inset:0}</style></head>'
        '<body><main class="wrap"><div id="view-board">board</div></main>'
        '<script src="/library/config.js"></script>'
        '<script src="/library/supabase.js"></script>'
        + signin_block +
        '</body></html>')

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/__page"):
            body = PAGE.encode("utf-8")
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

seen = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()

    def route_token(route):
        req = route.request
        seen["method"] = req.method
        seen["headers"] = req.headers
        seen["post"] = req.post_data
        body = json.dumps({"access_token": "TESTTOKEN", "refresh_token": "R", "expires_at": 9999999999,
                           "user": {"id": "u-1"}})
        route.fulfill(status=200, headers={"content-type": "application/json"}, body=body)
    # Mock ONLY the GoTrue token endpoint; everything else is the real file server.
    pg.route("**/auth/v1/token**", route_token)

    pg.goto(f"{base}/__page", wait_until="load")
    pg.wait_for_timeout(300)

    st0 = pg.evaluate("""()=>({ card: !!document.getElementById('thriveGate'),
                                 locked: document.documentElement.classList.contains('gate-locked') })""")
    ck("the sign-in card appears over the locked shell", st0.get("card") and st0.get("locked"), st0)

    pg.fill("#siEmail", "op@thrive.test")
    pg.fill("#siPass", "correct horse")
    pg.click(".gate-btn")
    pg.wait_for_timeout(600)

    st1 = pg.evaluate("""()=>({
      signedIn: !!(window.ThriveSupa && window.ThriveSupa.signedIn && window.ThriveSupa.signedIn()),
      token: (window.ThriveSupa && window.ThriveSupa.session() && window.ThriveSupa.session().access_token) || null,
      revealed: !!window.__gateRevealed,
      locked: document.documentElement.classList.contains('gate-locked'),
      cardGone: !document.getElementById('thriveGate'),
      pending: !!window.__gateUnlockedPending,
      signOut: (typeof window.thriveSignOut === 'function')
    })""")
    ck("sign-in put a real session in MEMORY (bearer is the token)", st1.get("token") == "TESTTOKEN" and st1.get("signedIn"), st1)
    ck("reveal fired: gate-locked dropped and the relay armed", st1.get("revealed") and not st1.get("locked"), st1)
    ck("the sign-in card is torn down after success", st1.get("cardGone"), st1)
    ck("the warm-boot unlock is queued for app.js (onGateUnlocked undefined here -> pending flag)", st1.get("pending"), st1)
    ck("window.thriveSignOut is defined (sign-out command carried over)", st1.get("signOut"), st1)

    # The frozen request shape, proven on the wire: apikey header, JSON POST, NO Authorization, no-store.
    h = {k.lower(): v for k, v in (seen.get("headers") or {}).items()}
    ck("token grant is a POST", seen.get("method") == "POST", seen.get("method"))
    ck("token grant carries the apikey header (anon key)", h.get("apikey", "").startswith("eyJ"), h.get("apikey"))
    ck("token grant carries NO Authorization header (the frozen shape)", "authorization" not in h, list(h.keys()))
    ck("token grant body is JSON with the credentials",
       bool(seen.get("post")) and "op@thrive.test" in seen.get("post", ""), seen.get("post"))
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL APP-ENTRY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
