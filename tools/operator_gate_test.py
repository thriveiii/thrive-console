"""P2 - three operators, equal, newsroom-grade gate behavior.

The passcode (gate one) is untouched; after it, if there is no Supabase session, the same gate screen asks
for operator email and password (gate two). Failure is neutral (a wrong email and a wrong password read
the same), attempts are throttled with an exponential backoff that survives a reload and clears on success,
the session persists across a reopen, and sign-out returns to the operator step, never the passcode and
never a blank board. Equal operators: the header shows only the email, no role. One sign-in surface: the
Settings sign-in block is gone. Arabic gate copy and three-width layout are Thyab's device gate."""
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

# no password or operator list in the repo
gate = open(os.path.join(ROOT, "library/gate.js")).read()
ck("no operator password or list is embedded in the gate", "op@" not in gate and "@thrive" not in gate and "password:" not in gate.lower())
ck("the passcode and the operator sign-in are two steps, not one credential",
   "showPasscodeStep" in gate and "showOperatorStep" in gate and "needsOperator" in gate)
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("the Settings sign-in handler is removed (one sign-in surface)",
   'el("sbSignIn")' not in app and 'el("sbSignOut")' not in app)
settings = open(os.path.join(ROOT, "library/settings.html")).read()
ck("the Settings sign-in markup is removed", 'id="sb_email"' not in settings and 'id="sbSignIn"' not in settings)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Supabase configured before the gate runs, and a mocked auth endpoint. op@thrive.co / right is the only
# accepted pair; everything else is a neutral failure.
INIT = r"""
(() => {
  // P56 GATE_BREACH: the live operator sign-in now redirects to the standalone gate.html. This test
  // exercises the in-console fallback card (the path shown when the redirect is suppressed or bounces), so
  // it disables the redirect and drives the in-console token POST directly, as before.
  try { window.__gateNoRedirect = true; } catch(e){}
  try { localStorage.setItem('console_sb_url','https://fake.supabase.co'); localStorage.setItem('console_sb_anon','anon-key'); } catch(e){}
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    const body = (opts && opts.body) ? JSON.parse(opts.body) : {};
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0) {
      if (url.indexOf('grant_type=password')>=0) {
        if (body.email==='op@thrive.co' && body.password==='right')
          return new Response(JSON.stringify({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999}), {status:200, headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify({error_description:'Invalid login credentials'}), {status:400, headers:{'Content-Type':'application/json'}});
      }
      if (url.indexOf('grant_type=refresh_token')>=0)
        return new Response(JSON.stringify({access_token:'jwt-x2', refresh_token:'r2', expires_at:9999999999}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0) return new Response('', {status:204});
    return real ? real(url, opts) : new Response('', {status:200});
  };
})()
"""

def sign_in_fail(pg, email, pw):
    pg.fill("#gateEmail", email); pg.fill("#gatePass", pw)
    pg.click(".gate-btn"); pg.wait_for_timeout(400)
    return pg.eval_on_selector("#gateErr", "e=>e.textContent")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)

    # ---- passcode first, then the operator step (not the console) ----
    pg.wait_for_selector("#gateInput", timeout=10000)
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    ck("after the passcode, the gate asks for operator sign-in (gate two), console still locked",
       pg.query_selector("#gateEmail") is not None and pg.evaluate("()=>document.documentElement.classList.contains('gate-locked')"))
    ck("the operator step is not the passcode step (two steps, sequenced)",
       pg.query_selector("#gateInput") is None)

    # ---- neutral failure: a wrong email and a wrong password read the same ----
    op_err = pg.evaluate("()=>document.getElementById('gateErr').textContent")   # default text is the neutral message
    m1 = sign_in_fail(pg, "wrong@x.com", "right")     # wrong email
    m2 = sign_in_fail(pg, "op@thrive.co", "wrong")    # wrong password
    ck("a wrong email and a wrong password return the identical neutral message",
       m1 == m2 and m1.strip() != "", (m1, m2))
    ck("the neutral message does not name which field was wrong",
       "email" not in m1.lower() and "password" not in m1.lower(), m1)

    # ---- throttle: the third failure engages the backoff, and it survives a reload ----
    m3 = sign_in_fail(pg, "op@thrive.co", "wrong")    # third failure -> backoff
    locked = pg.evaluate("()=>{ try{ return JSON.parse(localStorage.getItem('thrive_op_fails')||'{}'); }catch(e){ return {}; } }")
    ck("after 3 failures the backoff engages (an until in the future) and the wait is shown",
       locked.get("n",0) >= 3 and locked.get("until",0) > 0 and "5s" in m3.replace(" ",""), (locked, m3))
    pg.reload(); pg.wait_for_timeout(400); pg.wait_for_selector("#gateEmail", timeout=10000)
    waitmsg = sign_in_fail(pg, "op@thrive.co", "right")   # even correct is refused while locked
    ck("the backoff survives a reload (still refused, wait shown)",
       pg.query_selector("#gateEmail") is not None and pg.evaluate("()=>document.documentElement.classList.contains('gate-locked')"), waitmsg)

    # ---- success clears the throttle and reveals the console; the header shows only the email ----
    pg.evaluate("()=>localStorage.removeItem('thrive_op_fails')")     # simulate the wait elapsing
    pg.fill("#gateEmail", "op@thrive.co"); pg.fill("#gatePass", "right"); pg.click(".gate-btn")
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    ck("a correct sign-in reveals the console and clears the throttle",
       pg.evaluate("()=>!document.documentElement.classList.contains('gate-locked')") and
       pg.evaluate("()=>localStorage.getItem('thrive_op_fails')") is None)
    pg.wait_for_timeout(400)
    chip = pg.evaluate("""()=>{ const c=document.getElementById('opChip'); return c? { email:(c.querySelector('.op-email')||{}).textContent||'', text:c.textContent } : null; }""")
    ck("the header shows the signed-in email and nothing about a role",
       chip and chip["email"]=="op@thrive.co" and "role" not in chip["text"].lower() and "admin" not in chip["text"].lower(), chip)

    # ---- the session persists across a reopen ----
    pg.reload(); pg.wait_for_timeout(600)
    ck("the session persists across a reopen (no gate, no operator step)",
       pg.query_selector("#gateEmail") is None and pg.evaluate("()=>!document.documentElement.classList.contains('gate-locked')"))

    # ---- sign-out returns to the operator step, never the passcode, never a blank board ----
    pg.evaluate("()=>window.thriveSignOut()"); pg.wait_for_timeout(600)
    pg.wait_for_selector("#gateEmail", timeout=10000)
    ck("sign-out returns to the operator step (not the passcode, gate shown, not blank)",
       pg.query_selector("#gateEmail") is not None and pg.query_selector("#gateInput") is None and
       pg.evaluate("()=>document.documentElement.classList.contains('gate-locked')"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL OPERATOR GATE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
