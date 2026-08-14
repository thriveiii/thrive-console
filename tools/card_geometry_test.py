"""Cards breathe: comfortable internal geometry, no collision, no clipping (WO-024).

On the device the board cards were cramped: long titles (Alexandra Schmeling Fine Art, مدارس المدار الدولية)
floated the chevron and grip to the vertical middle of a wrapped card, and the title crowded the corner.
This redesigns the token's INTERNAL geometry only, same information, controls and size family: one internal
flex, a title zone that wraps to two lines then ellipsis, a reserved corner zone (menu + grip) the title
never enters, and the meta line below, on ONE padding token (equal insets) and ONE gap token. The chevron
now centres on the title's FIRST line, never the wrapped block.

Engine-independent facts (the elegance at three widths on WebKit is Thyab's device gate): the padding is a
single equal inset and the gap is one token; the chevron centre equals the first-line centre even when the
title wraps to two lines; the title clamps at two lines and never overlaps the corner controls; the card
height grows by exactly one line and no more; Arabic mirrors (title zone right, corner left) with the title
right-aligned; and the controls are unchanged (the menu still opens, the grip and open button still exist)."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# source guard: one padding token and one gap token on the card (no second value introduced)
css = open(os.path.join(ROOT, "library/styles.css"), encoding="utf-8").read()
tokblock = css[css.find("WO-024: the card breathes"): css.find("WO-024: the card breathes")+900]
ck("the card declares one padding token and one gap token (a single --tok-pad and --tok-gap)",
   "--tok-pad:var(--s-3)" in tokblock and "--tok-gap:var(--s-2)" in tokblock
   and "padding:var(--tok-pad)" in tokblock and "gap:var(--tok-gap)" in tokblock)

SEED = """
(() => { const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  set('thrive_opps_v1',[
    {slug:'asfa',business:'Alexandra Schmeling Fine Art Studio and Gallery',published:true,stage:'sent',recipients:[{addr:'a@x.ex'}]},
    {slug:'madar',business:'مدارس المدار الدولية للتعليم الحديث والمتطور',published:true,stage:'sent',recipients:[{addr:'b@x.ex'}]},
    {slug:'short',business:'Acme',published:true,stage:'sent',recipients:[{addr:'c@x.ex'}]} ]);
  set('thrive_mail_v1',[{mid:'m1',opp:'asfa',to:'a@x.ex',subject:'H',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'},
    {mid:'m2',opp:'madar',to:'b@x.ex',subject:'H',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'},
    {mid:'m3',opp:'short',to:'c@x.ex',subject:'H',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]);
  // A lane is derived from the send RECORD, never from a bare stage:'sent'. These three cards each carry a
  // real delivered mail row, so the send cache must be invalidated to see the freshly seeded ledger.
  try{ window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits(); }catch(e){} })()
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

MEAS = r"""(slug)=>{
  const tk=document.querySelector('#boardLanes .tok[data-slug='+CSS.escape(slug)+']'); if(!tk) return null;
  const R=e=>e.getBoundingClientRect();
  const ov=(a,c)=>a&&c&&!(a.right<=c.left||c.right<=a.left||a.bottom<=c.top||c.bottom<=a.top);
  const nm=tk.querySelector('.tok-name'), mo=tk.querySelector('.tok-more'), gr=tk.querySelector('.tok-grip'), op=tk.querySelector('.tok-open');
  const nb=R(nm), mb=mo&&R(mo), gb=gr&&R(gr), ob=R(op), tb=R(tk), cs=getComputedStyle(tk), csn=getComputedStyle(nm);
  const lh=parseFloat(csn.lineHeight)||18;
  const padList=cs.paddingTop+'|'+cs.paddingRight+'|'+cs.paddingBottom+'|'+cs.paddingLeft;
  const equalInsets=(cs.paddingTop===cs.paddingRight && cs.paddingRight===cs.paddingBottom && cs.paddingBottom===cs.paddingLeft);
  return { align:cs.alignItems, padEqual:equalInsets, colGap:cs.columnGap, openGap:getComputedStyle(op).rowGap,
    tokH:Math.round(tb.height), nameLines:Math.round(nb.height/lh), clamp:csn.webkitLineClamp,
    overMore:ov(nb,mb), overGrip:ov(nb,gb),
    chevCY:mb?(mb.top+mb.bottom)/2:null, line1CY:nb.top+lh/2,
    openLeft:ob.left, moreLeft:mb?mb.left:null, gripLeft:gb?gb.left:null,
    nameAlign:csn.textAlign, dir:getComputedStyle(tk).direction }; }"""

def board(brow, w, rtl=False):
    pg = brow.new_page(viewport={"width": w, "height": 1000})   # a fresh page per width, so language/dir never leak across passes
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>document.documentElement.classList.remove('gate-locked')")   # the gate only hides .wrap; reveal for layout
    pg.evaluate("(s)=>eval(s)", SEED)
    if rtl: pg.evaluate("()=>{ try{ window.setLang&&window.setLang('ar'); }catch(e){} document.documentElement.setAttribute('dir','rtl'); }")
    # the board reads the server-computed view now: seed the three cards into the Sent lane
    pg.evaluate("""()=>window.__boardViewSet([
      {slug:'asfa', stage:'sent', open_count:0, replied:false, idle_days:3, has_page:true, has_email:false, archived:false},
      {slug:'madar', stage:'sent', open_count:0, replied:false, idle_days:3, has_page:true, has_email:false, archived:false},
      {slug:'short', stage:'sent', open_count:0, replied:false, idle_days:3, has_page:true, has_email:false, archived:false}
    ])""")
    pg.evaluate("()=>{ location.hash='#board'; window.thriveBoardRefresh&&window.thriveBoardRefresh(); }")
    pg.wait_for_function("()=>document.querySelector('#boardLanes .tok[data-slug=asfa]')", timeout=8000)
    # set the visible lane AFTER the render (the narrow layout resets data-active-lane during render)
    pg.evaluate("()=>{ const b=document.getElementById('boardLanes'); if(b) b.setAttribute('data-active-lane','sent'); }")
    pg.wait_for_function("()=>{ const t=document.querySelector('#boardLanes .tok[data-slug=asfa]'); return t && t.getBoundingClientRect().height>0; }", timeout=8000)
    pg.wait_for_timeout(150)   # let fonts/layout settle before measuring the first-line baseline
    return pg

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ============================ desktop (condensed 5 columns) ============================
    pg = board(b, 1280)
    asfa = pg.evaluate(MEAS, "asfa"); short = pg.evaluate(MEAS, "short"); madar = pg.evaluate(MEAS, "madar")
    ck("the card uses one internal geometry with equal insets and a top-aligned corner (not centre)",
       asfa["align"]=="flex-start" and asfa["padEqual"] is True, asfa)
    ck("one gap token spaces every zone: the corner gap equals the title-to-meta gap",
       asfa["colGap"]==asfa["openGap"] and asfa["colGap"]!="0px", {"colGap":asfa["colGap"], "openGap":asfa["openGap"]})
    ck("a long English title wraps to two lines and clamps there (two-line wrap then ellipsis)",
       asfa["nameLines"]==2 and asfa["clamp"]=="2", asfa)
    ck("the chevron centres on the title's FIRST line even when the title wraps (not the wrapped block)",
       abs(asfa["chevCY"]-asfa["line1CY"]) <= 2.0, {"chevCY":asfa["chevCY"], "line1CY":asfa["line1CY"]})
    ck("a single-line card centres the chevron on that line too",
       abs(short["chevCY"]-short["line1CY"]) <= 2.0, {"chevCY":short["chevCY"], "line1CY":short["line1CY"]})
    ck("the title never overlaps the menu or the grip (a reserved corner the title cannot enter)",
       asfa["overMore"] is False and asfa["overGrip"] is False and madar["overMore"] is False, {"asfa":asfa, "madar":madar})
    ck("the card height grows by only the title's one extra line (two-line card is one line taller, no more)",
       0 < (asfa["tokH"]-short["tokH"]) <= 22, {"twoLine":asfa["tokH"], "oneLine":short["tokH"]})

    # ============================ Arabic mirror ============================
    pg.close(); pg = board(b, 1280, rtl=True)
    ar = pg.evaluate(MEAS, "madar")
    ck("Arabic mirrors: the corner zone (menu, grip) sits to the LEFT of the title zone",
       ar["dir"]=="rtl" and ar["moreLeft"] < ar["openLeft"] and ar["gripLeft"] < ar["openLeft"], ar)
    ck("the Arabic title is right-aligned and still clamps to two lines with the chevron on line one",
       ar["nameAlign"]=="right" and ar["nameLines"]<=2 and abs(ar["chevCY"]-ar["line1CY"])<=2.5, ar)

    # ============================ phone (single lane) ============================
    pg.close(); pg = board(b, 380)
    ph = pg.evaluate(MEAS, "asfa")
    ck("on the phone width the card keeps equal insets, top-aligned corner, and the chevron on line one",
       ph["align"]=="flex-start" and ph["padEqual"] is True and abs(ph["chevCY"]-ph["line1CY"])<=2.5, ph)
    ck("on the phone width nothing overlaps and the title clamps to at most two lines",
       ph["overMore"] is False and ph["overGrip"] is False and ph["nameLines"]<=2, ph)

    # ============================ controls unchanged (no logic change) ============================
    pg.close(); pg = board(b, 1280)
    works = pg.evaluate("""async ()=>{
      const tk=document.querySelector('#boardLanes .tok[data-slug=short]');
      const more=tk.querySelector('.tok-more'), open=tk.querySelector('.tok-open'), grip=tk.querySelector('.tok-grip');
      more.click();
      // the menu handler is async (it awaits mergedOpps before appending .cardmenu), so wait a beat
      const started=Date.now(); let menu=null;
      while(!(menu=document.querySelector('.cardmenu')) && Date.now()-started<3000){ await new Promise(r=>setTimeout(r,40)); }
      return { hasOpen:!!open, hasGrip:!!grip, hasMore:!!more, menuOpened:!!menu,
               slug: tk.getAttribute('data-slug'), lane: tk.getAttribute('data-lane') }; }""")
    ck("every control is still present and bound: the menu opens, the open button and grip remain (no logic change)",
       works["hasOpen"] and works["hasGrip"] and works["hasMore"] and works["menuOpened"]
       and works["slug"]=="short" and works["lane"]=="sent", works)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CARD-GEOMETRY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
