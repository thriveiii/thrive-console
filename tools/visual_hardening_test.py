"""VISUAL HARDENING (board.html): the primary-action button must carry a legible label at WCAG AA in BOTH
themes, and the deep-rose primary fill must not regress to the pale brand accent.

Asserts (each fails-when-broken):
  (a) every primary-button treatment (.act.send, .btnp, button.primary) computes label-vs-fill contrast
      >= 4.5:1 in DARK and in LIGHT, measured on a real rendered button, not just from tokens.
  (a) the real Send button (#nmSend) on the compose surface clears 4.5:1 in both themes.
  (a) the primary fill token is the accessible deep rose, distinct from the pale --accent brand rose (so the
      washed-out low-contrast button cannot come back).

FAILS-WHEN-BROKEN: point a primary button fill back at the pale --accent (or any fill that fails 4.5:1 with
its label) and a check drops below 4.5 -> fails.
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
BOARD = [{"slug":"alpha","business":"Alpha Co","stage":"live","sent_count":0,"open_count":0,"replied":False,"idle_days":0,"last_activity_ts":"2026-02-01T00:00:00Z","has_page":True,"has_email":True,"archived":False}]
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
        except Exception: pass
        if sl: OPP_SLUGS.add(sl)
        return r.fulfill(status=204, body="")
    return J(r, [{"slug":sl,"data":OPPDATA.get(sl,{}),"archived_at":None,"archived_from":None}])
def wire(ctx):
    ctx.add_init_script("try{localStorage.setItem('console_sb_session', JSON.stringify({access_token:'T',refresh_token:'R',expires_at:Math.floor(Date.now()/1000)+100000,email:'op@thrive.test',uid:'u'}));}catch(e){}")
    ctx.route(re.compile(r"script\.google\.com/.*"), lambda r: J(r,{"ok":True}))
    ctx.route("**/rest/v1/console_board**", lambda r: J(r, BOARD))
    ctx.route("**/rest/v1/console_opps**", route_opps)
    ctx.route("**/rest/v1/console_mail**", lambda r: (J(r,[]) if r.request.method=="GET" else r.fulfill(status=204,body="")))
    ctx.route("**/rest/v1/console_pages**", lambda r: J(r,[{"slug":"alpha","live_verified_at":"2026-01-01T00:00:00Z"}]))
    ctx.route("**/rest/v1/console_suppressions**", lambda r: J(r,[]))
    for tn in ["console_hits","console_inbound","console_profiles","console_profile_names","console_members","console_team_roster","console_admins","console_contacts"]:
        ctx.route(f"**/rest/v1/{tn}**", lambda r: J(r,[]))

# WCAG contrast of the label against its fill. The canon primary is the brand GRADIENT, so this samples
# EVERY stop of the background-image gradient (a gradient has no single backgroundColor) and returns the
# WORST stop; for a solid button it falls back to backgroundColor. Catches any low-contrast stop.
CONTRAST = r"""
(sel_or_el) => {
  function one(c){ var m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null;
    var p=m[1].split(',').map(function(x){return parseFloat(x);});
    return {r:p[0], g:p[1], b:p[2], a:(p[3]==null?1:p[3])}; }
  function lin(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
  function L(c){ return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b); }
  function over(fg,a,bg){ return {r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a)}; }
  function cr(fg,bg){ var l1=L(fg)+0.05,l2=L(bg)+0.05; return Math.max(l1,l2)/Math.min(l1,l2); }
  var el = (typeof sel_or_el==='string') ? document.querySelector(sel_or_el) : sel_or_el;
  if(!el) return null;
  var cs = getComputedStyle(el);
  var page = one(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
  var fg = one(cs.color); if(!fg) return null;
  var img = cs.backgroundImage || "";
  var stops = (img.match(/rgba?\([^)]+\)/g) || []).map(one).filter(Boolean);
  var isGrad = img.indexOf('gradient')>=0 && stops.length>=2;
  var ratio;
  if(isGrad){ ratio = Math.min.apply(null, stops.map(function(s){ return cr(fg, over(s, s.a, page)); })); }
  else { var bg=one(cs.backgroundColor); if(!bg) return null; ratio = cr(fg, over(bg,bg.a,page)); }
  return { ratio: Math.round(ratio*100)/100, grad:isGrad, nstops:stops.length, label:(el.textContent||'').trim().slice(0,24) };
}
"""
PROBE_MAKE = r"""
() => {
  var host=document.createElement('div'); host.id='__probes';
  host.innerHTML =
    '<button class="act send">Send message</button>'+
    '<button class="btnp">Add templates</button>'+
    '<button class="primary">Sign in</button>';
  document.body.appendChild(host);
  return ['#__probes .act.send','#__probes .btnp','#__probes .primary'];
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1100,"height":900}); wire(ctx)
    pg = ctx.new_page(); perr=[]; pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{base}/library/board.html", wait_until="load"); pg.wait_for_timeout(700)
    pg.wait_for_selector(".lane", timeout=8000)

    # the primary fill is the brand gradient (canon Law 4.2), never the pale rose that failed AA
    def cssvar(v): return pg.evaluate("(v)=>getComputedStyle(document.documentElement).getPropertyValue(v).trim()", v)
    ck("(a) the primary-button fill is the brand gradient (no washed-out rose regression)",
       "gradient" in cssvar("--btn-primary-bg").lower() and "C98B8B" not in src and "9c5757" not in src,
       {"btn":cssvar("--btn-primary-bg")})

    sels = pg.evaluate(PROBE_MAKE)
    for theme in ("dark", "light"):
        pg.evaluate("(t)=>document.documentElement.setAttribute('data-theme',t)", theme)
        pg.wait_for_timeout(120)
        for sel in sels:
            r = pg.evaluate(CONTRAST, sel)
            ck("(a) primary button %s label vs fill >= 4.5:1 in %s (got %s)" % (sel.split()[-1], theme, r and r["ratio"]),
               bool(r) and r["ratio"] >= 4.5, r)

    # the REAL Send button on the compose surface, both themes
    pg.evaluate("()=>window.owNewMessage()"); pg.wait_for_selector("#owPickText", timeout=5000)
    pg.evaluate("()=>window.owSelectMode('a')"); pg.wait_for_selector("#owModeA #edSubj", timeout=5000)
    pg.fill("#owModeA #edSubj", "A note"); pg.fill("#owModeA #edBody", "Hello there.")
    pg.wait_for_timeout(200)
    for theme in ("dark", "light"):
        pg.evaluate("(t)=>document.documentElement.setAttribute('data-theme',t)", theme)
        pg.wait_for_timeout(120)
        r = pg.evaluate(CONTRAST, "#nmSend")
        ck("(a) the real Send button (#nmSend) label vs fill >= 4.5:1 in %s (got %s)" % (theme, r and r["ratio"]),
           bool(r) and r["ratio"] >= 4.5, r)
    ck("no uncaught page error", len(perr)==0, perr)
    pg.close(); ctx.close(); b.close()
httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL VISUAL-HARDENING (CONTRAST) CHECKS PASS"))
import sys; sys.exit(1 if fails else 0)
