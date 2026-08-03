"""The lane truth regression, held against the four real opportunities.

On 2026-08-02 the live board said SENT 1 (2 Faces) and OPENED 3 (Wise Butterfly, Ludic
Lillian, thrive-july). Two of those four had ever been emailed. The board was reading the
manifest's page date as a send and every page view as an open.

This walks the shell with those exact records and asserts the truth: READY 2, SENT 0,
OPENED 2, the views of an unsent page still shown and not called opens, the library saying
the same thing as the board, a hand declaration still honoured, and the numbers one tap away.

Run it: python3 tools/lane-truth.py
"""
import sys
import threading, http.server, socketserver, functools, os, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; PORT = 8917
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]; httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
from playwright.sync_api import sync_playwright
base = f"http://127.0.0.1:{PORT}"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
EP = f"http://127.0.0.1:{PORT}/exec"
fails = []
def ck(n, c):
    print(("PASS" if c else "FAIL"), n)
    if not c: fails.append(n)

# The four real opportunities, exactly as the manifest carries them, and the two real sends.
# Page views on wise-butterfly happened with nothing sent; on ludic and thrive-july they
# happened after the send.
HITS = [
    {"type": "open", "slug": "wise-butterfly", "ts": "2026-07-30T11:00:00Z", "vid": "v1"},
    {"type": "open", "slug": "wise-butterfly", "ts": "2026-07-31T09:00:00Z", "vid": "v2"},
    {"type": "open", "slug": "wise-butterfly", "ts": "2026-08-01T09:00:00Z", "vid": "v3"},
    {"type": "open", "slug": "ludic-lillian",  "ts": "2026-07-29T10:00:00Z", "vid": "v4"},
    {"type": "open", "slug": "thrive-july",    "ts": "2026-08-01T10:00:00Z", "vid": "v5"},
]
MAIL = [
    {"mid": "m1", "ts": "2026-07-28T12:00:00Z", "opp": "ludic-lillian", "to": "a@b.com",
     "toName": "Lillian", "subject": "Ludic Lillian x Thrive", "templateId": "t1",
     "templateName": "Signal Brief", "status": "sent", "direction": "out"},
    {"mid": "m2", "ts": "2026-07-31T12:00:00Z", "opp": "thrive-july", "to": "c@d.com",
     "toName": "July", "subject": "thrive-july", "templateId": "t1",
     "templateName": "Signal Brief", "status": "sent", "direction": "out"},
]
SEED = """(d)=>{
 localStorage.setItem('thrive_hits_remote_v1', JSON.stringify(d.hits));
 localStorage.setItem('thrive_mail_v1', JSON.stringify(d.mail));
}"""

def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v4 (email + sync + analytics) is running.")
    d = json.loads(route.request.post_data or "{}")
    if d.get("op") == "state_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "data": None}))
    if d.get("op") == "hits_get":
        return route.fulfill(status=200, body=json.dumps({"ok": True, "events": HITS}))
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "x"}))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 390, "height": 880}, has_touch=True, is_mobile=True)
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json", lambda r: r.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
    pg.evaluate(SEED, {"hits": HITS, "mail": MAIL})
    pg.reload(); pg.wait_for_timeout(3000)

    counts = pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-count]')
        .forEach(e=>o[e.getAttribute('data-count')]=e.textContent.trim());return o}""")
    print("lane counts:", counts)
    lanes = pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-body]').forEach(e=>
        o[e.getAttribute('data-body')]=[...e.querySelectorAll('.tok')].map(t=>t.getAttribute('data-slug')));return o}""")
    print("lanes:", lanes)

    # ---- the reported failure ----
    ck("2 Faces is not in Sent", "2-faces" not in lanes["sent"])
    ck("Wise Butterfly is not in Opened", "wise-butterfly" not in lanes["opened"])
    ck("2 Faces sits in Ready", "2-faces" in lanes["live"])
    ck("Wise Butterfly sits in Ready", "wise-butterfly" in lanes["live"])
    ck("Ludic Lillian is in Opened", "ludic-lillian" in lanes["opened"])
    ck("thrive-july is in Opened", "thrive-july" in lanes["opened"])
    ck("Sent lane is empty, because nothing is awaiting an open", counts["sent"] == "0")
    ck("Ready holds two", counts["live"] == "2")
    ck("Opened holds two", counts["opened"] == "2")

    # ---- the views are not lost ----
    wb = pg.evaluate("""()=>{const t=[...document.querySelectorAll('.tok')]
        .find(x=>x.getAttribute('data-slug')==='wise-butterfly');return t?t.innerText:''}""")
    print("wise butterfly token:", repr(wb))
    ck("an unsent page still reports its views", "3" in wb)
    ck("and it does not call them opens", "open" not in wb.lower())

    # ---- the verdict follows the truth ----
    v = pg.evaluate("()=>document.getElementById('boardVerdict').innerText")
    print("verdict:", repr(v))
    ck("the verdict counts two readers, not three", v.strip().startswith("2"))

    # ---- the derivation layer agrees with itself ----
    st = pg.evaluate("()=>ThriveBoard.selfTest()")
    print("selfTest:", st)
    ck("stage-model self test passes", st["pass"])

    # ---- the library says the same thing ----
    pg.goto(f"{base}/library/console.html#library"); pg.wait_for_timeout(2200)
    pills = pg.evaluate("()=>[...document.querySelectorAll('.pl-pill')].map(e=>e.innerText.replace(/\\n/g,' '))")
    print("pills:", pills)
    ck("the library offers a Ready to send pill", any("Ready" in x for x in pills))
    ck("the library counts sent as zero", any(x.startswith("Sent 0") for x in pills))
    ck("the library counts opened as two", any(x.startswith("Opened 2") for x in pills))
    ck("nothing is asked to be followed up that was never sent",
       any(x.startswith("Needs follow-up 0") for x in pills))
    cards = pg.evaluate("()=>[...document.querySelectorAll('.card')].map(c=>c.innerText)")
    wbc = [c for c in cards if "Wise Butterfly" in c]
    print("wise card:", repr(wbc[0][:400]) if wbc else None)
    ck("the card labels an unsent page's views as views", wbc and "Views: 3" in wbc[0])
    ck("the card does not claim a send date it does not have", wbc and "Sent:" not in wbc[0])
    lud = [c for c in cards if "Ludic" in c]
    ck("a real send shows its send date", lud and "Sent: 2026-07-28" in lud[0])
    ck("a real send's views are opens", lud and "Opens: 1" in lud[0])

    # ---- the escape hatch: a message sent outside the console ----
    # Declaring a stage is a decision, and a decision outranks a derivation. Wise Butterfly was
    # emailed by hand, so saying so must move it, and its three views must become opens.
    st = pg.evaluate("""async ()=>{
      saveDraft({slug:'wise-butterfly', stage:'sent'});
      const o=(await mergedOpps()).find(x=>x.slug==='wise-butterfly');
      return { stage: effStage(o), opens: outreachOpens(o), fu: needsFollowup(o) };
    }""")
    print("declared:", st)
    ck("declaring a hand send is honoured", st["stage"] == "opened")
    ck("and its views become opens from the day it went out", st["opens"] == 3)
    st2 = pg.evaluate("""async ()=>{
      saveDraft({slug:'2-faces', stage:'sent'});
      const o=(await mergedOpps()).find(x=>x.slug==='2-faces');
      return { stage: effStage(o), fu: needsFollowup(o) };
    }""")
    print("declared unopened:", st2)
    ck("a hand send with no opens stays in sent", st2["stage"] == "sent")
    ck("and it is the one that needs following up", st2["fu"] is True)
    pg.evaluate("""()=>{ saveDraft({slug:'wise-butterfly', stage:''}); saveDraft({slug:'2-faces', stage:''}); }""")

    # ---- the numbers are one tap away ----
    nav = pg.evaluate("()=>[...document.querySelectorAll('.nav a')].map(a=>a.textContent.trim())")
    print("nav:", nav)
    ck("Insights is a destination in the bar", "Insights" in nav)
    ck("four destinations, no more", len(nav) == 4)
    pg.click(".nav a[data-view='home']"); pg.wait_for_timeout(2500)
    ck("the insights view opens", pg.eval_on_selector("#view-home", "e=>!e.hidden"))
    for sec in ("homeCampaigns", "homeTemplates", "homePeople", "homeTop"):
        txt = pg.eval_on_selector("#" + sec, "e=>e.innerText.trim()")
        ck(f"{sec} renders", len(txt) > 0)
    tpl = pg.eval_on_selector("#homeTemplates", "e=>e.innerText")
    print("templates:", repr(tpl[:300]))
    ck("per-template performance is present", "Signal Brief" in tpl)
    ppl = pg.eval_on_selector("#homePeople", "e=>e.innerText")
    ck("per-person response is present", "Lillian" in ppl or "a@b.com" in ppl)

    # ---- a message that went out through their own door ----------------------
    # Most of these businesses have no inbox. The message goes through the contact form on
    # their own site, by hand, and the console cannot witness that. What it can do is record
    # exactly what happened and attribute it correctly, and that is evidence of a send, so the
    # board moves. The device it was sent from has never been the question.
    pg.goto(f"{base}/library/console.html#board"); pg.wait_for_timeout(2600)
    off = pg.evaluate("""async ()=>{
      const o=(await mergedOpps()).find(x=>x.slug==='2-faces');
      recordOffChannelSend(o,'form','','through the form on their site');
      const o2=(await mergedOpps()).find(x=>x.slug==='2-faces');
      const row=getMailLog().filter(m=>m.opp==='2-faces').slice(-1)[0];
      return { stage:effStage(o2), count:sendsFor(o2).count, provider:row.provider,
               channel:row.channel, status:row.status, dir:row.direction, to:row.to };
    }""")
    print("off channel:", off)
    ck("a send through their own channel is a send", off["stage"] == "sent")
    ck("and it counts as one send, not as a bare declaration", off["count"] == 1)
    ck("the ledger records who witnessed it", off["provider"] == "manual")
    ck("and which door it went through", off["channel"] == "form")
    ck("it is outbound and it is sent", off["dir"] == "out" and off["status"] == "sent")
    ck("a send claimed for a future day is stamped now, not then",
       pg.evaluate("()=>offChannelStamp('2099-01-01').slice(0,4)") != "2099")
    ck("a send claimed for an earlier day keeps that day",
       pg.evaluate("()=>offChannelStamp('2026-01-05').slice(0,10)") == "2026-01-05")
    pg.reload(); pg.wait_for_timeout(2800)
    lanes2 = pg.evaluate("""()=>{const o={};document.querySelectorAll('[data-body]').forEach(e=>
        o[e.getAttribute('data-body')]=[...e.querySelectorAll('.tok')].map(t=>t.getAttribute('data-slug')));return o}""")
    print("lanes after the hand send:", lanes2)
    ck("the board moves it to Sent on that evidence", "2-faces" in lanes2["sent"])
    ck("and it is no longer sitting in Ready", "2-faces" not in lanes2["live"])

    # ---- the day's batch ------------------------------------------------------
    ck("the batch reader self test passes", pg.evaluate("()=>ThriveIntake.selfTest()")["pass"])
    ck("the board offers somewhere to drop the day's batch",
       pg.eval_on_selector("#intakeZone", "e=>!e.hidden") is True)
    # A batch lands in the first lane and nowhere else: nothing is published, nothing has been
    # sent, and any other lane would be a claim the record cannot support.
    added = pg.evaluate("""async ()=>{
      const rec=ThriveIntake.toRecord({business:'Gate Test Co', location:'Vienna', descriptor:'',
        channel:{kind:'form',to:'gatetest.example',note:''}, pageFile:'', slugHint:'gate-test-co',
        subject:'S', owner:'O', ownerNote:'', prohibition:'', message:'Hi [LINK]', warnings:[],
        file:{name:'g.html', html:'<h1>g</h1>'}}, {today:'2026-08-03'});
      rec.stage=''; rec.status='draft'; rec.published=false;
      saveDraft(rec);
      const o=(await mergedOpps()).find(x=>x.slug==='gate-test-co');
      return { stage:effStage(o), sends:sendsFor(o).count, kind:o.channel.kind, pitch:o.pitch.body };
    }""")
    print("batch record:", added)
    ck("a record from the batch starts in the first lane", added["stage"] == "draft")
    ck("and it claims no send", added["sends"] == 0)
    ck("it carries the channel the brief named", added["kind"] == "form")
    ck("and the words that came with it, link slot intact", "[LINK]" in added["pitch"])
    pg.evaluate("()=>removeDraft('gate-test-co')")

    ck("no page error", not errs)
    if errs: print(errs)
    b.close()

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
