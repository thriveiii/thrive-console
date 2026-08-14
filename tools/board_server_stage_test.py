"""The board reads ONE server-computed stage and buckets by it. It computes no stage of its own.

The oscillation and the fabricated states (a card with page opens but zero sends reading Opened) came from
the client composing each card's stage at render time from several scattered async sources. This brief moves
the computation to a Postgres view, console_board; the board reads the view and only buckets by the
returned stage. This proves, on the real app.js against a faithful fake of PostgREST:

  1. Source: stage-model's board stage delegates to boardViewStage; app.js has boardViewStage / baseStage /
     readBoardView, and the board build feeds the view's open_count and idle_days.
  2. The board buckets each card by the view's stage, verbatim (opened, replied, sent, and the base live/draft).
  3. No client re-derivation on the board: a card the view calls 'live' stays live even when the LOCAL mail
     and hits would derive it to sent/opened. The evidence stores cannot move a board lane anymore.
  4. The fabrication ends: a card with page opens but no send, absent from the view, is base live/draft,
     never Opened.
  5. Determinism: three consecutive settled paints with no data change are byte-identical (zero DIVERGED),
     and no card changes lane between refreshes.

The live Supabase and WebKit are Thyab's device gate; the board behavior is proven here on the real code.
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
sm = open(f"{ROOT}/library/stage-model.js").read()

ck("stage-model routes the board's stage through the host boardViewStage (one board authority)",
   'if (typeof global.boardViewStage === "function") return global.boardViewStage(o);' in sm)
ck("app.js exposes the view read path (boardViewStage, baseStage, readBoardView) and the view store",
   "function boardViewStage(o)" in app and "function baseStage(o)" in app
   and "async function readBoardView()" in app and "var __boardView={}" in app)
ck("the base stage is record-only (a declared terminus, else page/email -> live, else draft); it never re-derives",
   'return isLive(o) ? "live" : "draft";' in app and "getMailLog" not in app.split("function baseStage(o)")[1].split("}")[0])
ck("the board build feeds the view's open_count and idle_days (display verbatim, one source with the lane)",
   "opens[o.slug]=boardViewOpens(o.slug)" in app and "boardViewIdle(o.slug)" in app)
ck("reconcile/read on hydrate and sync (the view refreshes with the board's other reads)",
   "await readBoardView();" in app)
ck("no em dash / zero-Lotus in the touched sources",
   "—" not in app and "lotus" not in app.lower() and "—" not in sm and "lotus" not in sm.lower())

# ============================ live ============================
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_mail:{}, console_inbound:{},
                           console_hits:{}, console_comments:{}, console_templates:{}, console_board:{} } };
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        const u = new URL(url); const table = (u.pathname.split('/rest/v1/')[1]||'').split('?')[0];
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const method = (opts&&opts.method)||'GET';
        if (method==='POST'){ (JSON.parse(opts.body||'[]')).forEach(r=>{ store[r.slug||r.id]=r; }); return new Response('',{status:201}); }
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch(e){}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

def lane_of(pg, slug):
    return pg.evaluate("(s)=>{ const t=document.querySelector('.tok[data-slug=\"'+s+'\"]'); return t?t.getAttribute('data-lane'):null; }", slug)

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

    # The cards. 'd-localsend' and 'rise' carry LOCAL evidence (a delivered send, page opens) that the old
    # client would derive to sent/opened; neither is in the view, so the board must show their record-only
    # base (live), proving the evidence stores can no longer move a board lane.
    pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([
        {slug:'a-opened', business:'A', published:true, up:1},
        {slug:'b-replied', business:'B', published:true, up:1},
        {slug:'c-sent', business:'C', published:true, up:1},
        {slug:'d-localsend', business:'D', published:true, up:1},
        {slug:'e-draft', business:'E', up:1},
        {slug:'rise', business:'Rise Dance', published:true, up:1}]));
      // Local evidence that WOULD flip d-localsend to opened and rise to opened under the old derivation.
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'md', opp:'d-localsend', to:'x@x', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1', JSON.stringify([
        {type:'open', slug:'d-localsend', ts:'2026-08-02T10:00:00Z', vid:'v1'},
        {type:'open', slug:'rise', ts:'2026-08-02T10:00:00Z', vid:'v2'},
        {type:'open', slug:'rise', ts:'2026-08-03T10:00:00Z', vid:'v3'}]));
      localStorage.setItem('thrive_inbound_v1','[]');
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
      // The server-computed view: a/b/c present, d/e/rise ABSENT (so they fall to the record-only base).
      window.__sb.tables.console_board = {
        'a-opened':{slug:'a-opened', stage:'opened', open_count:3, replied:false, idle_days:2, has_page:true, has_email:false, archived:false},
        'b-replied':{slug:'b-replied', stage:'replied', open_count:1, replied:true, idle_days:1, has_page:true, has_email:false, archived:false},
        'c-sent':{slug:'c-sent', stage:'sent', open_count:0, replied:false, idle_days:5, has_page:true, has_email:false, archived:false}
      };
    }""")
    pg.evaluate("async()=>{ await window.supaHydrate(); }")   # readBoardView folds console_board into __boardView
    pg.evaluate("()=>{ location.hash='board'; }")
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(400)

    # 2. Each card buckets by the view's stage, verbatim.
    ck("a card the view calls 'opened' is in the opened lane", lane_of(pg,'a-opened')=='opened', lane_of(pg,'a-opened'))
    ck("a card the view calls 'replied' is in the replied lane", lane_of(pg,'b-replied')=='replied', lane_of(pg,'b-replied'))
    ck("a card the view calls 'sent' is in the sent lane", lane_of(pg,'c-sent')=='sent', lane_of(pg,'c-sent'))
    ck("a published card the view does not hold shows its base 'live' (ready)", lane_of(pg,'e-draft') in (None,'draft') and lane_of(pg,'d-localsend')=='live', {"d":lane_of(pg,'d-localsend'),"e":lane_of(pg,'e-draft')})

    # 3. No client re-derivation: d-localsend has a LOCAL delivered send + open, which the old board derived
    #    to opened. It is not in the view, so it stays live. The evidence stores cannot move the lane.
    ck("a card with a local send+open but no view row is live, NOT opened (no client re-derivation)",
       lane_of(pg,'d-localsend')=='live', lane_of(pg,'d-localsend'))

    # 4. The fabrication ends: 'rise' has page opens but no send and no view row -> base live, never opened.
    ck("Rise Dance (page opens, zero sends, absent from the view) is live/draft, never Opened",
       lane_of(pg,'rise') in ('live','draft'), lane_of(pg,'rise'))

    # the displayed open count is the view's, verbatim (a-opened reads its 3 from the view)
    meta_a = pg.evaluate("()=>{ const t=document.querySelector('.tok[data-slug=\"a-opened\"] .tok-meta'); return t?t.textContent:''; }")
    ck("the card shows the view's open_count verbatim (a-opened: 3)", "3" in meta_a, meta_a)

    # 5. Determinism: three settled paints, identical hash, zero DIVERGED, no lane jump.
    det = pg.evaluate("""async ()=>{
      await window.thriveBoardRefresh(); const h1=(window.ThrivePaintDebug.last||{}).hash;
      await window.thriveBoardRefresh(); const h2=(window.ThrivePaintDebug.last||{}).hash;
      await window.thriveBoardRefresh(); const h3=(window.ThrivePaintDebug.last||{}).hash;
      return { h1, h2, h3 }; }""")
    ck("three consecutive settled paints produce identical hashes (zero DIVERGED, no oscillation)",
       det["h1"]==det["h2"]==det["h3"] and bool(det["h1"]), det)
    lanes_again = {s: lane_of(pg, s) for s in ['a-opened','b-replied','c-sent','d-localsend','rise']}
    ck("no card changed lane across refreshes (a:opened b:replied c:sent d:live rise:live)",
       lanes_again=={'a-opened':'opened','b-replied':'replied','c-sent':'sent','d-localsend':'live','rise':'live'}, lanes_again)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
