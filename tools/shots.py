"""Screenshot fingerprint of every view, at three widths, in both directions.
A no-op refactor must not change one byte of any of them."""
import threading, http.server, socketserver, functools, os, sys, json, hashlib
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH","/opt/pw-browsers")
ROOT="/home/user/thrive-console"; PORT=int(sys.argv[2]) if len(sys.argv)>2 else 8831
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd=socketserver.TCPServer(("127.0.0.1",PORT),Handler); httpd.daemon_threads=True
threading.Thread(target=httpd.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
base=f"http://127.0.0.1:{PORT}"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT=sys.argv[1]
PAGES=["index","library","editor","compose","templates","activity","settings"]
WIDTHS=[390,1024,1440]
res={}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    for lang in ("en","ar"):
        for w in WIDTHS:
            ctx=b.new_context(viewport={"width":w,"height":900}, device_scale_factor=1)
            ctx.route("**/exec*", lambda r: r.abort())
            ctx.route("https://script.google.com/**", lambda r: r.abort())
            ctx.route("https://api.github.com/**", lambda r: r.abort())
            pg=ctx.new_page()
            pg.goto(f"{base}/library/index.html"); pg.wait_for_timeout(300)
            pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
            if pg.query_selector("#thriveGate"):
                pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
            for name in PAGES:
                pg.goto(f"{base}/library/{name}.html"); pg.wait_for_timeout(1800)
                pg.evaluate("()=>{document.querySelectorAll('.brand img,.gate-logo').forEach(e=>e.style.animation='none')}")
                pg.wait_for_timeout(200)
                png=pg.screenshot(full_page=True)
                res[f"{lang}/{w}/{name}"]=hashlib.sha256(png).hexdigest()[:16]
            ctx.close()
    b.close()
httpd.shutdown()
open(OUT,"w").write(json.dumps(res,indent=1,sort_keys=True))
print("captured", len(res), "->", OUT)
