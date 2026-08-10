"""The noise classifier folds automated bulk senders out of the human list (WO-027, Brief 3 secondary).

Independent of the reply-coherence root (the store/RLS/write divergence): this only decides noise-vs-human
for display, it attributes nothing. The live review found three automated senders sitting in the
"could not match" human list, cluttering the attach picker and burying the one real human reply (the
Alleghany RFP). This tightens inboundIsNoise for the unambiguous, human-safe cases and proves the real
human reply still surfaces. The genuinely ambiguous senders (a bare marketing address, a blanket
support@) are deliberately left human and raised, not pattern-hacked, so a real prospect is never hidden."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:200])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(300)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(400)
    pg.wait_for_function("()=>typeof window.inboundIsNoise==='function'", timeout=15000)

    def noise(frm, subj="hello", kind="reply"):
        return pg.evaluate("(a)=>window.inboundIsNoise({from:a[0], subject:a[1], kind:a[2]})", [frm, subj, kind])

    # ---- the three automated senders the review named are now folded into noise ----
    ck("the eVA leads summary sender (noreturn@cgieva.com) is noise, not human",
       noise("noreturn@cgieva.com", "eVA Leads Summary") is True)
    ck("the ESP performance-report sender (support@sender.net) is noise, not human",
       noise("support@sender.net", "Your weekly performance report") is True)

    # ---- the one real human reply still surfaces as human (never hidden by the tightening) ----
    ck("the Alleghany RFP reply (mmunsey@co.alleghany.va.us) stays human",
       noise("mmunsey@co.alleghany.va.us", "RFP response") is False)

    # ---- the conservative stance holds: a real person on gmail, and a prospect from support@theirco ----
    ck("a real person on gmail is never noise (Basel)",
       noise("alnajjarjawad97@gmail.com", "Re: من جد وجد") is False)
    ck("a prospect replying from support@ their own company domain stays human (not a blanket support@ ban)",
       noise("support@prospectco.com", "Re: our page") is False)

    # ---- existing automated cases still caught (no regression to the classifier) ----
    ck("no-reply / dmarc / mailer-daemon still noise",
       noise("no-reply@x.com") and noise("noreply-dmarc@google.com", "Report Domain: x") and
       noise("mailer-daemon@googlemail.com", "Delivery Status Notification", "auto"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL NOISE CLASSIFIER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
