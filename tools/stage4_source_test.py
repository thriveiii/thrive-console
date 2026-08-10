"""Stage 4: Supabase is the single source; the device is a cache; a data clear loses nothing.

The mocked Supabase is STATEFUL and persists across a page reload (stored in window.name, which survives
a reload but is not localStorage), so clearing localStorage models a Safari data clear while the server
keeps the data. Proves: (1) a fresh/cleared device with empty local stores signs in and loads the full
board AND the operator's custom templates from Supabase, with no manual step; (2) a write made while
signed in reaches Supabase durably, so after a data clear and re-sign-in it is still there; (3) a write
whose mirror fails (offline) is queued locally and flushed on the next attempt, never silently lost."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PASSCODE = "ConThrive2030"

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

# A stateful Supabase. The dataset lives in window.name so it survives a reload (a Safari data clear
# wipes localStorage, not the server). __FAIL_ONCE flips a single write to a 500 to model an offline blip.
INIT = r"""
(() => {
  try { localStorage.setItem('console_sb_url','https://fake.supabase.co'); localStorage.setItem('console_sb_anon','anon-key'); } catch(e){}
  let DB; try { DB = JSON.parse(window.name || '{}'); } catch(e){ DB = {}; }
  if (!DB.__seeded) {
    DB = { __seeded:1, __failNext:false,
      console_opps: { 'thrive-july': { slug:'thrive-july', data:{ slug:'thrive-july', business:'July', published:true,
        recipients:[{addr:'basel.personal@gmail.com',name:'Basel',lang:'ar'},{addr:'lina@school.com',name:'Lina',lang:'en'}] } } },
      console_pages: {},
      console_mail: {
        'j1': { id:'j1', data:{ mid:'j1', opp:'thrive-july', to:'basel.personal@gmail.com', toName:'Basel', subject:'من جد وجد', status:'sent', direction:'out', ts:'2026-07-31T17:02:00Z' } },
        'j2': { id:'j2', data:{ mid:'j2', opp:'thrive-july', to:'lina@school.com', toName:'Lina', subject:'A page', status:'sent', direction:'out', ts:'2026-07-31T17:03:00Z' } } },
      console_inbound: { 'g1': { id:'g1', data:{ gid:'g1', opp:'', kind:'reply', from:'basel.personal@gmail.com', name:'Basel', subject:'Re: من جد وجد', snippet:'yes', ts:'2026-08-03T09:00:00Z' } } },
      console_hits: {},
      console_templates: { 'tpl-custom': { id:'tpl-custom', kind:'page', name:'Ludic page', subject:'', html:'<p>hi</p>', lang:'en', up:1 } },
      console_settings: {} };
    try { window.name = JSON.stringify(DB); } catch(e){}
  }
  const save = ()=>{ try { window.name = JSON.stringify(DB); } catch(e){} };
  const keyFor = (t)=> t==='console_opps' ? 'slug' : t==='console_settings' ? 'key' : 'id';
  const json = (v)=> new Response(JSON.stringify(v), {status:200, headers:{'Content-Type':'application/json'}});
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts) => {
    const method=(opts&&opts.method)||'GET'; const body=(opts&&opts.body)?JSON.parse(opts.body):null;
    if (typeof url==='string' && url.indexOf('/auth/v1/token')>=0 && url.indexOf('grant_type=password')>=0) {
      if (body.email==='op@thrive.co' && body.password==='right')
        return json({access_token:'jwt-x', refresh_token:'r', expires_at:9999999999, user:{id:'uid-1'}});
      return new Response(JSON.stringify({error_description:'bad'}), {status:400, headers:{'Content-Type':'application/json'}});
    }
    const m = typeof url==='string' && url.match(/\/rest\/v1\/(console_[a-z]+)/);
    if (m) {
      const t = m[1];
      if (method==='POST') {
        if (DB.__failNext) { DB.__failNext=false; save(); return new Response('boom',{status:500}); }
        const k = keyFor(t);
        (body||[]).forEach(r=>{ DB[t] = DB[t]||{}; DB[t][String(r[k])] = r; });
        save(); return new Response('',{status:201});
      }
      if (method==='DELETE') {
        const u=new URL(url); // slug=eq.x
        const q=(u.search||'').replace('?',''); const mm=/(\w+)=eq\.(.*)$/.exec(q);
        if (mm && DB[t]) { delete DB[t][decodeURIComponent(mm[2])]; save(); }
        return new Response('',{status:204});
      }
      return json(Object.values(DB[t]||{}));
    }
    if (typeof url==='string' && url.indexOf('/auth/v1/logout')>=0) return new Response('',{status:204});
    return real?real(url,opts):new Response('',{status:200});
  };
  window.__setFailNext = ()=>{ DB.__failNext=true; save(); };
  window.__dbHas = (t,k)=>{ try{ return !!(JSON.parse(window.name)[t]||{})[k]; }catch(e){ return false; } };
})()
"""

def sign_in(pg):
    pg.wait_for_selector("#gateInput", timeout=10000)
    pg.fill("#gateInput", PASSCODE); pg.click(".gate-btn")
    pg.wait_for_selector("#gateEmail", timeout=10000)
    pg.fill("#gateEmail","op@thrive.co"); pg.fill("#gatePass","right"); pg.click(".gate-btn")
    pg.wait_for_function("()=>!document.getElementById('thriveGate')", timeout=10000)
    pg.wait_for_function("()=>typeof window.getMailLog==='function' && typeof window.saveDraft==='function'", timeout=15000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 480, "height": 860})
    pg.add_init_script(INIT)
    pg.goto(f"{base}/library/console.html")

    # ---- (1) fresh/cleared device: empty local, sign in, full board + templates from Supabase ----
    sign_in(pg)
    pg.wait_for_function("()=>window.getMailLog && window.getMailLog().length>0", timeout=15000)
    full = pg.evaluate("""()=>({
      localOpps: JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').length,
      mail: window.getMailLog().length,
      hasJuly: !!window.getDraft('thrive-july'),
      hasTemplate: window.getCustomTemplates().some(t=>t.id==='tpl-custom')
    })""")
    ck("a signed-in operator with an empty local store loads the full board from Supabase",
       full["mail"]==2 and full["hasJuly"]==True, full)
    ck("custom templates hydrate from Supabase into the cache too (nothing compose-time is lost)",
       full["hasTemplate"]==True, full)

    # ---- (3) an offline write is QUEUED, not lost, and flushes on the next attempt ----
    pg.evaluate("()=>window.__setFailNext()")
    pg.evaluate("()=>window.saveDraft({slug:'offline-opp', business:'Offline', stage:'draft'})")
    pg.wait_for_timeout(200)
    q1 = pg.evaluate("()=>window.thriveSupaPendingCount()")
    inDbBefore = pg.evaluate("()=>window.__dbHas('console_opps','offline-opp')")
    ck("a write whose mirror fails is held in the local queue (not silently dropped)",
       q1>=1 and inDbBefore==False, {"pending": q1, "inDb": inDbBefore})
    pg.evaluate("()=>window.thriveSupaFlush()"); pg.wait_for_timeout(300)
    q2 = pg.evaluate("()=>window.thriveSupaPendingCount()")
    inDbAfter = pg.evaluate("()=>window.__dbHas('console_opps','offline-opp')")
    ck("the next flush drains the queue and the write reaches Supabase",
       q2==0 and inDbAfter==True, {"pending": q2, "inDb": inDbAfter})

    # ---- (2) a write made signed-in survives a Safari data clear + re-sign-in ----
    pg.evaluate("()=>window.saveDraft({slug:'team-opp', business:'Team member work', stage:'draft'})")
    pg.wait_for_timeout(250)
    reached = pg.evaluate("()=>window.__dbHas('console_opps','team-opp')")
    ck("a normal signed-in write reaches Supabase durably (queue drained)",
       reached==True and pg.evaluate("()=>window.thriveSupaPendingCount()")==0, reached)
    # Safari data clear: wipe ALL localStorage (session, config, caches). window.name (the server) persists.
    pg.evaluate("()=>{ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} }")
    pg.reload()
    sign_in(pg)
    pg.wait_for_function("()=>window.getDraft && !!window.getDraft('thrive-july')", timeout=15000)
    survived = pg.evaluate("""()=>({
      localAfterClear: JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').some(o=>o.slug==='team-opp'),
      teamOpp: !!window.getDraft('team-opp'),
      offlineOpp: !!window.getDraft('offline-opp'),
      july: !!window.getDraft('thrive-july')
    })""")
    ck("after a data clear and re-sign-in, the board is full again from Supabase (nothing refilled by hand)",
       survived["july"]==True and survived["teamOpp"]==True and survived["offlineOpp"]==True, survived)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL STAGE-4 SOURCE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
