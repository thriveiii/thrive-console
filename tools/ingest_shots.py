"""P11 drop-surface shots: the tolerant reader's batch report with provenance + needs-message Write action,
at three widths, EN and AR. Drops the batch-13 shape (six opp/<slug>/index.html + one aggregated research md)
plus one page-only folder that resolves to 'needs message', through the real #fileInput path."""
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = os.path.join(ROOT, "scratchpad_shots"); os.makedirs(OUT, exist_ok=True)
RESEARCH = open(os.path.join(ROOT, "tools/fixtures/BATCH13_research_and_messages.md")).read()
SLUGS = ["river-sea-chocolates", "ludic-lillian", "wise-butterfly", "jamiyat-alsharq-lilhulwiat", "wander-wick-candles", "corner-bloom-studio"]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def drop_js():
    files = []
    for s in SLUGS:
        files.append({"name": f"opp/{s}/index.html", "text": f"<!doctype html><title>{s}</title><h1>{s}</h1>", "type": "text/html"})
    files.append({"name": "opp/silent-shop/index.html", "text": "<!doctype html><title>Silent Shop</title><p>nothing to reach here</p>", "type": "text/html"})
    files.append({"name": "BATCH13_research_and_messages.md", "text": RESEARCH, "type": "text/markdown"})
    return "const SPEC=" + json.dumps(files) + ";" + r"""
      const dt = new DataTransfer();
      SPEC.forEach(f => dt.items.add(new File([f.text], f.name, {type:f.type})));
      const inp = document.getElementById('fileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', {bubbles:true}));
    """

WIDTHS = [390, 1024, 1280]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    for lang in ("en", "ar"):
        for w in WIDTHS:
            pg = b.new_page(viewport={"width": w, "height": 1100})
            pg.goto(f"{base}/library/console.html#editor")
            if pg.query_selector("#gateInput"):
                pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
            pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
            if lang == "ar":
                pg.evaluate("()=>{ try{ localStorage.setItem('thrive_lang','ar'); }catch(e){} }")
                pg.reload()
                pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")
            pg.wait_for_selector("#mode_upload", timeout=15000)
            pg.click("#mode_upload"); pg.wait_for_selector("#fileInput", state="attached", timeout=8000)
            pg.evaluate(drop_js())
            pg.wait_for_selector("#batchPanel .bt tr.is-matched, #batchPanel .bt tr.is-needs", timeout=15000)
            pg.wait_for_timeout(500)
            # horizontal-scroll guard
            hscroll = pg.evaluate("()=>document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            fn = os.path.join(OUT, f"ingest_{lang}_{w}.png")
            panel = pg.locator("#batchPanel")
            panel.scroll_into_view_if_needed()
            pg.wait_for_timeout(150)
            panel.screenshot(path=fn)
            print(f"wrote {fn}  hscroll={hscroll}")
            pg.close()
    b.close()
httpd.shutdown()
