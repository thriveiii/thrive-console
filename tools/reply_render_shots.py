"""Chromium baseline for the hardened reply message: answer first, quoted original separated, RTL and LTR
each in their own direction. Phone / iPad / desktop, EN and AR. NOT WebKit proof; the iPad is Thyab's gate.

Renders the real threadListHtml (the History tab body) for a card whose reply carries an Arabic answer with
a Latin URL and a Gmail quote header that does not cleanly parse, the exact tangle this brief fixes."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
s=socketserver.TCPServer(("127.0.0.1",0),Hh); PORT=s.server_address[1]; s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; OUT=ROOT+"/shots/reply-render"; os.makedirs(OUT,exist_ok=True)

SEED="""()=>{
 localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'madar', business:'مدارس المدار الدولية', published:true, up:1}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
   {mid:'s1', opp:'madar', to:'head@madar.example', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
   {gid:'b1', opp:'', kind:'reply', from:'alnajjarjawad97@gmail.com', name:'Basel Issa',
    subject:'Re: من جد وجد', ts:'2026-08-03T09:18:00Z',
    snippet:'نعم يسعدني ذلك، والرابط الذي أرسلتموه واضح: https://console.thriveiii.com/opp/madar\\nنتواصل قريبًا.\\nفي الأربعاء 3 أغسطس 2026، كتب فريق ثرايف the-team@thriveiii.com:\\n> مرحبًا، هذه صفحة المدرسة\\n> نرجو الاطلاع والرد'}]));
 localStorage.setItem('thrive_hits_v1','[]');
 window.invalidateSends&&window.invalidateSends();
}"""

def enter(pg,lang):
  pg.goto(base+"/library/console.html"); pg.wait_for_timeout(400)
  pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
  pg.reload(); pg.wait_for_function("()=>typeof window.threadListHtml==='function'", timeout=15000)
  pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
  pg.evaluate(SEED)
  # render the History thread body into a modal-like panel so the reply card shows in real CSS context
  pg.evaluate("""()=>{
    const host=document.createElement('div'); host.id='shot-thread';
    host.style.cssText='max-width:640px;margin:24px auto;padding:16px';
    host.className='mw-body';
    host.innerHTML='<div class="mw-hist">'+window.threadListHtml('madar')+'</div>';
    document.body.innerHTML=''; document.body.appendChild(host);
    document.body.style.background='var(--bg, #0d0f12)';
  }""")
  pg.wait_for_timeout(200)

with sync_playwright() as p:
  b=p.chromium.launch(executable_path=CH)
  for lang in ("en","ar"):
    for (w,h,tag) in [(390,860,'phone'),(768,1024,'ipad'),(1440,900,'desktop')]:
      ctx=b.new_context(viewport={"width":w,"height":h})
      ctx.route("https://api.github.com/**",lambda x:x.abort())
      ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
      pg=ctx.new_page(); enter(pg,lang)
      pg.screenshot(path=f"{OUT}/reply-{tag}-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,820)})
      ctx.close()
  b.close()
s.shutdown()
print("done")
