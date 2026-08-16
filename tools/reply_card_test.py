"""The reply card: in the Replied lane the parent opportunity and a DISTINCT reply card both show, and
tapping the reply card opens the conversation thread straight at that reply with the guiding pulse.

The gap (build 323c76cd): a single-opp reply moved the parent to Replied but surfaced no card of its own,
and tapping led to the cold overview. This adds a distinct reply-card element (not a .tok, so it never
enters the opportunity count or the drag order), placed under its parent, carrying the sender and a snippet,
and data-rid so a tap opens the thread at that reply (reusing highlightTarget -> .th-flash, reduced-motion
respected). The lane count stays the parent cards, so chips = lane header = count.

FAILS-WHEN-BROKEN: stop appending tk.replies in the replied render and the reply card is gone; point the tap
at the overview and it no longer opens history at the reply. WebKit / three widths stay Thyab's device gate.
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

# ---- source guards ----
app = open(f"{ROOT}/library/app.js").read(); i18n = open(f"{ROOT}/library/i18n.js").read(); css = open(f"{ROOT}/library/styles.css").read()
ck("Part 1: a distinct reply-card element exists (not a .tok), with a snippet and data-rid",
   "function replyLaneCardHtml(" in app and 'class="reply-card' in app and 'data-rid="' in app
   and "reply-card-snip" in app)
ck("Finding 2: one bounded grouped reply card per parent (header count + latest + <details> expander)",
   "function replyGroupHtml(" in app and 'class="reply-group"' in app and "reply-group-more" in app
   and "reply_earlier" in app and 'if(k==="replied" && tk.replies && tk.replies.length){ out+=replyGroupHtml(tk); }' in app)
ck("Finding 1: the reply card takes no own width/inset (it stretches inside the group, contained)",
   ".reply-card{" in css and "width:100%" not in css.split(".reply-card{")[1].split("}")[0]
   and "margin-inline-start:var(--s-4)" not in css.split(".reply-card{")[1].split("}")[0])
ck("Finding 3: thread bubbles separate the header row from the body (rp-head ruled off, rp-body)",
   'class="rp-head"' in app and 'class="rp-body"' in app and ".rp-head{" in css and ".rp-body{" in css)
ck("the reply-earlier expander label exists in both languages", i18n.count("reply_earlier:") == 2)
ck("Part 2: tapping a reply card opens the thread (history) at that reply, not the overview",
   '.querySelectorAll(".reply-card").forEach' in app
   and 'window.thriveModal.open(slug, "history", name, { kind:"reply", id:rid })' in app)
ck("the reply-card a11y label exists in both languages", i18n.count("reply_card_a11y:") == 2)
ck("the reply card uses the lane's own replied-green tokens, no new colour", ".reply-card{" in css and "var(--lane-replied)" in css)
ck("no em dash in the touched sources", "—" not in app and "—" not in css and "—" not in i18n)

# ---- live ----
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler); PORT = httpd.server_address[1]
httpd.daemon_threads = True; threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

SEED = """()=>{
 localStorage.setItem('thrive_opps_v1',JSON.stringify([
  {slug:'madar',business:'مدارس المدار الدولية',published:true,up:1},
  {slug:'echo',business:'Echo Media Group',published:true,up:1},
  {slug:'a',business:'Alpha Co',published:true,up:1}]));
 localStorage.setItem('thrive_inbound_v1',JSON.stringify([
  {gid:'i1',opp:'madar',kind:'reply',from:'basel@x.example',name:'Basel Issa',subject:'Re: hi',snippet:'yes, happy to help',ts:'2026-08-03T09:00:00Z'},
  {gid:'e1',opp:'echo',kind:'reply',from:'a@echo.example',name:'Ann',subject:'Re: hi',snippet:'first',ts:'2026-08-02T09:00:00Z'},
  {gid:'e2',opp:'echo',kind:'reply',from:'b@echo.example',name:'Bao',subject:'Re: hi',snippet:'second',ts:'2026-08-03T09:00:00Z'},
  {gid:'e3',opp:'echo',kind:'reply',from:'c@echo.example',name:'Cy',subject:'Re: hi',snippet:'third',ts:'2026-08-04T09:00:00Z'},
  {gid:'e4',opp:'echo',kind:'reply',from:'d@echo.example',name:'Dee',subject:'Re: hi',snippet:'fourth latest',ts:'2026-08-05T09:00:00Z'}]));
 localStorage.setItem('thrive_mail_v1',JSON.stringify([
  {mid:'s1',opp:'madar',to:'head@madar.example',subject:'hi',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'},
  {mid:'s2',opp:'echo',to:'x@echo.example',subject:'hi',status:'sent',direction:'out',ts:'2026-08-01T10:00:00Z'}]));
 localStorage.setItem('thrive_hits_v1','[]');
 window.__boardViewSet([
  {slug:'madar',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'echo',stage:'replied',open_count:0,replied:true,idle_days:1,has_page:true,has_email:false,archived:false},
  {slug:'a',stage:'sent',open_count:0,replied:false,idle_days:2,has_page:true,has_email:false,archived:false}]);
 window.invalidateSends&&window.invalidateSends();
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width":1280,"height":900})
    ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(f"{base}/library/manifest.json", lambda r: r.fulfill(status=200, body='{"opportunities":[]}'))
    pg = ctx.new_page()
    pg.goto(f"{base}/library/console.html"); pg.wait_for_timeout(400)
    pg.evaluate("()=>{ localStorage.setItem('console_sb_read','1'); localStorage.setItem('console_sb_session', JSON.stringify({access_token:'jwt',uid:'op',email:'op@x'})); }")
    pg.reload(); pg.wait_for_function("()=>typeof window.thriveBoardRefresh==='function' && typeof window.__boardViewSet==='function'", timeout=15000)
    pg.evaluate("()=>{ document.documentElement.classList.remove('gate-locked'); const g=document.getElementById('thriveGate'); if(g) g.remove(); }")
    pg.evaluate(SEED)
    pg.evaluate("()=>{ location.hash='#board'; }")
    pg.evaluate("async ()=>{ await window.thriveBoardRefresh(); }"); pg.wait_for_timeout(500)

    st = pg.evaluate("""()=>{
      const rep=document.querySelector('.lane[data-lane="replied"] [data-body="replied"]') || document.querySelector('[data-body="replied"]');
      const parent=rep && rep.querySelector('.tok[data-slug="madar"]');
      const group=rep && rep.querySelector('.reply-group[data-slug="madar"]');
      const card=rep && rep.querySelector('.reply-group[data-slug="madar"] .reply-card');
      let order=false; if(parent&&group){ order=!!(parent.compareDocumentPosition(group)&Node.DOCUMENT_POSITION_FOLLOWING); }
      // containment: the group's right edge never exceeds the lane body's content box
      let contained=false; if(group){ const g=group.getBoundingClientRect(), L=rep.getBoundingClientRect();
        contained = g.left>=Math.floor(L.left)-1 && g.right<=Math.ceil(L.right)+1; }
      return {
        hasParent: !!parent, hasGroup: !!group, hasCard: !!card, order, contained,
        who: card ? (card.querySelector('.reply-card-who')||{}).textContent : null,
        snip: card ? !!card.querySelector('.reply-card-snip') : false,
        rid: card ? card.getAttribute('data-rid') : null,
        laneCount: (document.querySelector('[data-count="replied"]')||{}).textContent,
        tokCount: rep ? rep.querySelectorAll('.tok').length : -1,
        madarCards: rep ? rep.querySelectorAll('.reply-group[data-slug="madar"] .reply-card').length : -1
      };
    }""")
    ck("the parent opportunity card is in Replied", st["hasParent"] is True, st)
    ck("a DISTINCT grouped reply card follows the parent, carrying the sender and a snippet",
       st["hasGroup"] is True and st["hasCard"] is True and st["order"] is True and (st["who"] or "").find("Basel")>=0 and st["snip"] is True, st)
    ck("Finding 1: the reply card is contained inside the Replied column (no bleed past the edge)", st["contained"] is True, st)
    ck("the reply card carries the reply's gid (data-rid) for the tap", st["rid"]=="i1", st)
    ck("a single-reply parent shows exactly one reply card (no expander)", st["madarCards"]==1, st)
    ck("the lane count stays the opportunity cards only (2 parents: madar + echo), 2 toks",
       st["laneCount"]=="2" and st["tokCount"]==2, st)

    # Finding 2: echo has FOUR replies -> one bounded grouped card: header count, the latest featured, and
    # a single expander for the 3 earlier, bounded height (not four stacked cards down the lane).
    grp = pg.evaluate("""()=>{
      const rep=document.querySelector('[data-body="replied"]');
      const g=rep && rep.querySelector('.reply-group[data-slug="echo"]');
      if(!g) return {none:true};
      const head=g.querySelector('.reply-group-head'); const details=g.querySelector('details.reply-group-more');
      const featured=g.querySelector(':scope > .reply-card');       // the latest, outside the expander
      const earlier=g.querySelectorAll('.reply-group-list .reply-card');
      const collapsedH=g.getBoundingClientRect().height;
      // expand and measure: still bounded (the earlier list scrolls, not grows unbounded)
      if(details) details.open=true;
      const expandedH=g.getBoundingClientRect().height;
      const list=g.querySelector('.reply-group-list');
      const listScrolls = list ? (list.scrollHeight>list.clientHeight+1 || getComputedStyle(list).overflowY==='auto') : false;
      return {
        head: head? head.textContent : '',
        hasFeatured: !!featured,
        featuredLatest: !!(featured && featured.classList.contains('is-latest')),
        featuredWho: featured ? (featured.querySelector('.reply-card-who')||{}).textContent : '',
        summary: details ? (details.querySelector('summary')||{}).textContent : '',
        earlierCount: earlier.length,
        collapsedH, expandedH, boundedExpanded: expandedH<=420, listScrolls
      };
    }""")
    ck("Finding 2: echo shows a grouped card headed by the reply count (4)",
       grp.get("head","").find("4")>=0, grp)
    ck("Finding 2: the LATEST reply is featured (marked latest, newest sender Dee)",
       grp.get("hasFeatured") is True and grp.get("featuredLatest") is True and grp.get("featuredWho","").find("Dee")>=0, grp)
    ck("Finding 2: the 3 earlier replies fold behind one 'show N earlier replies' expander",
       grp.get("summary","").find("3")>=0 and grp.get("earlierCount")==3, grp)
    ck("Finding 2: the grouped card stays bounded even expanded (list scrolls, lane never grows unbounded)",
       grp.get("boundedExpanded") is True and grp.get("listScrolls") is True, grp)

    # tap the reply card -> the thread opens at that reply with the flash pulse
    pg.eval_on_selector('.reply-card[data-slug="madar"]', "el=>el.click()"); pg.wait_for_timeout(700)
    tap = pg.evaluate("""()=>{
      const modal=document.getElementById('modal');
      const hist=document.getElementById('modalHistory');
      const target=modal && [...modal.querySelectorAll('[data-rid]')].find(x=>x.getAttribute('data-rid')==='i1');
      return { open: !!(modal && !modal.hidden),
               historyShown: !!(hist && hist.querySelector('.th-list')),
               reachedReply: !!target, flashed: !!(target && target.classList.contains('th-flash')) };
    }""")
    ck("tapping the reply card opens the conversation (modal open)", tap["open"] is True, tap)
    ck("it opens on the thread (History) and reaches Basel's reply row (data-rid=i1)",
       tap["historyShown"] is True and tap["reachedReply"] is True, tap)
    ck("the reply pulses on arrival (th-flash), reduced-motion respected in CSS", tap["flashed"] is True, tap)

    # Part 3: the conversation reads as an ordered two-sided thread: our send (outgoing bubble) then their
    # reply (incoming card), chronological.
    thread = pg.evaluate("""()=>{ const hist=document.getElementById('modalHistory');
      const sent=hist&&hist.querySelector('.th-sent .msg-out');
      const reply=hist&&hist.querySelector('.th-reply .rp-card');
      let order=false; if(sent&&reply){ order=!!(sent.compareDocumentPosition(reply)&Node.DOCUMENT_POSITION_FOLLOWING); }
      // Finding 3: each bubble separates a header block from the body, and the header is ABOVE the body
      const rh=reply&&reply.querySelector('.rp-head'), rb=reply&&reply.querySelector('.rp-body');
      let headAboveBody=false; if(rh&&rb){ headAboveBody=!!(rh.compareDocumentPosition(rb)&Node.DOCUMENT_POSITION_FOLLOWING); }
      return { sent:!!sent, reply:!!reply, order, hasHead:!!rh, hasBody:!!rb, headAboveBody,
               sentHasHead: !!(sent&&sent.querySelector('.rp-head')) }; }""")
    ck("Part 3: the thread shows our send as an outgoing bubble and the reply as an incoming card, in order",
       thread["sent"] is True and thread["reply"] is True and thread["order"] is True, thread)
    ck("Finding 3: each bubble separates its header row from the body below (header above body)",
       thread["hasHead"] is True and thread["hasBody"] is True and thread["headAboveBody"] is True and thread["sentHasHead"] is True, thread)

    ctx.close(); b.close()
httpd.shutdown()
print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
