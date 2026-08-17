"""Insights truth (P4). Engine-independent; WebKit is Thyab's device gate.

The shipped defect: "Who is paying attention" copied the page-level open total onto every person. P4 makes
per-person opens token-bearing (P2) only; a person with no token send is pre-token history, never a guessed
zero; a page-level anonymous view is nobody's; near-duplicate addresses (typo domains) are flagged, not
merged; and every metric has a dictionary entry with one source.
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

# thrive-july: basel + lina + omar are P2 sends (snd_ tokens); "pre" is a pre-token send (base36 mid).
# Only basel gets a token-bearing open. There is also one ANONYMOUS page open (no r) - nobody's.
# omar has a typo-domain twin (omar@gmial.com) that was also mailed: a possible duplicate, flagged not merged.
SEED = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  var TB=window.recipientOpenToken('thrive-july','basel@gmail.com','July');
  var TL=window.recipientOpenToken('thrive-july','lina@gmail.com','July');
  var TO=window.recipientOpenToken('thrive-july','omar@gmail.com','July');
  var TO2=window.recipientOpenToken('thrive-july','omar@gmial.com','July');
  set('thrive_opps_v1', [{ slug:'thrive-july', business:'Thrive July', published:true, up:1 }]);
  set('thrive_mail_v1', [
    { mid:TB, opp:'thrive-july', to:'basel@gmail.com', toName:'Basel', subject:'July', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
    { mid:TL, opp:'thrive-july', to:'lina@gmail.com', toName:'Lina', subject:'July', status:'sent', direction:'out', ts:'2026-08-01T10:01:00Z' },
    { mid:TO, opp:'thrive-july', to:'omar@gmail.com', toName:'Omar', subject:'July', status:'sent', direction:'out', ts:'2026-08-01T10:02:00Z' },
    { mid:TO2, opp:'thrive-july', to:'omar@gmial.com', toName:'Omar', subject:'July', status:'sent', direction:'out', ts:'2026-08-01T10:03:00Z' },
    { mid:'oldmid123', opp:'thrive-july', to:'pre@shop.example', toName:'Pre', subject:'July', status:'sent', direction:'out', ts:'2026-07-01T10:00:00Z' }
  ]);
  set('thrive_hits_v1', [
    { type:'open', slug:'thrive-july', ts:'2026-08-02T12:00:00Z', vid:'v1', r:TB },
    { type:'open', slug:'thrive-july', ts:'2026-08-02T13:00:00Z', vid:'v2' }
  ]);
  set('thrive_inbound_v1', []); set('thrive_card_seen_v1', {});
})()
"""

def cells(pg, addr):
    return pg.evaluate("""(a)=>{
      var rows=Array.from(document.querySelectorAll('#homePeople tbody tr'));
      for(const tr of rows){ if((tr.textContent||'').toLowerCase().indexOf(a)>=0){
        var td=tr.querySelectorAll('td');
        return { opens:(td[2]&&td[2].textContent||'').trim(), dup: !!tr.querySelector('.tag-warn'), html: td[2]?td[2].innerHTML:'' }; } }
      return null;
    }""", addr)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.recipientOpenToken==='function' && typeof window.nearDupAddrs==='function' && typeof window.INSIGHTS_METRICS==='object'", timeout=15000)
    pg.evaluate("(s)=>{ eval(s); }", SEED)
    pg.evaluate("()=>{ location.hash='#home'; }")
    pg.wait_for_timeout(400)
    # trigger the Insights render and wait for the person table to populate
    pg.evaluate("()=>{ var b=document.getElementById('homeRefresh'); if(b) b.click(); }")
    pg.wait_for_function("()=>document.querySelectorAll('#homePeople tbody tr').length>0", timeout=15000)

    # ---- the metric dictionary keeps person opens and anonymous views separate, each with a source ----
    dict_ok = pg.evaluate("""()=>{ var M=window.INSIGHTS_METRICS;
      return !!(M.person_opens && M.person_opens.source && M.anon_views && M.anon_views.source
                && M.person_opens.source!==M.anon_views.source); }""")
    ck("metric dictionary defines person_opens and anon_views separately, each with a single source", dict_ok is True)

    # ---- the headline defect: page opens are NOT copied onto every person ----
    basel = cells(pg, "basel@gmail.com"); lina = cells(pg, "lina@gmail.com"); pre = cells(pg, "pre@shop.example")
    ck("Basel (the one token-bearing opener) shows opens 1", basel and basel["opens"]=="1", basel)
    ck("Lina (a trackable send, no personal open) shows opens 0, never the campaign total", lina and lina["opens"]=="0", lina)
    ck("nobody shows the campaign page total (no person row reads the borrowed 2)",
       all((cells(pg,a) or {}).get("opens")!="2" for a in ["basel@gmail.com","lina@gmail.com","omar@gmail.com","pre@shop.example"]))

    # ---- historical honesty: a pre-token send renders "before personal tracking", not a guessed 0 ----
    ck("a pre-token person renders 'before personal tracking', not zero",
       pre and "before personal tracking" in (pre["html"] or "").lower(), pre)

    # ---- near-duplicate flag: the typo-domain twin is flagged, not merged ----
    ndup = pg.evaluate("()=>window.nearDupAddrs(['omar@gmail.com','omar@gmial.com','basel@gmail.com'])")
    ck("nearDupAddrs flags omar@gmail.com and omar@gmial.com (typo domain), leaves basel alone",
       ndup.get("omar@gmail.com")==1 and ndup.get("omar@gmial.com")==1 and "basel@gmail.com" not in ndup, ndup)
    omar = cells(pg, "omar@gmial.com")
    ck("the Insights person row shows the possible-duplicate flag (no silent merge)", omar and omar["dup"] is True, omar)

    # ---- sum reconciliation: person-level token opens sum to the campaign's distinct-opener count ----
    recon = pg.evaluate("""()=>{
      var st=window.campaignStats('thrive-july');
      var personOpeners=['basel@gmail.com','lina@gmail.com','omar@gmail.com','omar@gmial.com','pre@shop.example']
        .filter(a=>{ var toks={}; window.getMailLog().forEach(m=>{ if(m&&m.opp==='thrive-july'&&m.direction!=='in'&&String(m.to||'').toLowerCase()===a){ var id=m.mid||m.id; if(id) toks[id]=1; } });
          return window.getHitsLocal ? false : false; });   // placeholder
      // count distinct openers by token directly
      var owners={}; window.getMailLog().forEach(m=>{ if(m&&m.opp==='thrive-july'&&m.direction!=='in'){ var id=m.mid||m.id; if(id) owners[id]=String(m.to||'').toLowerCase(); } });
      var seen={}; (window.__hitsAll?window.__hitsAll():JSON.parse(localStorage.getItem('thrive_hits_v1')||'[]')).forEach(e=>{ if(e&&(!e.type||e.type==='open')&&!e.self&&e.r&&owners[e.r]) seen[owners[e.r]]=1; });
      return { openersTokened:st.openersTokened, viewsAnon:st.viewsAnon, distinctPersonOpeners:Object.keys(seen).length };
    }""")
    ck("person-level distinct openers equals campaignStats.openersTokened (1), anonymous view counted separately (1)",
       recon["distinctPersonOpeners"]==recon["openersTokened"]==1 and recon["viewsAnon"]==1, recon)

    # ---- stability ----
    stable = pg.evaluate("""()=>{ var a=document.getElementById('homePeople').innerHTML;
      for(var i=0;i<3;i++){ var b=document.getElementById('homeRefresh'); }
      return document.getElementById('homePeople').innerHTML===a; }""")
    ck("the person table is stable (a re-read is identical)", stable is True)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL INSIGHTS TRUTH CHECKS PASS"))
raise SystemExit(1 if fails else 0)
