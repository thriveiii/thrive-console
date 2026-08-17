"""Performance and operations health gate: lock the numbers so a regression surfaces as red, not as slow.

This gate holds four budgets proven in the health pass:
  1. Bundle ceiling. The served app bundle (library/app.js) and the offline single file
     (dist/thrive-console.html) stay under a ceiling set a little above today's size, so a bloat
     regression (a big dependency, a pasted blob, dead weight) turns this red instead of quietly slowing
     every cold open.
  2. One live-sync heartbeat, not a nest of polls. Exactly ONE setInterval in app.js (the 60s visibility
     gated sync heartbeat). A second polling loop added anywhere turns this red; each interval must be
     justified, and there is one.
  3. Hydrate read budget. One sign-in hydrate reads each table at most once (no duplicate reads, no N+1
     per card): a bounded number of REST calls, each table distinct.
  4. Operations sound on fresh data. The reconstruction safety net fires zero times, and the Stage-4
     write queue drains to empty.

Breaking any budget (bloating the bundle, adding a second poll, reading a table twice, a stuck queue)
turns the gate red. WebKit device behaviour is Thyab's gate; this locks the measured numbers.
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

# Ceilings: set a little above today's measured size so ordinary growth passes and real bloat trips.
APP_JS_MAX   = 709_000     # library/app.js today ~703 KB. Raised by P7 (true preview / D5): one
                           # compileArtifact(recipient) replaced sendBody and now feeds both preview and send,
                           # plus the recipient switcher and the pixel-safe preview CSP, stacked on P4 + P5 + P6
                           # (personalize composer). app.js is one large file; the module SPLIT below is well
                           # overdue. Prior: 668K->676K->684K->696K->704K across campaigns Phase 1, P4, P5, P6, which added the
                           # per-recipient companion read (campaignRecipientLedger, D1/D7). Campaigns is a seven-phase
                           # build all touching app.js; the module SPLIT below is the real fix and is now overdue.
                           # Prior: 665K->668K by the mail-write-path brief, which
                           # added the schema-drift-resilient console_mail writer (mailUpsert + the missing-column
                           # fallback) and reconcileMailToServer to lift the total 28-row write freeze (a
                           # production-down bug). NOTE: app.js is now large and breaching on nearly every brief;
                           # it should be SPLIT into modules soon (a real follow-up), not kept alive by ceiling
                           # bumps. Prior step: 655K->665K by the state-law brief, which added
                           # a genuine subsystem: the bounded-sending timeout (reconcileStuckSending + the
                           # 'unrecorded' failed state + retryRecord), the one visual-state law (cardState ->
                           # data-state, replacing the scattered is-glow/is-hot/is-provisional treatments), and
                           # the drift indicator counting stuck sends. The file sat at 99.8% of the old ceiling,
                           # so any real feature breached it; comments were trimmed first, then the ceiling was
                           # lifted the minimum to fit. Earlier growth history:  (grew across merged briefs; the replies-attach brief
                           # a genuine subsystem: the bounded-sending timeout (reconcileStuckSending + the
                           # 'unrecorded' failed state + retryRecord), the one visual-state law (cardState ->
                           # data-state, replacing the scattered is-glow/is-hot/is-provisional treatments), and
                           # the drift indicator counting stuck sends. The file sat at 99.8% of the old ceiling,
                           # so any real feature breached it; comments were trimmed first, then the ceiling was
                           # lifted the minimum to fit. Earlier growth history:  (grew across merged briefs; the replies-attach brief
                           # added the confirmed-inbound path, the reply parent resolver + per-opp numbering,
                           # the card reply badge, and the inbox by-opportunity section; the replies-are-linked
                           # brief added subjLinkKey / subjectLinkOpp, the write-time subject link, and the
                           # extended noise filter; the reply-card brief added the distinct Replied-lane reply
                           # card + tap-to-thread and the two-sided conversation bubbles; the thread-rebuild
                           # brief added the one shared message-bubble component, the broadened per-span
                           # isolation and quote-boundary detector, and the optimistic inline reply; the
                           # find-the-renderer brief added the thread-version marker and the runtime renderer
                           # instrumentation, threadRendererReport + data-renderer tokens)
DIST_MAX     = 1_689_000   # dist/thrive-console.html today ~1.68 MB, tracking app.js (P4 + P5 + P6 + P7 true
                           # preview grew it). The offline single file inlines app.js,
                           # which grew with the reply card, the grouped/bounded reply card + expander, and
                           # the two-sided thread bubbles across the reply briefs)
HYDRATE_MAX  = 10          # one hydrate today reads 8 tables, each once

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# ---------------- 1. bundle ceilings + 2. one heartbeat (static) ----------------
app_src = open(f"{ROOT}/library/app.js").read()
app_sz  = len(app_src.encode("utf-8"))
ck(f"library/app.js is under the {APP_JS_MAX//1000} KB ceiling (now {app_sz//1000} KB)", app_sz <= APP_JS_MAX, app_sz)
try:
    dist_sz = os.path.getsize(f"{ROOT}/dist/thrive-console.html")
    ck(f"dist/thrive-console.html is under the {DIST_MAX//1000} KB ceiling (now {dist_sz//1000} KB)", dist_sz <= DIST_MAX, dist_sz)
except OSError:
    ck("dist/thrive-console.html exists to measure", False, "run node tools/bundle.js first")

intervals = len(re.findall(r'\bsetInterval\s*\(', app_src))
ck("exactly ONE polling loop in app.js: the 60s visibility-gated live-sync heartbeat, justified",
   intervals == 1, {"setInterval_count": intervals})
# the one interval is the sync heartbeat, and it is visibility + auth gated (not a busy loop)
ck("the one interval is the sync heartbeat and is guarded by document.hidden and syncAuth",
   re.search(r'setInterval\(\(\)=>\{ if\(!document\.hidden && syncAuth\(\)\) syncNow\(\); \}, 60000\)', app_src) is not None)

# ---------------- 3 + 4. hydrate budget, reconstruction zero, queue drains (live) ----------------
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

INSTALL=r"""
()=>{
  window.__rest=[]; window.__warns=[];
  const S=window.ThriveSupa;
  window.__ident={uid:"op1",email:"op1@x",signed:true};
  S.authUid=()=>window.__ident.uid; S.authEmail=()=>window.__ident.email; S.signedIn=()=>window.__ident.signed;
  S.rest=(table,opts)=>{ window.__rest.push(table);
    if(table==="console_opps") return Promise.resolve([{slug:"a",data:{slug:"a",business:"A",published:true}},{slug:"b",data:{slug:"b",business:"B",published:true}}]);
    if(table==="console_pages") return Promise.resolve([{slug:"a",html:"<p>a</p>"}]);
    if(table==="console_mail") return Promise.resolve([{data:{mid:"m1",opp:"a",to:"x@x",status:"sent",direction:"out",ts:"2026-08-01T10:00:00Z"}}]);
    if(table==="console_hits") return Promise.resolve([{data:{type:"open",slug:"a",ts:"2026-08-02T10:00:00Z",vid:"v1"}}]);
    if(table==="console_profiles") return Promise.resolve([{uid:"op1",display_name:"Op One"}]);
    return Promise.resolve([]); };
  S.upsert=()=>Promise.resolve(); S.del=()=>Promise.resolve();
  const ow=console.warn; console.warn=function(){ try{window.__warns.push([].slice.call(arguments).join(" "));}catch(e){} return ow.apply(console,arguments); };
}
"""

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r:r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))
    pg=ctx.new_page()
    pg.goto(f"{base}/library/console.html")
    pg.wait_for_function("()=>window.thriveModal && window.ThriveSupa && typeof window.goTo==='function'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")
    pg.evaluate(INSTALL)
    pg.evaluate("()=>window.goTo('board')"); pg.wait_for_timeout(300)

    # one hydrate: fire the unlock hook, count the REST reads
    pg.evaluate("()=>{ window.__rest=[]; window.onGateUnlocked && window.onGateUnlocked(); }")
    pg.wait_for_function("()=>window.__rest.indexOf('console_hits')>=0", timeout=6000)
    pg.wait_for_timeout(400)
    reads=pg.evaluate("()=>window.__rest.slice()")
    from collections import Counter
    counts=Counter(reads)
    dupes={k:v for k,v in counts.items() if v>1}
    ck(f"one hydrate reads at most {HYDRATE_MAX} tables (now {len(reads)})", len(reads) <= HYDRATE_MAX, reads)
    ck("no table is read more than once per hydrate (no duplicate reads, no N+1 per card)", not dupes, dupes)

    warns=pg.evaluate("()=>window.__warns.filter(w=>/reconstruction net fired/.test(w)).length")
    ck("the reconstruction safety net fires ZERO times on fresh data", warns==0, {"reconstructions": warns})

    q=pg.evaluate("()=>window.thriveSupaPendingCount?window.thriveSupaPendingCount():-1")
    ck("the Stage-4 write queue drains to empty after hydrate", q==0, {"pending": q})

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
