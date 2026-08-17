"""Compile parity, on the ONE compile path (P9 / D8).

P9 collapsed the two P8-era compile entry points into a single compile(recipient, content). This test proves
the collapse did not regress the property that mattered: a single send and a campaign row still produce
BYTE-IDENTICAL output (subject, html, text, open token) for the same recipient and content -- now because
there is literally one compile function, fed by two content builders (the composer's editorContent for a
single send, the queue's campaignContent for a campaign row). Both builders are exercised here against the
real, live editor; if they diverge, the byte comparison reds.

Engine-independent; WebKit is Thyab's device gate.
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

# ---- source: there is exactly ONE compile function, and the P8 second path is gone --------------------
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("exactly ONE compile function exists (compile), P8's second entry points are deleted",
   app.count("function compile(") == 1
   and "function compileCampaignRow(" not in app and "function composeArtifactCore(" not in app)
ck("the footer/pixel/token live in that one place only (P7's count==1 restored)",
   app.count("ThriveStore.footerHtml") == 1 and app.count("ThriveStore.footerText") == 1)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

RELAY = "https://relay.example/exec"

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    pg.route("**relay.example**", lambda r: r.fulfill(status=200, content_type="image/gif", body=b"GIF89a"))

    pg.goto(f"{base}/library/compose.html")
    unlock(pg)
    pg.evaluate("""(relay)=>{
      localStorage.setItem('thrive_sync_ep', relay);
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'camp1', business:'Campaign One', published:true, up:1,
        recipients:[{addr:'basel@shop.example',name:'Basel Haddad'},{addr:'no@name.example',name:''}]}]));
    }""", RELAY)
    pg.goto(f"{base}/library/compose.html?slug=camp1")
    unlock(pg)
    pg.wait_for_function("()=>window.__composeReady && typeof window.__cmpCompile==='function' "
                         "&& typeof window.__compile==='function' && typeof window.__campaignContent==='function' "
                         "&& typeof window.__campaignTpl==='function'", timeout=15000)
    pg.evaluate("""()=>{ document.getElementById('ebody').innerHTML='Hi {{NAME}}, welcome. See https://console.thriveiii.com/opp/camp1 for details.';
      document.getElementById('esubject').value='A note for you'; }""")

    OPP = {"slug": "camp1", "business": "Campaign One"}

    def both(addr, name):
        # single send: the composer's editorContent -> the one compile
        single = pg.evaluate("(r)=>window.__cmpCompile({addr:r.addr,name:r.name},{track:true})",
                             {"addr": addr, "name": name})
        # campaign row: the queue's REAL campaignContent(o, __campaignTpl()) -> the same one compile
        campaign = pg.evaluate("(a)=>window.__compile({addr:a.addr,name:a.name}, window.__campaignContent(a.opp, window.__campaignTpl()))",
                              {"opp": OPP, "addr": addr, "name": name})
        return single, campaign

    s, c = both("basel@shop.example", "Basel Haddad")
    ck("named: a real artifact is produced (footer + pixel + tokenized link + token)",
       ("op=hit" in s["html"]) and (s["token"] != "") and (("r="+s["token"]) in s["html"]) and ("opp/camp1" in s["html"]),
       s["html"][:200])
    ck("named: SUBJECT is byte-identical (single vs campaign)", s["subject"] == c["subject"], (s["subject"], c["subject"]))
    ck("named: HTML is byte-identical (single vs campaign)", s["html"] == c["html"],
       {"single_tail": s["html"][-160:], "camp_tail": c["html"][-160:]})
    ck("named: plain-text is byte-identical (single vs campaign)", s["text"] == c["text"])
    ck("named: the deterministic open token is identical", s["token"] == c["token"], (s["token"], c["token"]))

    s0, c0 = both("no@name.example", "")
    ck("nameless: the fallback greeting is clean (Hi, not 'Hi ,' and no {{NAME}})",
       ("Hi," in s0["html"]) and ("Hi ," not in s0["html"]) and ("{{NAME}}" not in s0["html"]), s0["html"][:200])
    ck("nameless: HTML is byte-identical (single vs campaign)", s0["html"] == c0["html"],
       {"single_tail": s0["html"][-160:], "camp_tail": c0["html"][-160:]})
    ck("nameless: plain-text is byte-identical (single vs campaign)", s0["text"] == c0["text"])
    ck("nameless: the token is identical", s0["token"] == c0["token"], (s0["token"], c0["token"]))

    # sensitivity: the comparison is real, not comparing constants
    ck("a different recipient produces different bytes", s["html"] != s0["html"])
    ck("a different recipient produces a different token", s["token"] != s0["token"])

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL COMPILE PARITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
