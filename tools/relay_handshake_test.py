"""Reconcile the relay version handshake from both sides in the code. A relay reporting 5 (as the JSON
relay_version field, on any endpoint including the bare GET now) passes the console's check; a relay
reporting 4 fails it and the banner names both numbers; the legacy prose line still classifies. Also
assert the two constants agree: RELAY_VERSION (relay) equals REQUIRED_RELAY (console). The live /exec
cannot be reached from the sandbox, so the true pass is on Thyab's device."""
import threading, http.server, socketserver, functools, os, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# static: the one explicit contract, both constants agree
relay_src=open(f"{ROOT}/relay/thrive-relay.gs").read()
app_src=open(f"{ROOT}/library/app.js").read()
rv=int(re.search(r"RELAY_VERSION\s*=\s*(\d+)", relay_src).group(1))
rq=int(re.search(r"REQUIRED_RELAY\s*=\s*(\d+)", app_src).group(1))
ck(f"the relay constant RELAY_VERSION ({rv}) equals the console REQUIRED_RELAY ({rq})", rv==rq, (rv,rq))
ck("the relay stamps relay_version on every JSON response (json_ helper)", "o.relay_version = RELAY_VERSION" in relay_src)
ck("the relay bare GET now reports through json_ (relay_version present on the bare endpoint)",
   "return json_({ ok: true, service: 'Thrive relay'" in relay_src)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    pg=b.new_context().new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(500)
    if pg.query_selector("#thriveGate"): pg.fill("#gateInput","ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(500)

    def classify(body): return pg.evaluate("(s)=>classifyRelayBody(s)", body)
    # the explicit field, on the bare GET JSON the fixed relay now returns
    j5=json.dumps({"ok":True,"service":"Thrive relay","running":True,"relay_version":5})
    j4=json.dumps({"ok":True,"service":"Thrive relay","running":True,"relay_version":4})
    ck("a relay reporting relay_version 5 (JSON) reads as current", classify(j5).get("kind")=="current" and classify(j5).get("ver")==5, classify(j5))
    ck("a relay reporting relay_version 4 (JSON) reads as old, with the number named", classify(j4).get("kind")=="old" and classify(j4).get("ver")==4, classify(j4))
    # legacy prose fallback still classifies a pre-contract relay
    ck("legacy prose 'Thrive relay v5' still reads as current", classify("Thrive relay v5 is running.").get("kind")=="current")
    ck("legacy prose 'Thrive relay v4' still reads as old", classify("Thrive relay v4 is running.").get("kind")=="old")
    # a restricted deployment (Google sign-in HTML) is still its own case, not a version fault
    ck("a Google sign-in page is classified as signin, not a version", classify("<html>accounts.google.com ServiceLogin</html>").get("kind")=="signin")

    # the sync/send path reads the same field, and the banner names BOTH numbers on a mismatch
    r5=pg.evaluate("()=>{ noteRelayVersion({relay_version:5}); return { ready: relayReady(), banner: relayBannerText() }; }")
    ck("sync path: a relay reporting 5 is ready and shows no banner", r5.get("ready")==True and r5.get("banner")=="", r5)
    r4=pg.evaluate("()=>{ noteRelayVersion({relay_version:4}); return { ready: relayReady(), banner: relayBannerText() }; }")
    ck("sync path: a relay reporting 4 is not ready", r4.get("ready")==False, r4)
    ck("the mismatch banner names BOTH numbers (relay 4 and needs 5)",
       "4" in r4.get("banner","") and "5" in r4.get("banner",""), r4.get("banner"))
    print("     banner:", repr(r4.get("banner","")[:120]))
    # a relay that omits the field entirely (pre-contract) reads as older, honestly
    r0=pg.evaluate("()=>{ noteRelayVersion({ok:true}); return { ready: relayReady() }; }")
    ck("a relay that omits relay_version reads as not ready (older than the contract)", r0.get("ready")==False, r0)

print("\n%d failed"%len(fails))
for f in fails: print("  -",f)
import sys; sys.exit(1 if fails else 0)
