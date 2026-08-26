"""BOARD_SESSION_I18N (Layer 1, browser, fails-when-broken).

board.html gains a durable session (cloned from supabase.js: memory-primary __memSession + best-effort
localStorage mirror that never gates success, signIn-returns-the-session, bearer() falls back to anon,
refresh/getSession with the bounded timeout race, signOut), warm boot, EN/AR i18n with a full RTL flip, and
the operator chip + sign-out. This locks the acceptance:

  - sign in -> reload -> still in (warm boot, no re-sign-in)
  - a session that survives only in the mirror is adopted straight to the board (no sign-in card)
  - an expired token is refreshed once on warm boot, then the board loads
  - toggle AR -> board flips RTL (dir=rtl, Arabic labels, no uppercase, no letter-spacing)
  - sign out -> the sign-in card returns and the stored session is cleared
  - the read foundation is unchanged: still no local stage derivation, still console_board only
"""
import os, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

board = open(os.path.join(ROOT, "library/board.html")).read()

# ---- source guards -------------------------------------------------------------------------------
ck("memory-primary session + best-effort mirror (never thrown)",
   "var __memSession" in board and "function setSession" in board
   and "catch(e){ __mirrorOk=false; }" in board)
ck("signIn returns the parsed session (setSession then return sess)",
   "setSession(sess);" in board and "return sess;" in board)
ck("bearer() falls back to anon", "return (s && s.access_token) ? s.access_token : ANON;" in board)
ck("refresh clears the session only on a definitive 400/401",
   "if(r.res.status===400 || r.res.status===401) setSession(null);" in board)
ck("bounded fetch timeout race is present (not AbortController)",
   "function timeoutError" in board and "setTimeout(function(){ to.fired=true;" in board)
ck("warm boot goes straight to the board when a live session survives",
   "if(!signedIn()){ signinView(); return; }" in board and "if(!expired(s)){ loadBoard(); return; }" in board)
ck("i18n t/setLang/applyLang + thrive_lang, chrome-only",
   "function setLang" in board and "function applyLang" in board and 'localStorage.setItem(LANG_KEY' in board)
ck("no local stage derivation retained (read foundation intact)",
   "the server console_board stage is the authority" in board and "console_board?" in board)

# ---- browser harness -----------------------------------------------------------------------------
ROWS = [
  {"slug":"acme","business":"Acme Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":None,"has_page":False,"has_email":True,"archived":False},
  {"slug":"gamm","business":"Gamma Inc","stage":"sent","sent_count":2,"open_count":0,"replied":False,"idle_days":3,"has_page":True,"has_email":True,"archived":False},
  {"slug":"epsi","business":"Epsilon","stage":"replied","sent_count":1,"open_count":2,"replied":True,"idle_days":0,"has_page":True,"has_email":True,"archived":False},
]
TOKEN = {"access_token":"TESTTOKEN","refresh_token":"R1","expires_at":9999999999,"user":{"id":"u1"}}

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def wire(ctx, token_body=None, token_status=200):
    ctx.route("**/auth/v1/token**", lambda r: r.fulfill(status=token_status, headers={"content-type":"application/json"},
              body=json.dumps(token_body if token_body is not None else TOKEN)))
    ctx.route("**/rest/v1/console_board**", lambda r: r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(ROWS)))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== Scenario A: fresh sign-in -> board -> reload (warm boot) -> AR toggle -> sign out =====
    ctxA = b.new_context(); wire(ctxA); pg = ctxA.new_page()
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(200)
    ck("A: fresh visit shows the sign-in card", pg.evaluate("()=>!!document.getElementById('go')"))
    pg.fill("#em","op@thrive.test"); pg.fill("#pw","pw"); pg.click("#go"); pg.wait_for_timeout(500)
    stA = pg.evaluate("""()=>({ board: !!document.querySelector('.lane'),
                                chip: (document.getElementById('opChip')||{}).textContent||'',
                                stored: !!localStorage.getItem('console_sb_session') })""")
    ck("A: sign-in lands on the board with the operator chip", stA["board"] and stA["chip"]=="op@thrive.test", stA)
    ck("A: the session was mirrored to localStorage", stA["stored"], stA)

    pg.reload(wait_until="load"); pg.wait_for_timeout(400)
    stR = pg.evaluate("""()=>({ board: !!document.querySelector('.lane'),
                                card: !!document.getElementById('go'),
                                chip: (document.getElementById('opChip')||{}).textContent||'' })""")
    ck("A: RELOAD stays signed in (warm boot, no re-sign-in card)", stR["board"] and not stR["card"] and stR["chip"]=="op@thrive.test", stR)

    pg.click("#langBtn"); pg.wait_for_timeout(300)
    stAr = pg.evaluate("""()=>{
      var h=document.documentElement;
      var lab=[].map.call(document.querySelectorAll('.lane h2'), function(x){return x.childNodes[0].textContent.trim();});
      var cs = document.querySelector('.lane h2') ? getComputedStyle(document.querySelector('.lane h2')) : {};
      return { dir:h.getAttribute('dir'), lang:h.getAttribute('lang'), lanesDir:getComputedStyle(document.querySelector('.lanes')).direction,
               labels:lab, transform:cs.textTransform, spacing:cs.letterSpacing,
               stored:(localStorage.getItem('thrive_lang')||'') };
    }""")
    ck("A: AR toggle flips the document to RTL", stAr["dir"]=="rtl" and stAr["lang"]=="ar" and stAr["lanesDir"]=="rtl", stAr)
    ck("A: lane labels are Arabic", "مسودة" in stAr["labels"] and "مُرسلة" in stAr["labels"], stAr)
    ck("A: no uppercase and no letter-spacing on Arabic headers",
       stAr["transform"]=="none" and stAr["spacing"] in ("normal","0px"), stAr)
    ck("A: the language choice persisted (thrive_lang=ar)", stAr["stored"]=="ar", stAr)

    pg.click("#signout"); pg.wait_for_timeout(400)
    stO = pg.evaluate("""()=>({ card: !!document.getElementById('go'),
                                cleared: !localStorage.getItem('console_sb_session') })""")
    ck("A: sign out returns the sign-in card", stO["card"], stO)
    ck("A: sign out cleared the stored session", stO["cleared"], stO)
    ctxA.close()

    # ===== Scenario B: a session surviving ONLY in the mirror is adopted straight to the board =====
    ctxB = b.new_context(); wire(ctxB)
    ctxB.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T2',refresh_token:'R2',expires_at:Math.floor(Date.now()/1000)+100000,email:'basel@thrive.test',uid:'u2'}));}catch(e){}")
    pgB = ctxB.new_page(); pgB.goto(f"{base}/library/board.html", wait_until="load"); pgB.wait_for_timeout(400)
    stB = pgB.evaluate("""()=>({ board:!!document.querySelector('.lane'), card:!!document.getElementById('go'),
                                 chip:(document.getElementById('opChip')||{}).textContent||'' })""")
    ck("B: a mirrored session warm-boots straight to the board (no sign-in card)",
       stB["board"] and not stB["card"] and stB["chip"]=="basel@thrive.test", stB)
    ctxB.close()

    # ===== Scenario C: an EXPIRED token is refreshed once on warm boot, then the board loads =====
    ctxC = b.new_context(); wire(ctxC, token_body={"access_token":"FRESH","refresh_token":"R3","expires_at":9999999999,"user":{"id":"u3"}})
    ctxC.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'STALE',refresh_token:'R3',expires_at:Math.floor(Date.now()/1000)-100000,email:'mo@thrive.test',uid:'u3'}));}catch(e){}")
    pgC = ctxC.new_page(); pgC.goto(f"{base}/library/board.html", wait_until="load"); pgC.wait_for_timeout(600)
    stC = pgC.evaluate("""()=>({ board:!!document.querySelector('.lane'), card:!!document.getElementById('go'),
                                 tok:(function(){try{return JSON.parse(localStorage.getItem('console_sb_session')).access_token;}catch(e){return '';}})() })""")
    ck("C: an expired token is refreshed on warm boot and the board loads", stC["board"] and not stC["card"], stC)
    ck("C: the refreshed token replaced the stale one in memory+mirror", stC["tok"]=="FRESH", stC)
    ctxC.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD-SESSION-I18N CHECKS PASS"))
raise SystemExit(1 if fails else 0)
