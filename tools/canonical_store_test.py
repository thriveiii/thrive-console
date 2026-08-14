"""One canonical store, one reconciled truth.

The device captures proved a store fork: localStorage (the relay/local merge point) and Supabase (__supa)
had drifted into two coherent-but-disagreeing data generations, and the board read whichever was current
per render cycle, flipping between two real worlds. The cure is a single canonical model. localStorage IS
the canonical; __supa is the server-authoritative copy; reconcileCanonical folds __supa INTO localStorage
on every hydrate and every sync round, so the two can never fork and every reader reads one reconciled
truth.

This proves, against the real app.js on a faithful fake of PostgREST:
  1. resolveAuthority collapses to one canonical model (no local-vs-supa choice), and the four board
     accessors no longer carry a __supa read branch.
  2. reconcile makes the canonical match the server on a server-recorded (confirmed) fact: a card and a
     ledger row the server holds newer win over the stale local copy.
  3. reconcile keeps a local-only optimistic pending the server has not confirmed (a local-only key
     survives), so nothing unconfirmed is dropped.
  4. a second reconcile over the same server is idempotent: the canonical is byte-stable (stable hash).
  5. on the painted board every settled paint reads that one canonical, so two consecutive paints with no
     data change are byte-identical (zero DIVERGED) and no card changes lane between refreshes.

The live Supabase and WebKit are Thyab's device gate; the reconciliation is proven here on the real code.
"""
import threading, http.server, socketserver, functools, os, sys, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

# ============================ source guards ============================
app = open(f"{ROOT}/library/app.js").read()
bundle = open(f"{ROOT}/tools/bundle.js").read()

ck("Part 1: resolveAuthority collapses to ONE canonical model, no local-vs-supa choice",
   'kind:"canonical"' in app and 'var useSupa = supaReadable()' not in app and 'kind:"supa"' not in app)
ck("Part 1: the four board accessors carry no __supa read branch (the fork is gone)",
   "if(supaReadable() && __supa.mail)" not in app and "if(supaReadable() && __supa.inbound)" not in app
   and "supaReadable() && __supa.hits" not in app and "base=__supa.opps.map" not in app)
ck("Part 2/3: reconcileCanonical + unionUp exist and fold the server copy into the canonical",
   "function reconcileCanonical()" in app and "function unionUp(localArr, serverArr, keyFn)" in app
   and "mergeKeyed(getDraftsLocal(), __supa.opps" in app)
ck("Part 3: reconcile runs on every hydrate AND every sync round",
   app.count("reconcileCanonical()") >= 3
   and "try{ reconcileCanonical(); }catch(_){}" in app        # end of supaHydrate
   and "try{ reconcileCanonical(); }catch(e){}" in app)        # doSyncRound, after the relay merge
ck("Part 3: the reconciled write is guarded so it cannot storm a sync-push (merges never re-trigger)",
   "var prevApplying=__syncApplying; __syncApplying=true;" in app and "__reconciling" in app)
ck("Part 5: the root redirect preserves incoming query params (so ?debug=paint reaches the shell)",
   "location.search" in bundle and '(q?("&"+q):"")' in bundle and "location.hash" in bundle)
ck("no em dash / zero-Lotus in app.js and bundle.js",
   "\u2014" not in app and "lotus" not in app.lower() and "\u2014" not in bundle and "lotus" not in bundle.lower())

# ============================ live: a faithful fake PostgREST ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# The fake models a signed-in operator reading their own rows (RLS unlocked). GET returns the table's
# rows; POST/DELETE mutate. Every table the hydrate reads is present so no slice throws.
FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_mail:{}, console_inbound:{},
                           console_hits:{}, console_comments:{}, console_templates:{} }, calls:0 };
  const pk = t => (t==='console_opps'||t==='console_pages') ? 'slug' : 'id';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        window.__sb.calls++;
        const u = new URL(url);
        const table = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
        const method = (opts && opts.method) || 'GET';
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const key = pk(table);
        if (method === 'POST') { (JSON.parse(opts.body||'[]')).forEach(r => { store[r[key]] = r; }); return new Response('', {status:201}); }
        if (method === 'DELETE') { const q=u.searchParams.get(key)||''; const m=/^eq\.(.*)$/.exec(q); if(m) delete store[decodeURIComponent(m[1])]; return new Response('', {status:204}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html?debug=paint")
    pg.wait_for_function("()=>typeof window.supaHydrate==='function' && typeof window.thriveBoardRefresh==='function' && typeof window.ThrivePaintDebug==='object'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(FAKE)
    pg.evaluate("()=>window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'})); }")

    # ---- Seed a divergent pair: localStorage (the local copy) vs Supabase (the server copy). ----
    # opps:  conf  -> both hold it; SERVER recorded it newer (up 200 vs 100) with a different business.
    #        pend  -> LOCAL ONLY, an optimistic pending the server has not confirmed (up 300).
    #        srv   -> SERVER ONLY (another device wrote it).
    # mail:  sm    -> both hold it; SERVER confirmed it 'sent' (up 200) over the local stale 'pending' (up 100).
    #        pm    -> LOCAL ONLY pending send (up 300), not yet on the server.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'conf', business:'Conf LOCAL stale', published:true, up:100},
        {slug:'pend', business:'Pend LOCAL only', published:true, up:300}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'sm', opp:'conf', to:'a@a', status:'pending', direction:'out', ts:'2026-08-10T10:00:00Z', up:100},
        {mid:'pm', opp:'pend', to:'b@b', status:'pending', direction:'out', ts:'2026-08-11T10:00:00Z', up:300}]));
      localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""")
    pg.evaluate("""()=>{
      window.__sb.tables.console_opps['conf']={slug:'conf', data:{slug:'conf', business:'Conf SERVER confirmed', published:true, up:200}};
      window.__sb.tables.console_opps['srv'] ={slug:'srv',  data:{slug:'srv',  business:'Srv SERVER only', published:true, up:150}};
      window.__sb.tables.console_mail['sm']={id:'sm', data:{mid:'sm', opp:'conf', to:'a@a', status:'sent', direction:'out', ts:'2026-08-10T10:00:00Z', up:200}};
    }""")

    # ---- Hydrate: reads the server copy into __supa, then reconcileCanonical folds it into localStorage. ----
    pg.evaluate("async()=>{ await window.supaHydrate(); }")
    pg.wait_for_timeout(200)

    canon = pg.evaluate("""()=>{
      const opps = JSON.parse(localStorage.getItem('thrive_opps_v1')||'[]');
      const mail = JSON.parse(localStorage.getItem('thrive_mail_v1')||'[]');
      const by = a => { const m={}; a.forEach(x=>{ m[x.slug||x.mid]=x; }); return m; };
      return { opps:by(opps), mail:by(mail), oppSlugs:opps.map(o=>o.slug).sort(), mailMids:mail.map(m=>m.mid).sort() };
    }""")
    # 2. confirmed facts: the canonical now matches the SERVER on the recorded card and the recorded send.
    ck("reconcile: a server-recorded card (newer up) wins in the canonical (matches server on confirmed facts)",
       canon["opps"].get("conf",{}).get("business") == "Conf SERVER confirmed", canon["opps"].get("conf"))
    ck("reconcile: a server-recorded send (newer up) wins in the canonical ledger (pending -> sent)",
       canon["mail"].get("sm",{}).get("status") == "sent", canon["mail"].get("sm"))
    ck("reconcile: a server-only card is folded into the canonical (a fact known to the server survives)",
       "srv" in canon["opps"], canon["oppSlugs"])
    # 3. local-only pending the server has not confirmed is PRESERVED (never dropped).
    ck("reconcile: a local-only pending card the server has not confirmed is kept",
       "pend" in canon["opps"] and canon["opps"]["pend"].get("business") == "Pend LOCAL only", canon["oppSlugs"])
    ck("reconcile: a local-only pending send the server has not confirmed is kept in the ledger",
       "pm" in canon["mail"] and canon["mail"]["pm"].get("status") == "pending", canon["mailMids"])

    # 4. idempotency: a second reconcile over the same server produces a byte-stable canonical (stable hash).
    snap1 = pg.evaluate("""()=>['thrive_opps_v1','thrive_mail_v1','thrive_inbound_v1','thrive_hits_remote_v1']
       .map(k=>localStorage.getItem(k)||'').join('\\u0001')""")
    pg.evaluate("async()=>{ await window.supaHydrate(); }")   # re-read + re-reconcile, server unchanged
    pg.wait_for_timeout(150)
    snap2 = pg.evaluate("""()=>['thrive_opps_v1','thrive_mail_v1','thrive_inbound_v1','thrive_hits_remote_v1']
       .map(k=>localStorage.getItem(k)||'').join('\\u0001')""")
    ck("reconcile is idempotent: a second reconcile over the same server leaves the canonical byte-stable",
       snap1 == snap2, {"len1":len(snap1),"len2":len(snap2)})

    # 5. one canonical on the painted board: two settled paints with no data change are byte-identical.
    ck("read source reports Supabase-backed (the server copy is in hand, folded into the canonical)",
       pg.evaluate("()=>window.supaReadStatus().source") == "supabase", pg.evaluate("()=>window.supaReadStatus()"))
    det = pg.evaluate("""async ()=>{
      location.hash='board';
      await window.thriveBoardRefresh(); const h1=(window.ThrivePaintDebug.last||{}).hash;
      await window.thriveBoardRefresh(); const h2=(window.ThrivePaintDebug.last||{}).hash;
      await window.thriveBoardRefresh(); const h3=(window.ThrivePaintDebug.last||{}).hash;
      return { h1, h2, h3, src:(window.ThrivePaintDebug.last||{}).src }; }""")
    ck("one canonical: three consecutive settled paints with no data change produce identical hashes (zero DIVERGED)",
       det["h1"] == det["h2"] == det["h3"] and bool(det["h1"]), det)
    # the reconciled cards (both server-confirmed and local-only pending) are on the painted board, one truth.
    cards = pg.evaluate("()=>[...document.querySelectorAll('.tok[data-slug]')].map(t=>t.getAttribute('data-slug')).sort()")
    ck("one canonical: the painted board shows the reconciled set (server-confirmed conf/srv + local-only pend)",
       all(s in cards for s in ["conf","pend","srv"]), cards)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
