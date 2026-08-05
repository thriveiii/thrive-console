"""T2 layout evidence: the board at three widths in both locales, seeded with
long business names so the card body is shown carrying, not clipping, the name.
Mirrors screen_truth.py's entry (console.html, gate, seed, reload) and its
device model (w<=430 is touch, so 390 is a real phone). Writes six PNGs."""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; PORT = 8837
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler); httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = ROOT + "/shots/t2"; os.makedirs(OUT, exist_ok=True)

# A card in several lifecycle states, but with names long enough that the old
# nowrap+ellipsis would have shown "Ludic..." and a meta line long enough that
# it would have shown "no ema...". If the name and meta read in full here, the
# truncation is gone.
SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'ludic',business:'Ludic Lillian Marketing Collective',published:false,up:now},
  {slug:'longer',business:'The Very Long Business Name That Used To Be Clipped Ltd',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'a@longer.example'},outreach_text:'Hi.'},
  {slug:'noemail',business:'Riverside Artisan Bakery and Cafe',published:true,up:now,stage:'sent'},
  {slug:'ar-long',business:'مؤسسة الريادة للتسويق الرقمي والإعلان والعلاقات العامة',published:true,up:now,stage:'sent',channel:{kind:'email',to:'d@ar.example'}},
  {slug:'won-co',business:'Won Co',published:true,up:now,stage:'won'}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'m1',ts:new Date(now-2*86400000).toISOString(),opp:'noemail',to:'b@n.example',status:'sent',direction:'out'}]));
 localStorage.setItem('thrive_hits_v1', JSON.stringify([]));
}"""

WIDTHS = [(390, 844), (768, 1024), (1440, 900)]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for (w, h) in WIDTHS:
            coarse = w <= 430
            ctx = b.new_context(viewport={"width": w, "height": h},
                                has_touch=coarse, is_mobile=coarse, reduced_motion="reduce")
            ctx.route("https://api.github.com/**", lambda x: x.abort())
            pg = ctx.new_page()
            pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
            pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
            if pg.query_selector("#thriveGate"):
                pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
            pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(2000)
            if pg.query_selector("#thriveGate"):
                pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)
            pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(900)
            pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
            pg.wait_for_timeout(200)
            path = f"{OUT}/board-{lang}-{w}.png"
            pg.screenshot(path=path, full_page=False)
            print("wrote", path)
            ctx.close()
    b.close()
httpd.shutdown()
