"""A group reply's missing child card is reconstructed on read, so Replied reflects it (WO-029).

Live root cause (Read 1 + Read 4, Brief 2): a group reply is Replied only through the child card that
spawnChildrenFromReplies mints (childSlugFor(parent, addr)). Basel's console_inbound.opp in Supabase is
the child slug thrive-july--r-..., but the child console_opps row never persisted (a flush race), so the
board reads an inbound row pointing at a card that is not in the store and Replied stays 0.

This proves the read-side fix: from the two records that DID persist (the parent group and the child
-suffixed inbound row), the derivation reconstructs the child so effStage reads Replied, the board counts
it, and the parent's recipient row reads Replied, holding across a refresh (repeated reads). Constraint:
the reconstructed child is derivation-only and is never written back to the device or Supabase.

The device pass (Basel Replied 1 on the live board, held across refresh and views) stays Thyab's gate."""
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

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_templates:{}, console_mail:{}, console_inbound:{}, console_hits:{}, console_settings:{} } };
  window.__posts = [];
  const pk = t => (t==='console_opps'||t==='console_pages') ? 'slug' : (t==='console_settings') ? 'key' : 'id';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url==='string' && url.indexOf('/rest/v1/')>=0) {
        const u=new URL(url); const table=(u.pathname.split('/rest/v1/')[1]||'').split('?')[0];
        const method=(opts&&opts.method)||'GET'; const store=window.__sb.tables[table]||(window.__sb.tables[table]={}); const key=pk(table);
        if (method==='POST'){ const rows=JSON.parse(opts.body||'[]'); rows.forEach(r=>{ window.__posts.push({table, id:r[key]}); store[r[key]]=r; }); return new Response('',{status:201}); }
        if (method==='DELETE'){ return new Response('',{status:204}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch(e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(300)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(400)
    pg.wait_for_function("()=>typeof window.getDrafts==='function' && typeof window.childSlugFor==='function'", timeout=15000)
    pg.evaluate(FAKE)
    pg.evaluate("""()=>{ window.ThriveSupa.setCfg('https://fake.supabase.co','anon');
      localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', expires_at:9999999999, user:{id:'op'}}));
      localStorage.setItem('console_sb_read','1'); localStorage.removeItem('console_sb_pending'); }""")

    # Live shape: Supabase has the PARENT group and the inbound row re-pointed to the child slug, but NO
    # child opportunity row (the flush race). The device local store is empty; the board reads Supabase.
    setup = pg.evaluate("""async ()=>{
      const child = window.childSlugFor('thrive-july','basel@gmail.com');
      localStorage.setItem('thrive_opps_v1','[]'); localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_inbound_v1','[]');
      window.__sb.tables.console_opps['thrive-july'] = { slug:'thrive-july', data:{ slug:'thrive-july', business:'July', published:true, stage:'sent',
        recipients:[{addr:'basel@gmail.com',name:'Basel',lang:'ar'},{addr:'lina@x.com',name:'Lina'},{addr:'omar@y.com',name:'Omar'}] } };
      window.__sb.tables.console_mail['s1'] = { id:'s1', data:{ mid:'s1', opp:'thrive-july', to:'basel@gmail.com', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' } };
      window.__sb.tables.console_inbound['g-basel'] = { id:'g-basel', data:{ gid:'g-basel', opp:child, kind:'reply', from:'basel@gmail.com', subject:'Re: Idea', snippet:'yes', ts:'2026-08-03T09:00:00Z' } };
      await window.supaHydrate();
      window.__posts = [];   // ignore any hydrate-time writes; from here the board only READS
      return { child };
    }""")
    child = setup["child"]

    ck("baseline: the child opportunity is absent from the read store (Supabase console_opps has no child)",
       pg.evaluate("(c)=>!window.__sb.tables.console_opps[c]", child))

    # ---- the derivation reconstructs the child from the parent group + the child-suffixed inbound row ----
    got = pg.evaluate("""(c)=>{ const o=window.getDraft(c);
      return o ? { present:true, reconstructed:!!o._reconstructed, parent:(o.spawned_from||{}).parent, addr:(o.spawned_from||{}).addr, stage:window.effStage(o) } : { present:false }; }""", child)
    ck("the missing child card is reconstructed on read, linked to its parent and recipient",
       got["present"] and got["reconstructed"] and got["parent"]=="thrive-july" and got["addr"]=="basel@gmail.com", got)
    ck("effStage reads the reconstructed child as Replied (#82 derivation over the inbound row)",
       got.get("stage")=="replied", got)

    # ---- the board Replied count reflects it (1), and holds across a refresh (repeated reads) ----
    counts = pg.evaluate("""async ()=>{
      const once = async ()=>{ const rows=await window.mergedOpps(); let r=0; rows.filter(o=>!o.archived).forEach(o=>{ if(window.effStage(o)==='replied') r++; }); return r; };
      return { first: await once(), second: await once() };
    }""")
    ck("the board shows Replied 1 for the group reply, and holds it across a refresh",
       counts["first"]==1 and counts["second"]==1, counts)

    # ---- the parent's recipient panel reads Replied for Basel; the group parent itself never does ----
    panel = pg.evaluate("""()=>({ basel: window.recipientState('thrive-july','basel@gmail.com'),
                                   parent: window.effStage(window.getDraft('thrive-july')) })""")
    ck("Basel's recipient row reads Replied and links to the child card",
       panel["basel"]["chip"]=="replied" and panel["basel"]["replied"] is True and panel["basel"]["child"]==child, panel["basel"])
    ck("the parent group stays in its lane (Opened/Sent), never Replied",
       panel["parent"] in ("opened","sent"), panel["parent"])

    # ---- the held / unmatched-human count is consistent (the reply is matched, opp set, not held) ----
    ck("the matched reply is not counted as unmatched-human (held count drops, one derivation for both views)",
       pg.evaluate("()=>window.unmatchedHuman().length")==0)

    # ---- constraint 1: derivation-only. Reading never writes the child back to Supabase or the device ----
    ck("reading the board never wrote the reconstructed child to Supabase (no console_opps POST for it)",
       pg.evaluate("(c)=>!window.__sb.tables.console_opps[c] && !window.__posts.some(p=>p.table==='console_opps' && p.id===c)", child), )
    stripped = pg.evaluate("""(c)=>{ window.setDrafts(window.getDrafts());   // a write-back must strip the reconstructed child
      const local=JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]');
      return { childInLocal: local.some(o=>o.slug===c), reconInLocal: local.some(o=>o._reconstructed) }; }""", child)
    ck("a write-back strips the reconstructed child (it never persists to the device store)",
       stripped["childInLocal"] is False and stripped["reconInLocal"] is False, stripped)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL CHILD-RECONSTRUCTION CHECKS PASS"))
raise SystemExit(1 if fails else 0)
