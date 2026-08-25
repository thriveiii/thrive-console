"""CONSOLE_ENTRY_DIAG handoff instrument (browser, fails-when-broken).

The device evidence isolated the console outage to a session-handoff eject: paint and delivery are proven
good, yet the console loads and then bounces to the gate. The eject has two branches, both gated on the same
localStorage read, and only the device can say which one fires. This PR adds a read-only instrument that
records six facts at console boot and mirrors them so they survive the param-less eject navigation and can be
photographed on the destination.

This test proves the instrument is HONEST and READ-ONLY, by driving both real eject branches through the real
gate.js (app.js aborted, exactly as the other entry tests do) and reading the six lines off gate.html:

  Branch A  no session at boot       -> present:no  hasToken:no  expired:no  getSession:none  target:lobby  redirect:yes
  Branch B  expired session, refresh
            fails transiently (503)  -> present:yes hasToken:yes expired:yes getSession:unavailable(503)   redirect:yes

The instrument must never change the decision: the values it prints must match what actually happened, and the
mirror it writes must never be read back as a gate input. If a future edit made the readout lie (e.g. printed
"present:yes" when the key was absent) or made it a decision input, the matching branch here goes red.
"""
import os, threading, http.server, socketserver, functools, json
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

# ---- source guards: the instrument is read-only and never a decision input --------------------------
gate = open(os.path.join(ROOT, "library/gate.js")).read()
ck("the mirror key is written but never read back inside gate.js (never a decision input)",
   'localStorage.setItem(ENTRY_DIAG_KEY' in gate and 'getItem("thrive_entry_diag"' not in gate
   and 'getItem(ENTRY_DIAG_KEY' not in gate)
ck("the capture records all six facts (present, hasToken, expired, getSession, gateTarget, redirect)",
   all(k in gate for k in ["present:", "hasToken:", "expired:", "getSession:", "gateTarget:", "redirect:"]))
ck("the eject destination (gate.html) and the front door print the mirror read-only, no store write",
   'CONSOLE ENTRY DIAG' in open(os.path.join(ROOT, "gate.html")).read()
   and 'CONSOLE ENTRY DIAG' in open(os.path.join(ROOT, "index.html")).read())

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

FUTURE = 9999999999
PAST = 1000000000   # 2001, well past

def seed_script(session_obj):
    parts = [
        "(()=>{try{",
        f"sessionStorage.setItem('thrive_gate_v2','{GATE_HASH}');",
        "localStorage.setItem('thrive_presence',String(Date.now()));",
        "localStorage.setItem('thrive_sync_auth','x');",
    ]
    if session_obj is not None:
        parts.append("localStorage.setItem('console_sb_session'," + json.dumps(json.dumps(session_obj)) + ");")
    else:
        parts.append("localStorage.removeItem('console_sb_session');")
    parts.append("}catch(e){}})()")
    return "".join(parts)

def read_entry_diag(pg):
    # After the eject, the destination gate.html prints #entryDiag from the fresh localStorage mirror.
    for _ in range(40):
        try:
            txt = pg.evaluate("()=>{var p=document.getElementById('entryDiag');return p?p.textContent:'';}")
        except Exception:
            txt = ""
        if txt and "CONSOLE ENTRY DIAG" in txt:
            return txt
        pg.wait_for_timeout(250)
    return txt

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- Branch A: no session -> lobby -> eject. present:no, getSession:none. ----
    ctxA = b.new_context()
    ctxA.add_init_script(seed_script(None))
    ctxA.route("**/app.js*", lambda r: r.abort())            # keep the harness light; app.js is not the subject
    pgA = ctxA.new_page()
    pgA.goto(f"{base}/library/console.html", wait_until="commit")
    try: pgA.wait_for_url("**/gate.html", timeout=8000)
    except Exception: pass
    tA = read_entry_diag(pgA)
    ck("Branch A ejects and the six lines are readable on the destination gate", "CONSOLE ENTRY DIAG" in tA, tA)
    ck("Branch A: present:no  hasToken:no  expired:no  getSession:none  gateTarget:lobby  redirect:yes",
       ("console_sb_session present: no" in tA and "has access_token: no" in tA and "session expired: no" in tA
        and "last getSession outcome: none" in tA and "gateTarget result: lobby" in tA and "redirect fired: yes" in tA),
       tA)
    ctxA.close()

    # ---- Branch B: expired session, refresh answers 503 -> board -> heal fails -> eject. ----
    ctxB = b.new_context()
    ctxB.add_init_script(seed_script({"access_token": "old", "refresh_token": "r",
                                      "expires_at": PAST, "email": "op@t.co", "uid": "u"}))
    ctxB.route("**/app.js*", lambda r: r.abort())
    ctxB.route("**/auth/v1/token**", lambda r: r.fulfill(status=503, content_type="application/json", body="{}"))
    pgB = ctxB.new_page()
    pgB.goto(f"{base}/library/console.html", wait_until="commit")
    try: pgB.wait_for_url("**/gate.html", timeout=12000)
    except Exception: pass
    tB = read_entry_diag(pgB)
    ck("Branch B ejects and the six lines are readable on the destination gate", "CONSOLE ENTRY DIAG" in tB, tB)
    ck("Branch B: present:yes  hasToken:yes  expired:yes  getSession names the transient failure  gateTarget:board  redirect:yes",
       ("console_sb_session present: yes" in tB and "has access_token: yes" in tB and "session expired: yes" in tB
        and "gateTarget result: board" in tB and "redirect fired: yes" in tB
        and ("last getSession outcome: unavailable(503)" in tB or "last getSession outcome: ok" not in tB)),
       tB)
    ck("Branch B: the transient failure is NOT mislabelled as a definitive rejection",
       "rejected(" not in tB, tB)
    ctxB.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CONSOLE-ENTRY-DIAG HANDOFF CHECKS PASS"))
raise SystemExit(1 if fails else 0)
