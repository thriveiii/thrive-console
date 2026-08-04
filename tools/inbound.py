"""WO-013 phase 1: replies arrive.

The defect this covers is the most expensive kind: a campaign was sent, the prospect replied, the
reply landed in Gmail, and the console's replies column read zero and always had. It loses revenue
silently and it looks like the prospects are quiet.

This drives a browser against a relay that answers `inbound_get` the way the real one does, and
asserts the whole path: attribution by each of the three rules, an unmatched reply surfaced rather
than dropped, machinery stored and not counted, the card moving through the lifecycle move with its
activity entry, the History tab showing the words and a working Gmail link, the hand path counting
identically, and the repair pass reporting before it writes.

Run it: python3 tools/inbound.py
"""
import threading, http.server, socketserver, functools, os, sys, json

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

# The records a v5 relay would have filed after scanning the inbox. Every rule is represented,
# including the two that must never move a card.
RECORDS = [
    {"gid": "g-tag", "threadId": "t1", "from": "owner@wise.example", "name": "Wise Owner",
     "subject": "Re: Wise Butterfly x Thrive", "ts": "2026-08-03T09:00:00Z",
     "snippet": "This looks good, can you call me Sunday", "kind": "reply", "rule": "tag",
     "opp": "wise-butterfly"},
    {"gid": "g-thread", "threadId": "t2", "from": "team@twofaces.example", "name": "Two Faces",
     "subject": "Re: your page", "ts": "2026-08-03T10:00:00Z",
     "snippet": "interested, what does it cost", "kind": "reply", "rule": "thread",
     "opp": "two-faces"},
    {"gid": "g-sender", "threadId": "t3", "from": "hello@ludic.example", "name": "",
     "subject": "Re: Ludic", "ts": "2026-08-03T11:00:00Z", "snippet": "not right now thanks",
     "kind": "reply", "rule": "sender", "opp": "ludic-lillian"},
    {"gid": "g-none", "threadId": "t4", "from": "stranger@nowhere.example", "name": "A Stranger",
     "subject": "about your work", "ts": "2026-08-03T12:00:00Z", "snippet": "saw your site",
     "kind": "reply", "rule": "none", "opp": ""},
    {"gid": "g-bounce", "threadId": "t5", "from": "mailer-daemon@googlemail.com", "name": "",
     "subject": "Delivery Status Notification (Failure)", "ts": "2026-08-03T09:05:00Z",
     "snippet": "550 5.1.1 the email account does not exist", "kind": "auto", "bounce": "hard",
     "rule": "none", "opp": "wise-butterfly"},
    {"gid": "g-ooo", "threadId": "t6", "from": "team@twofaces.example", "name": "",
     "subject": "Automatic reply: away until Monday", "ts": "2026-08-03T10:05:00Z",
     "snippet": "I am out of the office", "kind": "auto", "rule": "sender", "opp": "two-faces"},
]

STATE = {"puts": 0, "scans": 0, "repairs": []}


def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v5 (email + sync + analytics + inbox) is running.")
    d = json.loads(route.request.post_data or "{}")
    op = d.get("op")
    if op == "state_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None}))
    if op == "state_put":
        STATE["puts"] += 1
        return route.fulfill(status=200, body=json.dumps({"ok": True}))
    if op == "hits_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "events": []}))
    if op == "inbound_get":
        return route.fulfill(status=200, body=json.dumps(
            {"ok": True, "records": RECORDS,
             "scan": {"ts": "2026-08-03T12:30:00Z", "ms": 820, "found": 6, "added": 6}}))
    if op == "store_stats":
        return route.fulfill(status=200, body=json.dumps(
            {"ok": True, "migrated": True,
             "properties": {"bytes": 640, "limit": 512000, "pct": 0, "keys": 3,
                            "largest": [{"key": "SYNC_KEY", "bytes": 71}]},
             "drive": {"bytes": 190000, "fileId": "f1", "name": "thrive-console-store.json"}}))
    if op == "inbox_scan":
        STATE["scans"] += 1
        return route.fulfill(status=200, body=json.dumps({"ok": True, "added": 0, "scanned": 6}))
    if op == "inbox_repair":
        STATE["repairs"].append(bool(d.get("dryRun")))
        return route.fulfill(status=200, body=json.dumps(
            {"ok": True, "dryRun": bool(d.get("dryRun")), "count": 4, "auto": 2,
             "byRule": {"tag": 1, "thread": 1, "sender": 1, "none": 1}, "days": d.get("days")}))
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "x"}))


# A relay still on v4: it does not know inbound_get. That must be quiet, not an error on screen.
def relay_v4(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v4 (email + sync + analytics) is running.")
    d = json.loads(route.request.post_data or "{}")
    op = d.get("op")
    if op == "state_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None}))
    if op == "state_put":
        return route.fulfill(status=200, body=json.dumps({"ok": True}))
    if op == "hits_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "events": []}))
    return route.fulfill(status=200, body=json.dumps({"ok": False, "error": "unknown op: " + str(op)}))


SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'wise-butterfly',business:'Wise Butterfly',published:true,up:now},
  {slug:'two-faces',business:'2 Faces',published:true,up:now},
  {slug:'ludic-lillian',business:'Ludic Lillian',published:true,up:now},
  {slug:'quiet-one',business:'Quiet Co',published:true,up:now}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {mid:'m1',ts:iso(3),opp:'wise-butterfly',to:'owner@wise.example',toName:'Wise',status:'sent',direction:'out'},
  {mid:'m2',ts:iso(3),opp:'two-faces',to:'team@twofaces.example',toName:'Two',status:'sent',direction:'out'},
  {mid:'m3',ts:iso(3),opp:'ludic-lillian',to:'hello@ludic.example',toName:'Lil',status:'sent',direction:'out'},
  {mid:'m4',ts:iso(3),opp:'quiet-one',to:'q@quiet.example',toName:'Q',status:'sent',direction:'out'}]));
}"""


def session(b, lang="en", width=1280, r=relay):
    ctx = b.new_context(viewport={"width": width, "height": 900},
                        has_touch=(width <= 430), is_mobile=(width <= 430))
    ctx.route("**/exec", r)
    ctx.route("**/library/sync.json",
              lambda x: x.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(400)
    pg.evaluate("l=>localStorage.setItem('thrive_lang',l)", lang)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030")
        pg.click(".gate-btn")
        pg.wait_for_timeout(1400)
    pg.evaluate(SEED)
    pg.reload()
    pg.wait_for_timeout(3200)
    return ctx, pg, errs


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---------------- the pure model, in the browser that runs it -------------
    ctx, pg, errs = session(b)
    st = pg.evaluate("()=>ThriveInbound.selfTest()")
    ck("the attribution model passes its own test", st["pass"], st.get("failures"))

    # ---------------- the sync round pulls, merges and moves ------------------
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1600)
    n = pg.evaluate("()=>getInbound().length")
    ck("a sync round pulls the inbound records", n == len(RECORDS), n)

    lanes = pg.evaluate("""()=>{const o={};document.querySelectorAll('.tok[data-slug]').forEach(e=>
      o[e.dataset.slug]=e.closest('.lane').dataset.lane);return o}""")
    ck("a reply matched by the tag moves its card", lanes.get("wise-butterfly") == "replied", lanes)
    ck("a reply matched by the thread moves its card", lanes.get("two-faces") == "replied", lanes)
    ck("a reply matched by the sender moves its card", lanes.get("ludic-lillian") == "replied", lanes)
    ck("a card with no reply does not move", lanes.get("quiet-one") != "replied", lanes)

    acts = pg.evaluate("""()=>getActivity().filter(a=>a.action==='lc_record_reply')
      .map(a=>a.slug).sort()""")
    ck("each matched card moved through the lifecycle move, with its activity entry",
       acts == ["ludic-lillian", "two-faces", "wise-butterfly"], acts)

    # ---------------- machinery is stored, and moves nothing ------------------
    ck("a bounce is stored", pg.evaluate("()=>getInbound().some(r=>r.gid==='g-bounce')"))
    ck("an out of office is stored", pg.evaluate("()=>getInbound().some(r=>r.gid==='g-ooo')"))
    # 'quiet-one' had no reply at all; the two cards that DID have machinery also had a real reply,
    # so machinery is proven not to move a card by counting instead: three replies, not five.
    counted = pg.evaluate("""async ()=>{const c=await numberCtx(); return ThriveNumbers.replies(c);}""")
    ck("machinery does not count as a reply", counted == 3, counted)

    rr = pg.evaluate("""async ()=>{const c=await numberCtx(); return ThriveNumbers.replyRate(c);}""")
    ck("the reply rate carries its denominator", rr["num"] == 3 and rr["den"] == 4, rr)
    ck("a rate cannot exceed the whole", rr["pct"] <= 100, rr)

    # ---------------- idempotency --------------------------------------------
    before = pg.evaluate("()=>getInbound().length")
    pg.evaluate("()=>syncNow()")
    pg.wait_for_timeout(2200)
    after = pg.evaluate("()=>getInbound().length")
    ck("a second sync produces one record, not two", before == after, (before, after))
    counted2 = pg.evaluate("""async ()=>{const c=await numberCtx(); return ThriveNumbers.replies(c);}""")
    ck("and a second sync moves no count", counted2 == counted, (counted, counted2))

    # ---------------- the History tab ----------------------------------------
    pg.click(".tok[data-slug='wise-butterfly']")
    pg.wait_for_timeout(1400)
    pg.click("#modalTabs [data-tab='history']")
    pg.wait_for_timeout(900)
    h = pg.eval_on_selector("#modalHistory", "e=>e.innerText")
    ck("History names who replied", "Wise Owner" in h, h[:200])
    ck("History carries the subject", "Wise Butterfly x Thrive" in h, h[:200])
    ck("History carries the words they wrote", "call me Sunday" in h, h[:200])
    ck("History says which rule matched", "reply-to tag" in h, h[:200])
    link = pg.eval_on_selector_all("#modalHistory a[href*='mail.google.com']", "e=>e.map(x=>x.href)")
    ck("History deep links into Gmail", len(link) == 1 and "t1" in link[0], link)
    ck("and the bounce is shown, labelled, on the same tab", "not counted as a reply" in h, h[:300])
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(700)

    ck("nothing threw", not errs, errs[:3])
    ctx.close()

    # ---------------- the unmatched reply is named ---------------------------
    ctx, pg, errs = session(b)
    pg.evaluate("()=>location.hash='#settings'")
    pg.wait_for_timeout(2000)
    s = pg.eval_on_selector("#rpPanel", "e=>e.innerText")
    ck("an unmatched reply is named, not counted away", "could not match" in s, s[:300])
    ck("and the sender it came from is on screen", "stranger@nowhere.example" in s, s[:400])
    ck("the panel says when the inbox was last read", "Last inbox scan" in s, s[:200])

    # ---------------- §10.1, the store measurement ---------------------------
    pg.click("#rpStore")
    pg.wait_for_timeout(1500)
    out = pg.eval_on_selector("#rpOut", "e=>e.innerText")
    ck("the relay reports its Script properties bytes", "Script properties" in out, out[:300])
    ck("and the key count", "keys" in out, out[:300])
    ck("and the largest keys", "SYNC_KEY" in out, out[:300])
    ck("and whether the store has moved off properties", "moved off" in out, out[:300])

    # ---------------- the repair pass reports before it writes ---------------
    STATE["repairs"] = []
    pg.on("dialog", lambda d: d.dismiss())
    pg.click("#rpRepair")
    pg.wait_for_timeout(1800)
    out = pg.eval_on_selector("#rpOut", "e=>e.innerText")
    ck("the repair pass reports its count before writing", "4" in out and "written" in out, out[:300])
    ck("and it asked the relay for a dry run first",
       STATE["repairs"] and STATE["repairs"][0] is True, STATE["repairs"])
    ck("and dismissing the question writes nothing",
       STATE["repairs"] == [True], STATE["repairs"])
    ck("nothing threw in settings", not errs, errs[:3])
    ctx.close()

    # ---------------- the hand path counts identically -----------------------
    ctx, pg, errs = session(b, r=relay_v4)
    pg.evaluate("()=>location.hash='#board'")
    pg.wait_for_timeout(1600)
    ck("a relay still on v4 is quiet, not an error",
       pg.evaluate("()=>getInbound().length") == 0 and not errs, errs[:3])
    lanes = pg.evaluate("""()=>{const o={};document.querySelectorAll('.tok[data-slug]').forEach(e=>
      o[e.dataset.slug]=e.closest('.lane').dataset.lane);return o}""")
    ck("and nothing moved without evidence",
       all(v != "replied" for v in lanes.values()), lanes)

    hand = pg.evaluate("""async ()=>{
      await runMove('record_reply','two-faces',{replied_on:'2026-08-03',channel:'instagram',note:'DM'});
      const c=await numberCtx();
      const o=(await mergedOpps()).find(x=>x.slug==='two-faces');
      return { n:ThriveNumbers.replies(c), stage:ThriveLifecycle.stageOf(o),
               ch:o.reply_channel, note:o.reply_note };}""")
    ck("a reply on their own channel counts as a reply", hand["n"] == 1, hand)
    ck("and moves the card", hand["stage"] == "replied", hand)
    ck("and records the channel", hand["ch"] == "instagram", hand)
    ck("and the note", hand["note"] == "DM", hand)
    ck("nothing threw on the hand path", not errs, errs[:3])
    ctx.close()

    b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
