"""Supabase write contract (Stage 4, refreshed from the pre-Stage-4 immediate-mirror proof).

WO-026: the original suite asserted an IMMEDIATE signed-out dual-write (a save lands in Supabase the moment
it is made). That contract is retired: under Stage 4 a write is DURABLE, it is queued to console_sb_pending
first and reaches Supabase only when the operator is signed in (RLS refuses an anon write), and post brief 02
the flush drains until empty. This proves the CURRENT contract with the same faithful fake of the PostgREST
endpoint (window.fetch wrapped, every /rest/v1/ call lands in an in-memory table store):

  - signed in, a save drains to console_opps (the record in data, never the page html) and to its own
    console_pages row (the html whole); every request targets a console_ table only;
  - signed out, a save is queued honestly (console_sb_pending), never in Supabase, and drains on sign-in;
  - a Supabase rejection does not fail the local save, is recorded as a divergence, is never a false
    success, and the entry stays queued for retry (nothing swallowed);
  - verify flags a real divergence, backfill is idempotent, and a delete mirrors.

The live Supabase and WebKit are Thyab's device gate. This drives the real app.js write path."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{}, calls:0, failOpp:false };
  const pkOf = t => (t==='console_opps'||t==='console_pages') ? 'slug'
                  : (t==='console_mail'||t==='console_templates') ? 'id' : 'key';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        window.__sb.calls++;
        const u = new URL(url);
        const table = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
        const method = (opts && opts.method) || 'GET';
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const pk = pkOf(table);
        if (method === 'POST') {
          if (table === 'console_opps' && window.__sb.failOpp) { window.__sb.failOpp = false; return new Response(JSON.stringify({message:'permission denied'}), {status:401}); }
          (JSON.parse(opts.body || '[]')).forEach(r => { store[r[pk]] = r; });
          return new Response('', {status:201});
        }
        if (method === 'DELETE') {
          const q = u.searchParams.get(pk) || ''; const m = /^eq\.(.*)$/.exec(q);
          if (m) delete store[decodeURIComponent(m[1])];
          return new Response('', {status:204});
        }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""
SIGN_IN  = "()=>localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'}))"
SIGN_OUT = "()=>localStorage.removeItem('console_sb_session')"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.saveDraft==='function' && typeof window.ThriveSupa==='object' && typeof window.thriveSupaFlush==='function'", timeout=15000)
    pg.evaluate("()=>localStorage.removeItem('thrive_opps_v1')")
    pg.evaluate(FAKE)
    pg.evaluate("()=>window.ThriveSupa.setCfg('https://fake.supabase.co','anon-key')")

    # 1. Signed in: a save drains to BOTH stores; the page html is its own console_pages row.
    pg.evaluate(SIGN_IN)
    big = "<div>" + ("x" * 300000) + "</div>"
    pg.evaluate("(h)=>window.saveDraft({ slug:'vsd', business:'VSD Photography', outreach_text:'Hi Deborah', html:h })", big)
    pg.wait_for_timeout(500)
    local = pg.evaluate("()=>JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').map(o=>o.slug)")
    ck("the save lands in the current store (localStorage)", "vsd" in local, local)
    sbOpp = pg.evaluate("()=>window.__sb.tables.console_opps && window.__sb.tables.console_opps.vsd")
    ck("signed in, the save drains to Supabase console_opps", bool(sbOpp) and sbOpp.get("slug")=="vsd", sbOpp)
    ck("the opportunity row carries the record but not the page html", sbOpp and ("html" not in (sbOpp.get("data") or {})))
    sbPage = pg.evaluate("()=>window.__sb.tables.console_pages && window.__sb.tables.console_pages.vsd")
    ck("the page is its own console_pages row, html whole", bool(sbPage) and len(sbPage.get("html") or "")==len(big))
    onlyConsole = pg.evaluate("()=>Object.keys(window.__sb.tables).every(t=>t.indexOf('console_')===0)")
    ck("every Supabase request targeted a console_ table only", onlyConsole)

    # 2. Signed OUT: a save is queued honestly, never in Supabase, and drains on sign-in (the #104 contract).
    pg.evaluate(SIGN_OUT)
    pg.evaluate("()=>window.saveDraft({ slug:'jia', business:'Simply Jia', outreach_text:'Hi' })")
    pg.wait_for_timeout(400)
    q = pg.evaluate("""()=>({ local: JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').some(o=>o.slug==='jia'),
      inSupa: !!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.jia),
      pending: JSON.parse(localStorage.getItem('console_sb_pending')||'[]').some(e=> (e.rows||[]).some(r=>r.slug==='jia')) })""")
    ck("signed out, the save is on the device and QUEUED, not in Supabase (honest, not a false success)",
       q["local"] is True and q["inSupa"] is False and q["pending"] is True, q)
    pg.evaluate(SIGN_IN); pg.evaluate("()=>window.thriveSupaFlush()"); pg.wait_for_timeout(400)
    drained = pg.evaluate("""()=>({ inSupa:!!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.jia),
      pending: JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length })""")
    ck("signing in drains the queued save to Supabase, the queue empties", drained["inSupa"] is True and drained["pending"]==0, drained)

    # 3. Honest divergence: a Supabase rejection does not fail the local save; it is recorded and kept queued.
    pg.evaluate("()=>{ window.__sb.failOpp = true; localStorage.setItem('console_sb_diverge','[]'); }")
    pg.evaluate("()=>window.saveDraft({ slug:'cozy', business:'Cozy Calico', outreach_text:'Hi' })")
    pg.wait_for_timeout(500)
    d = pg.evaluate("""()=>({ local: JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]').some(o=>o.slug==='cozy'),
      inSupa: !!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.cozy),
      diverge: JSON.parse(localStorage.getItem('console_sb_diverge')||'[]').length,
      stillQueued: JSON.parse(localStorage.getItem('console_sb_pending')||'[]').some(e=> (e.rows||[]).some(r=>r.slug==='cozy')) })""")
    ck("the local save still succeeds when Supabase rejects it", d["local"] is True, d)
    ck("Supabase did NOT get the rejected opp (no false success)", d["inSupa"] is False, d)
    ck("the rejection is recorded as a divergence, not swallowed", d["diverge"] >= 1, d)
    ck("the rejected write stays queued for retry (nothing lost)", d["stillQueued"] is True, d)

    # 4. Verify flags the missing opp; backfill is idempotent; a delete mirrors.
    pg.evaluate("()=>{ window.__sb.failOpp=false; }")
    v1 = pg.evaluate("async ()=>await window.supaVerify()")
    ck("verify flags the opportunity missing in Supabase (not green while they diverge)",
       (not v1["ok"]) and ("cozy" in v1["opps"]["missing"]), v1)
    r = pg.evaluate("async ()=>await window.supaBackfill()"); pg.wait_for_timeout(300)
    ck("backfill copies the set and now Supabase has cozy too", r["opps"] >= 2 and pg.evaluate("()=>!!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.cozy)"), r)
    n1 = pg.evaluate("()=>Object.keys(window.__sb.tables.console_opps).length")
    pg.evaluate("async ()=>await window.supaBackfill()"); pg.wait_for_timeout(200)
    n2 = pg.evaluate("()=>Object.keys(window.__sb.tables.console_opps).length")
    ck("backfill is idempotent (same rows on a second run)", n1 == n2, f"{n1} -> {n2}")
    pg.evaluate("()=>window.removeDraft('vsd')"); pg.wait_for_timeout(400)
    ck("removing an opportunity removes its Supabase rows", not pg.evaluate("()=>!!(window.__sb.tables.console_opps && window.__sb.tables.console_opps.vsd)"))

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL SUPABASE WRITE (STAGE 4) CHECKS PASS"))
raise SystemExit(1 if fails else 0)
