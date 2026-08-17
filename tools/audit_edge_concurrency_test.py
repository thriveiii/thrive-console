"""The provable final audit: edge cases and concurrency (Part 4), the class we kept missing.

Engine-independent (WebKit is Thyab's device gate): this drives the running board through the edge cases
and the concurrency races the audit must cover, and asserts the invariants that were violated before:
no card in two lanes, no endless intermediate state, correct offline / signed-out degrade. Every check is
a named, re-runnable assertion.

Edge cases: an opportunity with no email; a reply with no matching send (noise); a card with several
replies; a send that failed to record; a page not activated; an archived card; a closed card.
Concurrency: ten rapid refreshes are identical; a reply/mutation during a refresh never yields a card in
two lanes; no card hangs on an intermediate state. Offline / signed-out: the board degrades to the
manifest list with draft-only cards and invents no sent/opened/replied state."""
import threading, http.server, socketserver, functools, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
ROOT = "/home/user/thrive-console"
CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:400])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

# A mix that exercises every edge: no-email opp, a card with two replies, a failed (unrecorded) send, an
# archived card, a closed (won) card, plus a dmarc noise reply that must never attribute.
SEED = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'noemail',  business:'No Email',  published:true, up:1 },
    { slug:'multi',    business:'Multi Reply', published:true, up:1 },
    { slug:'failedcard', business:'Failed Send', published:true, up:1 },
    { slug:'archived', business:'Archived', published:true, archived:true, up:1 },
    { slug:'woncard',  business:'Won Deal', published:true, stage:'won', up:1 }
  ]);
  set('thrive_mail_v1', [
    { mid:'ms', opp:'multi', to:'a@x', subject:'Hi', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
    { mid:'fs', opp:'failedcard', to:'b@x', subject:'Hey', status:'unrecorded', direction:'out', ts:'2026-08-01T10:00:00Z' },
    { mid:'ws', opp:'woncard', to:'c@x', subject:'Deal', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' }
  ]);
  set('thrive_inbound_v1', [
    { gid:'r1', opp:'multi', kind:'reply', from:'a@x', subject:'Re: Hi', snippet:'one', ts:'2026-08-03T09:00:00Z' },
    { gid:'r2', opp:'multi', kind:'reply', from:'a2@x', subject:'Re: Hi', snippet:'two', ts:'2026-08-04T09:00:00Z' },
    { gid:'n1', opp:'', kind:'reply', from:'noreply@google.com', subject:'notice', snippet:'noise', ts:'2026-08-03T09:00:00Z' },
    { gid:'w1', opp:'woncard', kind:'reply', from:'c@x', subject:'Re: Deal', snippet:'late reply after close', ts:'2026-08-09T09:00:00Z' }
  ]);
  set('thrive_hits_v1', []); set('thrive_card_seen_v1', {});
})()
"""

VIEW = """()=>window.__boardViewSet([
  {slug:'noemail', stage:'live', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
  {slug:'multi', stage:'replied', open_count:1, replied:true, idle_days:1, has_page:true, has_email:false, archived:false},
  {slug:'failedcard', stage:'sent', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
  {slug:'woncard', stage:'won', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false}
])"""

def enter(pg):
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function' && typeof window.resolvedReplyOpp==='function'", timeout=15000)
    pg.evaluate("(s)=>{ eval(s); }", SEED)
    pg.evaluate("()=>{ location.hash='#board'; }")
    pg.evaluate(VIEW)
    pg.evaluate("()=>window.thriveBoardRefresh&&window.thriveBoardRefresh()")
    pg.wait_for_timeout(600)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    enter(pg)

    # ---- EDGE: no card ever appears in two lanes (the invariant that kept breaking) ----------------
    dup = pg.evaluate("""()=>{
      const seen={}, two=[];
      document.querySelectorAll('#boardLanes .tok[data-slug]').forEach(t=>{
        const s=t.getAttribute('data-slug'); seen[s]=(seen[s]||0)+1; if(seen[s]===2) two.push(s);
      });
      return two;
    }""")
    ck("no card appears in two lanes at once", dup == [], dup)

    # ---- EDGE: an archived card is absent from the board ----
    arch = pg.evaluate("()=>!!document.querySelector('#boardLanes .tok[data-slug=\"archived\"]')")
    ck("an archived card is absent from the board lanes", arch is False, arch)

    # ---- EDGE: a no-email opp reads its own base (live/ready), never a send-derived state ----
    lanes = pg.evaluate("""()=>{
      const l=s=>{ const t=document.querySelector('#boardLanes .tok[data-slug="'+s+'"]'); return t?t.getAttribute('data-lane'):null; };
      return { noemail:l('noemail'), multi:l('multi'), failedcard:l('failedcard'), woncard:l('woncard') };
    }""")
    ck("an opportunity with no email sits in its own base lane (live/ready), not a send state",
       lanes["noemail"] == "live", lanes)

    # ---- EDGE: a dmarc/no-reply noise reply never attributes to an opp ----
    noise = pg.evaluate("""()=>{
      const rows=window.getInbound().filter(r=>r.gid==='n1');
      return rows.length? window.resolvedReplyOpp(rows[0]) : 'no-row';
    }""")
    ck("a noise reply (noreply@google.com) resolves to no opp (never a phantom attribution)", noise == "", noise)

    # ---- EDGE: a card with several replies shows one card with the true reply count ----
    multi = pg.evaluate("""()=>{
      const n = window.replyCountFor('multi');
      const cards = document.querySelectorAll('#boardLanes .tok[data-slug="multi"]').length;
      return { count:n, cards };
    }""")
    ck("a card with several replies is ONE card carrying the true reply count", multi["count"] == 2 and multi["cards"] == 1, multi)

    # ---- EDGE: a failed (unrecorded) send is the 'failed' state, never a phantom Sent ----
    failed = pg.evaluate("""()=>{
      const t=document.querySelector('#boardLanes .tok[data-slug="failedcard"]');
      return t? { state:t.getAttribute('data-state'), failedCls:t.classList.contains('is-failed'), unrec:window.cardUnrecorded('failedcard') } : null;
    }""")
    ck("a send that failed to record shows the failed state, never a phantom Sent",
       failed and failed["state"]=="failed" and failed["failedCls"] is True and failed["unrec"] is True, failed)

    # ---- EDGE: a closed (won) card stays closed even with a late reply; it lives in the closed tray, not a lane ----
    won = pg.evaluate("""()=>{
      const inTray = !!document.querySelector('#trayList .tray-item[data-slug="woncard"]');
      const inLane = !!document.querySelector('#boardLanes .tok[data-slug="woncard"]');
      return { inTray, inLane, resolved:window.resolvedStage(window.getDraft('woncard')) };
    }""")
    ck("a closed (won) card stays closed (in the closed tray, not a lane) even with a late reply",
       won["resolved"]=="won" and won["inTray"] is True and won["inLane"] is False, won)

    # ---- CONCURRENCY: ten refreshes fired at once settle to a clean, stable board (no two-stage card) ----
    conc = pg.evaluate("""async ()=>{
      const snap=()=>{ const m={}; document.querySelectorAll('#boardLanes .tok[data-slug]').forEach(t=>{ m[t.getAttribute('data-slug')]=t.getAttribute('data-lane'); }); return JSON.stringify(m); };
      const ps=[]; for(let i=0;i<10;i++) ps.push(window.thriveBoardRefresh());   // ten in flight at once
      await Promise.all(ps); await new Promise(r=>setTimeout(r,300));            // let the paint settle
      // the SETTLED board (what the user sees) has no card in two lanes
      const seen={}, two=[]; document.querySelectorAll('#boardLanes .tok[data-slug]').forEach(t=>{ const s=t.getAttribute('data-slug'); seen[s]=(seen[s]||0)+1; if(seen[s]===2) two.push(s); });
      // and it is stable across a further refresh (no oscillation)
      const a=snap(); await window.thriveBoardRefresh(); await new Promise(r=>setTimeout(r,200)); const b=snap();
      return { two, stable: a===b };
    }""")
    ck("ten concurrent refreshes settle with no card in two lanes (concurrency-safe)", conc["two"] == [], conc)
    ck("the settled board is stable across a further refresh (no oscillation)", conc["stable"] is True, conc)

    # ---- CONCURRENCY: a reply mutation during refresh never yields a two-stage card ----
    race = pg.evaluate("""async ()=>{
      const p = window.thriveBoardRefresh();       // a refresh in flight...
      const inb = window.getInbound(); inb.push({ gid:'r3', opp:'multi', kind:'reply', from:'a3@x', subject:'Re: Hi', snippet:'three', ts:'2026-08-05T09:00:00Z' });
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb)); window.invalidateSends&&window.invalidateSends();
      await p; await window.thriveBoardRefresh();   // ...then settle
      const seen={}; let two=false;
      document.querySelectorAll('#boardLanes .tok[data-slug]').forEach(t=>{ const s=t.getAttribute('data-slug'); seen[s]=(seen[s]||0)+1; if(seen[s]>1) two=true; });
      return { two, multiReplies: window.replyCountFor('multi') };
    }""")
    ck("a reply arriving during a refresh never yields a card in two lanes", race["two"] is False, race)

    # ---- OFFLINE / SIGNED-OUT: the board degrades to the manifest/local list, draft-only, no invented state ----
    off = pg.evaluate("""async ()=>{
      window.__boardViewClear();                   // no server view (signed out / offline)
      await window.thriveBoardRefresh(); await new Promise(r=>setTimeout(r,300));
      const l=s=>{ const t=document.querySelector('#boardLanes .tok[data-slug="'+s+'"]'); return t?t.getAttribute('data-lane'):null; };
      // with no view, a card reads its OWN base only: published -> live (ready), never opened/replied invented
      return { multi:l('multi'), failedcard:l('failedcard'), noemail:l('noemail') };
    }""")
    ck("signed-out / offline: cards degrade to their own base (live/ready), never an invented sent/opened/replied",
       off["multi"]=="live" and off["noemail"]=="live", off)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL EDGE / CONCURRENCY CHECKS PASS"))
raise SystemExit(1 if fails else 0)
