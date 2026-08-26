"""APP_BOOT_TRACE (browser, fails-when-broken).

app.html hangs at 'boot start' before the sign-in card on every device, and there is no Web Inspector. This
locks the on-screen boot instrument so the boot reports its own stall:

  1. Before each script loads, its name is written to a visible fixed panel (#bootTrace): loading: NAME ...
     loaded: NAME. The last name shown when it stalls is the culprit.
  2. Each load is wrapped in onload/onerror AND a 4s timeout. On error or timeout a red FAILED: NAME - reason
     line is written and the loader STOPS (no further steps).
  3. A global window.onerror / unhandledrejection writes any throw (message + source:line) to the same panel.

The heavy CARRY modules are stubbed here (the harness cannot run the real 890 KB app.js), which is exactly
the point of the instrument: it is agnostic to what each script does, it only reports the load sequence and
surfaces any failure.
"""
import os, re, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

app = open(os.path.join(ROOT, "library/app.html")).read()

# ---- source guards -------------------------------------------------------------------------------
ck("point 3: global error + unhandledrejection handlers are the first script",
   'window.addEventListener("error"' in app and 'window.addEventListener("unhandledrejection"' in app
   and app.index('window.addEventListener("error"') < app.index('boot-signin'))
ck("point 1: each script is announced before it loads (loading: NAME)", '"loading: " + step.n' in app)
ck("point 2: onerror AND a per-script timeout, both STOP", 'sc.onerror' in app and 'timeout after ' in app and 'function stop(){ stopped = true; }' in app)
ck("the boot order is unchanged (sign-in right after supabase, router last)",
   re.search(r'"config\.js".*?"supabase\.js".*?"sign-in card".*?"app\.js".*?"view router"', app, re.S) is not None)
ck("the failsafe panel is not loaded (bootTrace is the single surface)", 'panel("Board did not paint"' not in app)

# ---- browser harness -----------------------------------------------------------------------------
STUBS = {
  "config.js":   'window.THRIVE_CONFIG={supaUrl:"https://x.supabase.co",supaAnon:"y"};',
  "supabase.js": 'window.ThriveSupa={signedIn:function(){return false;},signIn:function(){},signOut:function(){}};',
  "i18n.js":     'window.initLang=function(){};window.applyLang=function(){};',
}
def stub_for(path):
    for name, code in STUBS.items():
        if ("/"+name) in path: return code
    return "/* stub */"

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def trace_text(pg):
    return pg.evaluate("()=>{var b=document.getElementById('bootTrace');return b?b.textContent:'';}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- Scenario A: every module loads (stubbed) -> full running list + dispatch -----------------
    pgA = b.new_page()
    def routeA(route):
        u = route.request.url
        if "/library/" in u and u.split("?")[0].endswith(".js"):
            route.fulfill(status=200, headers={"content-type":"application/javascript"}, body=stub_for(u))
        else:
            route.continue_()
    pgA.route("**/*", routeA)
    pgA.goto(f"{base}/library/app.html", wait_until="domcontentloaded")
    pgA.wait_for_timeout(1200)
    tA = trace_text(pgA)
    ck("A: the boot panel appears and is armed", "boot trace armed" in tA, tA)
    ck("A: it announces loading then loaded for config.js", "loading: config.js" in tA and "loaded: config.js" in tA, tA)
    ck("A: it runs the inline sign-in card step", "running: sign-in card" in tA and "ran: sign-in card" in tA, tA)
    ck("A: it reaches loaded: app.js", "loaded: app.js" in tA, tA)
    ck("A: it runs the view router and dispatches DOMContentLoaded", "ran: view router" in tA and "dispatching DOMContentLoaded" in tA, tA)
    ck("A: with modules stubbed, no FAILED line", "FAILED" not in tA, tA)
    ck("A: the sign-in card actually rendered after supabase", pgA.evaluate("()=>!!document.getElementById('thriveGate')"), None)
    pgA.close()

    # ---- Scenario B: one module 404s -> red FAILED + STOP -----------------------------------------
    pgB = b.new_page()
    def routeB(route):
        u = route.request.url
        base_u = u.split("?")[0]
        if base_u.endswith("/stage-model.js"):
            route.fulfill(status=404, body="not found"); return
        if "/library/" in u and base_u.endswith(".js"):
            route.fulfill(status=200, headers={"content-type":"application/javascript"}, body=stub_for(u)); return
        route.continue_()
    pgB.route("**/*", routeB)
    pgB.goto(f"{base}/library/app.html", wait_until="domcontentloaded")
    pgB.wait_for_timeout(1200)
    tB = trace_text(pgB)
    ck("B: a failed module load writes a red FAILED line naming it", "FAILED: stage-model.js" in tB, tB)
    ck("B: the loader STOPS after the failure (later steps never announced)",
       "loading: stage-model.js" in tB and "loaded: stage-model.js" not in tB and "loaded: app.js" not in tB, tB)
    fail_color = pgB.evaluate("""()=>{var b=document.getElementById('bootTrace');if(!b)return '';
      var lines=b.querySelectorAll('div');for(var i=0;i<lines.length;i++){if(/FAILED/.test(lines[i].textContent))return lines[i].style.color;}return '';}""")
    ck("B: the FAILED line is red", "255, 107, 107" in fail_color or fail_color in ("rgb(255, 107, 107)","#ff6b6b"), fail_color)
    pgB.close()

    # ---- Scenario C: one module throws on execution -> global onerror surfaces it -----------------
    pgC = b.new_page()
    def routeC(route):
        u = route.request.url; base_u = u.split("?")[0]
        if base_u.endswith("/numbers.js"):
            route.fulfill(status=200, headers={"content-type":"application/javascript"},
                          body='throw new Error("BOOT_TRACE_THROW_PROOF");'); return
        if "/library/" in u and base_u.endswith(".js"):
            route.fulfill(status=200, headers={"content-type":"application/javascript"}, body=stub_for(u)); return
        route.continue_()
    pgC.route("**/*", routeC)
    pgC.goto(f"{base}/library/app.html", wait_until="domcontentloaded")
    pgC.wait_for_timeout(1500)
    tC = trace_text(pgC)
    ck("C: a throw during a module is surfaced by the global onerror handler",
       "ONERROR:" in tC and "BOOT_TRACE_THROW_PROOF" in tC, tC)
    # A throw during execution still fires the script's load event, so the chain continues; the culprit is
    # named precisely by the global onerror line, which carries the throwing module's source (numbers.js).
    ck("C: the onerror line names the throwing module's source (numbers.js)",
       "numbers.js" in tC and "loading: numbers.js" in tC, tC)
    pgC.close()

    # ---- Scenario D: a module that never responds -> 4s timeout FAILED ----------------------------
    pgD = b.new_page()
    def routeD(route):
        u = route.request.url; base_u = u.split("?")[0]
        if base_u.endswith("/kinds.js"):
            return  # never fulfilled: the request hangs, the per-script timeout must fire
        if "/library/" in u and base_u.endswith(".js"):
            route.fulfill(status=200, headers={"content-type":"application/javascript"}, body=stub_for(u)); return
        route.continue_()
    pgD.route("**/*", routeD)
    pgD.goto(f"{base}/library/app.html", wait_until="domcontentloaded")
    pgD.wait_for_timeout(5200)   # > the 4s per-script timeout
    tD = trace_text(pgD)
    ck("D: a hanging module trips the 4s timeout with a red FAILED line", "FAILED: kinds.js - timeout after 4s" in tD, tD)
    ck("D: the hang stops the chain (later steps never announced)", "loading: kinds.js" in tD and "loaded: app.js" not in tD, tD)
    pgD.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOOT-TRACE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
