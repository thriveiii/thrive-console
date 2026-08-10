"""Session lifecycle: two gates that hold, and a 30-minute presence.

The seat. Before this, the passcode unlock lived only in sessionStorage, which iOS Safari evicts on a
short absence, so the operator was thrown back to the passcode every time they looked away; and the
operator session was wiped on any refresh failure, including a transient network blip. This proves the
fix engine-independently (the timing and the real WebKit eviction stay Thyab's device gate):
  - after unlock + operator sign-in the board shows and a presence window opens;
  - a short absence (sessionStorage gone, localStorage kept) returns straight to the board, no gate;
  - 30 minutes of idle re-gates to the passcode;
  - a genuinely fresh device is deterministic: passcode, then operator, then board;
  - a manual lock ends the presence at once;
  - the operator session survives a transient (5xx) refresh failure and ends only on a definitive
    rejection (401)."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PASSCODE = "ConThrive2030"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Stored connection (overrides the baked one) + a mocked auth. window.__refreshStatus controls the
# refresh-token response so the robustness path can be exercised.
INIT = r"""
(() => {
  try { localStorage.setItem('console_sb_url','https://fake.supabase.co'); localStorage.setItem('console_sb_anon','anon-key'); } catch(e){}
  window.__refreshStatus = 200;
  const json = (v,s)=> new Response(JSON.stringify(v), {status:s||200, headers:{'Content-Type':'application/json'}});
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    const body=(opts&&opts.body)?JSON.parse(opts.body):null;
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0) {
      if (url.indexOf('grant_type=password')>=0) {
        if (body.email==='op@thrive.co' && body.password==='right')
          return json({access_token:'jwt-1', refresh_token:'r-1', expires_at:9999999999, user:{id:'uid-1'}});
        return json({error_description:'bad'}, 400);
      }
      if (url.indexOf('grant_type=refresh_token')>=0) {
        const st = window.__refreshStatus||200;
        if (st===200) return json({access_token:'jwt-2', refresh_token:'r-2', expires_at:9999999999, user:{id:'uid-1'}});
        return json({error:'x'}, st);   // 500 transient, or 401 definitive
      }
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0) return new Response('',{status:204});
    return real?real(url,opts):new Response('',{status:200});
  };
})()
"""

def no_gate(pg): return pg.evaluate("()=>!document.getElementById('thriveGate')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 460, "height": 860})
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")

    # ---- deterministic fresh device: passcode, then operator, then board ----
    pg.wait_for_selector("#gateInput", timeout=10000)
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    ck("a fresh device is deterministic: passcode then the operator step (not the board, not a blank)",
       pg.evaluate("()=>!!document.getElementById('gateEmail')"))
    pg.fill("#gateEmail","op@thrive.co"); pg.fill("#gatePass","right"); pg.click(".gate-btn")
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    ck("after the operator signs in the console reveals (board), and a presence window opens",
       no_gate(pg) and pg.evaluate("()=>!!localStorage.getItem('thrive_presence')"))

    # ---- a short absence: sessionStorage evicted (as iOS does), localStorage kept -> straight to board ----
    pg.evaluate("()=>{ try{ sessionStorage.clear(); }catch(e){} }")   # the eviction a short background causes
    pg.reload()
    pg.wait_for_function("()=>typeof window.ThriveSupa==='object'", timeout=10000); pg.wait_for_timeout(400)
    ck("a short absence returns straight to the board, no gate (the presence held it)",
       no_gate(pg) and pg.query_selector("#gateInput") is None)

    # ---- 30 minutes of idle re-gates to the passcode ----
    pg.evaluate("()=>{ try{ sessionStorage.clear(); localStorage.setItem('thrive_presence', String(Date.now()-31*60*1000)); }catch(e){} }")
    pg.reload()
    pg.wait_for_selector("#gateInput", timeout=10000)
    ck("30 minutes of idle re-gates to the passcode (presence expired)",
       pg.evaluate("()=>!!document.getElementById('gateInput') && !document.getElementById('gateEmail')"))

    # back in for the next checks
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    # operator session still stored, so it goes straight past the operator step to the board
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    ck("with the operator session still valid, the re-gate asks only the passcode, then the board",
       no_gate(pg))

    # ---- manual lock ends the presence window at once ----
    pg.evaluate("()=>window.thriveLock && window.thriveLock()")
    pg.wait_for_selector("#gateInput", timeout=10000)
    ck("a manual lock clears the presence and returns to the passcode",
       pg.evaluate("()=>!localStorage.getItem('thrive_presence')") and pg.evaluate("()=>!!document.getElementById('gateInput')"))

    # ---- operator session robustness: transient 5xx keeps it; definitive 401 ends it ----
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    trans = pg.evaluate("""async ()=>{
      window.__refreshStatus = 500;
      const r = await window.ThriveSupa.refresh();
      return { returned:r, stillSignedIn: window.ThriveSupa.signedIn() };
    }""")
    ck("a transient (5xx) refresh failure keeps the operator session (no ejection on a blip)",
       trans["returned"]==False and trans["stillSignedIn"]==True, trans)
    defin = pg.evaluate("""async ()=>{
      window.__refreshStatus = 401;
      const r = await window.ThriveSupa.refresh();
      return { returned:r, stillSignedIn: window.ThriveSupa.signedIn() };
    }""")
    ck("a definitive (401) refresh rejection ends the operator session",
       defin["returned"]==False and defin["stillSignedIn"]==False, defin)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SESSION LIFECYCLE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
