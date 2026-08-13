"""The message body stays inside its frame, on EVERY surface, from one shared rule (WO-033).

The compose-preview body was fixed once (#118/#119) on the iframe and the editable .ebody, but the message
text still ran past the frame on the surfaces that render it as a <pre class="mw-pitch"> - the modal text
tab and the overview pitch. A bare <pre> keeps the UA default white-space:pre (no wrap), so a long line or
an unbreakable URL (the Botanologica body) clipped off the right. The earlier fix targeted the wrong
element on those surfaces.

The root, CSS only: ONE shared message-body rule (.msg-body, grouped with .mw-pitch, .ebody, the thread
reply body .rp-snip/.rp-msg/.rp-line/.rp-quoted-body, and .mprev) gives every surface the same wrapping -
white-space:pre-wrap, overflow-wrap:anywhere, word-break:break-word, max-width:100% - so the body wraps
inside the frame with paragraph breaks preserved and no surface keeps a divergent rule. This suite renders
the real Botanologica body on each surface, at three widths in both directions, and asserts it wraps
(computed white-space is pre-wrap) with zero horizontal overflow; the type is never shrunk.

WebKit at three widths is Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys, re
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

# ---- Source guard: one shared rule, every surface grouped in, no divergent per-surface wrapping ----
css = open(f"{ROOT}/library/styles.css").read()
sel = css.split(".msg-body,")[1].split("{")[0] if ".msg-body," in css else ""
dec = css.split(".msg-body,")[1].split("{")[1].split("}")[0] if ".msg-body," in css else ""
ck("one shared message-body rule carries all four wrapping properties",
   "white-space:pre-wrap" in dec and "overflow-wrap:anywhere" in dec
   and "word-break:break-word" in dec and "max-width:100%" in dec, dec)
for surf in [".mw-pitch", ".ebody", ".rp-snip", ".rp-msg", ".rp-line", ".rp-quoted-body", ".mprev"]:
    ck("the shared rule covers "+surf, surf+"," in (sel+",") or surf+"{" in (sel+"{"), sel)
# No surface keeps its own divergent wrapping copy. Remove the shared grouped block first, so the standalone
# rules (which end in `.mprev{`/`.ebody{`) are matched, not the shared rule's own trailing selector.
_shared_full = ".msg-body," + css.split(".msg-body,", 1)[1].split("}")[0] + "}"
css_solo = css.replace(_shared_full, "")
for surf in [".ebody{", ".mprev{"]:
    body = css_solo.split(surf)[1].split("}")[0]
    ck("no divergent wrapping remains on "+surf.strip("{"),
       "white-space:pre" not in body and "overflow-wrap" not in body, body)

# The Botanologica body: a long unbreakable token and a very long URL, in a message with paragraph breaks.
BODY = ("مرحباً فريق Botanologica،\n\n"
        "Loremipsumdolorsitametconsecteturadipiscingelitseddoeiusmodtemporincididuntutlaboreetdolore "
        "this is a deliberately very long single line that must wrap inside the frame and never clip off "
        "the right edge no matter how narrow the column gets.\n"
        "https://console.thriveiii.com/opp/botanologica-a-very-long-slug-" + ("x"*80) + "/page?ref=email\n\n"
        "مع خالص التحية،\nThrive")

# Render one body surface (its real class on its real element) into a width-constrained host and measure.
MEASURE = r"""
(a) => {
  const host = document.createElement('div');
  host.dir = a.dir;
  host.style.cssText = 'position:absolute;top:0;left:0;width:'+a.w+'px;max-width:'+a.w+'px;overflow:hidden';
  const el = document.createElement(a.el);
  el.className = a.cls; el.setAttribute('dir','auto');
  el.textContent = a.body;                       // textContent: escaped, exactly as the surfaces render it
  host.appendChild(el); document.body.appendChild(host);
  const cs = getComputedStyle(el);
  const r = { ws: cs.whiteSpace, over: el.scrollWidth - el.clientWidth,
              hostOver: host.scrollWidth - host.clientWidth,
              hasGreeting: el.textContent.indexOf('Botanologica')>=0,
              hasClosing: el.textContent.indexOf('خالص التحية')>=0 };
  host.remove(); return r;
}
"""

SURFACES = [
    ("mw-pitch", "pre", "modal text tab / overview pitch (the <pre> that clipped)"),
    ("ebody",    "div", "editable compose body"),
    ("mprev",    "div", "message preview snippet"),
    ("rp-msg",   "div", "thread reply body"),
]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context()
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.threadListHtml==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

    for cls, elname, label in SURFACES:
        for dir_ in ("ltr", "rtl"):
            for w in (320, 390, 768):
                r = pg.evaluate(MEASURE, {"cls": cls, "el": elname, "dir": dir_, "w": w, "body": BODY})
                ok = ("pre-wrap" in r["ws"]) and r["over"] <= 1 and r["hostOver"] <= 1 \
                     and r["hasGreeting"] and r["hasClosing"]
                ck(f"{label}: wraps in frame, no overflow ({dir_} @ {w}px)", ok, r)

    # The real thread body: threadListHtml renders the reply snippet into .rp-snip, measured in a real card.
    real = pg.evaluate("""(a)=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'bot',business:'Botanologica',published:true}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'m1',opp:'bot',to:'x@x.com',subject:'Re',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([{gid:'g1',opp:'bot',kind:'reply',from:'x@x.com',name:'X',subject:'Re',snippet:a.body,ts:'2026-08-03T09:00:00Z'}]));
      const host=document.createElement('div'); host.id='thb'; host.dir='rtl';
      host.style.cssText='position:absolute;top:0;left:0;width:320px;max-width:320px;overflow:hidden';
      host.innerHTML=window.threadListHtml('bot'); document.body.appendChild(host);
      const snip=host.querySelector('.rp-snip');
      const r={ over: snip? snip.scrollWidth-snip.clientWidth : -999, ws: snip?getComputedStyle(snip).whiteSpace:'',
                hostOver: host.scrollWidth-host.clientWidth };
      host.remove(); return r; }""", {"body": BODY})
    ck("the real thread reply body (.rp-snip via threadListHtml) wraps with no overflow at 320px",
       "pre-wrap" in real["ws"] and real["over"] <= 1 and real["hostOver"] <= 1, real)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
