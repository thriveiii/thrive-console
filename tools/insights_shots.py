"""Chromium baseline for the Insights header. NOT WebKit proof; the iPad is Thyab's gate.
Before: the prose paragraph. After: the designed state strip reading the same numbers."""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=int(sys.argv[2]) if len(sys.argv)>2 else 8885
TAG=sys.argv[1] if len(sys.argv)>1 else "after"
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),Hh); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/insights"; os.makedirs(OUT,exist_ok=True)
SEED="""()=>{const now=Date.now(),iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'},
  {slug:'b',business:'Bravo Co',published:true,up:now,stage:'replied'},
  {slug:'c',business:'Charlie Co',published:true,up:now,stage:'sent'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'1',opp:'a',to:'a@x.example',direction:'out',status:'sent',ts:iso(6)},
  {mid:'2',opp:'a',to:'a@x.example',direction:'out',status:'sent',ts:iso(4)},
  {mid:'3',opp:'b',to:'b@x.example',direction:'out',status:'sent',ts:iso(5)},
  {mid:'4',opp:'c',to:'c@x.example',direction:'out',status:'sent',ts:iso(3)},
  {mid:'5',opp:'b',to:'b@x.example',direction:'in',status:'replied',ts:iso(1)}]));
 localStorage.setItem('thrive_hits_v1',JSON.stringify([
  {type:'open',slug:'a',vid:'v1',ts:iso(2)},{type:'open',slug:'a',vid:'v2',ts:iso(2)},
  {type:'open',slug:'b',vid:'v3',ts:iso(1)}]));}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(500)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(2000)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
 pg.evaluate("()=>location.hash='#home'"); pg.wait_for_timeout(1500)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  for (w,h) in [(390,720),(1024,600)]:
   ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=834)); ctx.route("https://api.github.com/**",lambda x:x.abort())
   pg=ctx.new_page(); enter(pg,lang)
   pg.screenshot(path=f"{OUT}/{TAG}-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,420)})
   if w==1024 and lang=="en" and TAG=="after":
    facts=pg.evaluate("""()=>({cells:[...document.querySelectorAll('.statcell-n')].map(e=>e.textContent), labels:[...document.querySelectorAll('.statcell-l')].map(e=>e.textContent)})""")
    print("strip:",facts)
   ctx.close()
 b.close()
s.shutdown()
print("done",TAG)
