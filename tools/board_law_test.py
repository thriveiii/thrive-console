"""Board behavior law (P3). Engine-independent; WebKit is Thyab's device gate.

R6 - one recency clock, every lane: lastActivityAt is the latest of sends / token opens / inbound /
stage change; a malformed ts sorts last, never throws; every lane paints newest activity on top, and a
new event lifts a card to the top of its lane on refresh.

R5 - the badge means one thing: activity newer than the owner's SERVER-held last view. Opening the card
advances last_viewed_at on the opp record (cross-device), which by definition clears the badge; a new
token-bearing open relights it with count 1; an anonymous view never lights it; no badge boolean is stored.
"""
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

# Three sent cards in the same (opened) lane with different recency; vsd carries a token-bearing open
# whose ts is OLD (so its badge is about acknowledgment, not recency). A malformed-ts hit must not throw.
SEED = r"""
(() => {
  const set=(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  set('thrive_opps_v1', [
    { slug:'aaa', business:'Aaa Co', published:true, up:1 },
    { slug:'bbb', business:'Bbb Co', published:true, up:1 },
    { slug:'vsd', business:'VSD Photography', published:true, up:1 }
  ]);
  var TK = window.recipientOpenToken('vsd','client@vsd.example','Hello');
  set('thrive_mail_v1', [
    { mid:'m-aaa', opp:'aaa', to:'a@x', subject:'Hi', status:'sent', direction:'out', ts:'2026-08-01T10:00:00Z' },
    { mid:'m-bbb', opp:'bbb', to:'b@x', subject:'Hi', status:'sent', direction:'out', ts:'2026-08-05T10:00:00Z' },
    { mid:TK,     opp:'vsd', to:'client@vsd.example', subject:'Hello', status:'sent', direction:'out', ts:'2026-08-02T10:00:00Z' }
  ]);
  // vsd got a token-bearing open on Aug 3 (8 days before "now"); plus a malformed-ts hit that must not throw.
  set('thrive_hits_v1', [
    { type:'open', slug:'vsd', ts:'2026-08-03T09:00:00Z', vid:'v1', r:TK },
    { type:'open', slug:'vsd', ts:'not-a-date', vid:'v2', r:TK }
  ]);
  set('thrive_inbound_v1', []); set('thrive_card_seen_v1', {});
  window.__TK = TK;
  window.__boardViewSet([
    {slug:'aaa', stage:'opened', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
    {slug:'bbb', stage:'opened', open_count:0, replied:false, idle_days:1, has_page:true, has_email:false, archived:false},
    {slug:'vsd', stage:'opened', open_count:1, replied:false, idle_days:8, has_page:true, has_email:false, archived:false}
  ]);
})()
"""

def enter(pg):
    pg.goto(f"{base}/library/console.html")
    if pg.query_selector("#gateInput"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn")
    pg.wait_for_function("()=>typeof window.lastActivityAt==='function' && typeof window.cardNewActivity==='function' && typeof window.markCardSeen==='function' && typeof window.lastViewedAt==='function' && typeof window.thriveBoardRefresh==='function'", timeout=15000)
    pg.evaluate("(s)=>{ eval(s); }", SEED)
    pg.evaluate("()=>{ location.hash='#board'; }")
    pg.evaluate("()=>window.thriveBoardRefresh&&window.thriveBoardRefresh()")
    pg.wait_for_timeout(600)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    enter(pg)

    # ---- R6: lastActivityAt is the recency clock; malformed ts never throws (sorts last) ----
    la = pg.evaluate("""()=>({ aaa:window.lastActivityAt('aaa'), bbb:window.lastActivityAt('bbb'), vsd:window.lastActivityAt('vsd') })""")
    ck("lastActivityAt returns a real ms for each card, and a malformed hit ts did not throw",
       la["aaa"]>0 and la["bbb"]>0 and la["vsd"]>0, la)
    ck("bbb (sent Aug 5) is more recent than vsd (last activity Aug 3) which is more recent than aaa (Aug 1)",
       la["bbb"]>la["vsd"]>la["aaa"], la)

    # ---- R6: the opened lane paints newest activity on top ----
    order = pg.evaluate("""()=>Array.from(document.querySelectorAll('#boardLanes .lane[data-lane="opened"] .tok[data-slug], #boardLanes .tok[data-slug]')).map(t=>t.getAttribute('data-slug'))""")
    opened = [s for s in order if s in ("aaa","bbb","vsd")]
    ck("the lane paints newest activity on top (bbb, then vsd, then aaa)", opened[:3]==["bbb","vsd","aaa"], opened)

    # ---- R6: a new event lifts a card to the top on refresh ----
    lifted = pg.evaluate("""async ()=>{
      const inb=window.getInbound(); inb.push({ gid:'r-aaa', opp:'aaa', kind:'reply', from:'a@x', subject:'Re: Hi', snippet:'now', ts:'2026-08-09T09:00:00Z' });
      localStorage.setItem('thrive_inbound_v1', JSON.stringify(inb));
      await window.thriveBoardRefresh(); await new Promise(r=>setTimeout(r,300));
      const ord=Array.from(document.querySelectorAll('#boardLanes .tok[data-slug]')).map(t=>t.getAttribute('data-slug')).filter(s=>['aaa','bbb','vsd'].includes(s));
      return ord;
    }""")
    ck("a new event lifts aaa to the top of its lane on refresh", lifted[0]=="aaa", lifted)

    # ---- R5: the badge is the SERVER-held acknowledgment; opening clears it, no badge boolean ----
    before = pg.evaluate("()=>window.cardNewActivity('vsd')")
    ck("vsd carries a badge (a token open the owner has not yet acknowledged), count 1", before==1, before)

    ack = pg.evaluate("""()=>{
      window.markCardSeen('vsd');                       // open the card -> advance last_viewed_at on the record
      var rec=window.getDraft('vsd');
      return { lvSet: !!(rec && rec.last_viewed_at), count: window.cardNewActivity('vsd'), viewed: window.lastViewedAt('vsd') };
    }""")
    ck("opening the card writes last_viewed_at on the opp record (server-held, cross-device)", ack["lvSet"] is True, ack)
    ck("opening the card clears the badge by definition (count 0), with no stored badge flag", ack["count"]==0, ack)

    # ---- R5: cross-device - even with the LOCAL seen map cleared, the record's ack still clears the badge ----
    xdev = pg.evaluate("""()=>{
      localStorage.setItem('thrive_card_seen_v1','{}');   // simulate a second device with no local seen map
      return window.cardNewActivity('vsd');
    }""")
    ck("the acknowledgment holds across devices (local seen cleared, record ack still clears the badge)", xdev==0, xdev)

    # ---- R5: a NEW token open after the view relights the badge with count 1 ----
    # Control the acknowledgment explicitly (past) so the assertion is independent of the real clock.
    relit = pg.evaluate("""()=>{
      window.saveDraft({ slug:'vsd', last_viewed_at:'2026-08-04T00:00:00Z' });   // acknowledged as of Aug 4
      localStorage.setItem('thrive_card_seen_v1','{}');                          // record is authoritative
      var hits=JSON.parse(localStorage.getItem('thrive_hits_v1')||'[]');
      hits.push({ type:'open', slug:'vsd', ts:'2026-08-05T09:00:00Z', vid:'v3', r:window.__TK });   // NEW, after the ack
      localStorage.setItem('thrive_hits_v1', JSON.stringify(hits));
      return window.cardNewActivity('vsd');
    }""")
    ck("a new tokenized open after the view relights the badge with count 1", relit==1, relit)

    # ---- R5: an ANONYMOUS view never lights the badge ----
    anon = pg.evaluate("""()=>{
      window.saveDraft({ slug:'vsd', last_viewed_at:'2026-08-06T00:00:00Z' });   // acknowledged past every token open
      var hits=JSON.parse(localStorage.getItem('thrive_hits_v1')||'[]');
      hits.push({ type:'open', slug:'vsd', ts:'2026-08-07T09:00:00Z', vid:'v4' });   // NO r: anonymous
      localStorage.setItem('thrive_hits_v1', JSON.stringify(hits));
      return window.cardNewActivity('vsd');
    }""")
    ck("an anonymous (untokened) view never lights the badge", anon==0, anon)

    b.close()

httpd.shutdown()
print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL BOARD LAW CHECKS PASS"))
raise SystemExit(1 if fails else 0)
