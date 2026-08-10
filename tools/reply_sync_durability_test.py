"""Brief B: a matched reply's attribution reaches Supabase, or says it did not (WO-025).

Root cause, reproduced: rematchHeld writes the attribution onto the Stage 4 durable queue (setInbound
-> supaMirrorInbound -> supaQueueUpsert), but supaFlush only POSTs when signed in (an anon write is
refused by RLS). So a match made while Supabase is configured but the operator is NOT signed in is saved
on this device and queued, never on the Supabase-read board, which is the opp='' + oscillation Thyab
read live. This proves the fix:
- signed in, the attribution lands in Supabase (opp set), so #82 flips the card to Replied on the read;
- signed out, rematchHeld reports pendingSupa (not a hollow success), so the operator is told to sign in;
- signing in flushes the queued attribution on its own (supaHydrate -> supaFlush), no re-match needed;
- the tie-break: a reply matching more than one send attributes to the most recent, never leaves opp empty.

The device pass (Basel flips to Replied 1 and holds across refreshes) stays Thyab's WebKit gate."""
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

# The keys that carry the honest "device-only, sign in to sync" line must exist in both languages.
i18n = open(os.path.join(ROOT, "library/i18n.js"), encoding="utf-8").read()
ck("the honest device-only line exists in English and Arabic (rp_rematch_local, rp_attach_local)",
   i18n.count("rp_rematch_local:") == 2 and i18n.count("rp_attach_local:") == 2)

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

# Basel replies from an address that received TWO sends: thrive-july (Aug 1) and madar (Aug 3, newest).
SEED = r"""
() => {
  localStorage.setItem('thrive_opps_v1', JSON.stringify([
    {slug:'thrive-july', business:'July', published:true, stage:'sent'},
    {slug:'madar', business:'Al-Madar', published:true, stage:'sent'}
  ]));
  localStorage.setItem('thrive_mail_v1', JSON.stringify([
    {mid:'s1', opp:'thrive-july', to:'basel@gmail.com', subject:'Idea one', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'},
    {mid:'s2', opp:'madar', to:'basel@gmail.com', subject:'Idea two', status:'sent', direction:'out', ts:'2026-08-03T10:00:00Z'}
  ]));
  localStorage.setItem('thrive_inbound_v1', JSON.stringify([
    {gid:'g-basel', opp:'', kind:'reply', from:'basel@gmail.com', subject:'Re: Idea two', snippet:'yes', ts:'2026-08-04T09:00:00Z'}
  ]));
  window.__sb.tables.console_inbound['g-basel'] = { id:'g-basel', opp:'', kind:'reply', ts:'2026-08-04T09:00:00Z',
    data:{gid:'g-basel', opp:'', kind:'reply', from:'basel@gmail.com', subject:'Re: Idea two', snippet:'yes', ts:'2026-08-04T09:00:00Z'} };
  // Supabase also holds the opportunities and sends (as the live DB does), so a hydrate reads the full picture.
  window.__sb.tables.console_opps['thrive-july'] = { slug:'thrive-july', data:{slug:'thrive-july', business:'July', published:true, stage:'sent'} };
  window.__sb.tables.console_opps['madar'] = { slug:'madar', data:{slug:'madar', business:'Al-Madar', published:true, stage:'sent'} };
  window.__sb.tables.console_mail['s1'] = { id:'s1', data:{mid:'s1', opp:'thrive-july', to:'basel@gmail.com', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'} };
  window.__sb.tables.console_mail['s2'] = { id:'s2', data:{mid:'s2', opp:'madar', to:'basel@gmail.com', status:'sent', direction:'out', ts:'2026-08-03T10:00:00Z'} };
  window.invalidateSends&&window.invalidateSends();
  return true;
}
"""
SESSION = "()=>localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999, user:{id:'op-1'}}))"

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def new_ctx(b, signed_in):
    # A fresh page per scenario, so module-level Supabase cache never leaks between scenarios.
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(300)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(400)
    pg.wait_for_function("()=>typeof window.rematchHeld==='function'", timeout=15000)
    pg.evaluate(FAKE)
    pg.evaluate("()=>{ window.ThriveSupa.setCfg('https://fake.supabase.co','anon'); localStorage.setItem('console_sb_read','1'); localStorage.removeItem('console_sb_pending'); localStorage.removeItem('console_sb_session'); }")
    if signed_in:
        pg.evaluate(SESSION)
    pg.evaluate(SEED)
    return pg

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ---- signed OUT: the match is saved on the device and QUEUED, reported honestly, not on Supabase ----
    pg = new_ctx(b, signed_in=False)
    out = pg.evaluate("""async ()=>{
      const r = window.rematchHeld();
      try{ await window.thriveSupaFlush(); }catch(e){}
      await new Promise(x=>setTimeout(x,200));
      return { matched:r.matched, pendingSupa:r.pendingSupa, synced:r.synced,
               sb_opp:(window.__sb.tables.console_inbound['g-basel']||{}).opp,
               dev_opp:(JSON.parse(localStorage.getItem('thrive_inbound_v1')).find(x=>x.gid==='g-basel')||{}).opp };
    }""")
    ck("signed out: rematch matches but reports pendingSupa (an honest 'saved on this device', not a hollow success)",
       out["matched"] == 1 and out["pendingSupa"] is True and out["synced"] is False, out)
    ck("signed out: the attribution is on the device but NOT yet in Supabase (this was the opp='' Thyab read)",
       out["dev_opp"] == "madar" and out["sb_opp"] == "", out)
    ck("tie-break: Basel matched two sends and attributes to the MOST RECENT (madar, Aug 3), never left empty",
       out["dev_opp"] == "madar", out)
    pg.close()

    # ---- signed IN: the attribution lands in Supabase, so the board (Supabase-read) shows Replied ----
    pg = new_ctx(b, signed_in=True)
    ins = pg.evaluate("""async ()=>{
      const r = window.rematchHeld();
      try{ await window.thriveSupaFlush(); }catch(e){}
      await new Promise(x=>setTimeout(x,200));
      return { pendingSupa:r.pendingSupa, synced:r.synced,
               sb_opp:(window.__sb.tables.console_inbound['g-basel']||{}).opp,
               sb_data_opp:((window.__sb.tables.console_inbound['g-basel']||{}).data||{}).opp };
    }""")
    ck("signed in: rematch reports synced (not pending) and writes opp to Supabase (top-level and data)",
       ins["synced"] is True and ins["pendingSupa"] is False and ins["sb_opp"] == "madar" and ins["sb_data_opp"] == "madar", ins)
    pg.close()

    # ---- signing in flushes the queued attribution on its own (no second re-match), Thyab's Step 1 ----
    pg = new_ctx(b, signed_in=False)
    flushed = pg.evaluate("""async ()=>{
      window.rematchHeld();                                   // signed out: queues, does not reach Supabase
      const before = (window.__sb.tables.console_inbound['g-basel']||{}).opp;
      localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999, user:{id:'op-1'}}));
      try{ await window.supaHydrate(); }catch(e){}            // sign-in path flushes the queue
      await new Promise(x=>setTimeout(x,200));
      return { before:before, after:(window.__sb.tables.console_inbound['g-basel']||{}).opp, pending:window.thriveSupaPendingCount() };
    }""")
    ck("signing in flushes the queued attribution on its own (opp goes empty -> madar, queue drains), no re-match needed",
       flushed["before"] == "" and flushed["after"] == "madar" and flushed["pending"] == 0, flushed)

    # ---- once opp is in Supabase, the #82 derivation reads Replied from that store ----
    stage = pg.evaluate("""async ()=>{ await window.supaHydrate(); return window.effStage(window.getDraft('madar')); }""")
    ck("with opp present in Supabase, the derivation flips the card to Replied on the Supabase read", stage == "replied", stage)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL REPLY-SYNC DURABILITY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
