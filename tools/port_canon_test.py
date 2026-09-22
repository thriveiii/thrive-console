"""PORT THE CANON onto board.html: the committed design canon (IDENTITY / MOTION / styles.css) replaces the
re-derived #327..#333 token system. Presentation only.

Asserts (each fails-when-broken):
  (a) board.html defines the canon lane scale (--lane-draft..replied) and the brand gradient --grad, and the
      primary action renders that gradient (background-image is the linear-gradient, applied to #nmSend).
  (b) itfGhroob is fully removed (0 references); --font-ar binds Alyamama (Lato first for Latin, Alyamama for
      Arabic glyphs); every English label uses Lato; an Alyamama @font-face loads the pinned font-05..08.
  (c) no dusty-rose literal (#C98B8B / #9c5757 / #a85f5f) remains anywhere in board.html.
  (d) the primary-action label vs its gradient fill computes >= 4.5:1 against EVERY gradient stop, in dark AND
      light (measured on the real #nmSend, sampling the actual rendered gradient).
  (e) the forbidden side strips are gone (.card.card-offer teal / .card.card-msg dashed edges).
  (f) Arabic carries letter-spacing:normal + no uppercase, and the display weight steps down in RTL (--w-head
      resolves to 600 under dir=rtl vs 800 under ltr).
  (g) smoke: board / window tabs / upload path / Library / Contacts render, and unifiedSend still wires runSend.

FAILS-WHEN-BROKEN: drop a lane token or the gradient, keep itfGhroob or the rose, a gradient stop that fails
the label contrast, a surviving side strip, an un-stepped Arabic weight, or a broken surface / send wiring.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()

# ---- (a) canon tokens defined ---------------------------------------------------------------------
for tk in ["--lane-draft:", "--lane-live:", "--lane-sent:", "--lane-opened:", "--lane-replied:", "--grad:"]:
    ck("(a) canon token defined: " + tk, tk in src)
ck("(a) the gradient is the canon 120deg brand gradient", "linear-gradient(120deg,#72BECE,#5D7FB7,#9685CA,#EE8C9D,#A78CA7,#71BFCC)" in src)
ck("(a) the primary-button fill binds the gradient (--btn-primary-bg: var(--grad))",
   re.search(r"--btn-primary-bg:\s*var\(--grad\)", src) is not None)

# ---- (b) fonts: itfGhroob gone, Alyamama bound, Lato for Latin -------------------------------------
ck("(b) itfGhroob is fully removed (0 references)", "itfGhroob" not in src, src.count("itfGhroob"))
ck("(b) an Alyamama @font-face loads the pinned font-06 (400) URL",
   re.search(r"@font-face\{font-family:Alyamama;[^}]*font-05-e36207c4\.woff2", src) is not None
   and "font-06-58a22f0f.woff2" in src and "font-07-ee5dbf54.woff2" in src)
ck("(b) --font-ar binds Alyamama (Arabic glyphs) with Lato first (Latin words)",
   re.search(r"--font-ar:\s*Lato,\s*\"Alyamama\"", src) is not None)
ck("(b) --font (Latin/UI) names Lato first", re.search(r"--font:\s*Lato,\s*\"Alyamama\"", src) is not None)
ck("(b) no system family sits between Lato and Alyamama (would capture Arabic glyphs)",
   "Segoe UI\", Roboto" not in src.split("--font-ar")[1][:120] if "--font-ar" in src else False)

# ---- (c) no dusty rose ----------------------------------------------------------------------------
for lit in ["#C98B8B", "#9c5757", "#a85f5f", "#8a4d4d"]:
    ck("(c) no dusty-rose literal remains: " + lit, lit not in src, src.count(lit))
ck("(c) no --accent dusty-rose token remains", "--accent:" not in src and "--accent-ink:" not in src)

# ---- (e) side strips retired ----------------------------------------------------------------------
ck("(e) the .card.card-offer teal side strip is gone", ".card.card-offer{" not in src)
ck("(e) the .card.card-msg dashed side strip is gone", ".card.card-msg{" not in src)

# ---- browser: (a apply), (d contrast), (f arabic), (g smoke) --------------------------------------
BOARD = [
 {"slug":"alpha","business":"Alpha Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False},
 {"slug":"beta","business":"Beta Co","stage":"replied","sent_count":2,"open_count":1,"replied":True,"idle_days":0,"last_activity_ts":"2026-02-02T00:00:00Z","has_page":False,"has_email":True,"archived":False},
]
OPPDATA={}; OPP_SLUGS=set()
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o): r.fulfill(status=200, headers={"content-type":"application/json"}, body=json.dumps(o))
def route_opps(r):
    m=re.search(r'slug=eq\.([^&]+)', r.request.url); sl=m.group(1) if m else ""
    if r.request.method in ("POST","PATCH"):
        try:
            for row in (json.loads(r.request.post_data or "[]") or []):
                s=row.get("slug") or sl
                if s: OPP_SLUGS.add(s)
        except Exception: pass
        if sl: OPP_SLUGS.add(sl)
        return r.fulfill(status=204, body="")
    return J(r, [{"slug":sl,"data":OPPDATA.get(sl,{}),"archived_at":None,"archived_from":None}])
def wire(ctx, ar=False):
    js="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));"
    if ar: js+="localStorage.setItem('thrive_lang','ar');"
    js+="}catch(e){}"
    ctx.add_init_script(js)
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r,{"ok":True}))
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", lambda r: (J(r,[]) if r.request.method=="GET" else r.fulfill(status=204,body="")))
    ctx.route("**/rest/v1/console_pages**", lambda r: J(r,[{"slug":"alpha","live_verified_at":"2026-01-01T00:00:00Z"}]))
    ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r,[]))
    for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r,[]))

# min contrast of a label colour against EVERY stop of a CSS linear-gradient background-image
GRAD_CONTRAST = r"""
(sel) => {
  var el = document.querySelector(sel); if(!el) return null;
  var cs = getComputedStyle(el);
  var img = cs.backgroundImage || "";
  var rgbs = img.match(/rgba?\([^)]+\)/g) || [];
  function parse(c){ var m=c.match(/[\d.]+/g).map(Number); return {r:m[0],g:m[1],b:m[2]}; }
  function lin(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
  function L(c){ return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b); }
  function cr(a,b){ var l1=L(a)+0.05,l2=L(b)+0.05; return Math.max(l1,l2)/Math.min(l1,l2); }
  var fg = parse(cs.color);
  var stops = rgbs.map(parse);
  if(!stops.length) return { grad:false, img:img.slice(0,40) };
  var worst = Math.min.apply(null, stops.map(function(s){ return cr(fg,s); }));
  return { grad:true, worst:Math.round(worst*100)/100, nstops:stops.length };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1200,"height":900}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000)
    ck("(g) the board renders (>=2 lanes)", pg.evaluate("()=>document.querySelectorAll('.lane').length")>=2)
    ck("(a) the lanes carry the semantic lane-colour scale (data-lane hooks present)",
       pg.evaluate("()=>document.querySelectorAll('.lane[data-lane]').length")>=5)

    # open compose, measure the real Send button's gradient contrast in both themes
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=5000)
    pg.evaluate("()=>window.owSelectMode('a')"); pg.wait_for_selector("#owModeA #edSubj", timeout=5000)
    pg.fill("#owModeA #edSubj", "A note"); pg.fill("#owModeA #edBody", "Hi.")
    pg.wait_for_timeout(150)
    send_grad = pg.evaluate(GRAD_CONTRAST, "#nmSend")
    ck("(a) the primary Send button renders the gradient (background-image is a multi-stop linear-gradient)",
       bool(send_grad) and send_grad.get("grad") and send_grad.get("nstops",0)>=5, send_grad)
    for theme in ("dark","light"):
        pg.evaluate("(t)=>document.documentElement.setAttribute('data-theme',t)", theme)
        pg.wait_for_timeout(120)
        r = pg.evaluate(GRAD_CONTRAST, "#nmSend")
        ck("(d) the Send label vs its gradient fill >= 4.5:1 at every stop in %s (worst %s)" % (theme, r and r.get("worst")),
           bool(r) and r.get("grad") and r.get("worst",0) >= 4.5, r)
    pg.evaluate("()=>document.documentElement.setAttribute('data-theme','dark')")

    # (g) smoke: window tabs, upload path, Library, Contacts, send wiring
    ck("(g) unifiedSend wires the one send path (source calls runSend)",
       bool(re.search(r"function unifiedSend\(slug\)\{.*?runSend\(", src, re.S)))
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(120)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickUpload", timeout=5000)
    pg.click("#owPickUpload"); pg.wait_for_timeout(300)
    ck("(g) the upload path renders", pg.evaluate("()=>!!document.getElementById('owUploadFile')||!!document.getElementById('owBodyUpload')"))
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(120)
    pg.evaluate("()=>window.openOppWindow('alpha','b')"); pg.wait_for_timeout(400)
    ck("(g) the opp window renders its tab strip", pg.evaluate("()=>document.querySelectorAll('.ow-tab').length")>=2)
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(120)
    pg.click("#libBtn"); pg.wait_for_timeout(300)
    ck("(g) the Library overlay renders", pg.evaluate("()=>{var s=document.getElementById('libViewScrim');return !!s && !s.hidden && !!document.querySelector('.lv-title');}"))
    pg.evaluate("()=>{var s=document.getElementById('libViewScrim');if(s)s.hidden=true;}")
    pg.evaluate("()=>window.openContactsView()"); pg.wait_for_timeout(300)
    ck("(g) the Contacts overlay renders", pg.evaluate("()=>{var s=document.getElementById('ctScrim');return !!s && !s.hidden;}"))
    ck("(g) no uncaught page error (EN)", len(perr)==0, perr)
    pg.close(); ctx.close()

    # (f) Arabic: letter-spacing normal, no uppercase, stepped-down weight
    ctx2 = b.new_context(viewport={"width":420,"height":900}); wire(ctx2, ar=True)
    pg2 = ctx2.new_page(); perr2=[]; pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(700)
    pg2.wait_for_selector(".lane", timeout=8000)
    arv = pg2.evaluate("""()=>{ function g(s){var e=document.querySelector(s);if(!e)return null;var c=getComputedStyle(e);return {ls:c.letterSpacing,tt:c.textTransform,fw:c.fontWeight};}
        return { dir:document.documentElement.getAttribute('dir'), brand:g('.brand'), lane:g('.lane h2'), whead:getComputedStyle(document.documentElement).getPropertyValue('--w-head').trim() }; }""")
    ck("(f) Arabic document is RTL", arv["dir"]=="rtl", arv)
    ck("(f) Arabic .brand carries letter-spacing:normal", arv["brand"] and arv["brand"]["ls"]=="normal", arv)
    ck("(f) Arabic lane heading is letter-spacing:normal and not uppercased",
       arv["lane"] and arv["lane"]["ls"]=="normal" and arv["lane"]["tt"]=="none", arv)
    ck("(f) the display weight steps down in RTL (--w-head resolves to 600, not 800)", arv["whead"]=="600", arv["whead"])
    ck("(f) no uncaught page error (AR)", len(perr2)==0, perr2)
    pg2.close(); ctx2.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL PORT-CANON CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
