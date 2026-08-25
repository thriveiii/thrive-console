"""SESSION_HANDOFF_FIX (browser, fails-when-broken).

Branch A, device-confirmed: on the failing iPad, localStorage does not survive a document navigation, so the
session key is absent at console boot, gateTarget returns passcode, and the console ejects. The fix carries
the operator session in the URL fragment (which survives every same-origin navigation) and adopts it into
memory before the gate decides.

This test reproduces the exact device with localStorage FULLY DISABLED (getItem always null, setItem always
throws), seeds the session ONLY through the fragment, and proves the console reaches the board with no eject.
If storage were the crutch, this test could not pass; it passes only because the fragment carries the
session and gate.js adopts the carried presence. It also proves the token is stripped from the URL at boot.

  With localStorage dead and #s=<session> in the URL:
    - gate-locked is removed (the board is revealed), no operator gate card is shown, no eject to gate.html
    - ThriveSupa.signedIn() is true (from memory, not storage)
    - the fragment token is stripped from the visible URL

Fails-when-broken: neutralizing the fragment adoption (or the presence seed) leaves gateTarget at passcode,
the board is never revealed, and the reveal assertion goes red.
"""
import os, json, base64, time, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
GATE_HASH = "0983eea9ab7aa4a1dea8d6015db3b63a66e67144947a7705cbab6ce91b395dc8"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ---- source guards -------------------------------------------------------------------------------
gateh = open(os.path.join(ROOT, "gate.html")).read()
gatej = open(os.path.join(ROOT, "library/gate.js")).read()
shell = open(os.path.join(ROOT, "library/console.html")).read()
ck("Part 1: gate.html carries the session in the fragment and no longer returns on a mirror-write failure",
   'b64urlEncode(JSON.stringify({ s:carry' in gateh
   and '#s=" + b64urlEncode' in gateh
   and 'session mirror write failed: storage unavailable' not in gateh)
ck("Part 3: the shell adopts the fragment session (setSession) before gate.js and strips the token",
   'window.ThriveSupa.adoptSession(sess)' in shell and 'history.replaceState' in shell
   and shell.find('fragment adopt') < shell.find('gate.js?v'))
ck("Part 3: gate.js seeds in-memory presence from the carried session (window.__seedPresence)",
   'Number(window.__seedPresence)' in gatej)
ck("Part 4: the boot self-heal clears the session ONLY on a definitive 400/401, never on a transient",
   'td.status === 400 || __td.status === 401' in gatej.replace("__td.status === 400", "td.status === 400"))

# ---- browser: the Branch A device (localStorage disabled), session only in the fragment ----------
def b64url(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode("utf-8")).decode("ascii").rstrip("=")

FUTURE = 9999999999
carry = {"access_token": "a." + ("x" * 380) + ".b", "refresh_token": "r" * 40,
         "expires_at": FUTURE, "email": "op@t.co", "uid": "u"}
# A FRESH presence stamp, exactly as gate.html sets p=Date.now() at hand-off (seconds-old, inside the 45
# minute window), so the carried presence lets gateTarget resolve to the board.
frag = "#s=" + b64url({"s": carry, "p": int(time.time() * 1000)})

DISABLE_LS = """(()=>{try{
  var fake={getItem:function(){return null;},setItem:function(){throw new Error('storage disabled (test: Branch A device)');},
            removeItem:function(){},clear:function(){},key:function(){return null;},length:0};
  Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return fake;}});
}catch(e){}})()"""
# sessionStorage stays alive so the paint-lock passes; seed the gate token there.
SEED_SS = ("(()=>{try{sessionStorage.setItem('thrive_gate_v2','%s');window.__gateNoRedirect=false;}catch(e){}})()"
           % GATE_HASH)

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
    ctx.add_init_script(DISABLE_LS)
    ctx.add_init_script(SEED_SS)
    ctx.route("**/app.js*", lambda r: r.abort())     # board paint is app.js's job; the gate decision is the subject
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html{frag}", wait_until="commit")

    # Confirm the device really is storage-dead in this context (else the test would prove nothing).
    dead = pg.evaluate("()=>{try{localStorage.setItem('x','1');return false;}catch(e){return localStorage.getItem('x')===null;}}")
    ck("the test context truly has localStorage disabled (Branch A device reproduced)", dead)

    # Wait until the gate has actually DECIDED (gate.js sets window.__entryDiag in start()), or until an
    # eject navigates away. Polling only on "not locked" would read the frame before gate.js even runs,
    # because the seeded session-storage token lets the paint-lock pass immediately.
    st = {}
    for _ in range(40):
        st = pg.evaluate("""()=>({
          decided: !!window.__entryDiag,
          gateTarget: (window.__entryDiag&&window.__entryDiag.gateTarget)||null,
          locked: document.documentElement.classList.contains('gate-locked'),
          gate: !!document.getElementById('thriveGate'),
          revealed: !!window.__gateRevealed,
          signedIn: (function(){ try{ return !!(window.ThriveSupa&&window.ThriveSupa.signedIn&&window.ThriveSupa.signedIn()); }catch(e){ return false; } })(),
          path: location.pathname, hash: location.hash
        })""")
        if st.get("decided") or not (st.get("path") or "").endswith("/console.html"):
            break
        pg.wait_for_timeout(250)

    ck("the gate resolves to the board (not the passcode) with the session only in the fragment",
       st.get("gateTarget") == "board", st)
    ck("the console reveals the board (gate-locked removed, no gate card)",
       not st.get("locked") and not st.get("gate"), st)
    ck("ThriveSupa.signedIn() is true from memory, though localStorage is dead", st.get("signedIn"), st)
    ck("the console did NOT eject to gate.html", st.get("path", "").endswith("/console.html"), st)
    ck("the session token is stripped from the visible URL at boot (no s= in the hash)",
       "s=" not in (st.get("hash") or ""), st)
    ctx.close()
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SESSION-HANDOFF-FIX CHECKS PASS"))
raise SystemExit(1 if fails else 0)
