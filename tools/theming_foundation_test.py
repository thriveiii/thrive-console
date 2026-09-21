"""THEMING FOUNDATION (board.html): a design-token layer with light/dark, additive and behavior-preserving.

Asserts:
  1. The core color tokens are DEFINED and RESOLVE on :root, in BOTH themes.
  2. DARK is behavior-preserving: the token-driven computed colors equal the ORIGINAL literals
     (body #07070b / text #e7e7ea / link #71BFCC / muted #8a8a93), and the default theme is dark.
  3. LIGHT actually switches: toggling data-theme="light" re-resolves the tokens (body #f7f7f8,
     text #1a1a1a) and the per-user choice persists (thrive_theme:<uid>).
  4. The hosted-page preview canvas stays WHITE in both themes (--page-canvas).
  5. Arabic elements carry letter-spacing:normal (no Latin tracking leaks onto Arabic).

FAILS-WHEN-BROKEN: remove the :root token layer (the var() colors stop resolving, dark colors break) or
drop the Arabic letter-spacing:normal rule -> fails.
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

def rgb(*v): return "rgb(" + ", ".join(str(x) for x in v) + ")"

BOARD = [
  {"slug":"alpha","business":"Alpha Co","stage":"draft","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-01-04T00:00:00Z","has_page":True,"has_email":True,"archived":False},
]
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r,o,s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))
def wire(ctx, ar=False):
    js="try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));"
    if ar: js+="localStorage.setItem('thrive_lang','ar');"
    js+="}catch(e){}"
    ctx.add_init_script(js)
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
    for tname in ["console_opps","console_pages","console_mail","console_hits","console_inbound","console_suppressions","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tname}**", lambda r: J(r, []))

CORE_TOKENS = ["--bg","--surface","--text","--text-muted","--border","--brand-teal","--on-brand",
               "--accent","--success","--warning","--error","--focus","--page-canvas",
               "--font-body","--font-ar","--space-1","--radius-m","--ease"]

# ---- source guards -------------------------------------------------------------------------------
src = open(f"{ROOT}/library/board.html").read()
ck("the :root token layer is defined", ":root{" in src and "--bg: #07070b" in src)
ck("a light theme is defined (data-theme=light)", '[data-theme="light"]' in src and "--text: #1a1a1a" in src)
ck("system default is wired (prefers-color-scheme block present)", "prefers-color-scheme: light" in src)
ck("the dusty rose accent token is defined, separate from brand teal", "--accent: #C98B8B" in src and "--brand-teal: #71BFCC" in src)
ck("motion easing token is the specified curve", "cubic-bezier(0.16, 1, 0.3, 1)" in src)
ck("spacing scale is 8-based", "--space-1: 8px" in src and "--space-2: 16px" in src)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ===== default (dark) =====
    ctx = b.new_context(viewport={"width":1024,"height":800}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000)
    ck("no uncaught page error", len(perr)==0, perr)

    theme0 = pg.evaluate("()=>document.documentElement.getAttribute('data-theme')")
    ck("2: the default theme is dark (behavior-preserving)", theme0=="dark", theme0)

    def token_vals(theme_sel=""):
        return pg.evaluate("""()=>{ var cs=getComputedStyle(document.documentElement); var out={};
            ["--bg","--surface","--text","--text-muted","--border","--brand-teal","--on-brand","--accent","--success","--warning","--error","--focus","--page-canvas","--font-body","--font-ar","--space-1","--radius-m","--ease"].forEach(function(k){ out[k]=cs.getPropertyValue(k).trim(); }); return out; }""")
    dtok = token_vals()
    for k in CORE_TOKENS:
        ck("1: token resolves in dark: "+k, bool(dtok.get(k)), dtok)

    darkComputed = pg.evaluate("""()=>{ var b=getComputedStyle(document.body);
        var a=document.querySelector('a,.link'); var m=document.querySelector('.muted');
        return { bg:b.backgroundColor, color:b.color,
                 link:a?getComputedStyle(a).color:'', muted:m?getComputedStyle(m).color:'',
                 font:b.fontFamily }; }""")
    ck("2: dark body background equals the original #07070b", darkComputed["bg"]==rgb(7,7,11), darkComputed)
    ck("2: dark body text equals the original #e7e7ea", darkComputed["color"]==rgb(231,231,234), darkComputed)
    ck("2: the interactive teal equals the original #71BFCC", darkComputed["link"]==rgb(113,191,204), darkComputed)
    ck("2: muted text equals the original #8a8a93", darkComputed["muted"]==rgb(138,138,147), darkComputed)
    ck("2: body font-family begins with Lato (brand font first, system fallback)", darkComputed["font"].lower().startswith("lato"), darkComputed)
    ck("4: the page-canvas token is white in dark", dtok["--page-canvas"].lower() in ("#ffffff","rgb(255, 255, 255)","#fff"), dtok["--page-canvas"])

    # ===== toggle to light via the real header button =====
    pg.click("#themeBtn")
    pg.wait_for_timeout(300)
    theme1 = pg.evaluate("()=>document.documentElement.getAttribute('data-theme')")
    ck("3: the header toggle switches to light", theme1=="light", theme1)
    ltok = token_vals()
    lightComputed = pg.evaluate("()=>{var b=getComputedStyle(document.body);return {bg:b.backgroundColor,color:b.color};}")
    ck("3: light re-resolves --bg (not the dark value)", ltok["--bg"]!=dtok["--bg"] and ltok["--bg"].lower()=="#f7f7f8", ltok["--bg"])
    ck("3: light body text is #1a1a1a", lightComputed["color"]==rgb(26,26,26), lightComputed)
    ck("3: light body background switched", lightComputed["bg"]==rgb(247,247,248), lightComputed)
    ck("4: the page-canvas token stays white in light", ltok["--page-canvas"].lower() in ("#ffffff","rgb(255, 255, 255)","#fff"), ltok["--page-canvas"])
    persisted = pg.evaluate("()=>{try{return localStorage.getItem('thrive_theme:u');}catch(e){return '';}}")
    ck("3: the choice persists per logged-in user (thrive_theme:<uid>)", persisted=="light", persisted)
    for k in ["--bg","--text","--surface","--border","--brand-teal"]:
        ck("1: token resolves in light: "+k, bool(ltok.get(k)), ltok)
    pg.close(); ctx.close()

    # ===== Arabic: letter-spacing must be normal =====
    ctx2 = b.new_context(viewport={"width":1024,"height":800}); wire(ctx2, ar=True)
    pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/board.html", wait_until="load"); pg2.wait_for_timeout(700)
    pg2.wait_for_selector(".lane", timeout=8000)
    dir_ar = pg2.evaluate("()=>document.documentElement.getAttribute('dir')")
    ck("5: the document is RTL under Arabic", dir_ar=="rtl", dir_ar)
    ls = pg2.evaluate("""()=>{ var out={};
        out.body=getComputedStyle(document.body).letterSpacing;
        var brand=document.querySelector('.brand'); out.brand=brand?getComputedStyle(brand).letterSpacing:'normal';
        var h2=document.querySelector('.lane h2'); out.laneh=h2?getComputedStyle(h2).letterSpacing:'normal';
        var tt=h2?getComputedStyle(h2).textTransform:'none'; out.tt=tt;
        return out; }""")
    ck("5: Arabic body carries letter-spacing:normal", ls["body"]=="normal", ls)
    ck("5: Arabic .brand carries letter-spacing:normal (Latin tracking does not leak)", ls["brand"]=="normal", ls)
    ck("5: Arabic lane heading carries letter-spacing:normal", ls["laneh"]=="normal", ls)
    ck("5: Arabic lane heading is not uppercased", ls["tt"]=="none", ls)
    pg2.close(); ctx2.close()
    b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL THEMING-FOUNDATION CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
