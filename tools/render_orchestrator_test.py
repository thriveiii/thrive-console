"""Brief A: one render orchestrator, one derived model, one authority, one serialized synchronous paint.

This closes the count and lane oscillation at its root (F1, F2) and the derivations that fed it (F3, F4,
F5, F16). The oscillation was: about twenty triggers called an unserialized async render() directly, each
re-choosing local-vs-Supabase per accessor and reading three in-flight snapshots, and the last async build
to resolve won the DOM. Now every trigger enters renderBoard(trigger): it stamps a generation, awaits the
manifest once, and drops itself if a newer generation started while it waited (the latest wins, not the
last to resolve); past that gate it resolves ONE authority, pins it for the whole synchronous derive and
paint, and unpins. This proves the serialization (only the last of N overlapping calls paints), the
determinism (two settled paints with no data change are byte-identical, zero DIVERGED), the chip-equals-lane
invariant, and the one send definition (pending is never Sent).
"""
import threading, http.server, socketserver, functools, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT="/home/user/thrive-console"; CH="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails=[]
def ck(n,c,d=None):
    print(("PASS " if c else "FAIL ")+n)
    if not c:
        fails.append(n)
        if d is not None: print("      "+str(d)[:300])

# ============================ source guards ============================
app=open(f"{ROOT}/library/app.js").read()

ck("F2: one serialized orchestrator with a generation guard (the latest generation wins, not the last to resolve)",
   "async function renderBoard(trigger)" in app and "const myGen=++__renderGen" in app
   and "if(myGen!==__renderGen" in app)
ck("F2: every board trigger enters through renderBoard, never the raw paint (thriveBoardRefresh + the hooks)",
   'window.thriveBoardRefresh=function(){ return renderBoard(' in app
   and 'onThrive("sync","board",()=>renderBoard(' in app
   and 'onThrive("unlock","board",()=>renderBoard(' in app)
ck("F2: the derive-and-paint is synchronous (build() no longer awaits; the only await is the manifest gate)",
   "function build(){" in app and "await mergedOpps()" not in app.split("function build(){")[1].split("}")[0]
   and "const b=build();" in app)
ck("F1: one authority per cycle (resolveAuthority) pinned for the whole derive (__boardPin)",
   "function resolveAuthority()" in app and "__boardPin=source" in app)
ck("F1/F3: every board accessor honors the pin (getDrafts, getMailLog, getInbound, allHits)",
   'function getMailLog(){ if(__boardPin)' in app and 'function getInbound(){ if(__boardPin)' in app
   and "if(__boardPin){\n    base=__boardPin.opps" in app
   and "__boardPin ? __boardPin.hits" in app)
ck("F4: the 3s TTL caches are bypassed under a pin (opens, openTimes, sends)",
   app.count("if(!__boardPin &&")>=3)
ck("F5: the board reads a recipient view from a DELIVERED send only (boardViews/boardDeliveredSend), pending excluded",
   "function boardDeliveredSend(o)" in app and "function boardViews(o)" in app
   and "opens[o.slug]=boardViewOpens(o.slug)" in app and "const rv=tk.opens||0" in app)
ck("F16: a view can drop its own listeners (offThrive) and the orchestrator bails when the board is unmounted",
   "function offThrive(kind, key)" in app and 'if(!document.getElementById("boardLanes")) return;' in app)
ck("no em dash / zero-Lotus in app.js",
   "\u2014" not in app and "lotus" not in app.lower())

# ============================ live ============================
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address=True
httpd=socketserver.TCPServer(("127.0.0.1",0),Handler); PORT=httpd.server_address[1]
httpd.daemon_threads=True; threading.Thread(target=httpd.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def seed(pg, cards):
    pg.evaluate("""(cards)=>{ localStorage.setItem('thrive_opps_v1', JSON.stringify(cards));
        localStorage.setItem('thrive_mail_v1','[]'); localStorage.setItem('thrive_inbound_v1','[]');
        localStorage.setItem('thrive_hits_v1','[]'); window.invalidateSends&&window.invalidateSends();
        window.invalidateHits&&window.invalidateHits(); }""", cards)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CH)
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r:r.abort())
    ctx.route(f"{base}/library/manifest.json", lambda r:r.fulfill(status=200, body='{"opportunities":[]}'))
    pg=ctx.new_page()
    pg.goto(f"{base}/library/console.html?debug=paint")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.ThrivePaintDebug==='object'", timeout=15000)
    pg.evaluate("()=>{document.documentElement.classList.remove('gate-locked');const g=document.getElementById('thriveGate');if(g)g.remove();}")

    # ---- serialization: fire N overlapping renders with DIFFERENT store states; only the last paints ----
    seed(pg, [{"slug":"a","business":"A","published":True}])
    pg.evaluate("()=>{ location.hash='board'; }")
    pg.wait_for_timeout(400)
    pg.evaluate("()=>window.thriveBoardRefresh()"); pg.wait_for_timeout(400)   # settle, warm the manifest cache
    res=pg.evaluate("""async ()=>{
      const before=(window.ThrivePaintDebug.last||{}).seq||0;
      // fire five overlapping renders in one tick, each against a different store state
      for(let i=1;i<=5;i++){
        const cards=[]; for(let j=0;j<i;j++) cards.push({slug:'s'+i+'_'+j, business:'B', published:true});
        localStorage.setItem('thrive_opps_v1', JSON.stringify(cards));
        window.invalidateSends&&window.invalidateSends();
        window.thriveBoardRefresh();          // NOT awaited: all five overlap on the manifest gate
      }
      await new Promise(r=>setTimeout(r, 600));
      const after=(window.ThrivePaintDebug.last||{}).seq||0;
      // the last store state had 5 published cards -> the Ready lane header should read 5
      const live=document.querySelector('[data-count=\"live\"]');
      return { painted: after-before, liveCount: live? parseInt(live.textContent||'0') : -1 };
    }""")
    ck("F2: five overlapping renders paint FEWER than five times (superseded generations are dropped)",
       0 < res["painted"] < 5, res)
    ck("F2: the LATEST generation wins the DOM (the last store state, 5 Ready cards, is what shows)",
       res["liveCount"]==5, res)

    # ---- determinism: two settled paints with no data change are byte-identical (zero DIVERGED) ----
    seed(pg, [{"slug":"d1","business":"D1","published":False},
              {"slug":"l1","business":"L1","published":True},{"slug":"l2","business":"L2","published":True}])
    det=pg.evaluate("""async ()=>{
      await window.thriveBoardRefresh(); const h1=(window.ThrivePaintDebug.last||{}).hash;
      await window.thriveBoardRefresh(); const h2=(window.ThrivePaintDebug.last||{}).hash;
      await window.thriveBoardRefresh(); const h3=(window.ThrivePaintDebug.last||{}).hash;
      return { h1, h2, h3 }; }""")
    ck("F1/F2: two (and three) consecutive settled paints with no data change produce identical hashes (no oscillation)",
       det["h1"]==det["h2"]==det["h3"] and bool(det["h1"]), det)

    # ---- chip == lane for every lane, in the painted DOM ----
    same=pg.evaluate("""()=>{ let ok=true, detail={};
      ['draft','live','sent','opened','replied'].forEach(k=>{
        const c=document.querySelector('[data-count=\"'+k+'\"]');
        const t=document.querySelector('[data-count-tab=\"'+k+'\"]');
        const cv=c?c.textContent:null, tv=t?t.textContent:null; detail[k]=[cv,tv];
        if(c&&t&&cv!==tv) ok=false; });
      return { ok, detail }; }""")
    ck("F: every lane header equals its status-tab chip in the painted board (one model, two readouts)",
       same["ok"], same["detail"])

    # ---- F5: the board reads a recipient view from a DELIVERED send only; pending carries none ----
    f5=pg.evaluate("""()=>{
      localStorage.setItem('thrive_opps_v1', JSON.stringify([{slug:'pend',business:'Pend',published:true,stage:''},{slug:'gone',business:'Gone',published:true,stage:''}]));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([
        {mid:'pm',opp:'pend',to:'x@x',status:'pending',direction:'out',ts:'2026-08-10T10:00:00Z'},
        {mid:'sm',opp:'gone',to:'y@y',status:'sent',direction:'out',ts:'2026-08-10T10:00:00Z'}]));
      localStorage.setItem('thrive_hits_v1', JSON.stringify([
        {type:'open',slug:'pend',ts:'2026-08-11T09:00:00Z',vid:'v1'},
        {type:'open',slug:'gone',ts:'2026-08-11T09:00:00Z',vid:'v2'}]));
      window.invalidateSends&&window.invalidateSends(); window.invalidateHits&&window.invalidateHits();
      return { pendDelivered: window.boardDeliveredSend('pend'), pendViews: window.boardViews('pend'),
               sentDelivered: window.boardDeliveredSend('gone'), sentViews: window.boardViews('gone') }; }""")
    ck("F5: a pending-only send is NOT a delivered send, so the board shows it no recipient view",
       f5["pendDelivered"] is False and f5["pendViews"]==0, f5)
    ck("F5: a real delivered (sent) send IS a delivered send, and its recipient view still counts",
       f5["sentDelivered"] is True and f5["sentViews"]==1, f5)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
