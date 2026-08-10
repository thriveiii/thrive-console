"""Session lifecycle: one deterministic way in and out, graduated presence (WO-026, supersedes #95/#97).

The Lock control is gone; sign-in and sign-out are the only manual auth actions. One last-active stamp
(localStorage, survives WebKit eviction) is read against TWO thresholds so the walk out is always the
same order and never a moody swap:
  - inside 30 minutes idle: the board, no gate;
  - 30 to 45 minutes idle: the operator session drops, back to the lobby (operator email), passcode kept;
  - past 45 minutes idle: the passcode presence drops too, back to Gate 1 (the passcode).
Manual sign-out returns to the lobby (passcode kept). A fresh device is deterministic: passcode, lobby,
board. Never a blank board (#84); no key paste (#94, the baked connection). The gate-form submits are
programmatic so the #96 determinism holds. Real WebKit timing/eviction stay Thyab's device gate."""
import threading, http.server, socketserver, functools, os, re
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

# ---- source: the two thresholds are one constant each, one place each; Lock is gone ----
gate = open(os.path.join(ROOT, "library/gate.js")).read()
ck("OPERATOR_IDLE_MIN = 30 is one constant, one place",
   len(re.findall(r"OPERATOR_IDLE_MIN\s*=\s*30\b", gate)) == 1)
ck("PASSCODE_IDLE_MIN = 45 is one constant, one place",
   len(re.findall(r"PASSCODE_IDLE_MIN\s*=\s*45\b", gate)) == 1)
ck("the Lock handler is removed from the client (no window.thriveLock)", "thriveLock" not in gate)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

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
        return json({error:'x'}, st);
      }
    }
    if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0) return new Response('',{status:204});
    return real?real(url,opts):new Response('',{status:200});
  };
})()
"""

def no_gate(pg): return pg.evaluate("()=>!document.getElementById('thriveGate')")
def has(pg, sel): return pg.query_selector(sel) is not None
def submit(pg): pg.eval_on_selector("#thriveGate form", "f => f.requestSubmit()")
def set_val(pg, sel, val):
    pg.eval_on_selector(sel, "(el,v)=>{el.value=v; el.dispatchEvent(new Event('input',{bubbles:true}));}", val)
def set_idle(pg, minutes):
    pg.evaluate("(m)=>{ try{ sessionStorage.clear(); localStorage.setItem('thrive_presence', String(Date.now()-m*60*1000)); }catch(e){} }", minutes)
def to_board(pg):
    if has(pg, "#gateInput"):
        set_val(pg,"#gateInput",PASSCODE); submit(pg); pg.wait_for_selector("#gateEmail", timeout=10000)
    if has(pg, "#gateEmail"):
        set_val(pg,"#gateEmail","op@thrive.co"); set_val(pg,"#gatePass","right"); submit(pg)
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 460, "height": 860})
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")

    # ---- deterministic fresh device: passcode, then the lobby, then the board ----
    pg.wait_for_selector("#gateInput", timeout=10000)
    set_val(pg,"#gateInput",PASSCODE); submit(pg)
    pg.wait_for_selector("#gateEmail", timeout=10000)
    ck("fresh device is deterministic: passcode then the lobby (operator email), not the board, not a blank",
       has(pg,"#gateEmail") and not has(pg,"#gateInput"))
    set_val(pg,"#gateEmail","op@thrive.co"); set_val(pg,"#gatePass","right"); submit(pg)
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    ck("past the lobby the board shows and a presence window opens",
       no_gate(pg) and pg.evaluate("()=>!!localStorage.getItem('thrive_presence')"))

    # ---- no Lock control anywhere; sign-out is the only manual auth action on the board ----
    ck("there is no Lock control in the header and no thriveLock handler",
       not has(pg,"#lockbtn") and pg.evaluate("()=>typeof window.thriveLock==='undefined'"))

    # ---- a return inside 30 minutes idle goes straight to the board, no gate ----
    set_idle(pg, 12); pg.reload()
    pg.wait_for_function("()=>typeof window.ThriveSupa==='object'", timeout=10000); pg.wait_for_timeout(400)
    ck("a return inside 30 minutes idle goes straight to the board, no gate",
       no_gate(pg) and not has(pg,"#gateInput"))

    # ---- 30 to 45 minutes idle: the lobby (operator email), the passcode is NOT re-asked ----
    set_idle(pg, 35); pg.reload()
    pg.wait_for_selector("#gateEmail", timeout=10000)
    ck("30 to 45 minutes idle drops to the lobby: operator email, no passcode; the passcode presence is kept",
       has(pg,"#gateEmail") and not has(pg,"#gateInput") and pg.evaluate("()=>!!localStorage.getItem('thrive_presence')"))
    ck("the operator session was dropped at the 30-minute threshold (the lobby, not the board)",
       pg.evaluate("()=>!localStorage.getItem('console_sb_session')"))
    set_val(pg,"#gateEmail","op@thrive.co"); set_val(pg,"#gatePass","right"); submit(pg)
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    ck("entering the operator email from the lobby returns to the board", no_gate(pg))

    # ---- past 45 minutes idle: the passcode first, then through the lobby to the board ----
    set_idle(pg, 47); pg.reload()
    pg.wait_for_selector("#gateInput", timeout=10000)
    ck("past 45 minutes idle drops fully to the passcode (Gate 1)",
       has(pg,"#gateInput") and not has(pg,"#gateEmail"))
    to_board(pg)
    ck("entering the passcode past 45 minutes returns through the lobby to the board", no_gate(pg))

    # ---- manual sign-out returns to the lobby (operator email), the passcode kept ----
    pg.evaluate("()=>window.thriveSignOut && window.thriveSignOut()")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    ck("manual sign-out returns to the lobby (operator email), the passcode is kept, never a blank board",
       has(pg,"#gateEmail") and not has(pg,"#gateInput") and pg.evaluate("()=>!!localStorage.getItem('thrive_presence')"))

    # ---- operator session robustness (unchanged): transient 5xx keeps it, definitive 401 ends it ----
    to_board(pg)
    trans = pg.evaluate("""async ()=>{ window.__refreshStatus=500; const r=await window.ThriveSupa.refresh();
      return { returned:r, stillSignedIn: window.ThriveSupa.signedIn() }; }""")
    ck("a transient (5xx) refresh failure keeps the operator session (no ejection on a blip)",
       trans["returned"] == False and trans["stillSignedIn"] == True, trans)
    defin = pg.evaluate("""async ()=>{ window.__refreshStatus=401; const r=await window.ThriveSupa.refresh();
      return { returned:r, stillSignedIn: window.ThriveSupa.signedIn() }; }""")
    ck("a definitive (401) refresh rejection ends the operator session",
       defin["returned"] == False and defin["stillSignedIn"] == False, defin)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SESSION LIFECYCLE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
