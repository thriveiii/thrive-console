"""Campaigns Phase 1 (D1): recipient-level ground truth. Engine-independent; WebKit is Thyab's device gate.

Seeds a thrive-july campaign whose recipients carry every per-address state that IS attributable - a
plain send, a reply, a bounce, and a nameless recipient - then asserts the additive companion read
campaignRecipientLedger returns exactly one truthful row per recipient. Proves D2 holds (a recipient's
reply never lifts the campaign to Replied: effStage stays the aggregate), lane equals detail
(the ledger's replied recipient matches recipientState), and the read is stable across ten reads.

Opens are deliberately NOT per recipient (one page, anonymous vid, no recipient token); the ledger
carries no per-recipient open field, and this test asserts that absence, per the no-invented-state law.
"""
import threading, http.server, socketserver, functools, os, json
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

# thrive-july: four recipients. tracy replied; lea bounced; omar was sent, no reply; the nameless one
# was sent too. One console_mail row per recipient (opp = campaign slug, to = recipient). A reply from
# tracy and a hard bounce naming lea. Arabic and English names, to prove names survive intact.
SEED = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'thrive-july', business:'Thrive July', published:true, up:1, recipients:[
      { addr:'tracy@shop.example', name:'Tracy Bell', lang:'en' },
      { addr:'lea@atelier.example', name:'ليّا نديم', lang:'ar' },
      { addr:'omar@studio.example', name:'عمر خالد', lang:'ar' },
      { addr:'nobody@plain.example', name:'', lang:'en' }
    ] }
  ]);
  set('thrive_mail_v1', [
    { mid:'m1', opp:'thrive-july', to:'tracy@shop.example', toName:'Tracy Bell', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:00:00Z' },
    { mid:'m2', opp:'thrive-july', to:'lea@atelier.example', toName:'ليّا نديم', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:01:00Z' },
    { mid:'m3', opp:'thrive-july', to:'omar@studio.example', toName:'عمر خالد', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:02:00Z' },
    { mid:'m4', opp:'thrive-july', to:'nobody@plain.example', toName:'', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:03:00Z' }
  ]);
  set('thrive_inbound_v1', [
    { gid:'rep1', opp:'thrive-july', kind:'reply', from:'tracy@shop.example', name:'Tracy Bell', subject:'Re: July', snippet:'yes please', ts:'2026-07-03T09:00:00Z' },
    { gid:'bnc1', opp:'thrive-july', kind:'auto', bounce:'hard', subject:'Delivery failed', snippet:'550 lea@atelier.example mailbox unavailable', ts:'2026-07-01T10:05:00Z' }
  ]);
  set('thrive_hits_v1', [
    { type:'open', slug:'thrive-july', ts:'2026-07-02T12:00:00Z', vid:'v1' },
    { type:'open', slug:'thrive-july', ts:'2026-07-02T13:00:00Z', vid:'v2' }
  ]);
  set('thrive_card_seen_v1', {});
})()
"""

def enter(pg):
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.campaignRecipientLedger==='function' && typeof window.effStage==='function' && typeof window.recipientState==='function' && typeof window.getDraft==='function'", timeout=15000)
    pg.evaluate("(s)=>{ eval(s); }", SEED)
    pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    enter(pg)

    led = pg.evaluate("()=>window.campaignRecipientLedger('thrive-july')")
    by = { r["addr"]: r for r in led }

    # ---- one row per recipient, no loss, no duplication ----
    ck("the ledger returns exactly one row per recipient (4)", len(led) == 4, [r["addr"] for r in led])
    ck("no recipient appears twice", len(by) == 4, list(by.keys()))

    # ---- each per-address signal is truthful ----
    ck("tracy: sent + replied, with a reply link",
       bool(by.get("tracy@shop.example")) and by["tracy@shop.example"]["sent"] and by["tracy@shop.example"]["replied"] and by["tracy@shop.example"]["reply_link"],
       by.get("tracy@shop.example"))
    ck("lea: sent + bounced, not replied",
       bool(by.get("lea@atelier.example")) and by["lea@atelier.example"]["bounced"] and not by["lea@atelier.example"]["replied"],
       by.get("lea@atelier.example"))
    ck("omar: sent, no reply, no bounce",
       bool(by.get("omar@studio.example")) and by["omar@studio.example"]["sent"] and not by["omar@studio.example"]["replied"] and not by["omar@studio.example"]["bounced"],
       by.get("omar@studio.example"))
    ck("nameless recipient carries an empty name (never invented) but a real sent_at",
       bool(by.get("nobody@plain.example")) and by["nobody@plain.example"]["name"] == "" and by["nobody@plain.example"]["sent_at"] != "",
       by.get("nobody@plain.example"))

    # ---- names survive intact (Arabic preserved) ----
    ck("Arabic recipient name is preserved intact", by.get("omar@studio.example", {}).get("name") == "عمر خالد", by.get("omar@studio.example"))

    # ---- opens are NOT per recipient (no invented state) ----
    ck("no ledger row invents a per-recipient open field",
       all(("open_count" not in r) and ("last_open_at" not in r) and ("opens" not in r) for r in led),
       [list(r.keys()) for r in led[:1]])

    # ---- D2: a recipient's reply never lifts the campaign to Replied ----
    stage = pg.evaluate("()=>window.effStage(window.getDraft('thrive-july'))")
    ck("D2: the campaign's aggregate stage is opened (its own opens), never replied", stage == "opened", stage)

    # ---- lane equals detail: the ledger's replied recipient matches recipientState ----
    agree = pg.evaluate("""()=>{
      const led=window.campaignRecipientLedger('thrive-july');
      return led.every(r=> r.replied === window.recipientState('thrive-july', r.addr).replied
                        && r.bounced === window.recipientState('thrive-july', r.addr).bounced);
    }""")
    ck("lane equals detail: every ledger row agrees with recipientState", agree is True, agree)

    # ---- stability: ten reads are byte-identical ----
    stable = pg.evaluate("""()=>{
      const a=JSON.stringify(window.campaignRecipientLedger('thrive-july'));
      for(let i=0;i<10;i++){ if(JSON.stringify(window.campaignRecipientLedger('thrive-july'))!==a) return false; }
      return true;
    }""")
    ck("ten consecutive reads are byte-identical (stable, no flicker)", stable is True, stable)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CAMPAIGN LEDGER CHECKS PASS"))
raise SystemExit(1 if fails else 0)
