"""WO-015 Phase E: archive that keeps everything, and recall. Proven.

  python3 tools/archive.py

Covers:
  - retention: an archived opportunity leaves the lanes, its full record and its
    whole thread retained, nothing deleted,
  - recall: an archived opportunity is found, its whole thread read, and brought
    back to its ACTIVE chapter through activeChapterStage, a documented event
    written via saveDraft then logActivity,
  - counts: the archived count matches the retained records and never shows zero
    when it holds records.

Read only. ck() helpers, no assert. Writes nothing to the repo.
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
base = "http://127.0.0.1:%d" % PORT
from playwright.sync_api import sync_playwright

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:240])

# arch-co: an archived opportunity with a full thread (a send and a reply).
# offer-co: converted (chapter 2), then archived, to prove recall is chapter aware
#   (it must come back into the offer's chapter, not the first-contact reply).
# plain-co: a live card, so the board is not empty and the count is a real subset.
SEED = """()=>{ const now=Date.now(), iso=d=>new Date(now-d*86400000).toISOString();
 localStorage.setItem('thrive_opps_v1', JSON.stringify([
  {slug:'arch-co',business:'Arch Co',published:true,up:now,stage:'replied',archived:true,prev_stage:'sent'},
  {slug:'offer-co',business:'Offer Co',published:true,up:now,stage:'replied',archived:true,prev_stage:'replied',
   converted_at:'2026-08-01T00:00:00Z',offer:{text:'the offer',html:'<p>offer</p>',published:true}},
  {slug:'plain-co',business:'Plain Co',published:true,up:now,stage:'sent'},
  {slug:'lib-conv',business:'Lib Conv',published:true,up:now,stage:'replied',
   converted_at:'2026-08-01T00:00:00Z',offer:{text:'the offer',html:'<p>offer</p>',published:true}}]));
 localStorage.setItem('thrive_mail_v1', JSON.stringify([
  {ts:iso(6),mid:'a1',opp:'arch-co',direction:'out',to:'a@x',subject:'Arch Co x Thrive',status:'sent',chapter:1},
  {ts:iso(7),mid:'o1',opp:'offer-co',direction:'out',to:'o@x',status:'sent',chapter:1},
  {ts:iso(2),mid:'o2',opp:'offer-co',direction:'out',to:'o@x',subject:'Your offer',status:'sent',chapter:2},
  {ts:iso(5),mid:'p1',opp:'plain-co',direction:'out',to:'p@x',status:'sent',chapter:1},
  {ts:iso(7),mid:'l1',opp:'lib-conv',direction:'out',to:'l@x',status:'sent',chapter:1},
  {ts:iso(2),mid:'l2',opp:'lib-conv',direction:'out',to:'l@x',subject:'Your offer',status:'sent',chapter:2}]));
 localStorage.setItem('thrive_inbound_v1', JSON.stringify([
  {ts:iso(4),opp:'arch-co',kind:'reply',from:'a@x',snippet:'a real reply worth keeping',chapter:1}]));
}"""

def unlock(pg):
    if pg.query_selector("#thriveGate"):
        pg.fill("#gateInput", "ConThrive2030"); pg.click(".gate-btn"); pg.wait_for_timeout(1200)

def lane_of(pg, slug):
    return pg.evaluate("(s)=>{ const e=document.querySelector('.tok[data-slug=\"'+s+'\"]'); return e? e.getAttribute('data-lane'):null; }", slug)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
    ctx.route("https://api.github.com/**", lambda x: x.abort())
    pg = ctx.new_page()
    pg.goto(base + "/library/console.html"); pg.wait_for_timeout(400)
    unlock(pg)
    pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(1800); unlock(pg)
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(900)

    # ---- retention: archived leaves the lanes, record and thread retained ----
    ck("an archived opportunity is not on any lane (I5)", lane_of(pg, "arch-co") is None, lane_of(pg, "arch-co"))
    ck("the archived record is retained in full, nothing deleted",
       pg.evaluate("()=>!!getDraft('arch-co') && getDraft('arch-co').business==='Arch Co'"), None)
    thread = pg.evaluate("()=>buildThread('arch-co')")
    kinds = [e["kind"] for e in thread]
    ck("the archived opportunity's whole thread still renders", "sent" in kinds and "reply" in kinds, kinds)
    ck("causalStatus reads it as archived, backed by the archive event",
       pg.evaluate("()=>causalStatus(getDraft('arch-co'))") == {"status": "archived", "event": "archive"})

    # ---- counts honest ----
    def build_counts():
        return pg.evaluate("""async()=>{ const opps=await mergedOpps(); const opens={},views={};
          opps.forEach(o=>{opens[o.slug]=outreachOpens(o); views[o.slug]=opensForSlug(o.slug);});
          const b=ThriveBoard.build(opps,{opens,views,mail:getMailLog()});
          return {archived:b.archived, laneTotal:b.summary.total}; }""")
    c = build_counts()
    retained = pg.evaluate("()=>getDrafts().filter(o=>o.archived).length")
    ck("the archived count matches the retained archived records", c["archived"] == retained and retained == 2, {"count": c["archived"], "retained": retained})
    ck("the archived count is not zero while it holds records", c["archived"] > 0, c["archived"])

    # ---- recall is chapter aware, a documented event ----
    # arch-co: chapter 1, recalls to its first-contact state (replied), thread intact.
    acts_before = pg.evaluate("()=>getActivity().length")
    ks_before = pg.evaluate("""()=>{ const o={}; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
      if(k&&k.indexOf('thrive_')===0)o[k]=localStorage.getItem(k);} return Object.keys(o).sort().join(','); }""")
    pg.evaluate("()=>runMove('unarchive','arch-co',{})"); pg.wait_for_timeout(300)
    ck("arch-co is no longer archived after recall", not pg.evaluate("()=>!!getDraft('arch-co').archived"), None)
    ck("recall wrote a documented activity event (logActivity), no key added",
       pg.evaluate("()=>getActivity().length") > acts_before and
       pg.evaluate("""()=>{ const o={}; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
         if(k&&k.indexOf('thrive_')===0)o[k]=localStorage.getItem(k);} return Object.keys(o).sort().join(','); }""") == ks_before, None)
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(700)
    ck("arch-co returns to a lane with its whole thread readable",
       lane_of(pg, "arch-co") in ("replied", "sent", "opened") and
       len([e for e in pg.evaluate("()=>buildThread('arch-co')") if e["kind"] in ("sent", "reply")]) >= 2,
       lane_of(pg, "arch-co"))

    # offer-co: converted (active chapter 2), recall must land it in the OFFER's
    # chapter, read through activeChapterStage, not the chapter-1 reply.
    pg.evaluate("()=>runMove('unarchive','offer-co',{})"); pg.wait_for_timeout(300)
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(700)
    lane = lane_of(pg, "offer-co")
    ck("recall of a converted opportunity is chapter aware (lands in the offer's chapter, sent, not the old reply)",
       lane == "sent", lane)
    detail = pg.evaluate("()=>{ const a=getActivity().filter(x=>x.slug==='offer-co'&&x.action==='lc_unarchive').pop(); return a?a.detail:''; }")
    ck("the recall records which chapter it reopened into (read through activeChapterStage)",
       "chapter 2" in detail, detail)

    # ---- the Library surface goes through the SAME shared path (follow-up) ----
    # The observable signature of the shared runMove path is the documented event
    # name: lc_archive and lc_unarchive with a chapter detail. The old Library
    # bypass logged bare "archive"/"unarchive" with no detail. So the event name is
    # the proof the Library now shares one code path, not a copy of it.
    def last_action(slug):
        return pg.evaluate("(s)=>{ const a=getActivity().filter(x=>x.slug===s); return a.length?a[a.length-1].action:''; }", slug)

    pg.evaluate("x=>location.hash='#library'"); pg.wait_for_timeout(900)
    # archive lib-conv from the Library grid button
    btn = pg.query_selector('.grid [data-arch="lib-conv"], [data-arch="lib-conv"]')
    ck("the Library shows an archive control for the converted card", btn is not None, None)
    if btn:
        btn.click(); pg.wait_for_timeout(400)
    ck("Library archive is now archived", pg.evaluate("()=>!!getDraft('lib-conv').archived"), None)
    ck("Library archive goes through the shared path (logs lc_archive, not the bare bypass)",
       last_action("lib-conv") == "lc_archive", last_action("lib-conv"))

    # count stays honest after a Library archive
    cc = build_counts(); ret = pg.evaluate("()=>getDrafts().filter(o=>o.archived).length")
    ck("the archived count is honest after a Library archive", cc["archived"] == ret, {"count": cc["archived"], "retained": ret})

    # reveal archived items and recall lib-conv from the Library grid
    pg.evaluate("""()=>{ const s=document.getElementById('statusFilter'); if(s){ s.value='archived';
      s.dispatchEvent(new Event('change')); } }""")
    pg.wait_for_timeout(500)
    rbtn = pg.query_selector('[data-arch="lib-conv"]')
    ck("the Library archived view shows the recall control", rbtn is not None, None)
    if rbtn:
        rbtn.click(); pg.wait_for_timeout(400)
    ck("Library recall goes through the shared chapter aware path (lc_unarchive with chapter 2)",
       last_action("lib-conv") == "lc_unarchive" and
       "chapter 2" in pg.evaluate("()=>{ const a=getActivity().filter(x=>x.slug==='lib-conv'&&x.action==='lc_unarchive').pop(); return a?a.detail:''; }"),
       pg.evaluate("()=>{ const a=getActivity().filter(x=>x.slug==='lib-conv'&&x.action==='lc_unarchive').pop(); return a?a.detail:''; }"))
    pg.evaluate("x=>location.hash='#board'"); pg.wait_for_timeout(700)
    ck("a card recalled from the Library lands in its active chapter's lane, same as the board",
       lane_of(pg, "lib-conv") == "sent", lane_of(pg, "lib-conv"))

    ctx.close(); b.close()

httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
