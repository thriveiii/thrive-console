"""The connection is baked into the build: a fresh device with empty local storage has it, and the first
open is a sign-in, never a setup.

The two baked values (project URL, anon public key) are filled by Thyab in library/config.js. They are
public by design; RLS plus the operator sign-in protect the data, not their secrecy. This test proves
the MECHANISM independent of the real values by serving a config.js with demo values injected: with
NOTHING in localStorage, the connection resolves from the baked constants, so ThriveSupa.ready() is
true and, after the passcode, the operator sign-in step shows at once (needsOperator true) rather than
passcode-only. A stored value still overrides the baked default."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PASSCODE = "ConThrive2030"
DEMO_URL = "https://demo-baked.supabase.co"
DEMO_ANON = "anon-baked-demo-key"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# A handler that serves config.js with the empty baked constants replaced by demo values, so the test
# exercises a real baked build without needing (or committing) the project's real public values.
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_GET(self):
        if self.path.split("?")[0].endswith("/library/config.js"):
            src = open(os.path.join(ROOT, "library/config.js"), "r", encoding="utf-8").read()
            src = re.sub(r'C\.supaUrl\s*=\s*"[^"]*";',  'C.supaUrl = "%s";' % DEMO_URL, src)
            src = re.sub(r'C\.supaAnon\s*=\s*"[^"]*";', 'C.supaAnon = "%s";' % DEMO_ANON, src)
            b = src.encode("utf-8")
            self.send_response(200); self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()

socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), H); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 430, "height": 820})
    # A genuinely fresh device: nothing in localStorage, no stored connection, no session.
    pg.goto(f"{base}/library/console.html")

    # config.js loaded and set the baked connection object.
    pg.wait_for_selector("#gateInput", timeout=10000)
    conf = pg.evaluate("()=>window.THRIVE_CONFIG||null")
    ck("the build ships a baked connection object (config.js loaded before the gate)",
       bool(conf) and conf.get("supaUrl")==DEMO_URL and conf.get("supaAnon")==DEMO_ANON, conf)

    # With empty localStorage, the client resolves the connection from the baked constants.
    resolved = pg.evaluate("""()=>{
      try{ localStorage.removeItem('console_sb_url'); localStorage.removeItem('console_sb_anon'); }catch(e){}
      return { cfg: window.ThriveSupa.cfg(), ready: window.ThriveSupa.ready() };
    }""")
    ck("a fresh device with empty local storage has the connection from the baked constants (nothing entered)",
       resolved["cfg"]["url"]==DEMO_URL and resolved["cfg"]["anon"]==DEMO_ANON and resolved["ready"]==True, resolved)

    # First open is a sign-in: after the passcode the operator email step shows, because the connection
    # is present (needsOperator true), not passcode-only.
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    appeared = True
    try: pg.wait_for_selector("#gateEmail", timeout=8000)
    except Exception: appeared = False
    ck("after the passcode on a fresh device, the operator sign-in step shows (never passcode-only, never setup)",
       appeared and pg.evaluate("()=>!!document.getElementById('gateEmail')"))

    # A stored value still overrides the baked default (a deliberate change or a legacy device).
    over = pg.evaluate("""()=>{
      try{ localStorage.setItem('console_sb_url','https://stored-override.supabase.co'); }catch(e){}
      return window.ThriveSupa.cfg().url;
    }""")
    ck("a stored connection overrides the baked default", over=="https://stored-override.supabase.co", over)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BAKED-CONNECTION CHECKS PASS"))
raise SystemExit(1 if fails else 0)
