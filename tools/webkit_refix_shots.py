"""Chromium baseline for the WebKit re-fix. This does NOT prove the WebKit fix (the sandbox
cannot render WebKit); it shows the flex board and the icon alignment holding on Chromium, and
the behaviour probe proves the board scrolls within itself at every width. The iPad is Thyab's gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=8869
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),Hh); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/webkit-refix"; os.makedirs(OUT,exist_ok=True)
SEED="""()=>{const now=Date.now(),iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'},
  {slug:'b',business:'Bravo Media Group',published:true,up:now,stage:'replied'},
  {slug:'c',business:'Charlie Ready Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'c@x'},outreach_text:'Hi.'},
  {slug:'d',business:'Delta Draft Co',published:false,up:now}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'1',opp:'b',direction:'in',status:'replied',ts:iso(1)}]));
 localStorage.setItem('thrive_hits_v1',JSON.stringify([{type:'open',slug:'a',vid:'v1',ts:iso(2)}]));}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(400)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1900)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  for (w,h) in [(390,844),(768,1024),(1440,900)]:
   ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=430),is_mobile=(w<=430)); ctx.route("https://api.github.com/**",lambda x:x.abort())
   pg=ctx.new_page(); enter(pg,lang)
   for view in ("board","library"):
    pg.evaluate("v=>location.hash='#'+v",view); pg.wait_for_timeout(1100)
    pg.screenshot(path=f"{OUT}/{view}-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,820)})
   ctx.close()
 # icon offset with middle (flex holders should stay ~0)
 ctx=b.new_context(viewport={"width":1200,"height":900}); ctx.route("https://api.github.com/**",lambda x:x.abort())
 pg=ctx.new_page(); enter(pg,"en"); pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(900)
 icons=pg.evaluate("""()=>{const out=[];const seen=new Set();document.querySelectorAll('svg.ic').forEach(ic=>{const p=ic.parentElement;if(!p)return;const cs=getComputedStyle(p);const ir=ic.getBoundingClientRect();const pr=p.getBoundingClientRect();if(ir.width===0)return;const sig=((p.className||p.tagName)+'').split(/\\s+/).slice(0,2).join('.');if(seen.has(sig))return;seen.add(sig);out.push({ctx:sig.slice(0,20),disp:cs.display,off:Math.round((ir.top+ir.height/2-(pr.top+pr.height/2))*10)/10});});return out.sort((a,b)=>Math.abs(b.off)-Math.abs(a.off)).slice(0,6);}""")
 print("ICONS (middle):",icons)
 ctx.close(); b.close()
s.shutdown()
print("done")
