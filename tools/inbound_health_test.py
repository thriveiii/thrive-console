"""P22 UI: the join basis on the thread, and inbound silence made visible on the board.

Two halves, both driven against the real app.js:
  1. The join basis renders through the ONE derivation (ThriveInbound.joinBasis) in the thread. A
     DETERMINISTIC basis (a plus-address tag) reads inline with a certain mark; a HEURISTIC basis (a
     sender match) is a tap-open <details> that names itself a guess. Proven off window.threadListHtml,
     the same reliable path the other thread tests use (no modal boot).
  2. The board shows inbound health from the heartbeat: healthy is silent, a stale sweep shows a quiet
     "inbound delayed", a capped sweep or a reconciliation gap shows a loud "replies not filed". Proven
     through window.inboundHealth() and the #boardInbound badge, with the heartbeat injected.

Run: python3 tools/inbound_health_test.py
"""
import threading, http.server, socketserver, functools, os, sys, json

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]; httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"; EP = f"{base}/exec"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# a tag reply (deterministic) and a sender reply (heuristic), one each
RECORDS = [
    {"gid": "g-tag", "threadId": "t1", "from": "owner@wise.example", "name": "Wise Owner",
     "subject": "Re: Wise Butterfly x Thrive", "ts": "2026-08-03T09:00:00Z",
     "snippet": "this looks good", "kind": "reply", "rule": "tag", "opp": "wise-butterfly"},
    {"gid": "g-sender", "threadId": "t3", "from": "hello@ludic.example", "name": "Lil",
     "subject": "Re: Ludic", "ts": "2026-08-03T11:00:00Z", "snippet": "not right now",
     "kind": "reply", "rule": "sender", "opp": "ludic-lillian"},
]

def J(o):
    # the real relay stamps relay_version on every response (json_); the console gates sync on it, so the
    # mock must carry it. The console requires v5 (P22 is additive on the response shape, so a v5 relay
    # still serves it). The new inbound signals (everyMin/capped/gap) are injected in the health checks.
    o = dict(o); o["relay_version"] = 5
    return json.dumps(o)

def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v5 (email + sync + analytics + inbox) is running.")
    d = json.loads(route.request.post_data or "{}")
    op = d.get("op")
    if op == "state_get":  return route.fulfill(status=200, body=J({"ok": True, "data": None}))
    if op == "state_put":  return route.fulfill(status=200, body=J({"ok": True}))
    if op == "hits_get":   return route.fulfill(status=200, body=J({"ok": True, "events": []}))
    if op == "inbound_get":
        return route.fulfill(status=200, body=J(
            {"ok": True, "records": RECORDS,
             "scan": {"ts": "2026-08-03T12:30:00Z", "ms": 800, "found": 2, "added": 2, "everyMin": 15, "capped": False}}))
    if op == "inbox_reconcile":
        return route.fulfill(status=200, body=J({"ok": True, "gap": 0, "mailbox": 2, "filed": 2, "missing": []}))
    return route.fulfill(status=200, body=J({"ok": True, "id": "x"}))

SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'wise-butterfly',business:'Wise Butterfly',published:true,up:now},
  {slug:'ludic-lillian',business:'Ludic Lillian',published:true,up:now}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'m1',ts:iso(3),opp:'wise-butterfly',to:'owner@wise.example',toName:'Wise',status:'sent',direction:'out',msgid:'<cS1@thriveiii.com>'},
  {mid:'m3',ts:iso(3),opp:'ludic-lillian',to:'hello@ludic.example',toName:'Lil',status:'sent',direction:'out'}]));
}"""

def session(b, lang="en"):
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json", lambda x: x.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1400)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(3000)
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx, pg, errs = session(b)

    pg.evaluate("()=>location.hash='#board'"); pg.wait_for_timeout(1600)

    # ---- 1. the join basis, from the one derivation, in the thread ----
    tag = pg.evaluate("()=>window.threadListHtml && window.threadListHtml('wise-butterfly')") or ""
    ck("a deterministic (plus-address) reply shows a certain, inline basis",
       "rp-basis is-det" in tag and "reply-to address" in tag, tag[:400])
    ck("a deterministic basis is NOT a tap-open disclosure", "<details class=\"rp-basis is-det" not in tag)

    snd = pg.evaluate("()=>window.threadListHtml && window.threadListHtml('ludic-lillian')") or ""
    ck("a heuristic (sender) reply shows a tap-open disclosure marked heuristic",
       "details class=\"rp-basis is-heur" in snd and "sender address" in snd, snd[:400])

    # the one derivation agrees with the pure model
    jb = pg.evaluate("()=>({tag:ThriveInbound.joinBasis({rule:'tag'}), snd:ThriveInbound.joinBasis({rule:'sender'})})")
    ck("joinBasis: tag is deterministic plus-address", jb["tag"]["basis"] == "plus-address" and jb["tag"]["deterministic"] is True, jb)
    ck("joinBasis: sender is heuristic", jb["snd"]["basis"] == "sender" and jb["snd"]["deterministic"] is False, jb)

    # ---- 2. inbound health on the board ----
    now_iso = pg.evaluate("()=>new Date().toISOString()")
    # healthy: a fresh sweep -> no notice
    pg.evaluate("t=>window.__inboxScanSet({ts:t, everyMin:15, capped:false})", now_iso)
    pg.evaluate("()=>window.__inboxReconSet(null)")
    h = pg.evaluate("()=>window.inboundHealth()")
    ck("a fresh sweep is healthy (not delayed, no backlog)", h["delayed"] is False and h["backlog"] == 0, h)

    # stale: older than three intervals -> delayed
    pg.evaluate("()=>{const old=new Date(Date.now()-60*60000).toISOString(); window.__inboxScanSet({ts:old, everyMin:15, capped:false});}")
    h = pg.evaluate("()=>window.inboundHealth()")
    ck("a sweep older than three intervals is delayed", h["delayed"] is True and h["backlog"] == 0, h)
    pg.evaluate("()=>{ if(window.thriveBoardRefresh) thriveBoardRefresh('t'); }"); pg.wait_for_timeout(500)
    badge = pg.evaluate("""()=>{const e=document.getElementById('boardInbound');
      return e && !e.hidden ? {cls:e.className, txt:e.textContent} : null;}""")
    ck("the board shows a quiet 'inbound delayed' badge when the sweep is stale",
       badge and "inbound-delay" in badge["cls"], badge)

    # capped: a backlog the sweep could not clear -> loud
    pg.evaluate("t=>window.__inboxScanSet({ts:t, everyMin:15, capped:true})", now_iso)
    h = pg.evaluate("()=>window.inboundHealth()")
    ck("a capped sweep reports a backlog", h["backlog"] != 0, h)
    pg.evaluate("()=>{ if(window.thriveBoardRefresh) thriveBoardRefresh('t'); }"); pg.wait_for_timeout(500)
    badge = pg.evaluate("""()=>{const e=document.getElementById('boardInbound');
      return e && !e.hidden ? {cls:e.className, txt:e.textContent} : null;}""")
    ck("the board shows a loud backlog badge when the sweep is capped",
       badge and "inbound-gap" in badge["cls"], badge)

    # a reconciliation gap -> loud, with a count
    pg.evaluate("t=>window.__inboxScanSet({ts:t, everyMin:15, capped:false})", now_iso)
    pg.evaluate("()=>window.__inboxReconSet({gap:2, mailbox:5, filed:3})")
    h = pg.evaluate("()=>window.inboundHealth()")
    ck("a reconciliation gap is a backlog with its count", h["backlog"] == 2, h)

    ck("nothing threw", not errs, errs[:3])
    ctx.close(); b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
