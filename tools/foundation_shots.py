"""Foundation evidence: the layout bounded at three widths in both locales (nothing cut at the
edge, equal margins, the board scrolling within itself), and the inline icon centred where it used
to float. Buttons are flex-centred already, so the float only shows in an inline run of text, which
is what the before/after renders."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=8851
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
s=socketserver.TCPServer(("127.0.0.1",PORT),H); s.daemon_threads=True
threading.Thread(target=s.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=ROOT+"/shots/foundation"; os.makedirs(OUT,exist_ok=True)
SEED="""()=>{const now=Date.now();localStorage.setItem('thrive_opps_v1',JSON.stringify([
 {slug:'a',business:'Alpha Co',published:true,up:now,stage:'sent'},
 {slug:'b',business:'Bravo Media Group',published:true,up:now,stage:'replied'},
 {slug:'c',business:'Charlie Ready Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'c@x.example'},outreach_text:'Hi.'},
 {slug:'d',business:'Delta Draft',published:false,up:now}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([{mid:'1',opp:'b',direction:'in',status:'replied',ts:new Date(now-86400000).toISOString()}]));}"""
def enter(pg,lang):
 pg.goto(base+"/library/console.html"); pg.wait_for_timeout(400)
 pg.evaluate("l=>localStorage.setItem('thrive_lang',l)",lang)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
 pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800)
 if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
 pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")

# an inline icon riding a line of text, rendered at the old and the new value, zoomed
DEMO="""(v)=>{ let h=document.getElementById('icdemo');
  if(!h){ h=document.createElement('div'); h.id='icdemo';
    h.style.cssText='position:fixed;left:20px;top:20px;z-index:99999;background:#111116;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:22px 26px;font-size:20px;color:#fff;line-height:1.6';
    document.body.appendChild(h); }
  const svg='<use href="#i-check" width="20" height="20"/>';
  h.innerHTML='<div>Review the numbers <svg class="ic" width="26" height="26" viewBox="0 0 20 20" style="vertical-align:'+v+';color:#7EE0B8">'+svg+'</svg> before you send.</div>';
}"""

WIDTHS=[(390,844),(768,1024),(1440,900)]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CH)
 for lang in ("en","ar"):
  for (w,h) in WIDTHS:
   ctx=b.new_context(viewport={"width":w,"height":h},has_touch=(w<=430),is_mobile=(w<=430))
   ctx.route("https://api.github.com/**",lambda x:x.abort())
   pg=ctx.new_page(); enter(pg,lang)
   for view in ("board","library"):
    pg.evaluate("v=>location.hash='#'+v",view); pg.wait_for_timeout(1100)
    pg.screenshot(path=f"{OUT}/{view}-{lang}-{w}.png", clip={"x":0,"y":0,"width":w,"height":min(h,820)})
   ctx.close()
 # icon before/after, zoomed 2x
 ctx=b.new_context(viewport={"width":760,"height":260}, device_scale_factor=2)
 ctx.route("https://api.github.com/**",lambda x:x.abort())
 pg=ctx.new_page(); enter(pg,"en")
 pg.evaluate(DEMO, "-.16em"); pg.wait_for_timeout(200)
 pg.screenshot(path=f"{OUT}/icon-before-016em.png", clip={"x":0,"y":0,"width":520,"height":110})
 pg.evaluate(DEMO, "-.28em"); pg.wait_for_timeout(200)
 pg.screenshot(path=f"{OUT}/icon-after-028em.png", clip={"x":0,"y":0,"width":520,"height":110})
 ctx.close(); b.close()
s.shutdown()
print("done")
