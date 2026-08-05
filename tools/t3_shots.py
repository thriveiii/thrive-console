"""T3 rename evidence: the console header and heading in both locales, showing
the board renamed to Thrive Operations / عمليات ثرايف in the nav and the H1.
Mirrors the screen_truth.py entry (console.html, gate, seed, reload)."""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; PORT = 8839
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler); httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = ROOT + "/shots/t3"; os.makedirs(OUT, exist_ok=True)

SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'ready-co',business:'Ready Co',published:true,up:now,contact_tier:'A',channel:{kind:'email',to:'a@ready.example'},outreach_text:'Hi.'},
  {slug:'sent-co',business:'Sent Co',published:true,up:now,stage:'sent'}]));
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        ctx = b.new_context(viewport={"width": 1024, "height": 720}, reduced_motion="reduce")
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
        # the header and heading are in the top ~260px
        path = f"{OUT}/rename-{lang}.png"
        pg.screenshot(path=path, clip={"x": 0, "y": 0, "width": 1024, "height": 320})
        nav = pg.eval_on_selector('[data-i18n="nav_board"]', "e=>e.textContent")
        h1 = pg.eval_on_selector('[data-i18n="board_title"]', "e=>e.textContent")
        print(f"{lang}: nav={nav!r}  heading={h1!r}  ->  {path}")
        ctx.close()
    b.close()
httpd.shutdown()
