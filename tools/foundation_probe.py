"""Name the two defects empirically, do not assume them.
1) Icon float: for each icon-bearing context, the icon box centre vs its line/parent centre.
2) Layout: at iPad and phone widths, does the PAGE scroll horizontally (content past the edge),
   and which elements are wider than the viewport."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; PORT = 8843
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler); httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'},
  {slug:'b',business:'Bravo Media Group',published:true,up:now,stage:'replied'},
  {slug:'c',business:'Charlie Ready Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'c@x.example'},outreach_text:'Hi.'},
  {slug:'d',business:'Delta Draft',published:false,up:now}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'1',opp:'b',direction:'in',status:'replied',ts:new Date(now-86400000).toISOString()}]));
}"""

ICON_PROBE = r"""()=>{
  const out=[];
  const seen=new Set();
  document.querySelectorAll('svg.ic').forEach(ic=>{
    const p=ic.parentElement; if(!p) return;
    const cs=getComputedStyle(p);
    const ir=ic.getBoundingClientRect();
    // the text sibling(s) of the icon in the same parent: use the parent content box centre as reference
    const pr=p.getBoundingClientRect();
    if(ir.width===0) return;
    const iconMid=ir.top+ir.height/2, parentMid=pr.top+pr.height/2;
    const key=(p.className||p.tagName)+'';
    const sig=key.split(/\s+/).slice(0,2).join('.');
    if(seen.has(sig)) return; seen.add(sig);
    out.push({ ctx:sig.slice(0,32), parentDisplay:cs.display, alignItems:cs.alignItems,
      icVA:getComputedStyle(ic).verticalAlign,
      offsetPx:Math.round((iconMid-parentMid)*10)/10 });   // 0 = icon centred on parent box
  });
  return out.sort((a,b)=>Math.abs(b.offsetPx)-Math.abs(a.offsetPx));
}"""

OVERFLOW_PROBE = r"""()=>{
  const de=document.documentElement, vw=de.clientWidth;
  const pageScrolls = de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1;
  const off=[];
  document.querySelectorAll('body *').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.right > vw + 1 && r.width <= vw + 400){   // past the right edge but not a giant scroller container
      const cs=getComputedStyle(el);
      // skip the board scroller itself: it is ALLOWED to overflow internally (overflow-x:auto)
      const oxAuto = cs.overflowX==='auto' || cs.overflowX==='scroll';
      off.push({ el:(el.tagName.toLowerCase()+'.'+(el.className&&el.className.toString?el.className.toString().trim().split(/\s+/).slice(0,2).join('.'):'')).slice(0,34),
        right:Math.round(r.right), vw, overflowX:cs.overflowX, ownScroller:oxAuto });
    }
  });
  return { vw, pageScrollWidth:de.scrollWidth, pageScrollsHorizontally:pageScrolls,
    offendersPastRight: off.slice(0,12) };
}"""

def enter(pg):
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    # icon float: measure on a comfortable desktop so line boxes are natural
    ctx = b.new_context(viewport={"width":1200,"height":900}); ctx.route("https://api.github.com/**", lambda x:x.abort())
    pg = ctx.new_page(); enter(pg)
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(900)
    print("=== ICON FLOAT (offsetPx: icon centre minus parent-box centre; large |value| = floats) ===")
    for r in pg.evaluate(ICON_PROBE): print(" ", r)
    ctx.close()
    # layout overflow at iPad (768, touch) and phone (390, touch)
    for (w,h) in [(768,1024),(390,844)]:
        ctx = b.new_context(viewport={"width":w,"height":h}, has_touch=True, is_mobile=(w<=430))
        ctx.route("https://api.github.com/**", lambda x:x.abort())
        pg = ctx.new_page(); enter(pg)
        for view in ("board","library"):
            pg.evaluate("v=>location.hash='#'+v", view); pg.wait_for_timeout(1000)
            r=pg.evaluate(OVERFLOW_PROBE)
            print(f"=== LAYOUT {view} @ {w} === pageScrollsHorizontally={r['pageScrollsHorizontally']} scrollW={r['pageScrollWidth']} vw={r['vw']}")
            for o in r["offendersPastRight"]: print("   past-right:", o)
        ctx.close()
    b.close()
httpd.shutdown()
