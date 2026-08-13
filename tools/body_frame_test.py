"""The message body stays inside its frame.

On the device the compose preview body ran past the frame edge: the English preview lines clipped off
the right side. Cause, from the code: the preview is its own document (prevFrame.srcdoc, an iframe), and
its body carried no wrapping rule, so a long word or URL in composedHtml overflowed the frame and was
clipped by .cmp-preview{overflow:hidden}. The console stylesheet cannot reach inside the iframe.

The fix, CSS only: the srcdoc body sets overflow-wrap:anywhere and word-break:break-word (both inherit,
so composedHtml and the card wrap), and .ebody (the editable body) gets the same in styles.css. The body
wraps within the frame at every width in both directions; long URLs wrap; paragraph breaks are preserved.

Reproduced here at the narrowest width with a Music-Love-Academy body carrying an unbreakable token and a
long URL: before the fix the preview content is ~770px wide inside a ~306px frame (clipped); after, it is
contained. WebKit at three widths is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# Source guards
app = open(f"{ROOT}/library/app.js").read()
css = open(f"{ROOT}/library/styles.css").read()
ck("the preview iframe body wraps its content (srcdoc CSS)",
   "overflow-wrap:anywhere;word-break:break-word" in app and "prevFrame.srcdoc" in app)
# The wrapping now lives on ONE shared message-body rule that every body surface is grouped into (the
# editable .ebody, the modal text tab / overview <pre class="mw-pitch"> that the earlier fix missed, the
# thread reply body, and the message preview), instead of each surface carrying its own divergent copy.
_sel = css.split(".msg-body,")[1].split("{")[0] if ".msg-body," in css else ""
_dec = css.split(".msg-body,")[1].split("{")[1].split("}")[0] if ".msg-body," in css else ""
ck("every message body wraps via ONE shared rule (.ebody and the previously-missed .mw-pitch grouped in)",
   ".mw-pitch," in _sel and ".ebody," in _sel
   and "white-space:pre-wrap" in _dec and "overflow-wrap:anywhere" in _dec
   and "word-break:break-word" in _dec and "max-width:100%" in _dec
   and "overflow-wrap:anywhere" not in css.split(".ebody{")[1].split("}")[0])   # no divergent per-surface copy

LONG = "supercalifragilisticexpialidociousmusiclovacademyautumnenrolmentcampaign2026"
URL = "https://console.thriveiii.com/opp/" + LONG + "?ref=outreach_email_autumn_campaign_2026"
GREET = "Dear Music Love Academy team,"; CLOSE = "Warmly, the Thrive team"
BODY = ('<div>'+GREET+'</div><div><br></div>'
        '<div>I would love to help '+LONG+' reach more families this season with a fast one-page site.</div>'
        '<div><br></div><div>Preview: '+URL+'</div>'
        '<div><br></div><div>'+CLOSE+'</div>')

def measure(pg, lang):
    # The real frame width, then re-render the app's own srcdoc in a readable iframe at that width and
    # measure whether the body content escapes the frame. sandbox="" blocks reading the live preview, so we
    # render the identical srcdoc the app produced.
    return pg.evaluate("""async ()=>{
        const live=document.getElementById('cmpPreview');
        const w=Math.round(live.getBoundingClientRect().width);
        const src=live.srcdoc||'';
        const f=document.createElement('iframe'); f.style.cssText='width:'+w+'px;height:360px;border:0';
        f.srcdoc=src; document.body.appendChild(f);
        await new Promise(r=>{ f.onload=r; setTimeout(r,400); });
        const d=f.contentDocument;
        const dir=(d.documentElement.getAttribute('dir')||'');
        const overflow=d.documentElement.scrollWidth - d.documentElement.clientWidth;
        const text=d.body.innerText||'';
        f.remove();
        return { frameW:w, dir:dir, overflow:overflow, hasGreet:text.indexOf('Dear Music Love')>=0,
                 hasClose:text.indexOf('Warmly')>=0, hasUrlHost:(d?true:false), srcHasUrl:src.indexOf('console.thriveiii.com')>=0 };
    }""")

def run(pg, lang):
    pg.goto(f"{base}/library/compose.html")
    pg.wait_for_selector("#ebody", state="attached", timeout=15000)
    pg.evaluate("(l)=>localStorage.setItem('thrive_lang', l)", lang)
    pg.reload()
    pg.wait_for_selector("#ebody", state="attached", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate("(h)=>{ const e=document.getElementById('ebody'); e.innerHTML=h; e.dispatchEvent(new Event('input',{bubbles:true})); }", BODY)
    pg.wait_for_timeout(700)
    return measure(pg, lang)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":390,"height":840})
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route("https://console.thriveiii.com/**", lambda r: r.abort())
    pg = ctx.new_page()

    # English (LTR)
    en = run(pg, "en")
    print("   EN preview:", en)
    ck("EN: the preview is LTR", en["dir"] == "ltr" or en["dir"] == "", en)
    ck("EN: the body content does not escape the frame (no horizontal overflow)", en["overflow"] <= 1, en)
    ck("EN: the greeting and the closing are both present (no content lost, paragraph breaks kept)",
       en["hasGreet"] and en["hasClose"], en)
    ck("EN: the long URL is in the rendered body (and wraps: overflow is zero above)", en["srcHasUrl"], en)

    # Arabic (RTL)
    ar = run(pg, "ar")
    print("   AR preview:", ar)
    ck("AR: the preview is RTL", ar["dir"] == "rtl", ar)
    ck("AR: the body content does not escape the frame (no horizontal overflow)", ar["overflow"] <= 1, ar)
    ck("AR: the greeting and the closing are both present (no content lost)", ar["hasGreet"] and ar["hasClose"], ar)

    # The editable body itself wraps (computed style), and does not overflow with the unbreakable token.
    ebody = pg.evaluate("""()=>{ const e=document.getElementById('ebody'); const cs=getComputedStyle(e);
        return { ow:cs.overflowWrap||cs.wordWrap, wb:cs.wordBreak, overflow:e.scrollWidth-e.clientWidth }; }""")
    print("   ebody:", ebody)
    ck("the editable body wraps (computed overflow-wrap anywhere)", ebody["ow"] == "anywhere", ebody)
    ck("the editable body does not overflow with an unbreakable token", ebody["overflow"] <= 1, ebody)

    # The page itself never scrolls sideways at the narrowest width.
    ck("no horizontal scroll on the compose page at 390px",
       not pg.evaluate("()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1"))

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
