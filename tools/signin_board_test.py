"""Sign-in lands on the live board, no dead interstitial.

On the device, after a successful operator sign-in the console showed the "Sign in to see your board"
screen, and only a manual refresh brought the cards. Cause, from the code: a signed-out boot hydrate
marks the read layer authRequired + degraded (a signed-out empty read is indistinguishable from an RLS
denial), that degraded flag makes supaEnsureHydrated bail, and onGateUnlocked triggered no hydrate, so
the board kept rendering the signed-out prompt against a stale authRequired until a full refresh rebuilt
the read state while signed in.

The fix, proven here against a fake PostgREST that models RLS (signed-out reads return no rows):
  A) the auth prompt renders ONLY when there is genuinely no operator session (#84): once signed in it
     is never shown, even in the brief window before the sign-in hydrate resolves a stale authRequired;
  B) on sign-in (the unlock hook) the stale degraded/authRequired state is cleared and a hydrate fires,
     so the board lands on the live Supabase cards with no manual refresh.

The live Supabase and WebKit are Thyab's device gate; the read-cache behaviour is proven here on the
real app.js against a faithful fake of the endpoint.
"""
import threading, http.server, socketserver, functools, os, sys
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

# Source guard: the fix is in the code, not only the harness.
app = open(f"{ROOT}/library/app.js").read()
# The session guard now lives at the SOURCE (supaReadStatus), so authRequired is a pure function of "no
# session": it can never be reported true while signed in, whatever the ordering of the sign-in hydrate.
# The board reads that one signal instead of re-deciding the session at the render site.
ck("the auth prompt is gated on being signed OUT (#84 only), at the source",
   "__supa.authRequired && supaReadFlagOn() && supaOn() && !supaSignedIn()" in app
   and "const authReq = supaReadStatus().authRequired;" in app)
ck("sign-in (unlock) clears the stale read state and hydrates",
   'onThrive("unlock","supahydrate"' in app and "supaEnsureHydrated()" in app
   and "__supa.authRequired=false; __supa.hydrated=false" in app)

FAKE = r"""
() => {
  window.__real_fetch = window.fetch.bind(window);
  // locked models RLS while signed out: console_opps returns no rows (the signed-out empty read).
  window.__sb = { tables:{ console_opps:{}, console_pages:{}, console_mail:{}, console_inbound:{}, console_hits:{}, console_templates:{} }, locked:true, calls:0 };
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
        // RLS: while locked (signed out) console_opps yields no rows, the signed-out empty read.
        if (table === 'console_opps' && window.__sb.locked) return new Response('[]', {status:200, headers:{'Content-Type':'application/json'}});
        return new Response(JSON.stringify(Object.values(store)), {status:200, headers:{'Content-Type':'application/json'}});
      }
    } catch (e) {}
    return window.__real_fetch(url, opts);
  };
  return true;
}
"""

def board_state(pg):
    return pg.evaluate("""()=>({
      authShown: !document.getElementById('boardAuth').hidden,
      lanesHidden: document.getElementById('boardLanes').hidden,
      verdict: (document.getElementById('boardVerdict')||{}).textContent || '',
      cards: document.querySelectorAll('.tok[data-slug]').length
    })""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>typeof window.supaHydrate==='function' && typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(FAKE)
    pg.evaluate("()=>window.ThriveSupa.setCfg('https://fake.supabase.co','anon')")
    pg.evaluate("()=>localStorage.setItem('console_sb_read','1')")
    # A local opportunity, so a signed-in-but-not-yet-hydrated board shows the operator's cards (the local
    # fallback), not an empty screen. And a Supabase-only row the live board reads once hydrated.
    pg.evaluate("()=>localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'local-op', business:'Local Op', up:1}]))")
    pg.evaluate("()=>{ window.__sb.tables.console_opps['supa-op']={slug:'supa-op', data:{slug:'supa-op', business:'Supabase Op'}}; }")
    pg.evaluate("()=>location.hash='board'"); pg.wait_for_timeout(600)

    # 1. Signed OUT: the empty signed-out read is authRequired, and the board shows the sign-in prompt (#84).
    pg.evaluate("()=>localStorage.removeItem('console_sb_session')")
    pg.evaluate("async()=>{ await window.supaHydrate(); window.thriveBoardRefresh(); }")
    pg.wait_for_timeout(400)
    s1 = board_state(pg)
    auth_text = pg.evaluate("()=>window.t('board_auth_h')")
    ck("#84: signed out, the 'sign in to see your board' prompt shows", s1["authShown"] and s1["lanesHidden"], s1)
    ck("#84: the verdict names the sign-in state", s1["verdict"].strip() == auth_text.strip(), (s1["verdict"], auth_text))

    # 2. Guard (part B): signed IN but the read is still authRequired (RLS still locked here, so the hydrate
    #    would keep it authRequired). The prompt must be suppressed and the board must show the local cards,
    #    with no manual refresh. This is the exact window where the device showed the dead interstitial.
    pg.evaluate("()=>localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'}))")
    pg.evaluate("()=>window.thriveBoardRefresh()")   # a render in the signed-in-but-stale window
    pg.wait_for_timeout(300)
    s2 = board_state(pg)
    ck("signed in, the sign-in prompt is gone even before the hydrate resolves", not s2["authShown"], s2)
    ck("signed in, the board shows the operator's cards (local fallback), not an empty prompt", s2["cards"] >= 1, s2)

    # 3. Hydrate (part A): the sign-in unlock hook clears the stale state and hydrates; the board lands on
    #    the live Supabase card with no reload. Model the real gate finish: RLS now returns rows, fire unlock.
    url_before = pg.url
    pg.evaluate("()=>{ window.__sb.locked=false; }")               # signed-in RLS now returns rows
    pg.evaluate("()=>{ if(typeof window.onGateUnlocked==='function') window.onGateUnlocked(); }")  # the gate's finish() hook
    pg.wait_for_function("()=>[...document.querySelectorAll('.tok[data-slug]')].some(t=>t.getAttribute('data-slug')==='supa-op')", timeout=8000)
    s3 = board_state(pg)
    supa_card = pg.evaluate("()=>[...document.querySelectorAll('.tok[data-slug]')].some(t=>t.getAttribute('data-slug')==='supa-op')")
    ck("sign-in hydrates and the live Supabase card appears, no manual refresh",
       supa_card and not s3["authShown"], s3)
    ck("no page reload was needed (same document)", pg.url == url_before, (url_before, pg.url))
    ck("the read source is Supabase after the sign-in hydrate",
       pg.evaluate("()=>window.supaReadStatus().source") == "supabase", pg.evaluate("()=>window.supaReadStatus()"))

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
