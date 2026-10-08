"""PR-C: member chips are VISIBLY coloured (board.html, fails-when-broken).

Live fault: card-face member chips read neutral grey - PR-2 coloured only a faint 8px dot and a 2px border.
PR-C gives every chip a soft TINT of the member hue as its background, a member-hue border, and a monogram circle
FILLED with the member colour (IDENTITY 4.6: Thyab gold, Basel terracotta, Agha fuchsia, light-theme variants).

Asserts on COMPUTED colours, in DARK and LIGHT (each fails-when-broken):
  (a) each chip's background is a tint of THAT member's hue (not the neutral surface), and its border is the hue.
  (b) the monogram circle is filled with the member colour (exact token value per theme).
  (c) AA: name text on the tinted chip >= 4.5:1; monogram glyph on its fill >= 4.5:1; the filled circle against
      the card surface >= 3:1 (non-text). Computed from the real rendered colours.
  (d) never the gradient (no background-image on the chip or monogram); the lane colour tokens are unchanged.
  (e) the detail Members control uses the same colouring (removable chips tinted; an ON roster option tinted).
  (f) three members on one card at 390px do not overflow the card; Arabic keeps the name LTR with normal spacing.
  (g) canon hygiene.
"""
import os, re, json, threading, http.server, socketserver, functools
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

src = open(f"{ROOT}/library/board.html", encoding="utf-8").read()
ck("(g) no em dash", "—" not in src)
ck("(g) itfGhroob 0 refs", "itfGhroob" not in src)
for lit in ["#C98B8B", "#9c5757", "#a85f5f"]:
    ck("(g) no dusty rose " + lit, lit not in src)

def rgb(s):
    m = re.match(r"rgba?\(([^)]+)\)", s or "")
    if not m: return None
    p = [float(x) for x in m.group(1).replace("/", ",").split(",") if x.strip()]
    return (p[0], p[1], p[2], p[3] if len(p) > 3 else 1.0)
def over(fg, bg):
    a = fg[3]; return (fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a), 1.0)
def lum(c):
    def ch(v):
        v = v/255.0; return v/12.92 if v <= 0.03928 else ((v+0.055)/1.055) ** 2.4
    return 0.2126*ch(c[0]) + 0.7152*ch(c[1]) + 0.0722*ch(c[2])
def contrast(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb); return (hi + 0.05) / (lo + 0.05)
def hx(h): h = h.lstrip("#"); return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16), 1.0)

HUE = {"dark":{"thyab":"#E6B450","basel":"#C96F4A","agha":"#CE7BD1"},
       "light":{"thyab":"#8A5D0A","basel":"#A8482A","agha":"#9C3FA0"}}
LANES = {"dark":{"--lane-draft":"#71BFCC","--lane-sent":"#9685CA","--lane-replied":"#7EE0B8"},
         "light":{"--lane-draft":"#2e7480","--lane-sent":"#725bb8","--lane-replied":"#1d7752"}}

U = {"thyab":"u_thyab", "basel":"u_basel", "agha":"u_agha"}
PROFILES = [{"uid":U["thyab"],"display_name":"Thyab","email":"abdu.thyab@gmail.com"},
            {"uid":U["basel"],"display_name":"Basel","email":"alnajjarjawad97@gmail.com"},
            {"uid":U["agha"],"display_name":"Agha","email":"muhelagha@gmail.com"}]
def card(slug): return {"slug":slug,"business":slug,"stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-09-29T00:00:00Z","has_page":False,"has_email":True,"archived":False,"cycle":None}
MEMBERS = {"c-thyab":[U["thyab"]], "c-basel":[U["basel"]], "c-agha":[U["agha"]], "c-multi":[U["thyab"],U["basel"],U["agha"]]}
BOARD = [card(s) for s in MEMBERS]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class TSrv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
httpd = TSrv(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
def J(r, o, s=200): r.fulfill(status=s, headers={"content-type":"application/json"}, body=json.dumps(o))

def wire(ctx, theme, lang):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session',JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'abdu.thyab@gmail.com',uid:'u_thyab'}));localStorage.setItem('thrive_theme','"+theme+"');localStorage.setItem('thrive_theme:u_thyab','"+theme+"');localStorage.setItem('thrive_lang','"+lang+"');}catch(e){}")
    def route_members(r):
        m = re.search(r"opp=eq\.([^&]+)", r.request.url)
        if m: return J(r, [{"member":x} for x in MEMBERS.get(m.group(1), [])])
        return J(r, [{"opp":o,"member":x} for o, arr in MEMBERS.items() for x in arr])
    def route_opps(r):
        u = r.request.url
        if "select=slug,owner" in u or "select=slug%2Cowner" in u: return J(r, [])
        if "recipients" in u: return J(r, [{"slug":k,"to":"lead@"+k+".example"} for k in MEMBERS])
        m = re.search(r"slug=eq\.([^&]+)", u)
        if m: return J(r, [{"slug":m.group(1),"data":{"outreach_subject":"Hi","outreach_text":"Body","recipients":[{"addr":"x@y.example"}]},"archived_at":None}])
        return J(r, [])
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r, {"ok":True}))
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_card_members**", route_members)
    ctx.route("**/rest/v1/console_profile_names**", lambda r: J(r, PROFILES))
    for tn in ["console_pages","console_mail","console_suppressions","console_hits","console_inbound","console_profiles","console_members","console_team_roster","console_admins","console_contacts","console_watchers","console_signatures"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r, []))

CHIP_JS = """(sel)=>{ var c=document.querySelector(sel); if(!c) return null; var card=c.closest('.card');
  var mono=c.querySelector('.mem-mono'), nm=c.querySelector('.mem-nm');
  var cs=getComputedStyle(c), ms=mono?getComputedStyle(mono):null, ns=nm?getComputedStyle(nm):null;
  return { bg:cs.backgroundColor, bimg:cs.backgroundImage, border:cs.borderTopColor,
           monoBg:ms?ms.backgroundColor:null, monoImg:ms?ms.backgroundImage:null, monoFg:ms?ms.color:null,
           name:ns?ns.color:null, ls:ns?ns.letterSpacing:null, dir:nm?nm.getAttribute('dir'):null,
           cardBg:card?getComputedStyle(card).backgroundColor:getComputedStyle(document.body).backgroundColor }; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for theme in ("dark", "light"):
        ctx = b.new_context(viewport={"width":1440,"height":900}); wire(ctx, theme, "en")
        pg = ctx.new_page(); perr = []; pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(1200)
        ck(f"[{theme}] the theme is applied", pg.evaluate("()=>document.documentElement.getAttribute('data-theme')") == theme)
        for who in ("thyab", "basel", "agha"):
            d = pg.evaluate(CHIP_JS, f'.card[data-slug="c-{who}"] .members .member')
            hue = hx(HUE[theme][who])
            if d is None: ck(f"[{theme}] {who} chip renders", False); continue
            bg, cardbg, mono, fg, nm, bd = rgb(d["bg"]), rgb(d["cardBg"]), rgb(d["monoBg"]), rgb(d["monoFg"]), rgb(d["name"]), rgb(d["border"])
            chip = over(bg, cardbg)
            # (a) a tint of THIS member's hue: translucent, and the hue's own channels (rgb equal to the token hue)
            ck(f"[{theme}] (a) {who}: the chip background is a tint of the {who} hue (not the neutral surface)",
               bg is not None and 0.05 <= bg[3] < 1 and all(abs(bg[i]-hue[i]) <= 1 for i in range(3)), d["bg"])
            ck(f"[{theme}] (a) {who}: the chip border is the {who} hue", bd and all(abs(bd[i]-hue[i]) <= 1 for i in range(3)), d["border"])
            # (b) monogram filled with the exact member colour
            ck(f"[{theme}] (b) {who}: the monogram circle is filled with {HUE[theme][who]}",
               mono and all(abs(mono[i]-hue[i]) <= 1 for i in range(3)) and mono[3] == 1.0, d["monoBg"])
            # (c) AA
            c_name = contrast(nm, chip); c_glyph = contrast(fg, mono); c_fill = contrast(mono, cardbg)
            ck(f"[{theme}] (c) {who}: name on the tinted chip is AA ({c_name:.2f}:1 >= 4.5)", c_name >= 4.5)
            ck(f"[{theme}] (c) {who}: monogram glyph on its fill is AA ({c_glyph:.2f}:1 >= 4.5)", c_glyph >= 4.5)
            ck(f"[{theme}] (c) {who}: the filled circle stands off the card surface ({c_fill:.2f}:1 >= 3)", c_fill >= 3.0)
            # (d) never the gradient
            ck(f"[{theme}] (d) {who}: no gradient on the chip or monogram", d["bimg"] == "none" and d["monoImg"] == "none", d)
        lanes = pg.evaluate("(ks)=>{ var cs=getComputedStyle(document.documentElement); var o={}; ks.forEach(function(k){ o[k]=cs.getPropertyValue(k).trim(); }); return o; }", list(LANES[theme].keys()))
        ck(f"[{theme}] (d) the lane colour tokens are unchanged", all(lanes[k].lower() == v.lower() for k, v in LANES[theme].items()), lanes)
        # (e) the detail Members control
        pg.click('.card[data-slug="c-basel"]'); pg.wait_for_selector("#owTabs", timeout=6000)
        pg.click('#owTabs [data-cr-gate="activity"]'); pg.wait_for_selector("#owDetail .mem-sec", timeout=6000); pg.wait_for_timeout(500)
        dd = pg.evaluate(CHIP_JS, '#owDetail .mem-chips .member.mem-basel')
        opt = pg.evaluate("""()=>{ var o=document.querySelector('#owDetail .mem-opt.on'); if(!o) return null; var m=o.querySelector('.mem-mono');
            return { bg:getComputedStyle(o).backgroundColor, mono:m?getComputedStyle(m).backgroundColor:null, cls:o.className }; }""")
        hue = hx(HUE[theme]["basel"])
        ddbg = rgb(dd["bg"]) if dd else None
        ck(f"[{theme}] (e) the detail's removable Basel chip is tinted in the Basel hue",
           ddbg is not None and 0.05 <= ddbg[3] < 1 and all(abs(ddbg[i]-hue[i]) <= 1 for i in range(3)), dd)
        ob = rgb(opt["bg"]) if opt else None; om = rgb(opt["mono"]) if opt else None
        ck(f"[{theme}] (e) the ON roster option is tinted and its monogram filled in the member colour",
           opt is not None and "mem-basel" in opt["cls"] and ob and all(abs(ob[i]-hue[i]) <= 1 for i in range(3)) and om and all(abs(om[i]-hue[i]) <= 1 for i in range(3)), opt)
        ck(f"[{theme}] no uncaught error", perr == [], perr)
        pg.close(); ctx.close()

    # ---- (f) phone width + Arabic: no overflow, name LTR, letter-spacing normal ----------------------
    for w, lang in ((390, "en"), (390, "ar"), (1024, "en"), (1440, "en"), (1440, "ar")):
        ctx = b.new_context(viewport={"width":w,"height":900}); wire(ctx, "dark", lang)
        pg = ctx.new_page(); perr = []; pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_selector(".lane", timeout=8000); pg.wait_for_timeout(1200)
        g = pg.evaluate("""()=>{ var card=document.querySelector('.card[data-slug="c-multi"]'); if(!card) return null;
            var foot=card.querySelector('.card-foot'); var nm=card.querySelector('.members .member .mem-nm');
            var names=[].map.call(card.querySelectorAll('.members .member .mem-nm'), function(e){ return { t:e.textContent, cut:(e.scrollWidth - e.clientWidth) > 1 || e.clientWidth < 8 }; });
            return { names:names, n:card.querySelectorAll('.members .member').length, over:card.scrollWidth-card.clientWidth, fover:foot.scrollWidth-foot.clientWidth,
                     dir:document.documentElement.getAttribute('dir'), nmdir:nm?nm.getAttribute('dir'):'', ls:nm?getComputedStyle(nm).letterSpacing:'' }; }""")
        ck(f"[{w} {lang}] (f) three coloured member chips render", g is not None and g["n"] == 3, g)
        ck(f"[{w} {lang}] (f) every member name reads WHOLE (never truncated to an initial or a stray glyph)",
           g is not None and [x["t"] for x in g["names"]] == ["Thyab", "Basel", "Agha"] and not any(x["cut"] for x in g["names"]), g and g["names"])
        ck(f"[{w} {lang}] (f) no horizontal overflow of the card", g is not None and g["over"] <= 1 and g["fover"] <= 1, g)
        if lang == "ar":
            ck(f"[{w} ar] (f) Arabic mirrors; the member name stays LTR with normal spacing",
               g["dir"] == "rtl" and g["nmdir"] == "ltr" and g["ls"] in ("normal", "0px"), g)
        ck(f"[{w} {lang}] no uncaught error", perr == [], perr)
        pg.close(); ctx.close()
    b.close()

print()
if fails:
    print("FAILED: " + str(len(fails)) + " check(s)")
    for f in fails: print("  - " + f)
    raise SystemExit(1)
print("ALL MEMBER-CHIP-COLOUR CHECKS PASS")
