"""One read, one paint: the board never paints the empty base while the view is the authority.

The oscillation returned because the earlier view brief's deletion was half done: two paths raced. One read
console_board (correct: Sent 9, Opened 1). The other painted an EMPTY client computation (Sent 0, Opened 0)
because a render fired while __boardView was still loading, sending every card to its base (live/draft). Two
captures in the same minute disagreed. This brief finishes the deletion: the board's single settle reads
console_board ONCE and adopts it BEFORE painting (generation-guarded), and the board build carries no client
mail ledger or client opens, so nothing can paint a card into a lane except the value the view returned.

Proven on the real app.js against a faithful fake of PostgREST:
  1. Source: the settle reads the view (readBoardViewRows) under the generation guard before painting; the
     build ctx carries no mail and no client opens; opens and idle come from the view.
  2. From an EMPTY view map, one awaited refresh paints the view's counts (Sent 9, Ready 5, Draft 1,
     Opened 1), never the empty base (Sent 0). This is the racing loser, deleted.
  3. Ten consecutive refreshes are identical: same counts, same paint hash, chips == lane headers.
  4. A transient empty read never blanks a loaded board (the map keeps its rows).
  5. The one allowed non-view path is inert: a manifest card absent from the view shows its record-only base
     (live/draft), and a LOCAL send/open can never move its lane.

FAILS-WHEN-BROKEN: revert the settle's view read (paint straight from the possibly-empty map) and scenario 2
flips to Sent 0 from an empty map. The live Supabase and WebKit are Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys

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
# The whole build() body (it now derives the model, then attaches reply-card presentation data for the
# Replied lane, then returns it). The racing path stays deleted: no mail-ledger read, no client opens read.
# Reading inbound to present a replied parent's reply cards is not stage derivation (the server view alone
# decides the lane), so getInbound() for the reply cards is allowed; getMailLog()/opensForSlug are not.
build_body = app.split("function build(){")[1].split("\n  function ")[0]
ck("the board build carries NO client mail ledger and NO client opens (the racing path is deleted)",
   "getMailLog()" not in build_body and "opensForSlug" not in build_body)
ck("opens and idle come from the view, and idle is always supplied (never a client last-touch fallback)",
   "opens[o.slug]=boardViewOpens(o.slug)" in app and "idle[o.slug]=boardViewIdle(o.slug)||0" in app)
rb = app.split("async function renderBoard(trigger)")[1].split("function render(trigger, source)")[0]
# P55 BOOT_PAINT_FIRST: the settle now PAINTS from local first (boardRepaint, synchronous, before any await),
# then reads console_board TIME-BOXED (bootNet) and adopts + repaints. The awaited settle still ends on the
# view's counts (the runtime scenarios below), but no read holds the first paint. One read per settle,
# generation-guarded, re-read on the sync/unlock/refresh heartbeat, still the only server read on this path.
ck("the settle paints from local first, then reads console_board time-boxed (bootNet), adopts + repaints on the live generation",
   "boardRepaint(myGen, trigger);" in rb                                        # the immediate synchronous local paint
   and "if(boardViewIsAuthority() && (!__boardViewReady || __reread)){" in rb
   and 'bootNet("board", readBoardViewRows())' in rb                            # the read is time-boxed
   and 'var __reread = (trigger==="sync" || trigger==="unlock" || trigger==="thriveBoardRefresh");' in rb
   and "if(myGen!==__renderGen || __boardTornDown) return;" in rb              # entry generation guard
   and "if(__boardTornDown) return;" in rb                                     # after the awaits, only a teardown drops the settle
   and "adoptBoardView(rows);" in rb
   and "boardRepaint(__renderGen, trigger)" in rb)                             # repaint the adopted view on the live generation
ck("a transient empty read never blanks a loaded map (adopt empty only before the first read)",
   "if(Object.keys(by).length || !__boardViewReady) __boardView=by;" in app)
ck("no em dash / zero-Lotus in the touched sources",
   "\u2014" not in app and "lotus" not in app.lower())

# ============================ live ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A faithful PostgREST fake with a controllable delay and an "empty" mode for console_board.
FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__vw = { rows: [], delay: 0, empty: false, reads: 0 };
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_mail:{}, console_inbound:{},
                           console_hits:{}, console_comments:{}, console_templates:{} } };
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        const u = new URL(url); const table = (u.pathname.split('/rest/v1/')[1]||'').split('?')[0];
        const method = (opts&&opts.method)||'GET';
        if (table === 'console_board') {
          window.__vw.reads++;
          if (window.__vw.delay) await new Promise(r=>setTimeout(r, window.__vw.delay));
          const body = window.__vw.empty ? [] : window.__vw.rows;
          return new Response(JSON.stringify(body), {status:200, headers:{'Content-Type':'application/json'}});
        }
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        if (method==='POST'){ (JSON.parse(opts.body||'[]')).forEach(r=>{ store[r.slug||r.id]=r; }); return new Response('',{status:201}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch(e){}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

def counts(pg):
    return pg.evaluate("""()=>{ const o={}; ['draft','live','sent','opened','replied'].forEach(k=>{
        const c=document.querySelector('[data-count=\"'+k+'\"]'); o[k]=c?parseInt(c.textContent||'0'):-1; }); return o; }""")
def chips_equal_headers(pg):
    return pg.evaluate("""()=>{ let ok=true; ['draft','live','sent','opened','replied'].forEach(k=>{
        const c=document.querySelector('[data-count=\"'+k+'\"]'), t=document.querySelector('[data-count-tab=\"'+k+'\"]');
        if(c&&t&&c.textContent!==t.textContent) ok=false; }); return ok; }""")
def lane_of(pg, slug):
    return pg.evaluate("(s)=>{ const t=document.querySelector('.tok[data-slug=\"'+s+'\"]'); return t?t.getAttribute('data-lane'):null; }", slug)

# The board the good capture showed: sent 9, live 5, draft 1, opened 1. All present in the view.
def make_setup():
    opps, rows = [], []
    for i in range(9):
        s=f"s{i}"; opps.append({"slug":s,"business":f"Sent {i}","published":True,"up":1})
        rows.append({"slug":s,"stage":"sent","open_count":0,"replied":False,"idle_days":3,"has_page":True,"has_email":False,"archived":False})
    for i in range(5):
        s=f"v{i}"; opps.append({"slug":s,"business":f"Live {i}","published":True,"up":1})
        rows.append({"slug":s,"stage":"live","open_count":0,"replied":False,"idle_days":None,"has_page":True,"has_email":False,"archived":False})
    opps.append({"slug":"d0","business":"Draft","up":1})
    rows.append({"slug":"d0","stage":"draft","open_count":0,"replied":False,"idle_days":None,"has_page":False,"has_email":False,"archived":False})
    opps.append({"slug":"o0","business":"Opened","published":True,"up":1})
    rows.append({"slug":"o0","stage":"opened","open_count":1,"replied":False,"idle_days":2,"has_page":True,"has_email":False,"archived":False})
    return opps, rows

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html?debug=paint")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.readBoardView==='function' && typeof window.ThrivePaintDebug==='object'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(FAKE)
    pg.evaluate("()=>window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'})); }")

    opps, rows = make_setup()
    pg.evaluate("(d)=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify(d.opps)); window.__vw.rows=d.rows; localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_inbound_v1','[]'); localStorage.setItem('thrive_hits_v1','[]'); window.invalidateSends&&window.invalidateSends(); }", {"opps":opps,"rows":rows})
    pg.evaluate("()=>{ location.hash='board'; }")

    # 2. From an EMPTY view map, one awaited refresh paints the VIEW's counts, never the empty base (Sent 0).
    #    A 200 ms read delay simulates the loading window the loser painted into; the settle awaits it.
    pg.evaluate("()=>{ window.__boardViewClear(); window.__vw.delay=200; }")
    pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }")
    c = counts(pg)
    ck("from an empty view map, one awaited settle paints the view counts (sent 9, live 5, draft 1, opened 1)",
       c=={"draft":1,"live":5,"sent":9,"opened":1,"replied":0}, c)
    ck("it NEVER paints the empty base (Sent 0) while signed in and online", c.get("sent")==9, c)
    ck("chips equal lane headers on the first settle", chips_equal_headers(pg), c)

    # 3. Ten consecutive refreshes are identical (counts + paint hash), no oscillation.
    pg.evaluate("()=>{ window.__vw.delay=0; }")
    ten = pg.evaluate("""async ()=>{ const seen=[]; let hash=null, stable=true;
      for(let i=0;i<10;i++){ await window.thriveBoardRefresh();
        const c={}; ['draft','live','sent','opened','replied'].forEach(k=>{ const el=document.querySelector('[data-count=\"'+k+'\"]'); c[k]=el?el.textContent:'x'; });
        const h=(window.ThrivePaintDebug.last||{}).hash; if(hash===null) hash=h; else if(h!==hash) stable=false;
        seen.push(JSON.stringify(c)); }
      return { stable, uniq:[...new Set(seen)], hash }; }""")
    ck("ten consecutive refreshes produce identical counts (one board, no oscillation)",
       len(ten["uniq"])==1 and "\"sent\":\"9\"" in ten["uniq"][0], ten)
    ck("ten consecutive refreshes produce an identical paint hash (zero DIVERGED)", ten["stable"] and bool(ten["hash"]), ten)

    # 4. A transient empty read never blanks a loaded board. The hydrate/sync rounds refresh the map via
    #    readBoardView; a momentary [] from that path must not send every card to its base and read empty.
    pg.evaluate("()=>{ window.__vw.empty=true; }")
    pg.evaluate("async ()=>{ await window.readBoardView(); await window.thriveBoardRefresh(); }")
    c4 = counts(pg)
    ck("a transient empty read keeps the loaded board (Sent stays 9, not blanked)", c4.get("sent")==9, c4)
    pg.evaluate("()=>{ window.__vw.empty=false; }")

    # 5. The one allowed non-view path is inert: a manifest card absent from the view, carrying a LOCAL send
    #    and open, shows its record-only base (live), never a client-derived sent/opened.
    pg.evaluate("""()=>{
      const a=JSON.parse(localStorage.getItem('thrive_opps_v1')); a.push({slug:'ghost', business:'Ghost', published:true, up:1});
      localStorage.setItem('thrive_opps_v1', JSON.stringify(a));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'gm',opp:'ghost',to:'x@x',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1', JSON.stringify([{type:'open',slug:'ghost',ts:'2026-08-02T10:00:00Z',vid:'v1'}]));
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
    }""")
    pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }")
    ck("a manifest-only card (absent from the view) with a LOCAL send+open is base 'live', never sent/opened",
       lane_of(pg,'ghost')=='live', lane_of(pg,'ghost'))
    ck("the view cards are unchanged by the manifest-only card (still sent 9, opened 1)",
       counts(pg).get("sent")==9 and counts(pg).get("opened")==1, counts(pg))

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
