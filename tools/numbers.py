"""WO-012 phase 6: one definition per number, and surviving real volume.

The pure module has its own test. This asserts the parts a pure module cannot: that the board,
Insights and the window agree on the same data, that a double sync moves nothing, that a 60 day
run at 30 operations a day still totals correctly after the logs have truncated, and that the
storage surfaces exist and tell the truth.

Run it: python3 tools/numbers.py
"""
import threading, http.server, socketserver, functools, os, sys, json

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
EP = f"{base}/exec"

STORE = {"data": None}
def relay(route):
    if route.request.method == "GET":
        return route.fulfill(status=200, body="Thrive relay v4 is running.")
    d = json.loads(route.request.post_data or "{}")
    op = d.get("op")
    if op == "state_get": return route.fulfill(status=200, body=json.dumps({"ok": True, "data": STORE["data"]}))
    if op == "state_put":
        STORE["data"] = d.get("data")
        return route.fulfill(status=200, body=json.dumps({"ok": True}))
    if op == "hits_get": return route.fulfill(status=200, body=json.dumps({"ok": True, "events": []}))
    return route.fulfill(status=200, body=json.dumps({"ok": True, "id": "x"}))

from playwright.sync_api import sync_playwright
fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    ctx.route("**/exec", relay)
    ctx.route("**/library/sync.json", lambda r: r.fulfill(status=200, body=json.dumps({"ep": EP, "up": 1})))
    ctx.route("https://api.github.com/**", lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1500)
    pg.reload(); pg.wait_for_timeout(2800)

    ck("the pure module passes its own test", pg.evaluate("()=>ThriveNumbers.selfTest().pass"),
       pg.evaluate("()=>ThriveNumbers.selfTest()"))

    # ---- one function per quantity, and every surface calls it ---------------
    ck("there is exactly one function per quantity", pg.evaluate(
        """()=>['views','opens','uniqueOpens','sentToday','sentMonth','peopleContacted',
                'replies','replyRate','needsFollowup'].every(k=>typeof ThriveNumbers[k]==='function')"""))
    ck("an off channel send counts exactly as an email does", pg.evaluate("""()=>{
        const ctx={today:'2026-08-03',month:'2026-08',hits:[],activity:[],rollup:{},
          mail:[{mid:'m1',to:'a@x.example',direction:'out',status:'sent',ts:'2026-08-03T09:00:00Z'}],
          opps:[{slug:'c',manual_contacts:[{id:'c1',channel:'web_form',sent_on:'2026-08-03'}]}]};
        return ThriveNumbers.sentToday(ctx)===2 && ThriveNumbers.peopleContacted(ctx)===2;}"""))

    # ---- volume: 60 days at 30 operations a day, then truncation -------------
    vol = pg.evaluate("""()=>{
        const mail=[], opps=[{slug:'v'}];
        const day=d=>{const x=new Date(Date.UTC(2026,4,1)); x.setUTCDate(x.getUTCDate()+d);
          return x.toISOString();};
        let n=0;
        for(let d=0; d<60; d++) for(let k=0;k<30;k++){
          mail.push({mid:'m'+d+'-'+k, opp:'v', to:'p'+((d*30+k)%400)+'@x.example',
                     direction:'out', status:'sent', ts:day(d)}); n++;
        }
        const month=ThriveNumbers.localMonth(new Date(Date.UTC(2026,6,15)));
        const ctx={mail:mail, opps:opps, hits:[], activity:[], rollup:{},
                   today:'2026-07-15', month:'2026-07'};
        const roll=ThriveNumbers.buildRollup(ctx,{});
        const total=ThriveNumbers.outbound(ctx).length;
        const people=ThriveNumbers.peopleContacted(ctx);
        // now truncate the way the 800 entry cap does, and read a closed month again
        const cut=Object.assign({},ctx,{mail:mail.slice(-800), rollup:roll});
        return {written:n, total:total, people:people,
                mayWithRoll:ThriveNumbers.sentMonth(cut,'2026-05'),
                mayNoRoll:ThriveNumbers.sentMonth(Object.assign({},cut,{rollup:{}}),'2026-05'),
                kept:mail.slice(-800).length};}""")
    print("60 days at 30 a day:", vol)
    ck("every operation is counted before truncation", vol["total"] == vol["written"] == 1800, vol)
    ck("distinct recipients are counted once each", vol["people"] == 400, vol)
    ck("a truncated log alone loses a closed month, which is the defect", vol["mayNoRoll"] == 0, vol)
    ck("and the rollup keeps it correct after truncation", vol["mayWithRoll"] == 930, vol)

    # ---- idempotency: the same batch twice ----------------------------------
    pg.evaluate("""()=>{
        setMailLog([{mid:'x1',opp:'a',to:'one@x.example',direction:'out',status:'sent',ts:new Date().toISOString()}]);
        saveDraft({slug:'a', business:'A', published:true, fields:{},
          manual_contacts:[{id:'h1',channel:'web_form',sent_on:new Date().toISOString().slice(0,10)}]});
    }""")
    pg.wait_for_timeout(400)
    before = pg.evaluate("""async ()=>{const c=await numberCtx();
        return {s:ThriveNumbers.sentToday(c), p:ThriveNumbers.peopleContacted(c)};}""")
    pg.evaluate("async ()=>{ await syncNow(); await syncNow(); }")
    pg.wait_for_timeout(2200)
    after = pg.evaluate("""async ()=>{const c=await numberCtx();
        return {s:ThriveNumbers.sentToday(c), p:ThriveNumbers.peopleContacted(c)};}""")
    print("double sync:", before, after)
    ck("a double sync leaves every count unchanged", before == after, (before, after))

    # ---- the storage surfaces ------------------------------------------------
    pg.evaluate("()=>location.hash='#settings'"); pg.wait_for_timeout(2400)
    ck("the storage meter shows usage", pg.eval_on_selector("#stMeter .st-bar", "e=>!!e"))
    ck("and the largest keys by size", pg.eval_on_selector_all("#stMeter .st-keys li", "e=>e.length") >= 1)
    ck("the relay completeness check exists", pg.eval_on_selector("#stCheck", "e=>!!e"))
    pg.click("#stCheck"); pg.wait_for_timeout(2000)
    out = pg.eval_on_selector("#stCheckOut", "e=>e.innerText")
    print("completeness:", out[:120])
    ck("and it reports a real answer", len(out.strip()) > 0, out)
    # The positive case matters most: this feature exists because a backup nobody has verified
    # is a belief, so a check that can only ever say "could not compare" is the same belief.
    ck("it can confirm a complete relay copy, not only fail to",
       pg.evaluate("""async ()=>{ await syncNow();
         const r=await relayCompleteness();
         return r.ok===true && Array.isArray(r.rows) && r.rows.length>0; }"""),
       pg.evaluate("async ()=>JSON.stringify(await relayCompleteness()).slice(0,300)"))
    ck("and it names any key the relay is short of",
       pg.evaluate("""async ()=>{ const r=await relayCompleteness();
         return r.ok && r.missing.every(m=>typeof m.key==='string' && m.mine>=m.theirs); }"""))

    ck("QuotaExceededError is caught and surfaced", pg.evaluate(
        "()=>/QuotaExceeded|catch/.test(lsSet.toString()) && /st_full_act/.test(lsSet.toString())"))
    ck("storage usage is measurable", pg.evaluate("()=>storageBytes().total>0"))

    # ---- the freshness band --------------------------------------------------
    band = pg.evaluate("""()=>{
        const old=new Date(Date.now()-5*86400000).toISOString();
        localStorage.setItem('thrive_sync_last', old);
        location.hash='#board';
        return true;}""")
    pg.wait_for_timeout(2000)
    pg.evaluate("()=>renderSyncBand()")
    pg.wait_for_timeout(500)
    ck("the freshness band appears after three days",
       pg.eval_on_selector("#boardBand", "e=>!e.hidden && e.innerText.length>10"),
       pg.eval_on_selector("#boardBand", "e=>e.innerText"))
    ck("and it says how many days, in the reader's grammar",
       any(c.isdigit() for c in pg.eval_on_selector("#boardBand", "e=>e.innerText")))
    pg.evaluate("()=>{localStorage.setItem('thrive_sync_last', new Date().toISOString()); renderSyncBand();}")
    pg.wait_for_timeout(400)
    ck("and it goes away once synced", pg.eval_on_selector("#boardBand", "e=>e.hidden"))

    ck("nothing threw", not errs, errs[:4])
    b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
