"""The entry: no barrier, and a warm arrival (WO-030).

Two halves of one surface, proven on the real app.js against a faithful fake of PostgREST (a signed-out
read returns no rows, the signed-out empty read that is indistinguishable from an RLS denial).

  §1 THE BARRIER, at the root. The "Sign in to see your board" prompt is a pure function of "no session".
     authRequired is decided in ONE place (supaReadStatus), where it ANDs in !supaSignedIn(), so a stale
     authRequired left over from a signed-out boot hydrate - the exact device defect, where the prompt
     persisted after a completed sign-in until a manual refresh - can never surface once an operator is
     signed in, regardless of whether the sign-in hydrate has resolved. The board reads that one signal.
     Genuinely signed out (#84) still shows the prompt.

  §2 THE WARM ARRIVAL. When the real board first comes on screen (a cold open resolving, a sign-in
     landing, the hydrate returning the live board) the lanes settle from a soft blur into focus and the
     count chips tick up to their values over the same half-second, replacing the dead gap with a calm
     entrance. It plays once per arrival, opacity and filter only (GPU-cheap, no layout). Under reduced
     motion the board is in focus at once and the numbers are at their value: no settle, no count.

The live Supabase and WebKit at three widths in both languages are Thyab's device gate.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"; CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

# ---- Source guards: the fix and the entrance are in the code, not only the harness ----
app = open(f"{ROOT}/library/app.js").read()
css = open(f"{ROOT}/library/styles.css").read()

ck("§1 authRequired is session-aware at its SOURCE (one signed-in state machine)",
   "__supa.authRequired && supaReadFlagOn() && supaOn() && !supaSignedIn()" in app)
ck("§1 the hydrate catch never sets authRequired while signed in",
   "__supa.authRequired = !!(e && e.authRequired) && !supaSignedIn();" in app)
ck("§1 the board reads the one signal, not a second session check at the render site",
   "const authReq = supaReadStatus().authRequired;" in app
   and "supaReadStatus().authRequired && !supaSignedIn()" not in app)
ck("§1 a returning operator's reveal signals the unlock (live hydrate on a presence return)",
   re.search(r'target === "board"\s*\)\s*\{\s*finish\(\);', app_gate := open(f"{ROOT}/library/gate.js").read()) is not None)
ck("§2 the settle is blur-to-focus, opacity and filter only (no transform, no layout)",
   "@keyframes board-settle" in css and "filter:blur(7px)" in css and "filter:blur(0)" in css
   and "translate" not in css.split("@keyframes board-settle")[1].split("}")[1])
ck("§2 the settle honours reduced motion (instant)",
   "@media (prefers-reduced-motion:reduce){ .board.board-settle{ animation:none } }" in css)
ck("§2 the entrance plays once per arrival and counts the chips up",
   "function playBoardArrival()" in app and "function countUp(" in app
   and "#boardPipeline .pl-n, #boardChips [data-chip] b" in app
   and "if(boardShown && !boardLive)" in app)

# A faithful fake of PostgREST: a signed-out read of console_opps returns no rows (RLS while locked).
FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_mail:{}, console_inbound:{}, console_hits:{}, console_templates:{} }, locked:true };
  const pk = t => (t==='console_opps'||t==='console_pages') ? 'slug' : 'id';
  window.fetch = async (url, opts) => {
    try {
      if (typeof url === 'string' && url.indexOf('/rest/v1/') >= 0) {
        const u = new URL(url);
        const table = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
        const method = (opts && opts.method) || 'GET';
        const store = window.__sb.tables[table] || (window.__sb.tables[table] = {});
        const key = pk(table);
        if (method === 'POST') { (JSON.parse(opts.body||'[]')).forEach(r => { store[r[key]] = r; }); return new Response('', {status:201}); }
        if (method === 'DELETE') { return new Response('', {status:204}); }
        if (table === 'console_opps' && window.__sb.locked) return new Response('[]', {status:200, headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

def mount(pg):
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.supaHydrate==='function' && typeof window.thriveBoardRefresh==='function' && typeof window.supaReadStatus==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(FAKE)
    pg.evaluate("()=>window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")
    pg.evaluate("()=>localStorage.setItem('console_sb_read','1')")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(300)

def board_state(pg):
    return pg.evaluate("""()=>({
      authShown: !document.getElementById('boardAuth').hidden,
      lanesHidden: document.getElementById('boardLanes').hidden,
      cards: document.querySelectorAll('.tok[data-slug]').length,
      statusAuthReq: window.supaReadStatus().authRequired,
      settle: document.getElementById('boardLanes').classList.contains('board-settle')
    })""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)

    # ============================ §1  THE BARRIER, AT THE ROOT ============================
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page(); mount(pg)
    # A local opportunity, so a signed-in board (before a live hydrate) shows the operator's own cards.
    pg.evaluate("()=>localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'local-op', business:'Local Op', up:1}]))")

    # Signed OUT: a signed-out boot hydrate marks the read authRequired; the board shows the prompt (#84).
    pg.evaluate("()=>localStorage.removeItem('console_sb_session')")
    pg.evaluate("async()=>{ await window.supaHydrate(); await window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(300)
    s_out = board_state(pg)
    ck("#84: genuinely signed out, the sign-in prompt shows", s_out["authShown"] and s_out["lanesHidden"], s_out)
    ck("#84: the internal read state is authRequired while signed out", s_out["statusAuthReq"], s_out)

    # Sign IN, and DO NOT re-hydrate. The internal authRequired is still true (stale from the signed-out
    # boot). This is the precise window the device sat in: a completed sign-in over a stale authRequired.
    # The source guard must make the prompt impossible here, on a plain render, with no manual refresh.
    pg.evaluate("()=>localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'}))")
    pg.evaluate("async()=>{ await window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(200)
    s_in = board_state(pg)
    ck("§1 ROOT: signed in over a STALE authRequired, supaReadStatus reports authRequired=false", not s_in["statusAuthReq"], s_in)
    ck("§1 ROOT: the sign-in prompt is gone, the board shows the operator's cards (no manual refresh)",
       not s_in["authShown"] and s_in["cards"] >= 1, s_in)

    # Re-render three consecutive times while signed in and stale: the prompt never flickers back.
    flick = []
    for _ in range(3):
        pg.evaluate("async()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(120)
        flick.append(board_state(pg)["authShown"])
    ck("§1 ROOT: three consecutive signed-in renders, the prompt never returns", not any(flick), flick)
    pg.close(); ctx.close()

    # ============================ §2  THE WARM ARRIVAL (motion on) ============================
    ctx = b.new_context(viewport={"width":1280,"height":900}, reduced_motion="no-preference")
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page(); mount(pg)

    # Signed out first: the prompt is up, the board is NOT yet live (so the arrival has not fired).
    pg.evaluate("()=>localStorage.removeItem('console_sb_session')")
    pg.evaluate("async()=>{ await window.supaHydrate(); await window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(200)
    ck("§2: before sign-in the board is not live and carries no settle", not board_state(pg)["settle"])

    # Sign in and land the live board (eight opportunities). The not-live -> live transition is the arrival:
    # the settle class goes on the lanes and the count chips start from below their value.
    pg.evaluate("""()=>{ for(let i=0;i<8;i++){ window.__sb.tables.console_opps['op'+i]={slug:'op'+i, data:{slug:'op'+i, business:'Op '+i}}; } window.__sb.locked=false; localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'})); }""")
    arrival = pg.evaluate("""async()=>{
        await window.supaHydrate();
        await window.thriveBoardRefresh();   // the arrival fires at this render's tail
        // sampled at the earliest instant after the arrival: the count-up has not advanced yet
        const now = [...document.querySelectorAll('#boardPipeline .pl-n')].map(n=>parseInt(n.textContent||'0',10)||0);
        return { immediate: now.reduce((a,c)=>a+c,0), settle: document.getElementById('boardLanes').classList.contains('board-settle') };
    }""")
    pg.wait_for_timeout(900)   # the half-second count-up (and the settle) has finished
    settled = pg.evaluate("""()=>{ const now=[...document.querySelectorAll('#boardPipeline .pl-n')].map(n=>parseInt(n.textContent||'0',10)||0);
        return { total: now.reduce((a,c)=>a+c,0), cards: document.querySelectorAll('.tok[data-slug]').length,
                 auth: !document.getElementById('boardAuth').hidden }; }""")
    ck("§2: sign-in lands directly on the live board (eight cards, no prompt)",
       settled["cards"] == 8 and not settled["auth"], settled)
    ck("§2: the lanes settle in (the blur-to-focus arrival class is applied)", arrival["settle"], arrival)
    ck("§2: the count chips animate up - they start BELOW their final value",
       arrival["immediate"] < settled["total"], (arrival, settled))
    ck("§2: the count chips finish AT their value (the pipeline totals the eight opportunities)",
       settled["total"] == 8, settled)
    pg.close(); ctx.close()

    # ============================ §2  REDUCED MOTION (instant) ============================
    ctx = b.new_context(viewport={"width":1280,"height":900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page(); mount(pg)
    pg.evaluate("()=>localStorage.removeItem('console_sb_session')")
    pg.evaluate("async()=>{ await window.supaHydrate(); await window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(150)
    pg.evaluate("""()=>{ for(let i=0;i<8;i++){ window.__sb.tables.console_opps['op'+i]={slug:'op'+i, data:{slug:'op'+i, business:'Op '+i}}; } window.__sb.locked=false; localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'})); }""")
    rm = pg.evaluate("""async()=>{
        await window.supaHydrate();
        await window.thriveBoardRefresh();
        const now = [...document.querySelectorAll('#boardPipeline .pl-n')].map(n=>parseInt(n.textContent||'0',10)||0);
        return { immediate: now.reduce((a,c)=>a+c,0), settle: document.getElementById('boardLanes').classList.contains('board-settle') };
    }""")
    ck("§2 reduced motion: the numbers are at their final value AT ONCE (no count-up)", rm["immediate"] == 8, rm)
    ck("§2 reduced motion: no blur-to-focus settle class is applied (instant)", not rm["settle"], rm)
    pg.close(); ctx.close()

    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
