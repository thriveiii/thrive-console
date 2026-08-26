"""STORAGE_SAFE (browser + source, fails-when-broken).

engine-probe named the outage: under WebKit storage partitioning, even ACCESSING window.localStorage /
sessionStorage throws SecurityError, and one unguarded access on the boot path killed the console silently on
every device. The fix installs a memory-first, never-throwing storage facade as the first act of boot (the
board.html pattern applied to the old engine). This locks it:

  1. Under SIMULATED partitioning (window.localStorage / sessionStorage getters throw SecurityError), the old
     console (console.html) boots to its sign-in gate with NO uncaught SecurityError - the facade shadowed the
     throwing getter before any module ran.
  2. The facade is memory-first: setItem/getItem round-trip in memory with the real store blocked, no throw,
     and __storageMode reports "memory-only".
  3. ?boot=1 shows a PERMANENT on-screen boot log (kept forever, never auto-removed).
  4. Source: the facade is installed in the engine (failsafe, inlined into console.html), on gate.html and on
     the root index.html; board.html is UNTOUCHED (it stays the proven fallback).

Fails-when-broken: neuter the facade in the built console.html and the SimulatedPartitioning boot throws
SecurityError again (proven manually in the PR).
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
        if d is not None: print("      " + str(d)[:400])

# ---- source guards -------------------------------------------------------------------------------
failsafe = open(os.path.join(ROOT, "library/failsafe.js")).read()
console  = open(os.path.join(ROOT, "library/console.html")).read()
gate     = open(os.path.join(ROOT, "gate.html")).read()
index    = open(os.path.join(ROOT, "index.html")).read()
board    = open(os.path.join(ROOT, "library/board.html")).read()

ck("the memory-first facade lives in failsafe.js (installed first of boot)",
   "__thriveStorageSafe" in failsafe and "Object.defineProperty(window, kind" in failsafe and "memory-only" in failsafe)
ck("the facade is inlined into the served console shell (console.html)", "__thriveStorageSafe" in console)
ck("the facade guards the gate entry document (gate.html)", "__thriveStorageSafe" in gate)
ck("the facade guards the root index redirect (index.html)", "__thriveStorageSafe" in index)
ck("board.html is UNTOUCHED (no facade; it stays the proven fallback)", "__thriveStorageSafe" not in board)
ck("a permanent ?boot=1 boot log exists (kept forever)", 'boot=1' in failsafe and "thriveBootLog" in failsafe)

# ---- browser harness -----------------------------------------------------------------------------
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# Make even ACCESSING window.localStorage / sessionStorage throw SecurityError, exactly as WebKit partitioning
# does. configurable:true so the facade's own defineProperty can shadow it (the real fix).
PARTITION = """
(function(){
  function block(kind){
    try{ Object.defineProperty(window, kind, { configurable:true, get:function(){
      throw new DOMException("The operation is insecure.", "SecurityError");
    }}); }catch(e){}
  }
  block("localStorage"); block("sessionStorage");
})();
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== Scenario A: partitioning simulated, NO session -> boots to the gate, no SecurityError =====
    ctxA = b.new_context()
    errsA = []
    ctxA.add_init_script(PARTITION)
    # block outbound network so the boot cannot hang on a real read; the facade throw is what we are testing
    ctxA.route("**/*", lambda r: (r.continue_() if r.request.url.startswith(base) else r.abort()))
    pgA = ctxA.new_page()
    pgA.on("pageerror", lambda e: errsA.append(str(e)))
    pgA.on("console", lambda m: errsA.append(m.text) if m.type == "error" else None)
    pgA.goto(f"{base}/library/console.html", wait_until="domcontentloaded")
    pgA.wait_for_timeout(2500)
    stA = pgA.evaluate("""()=>({
      safe: !!window.__thriveStorageSafe,
      mode: window.__storageMode || "",
      // the facade round-trips in memory with the real store blocked, and never throws
      roundtrip: (function(){ try{ localStorage.setItem("__t","hi"); return localStorage.getItem("__t"); }catch(e){ return "THREW:"+e.name; } })(),
      ssroundtrip: (function(){ try{ sessionStorage.setItem("__s","ok"); return sessionStorage.getItem("__s"); }catch(e){ return "THREW:"+e.name; } })(),
      // the console reached its sign-in gate (boot did not die)
      gate: !!(document.getElementById("thriveGate") || document.querySelector("input[type=password]") || /sign/i.test((document.body||{}).textContent||"")),
      failsafeText: (document.getElementById("thriveFailsafe")||{}).textContent || ""
    })""")
    secErrs = [e for e in errsA if ("SecurityError" in e or "insecure" in e.lower())]
    ck("A: the storage-safe facade installed under partitioning", stA["safe"], stA)
    ck("A: it detected the blocked store and went memory-only", stA["mode"] == "memory-only", stA)
    ck("A: localStorage round-trips in memory, never throwing", stA["roundtrip"] == "hi", stA)
    ck("A: sessionStorage round-trips in memory, never throwing", stA["ssroundtrip"] == "ok", stA)
    ck("A: NO uncaught SecurityError reached the page (the outage is gone)", len(secErrs) == 0, secErrs)
    ck("A: the failsafe panel did not fire a SecurityError", "SecurityError" not in stA["failsafeText"], stA["failsafeText"])
    ck("A: the console reached its sign-in gate (boot survived)", stA["gate"], stA)
    ctxA.close()

    # ===== Scenario B: ?boot=1 shows a PERMANENT on-screen boot log =====
    ctxB = b.new_context()
    ctxB.route("**/*", lambda r: (r.continue_() if r.request.url.startswith(base) else r.abort()))
    pgB = ctxB.new_page()
    pgB.goto(f"{base}/library/console.html?boot=1", wait_until="domcontentloaded")
    pgB.wait_for_timeout(1500)
    early = pgB.evaluate("()=>{var b=document.getElementById('thriveBootLog');return b?b.textContent:'';}")
    pgB.wait_for_timeout(4000)   # boot log must NOT auto-remove itself
    late = pgB.evaluate("()=>{var b=document.getElementById('thriveBootLog');return b?b.textContent:'';}")
    ck("B: ?boot=1 paints an on-screen boot log with the storage mode", ("boot=1" in early) and ("storage" in early), early[:120])
    ck("B: the boot log is PERMANENT (still on screen 4s later, never auto-removed)", "boot=1" in late, late[:120])
    ctxB.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL STORAGE-SAFE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
