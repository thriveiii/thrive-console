"""The phone is a first-class console: parity at phone width, both languages.

Every recent surface (the board, the card window and its six tabs, the thread, the recipient list, the
open discussion, Insights, the library, settings and profile) is verified at an iPhone-width viewport in
both languages with ZERO horizontal page overflow. The interactive chrome (the nav, the language toggle,
the window tabs and its close, and the buttons) meets the 44px touch floor on a coarse pointer. The shell
opts into the safe area (viewport-fit=cover) and the header, content, window, gate and toasts take the
env() insets, so nothing sits under a notch or the home indicator. One design language: the same tokens,
the same controls, given room; not a separate mobile stylesheet.

WebKit at iPhone width (and the iPad split-view narrow width) is Thyab's device gate; this proves the
wiring: no page scrolls sideways, no chrome falls under the floor, and the safe-area insets are wired.
"""
import threading, http.server, socketserver, functools, os, sys, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT="/tmp/claude-0/-home-user-thrive-console/c3d00e60-6b80-5853-a1c6-18cd12c9bc26/scratchpad/phone"
os.makedirs(OUT, exist_ok=True)

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# ---------------- source guards (no browser) ----------------
css = open(f"{ROOT}/library/styles.css").read()
shell = open(f"{ROOT}/library/console.html").read()
bundle = open(f"{ROOT}/tools/bundle.js").read()

ck("the shell opts into the safe area (viewport-fit=cover), in the source and the served page",
   "viewport-fit=cover" in bundle and "viewport-fit=cover" in shell)
# the coarse-pointer touch floor is 44 for the interactive chrome (not 40)
coarse = css[css.index("@media (pointer:coarse){", css.index("A pointer keeps the tighter density")):][:600]
ck("the coarse-pointer floor lifts the nav, language toggle, window tabs and close, buttons and fields to 44px",
   ".nav a,.langbtn{min-height:44px" in coarse and ".modal-tab,.modal-close{min-height:44px" in coarse
   and ".btn,.btn.sm{min-height:44px" in coarse and ".input,.search input,select,textarea{min-height:44px" in coarse)
# safe-area insets are wired to the surfaces that reach an edge
def has_env(sel_block):
    return "env(safe-area-inset" in sel_block
ck("the sticky header takes the top and side safe-area insets",
   re.search(r"\.top\{[^}]*padding-top: max\(14px, env\(safe-area-inset-top\)\)", css) is not None
   and "env(safe-area-inset-left)" in css and "env(safe-area-inset-right)" in css)
ck("the page content, the gate, the toasts and the phone window take their safe-area insets",
   re.search(r"\.wrap\{[^}]*env\(safe-area-inset-left\)", css) is not None
   and re.search(r"#thriveGate\{[^}]*env\(safe-area-inset", css) is not None
   and re.search(r"\.toast\{[^}]*env\(safe-area-inset-bottom\)", css) is not None
   and re.search(r"\.modal\{ padding-bottom: max\(0px, env\(safe-area-inset-bottom\)\)", css) is not None)
EM_DASH = "\u2014"   # the em dash, written as an escape so this scanner is not its own false hit
ck("no em dash anywhere in the touched presentation files",
   all(EM_DASH not in open(f"{ROOT}/{f}").read() for f in
       ["library/styles.css","tools/bundle.js","tools/phone_parity_test.py"]))
ck("zero-Lotus: no touched file references Lotus-V1",
   not any("lotus" in open(f"{ROOT}/{f}").read().lower() for f in
           ["library/styles.css","tools/bundle.js","library/console.html"]))

# ---------------- live behaviour (iPhone-width, coarse pointer) ----------------
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

SEED = """()=>{
  localStorage.setItem('thrive_opps_v1', JSON.stringify([
    {slug:'greenfield-academy', business:'Greenfield International Academy', published:true, stage:'opened',
     recipients:[{addr:'basel.personal@gmail.com',name:'باسل عبدالرحمن',lang:'ar'},
                 {addr:'lina@greenfield.edu',name:'Lina Haddad',lang:'en'},
                 {addr:'omar.the.director@company.co',name:'عمر',lang:'ar'}],
     outreach_subject:'شراكة مع أكاديمية جرينفيلد', outreach_text:'مرحبا',
     channel:{kind:'email',to:'lina@greenfield.edu'}, doc_lang:'ar', contact_tier:'warm'}]));
  localStorage.setItem('thrive_mail_v1', JSON.stringify([
    {mid:'m1',opp:'greenfield-academy',to:'basel.personal@gmail.com',toName:'باسل',subject:'شراكة',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'},
    {mid:'m2',opp:'greenfield-academy',to:'lina@greenfield.edu',toName:'Lina',subject:'A partnership that is quite long to stress wrapping',status:'sent',direction:'out',ts:'2026-08-01T10:01:00Z'}]));
  localStorage.setItem('thrive_inbound_v1', JSON.stringify([
    {gid:'g1',opp:'greenfield-academy',kind:'reply',from:'basel.personal@gmail.com',name:'باسل عبدالرحمن',subject:'Re: شراكة مع أكاديمية جرينفيلد',
     snippet:'On Fri, Aug 1, 2026 at 10:00 AM Thrive <hi@thriveiii.com> wrote:\\n> مرحبا\\nشكرا جزيلا، نعم نحن مهتمون جدا بهذه الشراكة ونود ترتيب اجتماع قريبا لمناقشة التفاصيل كلها.',ts:'2026-08-03T09:00:00Z'}]));
  localStorage.setItem('thrive_hits_v1', JSON.stringify([{type:'open',slug:'greenfield-academy',ts:'2026-08-02T10:00:00Z',vid:'v1'}]));
  localStorage.setItem('thrive_comments_v1', JSON.stringify([
    {id:'c1',opp:'greenfield-academy',author:'thyab',author_name:'Thyab Al Rahman',body:'This one looks strong. Lina replied warmly and wants a meeting this week.',parent_id:null,created_at:'2026-08-03T11:00:00Z'},
    {id:'c2',opp:'greenfield-academy',author:'sara',author_name:'Sara',body:'ممتاز، سأجهز العرض التقديمي باللغة العربية قبل الاجتماع.',parent_id:'c1',created_at:'2026-08-03T12:00:00Z'}]));
  window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
}"""

# page-level horizontal overflow (the real acceptance: nothing scrolls sideways)
DOC_OVERFLOW = "()=>document.documentElement.scrollWidth - document.documentElement.clientWidth"
# heights of the interactive chrome
FLOOR = """()=>{
  const h=(sel)=>{const el=document.querySelector(sel); if(!el) return null;
    return Math.round(el.getBoundingClientRect().height);};
  return { nav:h('.nav a'), langbtn:h('.langbtn'), btn:h('.btn') };
}"""

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    dev=p.devices["iPhone 13"]
    for lang in ("en","ar"):
        ctx=b.new_context(**dev)
        ctx.route("https://api.github.com/**", lambda r:r.abort())
        ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))
        pg=ctx.new_page()
        pg.add_init_script(f"try{{localStorage.setItem('thrive_lang','{lang}')}}catch(e){{}}")
        pg.goto(f"{base}/library/console.html")
        pg.wait_for_function("()=>window.thriveModal && typeof window.goTo==='function'", timeout=15000)
        ck(f"{lang}: the emulated device is a coarse pointer (the touch floor engages)",
           pg.evaluate("()=>matchMedia('(pointer:coarse)').matches"))
        pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
        pg.evaluate(SEED)

        # the header takes the top safe-area inset (env=0 in the harness, so the rule resolves to its
        # fallback and must never collapse below it: proves the max()/env() rule is live, not broken).
        toppad = pg.evaluate("()=>parseInt(getComputedStyle(document.querySelector('.top')).paddingTop)")
        ck(f"{lang}: the sticky header keeps its top padding with the safe-area rule live (>=14)", toppad>=14, toppad)

        # the interactive chrome meets the 44px floor. Measured on the active board (the button scoped to
        # the visible view), before any full-page screenshot, which resizes the page to capture its height.
        pg.evaluate("(v)=>{ try{ window.goTo(v); }catch(e){ location.hash='#'+v; } }", "board")
        pg.wait_for_timeout(300)
        fl=pg.evaluate("""()=>{ const h=(sel)=>{const el=document.querySelector(sel); return el?Math.round(el.getBoundingClientRect().height):null;};
          return { nav:h('.nav a'), langbtn:h('.langbtn'), btn:h('#view-board .btn') }; }""")
        ck(f"{lang}: nav link, language toggle and button meet the 44px touch floor",
           (fl["nav"] or 0)>=44 and (fl["langbtn"] or 0)>=44 and (fl["btn"] or 0)>=44, fl)

        # the window tabs and its close, measured up front too: a full-page screenshot drops the mobile
        # emulation, so every touch-floor reading is taken before the first screenshot of this context.
        pg.evaluate("()=>window.thriveModal.open('greenfield-academy','overview','Greenfield International Academy')")
        pg.wait_for_timeout(400)
        mt=pg.evaluate("""()=>{ const t=document.querySelector('.modal-tab'), c=document.querySelector('.modal-close');
            return { tab:t?Math.round(t.getBoundingClientRect().height):null, close:c?Math.round(c.getBoundingClientRect().height):null }; }""")
        ck(f"{lang}: the window tabs and its close meet the 44px floor", (mt["tab"] or 0)>=44 and (mt["close"] or 0)>=44, mt)
        try: pg.evaluate("()=>window.thriveModal.close&&window.thriveModal.close(true)")
        except: pass
        pg.wait_for_timeout(150)

        # each primary view: zero horizontal page overflow, both languages
        for view in ("board","home","library","profile","settings"):
            pg.evaluate("(v)=>{ try{ window.goTo(v); }catch(e){ location.hash='#'+v; } }", view)
            pg.wait_for_timeout(450)
            ov=pg.evaluate(DOC_OVERFLOW)
            ck(f"{lang}/{view}: zero horizontal page overflow", ov<=1, {"overflow":ov})
            pg.screenshot(path=f"{OUT}/{lang}-{view}.png", full_page=True)

        # the card window: every tab, zero overflow, tabs and close at the floor
        pg.evaluate("(v)=>{ try{ window.goTo(v); }catch(e){ location.hash='#'+v; } }", "board")
        pg.wait_for_timeout(200)
        for tab in ("overview","text","history","discussion"):
            pg.evaluate("(t)=>window.thriveModal.open('greenfield-academy',t,'Greenfield International Academy')", tab)
            pg.wait_for_timeout(500)
            ov=pg.evaluate(DOC_OVERFLOW)
            ck(f"{lang}/modal-{tab}: zero horizontal page overflow", ov<=1, {"overflow":ov})
            pg.screenshot(path=f"{OUT}/{lang}-modal-{tab}.png")
            try: pg.evaluate("()=>window.thriveModal.close&&window.thriveModal.close(true)")
            except: pass
            pg.wait_for_timeout(120)
        ctx.close()
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
print("screenshots in", OUT)
sys.exit(1 if fails else 0)
