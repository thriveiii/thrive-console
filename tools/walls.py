"""WO-013 phase 8: the walls, and the seams to build before you hit them.

Three foundations have hard ceilings that are not far away, and one of them has already been hit.
This asserts the seams exist, the guards work, and the numbers are read rather than assumed.

Run it: python3 tools/walls.py
"""
import threading, http.server, socketserver, functools, os, sys, json, re

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
EP = f"{base}/exec"

from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

SENT = []
def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v5 is running.")
    d = json.loads(route.request.post_data or "{}")
    op = d.get("op")
    if op == "send_stats":
        return route.fulfill(status=200, body=json.dumps({
            "ok": True,
            "scan": {"runs": 96, "avgMs": 41000, "perDay": 96, "dailyMinutes": 65,
                     "budgetMinutes": 90, "overBudget": True},
            "send": {"remainingToday": 97, "cap": 100, "tier": "consumer", "counts": "recipients"}}))
    if op:
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None, "events": [], "records": []}))
    SENT.append(d)
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "re_1"}))

SEED = """()=>{ const now=Date.now();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  { slug:'good', business:'Good Co', published:true, up:now, doc_lang:'EN', contact_tier:'A',
    channel:{kind:'email', to:'ok@good.example'}, owner:'A Name', outreach_text:'Hello there.' },
  { slug:'bad', business:'Bad Co', published:true, up:now, doc_lang:'EN', contact_tier:'A',
    channel:{kind:'email', to:'stop@bad.example'}, owner:'B Name', outreach_text:'Hello there.' }
 ]));
}"""


def session(b):
    ctx = b.new_context(viewport={"width": 1280, "height": 950})
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json",
              lambda x: x.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1400)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(3000)
    return ctx, pg, errs


def open_compose(pg, slug):
    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1300)
    pg.click(f".tok[data-slug='{slug}']"); pg.wait_for_timeout(1300)
    pg.click("#modalTabs [data-tab='outreach']"); pg.wait_for_timeout(1200)
    if pg.query_selector("#modalOutreach [data-path='email']"):
        pg.click("#modalOutreach [data-path='email']"); pg.wait_for_timeout(1800)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx, pg, errs = session(b)

    st = pg.evaluate("()=>ThriveStore.selfTest()")
    ck("the store and suppression model passes its own test", st["pass"], st.get("failures"))

    # ---- §10.4 one adapter, no feature code calling localStorage ----------
    ck("the adapter exists and measures usage",
       isinstance(pg.evaluate("()=>ThriveStore.usage().bytes"), int))
    ck("and it records the threshold at which the migration stops being optional",
       pg.evaluate("()=>ThriveStore.MIGRATE_AT_BYTES") == 3 * 1024 * 1024)
    ck("and IndexedDB is deliberately not built",
       pg.evaluate("()=>typeof indexedDB!=='undefined' && !/indexedDB/.test(String(ThriveStore.set))"))

    # ---- §10.5 suppression blocks a send, with the reason -----------------
    pg.evaluate("()=>ThriveStore.suppress('stop@bad.example','complaint')")
    open_compose(pg, "bad")
    SENT.clear()
    pg.click("#eSend"); pg.wait_for_timeout(1600)
    ck("a suppressed address is never written to", len(SENT) == 0, SENT[:1])
    toast = pg.evaluate("()=>{const t=document.getElementById('toast');return t?t.innerText:'';}")
    ck("and the console says so", "never-write" in toast, toast)
    ck("and says why", "spam" in toast, toast)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    if pg.query_selector("#threeWay"): pg.click("#threeWay [data-tw='2']"); pg.wait_for_timeout(600)

    # ---- a clean address still sends, with the headers and the footer -----
    open_compose(pg, "good")
    SENT.clear()
    pg.click("#eSend"); pg.wait_for_timeout(1800)
    ck("a clean address still sends", len(SENT) == 1, SENT[:1])
    if SENT:
        h = SENT[0].get("headers") or {}
        ck("List-Unsubscribe is on the message", "List-Unsubscribe" in h, list(h))
        ck("and List-Unsubscribe-Post, RFC 8058 one click",
           h.get("List-Unsubscribe-Post") == "List-Unsubscribe=One-Click", h)
        ck("and the reply-to tag the attribution needs",
           h.get("Reply-To", "").startswith("hi+good@"), h)
        ck("the physical address is in the footer", "Alexandria" in SENT[0].get("html", ""),
           SENT[0].get("html", "")[-260:])
        ck("and a one line opt out", "STOP" in SENT[0].get("html", ""),
           SENT[0].get("html", "")[-260:])
        ck("and both are in the plain text alternative too",
           "Alexandria" in SENT[0].get("text", "") and "STOP" in SENT[0].get("text", ""),
           SENT[0].get("text", "")[-200:])
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    if pg.query_selector("#threeWay"): pg.click("#threeWay [data-tw='2']"); pg.wait_for_timeout(600)

    # ---- bounces -----------------------------------------------------------
    r = pg.evaluate("""()=>({hard:ThriveStore.noteBounce('dead@x.example','hard'),
      s1:ThriveStore.noteBounce('slow@x.example','soft'),
      s2:ThriveStore.noteBounce('slow@x.example','soft'),
      deadOut:ThriveStore.isSuppressed('dead@x.example'),
      slowOut:ThriveStore.isSuppressed('slow@x.example')})""")
    ck("a hard bounce suppresses immediately", r["hard"]["action"] == "suppressed" and r["deadOut"], r)
    ck("a soft bounce retries once", r["s1"]["action"] == "retry_once", r)
    ck("and stops on the second", r["s2"]["action"] == "suppressed" and r["slowOut"], r)

    # ---- §10.7 the actor field --------------------------------------------
    acts = pg.evaluate("()=>getActivity().slice(-6).map(a=>a.actor)")
    ck("every activity entry carries an actor", acts and all(a == "thyab" for a in acts), acts)
    mails = pg.evaluate("()=>getMailLog().map(m=>m.actor)")
    ck("and every ledger entry does too", mails and all(m == "thyab" for m in mails), mails)

    # ---- the reputation panel ---------------------------------------------
    pg.evaluate("()=>location.hash='#settings'"); pg.wait_for_timeout(2200)
    rep = pg.eval_on_selector("#repPanel", "e=>e.innerText")
    ck("the panel shows sends this month", "Sent this month" in rep, rep[:250])
    ck("the hard bounce rate", "Hard bounce rate" in rep, rep[:250])
    ck("the complaint rate", "Complaint rate" in rep, rep[:250])
    ck("the suppression count", "never to write to again" in rep, rep[:250])
    ck("and a plain sentence on whether they are healthy",
       "healthy" in rep or "watching" in rep or "spam" in rep, rep[:250])
    ck("with the guidance behind the numbers", "0.1 percent" in rep, rep[:400])

    # ---- §10.2 and §10.3 read from the relay, never hardcoded -------------
    pg.click("#repRelay"); pg.wait_for_timeout(1600)
    out = pg.eval_on_selector("#repOut", "e=>e.innerText")
    ck("the account tier is shown", "consumer" in out, out[:250])
    ck("the cap is read from the relay", "100" in out, out[:250])
    ck("and it says the quota counts recipients, not messages",
       "recipients" in out, out[:250])
    ck("the scan's measured runtime is reported", "65" in out, out[:250])
    ck("and it says so plainly when it is past an hour a day",
       "past an hour" in out, out[:300])

    ck("nothing threw", not errs, errs[:3])
    ctx.close(); b.close()

httpd.shutdown()

# ---- the seam: no feature code reaches around the adapter ------------------
# The console predates the adapter, so app.js still holds the pre existing calls. What must be
# true is that everything ADDED for the seam goes through it, and that the modules written in
# this round never touch localStorage directly.
# store.js is the adapter itself, so it is the one file that legitimately holds the
# call. Every other module written in this round has to go through it.
for mod in ("flows.js", "kinds.js", "inbound.js", "drafts.js"):
    src = open(os.path.join(ROOT, "library", mod), encoding="utf-8").read()
    hits = [l for l in src.split("\n")
            if "localStorage" in l and "typeof localStorage" not in l]
    ck(f"library/{mod} never calls localStorage directly", not hits, hits[:3])

# ---- the documents §10 requires --------------------------------------------
for doc, needles in (
    ("docs/DELIVERABILITY.md", ["separate sending subdomain", "0.1 percent", "Alexandria",
                                "would be a mistake"]),
    ("docs/RUNWAY.md", ["IndexedDB", "second workspace", "Multiple users", "Board search",
                        "Automatic archiving", "separate outreach sending domain",
                        "Moving off Apps Script", "actor"]),
    ("docs/RELAY.md", ["re-authoris", "One deployment", "rollback", "attribution order"]),
):
    s = open(os.path.join(ROOT, doc), encoding="utf-8").read()
    missing = [n for n in needles if n.lower() not in s.lower()]
    ck(f"{doc} records what §10 asks it to", not missing, missing)

runway = open(os.path.join(ROOT, "docs", "RUNWAY.md"), encoding="utf-8").read()
rows = [l for l in runway.split("\n") if l.startswith("| **") and "|" in l]
ck("all seven deferred capabilities carry a trigger", len(rows) >= 7, len(rows))

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
