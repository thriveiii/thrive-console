"""P12 · Chromium baseline for the rebuilt message render: each message a clear card with labeled zones -
sender then recipient, the timestamp, the subject on its own line, the body in its own block, the quoted
original collapsed beneath it - with the outbound send now carrying its real body (the مدارس fix), the
thread sharing the composer's gutters. Phone / iPad-landscape / desktop, EN and AR. The iPad is Thyab's gate."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Hh = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
s = socketserver.TCPServer(("127.0.0.1", 0), Hh); PORT = s.server_address[1]; s.daemon_threads = True
threading.Thread(target=s.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; OUT = ROOT + "/scratchpad_shots"; os.makedirs(OUT, exist_ok=True)

# An outbound send with a real body, then Basel's Arabic reply carrying a recomposable Gmail quote header
# (Arabic date, Latin sender, LTR address) with the quoted original beneath it.
BASEL = ("نعم، هذا رائع. شكرًا لكم، نتطلع إلى العرض.\n\n"
         "في اثنين، ٣ آب ٢٠٢٦ في ٩:٣٧ م، كتب Thrive Digital Solutions <hi@thriveiii.com>:\n"
         "> اطّلعوا على العرض هنا https://console.thriveiii.com/opp/madar\n"
         "> نتطلع إلى ردكم.")

SEED = """(a)=>{
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'madar',business:'مدارس المدار الدولية',published:true,up:1,recipients:[{addr:'basel@issa.example',name:'باسل عيسى',lang:'ar'}]}]));
 localStorage.setItem('thrive_inbound_v1',JSON.stringify([
  {gid:'i1',opp:'madar',kind:'reply',from:'basel@issa.example',name:'باسل عيسى عبد الله الطويل',subject:'Re: من جد وجد',snippet:a.basel,ts:'2026-08-03T09:00:00Z',messageId:'<wire-basel-1@issa.example>'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'s1',opp:'madar',to:'head@madar.example',toName:'إدارة المدار',subject:'من جد وجد',preview:'مرحبا، إليكم العرض الذي أعددناه لمدارس المدار الدولية. صفحة واحدة، بلا نموذج تملؤه. [LINK]',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z',msgid:'<send-madar-1@thriveiii.com>'}]));
 localStorage.setItem('thrive_hits_v1','[]');
 window.__boardViewSet([
  {slug:'madar',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false}]);
 window.invalidateSends&&window.invalidateSends();
}"""

def enter(pg, lang):
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
    pg.reload(); pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function' && window.thriveModal", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(SEED, {"basel": BASEL})
    pg.evaluate("()=>{ location.hash='#board'; }")
    pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for (w, h, tag) in [(390, 860, "phone"), (1024, 768, "ipad"), (1440, 900, "desktop")]:
            ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=(w <= 834), is_mobile=(w <= 430))
            ctx.route("https://api.github.com/**", lambda x: x.abort())
            ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
            pg = ctx.new_page(); enter(pg, lang)
            try:
                pg.evaluate("()=>window.thriveModal.open('madar','history','مدارس المدار الدولية')")
                pg.wait_for_selector('#modalHistory .th-list', timeout=8000)
                pg.wait_for_timeout(700)
            except Exception as e:
                print(f"{lang}/{tag}: open failed: {e}")
            pg.screenshot(path=f"{OUT}/thread_{lang}_{tag}.png", clip={"x": 0, "y": 0, "width": w, "height": min(h, 840)})
            print(f"wrote thread_{lang}_{tag}.png")
            ctx.close()
    b.close()
s.shutdown()
print("done -> " + OUT)
