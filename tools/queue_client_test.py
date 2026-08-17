"""The durable send queue's CLIENT (P8 / D6 + R3). Engine-independent; WebKit is Thyab's device gate.

Starting a campaign writes one console_mail row per recipient (status queued, a jittered due), gates the
day's budget at queue time (the tail defers visibly to the next window), and hands the batch to the relay;
the client never paces. Pause holds the tail (queued -> held); resume re-queues it with FRESH jitter.
Reconcile from the relay's status flips queued -> sent. A queued row is in-flight on the card and is never
counted as "sent". Proven here by driving the engine directly; the actual sending is the relay + Thyab's
device gate.
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

R5 = [{"addr":f"r{i}@shop.example","name":f"Name{i}","lang":""} for i in range(5)]

def unlock(pg):
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.evaluate("()=>{ var g=document.getElementById('thriveGate'); if(g) g.remove(); document.documentElement.classList.remove('gate-locked'); }")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(f"{base}/library/compose.html")
    unlock(pg)
    import json as _j
    pg.evaluate("""(recips)=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'camp1', business:'Campaign One', published:true, up:1, recipients:recips},
        {slug:'camp2', business:'Campaign Two', published:true, up:1, recipients:recips}]));
      localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_quota_v1','[]');
      localStorage.setItem('thrive_sync_ep','https://relay.example/exec');
    }""", R5)
    pg.reload(); unlock(pg)
    pg.wait_for_function("()=>typeof window.startCampaignQueue==='function' && typeof window.campaignStats==='function'", timeout=15000)

    TPL = {"subject":"A note for you", "html":"Hi {{NAME}}, see https://console.thriveiii.com/opp/camp1",
           "branded":False, "sig":"", "firstName":False, "month":"", "lang":"en"}

    # ---- Evidence 1: one row per recipient, jittered dues (no fixed beat), zero duplicates ----
    res = pg.evaluate("(tpl)=>window.startCampaignQueue('camp1', tpl)", TPL)
    ck("startCampaignQueue reports 5 recipients queued", res.get("n")==5, res)
    rows = pg.evaluate("""()=>window.getMailLog().filter(function(m){return m&&m.opp==='camp1'&&m.provider==='queue';})
        .map(function(m){return {to:m.to, status:m.status, due:m.due, mid:m.mid};})""")
    ck("exactly 5 queued console_mail rows, one per recipient (zero duplicates)",
       len(rows)==5 and len(set(r["to"] for r in rows))==5, [r["to"] for r in rows])
    ck("every row is status queued", all(r["status"]=="queued" for r in rows), [r["status"] for r in rows])
    ck("every row carries a per-recipient due timestamp", all(r["due"] for r in rows))
    import datetime
    def ms(iso): return datetime.datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()
    dues = sorted(ms(r["due"]) for r in rows)
    gaps = [round(dues[i+1]-dues[i],3) for i in range(len(dues)-1)]
    ck("the gaps between dues differ (randomized jitter, never a fixed beat)", len(set(gaps))>1, gaps)
    ck("the mid is the deterministic per-recipient open token (snd_ prefix)",
       all(str(r["mid"]).startswith("snd_") for r in rows), [r["mid"] for r in rows])

    # ---- a queued row is in-flight on the card and is NOT counted as sent ----
    ck("campaignStats.sent excludes queued rows (a queued row is not a send)",
       pg.evaluate("()=>window.campaignStats('camp1').sent")==0)
    ck("the card reads in-flight while the campaign is draining (cardSending true)",
       pg.evaluate("()=>window.cardState({slug:'camp1',lane:'sent'})")=="in-flight",
       pg.evaluate("()=>window.cardState({slug:'camp1',lane:'sent'})"))

    # ---- Evidence 3: pause holds the tail; resume re-queues it with FRESH jitter ----
    duesBefore = pg.evaluate("""()=>window.getMailLog().filter(function(m){return m&&m.opp==='camp1'&&m.provider==='queue';}).map(function(m){return m.due;})""")
    pg.evaluate("()=>window.pauseCampaign('camp1')")
    prog = pg.evaluate("()=>window.campaignProgress('camp1')")
    ck("pause holds the un-sent tail (queued -> held, none left queued)", prog["held"]==5 and prog["queued"]==0, prog)
    ck("the held rows are visible while paused (state paused)", prog["state"]=="paused", prog["state"])
    pg.evaluate("()=>window.resumeCampaign('camp1')")
    prog2 = pg.evaluate("()=>window.campaignProgress('camp1')")
    duesAfter = pg.evaluate("""()=>window.getMailLog().filter(function(m){return m&&m.opp==='camp1'&&m.provider==='queue';}).map(function(m){return m.due;})""")
    ck("resume re-queues the whole tail", prog2["held"]==0 and prog2["queued"]==5, prog2)
    ck("resume gives the tail FRESH jitter (dues changed)", sorted(duesBefore)!=sorted(duesAfter))

    # ---- reconcile from the relay's status flips queued -> sent (the finished truth) ----
    two = rows[:2]
    pg.evaluate("""(mids)=>window.reconcileOutbox(mids.map(function(m){return {mid:m, status:'sent', id:'x', sent_at:'2026-08-17T10:00:00Z'};}))""",
                [r["mid"] for r in two])
    ck("reconcile flips the sent rows and counts them as sent",
       pg.evaluate("()=>window.campaignStats('camp1').sent")==2, pg.evaluate("()=>window.campaignStats('camp1').sent"))

    # ---- Evidence 4: a campaign larger than today's budget defers the tail to the next window ----
    pg.evaluate("""()=>{ try{ if(typeof setQuotaCfg==='function') setQuotaCfg({daily:2, monthly:3000}); }catch(e){}
      localStorage.setItem('thrive_quota_v1','[]'); }""")
    res2 = pg.evaluate("(tpl)=>window.startCampaignQueue('camp2', Object.assign({},tpl))", TPL)
    ck("with a daily budget of 2, a 5-recipient campaign defers 3 to the next window",
       res2.get("deferred")==3, res2)
    now_s = pg.evaluate("()=>Date.now()")
    c2 = pg.evaluate("""()=>window.getMailLog().filter(function(m){return m&&m.opp==='camp2'&&m.provider==='queue';}).map(function(m){return m.due;})""")
    deferred = [d for d in c2 if ms(d)*1000 > now_s + 12*3600*1000]   # > 12h out = deferred to a later day
    ck("the deferred tail is due in the next window (>12h out)", len(deferred)==3, [len(c2), len(deferred)])

    # ---- nothing was actually sent from the client (the relay sends; the client only queued) ----
    ck("no row was marked sent by the client itself (only the relay/reconcile can)",
       pg.evaluate("()=>window.getMailLog().filter(function(m){return m&&m.opp==='camp2'&&m.status==='sent';}).length")==0)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL QUEUE CLIENT CHECKS PASS"))
raise SystemExit(1 if fails else 0)
