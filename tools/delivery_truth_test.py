"""The outreach state tells the delivery truth. Against realistic ledger, bounce, and open shapes (not
mocked-away ones): a hard bounce reads as Bounced and a soft as Failed, never Sent; opens are durable
and deduped and exclude the sender, and do not flicker whether the remote pull has landed or not;
Insights Last opened and Opens agree; and the double-send guard is in place. The live Resend and relay
are Thyab's device gate."""
import threading, http.server, socketserver, functools, os, json
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

# source guards
app_src=open(f"{ROOT}/library/app.js").read()
ck("the double-send guard exists on the send path", "cmp_dupe_block" in app_src and "getMailLog().some" in app_src)
ck("effStage reconciles a hard bounce to bounced and a soft to failed",
   'if(bounce==="hard") return "bounced"' in app_src and 'if(bounce==="soft") return "failed"' in app_src)
# WO-026: the delivery-truth contract begins at send time. The send path stamps a wire Message-ID and
# records the ledger row with the recipient and that id, so a reply threads and the state is truthful.
# The send was unified into one hardened function (relaySend); the durable row is written there, BEFORE
# the POST, carrying the recipient and the Message-ID, from both the outreach composer and the thread reply.
ck("a send records its ledger row with the recipient and a Message-ID at send time (relaySend, before the POST)",
   "const msgid=intent.msgid || newMessageId();" in app_src
   and 'to:to, toName:intent.toName||""' in app_src
   and 'status:"pending", idem:idem, msgid:msgid, chapter:' in app_src)

SENT_TS="2026-08-01T10:00:00Z"
OPPS=[
 {"slug":"d-good","business":"Good Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"d-bounce","business":"Bounce Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"d-soft","business":"Soft Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"d-open","business":"Open Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"d-self","business":"Self Co","_local":True,"published":True,"template":"en-opp1","up":1},
 {"slug":"d-preview","business":"Preview Co","_local":True,"published":True,"template":"en-opp1","up":1},
]
MAIL=[{"opp":s,"status":"sent","ts":SENT_TS,"to":s+"@x.com","subject":"Hi","mid":s} for s in
      ["d-good","d-bounce","d-soft","d-open","d-self","d-preview"]]
# bounces arrive as inbound auto records carrying the bounce grade (exactly what the relay writes)
INBOUND=[
 {"opp":"d-bounce","kind":"auto","bounce":"hard","ts":"2026-08-01T10:05:00Z","from":"mailer-daemon@x.com"},
 {"opp":"d-soft","kind":"auto","bounce":"soft","ts":"2026-08-01T10:05:00Z","from":"mailer-daemon@x.com"},
]
# opens: d-open has an after-send open in the REMOTE store only; d-self only the sender's own open;
# d-preview has an open BEFORE the send (a preview), which must not count.
REMOTE_HITS=[{"slug":"d-open","type":"open","vid":"v1","ip":"1","ts":"2026-08-02T10:00:00Z","self":False}]
LOCAL_HITS=[{"slug":"d-self","type":"open","vid":"s1","ip":"1","ts":"2026-08-02T10:00:00Z","self":True},
            {"slug":"d-preview","type":"open","vid":"p1","ip":"1","ts":"2026-07-30T10:00:00Z","self":False}]

def boot(ctx, remote_pulled):
    # WO-026 harness refresh: the old boot filled the password gate (#gateInput) to reveal the page, but
    # that UI flow no longer clears gate-locked in the sandbox and the fill hung for 30s. The gate is not
    # the subject here; the app boots and renders regardless of it, so we reveal the content by dropping the
    # gate-locked class. The delivery-truth assertions below are unchanged.
    pg=ctx.new_page(); pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.mergedOpps==='function'", timeout=15000)
    pg.evaluate("""(a)=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify(a.opps));
      localStorage.setItem('thrive_mail_v1', JSON.stringify(a.mail));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(a.inbound));
      localStorage.setItem('thrive_hits_v1', JSON.stringify(a.local));
      // remote store holds the collected open whether or not this session has re-pulled it
      localStorage.setItem('thrive_hits_remote_v1', JSON.stringify(a.remote));
      localStorage.setItem('thrive_endpoint_v1', 'https://relay.example/exec');   // collection is configured
    }""", {"opps":OPPS,"mail":MAIL,"inbound":INBOUND,"local":LOCAL_HITS,"remote":REMOTE_HITS})
    pg.reload()
    pg.wait_for_function("()=>typeof window.mergedOpps==='function' && typeof window.effStage==='function'", timeout=15000)
    pg.evaluate("()=>document.documentElement.classList.remove('gate-locked')")
    pg.wait_for_timeout(1000)
    return pg

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1440,"height":1000})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route("https://console.thriveiii.com/**", lambda r: r.fulfill(status=200, body="<html>live</html>"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body=json.dumps({"opportunities":[]})))
    pg=boot(ctx, False)

    eff=pg.evaluate("async()=>{ const os=await mergedOpps(); const m={}; os.forEach(o=>m[o.slug]=effStage(o)); return m; }")
    print("   effStage:", eff)
    ck("a hard bounce reads as bounced, never sent", eff.get("d-bounce")=="bounced", eff.get("d-bounce"))
    ck("a soft bounce reads as failed, never sent", eff.get("d-soft")=="failed", eff.get("d-soft"))
    ck("a clean send with no open stays sent", eff.get("d-good")=="sent", eff.get("d-good"))
    ck("an after-send open reads as opened even though only the remote store holds it (durable)", eff.get("d-open")=="opened", eff.get("d-open"))
    ck("the sender's own open does not count; the card stays sent", eff.get("d-self")=="sent", eff.get("d-self"))
    ck("an open before the send (a preview) does not count; the card stays sent", eff.get("d-preview")=="sent", eff.get("d-preview"))

    # determinism / no flicker: read effStage many times, it never changes
    stable=pg.evaluate("""async()=>{
      const os=await mergedOpps(); const o=os.find(x=>x.slug==='d-open');
      const seen={}; for(let i=0;i<8;i++){ invalidateHits && invalidateHits(); seen[effStage(o)]=1; }
      return Object.keys(seen);
    }""")
    ck("the opened card never flickers across repeated reads", stable==["opened"], stable)

    # board: bounced/failed are off the Sent lane, in the tray, counted distinctly
    board=pg.evaluate("""()=>{
      const lane={}; document.querySelectorAll('.tok[data-slug]').forEach(t=>lane[t.getAttribute('data-slug')]=t.getAttribute('data-lane'));
      const tray=[...document.querySelectorAll('#trayList .tray-item')].map(e=>({cls:e.className, t:e.textContent.trim()}));
      const sentCount=(document.querySelector('[data-count=\"sent\"]')||{}).textContent;
      return {lane, tray, sentCount};
    }""")
    print("   board:", board)
    ck("the bounced card is not on the board Sent lane", board["lane"].get("d-bounce") in (None,"",), board["lane"].get("d-bounce"))
    ck("the bounced card sits in the tray, marked bounced",
       any("bounced" in x["cls"] and "Bounce Co" in x["t"] for x in board["tray"]), board["tray"])
    ck("the failed card sits in the tray, marked failed",
       any("failed" in x["cls"] and "Soft Co" in x["t"] for x in board["tray"]), board["tray"])
    # six sends: one opened, one bounced, one failed excluded; the remaining three (no qualifying open) are Sent
    ck("the bounce and the soft failure are excluded from the Sent lane (3 real sends remain)", board["sentCount"]=="3", board["sentCount"])

    # library pills count bounced and failed distinctly
    pg.evaluate("()=>location.hash='#library'"); pg.wait_for_timeout(900)
    pills=pg.evaluate("""()=>{ const m={}; document.querySelectorAll('.pl-pill[data-stage-f]').forEach(p=>{ const b=p.querySelector('b'); m[p.getAttribute('data-stage-f')]=b?+b.textContent:null; }); return m; }""")
    print("   library pills:", pills)
    ck("the library counts one bounced and one failed", pills.get("bounced")==1 and pills.get("failed")==1, pills)

    # Insights: Last opened agrees with Opens (after-send). d-open: opens 1 with a time; d-preview: opens 0 and dash
    pg.evaluate("()=>location.hash='#home'"); pg.wait_for_timeout(1200)
    ins=pg.evaluate("""()=>{ const r={}; document.querySelectorAll('#homeCampaigns tbody tr').forEach(tr=>{
        const td=[...tr.children]; r[td[0].textContent.trim().replace(/\\s+\\(local\\)/,'')]={opens:td[3].textContent.trim(), last:td[td.length-1].textContent.trim()}; }); return r; }""")
    print("   insights:", ins)
    op=ins.get("Open Co",{}); ck("Insights: an after-send open shows Opens 1 and a Last opened time", op.get("opens")=="1" and op.get("last") not in ("–","",None), op)
    pv=ins.get("Preview Co",{}); ck("Insights: a pre-send preview shows Opens 0 and Last opened dash (they agree)", pv.get("opens")=="0" and pv.get("last")=="–", pv)
    ctx.close()

print("\n%d failed"%len(fails))
for f in fails: print("  -",f)
import sys; sys.exit(1 if fails else 0)
