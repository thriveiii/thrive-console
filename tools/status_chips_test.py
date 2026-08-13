"""Recipient status chips wear Thrive's palette, one state logic (WO-036).

The group-campaign recipient chips rendered as glaring light/white pills on the dark console (the old
.rc-chip used #eee and light-green/rose backgrounds). They now join the brand: ONE status-chip component
(.chip-st), each state coloured by the SAME lane the board already speaks, so a colour means the same thing
everywhere - Sent the Sent lane's violet, Opened the Opened rose, Replied the Replied green, a bounce a
muted warning rose, pending a quiet neutral. Dark low-alpha fills with toned text, never a white pill,
AA-readable on the near-black surface. This suite reads the real computed colours, checks each state maps
to its lane token, that no chip is a light/white pill, that the text is AA-readable over the composited
background, and that the recipient list actually renders the one component. WebKit is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- Source guards: one component, the state->colour map is the lane tokens ----
css = open(f"{ROOT}/library/styles.css").read()
app = open(f"{ROOT}/library/app.js").read()
ck("the recipient list renders the ONE status-chip component (.chip-st is-<state>), no light-theme rc-chip",
   'class="chip-st is-' in app and "class=\"rc-chip rc-" not in app)
ck("the state-to-colour map is the lane tokens the board already speaks",
   ".chip-st.is-sent{" in css and "var(--lane-sent-t)" in css and "var(--lane-sent)" in css
   and ".chip-st.is-opened{" in css and "var(--lane-opened-t)" in css
   and ".chip-st.is-replied{" in css and "var(--lane-replied-t)" in css
   and ".chip-st.is-bounced{" in css and "var(--ops-rose-fill)" in css)
ck("the old light-theme recipient pills are gone",
   "#e8f2ea" not in css and "#f6e6e6" not in css and "var(--bg-3, #eee)" not in css)

# The lane tokens, as rgb, that each state must resolve to.
TOKEN = { "is-sent":(150,133,202), "is-opened":(238,140,157), "is-replied":(126,224,184), "is-bounced":(201,139,139) }
PAGE = (7,7,11)   # #07070b, the console surface the chip sits on

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.recipientsPanelHtml==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

    MEASURE = r"""
    (dir) => {
      const host=document.createElement('div'); host.dir=dir;
      host.style.cssText='position:absolute;top:0;left:0;background:#07070b;padding:20px';
      const states=['is-sent','is-opened','is-replied','is-bounced',''];
      host.innerHTML=states.map(s=>'<span class="chip-st '+s+'">chip</span>').join(' ');
      document.body.appendChild(host);
      const parse=c=>{ const m=c.match(/rg2?ba?\(([^)]+)\)/)||c.match(/rgba?\(([^)]+)\)/); if(!m) return null;
        const p=m[1].split(',').map(x=>parseFloat(x)); return {r:p[0],g:p[1],b:p[2],a:p[3]==null?1:p[3]}; };
      const L=(r,g,b)=>{ const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);};
        return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      const over=(fg,a,bg)=>({ r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a) });
      const page={r:7,g:7,b:11};
      const out=[...host.querySelectorAll('.chip-st')].map((el,i)=>{
        const cs=getComputedStyle(el);
        const bg=parse(cs.backgroundColor), col=parse(cs.color);
        const eff=over(bg,bg.a,page);                     // chip bg composited on the page
        const lum=(x)=>L(x.r,x.g,x.b);
        const cr=(()=>{ const l1=lum(col)+0.05, l2=lum(eff)+0.05; return (Math.max(l1,l2)/Math.min(l1,l2)); })();
        return { state:states[i]||'pending', bgAlpha:bg.a, bg:[Math.round(bg.r),Math.round(bg.g),Math.round(bg.b)],
                 col:[Math.round(col.r),Math.round(col.g),Math.round(col.b)], effLum:lum(eff), contrast:cr,
                 ls:cs.letterSpacing }; });
      host.remove(); return out;
    }
    """
    rows = pg.evaluate(MEASURE, "ltr")
    by = { r["state"]: r for r in rows }

    for state,(tr,tg,tb) in TOKEN.items():
        r = by[state]
        ck(f"{state}: the text is the lane hue rgb({tr},{tg},{tb})", tuple(r["col"])==(tr,tg,tb), r)
        ck(f"{state}: the fill is a muted low-alpha tone of the same hue (not a solid, not white)",
           r["bgAlpha"] <= 0.2 and tuple(r["bg"])==(tr,tg,tb) and r["effLum"] < 0.25, r)
        ck(f"{state}: the text is AA-readable on the composited surface (contrast >= 4.5)", r["contrast"] >= 4.5, r)

    pend = by["pending"]
    ck("pending / not sent is a quiet neutral surface (low-alpha, dark, readable)",
       pend["bgAlpha"] <= 0.2 and pend["effLum"] < 0.25 and pend["contrast"] >= 4.0, pend)
    ck("no chip is a light or white pill (every composited background is dark)",
       all(r["effLum"] < 0.25 for r in rows), [r["effLum"] for r in rows])

    # Arabic: the chips render mirrored, with no letter-spacing, and the recipient markup uses the component.
    rtl = pg.evaluate(MEASURE, "rtl")
    ck("Arabic (RTL): the chips carry no letter-spacing",
       all(r["ls"] in ("normal","0px") for r in rtl), [r["ls"] for r in rtl])
    real = pg.evaluate("""()=>{
      const html='<span class="chip-st is-sent">x</span>';   // sanity that the class resolves
      const d=document.createElement('div'); d.innerHTML=html; document.body.appendChild(d);
      const has=getComputedStyle(d.firstChild).backgroundColor.indexOf('150')>=0; d.remove(); return has; }""")
    ck("the is-sent chip resolves to the Sent lane violet in the live stylesheet", real, real)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
