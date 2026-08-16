"""Chromium baseline: the distinct reply card in the Replied lane (parent + reply), and the two-sided
conversation thread it opens. Phone / iPad / desktop, EN and AR. NOT WebKit proof; the iPad is Thyab's gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
s=socketserver.TCPServer(("127.0.0.1",0),Hh); PORT=s.server_address[1]; s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; OUT=ROOT+"/shots/reply-card"; os.makedirs(OUT,exist_ok=True)

SEED="""()=>{
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'madar',business:'مدارس المدار الدولية',published:true,up:1},
  {slug:'echo',business:'Echo Media Group',published:true,up:1},
  {slug:'a',business:'Alpha Co',published:true,up:1}]));
 localStorage.setItem('thrive_inbound_v1',JSON.stringify([
  {gid:'i1',opp:'madar',kind:'reply',from:'basel@issa.example',name:'Basel Issa',subject:'Re: من جد وجد',snippet:'نعم يسعدني ذلك، والرابط واضح، نتواصل قريبًا',ts:'2026-08-03T09:00:00Z'},
  {gid:'e1',opp:'echo',kind:'reply',from:'ann@echo.example',name:'Ann Reed',subject:'Re: hello',snippet:'Looks interesting, tell me more.',ts:'2026-08-02T09:00:00Z'},
  {gid:'e2',opp:'echo',kind:'reply',from:'omar@echo.example',name:'عمر حسن',subject:'Re: hello',snippet:'شكرًا، سنراجع الصفحة ونعود إليكم',ts:'2026-08-03T09:00:00Z'},
  {gid:'e3',opp:'echo',kind:'reply',from:'lee@echo.example',name:'Lee Park',subject:'Re: hello',snippet:'Can we schedule a call next week?',ts:'2026-08-04T09:00:00Z'},
  {gid:'e4',opp:'echo',kind:'reply',from:'dana@echo.example',name:'Dana Echo',subject:'Re: hello',snippet:'Great, this looks perfect. Happy to talk.',ts:'2026-08-05T09:00:00Z'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'s1',opp:'madar',to:'head@madar.example',toName:'Head',subject:'من جد وجد',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'},
  {mid:'s2',opp:'echo',to:'ceo@echo.example',toName:'Dana',subject:'hello',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]));
 localStorage.setItem('thrive_hits_v1','[]');
 window.__boardViewSet([
  {slug:'madar',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'echo',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'a',stage:'sent',open_count:0,replied:false,idle_days:2,has_page:true,has_email:false,archived:false}]);
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
        # open the thread from the reply card to capture the two-sided conversation
        try:
          pg.eval_on_selector('.reply-card[data-slug="madar"]', "el=>el.click()"); pg.wait_for_timeout(800)
          pg.screenshot(path=f"{OUT}/thread-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,820)})
        except Exception: pass
      ctx.close()
  b.close()
s.shutdown()
print("done")
