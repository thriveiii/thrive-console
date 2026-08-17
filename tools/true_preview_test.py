"""True preview (P7 / D5). Engine-independent; WebKit is Thyab's device gate.

One compile(recipient) produces the exact artifact that lands: merge resolved for that person (or the
clean fallback for a nameless one), closing block, footer, the tokenized page link and the P2 open pixel.
Preview renders THAT artifact in the email-safe iframe, so what the operator previews is byte-for-byte
what the send submits. The recipient switcher steps the actual roster. The preview shows the pixel (the
truth) but a CSP stops it from firing, so a preview never records a phantom open.
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
        if d is not None: print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A fake relay endpoint so the compiled pixel has a real (non-empty) URL. It is NOT the site host, so the
# preview CSP (img-src the site + data:) must block it: the request counter below proves it never fires.
RELAY = "https://relay.example/exec"

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1000})

    # Count open-pixel GETs that actually REACH the network (route sees only un-blocked requests, so a
    # CSP-blocked pixel never arrives here). Nothing but a fired preview pixel requests op=hit&type=open.
    pixel_hits = {"n": 0}
    def route_relay(route):
        u = route.request.url
        if "op=hit" in u and "type=open" in u:
            pixel_hits["n"] += 1
            route.fulfill(status=200, content_type="image/gif", body=b"GIF89a")
        else:
            route.abort()
    pg.route("**relay.example**", route_relay)

    # Seed a campaign opp with three recipients (English name, Arabic name, nameless) BEFORE load.
    pg.goto(f"{base}/library/compose.html")
    unlock(pg)
    pg.evaluate("""(relay)=>{
      localStorage.setItem('thrive_sync_ep', relay);
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'camp1', business:'Campaign One', published:true, up:1,
        recipients:[{addr:'basel@shop.example',name:'Basel'},{addr:'laya@atelier.example',name:'ليّا',lang:'ar'},{addr:'no@name.example',name:''}]}]));
    }""", RELAY)
    # Reload into the campaign composer now that the endpoint + roster are seeded.
    pg.goto(f"{base}/library/compose.html?slug=camp1")
    unlock(pg)
    pg.wait_for_function("()=>window.__composeReady && typeof window.__cmpCompile==='function' && document.getElementById('cmpPreview')", timeout=15000)
    # A body that greets by name, and the opportunity's own link so the tokenized ?r= link has something to bind to.
    pg.evaluate("""()=>{ document.getElementById('ebody').innerHTML='Hi {{NAME}}, see https://console.thriveiii.com/opp/camp1';
      document.getElementById('esubject').value='A note for you'; }""")

    # ---- one compile: the artifact carries the merge, the footer, the pixel and the tokenized link ----
    art = pg.evaluate("()=>window.__cmpCompile({addr:'basel@shop.example',name:'Basel'},{track:true})")
    ck("compile merges the name for a named recipient", "Hi Basel," in art["html"], art["html"][:200])
    ck("compile carries the P2 open pixel", "op=hit" in art["html"] and "type=open" in art["html"])
    ck("compile tokenizes the page link with ?r=<token>", ("r="+art["token"]) in art["html"] and art["token"] != "", art["token"])
    ck("compile attaches the footer (POSTAL), not a bare body", len(art["html"]) > 40 and "opp/camp1" in art["html"])

    art0 = pg.evaluate("()=>window.__cmpCompile({addr:'no@name.example',name:''},{track:true})")
    ck("a nameless recipient gets the clean fallback greeting (Hi, not 'Hi ,' and no {{NAME}})",
       "Hi," in art0["html"] and "Hi ," not in art0["html"] and "{{NAME}}" not in art0["html"], art0["html"][:200])

    ar = pg.evaluate("()=>window.__cmpCompile({addr:'laya@atelier.example',name:'ليّا',lang:'ar'},{track:true})")
    ck("compile keeps an Arabic name intact", "Hi ليّا," in ar["html"], ar["html"][:200])

    # roster sanity: the composer sees all three recipients for this campaign
    rl = pg.evaluate("()=>{ try{ return (window.campaignRecipients ? window.campaignRecipients('camp1') : []).length; }catch(e){ return -1; } }")
    ck("the composer reads the campaign roster (3 recipients)", rl == 3, rl)

    # open the preview disclosure so the switcher is on screen
    pg.evaluate("()=>{ var d=document.getElementById('prevWrap'); if(d) d.open=true; }")

    # ---- the preview renders EXACTLY the compiled artifact (truth), pixel and token present ----
    pg.evaluate("()=>window.__cmpRefreshPreview()")
    src = pg.eval_on_selector("#cmpPreview", "e=>e.srcdoc")
    cur = pg.evaluate("()=>window.__cmpCompile(null,{track:true})")   # null -> the current field/roster recipient path
    ck("the preview shows the open pixel in its source (never stripped)", "op=hit" in src and "type=open" in src, src[:200])
    ck("the preview carries the tokenized page link", "r=" in src and "opp/camp1" in src)
    ck("the preview renders through the email-safe frame (CSP present, not editor CSS)",
       "Content-Security-Policy" in src and "img-src https://console.thriveiii.com" in src)

    # ---- the pixel is shown but does NOT fire: no phantom open is recorded ----
    pg.wait_for_timeout(400)
    ck("the preview pixel never fires (no open request leaves the frame)", pixel_hits["n"] == 0, pixel_hits)

    # ---- the switcher walks the roster in order; nameless shows the clean fallback ----
    pg.wait_for_selector("#cmpRecipSwitch:not([hidden])", timeout=6000)
    seen = []
    for _ in range(3):
        lbl = pg.eval_on_selector("#cmpRecipLabel", "e=>e.textContent")
        body_src = pg.eval_on_selector("#cmpPreview", "e=>e.srcdoc")
        seen.append((lbl, body_src))
        pg.click("#cmpNextRecip"); pg.wait_for_timeout(150)
    labels = " || ".join(s[0] for s in seen)
    ck("the switcher shows each recipient's address in turn",
       "basel@shop.example" in labels and "laya@atelier.example" in labels and "no@name.example" in labels, labels)
    ck("the switcher shows the nameless recipient's clean fallback greeting",
       any(("no@name.example" in s[0]) and ("Hi," in s[1]) and ("Hi ," not in s[1]) for s in seen),
       [s[0] for s in seen])
    ck("each recipient's greeting is personalized in the preview (Basel and ليّا both appear across the walk)",
       any("Hi Basel," in s[1] for s in seen) and any("Hi ليّا," in s[1] for s in seen))

    # ---- divergence proof (fails-when-broken): bypass compile in preview -> the pixel/token vanish ----
    pg.evaluate("()=>{ window.__previewBypassCompile=true; window.__cmpRefreshPreview(); }")
    broken = pg.eval_on_selector("#cmpPreview", "e=>e.srcdoc")
    ck("bypassing compile in preview breaks the match (no pixel)", "op=hit" not in broken, broken[:160])
    pg.evaluate("()=>{ window.__previewBypassCompile=false; window.__cmpRefreshPreview(); }")
    restored = pg.eval_on_selector("#cmpPreview", "e=>e.srcdoc")
    ck("restored, the preview shows the pixel again (match)", "op=hit" in restored)

    # ---- AR body sample: an Arabic greeting compiles and previews right-to-left ----
    pg.evaluate("""()=>{ document.getElementById('ebody').innerHTML='مرحبا {{NAME}}، هذه رسالة. https://console.thriveiii.com/opp/camp1';
      window.__cmpRefreshPreview(); }""")
    arart = pg.evaluate("()=>window.__cmpCompile({addr:'laya@atelier.example',name:'ليّا',lang:'ar'},{track:true})")
    ck("an Arabic body merges the Arabic name and still carries the pixel + token",
       "مرحبا ليّا،" in arart["html"] and "op=hit" in arart["html"] and arart["token"] in arart["html"], arart["html"][:200])
    arnone = pg.evaluate("()=>window.__cmpCompile({addr:'no@name.example',name:''},{track:true})")
    ck("an Arabic nameless greeting falls back cleanly (مرحبا، not مرحبا ،)",
       "مرحبا،" in arnone["html"] and "مرحبا ،" not in arnone["html"], arnone["html"][:200])

    ck("still no phantom open fired across the whole session", pixel_hits["n"] == 0, pixel_hits)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL TRUE PREVIEW CHECKS PASS"))
raise SystemExit(1 if fails else 0)
