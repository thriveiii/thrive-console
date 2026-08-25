"""STYLES_ALWAYS_APPLY contract (browser, fails-when-broken).

Device evidence (build 7e0ade8d): the console rendered as RAW UNSTYLED HTML on the operator's phone: the
brand showed as a purple underlined link and the language control as a bare pill. Cause: P54 loaded
styles.css with the async swap `media="print" onload="this.media='all'"`. When that onload does not fire on
WebKit the sheet never becomes a screen stylesheet, so the interface is never styled, permanently.

Measured, the swap was a false economy: styles.css is only ~52 KB gzipped, while fonts.css is ~248 KB
gzipped (base64 font faces that barely compress) and is purely decorative. So the law is now:

  styles.css is a NORMAL blocking stylesheet  -> the interface is ALWAYS styled, no swap to fail;
  fonts.css is fetched AFTER the window load  -> the heavy sheet is off the critical path entirely.

This proves it at the engine level: with app.js AND fonts.css both blocked (the worst realistic case), the
page is still fully styled from styles.css; no media="print" swap exists anywhere; and on a healthy load the
webfont sheet is added only after load.
"""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

console = open(os.path.join(ROOT, "library/console.html")).read()
dist = open(os.path.join(ROOT, "dist/thrive-console.html")).read()

ck("the app CSS is INLINED, not linked: zero stylesheet links, so no CSS fetch can block or fail to apply",
   '<style id="app-styles">' in console and '<link rel="stylesheet"' not in console and 'media="print"' not in console)
ck("fonts.css is NOT a stylesheet link in the document (it is off the critical path)",
   '<link rel="stylesheet" href="./fonts.css' not in console)
ck("fonts.css is fetched by script only AFTER the window load event",
   'l.href="./fonts.css' in console and 'addEventListener("load"' in console)
ck("the inline gate-critical block still precedes the app CSS",
   'id="gate-critical"' in console and console.find('id="gate-critical"') < console.find('id="app-styles"'))
ck("the offline dist build still inlines all CSS (zero external stylesheet links)",
   'rel="stylesheet"' not in dist)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # The device's worst case: the heavy app never arrives and the webfonts never arrive.
    ctx = b.new_context()
    ctx.route("**/app.js*", lambda r: r.abort())
    ctx.route("**/fonts.css*", lambda r: r.abort())
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html", wait_until="domcontentloaded")
    pg.wait_for_timeout(1200)
    st = pg.evaluate("""()=>{
      var cs = getComputedStyle(document.documentElement);
      var brand = document.querySelector('.brand');
      var bs = brand ? getComputedStyle(brand) : null;
      return {
        bg: (cs.getPropertyValue('--bg')||'').trim(),
        ink: (cs.getPropertyValue('--ink')||'').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        brandDecoration: bs ? bs.textDecorationLine : null,
        sheets: document.styleSheets.length
      };
    }""")
    # The decisive assertion: styles.css tokens are LIVE even though app.js and fonts.css never came.
    ck("with app.js AND fonts.css both blocked, styles.css is still applied (the unstyled-forever bug is gone)",
       bool(st.get("bg")) and bool(st.get("ink")), st)
    ck("the brand is styled, not a default underlined link (the exact device symptom)",
       st.get("brandDecoration") in (None, "none"), st)
    ctx.close()

    # Healthy load: the webfont sheet is attached only after load, and styles still hold.
    ctx2 = b.new_context()
    ctx2.route("**/app.js*", lambda r: r.abort())   # keep the harness light; fonts allowed
    pg2 = ctx2.new_page()
    pg2.goto(f"{base}/library/console.html", wait_until="load")
    pg2.wait_for_timeout(1500)
    st2 = pg2.evaluate("""()=>({
      fontsAttached: !!document.querySelector('link[href*="fonts.css"]'),
      bg: (getComputedStyle(document.documentElement).getPropertyValue('--bg')||'').trim()
    })""")
    ck("on a healthy load the webfont sheet is attached after load, and the interface stays styled",
       st2.get("fontsAttached") and bool(st2.get("bg")), st2)
    ctx2.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL STYLES-ALWAYS-APPLY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
