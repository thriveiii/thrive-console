"""VISUAL IDENTITY PASS (board.html): the brand token system applied to every surface, presentation only.

Asserts (each fails-when-broken):
  (a) the restyled component CSS carries NO raw colour literal - every colour is a token var() (the palette
      lives only in :root / the theme blocks). The new on-palette role tokens exist (--info, --chip-*, --hover).
  (b) the primary action per surface uses the ACCENT (dusty rose) token, the accent is distinct from the brand
      teal, and there is exactly ONE accent-filled button on the compose surface (Send), never two competing.
  (c) Arabic surfaces keep letter-spacing:normal and no uppercase (every Latin-only tracking/caps rule has an
      Arabic-safe variant), so itfGhroob stays joined.
  (d) SMOKE: the board, the opp-window tabs, the campaign upload path, the Library overlay and the Contacts
      overlay all still render, and the single send path is intact (unifiedSend -> runSend), with no page error.

FAILS-WHEN-BROKEN: a raw literal in a component rule, a non-accent (or a second accent) primary button, a
Latin tracking value leaking onto Arabic, or a surface that no longer renders / a broken send wiring -> fails.
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

# ---- (a) component CSS is literal-free; new role tokens present ------------------------------------
anchor = "html,body{margin:0;background:var(--bg)"
i = src.find(anchor)
comp = src[i:src.find("</style>", i)] if i >= 0 else ""
ck("(a) the restyled component CSS block was located", len(comp) > 2000, len(comp))
lits = re.findall(r"#[0-9a-fA-F]{3,8}\b", comp)
ck("(a) the component CSS carries NO raw colour literal (every colour is a token var())", lits == [], lits[:12])
ck("(a) the component CSS actually uses tokens", comp.count("var(--") > 150, comp.count("var(--"))
for tk in ["--info:", "--info-bg:", "--chip-bg:", "--chip-fg:", "--hover-border:", "--accent:"]:
    ck("(a) on-palette role token defined: " + tk, tk in src)
ck("(a) no em dash anywhere in board.html", "—" not in src)
# the icon set is one inline-SVG source, currentColor (themes), no glyph font / external fetch
ck("(a) icons are inline-SVG on currentColor (the one icon set), replacing the ad-hoc close glyph",
   'class="icn"' in src and "&times;" not in src and 'stroke="currentColor"' in src)

# ---- (d-static) the single send path is intact ----------------------------------------------------
m = re.search(r"function unifiedSend\(slug\)\{.*?\n\}", src, re.S)
ck("(d) unifiedSend still wires the one send path (calls runSend)", bool(m) and "runSend(" in (m.group(0) if m else ""))
ck("(d) the campaign upload accordion component is present in the CSS", ".ow-acc" in src and ".ow-acc-inc" in src)

# ---- browser checks -------------------------------------------------------------------------------
BOARD = [
 {"slug":"alpha","business":"Alpha Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False},
]
OPP_SLUGS=set(); OPPDATA={}
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
                if s and isinstance(row.get("data"),dict): OPPDATA[s]=row["data"]
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
    for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts","console_templates"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r,[]))
def probe(pg, var):
    return pg.evaluate("""(v)=>{ var d=document.createElement('span'); d.style.color='var('+v+')';
        document.body.appendChild(d); var c=getComputedStyle(d).color; d.remove(); return c; }""", var)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    # ===== EN: (b) accent + (d) smoke =====
    ctx = b.new_context(viewport={"width":1200,"height":900}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000)
    ck("(d) the board renders (lanes present)", pg.evaluate("()=>document.querySelectorAll('.lane').length")>=3)

    # the primary-action fill is the accessible deep-rose --btn-primary-bg (the accent role), distinct from teal
    accent = probe(pg, "--btn-primary-bg"); teal = probe(pg, "--brand-teal")
    ck("(b) the primary-action token is distinct from the brand teal", accent != teal, {"accent":accent,"teal":teal})

    # compose surface: exactly one accent-filled button (Send), and it IS #nmSend
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=5000)
    pg.evaluate("()=>window.owSelectMode('a')"); pg.wait_for_selector("#owModeA #edSubj", timeout=5000)
    pg.fill("#owModeA #edSubj", "A note"); pg.fill("#owModeA #edBody", "Hello there.")
    pg.wait_for_timeout(200)
    acc = pg.evaluate("""(accent)=>{ var win=document.getElementById('owScrim')||document;
        var btns=[].slice.call(win.querySelectorAll('button'));
        var fill=btns.filter(function(x){ var s=getComputedStyle(x); return s.backgroundColor===accent && x.offsetParent!==null; });
        var send=document.getElementById('nmSend');
        return { n:fill.length, sendIsAccent: !!send && getComputedStyle(send).backgroundColor===accent,
                 ids:fill.map(function(x){return x.id||x.className;}) }; }""", accent)
    ck("(b) the primary Send button uses the accent token", acc["sendIsAccent"], acc)
    ck("(b) exactly ONE accent-filled button on the compose surface (no two competing accents)", acc["n"]==1, acc)

    # (d) smoke: opp-window tabs, upload path, Library, Contacts
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(150)
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickUpload", timeout=5000)
    pg.click("#owPickUpload"); pg.wait_for_timeout(300)
    ck("(d) the campaign upload path renders (file input present)",
       pg.evaluate("()=>!!document.getElementById('owUploadFile')||!!document.getElementById('owBodyUpload')"))
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(150)

    pg.evaluate("()=>window.openOppWindow('alpha','b')"); pg.wait_for_timeout(500)
    ntabs = pg.evaluate("()=>document.querySelectorAll('.ow-tab').length")
    ck("(d) the opp window renders its tab strip", ntabs>=2, ntabs)
    pg.evaluate("()=>window.closeOppWindow()"); pg.wait_for_timeout(150)

    pg.click("#libBtn"); pg.wait_for_timeout(400)
    ck("(d) the Library overlay renders",
       pg.evaluate("()=>{var s=document.getElementById('libViewScrim');return !!s && !s.hidden && !!document.querySelector('.lv-title');}"))
    pg.evaluate("()=>{if(window.closeLibraryView)window.closeLibraryView();var s=document.getElementById('libViewScrim');if(s)s.hidden=true;}")
    pg.wait_for_timeout(150)

    pg.evaluate("()=>window.openContactsView()"); pg.wait_for_timeout(400)
    ck("(d) the Contacts overlay renders",
       pg.evaluate("()=>{var s=document.getElementById('ctScrim');return !!s && !s.hidden;}"))
    ck("(d) no uncaught page error across the smoke flow (EN)", len(perr)==0, perr)
    pg.close(); ctx.close()

    # ===== AR: (c) letter-spacing normal + no uppercase =====
    ctx2 = b.new_context(viewport={"width":390,"height":840}); wire(ctx2, ar=True)
    pg2 = ctx2.new_page(); perr2=[]; pg2.on("pageerror", lambda e: perr2.append(str(e)))
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(700)
    pg2.wait_for_selector(".lane", timeout=8000)
    ls = pg2.evaluate("""()=>{ function g(sel){ var e=document.querySelector(sel); if(!e) return null;
        var s=getComputedStyle(e); return {ls:s.letterSpacing, tt:s.textTransform}; }
        return { body:g('body'), brand:g('.brand'), lane:g('.lane h2') }; }""")
    ck("(c) Arabic document is RTL", pg2.evaluate("()=>document.documentElement.getAttribute('dir')")=="rtl")
    ck("(c) Arabic body carries letter-spacing:normal", ls["body"] and ls["body"]["ls"]=="normal", ls)
    ck("(c) Arabic .brand carries letter-spacing:normal (no Latin tracking leak)", ls["brand"] and ls["brand"]["ls"]=="normal", ls)
    ck("(c) Arabic lane heading is letter-spacing:normal and NOT uppercased",
       ls["lane"] and ls["lane"]["ls"]=="normal" and ls["lane"]["tt"]=="none", ls)
    # open the compose gate in AR and confirm the greeting/tab chrome stays normal-tracked
    pg2.evaluate("()=>window.owNewMessage()"); pg2.wait_for_selector("#owPickText", timeout=5000)
    pg2.evaluate("()=>window.owSelectMode('a')"); pg2.wait_for_selector("#owModeA #edSubj", timeout=5000)
    tls = pg2.evaluate("""()=>{ var out=[]; ['.g-apply','.ow-tab','.ow-mode-btn','.cr-h','.dw-sec h3'].forEach(function(sel){
        var e=document.querySelector(sel); if(e){ var s=getComputedStyle(e); out.push({sel:sel, ls:s.letterSpacing, tt:s.textTransform}); } });
        return out; }""")
    bad = [x for x in tls if x["ls"] not in ("normal","0px") or x["tt"]=="uppercase"]
    ck("(c) every Arabic chrome element in the window is normal-tracked and not uppercased", bad==[], bad)
    ck("(c) no uncaught page error (AR)", len(perr2)==0, perr2)
    pg2.close(); ctx2.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL VISUAL-IDENTITY CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
