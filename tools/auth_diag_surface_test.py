"""P35 · the auth failure is revealed verbatim on screen (real Chromium).

The console has never captured WHY the cold-start auth POST fails; the generic "could not start" hid it.
This proves, in a real browser, that:
  * a boot line records the session-restore-vs-cold-auth decision (the iPad-vs-others split);
  * an HTTP failure (e.g. 401 with a GoTrue body) is shown on the sign-in card as a structured, copyable
    block with stage / http status / body / elapsed, not a generic sentence;
  * a network reject (fetch throws) is shown with its error name/message and stage=fetch-rejected.
Reveal-only: the request shape is unchanged (asserted by signin_resilience_test Part F / C17)."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Mock the token endpoint. mode 401 -> a GoTrue "Invalid API key" body; mode throw -> a network reject.
MOCK = r"""
(mode) => {
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0) {
      if (mode==='throw') throw new TypeError('Load failed');
      return new Response(JSON.stringify({code:401, message:'Invalid API key'}), {status:401, statusText:'Unauthorized', headers:{'Content-Type':'application/json'}});
    }
    return real(url, opts);
  };
  return true;
}
"""

def run_case(pg, mode):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(500)
    pg.wait_for_function("()=>window.ThriveSupa && typeof window.ThriveSupa.signIn==='function'", timeout=15000)
    pg.wait_for_selector("#gateEmail", timeout=8000)
    pg.evaluate(MOCK, mode)
    pg.fill("#gateEmail", "op@thrive.co"); pg.fill("#gatePass", "whatever")
    pg.click(".gate-btn[type=submit]")
    # the diagnostic block is populated synchronously after the awaited signIn settles
    pg.wait_for_function("()=>{var d=document.getElementById('gateDiag');return d && !d.hidden && /stage:/.test(d.textContent||'');}", timeout=15000)
    return {
        "diag": pg.eval_on_selector("#gateDiag", "el=>el.textContent") or "",
        "panel": (pg.eval_on_selector("#p35diag", "el=>el.value") if pg.query_selector("#p35diag") else "") or "",
    }

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()

    # Case 1: HTTP 401 with a GoTrue body — the exact device symptom.
    r = run_case(pg, "http")
    d = r["diag"]
    ck("401: block names the stage (body-read)", "stage: body-read" in d, d)
    ck("401: block shows the HTTP status and statusText", "http: 401" in d and "Unauthorized" in d, d)
    ck("401: block shows the GoTrue body verbatim", "Invalid API key" in d and "body:" in d, d)
    ck("401: block shows elapsed ms", "elapsed:" in d and "ms" in d, d)
    ck("401: boot panel logged the session decision (cold auth on a fresh device)",
       ("cold auth" in r["panel"]) or ("session" in r["panel"]), r["panel"])

    # Case 2: a network reject (fetch throws) — the "TypeError: Load failed" environmental case.
    r2 = run_case(pg, "throw")
    d2 = r2["diag"]
    ck("network: block names the stage (fetch-rejected)", "stage: fetch-rejected" in d2, d2)
    ck("network: block shows the error name and message", "TypeError" in d2 and "Load failed" in d2, d2)
    ck("network: block shows (no response received)", "no response received" in d2, d2)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL P35 AUTH-DIAG CHECKS PASS"))
raise SystemExit(1 if fails else 0)
