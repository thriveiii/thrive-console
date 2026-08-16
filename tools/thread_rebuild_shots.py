"""Chromium baseline for the rebuilt internal conversation view: the two-sided thread (our send + their
reply as one bubble component, distinct surfaces, header on its own row, the quoted original collapsed) and
the inline composer beneath it. Phone / iPad / desktop, EN and AR. NOT WebKit proof; the iPad is Thyab's gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
s=socketserver.TCPServer(("127.0.0.1",0),Hh); PORT=s.server_address[1]; s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; OUT=ROOT+"/shots/thread-rebuild"; os.makedirs(OUT,exist_ok=True)

# Basel's reply: an Arabic answer that carries a BARE domain (no scheme) inline, then an Outlook-style quoted
# original with no ">" markers - the exact cases the rebuild fixes (isolation + never-dumped quote).
BASEL = ("نعم، هذا رائع. راجعنا console.thriveiii.com/opp/madar-2026 وسنعود إليكم قريبًا.\n\n"
         "From: Thrive Digital Solutions <hi@thriveiii.com>\n"
         "Sent: Monday, August 3, 2026 9:37 PM\n"
         "To: Basel Issa <basel@issa.example>\n"
         "Subject: عرض المدرسة\n\n"
         "اطّلعوا على العرض هنا، نتطلع إلى ردكم.")

SEED = """(a)=>{
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'madar',business:'مدارس المدار الدولية',published:true,up:1,recipients:[{addr:'basel@issa.example',name:'باسل عيسى',lang:'ar'}]}]));
 localStorage.setItem('thrive_inbound_v1',JSON.stringify([
  {gid:'i1',opp:'madar',kind:'reply',from:'basel@issa.example',name:'باسل عيسى عبد الله الطويل',subject:'Re: من جد وجد',snippet:a.basel,ts:'2026-08-03T09:00:00Z',messageId:'<wire-basel-1@issa.example>'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'s1',opp:'madar',to:'head@madar.example',toName:'إدارة المدار',subject:'من جد وجد',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z',msgid:'<send-madar-1@thriveiii.com>'}]));
 localStorage.setItem('thrive_hits_v1','[]');
 window.__boardViewSet([
  {slug:'madar',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false}]);
 window.invalidateSends&&window.invalidateSends();
}"""

def enter(pg,lang):
  pg.goto(base+"/library/console.html"); pg.wait_for_timeout(400)
  pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
  pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
  pg.reload(); pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function' && window.thriveModal", timeout=15000)
  pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
  pg.evaluate(SEED, {"basel": BASEL})
  pg.evaluate("()=>{ location.hash='#board'; }")
  pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(500)

with sync_playwright() as p:
  b=p.chromium.launch(executable_path=CH)
  for lang in ("en","ar"):
    for (w,h,tag) in [(390,860,'phone'),(768,1024,'ipad'),(1440,900,'desktop')]:
      ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=834),is_mobile=(w<=430))
      ctx.route("https://api.github.com/**",lambda x:x.abort())
      ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
      pg=ctx.new_page(); enter(pg,lang)
      # open the conversation (History tab) on madar and let the thread + composer settle
      try:
        pg.evaluate("()=>window.thriveModal.open('madar','history','مدارس المدار الدولية')")
        pg.wait_for_selector('#modalHistory .th-list', timeout=6000)
        pg.wait_for_timeout(700)
      except Exception as e:
        print(f"{lang}/{tag}: open failed: {e}")
      pg.screenshot(path=f"{OUT}/thread-{tag}-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,840)})
      ctx.close()
  b.close()
s.shutdown()
print("done -> "+OUT)
