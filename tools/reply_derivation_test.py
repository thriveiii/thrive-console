"""The board derives Replied from the reply records, one source, so a reply always lands.

Sentinel Sweep 1 found the board reads Replied from effStage, which had no reply branch, so a reply only
reached Replied through a stored stamp written once at pull time. A migrated, backfilled or Supabase-read
reply never got that stamp and sat in Sent. This proves the fix: effStage derives "replied" from the
reply records through one shared helper (hasReply, also used by causalStatus), so the reply lands wherever
the inbound rows live, with the pull-time stamp retired.

The sandbox cannot run the live Supabase or WebKit, so the true restore is Thyab's device."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None:
            print("      " + str(d)[:300])

# ---- source: one shared helper, and the pull-time stamp retired ----
app = open(os.path.join(ROOT, "library/app.js")).read()
ck("effStage and causalStatus share one reply derivation (hasReply)",
   "function hasReply(o)" in app and "if(hasReply(o)) return \"replied\"" in app and "if(hasReply(o)) return { status:\"replied\"" in app)
ck("the pull-time replied stamp is retired (applyInboundMoves removed)",
   "applyInboundMoves" not in app and "pull-time \"replied\" stamp is retired" in app)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_templates:{}, console_mail:{}, console_inbound:{}, console_hits:{}, console_settings:{} } };
  const pk = t => (t==='console_opps'||t==='console_pages') ? 'slug' : (t==='console_settings') ? 'key' : 'id';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        const u = new URL(url); const table = (u.pathname.split('/rest/v1/')[1]||'').split('?')[0];
        const method = (opts&&opts.method)||'GET'; const store = window.__sb.tables[table]||(window.__sb.tables[table]={}); const key = pk(table);
        if (method==='POST'){ (JSON.parse(opts.body||'[]')).forEach(r=>{ store[r[key]]=r; }); return new Response('',{status:201}); }
        if (method==='DELETE'){ const q=u.searchParams.get(key)||''; const m=/^eq\.(.*)$/.exec(q); if(m) delete store[decodeURIComponent(m[1])]; return new Response('',{status:204}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

def eff(pg, slug):
    return pg.evaluate("(s)=>window.effStage(window.getDraft(s))", slug)
def lane(pg, slug):
    return pg.evaluate("(s)=>window.ThriveBoard.laneOf(window.getDraft(s), { mail: window.getMailLog() })", slug)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_timeout(500)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(700)
    pg.wait_for_function("()=>typeof window.effStage==='function' && typeof window.getDraft==='function'", timeout=15000)

    # 1. An inbound reply with no declared stamp now derives to replied, at read time.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'intl-schools', business:'International Schools', published:true, stage:'sent', sent_on:'2026-08-01', up:1},
        {slug:'quiet-co', business:'Quiet Co', published:true, stage:'sent', sent_on:'2026-08-01', up:1}
      ]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'m1', opp:'intl-schools', status:'sent', to:'a@x.com', ts:'2026-08-01T10:00:00Z', direction:'out'},
        {mid:'m2', opp:'quiet-co', status:'sent', to:'b@x.com', ts:'2026-08-01T10:00:00Z', direction:'out'}
      ]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([
        {gid:'g1', opp:'intl-schools', kind:'', direction:'in', ts:'2026-08-03T09:00:00Z', snippet:'yes'}
      ]));
      localStorage.setItem('thrive_hits_v1', JSON.stringify([{type:'open', slug:'intl-schools', ts:'2026-08-02T10:00:00Z', vid:'v1'}]));
      // The send/open caches must see the freshly seeded ledger: a lane is derived from the send RECORD,
      // never from a bare stage:'sent' (the phantom-send fallback is gone), so quiet-co reads Sent from its
      // real mail row m2, not from its declared stage.
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""")
    ck("a reply derives effStage to replied (was sent)", eff(pg, "intl-schools") == "replied", eff(pg, "intl-schools"))
    ck("the board lane is replied", lane(pg, "intl-schools") == "replied", lane(pg, "intl-schools"))
    ck("Replied wins over Opened (the open does not override the reply)", eff(pg, "intl-schools") == "replied")
    ck("an opportunity with no reply stays sent", eff(pg, "quiet-co") == "sent", eff(pg, "quiet-co"))

    # 2. No double count: the board Replied count equals the opportunities that actually have a reply.
    counts = pg.evaluate("""async ()=>{ const opps=await window.mergedOpps();
       const b=window.ThriveBoard.build(opps, { mail: window.getMailLog() }); return b.summary.counts; }""")
    ck("the board Replied count equals the one opportunity with a reply", counts.get("replied") == 1, counts)

    # 3. A hand recorded reply in the ledger (direction in, no inbound row) also derives to replied.
    pg.evaluate("""()=>{ const m=JSON.parse(localStorage.getItem('thrive_mail_v1'));
       m.push({mid:'m3', opp:'quiet-co', status:'replied', direction:'in', to:'b@x.com', ts:'2026-08-04T09:00:00Z'});
       localStorage.setItem('thrive_mail_v1', JSON.stringify(m)); }""")
    pg.evaluate("()=>{ try{ window.invalidateSends&&window.invalidateSends(); }catch(e){} }")
    ck("a hand recorded ledger reply derives to replied", eff(pg, "quiet-co") == "replied", eff(pg, "quiet-co"))

    # 4. A reply read back from Supabase (never stamped) shows replied. The international-schools test.
    pg.evaluate(FAKE)
    pg.evaluate("()=>window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")
    pg.evaluate("""()=>{
      window.__sb.tables.console_opps['sup-intl']={slug:'sup-intl', data:{slug:'sup-intl', business:'Intl (Supabase)', published:true, stage:'sent'}};
      window.__sb.tables.console_mail['sm1']={id:'sm1', data:{mid:'sm1', opp:'sup-intl', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}};
      window.__sb.tables.console_inbound['sg1']={id:'sg1', data:{gid:'sg1', opp:'sup-intl', kind:'', direction:'in', ts:'2026-08-03T09:00:00Z', snippet:'yes'}};
    }""")
    pg.evaluate("()=>localStorage.setItem('console_sb_read','1')")
    pg.evaluate("async ()=>await window.supaHydrate()")
    ck("a Supabase-read reply (never stamped) derives to replied", eff(pg, "sup-intl") == "replied", eff(pg, "sup-intl"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY DERIVATION CHECKS PASS"))
raise SystemExit(1 if fails else 0)
