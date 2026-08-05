"""Chromium baseline for the badge/notice/button alignment. NOT WebKit proof; the iPad is the gate.
The board top holds all three at once: the heading + sync badge, the button row, and the not-synced band."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=8879
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),Hh); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/badges"; os.makedirs(OUT,exist_ok=True)
SEED="""()=>{const now=Date.now();localStorage.setItem('thrive_opps_v1',JSON.stringify([{slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'}]));}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(500)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
 pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1000)
RTL="""()=>{const ph=document.querySelector('.page-h');const h=ph.querySelector('.title'),p=ph.querySelector('.pill');
 const hr=h.getBoundingClientRect(),pr=p.getBoundingClientRect();
 return {dir:document.documentElement.dir, headingRight:Math.round(hr.right), pillRight:Math.round(pr.right),
   pillLeadingOnRight: Math.abs(pr.right-hr.right)<3 || pr.left>hr.left, midOffset:Math.round((pr.top+pr.height/2)-(hr.top+hr.height/2))};}"""
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  for (w,h) in [(390,780),(768,900),(1440,760)]:
   ctx=b.new_context(viewport={"width":w,"height":h}); ctx.route("https://api.github.com/**",lambda x:x.abort())
   pg=ctx.new_page(); enter(pg,lang)
   pg.screenshot(path=f"{OUT}/boardtop-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,560)})
   if w==768: print(f"{lang} 768 RTL/center:", pg.evaluate(RTL))
   ctx.close()
 b.close()
s.shutdown()
print("done")
