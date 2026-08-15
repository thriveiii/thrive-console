"""Chromium baseline for the replies-attach brief: the distinct Replied lane and the reply-count badge at
phone / iPad / desktop widths, EN and AR. NOT WebKit proof; the iPad is Thyab's gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
s=socketserver.TCPServer(("127.0.0.1",0),Hh); PORT=s.server_address[1]; s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; OUT=ROOT+"/shots/replies"; os.makedirs(OUT,exist_ok=True)

SEED="""()=>{
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'a',business:'Alpha Co',published:true,up:1},
  {slug:'madar',business:'مدارس المدار الدولية',published:true,up:1},
  {slug:'echo',business:'Echo Media Group',published:true,up:1},
  {slug:'c',business:'Charlie Ready Co',published:true,up:1},
  {slug:'d',business:'Delta Draft Co',up:1}]));
 localStorage.setItem('thrive_inbound_v1',JSON.stringify([
  {gid:'i1',opp:'madar',kind:'reply',from:'head@madar.example',subject:'Re: hello',ts:'2026-08-03T09:00:00Z'},
  {gid:'i2',opp:'madar--r-9a9',kind:'reply',from:'dept@madar.example',subject:'Re: again',ts:'2026-08-05T09:00:00Z'},
  {gid:'i3',opp:'echo',kind:'reply',from:'ceo@echo.example',subject:'Re: hi',ts:'2026-08-04T09:00:00Z'}]));
 localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
 window.__boardViewSet([
  {slug:'a',stage:'sent',open_count:0,replied:false,idle_days:2,has_page:true,has_email:false,archived:false},
  {slug:'madar',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'echo',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'c',stage:'live',open_count:0,replied:false,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'d',stage:'draft',open_count:0,replied:false,idle_days:1,has_page:false,has_email:false,archived:false}]);
 window.invalidateSends&&window.invalidateSends();
}"""

def enter(pg,lang):
  pg.goto(base+"/library/console.html"); pg.wait_for_timeout(400)
  pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
  pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
  pg.reload(); pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function'", timeout=15000)
  pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
  pg.evaluate(SEED)
  pg.evaluate("()=>{ location.hash='#board'; }")
  pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(600)

with sync_playwright() as p:
  b=p.chromium.launch(executable_path=CH)
  for lang in ("en","ar"):
    for (w,h,tag) in [(390,860,'phone'),(768,1024,'ipad'),(1440,900,'desktop')]:
      ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=834),is_mobile=(w<=430))
      ctx.route("https://api.github.com/**",lambda x:x.abort())
      ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
      pg=ctx.new_page(); enter(pg,lang)
      if tag=='phone':
        try: pg.click('.btab[data-tab="replied"]'); pg.wait_for_timeout(400)
        except Exception: pass
      pg.screenshot(path=f"{OUT}/board-{tag}-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,820)})
      if tag=='desktop':
        # the inbox, showing the by-opportunity numbering
        try:
          pg.click('#boardInboxBtn'); pg.wait_for_timeout(500)
          pg.screenshot(path=f"{OUT}/inbox-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,820)})
        except Exception: pass
      ctx.close()
  b.close()
s.shutdown()
print("done")
