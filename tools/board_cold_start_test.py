"""BOARD_PAINT_COLD_START (browser + source, fails-when-broken).

On a fresh origin the board render threw on cold-start data and the board stayed black, silent because the
async initBoard was dispatched un-awaited. This locks two things:

  1. A board render fault can never hide: the render() call and the un-awaited view-init dispatch are wrapped,
     and any exception is surfaced ON SCREEN through the failsafe panel (exact name + message + the throwing
     statement), never swallowed into an unhandledrejection.
  2. A render fault recovers to the EMPTY board (never black): boardRenderRecover paints the empty state,
     marks the boot painted, and records the exact exception for the diag panel.

The browser half proves the on-screen surface end to end WITHOUT the full app (which the harness cannot run):
calling window.__thriveBoardFault(err) reveals the shell and prints the exact exception in the failsafe panel.
"""
import os, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

fsjs = open(os.path.join(ROOT, "library/failsafe.js")).read()
appjs = open(os.path.join(ROOT, "library/app.js")).read()
shell = open(os.path.join(ROOT, "library/console.html")).read()

# ---- source guards --------------------------------------------------------------------------------
ck("failsafe exposes __thriveBoardFault, routed through the exact-exception panel",
   "window.__thriveBoardFault = function" in fsjs and 'panel("Board did not paint"' in fsjs)
ck("boardRepaint catches a render() throw and recovers (never a black board)",
   "try{ render(trigger, source); } catch(e){ boardRenderRecover(e); } finally { __boardPin=null; }" in appjs)
ck("boardRenderRecover paints the EMPTY state, marks the boot painted, and surfaces the exact exception",
   ('if(el("boardEmpty")) el("boardEmpty").hidden=false;' in appjs
    and 'if(el("boardLanes")) el("boardLanes").hidden=true;' in appjs
    and 'window.__boardPainted=true; window.__bootMark="board painted";' in appjs
    and "window.__boardRenderError=" in appjs
    and "window.__thriveBoardFault==" in appjs))
ck("the un-awaited view-init dispatch catches BOTH the sync throw and the async rejection",
   "__rv.catch(__viewInitFault)" in shell and "window.__thriveBoardFault" in shell)
ck("the named el() writes are guarded (a missing board element paints empty, never throws)",
   ('if(el("boardVerdict")) el("boardVerdict").innerHTML' in appjs
    and 'if(el("boardEmpty")) el("boardEmpty").hidden' in appjs
    and 'if(el("boardLanes")) el("boardLanes").hidden' in appjs))
ck("the diag panel names the exact board render error when one occurred",
   'board render error: "+String(window.__boardRenderError)' in appjs)

# ---- browser: __thriveBoardFault surfaces the exact exception on screen ---------------------------
PAGE = ('<!doctype html><html class="gate-locked"><head><meta name="thrive-build" content="testbuild">'
        '<style>html.gate-locked .wrap{display:none}</style></head>'
        '<body><div class="wrap">app</div>'
        '<script src="/library/failsafe.js"></script>'
        '<script>window.addEventListener("load",function(){'
        'var e=new Error("BOARD_COLD_START_PROOF");e.stack="Error: BOARD_COLD_START_PROOF\\n    at render (app.js:11361)";'
        'window.__thriveBoardFault(e);});</script></body></html>')

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

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/__page", wait_until="load")
    pg.wait_for_timeout(600)
    st = pg.evaluate("""()=>{
      var box=document.getElementById('thriveFailsafe');
      return { shown: !!box, text: box?box.textContent:'',
               locked: document.documentElement.classList.contains('gate-locked') };
    }""")
    ck("the failsafe panel appears when a board fault is reported", st.get("shown"), st)
    ck("the panel names the EXACT exception message", "BOARD_COLD_START_PROOF" in (st.get("text") or ""), st)
    ck("the panel names the throwing statement (the At: line from the stack)",
       "app.js:11361" in (st.get("text") or ""), st)
    ck("reporting a fault reveals the shell (gate-locked removed), so it is never over a black screen",
       not st.get("locked"), st)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-COLD-START CHECKS PASS"))
raise SystemExit(1 if fails else 0)
