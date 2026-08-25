"""BOOT_FIRST_PAINT contract (browser, fails-when-broken).

Device evidence: after passing both gates the operator was stranded FOREVER on the root index splash. The
root index router does location.replace("./library/console.html") at once on the warm/live path, so the
browser is navigating INTO console.html, but a navigation does not repaint until the new document reaches
its first paint. console.html's head carried two RENDER-BLOCKING <link rel="stylesheet"> (fonts.css ~327 KB
+ styles.css ~201 KB); a render-blocking sheet withholds the document's first paint until it fully loads, so
on a marginal connection console.html never painted and the browser kept showing the previous document (the
index splash) with no way forward.

The fix loads both sheets NON-render-blocking (media="print", flipped to all on load) with a <noscript>
fallback, leaving the inline gate-critical block to paint the gate/boot frame the moment the HTML arrives.

This test proves it at the engine level:
  A. With BOTH stylesheets hung (never responding), console.html still reaches first-contentful-paint within
     a short bound. Reverting to render-blocking <link> makes FCP wait on the hung sheets and this fails.
  B. On a normal load both links end at media="all" (their onload fired and swapped them in), so the full
     styles are actually applied, not merely requested.
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

# Source guard: the served console.html carries the async pattern, and the offline dist inlines all CSS
# (no external stylesheet link at all).
console = open(os.path.join(ROOT, "library/console.html")).read()
dist = open(os.path.join(ROOT, "dist/thrive-console.html")).read()
ck("served console.html loads fonts.css + styles.css non-render-blocking (media=print, onload swap)",
   console.count('media="print" onload="this.media=\'all\'"') == 2
   and 'href="./fonts.css' in console and 'href="./styles.css' in console)
ck("served console.html keeps a <noscript> render-blocking fallback for both sheets",
   '<noscript><link rel="stylesheet" href="./fonts.css' in console and 'href="./styles.css' in console.split('<noscript>')[1])
ck("the inline gate-critical block is present and precedes the sheet links (it rules the pre-stylesheet frame)",
   'id="gate-critical"' in console and 'media="print"' in console
   and console.find('id="gate-critical"') < console.find('media="print"'))
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

    # ---- Scenario A: both stylesheets hung; first paint must still fire ----
    pg = b.new_page()
    # Hang the two heavy sheets: never fulfil, so the request stays pending (a marginal connection). Everything
    # else (the HTML, the inline scripts, the app modules) is allowed. app.js is large and irrelevant to the
    # first paint of the gate frame; we do not wait on it.
    def hang_css(route):
        # leave the request pending forever (do not fulfil, do not abort)
        pass
    pg.route("**/fonts.css*", hang_css)
    pg.route("**/styles.css*", hang_css)
    pg.goto(f"{base}/library/console.html", wait_until="commit")
    # Poll for first-contentful-paint. With the async fix it fires from the inline critical CSS within a few
    # hundred ms; with render-blocking links it would never fire while the sheets hang.
    fcp = 0.0
    for _ in range(40):  # up to ~4s
        fcp = pg.evaluate("""()=>{ const e=performance.getEntriesByName('first-contentful-paint'); return e.length? e[0].startTime : 0; }""")
        if fcp and fcp > 0:
            break
        pg.wait_for_timeout(100)
    ck("first-contentful-paint fires while BOTH stylesheets are hung (paint is no longer blocked on the sheets)",
       fcp and fcp > 0, {"fcp_ms": fcp})
    # And the sheets are genuinely still pending (media stayed 'print', onload never ran), proving the paint
    # happened WITHOUT them, not because they slipped in.
    media_state = pg.evaluate("""()=>Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(l=>l.media)""")
    ck("with the sheets hung, their links are still media=print (unswapped), so first paint used the inline frame",
       media_state and all(m == "print" for m in media_state), media_state)
    try: pg.unroute_all(behavior="ignoreErrors")
    except Exception: pass
    pg.close()

    # ---- Scenario B: normal load; onload swaps the sheets to media=all so the full styles apply ----
    pg2 = b.new_page()
    pg2.goto(f"{base}/library/console.html", wait_until="load")
    pg2.wait_for_timeout(600)
    media_after = pg2.evaluate("""()=>Array.from(document.querySelectorAll('link[rel=stylesheet]')).filter(l=>/fonts\\.css|styles\\.css/.test(l.href)).map(l=>l.media)""")
    ck("on a normal load both heavy sheets end at media=all (their onload swap fired, so styles are applied)",
       media_after and len(media_after) == 2 and all(m == "all" for m in media_after), media_after)
    # A rule that lives ONLY in styles.css (not in the inline critical block) is in effect, proving the full
    # sheet actually governs the page after the swap. --bg is a styles.css custom property on :root.
    has_full = pg2.evaluate("""()=>{ const v=getComputedStyle(document.documentElement).getPropertyValue('--bg'); return !!(v && v.trim()); }""")
    ck("a styles.css-only token (:root --bg) is in effect after the swap (full stylesheet applied)",
       has_full)
    pg2.close()

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL FIRST-PAINT CHECKS PASS"))
raise SystemExit(1 if fails else 0)
