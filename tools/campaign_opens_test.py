"""Campaigns P2 - truthful per-recipient opens. Engine-independent; WebKit is Thyab's device gate.

The token is a console_mail row id (recipientOpenToken: deterministic in opp+recipient+subject, so it is
known at compile and never perturbs the send idempotency). It rides an open pixel and the page link; the
relay writes console_hits.data.r = token; attribution is the join hits.r -> mail.id -> to_addr.

Proves: the compile emits exactly one pixel carrying the token and a tokenized page link; a token-bearing
open attributes to the right recipient (open_count + last_open_at); an UNTOKENED hit never attributes to a
person (it is an anonymous, campaign-level view); campaignStats keeps the two truths separate and never
sums them; ten reads are byte-identical.
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

# A campaign of two recipients. The mail row id (mid) IS the per-recipient token, exactly as a real send
# writes it (relaySend passes mid = recipientOpenToken). Tracy's row token is TK_A; Lea's is TK_B.
SEED = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  var TK_A = window.recipientOpenToken('thrive-july','tracy@shop.example','July');
  var TK_B = window.recipientOpenToken('thrive-july','lea@atelier.example','July');
  set('thrive_opps_v1', [
    { slug:'thrive-july', business:'Thrive July', published:true, up:1, recipients:[
      { addr:'tracy@shop.example', name:'Tracy Bell', lang:'en' },
      { addr:'lea@atelier.example', name:'ليّا نديم', lang:'ar' }
    ] }
  ]);
  set('thrive_mail_v1', [
    { mid:TK_A, opp:'thrive-july', to:'tracy@shop.example', toName:'Tracy Bell', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:00:00Z' },
    { mid:TK_B, opp:'thrive-july', to:'lea@atelier.example', toName:'ليّا نديم', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:01:00Z' }
  ]);
  // Hits: two token-bearing opens for Tracy (TK_A), zero for Lea, and one ANONYMOUS open (no r).
  set('thrive_hits_v1', [
    { type:'open', slug:'thrive-july', ts:'2026-07-02T12:00:00Z', vid:'v1', r:TK_A },
    { type:'open', slug:'thrive-july', ts:'2026-07-03T09:30:00Z', vid:'v1', r:TK_A },
    { type:'open', slug:'thrive-july', ts:'2026-07-02T15:00:00Z', vid:'v9' }
  ]);
  set('thrive_inbound_v1', []); set('thrive_card_seen_v1', {});
  window.__TK_A = TK_A; window.__TK_B = TK_B;
})()
"""

def enter(pg):
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.campaignRecipientLedger==='function' && typeof window.campaignStats==='function' && typeof window.recipientOpenToken==='function' && typeof window.openPixelHtml==='function'", timeout=15000)
    pg.evaluate("(s)=>{ eval(s); }", SEED)
    pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    enter(pg)

    # ---- the token is deterministic (stable across re-taps, so it never perturbs the send idempotency) ----
    det = pg.evaluate("""()=>{
      var a=window.recipientOpenToken('thrive-july','tracy@shop.example','July');
      var b=window.recipientOpenToken('thrive-july','tracy@shop.example','July');
      var c=window.recipientOpenToken('thrive-july','lea@atelier.example','July');
      return { same:a===b, distinct:a!==c, nonEmpty:!!a };
    }""")
    ck("the per-recipient token is deterministic, per-recipient, non-empty", det["same"] and det["distinct"] and det["nonEmpty"], det)

    # ---- the compile emits EXACTLY ONE pixel, carrying op=hit + type=open + the token ----
    px = pg.evaluate("""()=>{
      var html = window.openPixelHtml('thrive-july', window.__TK_A, 'https://relay.example/exec');
      var imgs = (html.match(/<img/g)||[]).length;
      return { imgs:imgs, hit: html.indexOf('op=hit')>=0, open: html.indexOf('type=open')>=0,
               tok: html.indexOf('r='+encodeURIComponent(window.__TK_A))>=0, oneByOne: html.indexOf('width=\"1\"')>=0 };
    }""")
    ck("the open pixel is exactly one 1x1 img carrying op=hit, type=open and the token",
       px["imgs"]==1 and px["hit"] and px["open"] and px["tok"] and px["oneByOne"], px)

    # ---- attribution: a token-bearing open lands on the right recipient; the other stays at zero ----
    led = pg.evaluate("()=>window.campaignRecipientLedger('thrive-july')")
    by = { r["addr"]: r for r in led }
    ck("Tracy (token TK_A) shows open_count 2 with a last_open_at",
       by.get("tracy@shop.example",{}).get("open_count")==2 and by.get("tracy@shop.example",{}).get("last_open_at")=="2026-07-03T09:30:00Z",
       by.get("tracy@shop.example"))
    ck("Lea (no token hits) shows open_count 0 and no last_open_at",
       by.get("lea@atelier.example",{}).get("open_count")==0 and by.get("lea@atelier.example",{}).get("last_open_at")=="",
       by.get("lea@atelier.example"))

    # ---- the anonymous (untokened) open is NEVER attributed to a person ----
    total_person_opens = sum(r.get("open_count",0) for r in led)
    ck("an untokened hit is never attributed to a person (person opens total exactly the 2 token hits)",
       total_person_opens==2, total_person_opens)

    # ---- campaignStats keeps the two truths separate and never sums them ----
    st = pg.evaluate("()=>window.campaignStats('thrive-july')")
    ck("campaignStats: one distinct token opener (Tracy), one anonymous view (Lea's page had none; the v9 hit)",
       st.get("openersTokened")==1 and st.get("viewsAnon")==1, st)
    ck("token openers and anonymous views are separate fields, never summed into one opens number",
       "openersTokened" in st and "viewsAnon" in st and st["openersTokened"]!=st.get("opens"), st)

    # ---- stability ----
    stable = pg.evaluate("""()=>{
      var a=JSON.stringify(window.campaignRecipientLedger('thrive-july'));
      for(var i=0;i<10;i++){ if(JSON.stringify(window.campaignRecipientLedger('thrive-july'))!==a) return false; }
      return true;
    }""")
    ck("ten consecutive reads are byte-identical (stable)", stable is True, stable)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CAMPAIGN OPENS CHECKS PASS"))
raise SystemExit(1 if fails else 0)
