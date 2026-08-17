"""One composer: the console composes the full body with the correct footer, the relay is a courier.

The footer "Alexandria, Egypt" shipped from an older relay after #79 fixed the console's footer, because
the footer was composed in two places. This proves the root fix: the console attaches the footer in ONE
place (compileArtifact, from the POSTAL source), both send paths use it, and the relay composes no footer of its
own.

Part 1 reads the source: the relay sendMail_ forwards d.html/d.text verbatim and writes no footer or
address; both console send payloads build their body from the one compileArtifact helper, which appends the
POSTAL footer. Part 2 drives the real self-send in Chromium (the device-gate path, "send to myself"),
captures the body the console hands the relay, and asserts it carries the correct footer and never
"Egypt".

The sandbox cannot send through Resend or run Apps Script, so the live confirmation is Thyab's send. This
proves the body the console produces and that the relay adds nothing to it."""
import threading, http.server, socketserver, functools, os, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
CORRECT = "Thrive Digital Solutions, VA, USA"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:300])

# ---- Part 1: source ----------------------------------------------------------
relay = open(os.path.join(ROOT, "relay/thrive-relay.gs")).read()
send = relay[relay.index("function sendMail_"): relay.index("function json_")]
ck("the relay send path forwards the console html verbatim", "html: d.html" in send)
ck("the relay send path forwards the console text verbatim", "payload.text = d.text" in send)
# Strip comments: the courier comment names Egypt/Alexandria to forbid them, exactly as the store
# self-test does. The guarantee is that no address is composed in CODE.
send_code = re.sub(r"/\*.*?\*/", "", send, flags=re.S)
send_code = re.sub(r"//.*", "", send_code)
ck("the relay composes no footer or address in code (no Egypt, no address string, no footer div)",
   ("Egypt" not in send_code) and ("Digital Solutions" not in send_code) and ("Alexandria" not in send_code) and ("border-top" not in send_code),
   send_code[:200])

app = open(os.path.join(ROOT, "library/app.js")).read()
# P7 gave the console one compile(recipient)=compileArtifact for single send + preview; P8 added a campaign
# entry point, compileCampaignRow. Both now route their body through the ONE shared composeArtifactCore, which
# is the SINGLE place the POSTAL footer, the tokenized page link, the open pixel, and the idem/open token are
# attached. So the footer is composed in EXACTLY ONE place (composeArtifactCore) and neither entry point
# re-implements it -- no hand-written footer or address string anywhere. (Two entry points coexist by design
# until P9 collapses them into one; the compile logic is already shared, proven byte-identical by
# tools/compile_parity_test.py.)
ck("the console composes the outgoing body through the one shared core, attaching the POSTAL footer",
   "function composeArtifactCore(" in app and "ThriveStore.footerHtml(lang)" in app and "ThriveStore.footerText(lang)" in app)
ck("both single-send payloads build their body from compileArtifact (self-send and real send)",
   len(re.findall(r"compileArtifact\(fieldRecipient\(\)", app)) >= 2 and app.count("html:sb.html") >= 1)
ck("the footer is attached in EXACTLY ONE place (only composeArtifactCore appends it)",
   app.count("ThriveStore.footerHtml") == 1 and app.count("ThriveStore.footerText") == 1)
ck("both compile entry points route through the one shared core (no duplicated footer/link/pixel/token logic)",
   "function compileArtifact(" in app and "function compileCampaignRow(" in app
   and len(re.findall(r"composeArtifactCore\(\{", app)) >= 2)

# ---- Part 2: the real self-send body, in Chromium ---------------------------
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

CAP = r"""
() => {
  window.__sent = null;
  window.__real_fetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('relay.example') >= 0) {
        window.__sent = JSON.parse(opts.body);
        return new Response(JSON.stringify({ ok:true, id:'test', relay_version:5 }), {status:200});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/compose.html?slug=vsd")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_selector("#ebody", timeout=15000)
    pg.evaluate(CAP)
    pg.evaluate("() => localStorage.setItem('thrive_email_ep','https://relay.example/exec')")
    pg.click("#ebody"); pg.keyboard.type("Hi Deborah, congratulations on the new shop.")
    pg.wait_for_timeout(200)
    pg.click("#eSelf")
    pg.wait_for_function("() => window.__sent !== null", timeout=8000)
    sent = pg.evaluate("() => window.__sent")
    html = sent.get("html", ""); text = sent.get("text", "")
    ck("the self-send body the console hands the relay carries the correct footer (html)", CORRECT in html, html[-200:])
    ck("the self-send html never says Egypt", "Egypt" not in html)
    ck("the self-send plain-text alternative carries the correct footer", CORRECT in text, text[-160:])
    ck("the self-send plain-text alternative never says Egypt", "Egypt" not in text)
    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL RELAY COURIER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
