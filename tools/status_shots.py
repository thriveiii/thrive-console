"""Chromium baseline for the status component. NOT WebKit proof; the iPad is Thyab's gate.
Phone/iPad-portrait: designed pills (icon + integrated count, no word). iPad-landscape/desktop:
column headers (icon + word + integrated count). The count renders once; the duplicate is gone."""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=int(sys.argv[2]) if len(sys.argv)>2 else 8883
TAG=sys.argv[1] if len(sys.argv)>1 else "after"
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),Hh); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/status"; os.makedirs(OUT,exist_ok=True)
SEED="""()=>{const now=Date.now(),iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'},
  {slug:'b',business:'Bravo Co',published:true,up:now,stage:'replied'},
  {slug:'e',business:'Echo Co',published:true,up:now,stage:'replied'},
  {slug:'c',business:'Charlie Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'c@x'},outreach_text:'Hi.'},
  {slug:'d',business:'Delta Co',published:false,up:now}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'1',opp:'b',direction:'in',status:'replied',ts:iso(1)},{mid:'2',opp:'e',direction:'in',status:'replied',ts:iso(1)}]));}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(500)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1900)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1300)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
 pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(900)
 pg.evaluate("()=>{const t=document.getElementById('boardTabs');(t&&getComputedStyle(t).display!=='none'?t:document.querySelector('.board')).scrollIntoView({block:'start'})}"); pg.wait_for_timeout(300)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  # phone tab bar
  ctx=b.new_context(viewport={"width":390,"height":760},has_touch=True,is_mobile=True); ctx.route("https://api.github.com/**",lambda x:x.abort())
  pg=ctx.new_page(); enter(pg,lang); pg.screenshot(path=f"{OUT}/{TAG}-phone-{lang}.png", clip={"x":0,"y":0,"width":390,"height":430}); ctx.close()
  # ipad landscape headers
  ctx=b.new_context(viewport={"width":1024,"height":760},has_touch=True); ctx.route("https://api.github.com/**",lambda x:x.abort())
  pg=ctx.new_page(); enter(pg,lang); pg.screenshot(path=f"{OUT}/{TAG}-ipad-{lang}.png", clip={"x":0,"y":0,"width":1024,"height":430}); ctx.close()
 b.close()
s.shutdown()
print("done",TAG)
