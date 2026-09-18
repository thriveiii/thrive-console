"""G7.1 EASY BILINGUAL EDITOR + PER-USER SIGNATURES (browser, fails-when-broken, ZERO real send).

Two concerns, one test, driving the REAL editor in the window's Mode A (the shared editorHtml nodes):
  1. Auto-direction: the subject/body flow RTL when their content is Arabic and LTR when English, with NO manual
     toggle (dir="auto"), proven via the :dir() pseudo-class on the live fields.
  2. Per-user signatures:
     - "Use my signature" inserts the user's OWN three-line default (name / agency / site), localized to the
       message language (the body's script), with the correct "Thrive Digital Solutions" spelling (EN) and the
       Arabic agency name (AR).
     - "+" saves the current signature text as a new named signature, persisted to console_profiles.prefs
       (own row); it is pickable (fills #edSig) and removable; the writes hit the per-user prefs store.
     - It is per-user: a SECOND operator (different uid) sees NONE of the first operator's saved signatures and
       gets THEIR OWN name in the default.

Fails-when-broken: drop dir="auto" -> the direction assertions fail; revert the default to name/title/site or the
"Solutoins" mock -> the agency-spelling assertions fail; stop persisting signatures -> the save/pick/remove
assertions fail.

Pure Python + Playwright. Run: python3 tools/editor_signatures_test.py
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SCRATCH = os.environ.get("SCRATCH", "/tmp/claude-0")
os.makedirs(SCRATCH, exist_ok=True)

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

AR_BODY = "مرحبا، نودّ أن نعرض عليكم صفحة هبوط جديدة لنشاطكم."
EN_BODY = "Hello, we would like to show you a new landing page for your business."
AR_AGENCY = "ثرايف للحلول الرقمية"

# ---- per-user profile store (own-row model), keyed by uid; captures prefs writes -----------------
PROFILES = {}   # uid -> {"uid","display_name","email","prefs"}
PREFS_POSTS = []  # every prefs write body captured, for assertions
def seed_user(uid, name, email):
    PROFILES[uid] = {"uid":uid, "display_name":name, "email":email, "prefs":{}}
seed_user("uid-thyab", "Thyab", "thyab@thrive.test")
seed_user("uid-sara", "Sara", "sara@thrive.test")

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Handler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def J(route, obj, status=200):
    route.fulfill(status=status, headers={"content-type":"application/json"}, body=json.dumps(obj))
def route_empty(r): J(r, [])
def uid_of(url):
    m = re.search(r'uid=eq\.([^&]+)', url); return m.group(1) if m else ""
def route_profile_names(r):
    J(r, [{"uid":u["uid"], "display_name":u["display_name"], "email":u["email"]} for u in PROFILES.values()])
def route_profiles(r):
    req = r.request
    if req.method == "POST":
        try: body = json.loads(req.post_data or "{}")
        except Exception: body = {}
        rows = body if isinstance(body, list) else [body]
        for row in rows:
            uid = row.get("uid");
            if not uid: continue
            cur = PROFILES.get(uid) or {"uid":uid, "display_name":"", "email":"", "prefs":{}}
            if "display_name" in row: cur["display_name"] = row["display_name"]
            if "prefs" in row and isinstance(row["prefs"], dict):
                cur["prefs"] = row["prefs"]; PREFS_POSTS.append({"uid":uid, "prefs":row["prefs"]})
            PROFILES[uid] = cur
        # return=representation: echo the merged row(s)
        return J(r, [PROFILES[row.get("uid")] for row in rows if row.get("uid") in PROFILES])
    uid = uid_of(req.url); u = PROFILES.get(uid)
    return J(r, [u] if u else [])
def route_members(r): J(r, [])       # no owner row -> member role
def wire(ctx, uid):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'"+uid+"'}));}catch(e){}")
    # Playwright uses the LAST-registered matching route, so register the catch-all FIRST and the specific
    # routes AFTER it, so console_profiles / console_profile_names win over the generic empty responder.
    ctx.route("**/rest/v1/**", route_empty)
    ctx.route("**/rest/v1/console_board**", route_empty)
    ctx.route("**/rest/v1/console_profile_names**", route_profile_names)
    ctx.route("**/rest/v1/console_profiles**", route_profiles)
    ctx.route("**/rest/v1/console_members**", route_members)
    ctx.route("**/rest/v1/console_admins**", route_empty)
    ctx.route("**/rest/v1/console_team_roster**", route_empty)
    ctx.route("**/rest/v1/console_suppressions**", route_empty)

def wait_ident(pg, name, tries=50):
    for _ in range(tries):
        got = pg.evaluate("()=>{var i=window.__thriveIdentity; return i&&i.loaded? (i.name||''):null;}")
        if got == name: return True
        pg.wait_for_timeout(150)
    return False

def open_mode_a(pg):
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_timeout(150)
    pg.evaluate("()=>window.owSelectMode('a')")
    pg.wait_for_selector("#owModeA #edSig", timeout=6000); pg.wait_for_timeout(200)

def set_body(pg, text):
    pg.fill("#owModeA #edBody", text)
    pg.eval_on_selector("#owModeA #edBody", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.wait_for_timeout(200)

def use_my_sig(pg):
    pg.click("#owModeA #edSigFill"); pg.wait_for_timeout(200)
    return pg.evaluate("()=>document.querySelector('#owModeA #edSig').value")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===================== user A: Thyab =====================
    ctxA = b.new_context(); wire(ctxA, "uid-thyab"); pg = ctxA.new_page(); perr=[]
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(500)
    ck("identity loaded with the user's own name", wait_ident(pg, "Thyab"))
    open_mode_a(pg)

    # ----- 1: auto-direction (dir="auto"), proven by the :dir() pseudo-class -----
    set_body(pg, AR_BODY)
    ck("1: an Arabic body flows RTL (no manual toggle)", pg.eval_on_selector("#owModeA #edBody", "e=>e.matches(':dir(rtl)')"))
    pg.fill("#owModeA #edSubj", "عرض رمضان")
    pg.eval_on_selector("#owModeA #edSubj", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(150)
    ck("1: an Arabic subject flows RTL", pg.eval_on_selector("#owModeA #edSubj", "e=>e.matches(':dir(rtl)')"))
    set_body(pg, EN_BODY)
    ck("1: an English body flows LTR", pg.eval_on_selector("#owModeA #edBody", "e=>e.matches(':dir(ltr)')"))
    pg.fill("#owModeA #edSubj", "Ramadan offer")
    pg.eval_on_selector("#owModeA #edSubj", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(150)
    ck("1: an English subject flows LTR", pg.eval_on_selector("#owModeA #edSubj", "e=>e.matches(':dir(ltr)')"))
    # the exact-send preview reflects the live body (unchanged invariant)
    pg.wait_for_timeout(300)
    ck("1: the exact-send preview reflects the live body",
       pg.evaluate("()=>{var f=document.querySelector('#owModeA #edPreview'); return !!f && (f.getAttribute('srcdoc')||'').indexOf('new landing page')>=0;}"))

    # ----- 2: the DEFAULT signature, localized, correct spelling, user's own name -----
    set_body(pg, EN_BODY)
    sig_en = use_my_sig(pg)
    ck("2: EN default is name / agency / site with the CORRECT spelling",
       sig_en.split("\n")==["Thyab","Thrive Digital Solutions","thriveiii.com"], repr(sig_en))
    ck("2: the misspelling 'Solutoins' is NOT present", "Solutoins" not in sig_en)
    set_body(pg, AR_BODY)
    sig_ar = use_my_sig(pg)
    ck("2: AR default uses the Arabic agency name (message-language aware)",
       AR_AGENCY in sig_ar and "thriveiii.com" in sig_ar and sig_ar.split("\n")[0]=="Thyab", repr(sig_ar))

    # ----- 3: "+" saves a signature to the per-user store; pickable + removable -----
    CUSTOM = "Thyab\nHead of Growth\nThrive Digital Solutions\nthriveiii.com"
    pg.fill("#owModeA #edSig", CUSTOM)
    pg.eval_on_selector("#owModeA #edSig", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(150)
    before_posts = len(PREFS_POSTS)
    pg.click("#owModeA #edSigAdd"); pg.wait_for_timeout(600)
    ck("3: '+' wrote the signature to the per-user prefs store (console_profiles.prefs.signatures)",
       len(PREFS_POSTS) > before_posts and len((PREFS_POSTS[-1]["prefs"].get("signatures") or []))==1
       and PREFS_POSTS[-1]["prefs"]["signatures"][0]["text"]==CUSTOM, PREFS_POSTS[-1] if PREFS_POSTS else None)
    ck("3: a pick chip appeared for the saved signature",
       pg.eval_on_selector_all("#owModeA .ed-sig-chip", "els=>els.length")==1, pg.eval_on_selector_all("#owModeA .ed-sig-chip","els=>els.length"))
    ck("3: runtime identity now carries one saved signature (per-user, no reload)",
       pg.evaluate("()=>(window.__thriveIdentity.signatures||[]).length")==1)
    # clear, then PICK -> fills #edSig with the saved text
    pg.fill("#owModeA #edSig", ""); pg.wait_for_timeout(100)
    pg.click("#owModeA .ed-sig-chip .ed-sig-pick"); pg.wait_for_timeout(250)
    ck("3: picking the chip fills #edSig with the saved signature",
       pg.evaluate("()=>document.querySelector('#owModeA #edSig').value")==CUSTOM,
       pg.evaluate("()=>document.querySelector('#owModeA #edSig').value"))
    # REMOVE -> persisted empty, chip gone
    before_rm = len(PREFS_POSTS)
    pg.click("#owModeA .ed-sig-chip .ed-sig-rm"); pg.wait_for_timeout(600)
    ck("3: removing the chip persisted an empty set and removed the chip",
       len(PREFS_POSTS) > before_rm and (PREFS_POSTS[-1]["prefs"].get("signatures") or [])==[]
       and pg.eval_on_selector_all("#owModeA .ed-sig-chip", "els=>els.length")==0,
       {"posts":len(PREFS_POSTS), "chips":pg.eval_on_selector_all("#owModeA .ed-sig-chip","els=>els.length")})

    # add one back so we can prove per-user isolation against user B
    pg.fill("#owModeA #edSig", "Thyab only\nThrive Digital Solutions\nthriveiii.com")
    pg.eval_on_selector("#owModeA #edSig", "e=>e.dispatchEvent(new Event('input',{bubbles:true}))"); pg.wait_for_timeout(150)
    pg.click("#owModeA #edSigAdd"); pg.wait_for_timeout(600)
    ck("3: user A now has a saved signature stored server-side",
       len(PROFILES["uid-thyab"]["prefs"].get("signatures") or [])==1)
    ck("no page errors for user A", len(perr)==0, perr)

    # screenshots (desktop + a phone) on user A with the strip populated + Arabic body
    set_body(pg, AR_BODY); use_my_sig(pg); pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(SCRATCH, "g71_editor_desktop.png"))
    ctxA.close()

    # ===================== user B: Sara (per-user isolation) =====================
    ctxB = b.new_context(); wire(ctxB, "uid-sara"); pg2 = ctxB.new_page(); perr2=[]
    pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(500)
    ck("B: identity loaded as the SECOND user", wait_ident(pg2, "Sara"))
    open_mode_a(pg2)
    ck("B: the second user sees NONE of the first user's saved signatures",
       pg2.eval_on_selector_all("#owModeA .ed-sig-chip", "els=>els.length")==0,
       pg2.eval_on_selector_all("#owModeA .ed-sig-chip","els=>els.length"))
    set_body(pg2, EN_BODY)
    sigB = use_my_sig(pg2)
    ck("B: the default signature uses the SECOND user's own name",
       sigB.split("\n")==["Sara","Thrive Digital Solutions","thriveiii.com"], repr(sigB))
    ck("no page errors for user B", len(perr2)==0, perr2)

    # four-face screenshots for the device proof
    for name, vw, vh in [("phone",390,844), ("ipad",1024,768)]:
        set_body(pg2, EN_BODY if name=="ipad" else AR_BODY)
        pg2.set_viewport_size({"width":vw, "height":vh}); pg2.wait_for_timeout(200)
        pg2.screenshot(path=os.path.join(SCRATCH, f"g71_editor_{name}.png"))
    ctxB.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL G7.1 EDITOR+SIGNATURE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
