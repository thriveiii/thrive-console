"""The calm composer + one component / one compile path (P9 / D8).

Two proofs in one place:
  1. ONE composer, ONE compile. Grep: exactly one initCompose (the single composer that serves single,
     campaign, and reply) and exactly one compile() (the single compile path); the P8-era second entry
     points (compileArtifact / compileCampaignRow / composeArtifactCore) are gone; compose.html mounts one
     #ebody; there is no permanent formatting toolbar left in the markup.
  2. The calm chrome. At rest only To, Subject, body and Send (plus the two campaign controls) are visible;
     the floating format bar and the overflow are hidden. Aa reveals the floating bar; More reveals the one
     overflow (template, closing block, plain text, send-to-self); a format button in the floating bar still
     applies to a selection; Preview stays a first-class control (never in the overflow) and opens the
     per-recipient preview.

Engine-independent; WebKit is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- 1. source: one composer, one compile, no permanent toolbar ----------------------------------
app = open(os.path.join(ROOT, "library/app.js")).read()
html = open(os.path.join(ROOT, "library/compose.html")).read()
ck("exactly ONE composer component (one initCompose)", app.count("function initCompose") == 1)
ck("exactly ONE compile function, and the P8 second paths are gone",
   app.count("function compile(") == 1
   and "function compileArtifact(" not in app and "function compileCampaignRow(" not in app
   and "function composeArtifactCore(" not in app)
ck("the footer/pixel/token live in exactly one place (P7 count==1 restored)",
   app.count("ThriveStore.footerHtml") == 1 and app.count("ThriveStore.footerText") == 1)
ck("compose.html mounts exactly one message body (#ebody)", html.count('id="ebody"') == 1)
ck("no permanent formatting toolbar remains (formatting moved to the floating bar)",
   'class="etoolbar"' not in html and 'id="eFloatBar"' in html)
ck("single/campaign AND reply mount the SAME one composer (initCompose in reply mode), not a second component",
   re.search(r"initCompose\(\s*current\s*\)", app) is not None
   and re.search(r"initCompose\(\s*current\s*,\s*\{\s*reply\s*:\s*true", app) is not None)

# ---- 2. the calm chrome, live -------------------------------------------------------------------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

def vis(pg, sel):
    return pg.eval_on_selector(sel, """e=>{ var s=getComputedStyle(e), r=e.getBoundingClientRect();
      return !(e.hidden || s.display==='none' || s.visibility==='hidden' || (r.width===0 && r.height===0)); }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    pg.goto(f"{base}/library/compose.html?slug=vsd")
    unlock(pg)
    pg.wait_for_selector("#ebody", timeout=15000); pg.wait_for_timeout(300)

    ck("at rest: To, Subject, body, Send are visible",
       vis(pg, "#eto") and vis(pg, "#esubject") and vis(pg, "#ebody") and vis(pg, "#eSend"))
    ck("at rest: the floating format bar and the overflow are hidden",
       (not vis(pg, "#eFloatBar")) and (not vis(pg, "#cmpOverflow")))
    ck("the two campaign controls (personalize chip + Preview) are visible above Send, not in the overflow",
       vis(pg, "#tbPersonalize") and vis(pg, "#cmpPreviewBtn"))

    # Aa reveals the floating format bar
    pg.click("#eAa"); pg.wait_for_timeout(120)
    ck("Aa reveals the floating format bar (bold/italic/list/link)",
       vis(pg, "#eFloatBar") and vis(pg, "#tbBold") and vis(pg, "#tbList") and vis(pg, "#tbLink"))
    pg.click("#eAa"); pg.wait_for_timeout(120)
    ck("Aa toggles the floating bar back off", not vis(pg, "#eFloatBar"))

    # More reveals the one overflow, holding the rest
    pg.click("#cmpOverflowBtn"); pg.wait_for_timeout(120)
    ck("More reveals the ONE overflow, holding template + closing block + plain text + send-to-self",
       vis(pg, "#cmpOverflow") and vis(pg, "#etpl") and vis(pg, "#sigWrap") and vis(pg, "#plainWrap") and vis(pg, "#eSelf"))

    # a floating-bar format button still applies to a selection
    pg.evaluate("""()=>{ var b=document.getElementById('ebody'); b.focus(); b.innerHTML='hello world';
      var r=document.createRange(); r.selectNodeContents(b); var s=getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    pg.wait_for_timeout(120)
    ck("selecting text in the body reveals the floating bar (no permanent toolbar needed)", vis(pg, "#eFloatBar"))
    pg.click("#tbBold"); pg.wait_for_timeout(120)
    bhtml = pg.eval_on_selector("#ebody", "e=>e.innerHTML").lower()
    ck("a floating-bar format button applies to the selection (bold)",
       ("<b>" in bhtml or "<strong>" in bhtml or "font-weight" in bhtml), bhtml[:120])

    # Preview stays first-class and opens the per-recipient preview
    pg.click("#cmpPreviewBtn"); pg.wait_for_timeout(200)
    ck("the Preview control opens the per-recipient preview (first-class, never in the overflow)",
       pg.eval_on_selector("#prevWrap", "e=>e.open") == True)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CALM COMPOSER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
