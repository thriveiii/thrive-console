"""Chromium baseline for the two-layout board. NOT WebKit proof; the iPad is Thyab's gate.
Phone + iPad portrait: the status tab bar. iPad landscape + desktop: five columns fit."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=8873
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),Hh); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/board-responsive"; os.makedirs(OUT,exist_ok=True)
SEED="""()=>{const now=Date.now(),iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'},
  {slug:'b',business:'Bravo Media Group',published:true,up:now,stage:'replied'},
  {slug:'e',business:'Echo Replied Co',published:true,up:now,stage:'replied'},
  {slug:'c',business:'Charlie Ready Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'c@x'},outreach_text:'Hi.'},
  {slug:'d',business:'Delta Draft Co',published:false,up:now}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'1',opp:'b',direction:'in',status:'replied',ts:iso(1)},{mid:'2',opp:'e',direction:'in',status:'replied',ts:iso(1)}]));
 localStorage.setItem('thrive_hits_v1',JSON.stringify([{type:'open',slug:'a',vid:'v1',ts:iso(2)}]));}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(500)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(2000)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
 pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1000)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  for (w,h,tag) in [(390,860,'phone'),(768,1024,'ipad-portrait'),(1024,820,'ipad-landscape'),(1440,900,'desktop')]:
   ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=834),is_mobile=(w<=430)); ctx.route("https://api.github.com/**",lambda x:x.abort())
   pg=ctx.new_page(); enter(pg,lang)
   pg.screenshot(path=f"{OUT}/{tag}-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,800)})
   # on phone, also capture a switched tab (Replied) to show the switch
   if tag=='phone':
    pg.click('.btab[data-tab="replied"]'); pg.wait_for_timeout(500)
    pg.screenshot(path=f"{OUT}/phone-replied-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,800)})
   ctx.close()
 b.close()
s.shutdown()
print("done")
