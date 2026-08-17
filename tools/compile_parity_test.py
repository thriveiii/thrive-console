"""Compile parity (the P8 gate for the two-path window).

P7's single-send composer (compileArtifact) and P8's campaign composer (compileCampaignRow) are two entry
points that coexist BY DESIGN until P9 collapses them into one. This test is the hard gate on that window: it
proves the two paths do NOT duplicate the compose logic -- for the SAME recipient and the SAME authored
content they produce BYTE-IDENTICAL output (subject, html, text, token), because both compose through the one
shared composeArtifactCore (the single place the footer, the tokenized page link, the open pixel and the
deterministic open token are attached).

Engine-independent; WebKit is Thyab's device gate. If this test fails, the two paths have diverged and P8 must
not merge.
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

RELAY = "https://relay.example/exec"

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    pg.route("**relay.example**", lambda r: r.fulfill(status=200, content_type="image/gif", body=b"GIF89a"))

    # A campaign opp with an English-named recipient and a nameless one. Compile lang is the composer's
    # direction (EN here), so we compare recipients whose language matches the composer -- the honest
    # "same recipient and content" scenario. (A recipient's own language only changes which footer the
    # campaign path selects; that is a by-design INPUT to the shared core, not duplicated logic.)
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
                         "&& typeof window.compileCampaignRow==='function' && typeof window.__campaignTpl==='function'",
                         timeout=15000)
    # Author a body that greets by name and carries the opportunity's own link (so the tokenized ?r= link and
    # the pixel have something to bind to), plus a subject.
    pg.evaluate("""()=>{ document.getElementById('ebody').innerHTML='Hi {{NAME}}, welcome. See https://console.thriveiii.com/opp/camp1 for details.';
      document.getElementById('esubject').value='A note for you'; }""")

    # The REAL campaign template the #eCampaign handler would capture (one builder, shared with the queue).
    OPP = {"slug": "camp1", "business": "Campaign One"}

    def both(addr, name):
        single = pg.evaluate("(r)=>window.__cmpCompile({addr:r.addr,name:r.name},{track:true})",
                             {"addr": addr, "name": name})
        campaign = pg.evaluate("(a)=>window.compileCampaignRow(a.opp, {addr:a.addr,name:a.name}, window.__campaignTpl())",
                              {"opp": OPP, "addr": addr, "name": name})
        return single, campaign

    # ---- named recipient: the two paths are byte-identical ----
    s, c = both("basel@shop.example", "Basel Haddad")
    ck("named: the single send and the campaign row carry a real artifact (footer + pixel + tokenized link + token)",
       ("op=hit" in s["html"]) and (s["token"] != "") and (("r="+s["token"]) in s["html"]) and ("opp/camp1" in s["html"]),
       s["html"][:200])
    ck("named: SUBJECT is byte-identical", s["subject"] == c["subject"], (s["subject"], c["subject"]))
    ck("named: HTML is byte-identical (footer, tokenized link, open pixel, merged name all match)",
       s["html"] == c["html"], {"single_tail": s["html"][-160:], "camp_tail": c["html"][-160:]})
    ck("named: plain-text alternative is byte-identical", s["text"] == c["text"],
       {"single_tail": s["text"][-120:], "camp_tail": c["text"][-120:]})
    ck("named: the deterministic open token is identical", s["token"] == c["token"], (s["token"], c["token"]))

    # ---- nameless recipient: the clean fallback is byte-identical too ----
    s0, c0 = both("no@name.example", "")
    ck("nameless: the fallback greeting is clean (Hi, not 'Hi ,' and no {{NAME}})",
       ("Hi," in s0["html"]) and ("Hi ," not in s0["html"]) and ("{{NAME}}" not in s0["html"]), s0["html"][:200])
    ck("nameless: HTML is byte-identical across the two paths", s0["html"] == c0["html"],
       {"single_tail": s0["html"][-160:], "camp_tail": c0["html"][-160:]})
    ck("nameless: plain-text is byte-identical across the two paths", s0["text"] == c0["text"])
    ck("nameless: the token is identical", s0["token"] == c0["token"], (s0["token"], c0["token"]))

    # ---- sensitivity (the comparison is real, not comparing constants): a different recipient DIFFERS ----
    ck("a different recipient produces different bytes (named vs nameless html differ)", s["html"] != s0["html"])
    ck("a different recipient produces a different token", s["token"] != s0["token"])

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL COMPILE PARITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
