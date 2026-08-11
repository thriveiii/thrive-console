"""Every queued write lands: the Stage 4 flush race is closed (queue mechanics only).

The race (named in #104 and #108, proven in the live data: a spawned child opportunity never persisted
while its inbound re-point did) lived in supaFlush. The old body snapshotted the queue once and, on
finishing, wrote its `left` back over the queue: an entry appended microseconds after the flush began (the
child opp, then the inbound row that points at it) was both absent from the snapshot AND erased by the
write-back. A second flush requested mid-flight early-returned and was lost.

Closed two ways, queue mechanics only: the flush drains until empty (re-reading the queue each cycle so a
mid-flight append is picked up in the same drain, in order, never clobbered), and a flush requested while
one runs sets a coalesced-run flag instead of no-opping. FIFO per arrival order, so a child opp lands before
the inbound row that points at it. The #108 reconstruction stays as the net, with a visibility counter that
reads zero on fresh data once the race is closed.

F1-F6 below drive a fake ThriveSupa whose upsert can be held open (to enqueue during an in-flight flush)
and made to fail (a network drop). The decisive proof stays Thyab's live SQL: after a fresh group-reply
round trip, console_opps holds the 'group--r-%' child row, and the board shows it in Replied with the
reconstruction counter at zero."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:500])

# A fake ThriveSupa.upsert/del: records every call, can hold one call open on a gate, and can be flipped to
# fail (a network drop). The store is keyed by primary key, so a replayed upsert is idempotent (no duplicate).
FAKE = r"""
() => {
  const S = window.ThriveSupa;
  window.__sb = { tables:{}, calls:[], fail:false, holdAt:null, release:null };
  const pkOf = (t,r) => (t==='console_opps'||t==='console_pages') ? r.slug : (t==='console_settings') ? r.key : r.id;
  S.upsert = async (t, rows) => {
    rows = Array.isArray(rows)? rows : [rows];
    window.__sb.calls.push({ t, ids: rows.map(r=>String(pkOf(t,r))) });
    if (window.__sb.holdAt!=null && window.__sb.calls.length===window.__sb.holdAt) {
      await new Promise(res => { window.__sb.release = res; });
    }
    if (window.__sb.fail) throw new Error('network drop');
    const store = window.__sb.tables[t] || (window.__sb.tables[t] = {});
    rows.forEach(r => { store[String(pkOf(t,r))] = r; });
    return true;
  };
  S.del = async (t, q) => {
    window.__sb.calls.push({ t, del:q });
    if (window.__sb.fail) throw new Error('network drop');
    return true;
  };
  return true;
}
"""

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

def sign_in(pg):
    pg.evaluate("""()=>{ window.ThriveSupa.setCfg('https://fake.supabase.co','anon-key');
      localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt', uid:'op', email:'op@x'})); }""")
def sign_out(pg):
    pg.evaluate("()=>localStorage.removeItem('console_sb_session')")
def reset_queue(pg):
    pg.evaluate("""()=>{ localStorage.removeItem('console_sb_pending');
      window.__sb.tables={}; window.__sb.calls=[]; window.__sb.fail=false; window.__sb.holdAt=null; window.__sb.release=null; }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(250)
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(350)
    pg.wait_for_function("()=>typeof window.thriveSupaFlush==='function' && !!window.ThriveSupa", timeout=15000)
    pg.evaluate(FAKE)
    sign_in(pg)

    # ---- F1: two writes queued microseconds apart during an active flush both land, in order, one drain ----
    reset_queue(pg)
    f1 = pg.evaluate("""async ()=>{
      window.__sb.holdAt = 1;                                 // hold the flush open on its first upsert
      localStorage.setItem('console_sb_pending', JSON.stringify([{op:'upsert',t:'console_opps',rows:[{slug:'a',data:{}}]}]));
      const running = window.thriveSupaFlush();               // starts, blocks on call #1 (slug a)
      await new Promise(r=>setTimeout(r,20));
      // now a flush is in-flight and held; enqueue two more, microseconds apart:
      window.supaQueueUpsert('console_opps', {slug:'b', data:{}});
      window.supaQueueUpsert('console_opps', {slug:'c', data:{}});
      window.__sb.release();                                  // let the held first call complete
      await running; await new Promise(r=>setTimeout(r,30));
      return { landed:Object.keys(window.__sb.tables.console_opps||{}).sort(),
               order:window.__sb.calls.map(c=>c.ids.join('')),
               pending:JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length }; }""")
    ck("F1 both writes queued during an active flush land (a, b, c all in Supabase)",
       f1["landed"]==["a","b","c"], f1)
    ck("F1 they land in order and the queue fully drains (nothing stranded)",
       f1["order"]==["a","b","c"] and f1["pending"]==0, f1)

    # ---- F2: a group spawn (child opp + inbound re-point) mid-flush; child present, pointer never alone ----
    reset_queue(pg)
    f2 = pg.evaluate("""async ()=>{
      window.__sb.holdAt = 1;
      localStorage.setItem('console_sb_pending', JSON.stringify([{op:'upsert',t:'console_opps',rows:[{slug:'seed',data:{}}]}]));
      const running = window.thriveSupaFlush();
      await new Promise(r=>setTimeout(r,20));
      // the spawn path, in its real order: the child opportunity FIRST, then the inbound row that points at it
      window.supaQueueUpsert('console_opps', {slug:'g--r-abc', data:{spawned_from:{parent:'g'}}});
      window.supaQueueUpsert('console_inbound', {id:'in1', data:{opp:'g--r-abc'}});
      window.__sb.release();
      await running; await new Promise(r=>setTimeout(r,30));
      const calls = window.__sb.calls;
      const childIdx = calls.findIndex(c=>c.t==='console_opps' && c.ids.indexOf('g--r-abc')>=0);
      const ptrIdx   = calls.findIndex(c=>c.t==='console_inbound' && c.ids.indexOf('in1')>=0);
      return { childLanded: !!(window.__sb.tables.console_opps||{})['g--r-abc'],
               ptrLanded: !!(window.__sb.tables.console_inbound||{})['in1'],
               childBeforePtr: childIdx>=0 && ptrIdx>=0 && childIdx<ptrIdx,
               pending: JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length }; }""")
    ck("F2 the spawned child opportunity persists to console_opps (the flush-race loss is gone)",
       f2["childLanded"] is True, f2)
    ck("F2 the child lands before the inbound row that points at it (never a pointer without its target)",
       f2["childBeforePtr"] is True and f2["ptrLanded"] is True and f2["pending"]==0, f2)

    # ---- F3: a 100-entry batch queued while flushing; all land, drain loops until empty, no starvation ----
    reset_queue(pg)
    f3 = pg.evaluate("""async ()=>{
      window.__sb.holdAt = 1;
      localStorage.setItem('console_sb_pending', JSON.stringify([{op:'upsert',t:'console_opps',rows:[{slug:'x0',data:{}}]}]));
      const running = window.thriveSupaFlush();
      await new Promise(r=>setTimeout(r,20));
      for(let i=1;i<=100;i++) window.supaQueueUpsert('console_opps', {slug:'x'+i, data:{}});
      window.__sb.release();
      await running; await new Promise(r=>setTimeout(r,60));
      return { count:Object.keys(window.__sb.tables.console_opps||{}).length,
               pending:JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length }; }""")
    ck("F3 all 101 entries (seed + 100 queued mid-flush) land; the drain loops until empty",
       f3["count"]==101 and f3["pending"]==0, f3)

    # ---- F4: a network drop mid-drain; the remainder stays queued, next flush completes it, no loss/dup ----
    reset_queue(pg)
    f4a = pg.evaluate("""async ()=>{
      const batch=[]; for(let i=1;i<=6;i++) batch.push({op:'upsert',t:'console_opps',rows:[{slug:'n'+i,data:{}}]});
      localStorage.setItem('console_sb_pending', JSON.stringify(batch));
      window.__sb.holdAt = 3;                                  // hold on the 3rd call, flip the network there
      const running = window.thriveSupaFlush();
      await new Promise(r=>setTimeout(r,20));
      window.__sb.fail = true;                                 // network drops mid-drain
      window.__sb.release();
      await running; await new Promise(r=>setTimeout(r,30));
      return { landed:Object.keys(window.__sb.tables.console_opps||{}).sort(),
               pending:JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length }; }""")
    ck("F4 a network drop mid-drain leaves the remainder queued (no loss): first two landed, rest still pending",
       f4a["landed"]==["n1","n2"] and f4a["pending"]==4, f4a)
    f4b = pg.evaluate("""async ()=>{
      window.__sb.fail=false; window.__sb.holdAt=null;        // network recovers
      await window.thriveSupaFlush();
      return { landed:Object.keys(window.__sb.tables.console_opps||{}).length,
               pending:JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length }; }""")
    ck("F4 the next flush completes the remainder; all six land exactly once, queue empty (no duplicate)",
       f4b["landed"]==6 and f4b["pending"]==0, f4b)

    # ---- F5: signed-out queue is honest and untouched; sign-in auto-drains (the #104 behavior) --------------
    reset_queue(pg)
    sign_out(pg)
    f5a = pg.evaluate("""async ()=>{
      window.supaQueueUpsert('console_opps', {slug:'off1', data:{}});
      window.supaQueueUpsert('console_opps', {slug:'off2', data:{}});
      await new Promise(r=>setTimeout(r,20));
      return { pending:JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length,
               landed:Object.keys(window.__sb.tables.console_opps||{}).length }; }""")
    ck("F5 signed out, the writes are queued honestly on the device and nothing is sent (RLS would refuse)",
       f5a["pending"]==2 and f5a["landed"]==0, f5a)
    sign_in(pg)
    f5b = pg.evaluate("""async ()=>{ await window.thriveSupaFlush();   // sign-in triggers the same flush (via hydrate)
      return { pending:JSON.parse(localStorage.getItem('console_sb_pending')||'[]').length,
               landed:Object.keys(window.__sb.tables.console_opps||{}).sort() }; }""")
    ck("F5 signing in auto-drains the queued writes (the #104 behavior, re-proven)",
       f5b["landed"]==["off1","off2"] and f5b["pending"]==0, f5b)

    # ---- F6: the reconstruction net reads zero on fresh data once the child opp actually persists ----------
    reset_queue(pg)
    f6 = pg.evaluate("""()=>{
      window.__thriveReconCount = 0; window.invalidateRecon();
      localStorage.removeItem('console_sb_read');                  // read the local store, not Supabase
      const child = window.childSlugFor('grp','pat@x');
      // the store as the CLOSED race leaves it: the parent group AND the persisted child opp are both present.
      const opps = [
        { slug:'grp', business:'Group', published:true, stage:'sent',
          recipients:[{addr:'pat@x',name:'Pat'},{addr:'d@x',name:'Dee'}] },
        { slug:child, business:'Pat', published:true, spawned_from:{parent:'grp',addr:'pat@x'}, recipients:[{addr:'pat@x',name:'Pat'}] } ];
      localStorage.setItem('thrive_opps_v1', JSON.stringify(opps));
      localStorage.setItem('thrive_mail_v1', JSON.stringify([{mid:'s',opp:'grp',to:'pat@x',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]));
      localStorage.setItem('thrive_inbound_v1', JSON.stringify([{gid:'r',opp:child,kind:'reply',from:'pat@x',subject:'Re: Blast',ts:'2026-08-02T10:00:00Z'}]));
      window.invalidateRecon();
      const drafts = window.getDrafts();
      const childPresent = drafts.some(o=>o.slug===child && !o._reconstructed);
      const reconstructedAny = drafts.some(o=>o._reconstructed);
      return { count: window.__thriveReconCount, childPresent, reconstructedAny,
               childStage: window.effStage(window.getDraft(child)) }; }""")
    ck("F6 with the child opportunity persisted, the reconstruction net fires zero times (counter stays 0)",
       f6["count"]==0 and f6["reconstructedAny"] is False and f6["childPresent"] is True, f6)
    ck("F6 the child still reads Replied from its real (persisted) card, no net needed",
       f6["childStage"]=="replied", f6)
    # and the net still works when a child IS genuinely missing (the counter is a real signal, not dead code)
    f6b = pg.evaluate("""()=>{
      window.__thriveReconCount = 0; window.invalidateRecon();
      const child = window.childSlugFor('grp','pat@x');
      const opps = [ { slug:'grp', business:'Group', published:true, stage:'sent',
        recipients:[{addr:'pat@x',name:'Pat'},{addr:'d@x',name:'Dee'}] } ];   // child opp REMOVED (a gap)
      localStorage.setItem('thrive_opps_v1', JSON.stringify(opps));
      window.invalidateRecon();
      const drafts = window.getDrafts();
      return { count: window.__thriveReconCount, reconstructed: drafts.some(o=>o.slug===child && o._reconstructed) }; }""")
    ck("F6 the net is a live signal: a genuinely missing child still reconstructs and increments the counter",
       f6b["count"]==1 and f6b["reconstructed"] is True, f6b)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL FLUSH-RACE CHECKS PASS"))
raise SystemExit(1 if fails else 0)
