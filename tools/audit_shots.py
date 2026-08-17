"""Service-readiness audit: a surface gallery. Board, Library, Insights, Settings at desktop (EN+AR) and
phone (EN), signed in with a small seeded board. NOT WebKit proof; the device gate is Thyab's."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/shots/audit"; os.makedirs(OUT, exist_ok=True)

SEED = """()=>{
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'madar', business:'مدارس المدار الدولية', published:true, up:1},
  {slug:'organic-allure', business:'Organic Allure', published:true, up:1},
  {slug:'echo', business:'Echo Media Group', published:true, up:1},
  {slug:'basel', business:'Basel Issa', published:false, up:1}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
  {gid:'i1', opp:'madar', kind:'reply', from:'basel@issa.example', name:'باسل عيسى', subject:'Re: من جد وجد',
   snippet:'نعم يسعدني ذلك', ts:'2026-08-03T09:00:00Z'}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'s1', opp:'madar', to:'head@madar.example', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'},
  {mid:'s2', opp:'organic-allure', to:'ceo@oa.example', subject:'hello', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
 localStorage.setItem('thrive_hits_v1', JSON.stringify([{type:'open', slug:'organic-allure', ts:'2026-08-02T10:00:00Z', vid:'v1'}]));
 window.__boardViewSet([
  {slug:'madar', stage:'replied', open_count:0, replied:true, idle_days:1, has_page:true, has_email:false, archived:false},
  {slug:'organic-allure', stage:'opened', open_count:1, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
  {slug:'echo', stage:'sent', open_count:0, replied:false, idle_days:2, has_page:true, has_email:false, archived:false},
  {slug:'basel', stage:'draft', open_count:0, replied:false, idle_days:0, has_page:false, has_email:false, archived:false}]);
 window.invalidateSends && window.invalidateSends();
}"""

def enter(pg, lang):
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(300)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
    pg.reload(); pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function'", timeout=15000)
    pg.evaluate("()=>{ const g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
    pg.evaluate(SEED)
    pg.evaluate("async()=>{ location.hash='#board'; await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(600)

SURFACES = [("board","#board"), ("library","#library"), ("insights","#insights"), ("settings","#settings")]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    # phone, iPad, desktop - each in EN and AR - so every surface is proven at every width in both directions
    for (w, h, tag, langs) in [(1440,900,"desktop",("en","ar")), (834,1112,"ipad",("en","ar")), (390,860,"phone",("en","ar"))]:
        for lang in langs:
            ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=(w<=834), is_mobile=(w<=430))
            ctx.route("https://api.github.com/**", lambda r: r.abort())
            ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
            pg = ctx.new_page(); enter(pg, lang)
            for (name, h_) in SURFACES:
                try:
                    pg.evaluate("hh=>{ location.hash=hh; }", h_); pg.wait_for_timeout(600)
                except Exception as e:
                    print(f"{name} {lang}/{tag}: {e}")
                pg.screenshot(path=f"{OUT}/{name}-{tag}-{lang}.png", clip={"x":0,"y":0,"width":w,"height":min(h,900)})
            ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
